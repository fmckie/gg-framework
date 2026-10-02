//! iPhone: chats whose reply was still running when the person switched to
//! another chat. A phone is used in short hops — send a task, check another
//! chat, come back — so instead of disposing the old session (which throws the
//! reply in progress away), the app parks it on the host until the reply
//! finishes, and reopening that chat re-attaches to the live reply.
//!
//! It also remembers where each chat the phone closed lives (folder, file,
//! mode), parked or not, so a notification about its reply can reopen it
//! after its session was disposed. The host only knows live sessions.
//!
//! Remembered in `parked.json` next to `remote.json`, so a launch after iOS
//! closed the app mid-reply can still tidy those sessions up on the host.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// How often a parked session is checked for having finished.
pub const POLL: Duration = Duration::from_secs(10);

/// A parked session the host cannot be reached about for this long is let go
/// (a best-effort dispose is still sent).
pub const GIVE_UP: Duration = Duration::from_secs(12 * 60 * 60);

/// How many closed chats are remembered for reopening from a notification.
/// Only the latest few can have a notification still on screen.
pub const REMEMBERED_CHATS: usize = 32;

/// Where a chat lives: what the app needs to reopen it (`select_project`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTarget {
    pub cwd: String,
    pub session_path: String,
    /// `chat`, `code` or `motion` (the webview's `WorkspaceMode`).
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_agent: Option<String>,
}

/// The chat a session belongs to, read from the host's `GET /state`. `None`
/// when it has no file yet (a new chat before its first reply) or the answer
/// lacks something a reopen needs.
pub fn chat_target(state: &serde_json::Value) -> Option<ChatTarget> {
    let text = |key: &str| {
        state
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    let mode = text("mode").filter(|m| matches!(*m, "chat" | "code" | "motion"))?;
    Some(ChatTarget {
        cwd: text("cwd")?.to_string(),
        session_path: text("sessionPath")?.to_string(),
        mode: mode.to_string(),
        chat_agent: text("chatAgent").map(str::to_string),
    })
}

/// What the host says about a session, from its `GET /state`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Run {
    /// A reply is running in this chat.
    Running(ChatTarget),
    /// Nothing running (or nothing a person could reopen): safe to dispose.
    /// Says where the chat lives when it has a file, so it can be remembered.
    Idle(Option<ChatTarget>),
    /// The host no longer has this session.
    Gone,
    /// The host could not be asked (network, a non-JSON answer).
    Unknown,
}

/// Read `GET /state`'s body. Only a chat that can be reopened from the chat
/// list (it has a file) is worth keeping alive.
pub fn classify(state: &serde_json::Value) -> Run {
    let running = state.get("running").and_then(|v| v.as_bool()) == Some(true);
    match (running, chat_target(state)) {
        (true, Some(chat)) => Run::Running(chat),
        (_, chat) => Run::Idle(chat),
    }
}

/// Parked sessions (chat session file → host session id), and where recently
/// closed chats live (host session id → chat).
pub struct Parked {
    file: Option<PathBuf>,
    state: Mutex<OnDisk>,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct OnDisk {
    #[serde(default)]
    sessions: BTreeMap<String, String>,
    /// Newest last, at most `REMEMBERED_CHATS`.
    #[serde(default)]
    chats: Vec<RememberedChat>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RememberedChat {
    session_id: String,
    #[serde(flatten)]
    chat: ChatTarget,
}

pub fn path(home: &Path) -> PathBuf {
    super::state_dir(home).join("parked.json")
}

/// Note where `id`'s chat lives, newest last, keeping the latest few.
fn note_chat(state: &mut OnDisk, chat: ChatTarget, id: String) {
    state.chats.retain(|c| c.session_id != id);
    state.chats.push(RememberedChat {
        session_id: id,
        chat,
    });
    let excess = state.chats.len().saturating_sub(REMEMBERED_CHATS);
    state.chats.drain(..excess);
}

impl Parked {
    /// Load what an earlier launch left parked. A missing or unreadable file
    /// is an empty list: the worst case is a session the host keeps until it
    /// restarts, never a lost chat (every finished message is in its file).
    pub fn load(file: PathBuf) -> Self {
        let state = std::fs::read_to_string(&file)
            .ok()
            .and_then(|raw| serde_json::from_str::<OnDisk>(&raw).ok())
            .unwrap_or_default();
        Self {
            file: Some(file),
            state: Mutex::new(state),
        }
    }

    /// Keep `id` alive for this chat, and remember where the chat lives. A
    /// session already parked for the same chat is returned so the caller can
    /// dispose it.
    pub fn park(&self, chat: ChatTarget, id: String) -> Option<String> {
        let mut state = self.state.lock().unwrap();
        let previous = state
            .sessions
            .insert(chat.session_path.clone(), id.clone())
            .filter(|old| *old != id);
        note_chat(&mut state, chat, id);
        self.save(&state);
        previous
    }

    /// Remember where the chat of a session being disposed lives, so a
    /// notification about its last reply can still reopen it.
    pub fn remember(&self, chat: ChatTarget, id: String) {
        let mut state = self.state.lock().unwrap();
        note_chat(&mut state, chat, id);
        self.save(&state);
    }

    /// Take the session parked for this chat, if any: a window is reopening it.
    pub fn adopt(&self, path: &str) -> Option<String> {
        let mut state = self.state.lock().unwrap();
        let id = state.sessions.remove(path)?;
        self.save(&state);
        Some(id)
    }

    /// Whether `id` is still the session parked for `path`.
    pub fn holds(&self, path: &str, id: &str) -> bool {
        let state = self.state.lock().unwrap();
        state.sessions.get(path).is_some_and(|v| v == id)
    }

    /// Forget `id` if it is still parked for `path`. `true` when it was — the
    /// caller then owns disposing it; `false` when a window adopted it first.
    /// Where the chat lives is still remembered, for a notification about it.
    pub fn release(&self, path: &str, id: &str) -> bool {
        let mut state = self.state.lock().unwrap();
        if state.sessions.get(path).is_some_and(|v| v == id) {
            state.sessions.remove(path);
            self.save(&state);
            true
        } else {
            false
        }
    }

    /// Where the chat of a recently closed session lives.
    pub fn chat_for(&self, id: &str) -> Option<ChatTarget> {
        let state = self.state.lock().unwrap();
        state
            .chats
            .iter()
            .rev()
            .find(|c| c.session_id == id)
            .map(|c| c.chat.clone())
    }

    /// Everything parked, in a stable order (session file).
    pub fn snapshot(&self) -> Vec<(String, String)> {
        let state = self.state.lock().unwrap();
        state
            .sessions
            .iter()
            .map(|(p, id)| (p.clone(), id.clone()))
            .collect()
    }

    /// Write-then-rename so a crash mid-write never leaves a half file.
    fn save(&self, state: &OnDisk) {
        let Some(file) = &self.file else { return };
        let write = || -> Result<(), String> {
            let dir = file.parent().ok_or("no parent dir")?;
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            let tmp = dir.join(format!(".kleio-parked.{}.tmp", std::process::id()));
            let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
            std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, file).map_err(|e| {
                let _ = std::fs::remove_file(&tmp);
                e.to_string()
            })
        };
        if let Err(e) = write() {
            log::warn!("kleio: could not save parked sessions: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file() -> PathBuf {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::env::temp_dir()
            .join(format!("kleio-parked-test-{}-{n}", std::process::id()))
            .join("parked.json")
    }

    fn chat(path: &str) -> ChatTarget {
        ChatTarget {
            cwd: "/work".into(),
            session_path: path.into(),
            mode: "chat".into(),
            chat_agent: Some("general".into()),
        }
    }

    fn state(running: bool, path: &str) -> serde_json::Value {
        serde_json::json!({
            "running": running,
            "sessionPath": path,
            "cwd": "/work",
            "mode": "chat",
            "chatAgent": "general",
        })
    }

    #[test]
    fn only_a_running_chat_with_a_file_is_worth_keeping() {
        assert_eq!(
            classify(&state(true, "/s/a.jsonl")),
            Run::Running(chat("/s/a.jsonl"))
        );
        assert_eq!(classify(&state(true, "")), Run::Idle(None));
        assert_eq!(
            classify(&state(false, "/s/a.jsonl")),
            Run::Idle(Some(chat("/s/a.jsonl"))),
            "a finished chat still says where it lives"
        );
    }

    #[test]
    fn a_chat_is_reopenable_only_with_a_folder_a_file_and_a_known_mode() {
        let mut no_folder = state(true, "/s/a.jsonl");
        no_folder["cwd"] = serde_json::json!("");
        let mut odd_mode = state(true, "/s/a.jsonl");
        odd_mode["mode"] = serde_json::json!("weird");
        let mut no_agent = state(true, "/s/a.jsonl");
        no_agent.as_object_mut().map(|o| o.remove("chatAgent"));

        assert_eq!(chat_target(&no_folder), None);
        assert_eq!(chat_target(&odd_mode), None);
        assert_eq!(
            chat_target(&no_agent).and_then(|c| c.chat_agent),
            None,
            "the agent is optional"
        );
    }

    #[test]
    fn reopening_a_chat_takes_its_parked_session_once() {
        let parked = Parked::load(tmp_file());
        parked.park(chat("/s/a.jsonl"), "sid-1".into());

        assert_eq!(parked.adopt("/s/a.jsonl").as_deref(), Some("sid-1"));
        assert_eq!(parked.adopt("/s/a.jsonl"), None);
    }

    #[test]
    fn a_finished_session_is_released_only_if_nobody_reopened_it() {
        let parked = Parked::load(tmp_file());
        parked.park(chat("/s/a.jsonl"), "sid-1".into());
        parked.adopt("/s/a.jsonl");

        assert!(!parked.release("/s/a.jsonl", "sid-1"));
    }

    #[test]
    fn parking_a_newer_session_for_the_same_chat_hands_back_the_older() {
        let parked = Parked::load(tmp_file());
        parked.park(chat("/s/a.jsonl"), "sid-1".into());

        let older = parked.park(chat("/s/a.jsonl"), "sid-2".into());

        assert_eq!(older.as_deref(), Some("sid-1"));
        assert!(parked.holds("/s/a.jsonl", "sid-2"));
    }

    #[test]
    fn a_parked_chat_is_still_found_after_its_session_finished() {
        let parked = Parked::load(tmp_file());
        parked.park(chat("/s/a.jsonl"), "sid-1".into());

        parked.release("/s/a.jsonl", "sid-1");

        assert_eq!(parked.chat_for("sid-1"), Some(chat("/s/a.jsonl")));
        assert_eq!(parked.chat_for("sid-unknown"), None);
    }

    #[test]
    fn a_chat_closed_after_its_reply_is_found_without_being_kept_alive() {
        let parked = Parked::load(tmp_file());

        parked.remember(chat("/s/a.jsonl"), "sid-1".into());

        assert_eq!(parked.chat_for("sid-1"), Some(chat("/s/a.jsonl")));
        assert!(parked.snapshot().is_empty(), "nothing is parked");
        assert_eq!(parked.adopt("/s/a.jsonl"), None);
    }

    #[test]
    fn only_the_newest_chats_are_remembered() {
        let parked = Parked::load(tmp_file());
        for n in 0..=REMEMBERED_CHATS {
            parked.park(chat(&format!("/s/{n}.jsonl")), format!("sid-{n}"));
        }

        assert_eq!(parked.chat_for("sid-0"), None);
        assert_eq!(
            parked.chat_for(&format!("sid-{REMEMBERED_CHATS}")),
            Some(chat(&format!("/s/{REMEMBERED_CHATS}.jsonl")))
        );
    }

    #[test]
    fn a_later_launch_remembers_what_was_parked() {
        let file = tmp_file();
        Parked::load(file.clone()).park(chat("/s/a.jsonl"), "sid-1".into());

        let again = Parked::load(file.clone());

        assert_eq!(
            again.snapshot(),
            vec![("/s/a.jsonl".to_string(), "sid-1".to_string())]
        );
        assert_eq!(again.chat_for("sid-1"), Some(chat("/s/a.jsonl")));
        let _ = std::fs::remove_dir_all(file.parent().unwrap_or(&file));
    }

    #[test]
    fn a_file_from_before_chats_were_remembered_still_loads() {
        let file = tmp_file();
        std::fs::create_dir_all(file.parent().unwrap_or(&file)).unwrap();
        std::fs::write(&file, r#"{ "sessions": { "/s/a.jsonl": "sid-1" } }"#).unwrap();

        let parked = Parked::load(file.clone());

        assert_eq!(
            parked.snapshot(),
            vec![("/s/a.jsonl".to_string(), "sid-1".to_string())]
        );
        assert_eq!(parked.chat_for("sid-1"), None);
        let _ = std::fs::remove_dir_all(file.parent().unwrap_or(&file));
    }

    #[test]
    fn an_unreadable_file_means_nothing_parked() {
        let file = tmp_file();
        std::fs::create_dir_all(file.parent().unwrap_or(&file)).unwrap();
        std::fs::write(&file, "not json").unwrap();

        assert!(Parked::load(file.clone()).snapshot().is_empty());
        let _ = std::fs::remove_dir_all(file.parent().unwrap_or(&file));
    }
}
