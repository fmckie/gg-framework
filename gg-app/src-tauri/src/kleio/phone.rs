//! iPhone-only setup of the app's one web view.

use objc2::msg_send;
use objc2::runtime::AnyObject;

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
