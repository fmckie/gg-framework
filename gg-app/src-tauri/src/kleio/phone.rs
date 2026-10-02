//! iPhone-only setup: the app's one web view, its trips to the background,
//! and "agent finished" notifications (getting them, and opening what a
//! tapped one is about).

use std::ffi::c_void;
use std::sync::{Once, OnceLock};

use objc2::runtime::{AnyClass, AnyObject, AnyProtocol, Bool, ClassBuilder, Imp, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::{NSError, NSString};
use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};
use tauri::{Emitter, Manager};

use super::push::{apns_env, hex, register_due, tap_from_payload, PendingTap, PushToken};
use super::Presence;

/// `UIScrollViewContentInsetAdjustmentBehavior.never`.
const INSET_ADJUSTMENT_NEVER: isize = 2;

/// Let the page run edge to edge. By default the web view's scroll view shrinks
/// the page by the status-bar and home-indicator safe areas, which left a
/// lighter strip along the bottom of every screen. With that off, the page
/// fills the screen and pads itself with `env(safe-area-inset-*)`
/// (kleio-phone.css).
pub fn fill_screen(window: &tauri::WebviewWindow) {
    let queued = window.with_webview(|webview| {
        let wk = webview.inner().cast::<AnyObject>();
        if wk.is_null() {
            return;
        }
        // SAFETY: `inner()` is this window's live WKWebView, and `with_webview`
        // runs the closure on the main thread, where UIKit must be called.
        // `scrollView` returns the web view's own (non-null) UIScrollView, and
        // `setContentInsetAdjustmentBehavior:` takes an NSInteger enum value.
        unsafe {
            let scroll: *mut AnyObject = msg_send![wk, scrollView];
            if scroll.is_null() {
                return;
            }
            let _: () =
                msg_send![scroll, setContentInsetAdjustmentBehavior: INSET_ADJUSTMENT_NEVER];
        }
    });
    if let Err(e) = queued {
        log::warn!("kleio: could not set up the iPhone web view: {e}");
    }
}

/// Tell `Presence` when the app goes to the background, so the event streams
/// close and the host sees that nobody is watching (and notifies). Coming back
/// is `WindowEvent::Resumed`. Tauri's own "suspended" event cannot be used here:
/// it fires when the app merely becomes inactive (Control Center, an incoming
/// call banner) and has no matching event when that ends.
pub fn watch_background(app: &tauri::AppHandle) {
    let app = app.clone();
    let on_background = block2::RcBlock::new(move |_note: *mut AnyObject| {
        log::info!("kleio: app went to the background; closing event streams");
        app.state::<Presence>().background();
    });
    // UIKit notification names are NSStrings equal to their symbol names.
    let name = NSString::from_str("UIApplicationDidEnterBackgroundNotification");
    // SAFETY: `defaultCenter` is the process-wide notification center. With a
    // nil queue the block runs on the posting (main) thread. The center copies
    // the block and keeps it, and the observer token, for the app's lifetime,
    // which is how long this observer should live.
    unsafe {
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let _observer: *mut AnyObject = msg_send![
            center,
            addObserverForName: &*name,
            object: std::ptr::null_mut::<AnyObject>(),
            queue: std::ptr::null_mut::<AnyObject>(),
            usingBlock: &*on_background
        ];
    }
}

/// The app, for the push-token callbacks iOS makes into the app delegate. Those
/// are plain C functions with no way to carry a context, so they reach the app
/// through this.
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static DELEGATE_METHODS: Once = Once::new();

/// Turn on "agent finished" notifications: ask permission once (iOS remembers
/// the answer, and an upgrade over the old app keeps it), then get this
/// launch's device token; `did_register` hands it to the host.
pub fn enable_notifications(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let answered = block2::RcBlock::new(|granted: Bool, _error: *mut NSError| {
        log::info!(
            "kleio: notification permission granted={}",
            granted.as_bool()
        );
    });
    let options = UNAuthorizationOptions::Alert
        | UNAuthorizationOptions::Sound
        | UNAuthorizationOptions::Badge;
    center.requestAuthorizationWithOptions_completionHandler(options, &answered);

    let queued = app.run_on_main_thread(|| {
        add_delegate_methods();
        // SAFETY: on the main thread, as UIKit requires. The token (or an
        // error) arrives later through the delegate methods added above.
        unsafe {
            let ui_app: *mut AnyObject = msg_send![class!(UIApplication), sharedApplication];
            if !ui_app.is_null() {
                let _: () = msg_send![ui_app, registerForRemoteNotifications];
            }
        }
    });
    if let Err(e) = queued {
        log::warn!("kleio: could not ask iOS for a push token: {e}");
    }
}

/// iOS delivers the device token only to the app delegate, and Tauri's (tao's)
/// delegate does not handle it, so the two methods are added to that class.
fn add_delegate_methods() {
    DELEGATE_METHODS.call_once(|| {
        type Callback =
            unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject);
        // SAFETY: main thread (see `enable_notifications`). The delegate is
        // tao's app delegate, alive for the whole app. tao implements neither
        // method, so `class_addMethod` adds rather than replaces. Both
        // functions match the `v@:@@` signature they are registered with
        // (void return; self, _cmd, UIApplication*, NSData* / NSError*).
        unsafe {
            let ui_app: *mut AnyObject = msg_send![class!(UIApplication), sharedApplication];
            if ui_app.is_null() {
                return;
            }
            let delegate: *mut AnyObject = msg_send![ui_app, delegate];
            if delegate.is_null() {
                log::warn!("kleio: no app delegate; notifications are off");
                return;
            }
            let class = (*delegate).class() as *const AnyClass as *mut AnyClass;
            let methods: [(Sel, Callback); 2] = [
                (
                    sel!(application:didRegisterForRemoteNotificationsWithDeviceToken:),
                    did_register,
                ),
                (
                    sel!(application:didFailToRegisterForRemoteNotificationsWithError:),
                    did_fail,
                ),
            ];
            for (selector, callback) in methods {
                let imp = std::mem::transmute::<Callback, Imp>(callback);
                let added = objc2::ffi::class_addMethod(class, selector, imp, c"v@:@@".as_ptr());
                if !added.as_bool() {
                    log::warn!("kleio: the app delegate already handles {selector:?}");
                }
            }
        }
    });
}

/// `application:didRegisterForRemoteNotificationsWithDeviceToken:`
unsafe extern "C-unwind" fn did_register(
    _this: *mut AnyObject,
    _cmd: Sel,
    _app: *mut AnyObject,
    token: *mut AnyObject,
) {
    if token.is_null() {
        return;
    }
    // SAFETY: `token` is the NSData iOS passed in, valid for this call;
    // `bytes` points at `length` bytes it owns, copied out before returning.
    let bytes = unsafe {
        let length: usize = msg_send![token, length];
        let data: *const c_void = msg_send![token, bytes];
        if data.is_null() || length == 0 {
            return;
        }
        std::slice::from_raw_parts(data.cast::<u8>(), length).to_vec()
    };
    token_received(hex(&bytes));
}

/// `application:didFailToRegisterForRemoteNotificationsWithError:`
unsafe extern "C-unwind" fn did_fail(
    _this: *mut AnyObject,
    _cmd: Sel,
    _app: *mut AnyObject,
    error: *mut AnyObject,
) {
    // SAFETY: `error` is the NSError iOS passed in, valid for this call.
    let reason = unsafe {
        let text: *mut NSString = if error.is_null() {
            std::ptr::null_mut()
        } else {
            msg_send![error, localizedDescription]
        };
        if text.is_null() {
            "unknown".to_string()
        } else {
            (*text).to_string()
        }
    };
    log::warn!("kleio: iOS gave no push token: {reason}");
}

/// The action iOS reports when a notification is swiped away rather than
/// tapped (only sent to apps that ask for it; ignored here regardless).
const DISMISS_ACTION: &str = "com.apple.UNNotificationDismissActionIdentifier";

/// Open what a tapped notification is about. iOS reports a tap only to the
/// notification center's delegate, which has to be in place before the app
/// finishes launching or a tap that launched the app is lost. Call from
/// Tauri's `setup`, which runs inside `didFinishLaunching` on iOS.
pub fn handle_notification_taps(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let Some(class) = tap_delegate_class() else {
        log::warn!("kleio: could not create the notification delegate; taps open the app only");
        return;
    };
    // SAFETY: `setup` runs on the main thread. `new` returns an owned (+1)
    // instance that is deliberately never released: the center holds its
    // delegate weakly, and this one must live as long as the app.
    unsafe {
        let delegate: *mut AnyObject = msg_send![class, new];
        if delegate.is_null() {
            return;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let _: () = msg_send![&*center, setDelegate: delegate];
    }
}

/// An Objective-C class with the one `UNUserNotificationCenterDelegate` method
/// Kleio needs. iOS checks for the method itself, so the protocol is added
/// only when the runtime has it.
fn tap_delegate_class() -> Option<&'static AnyClass> {
    static CLASS: OnceLock<Option<&'static AnyClass>> = OnceLock::new();
    *CLASS.get_or_init(|| {
        type DidReceive = unsafe extern "C-unwind" fn(
            *mut AnyObject,
            Sel,
            *mut AnyObject,
            *mut AnyObject,
            *mut block2::Block<dyn Fn()>,
        );
        let mut builder = ClassBuilder::new(c"KleioNotificationTapDelegate", class!(NSObject))?;
        if let Some(protocol) = AnyProtocol::get(c"UNUserNotificationCenterDelegate") {
            builder.add_protocol(protocol);
        }
        // SAFETY: `did_receive_response` takes exactly what iOS passes for
        // userNotificationCenter:didReceiveNotificationResponse:
        // withCompletionHandler: (self, _cmd, the center, the response, and a
        // void-returning completion block) and returns nothing.
        unsafe {
            builder.add_method(
                sel!(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:),
                did_receive_response as DidReceive,
            );
        }
        Some(builder.register())
    })
}

/// `userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:`
unsafe extern "C-unwind" fn did_receive_response(
    _this: *mut AnyObject,
    _cmd: Sel,
    _center: *mut AnyObject,
    response: *mut AnyObject,
    done: *mut block2::Block<dyn Fn()>,
) {
    // SAFETY: `response` and `done` are what iOS passed for this call. iOS
    // expects the completion block to be called once, when handling is done.
    unsafe {
        if !response.is_null() {
            notification_tapped(response);
        }
        if !done.is_null() {
            (*done).call(());
        }
    }
}

/// Hand the tapped notification to the screen (kleio_take_notification_tap).
///
/// # Safety
/// `response` must be a live UNNotificationResponse.
unsafe fn notification_tapped(response: *mut AnyObject) {
    // SAFETY: each accessor returns an object owned by `response`, alive for
    // this call; `userInfo` is the notification's payload dictionary.
    let payload = unsafe {
        let action: *mut NSString = msg_send![response, actionIdentifier];
        if !action.is_null() && (*action).to_string() == DISMISS_ACTION {
            return;
        }
        let notification: *mut AnyObject = msg_send![response, notification];
        let request: *mut AnyObject = msg_send![notification, request];
        let content: *mut AnyObject = msg_send![request, content];
        let user_info: *mut AnyObject = msg_send![content, userInfo];
        json_of(user_info)
    };
    let Some(tap) = payload.as_ref().and_then(tap_from_payload) else {
        return;
    };
    let Some(app) = APP.get() else {
        return;
    };
    log::info!(
        "kleio: notification tapped session={} group={}",
        tap.session_id.is_some(),
        tap.group_id.is_some()
    );
    app.state::<PendingTap>().set(tap);
    let _ = app.emit("kleio-notification-tap", ());
}

/// A Foundation object (here: a push payload) as JSON.
///
/// # Safety
/// `object` must be null or a live Foundation object.
unsafe fn json_of(object: *mut AnyObject) -> Option<serde_json::Value> {
    if object.is_null() {
        return None;
    }
    let json = class!(NSJSONSerialization);
    // SAFETY: `isValidJSONObject:` is checked first, so `dataWithJSONObject:`
    // cannot throw. The returned NSData is autoreleased and outlives this
    // call; its bytes are copied out by `from_slice` before returning.
    unsafe {
        let valid: bool = msg_send![json, isValidJSONObject: object];
        if !valid {
            return None;
        }
        let no_error: *mut *mut AnyObject = std::ptr::null_mut();
        let data: *mut AnyObject =
            msg_send![json, dataWithJSONObject: object, options: 0usize, error: no_error];
        if data.is_null() {
            return None;
        }
        let length: usize = msg_send![data, length];
        let bytes: *const c_void = msg_send![data, bytes];
        if bytes.is_null() || length == 0 {
            return None;
        }
        serde_json::from_slice(std::slice::from_raw_parts(bytes.cast::<u8>(), length)).ok()
    }
}

/// Show a downloaded file (a PDF report, an image, a document) full screen in
/// iOS's own viewer, with Done and Share. The desktop hands files to their
/// default app; on the iPhone that path went to `UIApplication.open`, which
/// silently ignores a local file, so tapping a file did nothing.
///
/// Resolves once the viewer is showing. Errs when iOS cannot preview the file.
pub async fn preview_file(
    window: &tauri::WebviewWindow,
    file: std::path::PathBuf,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    window
        .with_webview(move |webview| {
            let screen = webview.view_controller().cast::<AnyObject>();
            // SAFETY: `with_webview` runs this on the main thread, as UIKit
            // requires; `screen` is the live web view's view controller.
            let _ = tx.send(unsafe { present_preview(screen, &file) });
        })
        .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "The file viewer did not open.".to_string())?
}

/// Keys for what the preview objects keep alive: the delegate on its
/// controller (which holds its delegate weakly), and the screen to present
/// from on the delegate. Only their addresses matter; the different values
/// keep the compiler from merging the two into one address.
static PREVIEW_DELEGATE_KEY: u8 = 1;
static PREVIEW_SCREEN_KEY: u8 = 2;

/// # Safety
/// Main thread only; `screen` must be null or a live UIViewController.
unsafe fn present_preview(screen: *mut AnyObject, file: &std::path::Path) -> Result<(), String> {
    let unavailable = || "The file viewer is unavailable.".to_string();
    if screen.is_null() {
        return Err(unavailable());
    }
    let Some(class) = preview_delegate_class() else {
        return Err(unavailable());
    };
    let path = NSString::from_str(&file.to_string_lossy());
    // SAFETY: main thread (caller). `fileURLWithPath:` and
    // `interactionControllerWithURL:` return autoreleased objects; UIKit
    // retains the controller while its viewer shows. The delegate (+1 from
    // `new`) is attached to the controller with a retaining association and
    // then released, so it lives exactly as long as the controller; the screen
    // is attached to the delegate the same way.
    unsafe {
        let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: &*path];
        if url.is_null() {
            return Err("The file could not be found.".to_string());
        }
        let controller: *mut AnyObject = msg_send![
            class!(UIDocumentInteractionController),
            interactionControllerWithURL: url
        ];
        if controller.is_null() {
            return Err(unavailable());
        }
        let delegate: *mut AnyObject = msg_send![class, new];
        if delegate.is_null() {
            return Err(unavailable());
        }
        objc2::ffi::objc_setAssociatedObject(
            delegate,
            std::ptr::from_ref(&PREVIEW_SCREEN_KEY).cast(),
            screen,
            objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
        );
        objc2::ffi::objc_setAssociatedObject(
            controller,
            std::ptr::from_ref(&PREVIEW_DELEGATE_KEY).cast(),
            delegate,
            objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
        );
        let _: () = msg_send![delegate, release];
        let _: () = msg_send![controller, setDelegate: delegate];
        let shown: Bool = msg_send![controller, presentPreviewAnimated: true];
        if shown.as_bool() {
            Ok(())
        } else {
            Err("iPhone can't preview this kind of file. Save a copy instead.".to_string())
        }
    }
}

/// A `UIDocumentInteractionControllerDelegate` that names the screen the
/// viewer slides up over.
fn preview_delegate_class() -> Option<&'static AnyClass> {
    static CLASS: OnceLock<Option<&'static AnyClass>> = OnceLock::new();
    *CLASS.get_or_init(|| {
        type PresentFrom = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject;
        let mut builder = ClassBuilder::new(c"KleioPreviewDelegate", class!(NSObject))?;
        if let Some(protocol) = AnyProtocol::get(c"UIDocumentInteractionControllerDelegate") {
            builder.add_protocol(protocol);
        }
        // SAFETY: `present_from` takes what iOS passes for
        // documentInteractionControllerViewControllerForPreview: (self, _cmd,
        // the controller) and returns a UIViewController.
        unsafe {
            builder.add_method(
                sel!(documentInteractionControllerViewControllerForPreview:),
                present_from as PresentFrom,
            );
        }
        Some(builder.register())
    })
}

/// `documentInteractionControllerViewControllerForPreview:` — the app's
/// screen, or a sheet already up over it.
unsafe extern "C-unwind" fn present_from(
    this: *mut AnyObject,
    _cmd: Sel,
    _controller: *mut AnyObject,
) -> *mut AnyObject {
    // SAFETY: iOS calls this on the main thread with `this` the live delegate
    // `present_preview` made; the screen attached to it is retained by it, and
    // each controller returned is owned by UIKit and outlives this call.
    unsafe {
        let mut top = objc2::ffi::objc_getAssociatedObject(
            this,
            std::ptr::from_ref(&PREVIEW_SCREEN_KEY).cast(),
        )
        .cast_mut();
        while !top.is_null() {
            let next: *mut AnyObject = msg_send![top, presentedViewController];
            if next.is_null() {
                break;
            }
            top = next;
        }
        top
    }
}

fn token_received(token: String) {
    let Some(app) = APP.get() else {
        return;
    };
    let profile = std::env::current_exe()
        .ok()
        .and_then(|exe| std::fs::read(exe.with_file_name("embedded.mobileprovision")).ok());
    let Some(env) = apns_env(profile.as_deref(), cfg!(target_abi = "sim")) else {
        log::warn!("kleio: this build is not signed for push notifications");
        return;
    };
    log::info!("kleio: got a push token env={env:?}");
    app.state::<PushToken>().set(token, env);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        register_due(&app.state::<PushToken>()).await;
    });
}
