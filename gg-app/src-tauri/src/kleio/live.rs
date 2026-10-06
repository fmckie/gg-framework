//! iPhone: Live Activities, the lock screen and Dynamic Island view of what an
//! agent is doing (gen/apple/KleioWidgets).
//!
//! The app starts one when you send a message; the Kleio host keeps it current
//! by push (packages/kleio-host/src/live-activity.ts), and starts one itself
//! when an agent needs you and none is showing. Swift
//! (gen/apple/Sources/gg-app/KleioLiveActivities.swift) talks to ActivityKit
//! and reports each push token iOS issues; this module registers the tokens
//! with the host, and opens the conversation a tapped activity is about.
//!
//! Only the iPhone build uses it; it is compiled everywhere so its logic is
//! tested on the Mac.
#![cfg_attr(not(target_os = "ios"), allow(dead_code))]

use std::collections::BTreeMap;
use std::sync::Mutex;

use super::commands::safe_session;
use super::push::{ApnsEnv, NotificationTap};

const TITLE_CHARS: usize = 40;
/// ActivityKit tokens are longer than notification tokens; the host checks the same bounds.
const TOKEN_HEX: std::ops::RangeInclusive<usize> = 32..=400;

/// Which conversation an activity is about.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Target {
    Session(String),
    Group(String),
}

/// A push token Swift reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Report {
    /// One activity's update token: how the host updates and ends it.
    Activity { target: Target, token: String },
    /// The app's push-to-start token: how the host starts an activity.
    Start { token: String },
}

/// Read one report line from Swift. Anything that could not have come from
/// ActivityKit is dropped: the ids go on to the host in requests.
pub fn parse_report(json: &str) -> Option<Report> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let token = v.get("token")?.as_str()?;
    if !TOKEN_HEX.contains(&token.len())
        || !token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    let token = token.to_string();
    let id = |key: &str| {
        v.get(key)
            .and_then(|s| s.as_str())
            .filter(|s| safe_session(s))
            .map(str::to_string)
    };
    match v.get("type")?.as_str()? {
        "startToken" => Some(Report::Start { token }),
        "token" => {
            let target = match (id("groupId"), id("sessionId")) {
                (Some(g), _) => Target::Group(g),
                (None, Some(s)) => Target::Session(s),
                (None, None) => return None,
            };
            Some(Report::Activity { target, token })
        }
        _ => None,
    }
}

/// The request to the host that registers a report.
pub fn registration(report: &Report, env: ApnsEnv) -> (&'static str, serde_json::Value) {
    match report {
        Report::Start { token } => (
            "/kleio/live-activity/start-token",
            serde_json::json!({ "token": token, "env": env }),
        ),
        Report::Activity { target, token } => {
            let mut body = serde_json::json!({ "token": token, "env": env });
            match target {
                Target::Session(id) => body["sessionId"] = id.clone().into(),
                Target::Group(id) => body["groupId"] = id.clone().into(),
            }
            ("/kleio/live-activity", body)
        }
    }
}

/// The newest token per activity (and the start token), and whether the host
/// has it yet. A registration that failed is retried when the app is back on
/// screen.
#[derive(Default)]
pub struct LiveTokens(Mutex<BTreeMap<Option<Target>, Held>>);

struct Held {
    report: Report,
    registered: bool,
}

impl LiveTokens {
    /// iOS handed over a token; the host does not have it yet (a token it
    /// already has stays registered).
    pub fn set(&self, report: Report) {
        let key = match &report {
            Report::Start { .. } => None,
            Report::Activity { target, .. } => Some(target.clone()),
        };
        let mut map = self.0.lock().unwrap();
        if map.get(&key).is_some_and(|h| h.report == report) {
            return;
        }
        map.insert(
            key,
            Held {
                report,
                registered: false,
            },
        );
    }

    /// The tokens the host does not have yet.
    pub fn unregistered(&self) -> Vec<Report> {
        let map = self.0.lock().unwrap();
        map.values()
            .filter(|h| !h.registered)
            .map(|h| h.report.clone())
            .collect()
    }

    /// The host has this token (unless a newer one replaced it meanwhile).
    pub fn registered(&self, report: &Report) {
        let mut map = self.0.lock().unwrap();
        if let Some(h) = map.values_mut().find(|h| &h.report == report) {
            h.registered = true;
        }
    }
}

/// What starting an activity asks Swift for (its `StartRequest`).
pub fn start_request(
    kind: &str,
    title: &str,
    session_id: Option<&str>,
    group_id: Option<&str>,
) -> Result<String, String> {
    if !matches!(kind, "chat" | "code" | "specialist" | "group") {
        return Err(format!("unknown kind {kind:?}"));
    }
    let id = |s: Option<&str>| -> Result<Option<String>, String> {
        match s {
            Some(s) if safe_session(s) => Ok(Some(s.to_string())),
            Some(_) => Err("bad id".to_string()),
            None => Ok(None),
        }
    };
    let (session_id, group_id) = (id(session_id)?, id(group_id)?);
    if session_id.is_none() && group_id.is_none() {
        return Err("a session or a group is required".to_string());
    }
    let title = one_line(title);
    let title = if title.is_empty() {
        "Kleio".to_string()
    } else {
        title
    };
    Ok(serde_json::json!({
        "kind": kind,
        "title": title,
        "sessionId": session_id,
        "groupId": group_id,
    })
    .to_string())
}

/// What to call a Chat or Code conversation on the lock screen: a project by
/// its folder, a chat by its message's first line.
pub fn prompt_title(chat: bool, cwd: Option<&str>, text: &str) -> String {
    if !chat {
        let folder = cwd
            .filter(|c| *c != super::HOST_DEFAULT_CWD)
            .and_then(|c| c.rsplit(['/', '\\']).find(|s| !s.is_empty()));
        return folder.map_or_else(|| "Code".to_string(), one_line);
    }
    let first = text.lines().map(str::trim).find(|l| !l.is_empty());
    first.map_or_else(|| "Chat".to_string(), one_line)
}

/// One line, at most TITLE_CHARS characters.
fn one_line(s: &str) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= TITLE_CHARS {
        return s;
    }
    let cut: String = s.chars().take(TITLE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// A Live Activity button's answer, as the host's `/kleio/live-activity/answer`
/// takes it. Only well-formed input goes out: it is the app's own intent, but
/// iOS hands its parameters over as data.
pub fn answer_body(json: &str) -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let conversation = v.get("conversation")?.as_str()?;
    let ask_id = v.get("askId")?.as_str()?;
    let key = v.get("key")?.as_str()?;
    let choice = v.get("choice")?.as_u64()?;
    let ask_ok = ask_id
        .strip_prefix("ask-")
        .is_some_and(|n| (1..=9).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_digit()));
    let key_ok =
        key.len() == 32 && key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if !ask_ok || !key_ok || choice > 7 {
        return None;
    }
    let mut body = serde_json::json!({ "askId": ask_id, "key": key, "choice": choice });
    match conversation.split_once(':') {
        Some(("s", id)) if safe_session(id) => body["sessionId"] = id.into(),
        Some(("g", id)) if safe_session(id) => body["groupId"] = id.into(),
        _ => return None,
    }
    Some(body)
}

/// What a tapped activity opens: `kleio://open?session=<id>` or `?group=<id>`.
/// Other kleio:// links (an app connection finishing) just bring the app up.
pub fn tap_from_url(url: &str) -> Option<NotificationTap> {
    let query = url.strip_prefix("kleio://open?")?;
    let mut tap = NotificationTap {
        session_id: None,
        group_id: None,
    };
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        if !safe_session(value) {
            return None;
        }
        match key {
            "session" => tap.session_id = Some(value.to_string()),
            "group" => tap.group_id = Some(value.to_string()),
            _ => {}
        }
    }
    (tap.session_id.is_some() || tap.group_id.is_some()).then_some(tap)
}

// ---------------------------------------------------------------- iPhone only

#[cfg(target_os = "ios")]
mod ios {
    use std::ffi::{c_char, CStr, CString};
    use std::sync::OnceLock;

    use tauri::{AppHandle, Emitter, Manager};

    use super::{parse_report, registration, LiveTokens, Report};
    use crate::kleio::push::{ApnsEnv, PendingTap};

    type ReportFn = extern "C" fn(*const c_char);

    /// Swift's entry points, handed over by main.mm before the app starts.
    struct Swift {
        begin: extern "C" fn(ReportFn),
        start: extern "C" fn(*const c_char),
    }

    static SWIFT: OnceLock<Swift> = OnceLock::new();
    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// main.mm: `kleio_live_install(kleio_live_begin, kleio_live_start)`.
    #[no_mangle]
    pub extern "C" fn kleio_live_install(
        begin: extern "C" fn(ReportFn),
        start: extern "C" fn(*const c_char),
    ) {
        let _ = SWIFT.set(Swift { begin, start });
    }

    /// Start collecting tokens. Call from Tauri's `setup`.
    pub fn begin(app: &AppHandle) {
        let _ = APP.set(app.clone());
        match SWIFT.get() {
            Some(swift) => (swift.begin)(on_report),
            None => log::warn!("kleio: Live Activities are not wired up in this build"),
        }
    }

    /// Show a Live Activity for a conversation (`json`: see `start_request`).
    pub fn start(json: &str) {
        let (Some(swift), Ok(json)) = (SWIFT.get(), CString::new(json)) else {
            return;
        };
        (swift.start)(json.as_ptr());
    }

    /// Swift reports a token, on any thread.
    extern "C" fn on_report(json: *const c_char) {
        if json.is_null() {
            return;
        }
        // SAFETY: Swift passes a NUL-terminated UTF-8 string that lives for
        // the call; it is copied before returning.
        let json = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
        // Nothing may unwind into Swift.
        let _ = std::panic::catch_unwind(|| {
            let Some(report) = parse_report(&json) else {
                log::warn!("kleio: ignored a Live Activity report");
                return;
            };
            let Some(app) = APP.get() else {
                return;
            };
            log::info!(
                "kleio: Live Activity token kind={}",
                match report {
                    Report::Start { .. } => "start",
                    Report::Activity { .. } => "activity",
                }
            );
            app.state::<LiveTokens>().set(report);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                register_due(&app.state::<LiveTokens>()).await;
            });
        });
    }

    /// Which push service this build's tokens belong to.
    fn env() -> Option<ApnsEnv> {
        crate::kleio::phone::build_env()
    }

    /// Register every token the host does not have yet.
    pub async fn register_due(tokens: &LiveTokens) {
        let Some(env) = env() else {
            return;
        };
        for report in tokens.unregistered() {
            match register_with_host(&report, env).await {
                Ok(()) => tokens.registered(&report),
                Err(e) => log::warn!("kleio: could not register a Live Activity token: {e}"),
            }
        }
    }

    async fn register_with_host(report: &Report, env: ApnsEnv) -> Result<(), String> {
        let remote = crate::kleio::remote().ok_or("not paired with a Kleio host")?;
        let (path, body) = registration(report, env);
        let started = std::time::Instant::now();
        let res = crate::kleio::commands::api_client(remote)?
            .post(format!("{}{path}", remote.base))
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status();
        log::info!(
            "kleio: Live Activity token registered path={path} status={} elapsed_ms={}",
            status.as_u16(),
            started.elapsed().as_millis()
        );
        if status.is_success() {
            Ok(())
        } else {
            Err(format!("the host answered {status}"))
        }
    }

    /// AnswerQuestionIntent (Swift, KleioAnswer.swift): a Live Activity button
    /// was tapped. Sends the answer to the host and blocks until it replies;
    /// returns the HTTP status, or a negative number when nothing was sent.
    /// iOS may have launched the app in the background just for this.
    #[no_mangle]
    pub extern "C" fn kleio_live_answer(json: *const c_char) -> i32 {
        if json.is_null() {
            return -1;
        }
        // SAFETY: Swift passes a NUL-terminated string that lives for the call.
        let json = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
        // Nothing may unwind into Swift.
        std::panic::catch_unwind(|| {
            let Some(body) = super::answer_body(&json) else {
                log::warn!("kleio: ignored a malformed Live Activity answer");
                return -2;
            };
            tauri::async_runtime::block_on(send_answer(body))
        })
        .unwrap_or(-3)
    }

    async fn send_answer(body: serde_json::Value) -> i32 {
        // Read the pairing now if this launch hasn't (a launch while locked
        // can't read the Keychain; the intent runs once the phone is unlocked).
        let fresh;
        let remote = match crate::kleio::remote() {
            Some(r) => r,
            None => match crate::kleio::remote_now() {
                Some(r) => {
                    fresh = r;
                    &fresh
                }
                None => {
                    log::warn!("kleio: Live Activity answer: not paired with a Kleio host");
                    return -4;
                }
            },
        };
        crate::install_rustls_provider();
        let started = std::time::Instant::now();
        let client = match crate::kleio::commands::answer_client(remote) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("kleio: Live Activity answer: {e}");
                return -5;
            }
        };
        let res = client
            .post(format!("{}/kleio/live-activity/answer", remote.base))
            .json(&body)
            .send()
            .await;
        match res {
            Ok(r) => {
                let status = r.status().as_u16();
                log::info!(
                    "kleio: Live Activity answer status={status} elapsed_ms={}",
                    started.elapsed().as_millis()
                );
                i32::from(status)
            }
            Err(e) => {
                log::warn!("kleio: Live Activity answer failed: {e}");
                -6
            }
        }
    }

    /// A tapped activity opens its conversation, like a tapped notification.
    pub fn open_url(app: &AppHandle, url: &str) {
        let Some(tap) = super::tap_from_url(url) else {
            return;
        };
        log::info!(
            "kleio: Live Activity tapped session={} group={}",
            tap.session_id.is_some(),
            tap.group_id.is_some()
        );
        app.state::<PendingTap>().set(tap);
        let _ = app.emit("kleio-notification-tap", ());
    }
}

#[cfg(target_os = "ios")]
pub use ios::{begin, open_url, register_due};

/// Show a Live Activity for a conversation (no-op off the iPhone).
pub fn start(kind: &str, title: &str, session_id: Option<&str>, group_id: Option<&str>) {
    match start_request(kind, title, session_id, group_id) {
        #[cfg(target_os = "ios")]
        Ok(json) => ios::start(&json),
        #[cfg(not(target_os = "ios"))]
        Ok(_) => {}
        Err(e) => log::warn!("kleio: no Live Activity: {e}"),
    }
}

/// The screen shows a Live Activity for the conversation it just sent to (a
/// specialist or a group; Chat and Code start theirs in `agent_prompt`).
#[tauri::command]
pub fn kleio_live_start(
    kind: String,
    title: String,
    session_id: Option<String>,
    group_id: Option<String>,
) -> Result<(), String> {
    let json = start_request(&kind, &title, session_id.as_deref(), group_id.as_deref())?;
    #[cfg(target_os = "ios")]
    ios::start(&json);
    #[cfg(not(target_os = "ios"))]
    let _ = json;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";

    #[test]
    fn reads_activity_and_start_tokens_from_swift() {
        let line =
            format!(r#"{{"type":"token","token":"{TOKEN}","sessionId":"0e1d8f2e-bdaf-4377"}}"#);
        assert_eq!(
            parse_report(&line),
            Some(Report::Activity {
                target: Target::Session("0e1d8f2e-bdaf-4377".into()),
                token: TOKEN.into()
            })
        );
        let line = format!(
            r#"{{"type":"token","token":"{TOKEN}","sessionId":"x","groupId":"g_0bc1704f"}}"#
        );
        assert_eq!(
            parse_report(&line),
            Some(Report::Activity {
                target: Target::Group("g_0bc1704f".into()),
                token: TOKEN.into()
            })
        );
        let line = format!(r#"{{"type":"startToken","token":"{TOKEN}"}}"#);
        assert_eq!(
            parse_report(&line),
            Some(Report::Start {
                token: TOKEN.into()
            })
        );
    }

    #[test]
    fn drops_reports_that_could_not_have_come_from_activitykit() {
        for line in [
            format!(r#"{{"type":"token","token":"{TOKEN}"}}"#), // no conversation
            format!(r#"{{"type":"token","token":"{TOKEN}","sessionId":"../../x"}}"#),
            r#"{"type":"startToken","token":"NOT-HEX"}"#.to_string(),
            r#"{"type":"startToken","token":"abcd"}"#.to_string(), // too short
            format!(r#"{{"type":"startToken","token":"{}"}}"#, "a".repeat(401)),
            format!(r#"{{"type":"other","token":"{TOKEN}"}}"#),
            "not json".to_string(),
        ] {
            assert_eq!(parse_report(&line), None, "{line}");
        }
    }

    #[test]
    fn registers_each_token_on_its_route() {
        let (path, body) = registration(
            &Report::Activity {
                target: Target::Group("g_0bc1704f".into()),
                token: TOKEN.into(),
            },
            ApnsEnv::Sandbox,
        );
        assert_eq!(path, "/kleio/live-activity");
        assert_eq!(
            body,
            serde_json::json!({ "token": TOKEN, "env": "sandbox", "groupId": "g_0bc1704f" })
        );
        let (path, body) = registration(
            &Report::Start {
                token: TOKEN.into(),
            },
            ApnsEnv::Production,
        );
        assert_eq!(path, "/kleio/live-activity/start-token");
        assert_eq!(
            body,
            serde_json::json!({ "token": TOKEN, "env": "production" })
        );
    }

    #[test]
    fn keeps_the_newest_token_per_activity_until_the_host_has_it() {
        let tokens = LiveTokens::default();
        let a = Report::Activity {
            target: Target::Session("s1".into()),
            token: "a".repeat(64),
        };
        let a2 = Report::Activity {
            target: Target::Session("s1".into()),
            token: "b".repeat(64),
        };
        let start = Report::Start {
            token: "c".repeat(64),
        };
        tokens.set(a.clone());
        tokens.set(start.clone());
        assert_eq!(tokens.unregistered(), vec![start.clone(), a.clone()]);
        tokens.registered(&a);
        tokens.set(a.clone()); // the same token again: still registered
        assert_eq!(tokens.unregistered(), vec![start.clone()]);
        tokens.set(a2.clone()); // a new token replaces it
        tokens.registered(&a); // a late answer for the old one changes nothing
        assert_eq!(tokens.unregistered(), vec![start, a2]);
    }

    #[test]
    fn a_start_names_one_conversation_and_a_short_one_line_title() {
        let json = start_request(
            "specialist",
            "  Research\n  assistant  ",
            Some("sess-1"),
            None,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&json).unwrap(),
            serde_json::json!({
                "kind": "specialist",
                "title": "Research assistant",
                "sessionId": "sess-1",
                "groupId": null
            })
        );
        assert!(start_request("robot", "x", Some("s"), None).is_err());
        assert!(start_request("group", "x", None, None).is_err());
        assert!(start_request("group", "x", None, Some("g/../x")).is_err());
    }

    #[test]
    fn names_a_project_by_its_folder_and_a_chat_by_its_first_line() {
        assert_eq!(
            prompt_title(false, Some("/Users/me/gg-framework/"), "fix it"),
            "gg-framework"
        );
        assert_eq!(
            prompt_title(false, Some(crate::kleio::HOST_DEFAULT_CWD), "x"),
            "Code"
        );
        assert_eq!(
            prompt_title(true, None, "\n  Plan my week \nwith details"),
            "Plan my week"
        );
        assert_eq!(prompt_title(true, None, "   "), "Chat");
        let long = prompt_title(true, None, &"word ".repeat(30));
        assert_eq!(long.chars().count(), TITLE_CHARS);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn a_tapped_activity_opens_its_conversation() {
        assert_eq!(
            tap_from_url("kleio://open?session=0e1d8f2e-bdaf"),
            Some(NotificationTap {
                session_id: Some("0e1d8f2e-bdaf".into()),
                group_id: None
            })
        );
        assert_eq!(
            tap_from_url("kleio://open?group=g_0bc1704f"),
            Some(NotificationTap {
                session_id: None,
                group_id: Some("g_0bc1704f".into())
            })
        );
        assert_eq!(tap_from_url("kleio://connections?status=success"), None);
        assert_eq!(tap_from_url("kleio://open?session=..%2Fx"), None);
        assert_eq!(tap_from_url("kleio://open?"), None);
        assert_eq!(tap_from_url("https://open?session=abc"), None);
    }

    #[test]
    fn a_buttons_answer_goes_to_the_host_as_its_conversation() {
        let key = "0123456789abcdef0123456789abcdef";
        let ask = |conversation: &str, ask_id: &str, key: &str, choice: i64| {
            answer_body(
                &serde_json::json!({
                    "conversation": conversation, "askId": ask_id, "key": key, "choice": choice
                })
                .to_string(),
            )
        };
        assert_eq!(
            ask("s:774bea52-7852-48ee", "ask-1", key, 1),
            Some(serde_json::json!({
                "sessionId": "774bea52-7852-48ee", "askId": "ask-1", "key": key, "choice": 1
            }))
        );
        assert_eq!(
            ask("g:g_c6b8e35f", "ask-12", key, 0),
            Some(serde_json::json!({
                "groupId": "g_c6b8e35f", "askId": "ask-12", "key": key, "choice": 0
            }))
        );
        // Anything that couldn't have come from the activity stays on the phone.
        assert_eq!(ask("x:abc", "ask-1", key, 0), None);
        assert_eq!(ask("s:../x", "ask-1", key, 0), None);
        assert_eq!(ask("s:abc", "ask-", key, 0), None);
        assert_eq!(ask("s:abc", "q1", key, 0), None);
        assert_eq!(ask("s:abc", "ask-1", "ABCDEF", 0), None);
        assert_eq!(ask("s:abc", "ask-1", key, 8), None);
        assert_eq!(ask("s:abc", "ask-1", key, -1), None);
        assert_eq!(answer_body("not json"), None);
    }
}
