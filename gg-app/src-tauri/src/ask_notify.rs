//! Desktop (macOS): a native notification when the agent asks the user a
//! question (`ask_user`) while the Kleio window is not focused. The webview
//! decides when (it knows focus); this only posts. Clicking the notification
//! activates the app (the system default for a notification with no actions).
//! Authorization is requested once, lazily, on the first question.

/// Lock-screen-sized text: whitespace collapsed, clipped to `max` chars.
fn clip(text: &str, max: usize) -> String {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() <= max {
        return t;
    }
    let mut out: String = t.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(target_os = "macos")]
mod imp {
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest,
        UNNotificationSound, UNUserNotificationCenter,
    };
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Once;

    static AUTHORIZE: Once = Once::new();
    static SEQ: AtomicU64 = AtomicU64::new(0);

    /// UNUserNotificationCenter throws (aborting the process) outside an app
    /// bundle, e.g. a bare `cargo run` binary — never call it there.
    fn bundled() -> bool {
        std::env::current_exe()
            .map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/"))
            .unwrap_or(false)
    }

    pub fn post(title: &str, body: &str) -> Result<(), String> {
        if !bundled() {
            return Err("notifications need the bundled app".into());
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        AUTHORIZE.call_once(|| {
            let answered = block2::RcBlock::new(|granted: Bool, _error: *mut NSError| {
                log::info!("ask notification permission granted={}", granted.as_bool());
            });
            center.requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &answered,
            );
        });
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        let id = format!("kleio-ask-{}", SEQ.fetch_add(1, Ordering::Relaxed));
        let request =
            UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&id), &content, None);
        let done = block2::RcBlock::new(|error: *mut NSError| {
            if !error.is_null() {
                log::warn!("ask notification was not posted (permission denied?)");
            }
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&done));
        Ok(())
    }
}

/// Post "the agent has a question" as a native notification. A no-op off macOS.
#[tauri::command]
pub fn desktop_notify_ask(title: String, body: String) -> Result<(), String> {
    let (title, body) = (clip(&title, 120), clip(&body, 200));
    #[cfg(target_os = "macos")]
    {
        imp::post(&title, &body)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (title, body);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::clip;

    #[test]
    fn clips_and_collapses() {
        assert_eq!(clip("a \n b", 10), "a b");
        assert_eq!(clip("abcdef", 4), "abc…");
    }
}
