//! Kleio — remote host support for gg-app.
//!
//! Everything Kleio-specific on the Rust side lives in this directory. `lib.rs`
//! touches it at three points only: `sidecar_base`, the shared client's default
//! headers, and the daemon spawn / SSE-bridge branch. Upstream sync stays a merge.
//!
//! Activation, in priority order, decided once at boot:
//!   1. Environment (dev override): KLEIO_HOST_URL + KLEIO_DEVICE_TOKEN.
//!   2. A paired host: `~/.kleio/remote.json` (`store.rs`) plus the device
//!      token from the login Keychain (`keychain.rs`). Pairing happens in the
//!      app (`commands.rs`) and takes effect on the next launch — except on
//!      the iPhone, which cannot relaunch itself: there a first pairing
//!      switches on in place (`activate_paired`), once, never host-to-host.
//!   3. Neither → normal local sidecar. Nothing below is touched.
//! When remote, no local sidecar is spawned; every sidecar call goes to the
//! host, authenticated with `x-kleio-device-token` (and `x-kleio-control` for
//! admin devices); the SSE bridge resumes with `Last-Event-ID`.

pub mod biometric;
pub mod commands;
pub mod files;
pub use commands::host_auth;
pub mod keychain;
pub mod parked;
#[cfg(target_os = "ios")]
pub mod phone;
pub mod radio;
pub mod store;
pub mod tailscale;

use std::sync::{Once, OnceLock};

pub struct Remote {
    /// Base URL without trailing slash, e.g. `https://host:8443`.
    pub base: String,
    /// Tailnet host name as the host reports it.
    pub host: String,
    pub device_id: String,
    pub label: String,
    pub device_token: String,
    /// Control macaroon, present only for admin devices.
    pub control_credential: Option<String>,
    pub admin: bool,
}

static REMOTE: OnceLock<Remote> = OnceLock::new();
static BOOT: Once = Once::new();

/// Decided once per process at boot. `None` = not paired (Kleio shows its
/// connect screen). Once `Some`, it never changes for the life of the process.
pub fn remote() -> Option<&'static Remote> {
    BOOT.call_once(|| {
        if let Some(r) = from_env().or_else(from_store) {
            let _ = REMOTE.set(r);
        }
    });
    REMOTE.get()
}

/// iPhone only: a phone app cannot relaunch to pick up a fresh pairing, so the
/// pairing just saved by `kleio_pair` switches on in place. Only ever goes
/// from "not paired" to "paired"; an already-active host is returned as is.
#[cfg(mobile)]
pub fn activate_paired() -> Option<&'static Remote> {
    if let Some(r) = remote() {
        return Some(r);
    }
    let r = from_store()?;
    let _ = REMOTE.set(r);
    REMOTE.get()
}

fn from_env() -> Option<Remote> {
    let base = std::env::var("KLEIO_HOST_URL").ok()?;
    let device_token = std::env::var("KLEIO_DEVICE_TOKEN").ok()?;
    let base = base.trim_end_matches('/').to_string();
    if !(base.starts_with("https://") || base.starts_with("http://127.0.0.1"))
        || device_token.len() < 32
    {
        log::warn!(
            "kleio: KLEIO_HOST_URL must be https (or loopback) and the token >= 32 chars; ignoring"
        );
        return None;
    }
    log::info!("kleio: remote host mode (env) → {base}");
    let host = base
        .split("//")
        .nth(1)
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_string();
    Some(Remote {
        base,
        host,
        device_id: String::new(),
        label: String::from("env"),
        device_token,
        control_credential: std::env::var("KLEIO_CONTROL_CREDENTIAL").ok(),
        admin: false,
    })
}

fn from_store() -> Option<Remote> {
    let rec = store::load(&crate::home_dir())?;
    let device_token = match keychain::get(&rec.host, keychain::Secret::DeviceToken) {
        Ok(Some(t)) => t,
        Ok(None) => {
            log::warn!(
                "kleio: paired to {} but its token is not in the Keychain; staying local",
                rec.host
            );
            return None;
        }
        Err(e) => {
            log::warn!("kleio: {e}; staying local");
            return None;
        }
    };
    let control_credential = if rec.admin {
        keychain::get(&rec.host, keychain::Secret::ControlCredential)
            .ok()
            .flatten()
    } else {
        None
    };
    log::info!("kleio: remote host mode → {} ({})", rec.base_url, rec.label);
    Some(Remote {
        base: rec.base_url,
        host: rec.host,
        device_id: rec.device_id,
        label: rec.label,
        device_token,
        admin: rec.admin,
        control_credential,
    })
}

/// What the webview sees. `active` is what THIS process booted with; `paired`
/// is what is on disk now — they differ between pairing/forgetting and the
/// restart that applies it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub active: Option<ActiveRemote>,
    pub paired: Option<store::HostRecord>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRemote {
    pub base: String,
    pub host: String,
    pub device_id: String,
    pub label: String,
    pub admin: bool,
}

#[tauri::command]
pub fn kleio_remote_status() -> RemoteStatus {
    RemoteStatus {
        active: remote().map(|r| ActiveRemote {
            base: r.base.clone(),
            host: r.host.clone(),
            device_id: r.device_id.clone(),
            label: r.label.clone(),
            admin: r.admin,
        }),
        paired: store::load(&crate::home_dir()),
    }
}

/// Header the Kleio host checks instead of the sidecar's `x-gg-token`.
pub const DEVICE_TOKEN_HEADER: &str = "x-kleio-device-token";
/// Control macaroon header; admin routes accept it as an alternative to the
/// device's own admin flag.
pub const CONTROL_HEADER: &str = "x-kleio-control";

/// Port placeholder reported to the webview when remote. The frontend only uses
/// the port as a readiness signal and passes it back to Rust commands.
pub const REMOTE_PORT_SENTINEL: u16 = 1;

/// Kleio's own local state directory (`~/.kleio`). The desktop app keeps its
/// few local files here and never in `~/.gg`, which belongs to GG Coder and the
/// `ggcoder` CLI on the same Mac. Everything else lives on the Kleio host.
///
/// On the iPhone `home` is the app's sandbox container, whose root is not
/// writable; `Library/Application Support` is the private, backed-up place for
/// app files there.
pub fn state_dir(home: &std::path::Path) -> std::path::PathBuf {
    if cfg!(target_os = "ios") {
        home.join("Library/Application Support/kleio")
    } else {
        home.join(".kleio")
    }
}

/// Kleio Desktop is a client of the Kleio host and nothing else: it never
/// spawns a local engine (sidecar), never sweeps sidecar processes (those on
/// this Mac belong to GG Coder), and shows a connect screen until paired.
pub const REMOTE_ONLY: bool = true;

/// Parse the `id:` line from one SSE frame, if any.
pub fn sse_frame_id(frame: &str) -> Option<u64> {
    frame
        .lines()
        .find_map(|l| l.strip_prefix("id: ").or_else(|| l.strip_prefix("id:")))
        .and_then(|v| v.trim().parse().ok())
}

/// The host writes `: ping` on every event stream each 15 s, so this long with
/// no byte at all means the connection is dead even if the socket looks open
/// (an iPhone that slept, a dropped Wi-Fi, a Tailscale re-route).
pub const STREAM_IDLE: std::time::Duration = std::time::Duration::from_secs(45);

/// "The app is back on screen" (iPhone: `WindowEvent::Resumed`). iOS freezes a
/// backgrounded app's sockets, so a stream that looks open on return is usually
/// dead. Firing this makes every event bridge drop its connection and resume at
/// once from `Last-Event-ID` (the host replays what was missed) instead of
/// waiting out `STREAM_IDLE`.
pub struct Resume(tokio::sync::watch::Sender<u64>);

impl Default for Resume {
    fn default() -> Self {
        Self(tokio::sync::watch::channel(0).0)
    }
}

impl Resume {
    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<u64> {
        self.0.subscribe()
    }

    /// Fired by the iPhone's `WindowEvent::Resumed`; desktop never suspends.
    #[cfg_attr(desktop, allow(dead_code))]
    pub fn fire(&self) {
        self.0.send_modify(|n| *n = n.wrapping_add(1));
    }
}

/// Which event bridge currently speaks for each window. A bridge used to
/// retire once its window moved to another session, but on the iPhone a
/// window can come BACK to a session it had (reopening a parked chat): an old
/// bridge that was idle through the switch would then pass that check again
/// and deliver every event twice. Each new bridge takes the next number for
/// its window, and only the newest one delivers.
#[derive(Default)]
pub struct BridgeEpochs(std::sync::Mutex<std::collections::HashMap<String, u64>>);

impl BridgeEpochs {
    /// A new bridge takes over `label`; any older one retires at its next check.
    pub fn begin(&self, label: &str) -> u64 {
        let mut map = self.0.lock().unwrap();
        let next = map.get(label).copied().unwrap_or(0).wrapping_add(1);
        map.insert(label.to_string(), next);
        next
    }

    /// Whether the bridge that took `epoch` still speaks for `label`.
    pub fn is_current(&self, label: &str, epoch: u64) -> bool {
        self.0.lock().unwrap().get(label) == Some(&epoch)
    }
}

/// What woke an event bridge that was waiting for its next network chunk.
#[derive(Debug, PartialEq)]
pub enum Wake<T> {
    /// The stream produced an item, or ended (`None`).
    Chunk(Option<T>),
    /// Nothing at all, not even a ping, for the idle limit.
    Idle,
    /// The app came back to the foreground (`Resume::fire`).
    Resumed,
}

/// Wait for the next chunk, the resume signal, or (when `idle` is set) that
/// long without any chunk — whichever comes first.
pub async fn next_chunk<S>(
    stream: &mut S,
    resume: &mut tokio::sync::watch::Receiver<u64>,
    idle: Option<std::time::Duration>,
) -> Wake<S::Item>
where
    S: futures_util::Stream + Unpin,
{
    use futures_util::future::{select, Either};
    use futures_util::StreamExt;
    let race = async {
        let next = stream.next();
        let changed = resume.changed();
        futures_util::pin_mut!(next, changed);
        match select(next, changed).await {
            Either::Left((item, _)) => Wake::Chunk(item),
            Either::Right((Ok(()), _)) => Wake::Resumed,
            // The signal's owner is gone (app shutting down): just read on.
            Either::Right((Err(_), next)) => Wake::Chunk(next.await),
        }
    };
    match idle {
        None => race.await,
        Some(limit) => tokio::time::timeout(limit, race)
            .await
            .unwrap_or(Wake::Idle),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn only_the_newest_bridge_for_a_window_delivers() {
        let epochs = BridgeEpochs::default();
        let first = epochs.begin("main");

        let second = epochs.begin("main");

        assert!(!epochs.is_current("main", first));
        assert!(epochs.is_current("main", second));
    }

    #[test]
    fn windows_take_over_their_bridges_independently() {
        let epochs = BridgeEpochs::default();
        let main = epochs.begin("main");

        epochs.begin("project-2");

        assert!(epochs.is_current("main", main));
    }

    #[test]
    fn a_chunk_wakes_the_bridge() {
        let resume = Resume::default();
        let mut rx = resume.subscribe();
        let mut stream = futures_util::stream::iter([7u8]);
        let woke = block_on(next_chunk(&mut stream, &mut rx, None));
        assert_eq!(woke, Wake::Chunk(Some(7)));
        let woke = block_on(next_chunk(&mut stream, &mut rx, None));
        assert_eq!(woke, Wake::Chunk(None));
    }

    #[test]
    fn resuming_the_app_wakes_a_bridge_waiting_on_a_silent_stream() {
        let resume = Resume::default();
        let mut rx = resume.subscribe();
        let mut silent = futures_util::stream::pending::<u8>();
        resume.fire();
        let woke = block_on(next_chunk(&mut silent, &mut rx, None));
        assert_eq!(woke, Wake::Resumed);
    }

    #[test]
    fn a_silent_stream_goes_idle() {
        let resume = Resume::default();
        let mut rx = resume.subscribe();
        let mut silent = futures_util::stream::pending::<u8>();
        let limit = std::time::Duration::from_millis(30);
        let woke = block_on(next_chunk(&mut silent, &mut rx, Some(limit)));
        assert_eq!(woke, Wake::Idle);
    }

    #[test]
    fn kleio_state_is_never_gg_coders() {
        let dir = state_dir(std::path::Path::new("/Users/someone"));
        assert_eq!(dir, std::path::PathBuf::from("/Users/someone/.kleio"));
        assert!(REMOTE_ONLY);
    }

    #[test]
    fn parses_id_line() {
        assert_eq!(sse_frame_id("id: 42\ndata: {}"), Some(42));
        assert_eq!(sse_frame_id("data: {}"), None);
        assert_eq!(sse_frame_id("id:7\ndata: {}"), Some(7));
    }

    #[test]
    fn a_created_project_is_the_hosts_folder() {
        assert_eq!(
            created_project(200, r#"{"path":"/Users/me/kleio-projects/test"}"#),
            Ok(serde_json::json!({ "path": "/Users/me/kleio-projects/test" }))
        );
    }

    #[test]
    fn a_refused_project_shows_the_hosts_reason() {
        // A taken name is marked, so the dialog can offer to open that folder.
        assert_eq!(
            created_project(
                409,
                r#"{"error":"A folder named \"test\" already exists."}"#
            ),
            Err("exists:A folder named \"test\" already exists.".to_string())
        );
        assert_eq!(
            created_project(400, r#"{"error":"Project name must be lowercase."}"#),
            Err("Project name must be lowercase.".to_string())
        );
        assert_eq!(
            created_project(502, "<html>bad gateway</html>"),
            Err("Your Mac mini answered 502".to_string())
        );
    }

    #[test]
    fn a_created_project_needs_a_path() {
        for body in ["{}", r#"{"path":""}"#, r#"{"path":7}"#, "not json"] {
            assert!(created_project(200, body).is_err(), "{body}");
        }
    }
}

// ── Host-owned settings ─────────────────────────────────────────────────────
// The sidecar's /settings is the HOST's `~/.gg/gg-app.json`. Session-scoped
// like every other sidecar route; the managed client carries the device token.

/// Marker cwd for "let the host's sidecar pick": never sent on the wire.
pub const HOST_DEFAULT_CWD: &str = "kleio://host-default";

pub async fn host_settings(
    client: &reqwest::Client,
    base: &str,
    gg_sid: &str,
) -> Result<serde_json::Value, String> {
    let res = client
        .get(format!("{base}/settings"))
        .header("x-gg-session", gg_sid)
        .send()
        .await
        .map_err(|e| format!("host settings: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("host settings: HTTP {}", res.status()));
    }
    res.json().await.map_err(|e| format!("host settings: {e}"))
}

pub async fn host_settings_save(
    client: &reqwest::Client,
    base: &str,
    gg_sid: &str,
    projects_root: &str,
) -> Result<serde_json::Value, String> {
    let res = client
        .post(format!("{base}/settings"))
        .header("x-gg-session", gg_sid)
        .json(&serde_json::json!({ "projectsRoot": projects_root }))
        .send()
        .await
        .map_err(|e| format!("host settings: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("host settings: HTTP {}", res.status()));
    }
    res.json().await.map_err(|e| format!("host settings: {e}"))
}

/// Make a project folder in the HOST's projects root. The sidecar's
/// `/create-project` validates the name and refuses an existing folder, and
/// its `/projects` scan then lists the new one. Returns `{ path }`.
pub async fn host_create_project(
    client: &reqwest::Client,
    base: &str,
    gg_sid: &str,
    name: &str,
) -> Result<serde_json::Value, String> {
    let cant_reach =
        |e: reqwest::Error| format!("Couldn't reach your Mac mini: {}", commands::root_cause(&e));
    let res = client
        .post(format!("{base}/create-project"))
        .header("x-gg-session", gg_sid)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(cant_reach)?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(cant_reach)?;
    created_project(status, &text)
}

/// The sidecar's answer: `{ path }`, or its own message (bad name, folder
/// exists), else the status, as every host call reports it.
fn created_project(status: u16, body: &str) -> Result<serde_json::Value, String> {
    // 409 is the sidecar's "that folder already exists".
    if status == 409 {
        let reason = files::host_error(status, body);
        return Err(format!("{}{reason}", crate::PROJECT_EXISTS));
    }
    if !(200..300).contains(&status) {
        return Err(files::host_error(status, body));
    }
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("path")?.as_str().map(str::to_string))
        .filter(|p| !p.trim().is_empty())
        .map(|path| serde_json::json!({ "path": path }))
        .ok_or_else(|| "Your Mac mini didn't say where it made the project.".to_string())
}
