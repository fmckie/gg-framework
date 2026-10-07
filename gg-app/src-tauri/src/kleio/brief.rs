//! iPhone: "Brief me" for Siri and Shortcuts ("Hey Siri, brief me in Kleio").
//! Swift (gen/apple/Sources/gg-app/KleioBrief.swift) asks; this fetches the
//! Kleio host's briefing (packages/kleio-host/src/brief.ts) as this device and
//! hands back the words for Siri to say. Read-only.
//!
//! Only the iPhone build calls it; the words are built, and tested, everywhere.
#![cfg_attr(not(target_os = "ios"), allow(dead_code))]

/// The most Siri is handed to say (the host keeps a briefing far shorter).
const WORDS_MAX: usize = 1_500;

/// How the host answered "Brief me".
#[derive(Debug)]
pub enum Reply {
    /// This iPhone has no Mac mini to ask.
    NotPaired,
    /// The request couldn't be made, or no answer came.
    Unreachable,
    /// The host's HTTP status and JSON body.
    Answered(u16, serde_json::Value),
}

/// What Siri says: the host's briefing, or why there isn't one.
pub fn words(reply: &Reply) -> String {
    match reply {
        Reply::NotPaired => {
            "Kleio isn't connected to your Mac mini yet. Open Kleio to connect it.".into()
        }
        Reply::Unreachable => {
            "I couldn't reach your Mac mini. Check it's switched on and online.".into()
        }
        Reply::Answered(200, body) => match body.get("spoken").and_then(|s| s.as_str()) {
            Some(s) if !s.trim().is_empty() => {
                // Plain words only: nothing that isn't text reaches Siri.
                s.trim()
                    .chars()
                    .filter(|c| !c.is_control() || *c == ' ')
                    .take(WORDS_MAX)
                    .collect()
            }
            _ => "Your Mac mini answered, but without a briefing. Try again in a moment.".into(),
        },
        Reply::Answered(401 | 403, _) => {
            "This iPhone isn't connected to your Mac mini any more. Open Kleio to reconnect.".into()
        }
        // A Mac mini running a Kleio from before briefings.
        Reply::Answered(404, _) => {
            "Your Mac mini needs the latest Kleio before it can brief you.".into()
        }
        Reply::Answered(..) => {
            "Something went wrong getting your briefing. Try again in a moment.".into()
        }
    }
}

#[cfg(target_os = "ios")]
mod ios {
    use std::ffi::{c_char, CString};

    use super::{words, Reply};

    /// The briefing, as words for Siri. Swift frees it with
    /// `kleio_string_free`. Blocks until the host answers (or times out).
    #[no_mangle]
    pub extern "C" fn kleio_brief() -> *mut c_char {
        // Nothing may unwind into Swift.
        let said = std::panic::catch_unwind(|| tauri::async_runtime::block_on(fetch()))
            .unwrap_or_else(|_| words(&Reply::Unreachable));
        CString::new(said).map_or(std::ptr::null_mut(), CString::into_raw)
    }

    /// Frees a string this library handed to Swift.
    #[no_mangle]
    pub extern "C" fn kleio_string_free(s: *mut c_char) {
        if !s.is_null() {
            // SAFETY: `s` came from `CString::into_raw` above, and Swift frees it once.
            drop(unsafe { CString::from_raw(s) });
        }
    }

    async fn fetch() -> String {
        // Read the pairing now if this launch hasn't (Siri may launch the app
        // in the background; the Keychain opens once the phone is unlocked,
        // which the intent asks for).
        let fresh;
        let remote = match crate::kleio::remote() {
            Some(r) => r,
            None => match crate::kleio::remote_now() {
                Some(r) => {
                    fresh = r;
                    &fresh
                }
                None => {
                    log::warn!("kleio: brief: not paired with a Kleio host");
                    return words(&Reply::NotPaired);
                }
            },
        };
        crate::install_rustls_provider();
        let started = std::time::Instant::now();
        let client = match crate::kleio::commands::answer_client(remote) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("kleio: brief: {e}");
                return words(&Reply::Unreachable);
            }
        };
        let res = client
            .post(format!("{}/kleio/brief", remote.base))
            .json(&serde_json::json!({}))
            .send()
            .await;
        let reply = match res {
            Ok(r) => {
                let status = r.status().as_u16();
                let body = r.json().await.unwrap_or(serde_json::Value::Null);
                log::info!(
                    "kleio: brief status={status} elapsed_ms={}",
                    started.elapsed().as_millis()
                );
                Reply::Answered(status, body)
            }
            Err(e) => {
                log::warn!("kleio: brief failed: {e}");
                Reply::Unreachable
            }
        };
        words(&reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn says_the_hosts_briefing() {
        let r = Reply::Answered(200, json!({ "spoken": "  Nothing needs you right now.  " }));
        assert_eq!(words(&r), "Nothing needs you right now.");
    }

    #[test]
    fn says_why_when_there_is_no_briefing() {
        let cases = [
            (Reply::NotPaired, "isn't connected to your Mac mini yet"),
            (Reply::Unreachable, "couldn't reach your Mac mini"),
            (Reply::Answered(200, json!({})), "without a briefing"),
            (Reply::Answered(200, json!({ "spoken": "   " })), "without a briefing"),
            (Reply::Answered(200, serde_json::Value::Null), "without a briefing"),
            (Reply::Answered(401, json!({})), "any more"),
            (Reply::Answered(403, json!({})), "any more"),
            (Reply::Answered(404, json!({})), "needs the latest Kleio"),
            (Reply::Answered(500, json!({ "spoken": "ignored" })), "Something went wrong"),
        ];
        for (reply, expected) in cases {
            let said = words(&reply);
            assert!(said.contains(expected), "{reply:?} said {said:?}");
        }
    }

    #[test]
    fn keeps_siri_to_plain_bounded_text() {
        let long = "word ".repeat(1_000);
        let said = words(&Reply::Answered(200, json!({ "spoken": long })));
        assert!(said.chars().count() <= WORDS_MAX);
        let said = words(&Reply::Answered(200, json!({ "spoken": "One.\u{0}\u{1b}[2J Two." })));
        assert_eq!(said, "One.[2J Two.");
    }
}
