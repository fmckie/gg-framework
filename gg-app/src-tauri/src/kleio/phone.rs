//! iPhone-only setup: the app's one web view, its trips to the background,
//! and "agent finished" notifications.

use std::ffi::c_void;
use std::sync::{Once, OnceLock};

use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::{NSError, NSString};
use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};
use tauri::Manager;

use super::push::{apns_env, hex, register_due, PushToken};
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
