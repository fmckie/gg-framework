//! iPhone: chats whose reply was still running when the person switched to
//! another chat. A phone is used in short hops — send a task, check another
//! chat, come back — so instead of disposing the old session (which throws the
//! reply in progress away), the app parks it on the host until the reply
//! finishes, and reopening that chat re-attaches to the live reply.
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

/// What the host says about a session, from its `GET /state`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Run {
    /// A reply is running; `path` is the chat's session file.
    Running { path: String },
    /// Nothing running (or nothing a person could reopen): safe to dispose.
    Idle,
    /// The host no longer has this session.
    Gone,
    /// The host could not be asked (network, a non-JSON answer).
    Unknown,
}

/// Read `GET /state`'s body. Only a session with a file can be reopened from
/// the chat list, so a running session without one is not worth keeping.
pub fn classify(state: &serde_json::Value) -> Run {
    let running = state.get("running").and_then(|v| v.as_bool()) == Some(true);
    let path = state
        .get("sessionPath")
        .and_then(|v| v.as_str())
        .filter(|p| !p.is_empty());
    match (running, path) {
        (true, Some(path)) => Run::Running {
            path: path.to_string(),
        },
        _ => Run::Idle,
    }
}

/// Parked sessions by chat session file → host session id.
pub struct Parked {
    file: Option<PathBuf>,
    map: Mutex<BTreeMap<String, String>>,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct OnDisk {
    #[serde(default)]
    sessions: BTreeMap<String, String>,
}

pub fn path(home: &Path) -> PathBuf {
    super::state_dir(home).join("parked.json")
}

impl Parked {
    /// Load what an earlier launch left parked. A missing or unreadable file
    /// is an empty list: the worst case is a session the host keeps until it
    /// restarts, never a lost chat (every finished message is in its file).
    pub fn load(file: PathBuf) -> Self {
        let sessions = std::fs::read_to_string(&file)
            .ok()
            .and_then(|raw| serde_json::from_str::<OnDisk>(&raw).ok())
            .unwrap_or_default()
            .sessions;
        Self {
            file: Some(file),
            map: Mutex::new(sessions),
        }
    }

    /// Keep `id` alive for the chat in `path`. A session already parked for
    /// the same chat is returned so the caller can dispose it.
    pub fn park(&self, path: String, id: String) -> Option<String> {
        let mut map = self.map.lock().unwrap();
        let previous = map.insert(path, id.clone()).filter(|old| *old != id);
        self.save(&map);
        previous
    }

    /// Take the session parked for this chat, if any: a window is reopening it.
    pub fn adopt(&self, path: &str) -> Option<String> {
        let mut map = self.map.lock().unwrap();
        let id = map.remove(path)?;
        self.save(&map);
        Some(id)
    }

    /// Whether `id` is still the session parked for `path`.
    pub fn holds(&self, path: &str, id: &str) -> bool {
        self.map.lock().unwrap().get(path).is_some_and(|v| v == id)
    }

    /// Forget `id` if it is still parked for `path`. `true` when it was — the
    /// caller then owns disposing it; `false` when a window adopted it first.
    pub fn release(&self, path: &str, id: &str) -> bool {
        let mut map = self.map.lock().unwrap();
        if map.get(path).is_some_and(|v| v == id) {
            map.remove(path);
            self.save(&map);
            true
        } else {
            false
        }
    }

    /// Everything parked, in a stable order (session file).
    pub fn snapshot(&self) -> Vec<(String, String)> {
        let map = self.map.lock().unwrap();
        map.iter().map(|(p, id)| (p.clone(), id.clone())).collect()
    }

    /// Write-then-rename so a crash mid-write never leaves a half file.
    fn save(&self, map: &BTreeMap<String, String>) {
        let Some(file) = &self.file else { return };
        let write = || -> Result<(), String> {
            let dir = file.parent().ok_or("no parent dir")?;
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            let tmp = dir.join(format!(".kleio-parked.{}.tmp", std::process::id()));
            let body = serde_json::to_string_pretty(&OnDisk {
                sessions: map.clone(),
            })
            .map_err(|e| e.to_string())?;
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

    #[test]
    fn only_a_running_chat_with_a_file_is_worth_keeping() {
        let running = serde_json::json!({ "running": true, "sessionPath": "/s/a.jsonl" });
        let no_file = serde_json::json!({ "running": true, "sessionPath": "" });
        let idle = serde_json::json!({ "running": false, "sessionPath": "/s/a.jsonl" });

        assert_eq!(
            classify(&running),
            Run::Running {
                path: "/s/a.jsonl".into()
            }
        );
        assert_eq!(classify(&no_file), Run::Idle);
        assert_eq!(classify(&idle), Run::Idle);
    }

    #[test]
    fn reopening_a_chat_takes_its_parked_session_once() {
        let parked = Parked::load(tmp_file());
        parked.park("/s/a.jsonl".into(), "sid-1".into());

        assert_eq!(parked.adopt("/s/a.jsonl").as_deref(), Some("sid-1"));
        assert_eq!(parked.adopt("/s/a.jsonl"), None);
    }

    #[test]
    fn a_finished_session_is_released_only_if_nobody_reopened_it() {
        let parked = Parked::load(tmp_file());
        parked.park("/s/a.jsonl".into(), "sid-1".into());
        parked.adopt("/s/a.jsonl");

        assert!(!parked.release("/s/a.jsonl", "sid-1"));
    }

    #[test]
    fn parking_a_newer_session_for_the_same_chat_hands_back_the_older() {
        let parked = Parked::load(tmp_file());
        parked.park("/s/a.jsonl".into(), "sid-1".into());

        let older = parked.park("/s/a.jsonl".into(), "sid-2".into());

        assert_eq!(older.as_deref(), Some("sid-1"));
        assert!(parked.holds("/s/a.jsonl", "sid-2"));
    }

    #[test]
    fn a_later_launch_remembers_what_was_parked() {
        let file = tmp_file();
        Parked::load(file.clone()).park("/s/a.jsonl".into(), "sid-1".into());

        let again = Parked::load(file.clone());

        assert_eq!(
            again.snapshot(),
            vec![("/s/a.jsonl".to_string(), "sid-1".to_string())]
        );
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
