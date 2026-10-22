//! The connection prototype's link (feature `kleio-link`; see
//! `.gg/plans/kleio-connection-prototype.md`): this app reaching its host over
//! iroh instead of Tailscale. The kleio-link library does the dialling, the
//! forwarding, the pairing call and the path log. Prototype only.
//!
//! - **Its own pairing.** `kleio_link_pair` redeems a scanned ticket's code
//!   on `kleio/pair/0`. It's kept apart from the Tailscale pairing: `link.json`
//!   beside `remote.json` holds the host's key, its relay and the mode, and
//!   the Keychain entries go under `link-<host>`, with this device's own iroh
//!   key. `remote.json` and its token are never touched.
//! - **At boot** a link pairing wins over `remote.json` (`super::from_paired`).
//!   The host's base URL is then [`LINK_BASE`]: a loopback listener that
//!   carries each of the app's connections over one cached connection to the
//!   host, dialled again when it has closed, within 10 s. The boot read binds
//!   the listener before it hands that URL out, so nothing can send to it
//!   before it's up; `setup` then forwards on it.
//! - **Back on screen** after at least the host's idle timeout in the
//!   background, it closes the connection and dials again at once: the host
//!   may have dropped it, and a suspended phone can't tell. After a shorter
//!   absence it tells iroh the network may have changed and dials again only
//!   if the connection has closed. It times each resume, from coming back on
//!   screen to the first byte back from the host.
//! - **Logs:** the library writes path events, and each path's numbers every
//!   30 s, through `tracing`. `LogBridge` passes them, and iroh's warnings, to
//!   the app's log, and the last 20 path events are kept for the Link card.
//! - **The pairing QR (iPhone):** the barcode-scanner plugin, registered in
//!   `lib.rs`. Its permission is granted here, so a build without the feature
//!   has neither the plugin nor the grant: [`scanner_capability`].

use std::fmt;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use kleio_link::endpoint::{bind_client, Mode, IDLE_TIMEOUT};
use kleio_link::forward::Forward;
use kleio_link::iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};
use kleio_link::link::{host_addr, Link};
use kleio_link::pair::pair;
use kleio_link::paths::{PathEvents, PathLine};
use kleio_link::ticket::{check_relay, Ticket};
use tauri::{AppHandle, Manager, State};

use super::{commands, keychain, store, OnScreen, Presence, Remote, LINK_BASE};

/// The link's loopback port: [`LINK_BASE`]'s.
pub const LINK_PORT: u16 = 47821;

/// The scanner commands the main window may call, as 4e grants them: scan,
/// cancel and the permission checks. Not the plugin's default set, which
/// also opens the app's settings and vibrates.
#[cfg(any(target_os = "ios", test))]
const SCANNER_PERMISSIONS: [&str; 4] = [
    "barcode-scanner:allow-scan",
    "barcode-scanner:allow-cancel",
    "barcode-scanner:allow-check-permissions",
    "barcode-scanner:allow-request-permissions",
];

/// The capability for the scanner, granted at setup rather than in
/// `capabilities/`: a capability file naming a plugin the build lacks fails
/// the build without the feature. Only the iPhone build has the plugin.
#[cfg(any(target_os = "ios", test))]
pub(crate) fn scanner_capability() -> tauri::ipc::CapabilityBuilder {
    SCANNER_PERMISSIONS.iter().fold(
        tauri::ipc::CapabilityBuilder::new("kleio-link-scanner").window("main"),
        |capability, permission| capability.permission(*permission),
    )
}

/// Path events kept for the Link card.
const KEPT_EVENTS: usize = 20;

/// How long boot waits for the link to start before going on without it.
const START_TIMEOUT: Duration = Duration::from_secs(5);

/// The host drops a connection it has heard nothing on for this long, QUIC's
/// idle timeout ([`IDLE_TIMEOUT`]: iroh's default, which neither end
/// changes). Back from the background after at least this long, the phone's
/// connection may be dead though it looks open. On 2026-10-21 the app trusted
/// such a connection twice, and requests stalled about 30 s, until its own
/// idle timeout closed it.
const HOST_IDLE_TIMEOUT: Duration = IDLE_TIMEOUT;

/// The Link card's switch, as the webview names it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkMode {
    /// Through the relay at first, then direct once iroh finds a path.
    #[default]
    Auto,
    /// Through the relay only: the endpoint has no IP transports.
    RelayOnly,
}

impl From<LinkMode> for Mode {
    fn from(mode: LinkMode) -> Self {
        match mode {
            LinkMode::Auto => Mode::Auto,
            LinkMode::RelayOnly => Mode::RelayOnly,
        }
    }
}

// ── The link pairing ────────────────────────────────────────────────────────

/// The link pairing, `link.json` beside `remote.json`. Nothing secret: the
/// device token, the control credential and this device's iroh key are in
/// the Keychain, under [`keychain_host`].
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRecord {
    /// The host's iroh key: the app dials it, and the handshake proves it.
    pub host_key: String,
    /// The relay the host is reached through.
    pub relay: String,
    #[serde(default)]
    pub mode: LinkMode,
    /// The host's name, as it reports it.
    pub host: String,
    pub device_id: String,
    pub label: String,
    #[serde(default)]
    pub admin: bool,
    /// ISO-8601, display only.
    pub paired_at: String,
}

/// A link pairing that passed its checks, and the host's address from it.
struct Loaded {
    record: LinkRecord,
    host: EndpointAddr,
}

pub fn path(home: &Path) -> PathBuf {
    super::state_dir(home).join("link.json")
}

/// The link pairing, if there is one that can be dialled. Why one can't is
/// logged.
fn load(home: &Path) -> Option<Loaded> {
    let raw = match std::fs::read_to_string(path(home)) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            log::warn!("kleio-link: can't read link.json: {e}");
            return None;
        }
    };
    let record: LinkRecord = match serde_json::from_str(&raw) {
        Ok(record) => record,
        Err(e) => {
            log::warn!("kleio-link: ignoring an unreadable link.json: {e}");
            return None;
        }
    };
    let Some(host) = dialled(&record) else {
        log::warn!("kleio-link: ignoring link.json (bad host key, relay, host or device id)");
        return None;
    };
    Some(Loaded { record, host })
}

/// The host's address, if the record names one the app can dial.
fn dialled(record: &LinkRecord) -> Option<EndpointAddr> {
    let key: EndpointId = record.host_key.parse().ok()?;
    let relay = check_relay(&record.relay).ok()?;
    let named = !record.host.trim().is_empty() && !record.device_id.trim().is_empty();
    named.then(|| host_addr(key, &relay))
}

/// Write-then-rename, as `store::save` does, so a crash mid-write never
/// leaves a half file.
fn save(home: &Path, record: &LinkRecord) -> Result<(), String> {
    let p = path(home);
    let dir = p.parent().ok_or("no parent dir")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".kleio-link.{}.tmp", std::process::id()));
    let body = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Where the link pairing's Keychain entries go: `link-<host>`, so they never
/// meet the Tailscale pairing's entries for the same host.
fn keychain_host(host: &str) -> String {
    format!("link-{host}")
}

/// The link pairing as the paired host, for `kleio_remote_status`: boot reads
/// it first, so while there's one it's the pairing the next launch uses.
pub(super) fn paired_record(home: &Path) -> Option<store::HostRecord> {
    let Loaded { record, .. } = load(home)?;
    Some(store::HostRecord {
        base_url: LINK_BASE.to_string(),
        host: record.host,
        device_id: record.device_id,
        label: record.label,
        admin: record.admin,
        paired_at: record.paired_at,
    })
}

/// Forgets the link pairing, for `kleio_forget`: its Keychain entries and
/// `link.json`. `false` if there's none to forget. The link keeps running
/// until the next launch, as a forgotten Tailscale pairing does.
pub(super) fn forget(home: &Path) -> Result<bool, String> {
    let Some(Loaded { record, .. }) = load(home) else {
        return Ok(false);
    };
    let account = keychain_host(&record.host);
    keychain::delete(&account, keychain::Secret::DeviceToken)?;
    keychain::delete(&account, keychain::Secret::ControlCredential)?;
    keychain::delete(&account, keychain::Secret::IrohKey)?;
    match std::fs::remove_file(path(home)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    log::info!("kleio-link: forgot the pairing to {}", record.host);
    Ok(true)
}

/// This device's iroh key, as the Keychain keeps it.
fn encode_key(key: &SecretKey) -> String {
    base64::engine::general_purpose::STANDARD.encode(key.to_bytes())
}

fn decode_key(text: &str) -> Option<SecretKey> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(text)
        .ok()?;
    let bytes: [u8; 32] = bytes.try_into().ok()?;
    Some(SecretKey::from_bytes(&bytes))
}

/// What a launch on the link needs to run it: the host's address, this
/// device's key, the mode, and the loopback listener the boot read bound.
pub struct LinkBoot {
    host: EndpointAddr,
    key: SecretKey,
    mode: LinkMode,
    /// Bound before the link's URL was handed out (`from_link`); `setup`
    /// forwards on it.
    listener: Mutex<Option<std::net::TcpListener>>,
}

impl LinkBoot {
    /// The listener the boot read bound, for `setup`: once.
    fn take_listener(&self) -> Option<std::net::TcpListener> {
        self.listener
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }
}

/// The link pairing as the app's host, for boot (`super::from_paired`).
/// `None` when there's none or it can't be used; why is logged.
pub(super) fn from_link() -> Option<Remote> {
    let Loaded { record, host } = load(&crate::home_dir())?;
    let account = keychain_host(&record.host);
    let secret = |which| match keychain::get(&account, which) {
        Ok(found) => found,
        Err(e) => {
            log::warn!("kleio-link: {e}");
            None
        }
    };
    let Some(device_token) = secret(keychain::Secret::DeviceToken) else {
        log::warn!(
            "kleio-link: paired to {} but its token is not in the Keychain; not using the link",
            record.host
        );
        return None;
    };
    let Some(key) = secret(keychain::Secret::IrohKey).and_then(|text| decode_key(&text)) else {
        log::warn!(
            "kleio-link: paired to {} but this device's link key is not in the Keychain; not using the link",
            record.host
        );
        return None;
    };
    let control_credential = if record.admin {
        secret(keychain::Secret::ControlCredential)
    } else {
        None
    };
    // Whatever sends to the host reads its URL here first, so the boot read
    // binds the listener before handing the URL out: a request sent before
    // `setup` forwards, such as the Live Activity token iOS can report as
    // soon as `live::begin` runs, waits in its backlog instead of being
    // refused. Later reads bind nothing: after an in-place pairing the link
    // is listening already (`activate_paired`), and `remote_now`'s isn't
    // running.
    let listener = if super::BOOT.is_completed() {
        None
    } else {
        listen_at_boot()
    };
    log::info!(
        "kleio: remote host mode → {} over the link ({})",
        record.host,
        record.label
    );
    Some(Remote {
        base: LINK_BASE.to_string(),
        host: record.host,
        device_id: record.device_id,
        label: record.label,
        device_token,
        control_credential,
        admin: record.admin,
        link: Some(LinkBoot {
            host,
            key,
            mode: record.mode,
            listener: Mutex::new(listener),
        }),
    })
}

/// The link's loopback listener, bound now (see `from_link`). `None` if it
/// can't be: `setup` then tries again, and says why if it still can't.
fn listen_at_boot() -> Option<std::net::TcpListener> {
    match Forward::listen(LINK_PORT) {
        Ok(listener) => {
            log::info!("kleio-link: listening on {LINK_BASE}");
            Some(listener)
        }
        Err(e) => {
            log::warn!("kleio-link: can't listen on {LINK_BASE} at boot: {e}");
            None
        }
    }
}

// ── The running link ────────────────────────────────────────────────────────

/// The link in this launch (Tauri state).
pub struct LinkRuntime {
    running: tokio::sync::Mutex<Option<Running>>,
    /// Why it couldn't start, if it couldn't.
    failure: Mutex<Option<String>>,
    /// Kept across mode switches, so the card's history goes on.
    events: PathEvents,
    /// When the app went to the background, until it's back on screen.
    away_since: Mutex<Option<WentAway>>,
}

impl Default for LinkRuntime {
    fn default() -> Self {
        Self {
            running: tokio::sync::Mutex::default(),
            failure: Mutex::default(),
            events: PathEvents::new(KEPT_EVENTS),
            away_since: Mutex::default(),
        }
    }
}

/// The link while it runs: its endpoint (in the `Link`) and loopback listener.
struct Running {
    link: Link,
    /// Forwarding on the loopback listener; `None` only while a new listener
    /// takes over (`forward_again`).
    forward: Option<tauri::async_runtime::JoinHandle<()>>,
    mode: LinkMode,
    key: SecretKey,
    host: EndpointAddr,
}

impl Running {
    /// The endpoint, then forwarding on `listener` (the boot read's) or on a
    /// new one on [`LINK_PORT`]. Connections waiting on `listener` are
    /// forwarded too; if the endpoint can't start, they're refused as it's
    /// dropped.
    async fn start(
        key: SecretKey,
        host: EndpointAddr,
        mode: LinkMode,
        events: PathEvents,
        listener: Option<std::net::TcpListener>,
    ) -> Result<Self, String> {
        let endpoint = bind_client(key.clone(), mode.into())
            .await
            .map_err(|e| format!("the link's endpoint didn't start: {e}"))?;
        Self::start_on(endpoint, key, host, mode, events, listener).await
    }

    /// [`start`](Self::start), on an endpoint bound already.
    async fn start_on(
        endpoint: Endpoint,
        key: SecretKey,
        host: EndpointAddr,
        mode: LinkMode,
        events: PathEvents,
        listener: Option<std::net::TcpListener>,
    ) -> Result<Self, String> {
        let link = Link::with_path_events(endpoint, host.clone(), events);
        let forward = match listener {
            Some(listener) => Forward::from_std(listener, link.clone()),
            None => Forward::bind(LINK_PORT, link.clone()).await,
        };
        let forward = match forward {
            Ok(forward) => forward,
            Err(e) => {
                link.endpoint().close().await;
                return Err(format!("the link couldn't listen on {LINK_BASE}: {e}"));
            }
        };
        log::info!(
            "kleio-link: {LINK_BASE} forwards to {} ({mode:?})",
            host.id.fmt_short()
        );
        let forward = Some(tauri::async_runtime::spawn(forward.run()));
        Ok(Self {
            link,
            forward,
            mode,
            key,
            host,
        })
    }

    /// Stops listening, then closes the endpoint, which ends its connection.
    async fn stop(mut self) {
        self.stop_forwarding().await;
        self.link.endpoint().close().await;
    }

    /// Stops forwarding, which closes the listener.
    async fn stop_forwarding(&mut self) {
        if let Some(forward) = self.forward.take() {
            forward.abort();
            let _ = forward.await;
        }
    }

    /// Forwards on a new listener in place of one iOS took away
    /// ([`listen_again`]): `listener` if the main thread could bind one, else
    /// a new one on `port` once the old has closed. The old listener's task
    /// never ends by itself: iOS leaves it waiting forever.
    async fn forward_again(
        &mut self,
        listener: Option<std::net::TcpListener>,
        port: u16,
    ) -> Result<(), String> {
        self.stop_forwarding().await;
        let forward = listener
            .map_or_else(|| Forward::listen(port), Ok)
            .and_then(|listener| Forward::from_std(listener, self.link.clone()))
            .map_err(|e| format!("the link couldn't listen on {LINK_BASE} again: {e}"))?;
        self.forward = Some(tauri::async_runtime::spawn(forward.run()));
        Ok(())
    }
}

impl LinkRuntime {
    /// Starts the link, unless it's running already, forwarding on
    /// `listener` if there's one (the boot read's).
    async fn start(
        &self,
        key: SecretKey,
        host: EndpointAddr,
        mode: LinkMode,
        listener: Option<std::net::TcpListener>,
    ) -> Result<(), String> {
        let mut running = self.running.lock().await;
        if running.is_some() {
            return Ok(());
        }
        let started = Running::start(key, host, mode, self.events.clone(), listener).await;
        self.set_failure(started.as_ref().err().cloned());
        *running = Some(started?);
        Ok(())
    }

    /// Runs the link in `mode`. Relay only is an endpoint without IP
    /// transports, so a running link starts again with a new endpoint and
    /// listener; one that isn't running takes `mode` when it next starts.
    async fn switch(&self, mode: LinkMode) -> Result<(), String> {
        let mut running = self.running.lock().await;
        let Some(current) = running.take() else {
            return Ok(());
        };
        if current.mode == mode {
            *running = Some(current);
            return Ok(());
        }
        let (key, host) = (current.key.clone(), current.host.clone());
        current.stop().await;
        let started = Running::start(key, host, mode, self.events.clone(), None).await;
        self.set_failure(started.as_ref().err().cloned());
        match started {
            Ok(run) => {
                *running = Some(run);
                Ok(())
            }
            Err(e) => Err(format!(
                "The link stopped and couldn't start again: {e}. Close and reopen Kleio."
            )),
        }
    }

    /// See [`listen_again`]: forwards on `listener`, or on a new one once the
    /// old has closed. Nothing to do if the link isn't running.
    async fn forward_again(&self, listener: Option<std::net::TcpListener>) {
        let mut running = self.running.lock().await;
        let Some(run) = running.as_mut() else {
            return;
        };
        match run.forward_again(listener, LINK_PORT).await {
            Ok(()) => log::info!("kleio-link: forwarding on the new listener"),
            Err(e) => {
                log::error!("kleio-link: {e}; the host can't be reached until Kleio opens again");
                self.set_failure(Some(e));
            }
        }
    }

    /// The app is back on screen: time the resume, and dial again if the
    /// connection may be dead. After at least the host's idle timeout away
    /// ([`redial_on_resume`]) the connection is closed and dialled again at
    /// once, whatever it looks like. After less, today's path: tell iroh the
    /// network may have changed, and dial again only if it has closed.
    async fn resume(&self) {
        let away = self.away_since().take().map(|went| went.ago());
        let Some(link) = self
            .running
            .lock()
            .await
            .as_ref()
            .map(|run| run.link.clone())
        else {
            return;
        };
        link.begin_resume();
        let away_text = away.map_or_else(
            || "an unknown time".to_owned(),
            |away| format!("{:.1} s", away.as_secs_f64()),
        );
        let limit = HOST_IDLE_TIMEOUT.as_secs();
        if redial_on_resume(away) {
            // First, so a request sent on coming back fails at once on the old
            // connection, if at all, and then shares the dial.
            let closed = link.close_connection();
            log::info!(
                "kleio-link: back on screen after {away_text} away, at least the host's idle \
                 timeout ({limit} s): {}",
                if closed {
                    "closing the connection and dialling again"
                } else {
                    "the connection had closed; dialling again"
                }
            );
            link.endpoint().network_change().await;
            // The library logs how the dial went.
            let _ = link.connection().await;
            return;
        }
        link.endpoint().network_change().await;
        if link.status().connected {
            log::info!(
                "kleio-link: back on screen after {away_text} away, under the host's idle timeout \
                 ({limit} s), with the connection open"
            );
        } else {
            log::info!(
                "kleio-link: back on screen after {away_text} away, under the host's idle timeout \
                 ({limit} s), and the connection has closed: dialling again"
            );
            let _ = link.connection().await;
        }
    }

    /// The app went to the background: note when, unless it's noted already
    /// for this absence.
    fn note_background(&self) {
        self.away_since().get_or_insert_with(WentAway::now);
    }

    fn away_since(&self) -> MutexGuard<'_, Option<WentAway>> {
        // Every update is one assignment, so it's whole even if a holder
        // panicked.
        self.away_since
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    async fn status(&self) -> LinkStatusView {
        let loaded = load(&crate::home_dir());
        let running = self.running.lock().await;
        let link = running.as_ref().map(|run| &run.link);
        let status = link.map(Link::status);
        let path = link.and_then(Link::path);
        let record = loaded.as_ref().map(|loaded| &loaded.record);
        LinkStatusView {
            paired: record.is_some(),
            active: super::remote().is_some_and(|r| r.link.is_some()),
            running: running.is_some(),
            error: self.failure().clone(),
            mode: running
                .as_ref()
                .map(|run| run.mode)
                .or(record.map(|record| record.mode)),
            host: record.map(|record| record.host.clone()),
            host_key: record.map(|record| record.host_key.clone()),
            relay: record.map(|record| record.relay.clone()),
            connected: status.is_some_and(|status| status.connected),
            path: path
                .as_ref()
                .map(|path| if path.direct { "direct" } else { "relay" }),
            path_addr: path.as_ref().map(|path| path.addr.clone()),
            tailscale: path.as_ref().is_some_and(|path| path.tailscale),
            rtt_ms: path.as_ref().map(|path| millis(path.rtt)),
            connected_since_ms: status
                .and_then(|status| status.connected_for)
                .and_then(|up| SystemTime::now().checked_sub(up))
                .map(epoch_ms),
            redials: status.map_or(0, |status| status.redials),
            last_resume_ms: link.and_then(Link::last_resume).map(millis),
            events: self
                .events
                .lines()
                .into_iter()
                .map(LinkEvent::from)
                .collect(),
            debug_build: cfg!(debug_assertions),
        }
    }

    fn failure(&self) -> MutexGuard<'_, Option<String>> {
        // Every update is one assignment, so it's whole even if a holder
        // panicked.
        self.failure.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn set_failure(&self, failure: Option<String>) {
        *self.failure() = failure;
    }
}

/// At app setup: the link's state and log and, when this launch reaches the
/// host over the link, the link itself, forwarding on the listener the boot
/// read bound (`from_link`). Requests sent before this wait on that listener.
pub fn setup(app: &AppHandle) {
    // Fails only if a subscriber is set already, which then keeps the lines.
    let _ = tracing::subscriber::set_global_default(LogBridge);
    app.manage(LinkRuntime::default());
    // The pairing QR's scanner: only the iPhone build has the plugin. Without
    // the grant, a scan fails and the pairing form says so.
    #[cfg(target_os = "ios")]
    if let Err(e) = app.add_capability(scanner_capability()) {
        log::warn!("kleio-link: the QR scanner isn't allowed: {e}");
    }
    watch_presence(app.clone());
    let Some(boot) = super::remote().and_then(|r| r.link.as_ref()) else {
        return;
    };
    let runtime = app.state::<LinkRuntime>();
    let start = runtime.start(
        boot.key.clone(),
        boot.host.clone(),
        boot.mode,
        boot.take_listener(),
    );
    // Setup runs on the main thread, outside the async runtime, so it may
    // block here, briefly: starting binds sockets and waits for no network.
    match block_on_within(START_TIMEOUT, start) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => log::error!("kleio-link: {e}; the host can't be reached this launch"),
        Err(_) => {
            let e = format!("the link didn't start within {} s", START_TIMEOUT.as_secs());
            log::error!("kleio-link: {e}; the host can't be reached this launch");
            runtime.set_failure(Some(e));
        }
    }
}

/// Runs `task` on the async runtime from outside it, as setup does on the
/// main thread, and gives up after `limit`. The timer is made inside the
/// runtime: tokio panics when one is made outside, and a panic during launch
/// aborts the app.
fn block_on_within<F: Future>(
    limit: Duration,
    task: F,
) -> Result<F::Output, tokio::time::error::Elapsed> {
    tauri::async_runtime::block_on(async move { tokio::time::timeout(limit, task).await })
}

/// The app is coming back on screen (iPhone: `WindowEvent::Resumed`, before
/// `Presence` tells anything else). iOS can take a suspended app's listening
/// socket away (Apple's TN2277): the app's requests to the link are then
/// refused, and the listener never says so. So this checks something still
/// listens, and if not listens again at once, before anything sends, then
/// forwards on the new listener as soon as the runtime gets to it.
#[cfg_attr(desktop, allow(dead_code))]
pub fn listen_again(app: &AppHandle) {
    if !super::remote().is_some_and(|r| r.link.is_some()) {
        return;
    }
    let Some(bound) = listen_if_gone(LINK_PORT) else {
        return;
    };
    log::info!(
        "kleio-link: back on screen, and nothing was listening on {LINK_BASE} (iOS closes a \
         suspended app's listeners): listening again"
    );
    let listener = match bound {
        Ok(listener) => Some(listener),
        Err(e) => {
            log::warn!(
                "kleio-link: can't listen on {LINK_BASE} until the old listener closes: {e}"
            );
            None
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<LinkRuntime>().forward_again(listener).await;
    });
}

/// What [`listen_again`] does on the main thread: nothing while something
/// still listens on `port`, else a new listener on it, bound now, or why it
/// couldn't be (the old socket may still hold the port).
fn listen_if_gone(port: u16) -> Option<std::io::Result<std::net::TcpListener>> {
    (!Forward::listening(port)).then(|| Forward::listen(port))
}

/// Each time the app goes to the background the link notes when, and each
/// time it comes back on screen the link resumes. If it went and came back
/// between two looks, the time away isn't known, and counts as long.
fn watch_presence(app: AppHandle) {
    let mut presence = app.state::<Presence>().subscribe();
    tauri::async_runtime::spawn(async move {
        let mut seen = *presence.borrow_and_update();
        while presence.changed().await.is_ok() {
            let now = *presence.borrow_and_update();
            let runtime = app.state::<LinkRuntime>();
            if !now.visible {
                runtime.note_background();
            } else if came_back(seen, now) {
                runtime.resume().await;
            }
            seen = now;
        }
    });
}

/// Whether coming back on screen after `away` in the background closes the
/// connection and dials again at once, rather than trusting it. After at
/// least the host's idle timeout, the host may have dropped it. A time not
/// known counts as long: a dial took 0.14–0.85 s on 2026-10-21, and a dead
/// connection cost about 30 s.
fn redial_on_resume(away: Option<Duration>) -> bool {
    away.is_none_or(|away| away >= HOST_IDLE_TIMEOUT)
}

/// When the app went to the background, by two clocks. `Instant` doesn't
/// count time the phone sleeps (on iOS it's Darwin's `CLOCK_UPTIME_RAW`), so
/// a locked phone's absence would read short; the wall clock counts it. The
/// longer of the two counts, which also covers the wall clock being set back.
#[derive(Debug, Clone, Copy)]
struct WentAway {
    wall: SystemTime,
    uptime: Instant,
}

impl WentAway {
    fn now() -> Self {
        Self {
            wall: SystemTime::now(),
            uptime: Instant::now(),
        }
    }

    /// How long ago, by the clock that says longer.
    fn ago(&self) -> Duration {
        let wall = SystemTime::now()
            .duration_since(self.wall)
            .unwrap_or_default();
        wall.max(self.uptime.elapsed())
    }
}

/// Whether the app came back on screen between two looks at `Presence`: it's
/// on screen now, and it was away then, or went away and came back between.
fn came_back(seen: OnScreen, now: OnScreen) -> bool {
    now.visible && (!seen.visible || now.changes.wrapping_sub(seen.changes) >= 2)
}

// ── Commands ────────────────────────────────────────────────────────────────

/// What the confirm step shows for a scanned ticket.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketCheck {
    /// The host key's first 8 characters.
    pub key_prefix: String,
    /// The relay's host name.
    pub relay_host: String,
    /// The pair code, `ABC-DEF`.
    pub code: String,
}

/// Checks a scanned (or pasted) pairing ticket, for the confirm step. Its
/// errors say what's wrong in words a person can act on.
#[tauri::command]
pub fn kleio_link_check_ticket(ticket: String) -> Result<TicketCheck, String> {
    let ticket = parse_ticket(&ticket)?;
    Ok(TicketCheck {
        key_prefix: ticket.key_prefix(),
        relay_host: ticket.relay_host().to_string(),
        code: ticket.code().to_string(),
    })
}

fn parse_ticket(raw: &str) -> Result<Ticket, String> {
    raw.trim().parse::<Ticket>().map_err(|e| e.to_string())
}

/// Pairs over the link with the host a ticket names: dials its key on
/// `kleio/pair/0` and redeems the ticket's code with a new key for this
/// device. Answers as `kleio_pair` does, with the same errors, and saves the
/// pairing apart from the Tailscale one. Then it switches the pairing on as
/// `kleio_activate_pairing` does after `kleio_pair` (`super::activate_paired`):
/// in place on an iPhone that wasn't paired, at the next launch otherwise.
/// So don't call `kleio_activate_pairing` after this; `kleio_link_status`
/// says whether the link is active.
#[tauri::command]
pub async fn kleio_link_pair(
    app: AppHandle,
    ticket: String,
    label: String,
) -> Result<store::HostRecord, String> {
    let ticket = parse_ticket(&ticket)?;
    let label = commands::label_or_default(&label);
    let home = crate::home_dir();
    let mode = load(&home)
        .map(|loaded| loaded.record.mode)
        .unwrap_or_default();
    let key = SecretKey::generate();
    let endpoint = bind_client(key.clone(), mode.into())
        .await
        .map_err(|e| format!("Can't start the link: {e}"))?;
    let answer = pair(&endpoint, &ticket, &label).await;
    endpoint.close().await;
    let payload = commands::checked_payload(answer.map_err(|e| e.to_string())?)?;
    let account = keychain_host(&payload.host);
    commands::keep_secrets(&account, &payload)?;
    keychain::put(&account, keychain::Secret::IrohKey, &encode_key(&key))?;
    let record = LinkRecord {
        host_key: ticket.key().to_string(),
        relay: ticket.relay().to_string(),
        mode,
        host: payload.host,
        device_id: payload.device_id,
        label: payload.label,
        admin: payload.control_credential.is_some(),
        paired_at: commands::now_iso(),
    };
    save(&home, &record)?;
    log::info!(
        "kleio-link: paired to {} as {} (admin={})",
        record.host,
        record.label,
        record.admin
    );
    // Switching on in place starts a session at once, so the listener goes
    // up first. `kleio_activate_pairing` switches in place exactly then.
    if cfg!(mobile) && super::remote().is_none() {
        let host = host_addr(ticket.key(), ticket.relay());
        app.state::<LinkRuntime>()
            .start(key, host, mode, None)
            .await
            .map_err(|e| format!("Paired, but {e}."))?;
    }
    crate::kleio_activate_pairing(app).await?;
    Ok(store::HostRecord {
        base_url: LINK_BASE.to_string(),
        host: record.host,
        device_id: record.device_id,
        label: record.label,
        admin: record.admin,
        paired_at: record.paired_at,
    })
}

/// What `kleio_link_status` reports, for the Link card.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatusView {
    /// A link pairing is saved.
    pub paired: bool,
    /// This launch reaches the host over the link.
    pub active: bool,
    /// The link is running in this launch.
    pub running: bool,
    /// Why it couldn't start, if it couldn't.
    pub error: Option<String>,
    pub mode: Option<LinkMode>,
    /// The host's name, as it reports it.
    pub host: Option<String>,
    /// The host's iroh key.
    pub host_key: Option<String>,
    /// The relay the host is reached through.
    pub relay: Option<String>,
    /// A connection to the host is open now.
    pub connected: bool,
    /// The open connection's path: `"relay"` or `"direct"`.
    pub path: Option<&'static str>,
    /// The relay's URL, or the direct path's `ip:port`.
    pub path_addr: Option<String>,
    /// The direct path is to a Tailscale address, which makes a field run
    /// invalid.
    pub tailscale: bool,
    pub rtt_ms: Option<u64>,
    /// When the open connection came up, in milliseconds since 1970.
    pub connected_since_ms: Option<u64>,
    /// Dials since the first connection, whether or not they connected.
    pub redials: u64,
    /// The latest resume, from coming back on screen to the first byte back.
    pub last_resume_ms: Option<u64>,
    /// The latest path events, oldest first.
    pub events: Vec<LinkEvent>,
    /// A debug build, whose pairing form also takes a pasted ticket: the
    /// simulator has no camera. The webview can't tell, as `tauri build
    /// --debug` still builds it in production mode.
    pub debug_build: bool,
}

/// One path event, for the Link card.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEvent {
    /// When it happened, in milliseconds since 1970.
    pub at_ms: u64,
    pub text: String,
}

impl From<PathLine> for LinkEvent {
    fn from(line: PathLine) -> Self {
        Self {
            at_ms: epoch_ms(line.at),
            text: line.text,
        }
    }
}

/// The link, for the Link card. Never dials.
#[tauri::command]
pub async fn kleio_link_status(runtime: State<'_, LinkRuntime>) -> Result<LinkStatusView, String> {
    Ok(runtime.status().await)
}

/// The Link card's switch: saves the mode and, if the link is running,
/// starts it again in that mode. In-flight requests end, and the event
/// streams reconnect by themselves. Returns the new status.
#[tauri::command]
pub async fn kleio_link_set_mode(
    runtime: State<'_, LinkRuntime>,
    mode: LinkMode,
) -> Result<LinkStatusView, String> {
    let home = crate::home_dir();
    let mut loaded = load(&home).ok_or("Kleio isn't paired over the link.")?;
    if loaded.record.mode != mode {
        loaded.record.mode = mode;
        save(&home, &loaded.record)?;
        log::info!("kleio-link: mode is now {mode:?}");
    }
    runtime.switch(mode).await?;
    Ok(runtime.status().await)
}

fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn epoch_ms(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH).map_or(0, millis)
}

// ── The log ─────────────────────────────────────────────────────────────────

/// Passes the kleio-link library's `tracing` lines at info and up, and every
/// other crate's at warn and up (iroh's relay warnings, say), to the app's
/// `log`. Spans are left out: nothing here reads them.
struct LogBridge;

/// The quietest level passed on from `target`.
fn threshold(target: &str) -> tracing::Level {
    let ours = target == "kleio_link" || target.starts_with("kleio_link::");
    if ours {
        tracing::Level::INFO
    } else {
        tracing::Level::WARN
    }
}

fn passes(meta: &tracing::Metadata<'_>) -> bool {
    meta.is_event() && *meta.level() <= threshold(meta.target())
}

impl tracing::Subscriber for LogBridge {
    fn register_callsite(
        &self,
        meta: &'static tracing::Metadata<'static>,
    ) -> tracing::subscriber::Interest {
        if passes(meta) {
            tracing::subscriber::Interest::always()
        } else {
            tracing::subscriber::Interest::never()
        }
    }

    fn enabled(&self, meta: &tracing::Metadata<'_>) -> bool {
        passes(meta)
    }

    fn max_level_hint(&self) -> Option<tracing::level_filters::LevelFilter> {
        Some(tracing::level_filters::LevelFilter::INFO)
    }

    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        // Never called: `enabled` turns every span away.
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        let meta = event.metadata();
        let level = match *meta.level() {
            tracing::Level::ERROR => log::Level::Error,
            tracing::Level::WARN => log::Level::Warn,
            tracing::Level::INFO => log::Level::Info,
            tracing::Level::DEBUG => log::Level::Debug,
            _ => log::Level::Trace,
        };
        let logger = log::logger();
        let wanted = log::Metadata::builder()
            .level(level)
            .target(meta.target())
            .build();
        if level > log::max_level() || !logger.enabled(&wanted) {
            return;
        }
        logger.log(
            &log::Record::builder()
                .metadata(wanted)
                .module_path(meta.module_path())
                .file(meta.file())
                .line(meta.line())
                .args(format_args!("{}", render(event)))
                .build(),
        );
    }

    fn enter(&self, _: &tracing::span::Id) {}

    fn exit(&self, _: &tracing::span::Id) {}
}

/// An event's message, then its other fields as `name=value`.
fn render(event: &tracing::Event<'_>) -> String {
    let mut line = Line::default();
    event.record(&mut line);
    line.message + &line.fields
}

#[derive(Default)]
struct Line {
    message: String,
    fields: String,
}

impl tracing::field::Visit for Line {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn fmt::Debug) {
        use fmt::Write as _;
        let _ = if field.name() == "message" {
            write!(self.message, "{value:?}")
        } else {
            write!(self.fields, " {}={value:?}", field.name())
        };
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    /// One dir per call, as `store.rs`'s tests make them.
    fn tmp_home() -> PathBuf {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!(
            "kleio-link-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const RELAY: &str = "https://euc1-1.relay.n0.iroh.link./";

    fn host_key() -> EndpointId {
        SecretKey::from_bytes(&[7; 32]).public()
    }

    fn record() -> LinkRecord {
        LinkRecord {
            host_key: host_key().to_string(),
            relay: RELAY.into(),
            mode: LinkMode::RelayOnly,
            host: "mac-mini-1.x.ts.net".into(),
            device_id: "dev-1".into(),
            label: "iPhone".into(),
            admin: false,
            paired_at: "2026-10-17T00:00:00Z".into(),
        }
    }

    #[test]
    fn the_link_is_its_port_on_loopback() {
        assert_eq!(LINK_BASE, format!("http://127.0.0.1:{LINK_PORT}"));
    }

    #[test]
    fn keeps_the_link_pairing_apart_from_the_tailscale_one() {
        let home = tmp_home();
        assert!(load(&home).is_none());
        save(&home, &record()).unwrap();
        let loaded = load(&home).expect("loads");
        assert_eq!(loaded.record, record());
        assert_eq!(
            loaded.host,
            host_addr(host_key(), &check_relay(RELAY).unwrap())
        );
        // Beside remote.json, which it leaves alone, and 0600 with no temp
        // file left behind.
        let dir = super::super::state_dir(&home);
        assert_eq!(path(&home), dir.join("link.json"));
        assert!(!store::path(&home).exists());
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["link.json"]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(path(&home)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        // Its Keychain entries go under their own name, too.
        assert_eq!(
            keychain_host("mac-mini-1.x.ts.net"),
            "link-mac-mini-1.x.ts.net"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn grants_the_main_window_only_scan_cancel_and_the_permission_checks() {
        use tauri::ipc::RuntimeCapability;
        use tauri::utils::acl::capability::CapabilityFile;
        let CapabilityFile::Capability(capability) = scanner_capability().build() else {
            panic!("one capability");
        };
        assert_eq!(capability.windows, ["main"]);
        let granted: Vec<&str> = capability
            .permissions
            .iter()
            .map(|p| p.identifier().get())
            .collect();
        assert_eq!(
            granted,
            [
                "barcode-scanner:allow-scan",
                "barcode-scanner:allow-cancel",
                "barcode-scanner:allow-check-permissions",
                "barcode-scanner:allow-request-permissions",
            ]
        );
    }

    #[test]
    fn shows_the_link_pairing_as_the_paired_host_at_the_links_url() {
        let home = tmp_home();
        assert_eq!(paired_record(&home), None);
        save(&home, &record()).unwrap();
        assert_eq!(
            paired_record(&home),
            Some(store::HostRecord {
                base_url: LINK_BASE.to_string(),
                host: "mac-mini-1.x.ts.net".into(),
                device_id: "dev-1".into(),
                label: "iPhone".into(),
                admin: false,
                paired_at: "2026-10-17T00:00:00Z".into(),
            })
        );
        // One it can't dial isn't shown, as boot doesn't use it.
        save(
            &home,
            &LinkRecord {
                host_key: "not a key".into(),
                ..record()
            },
        )
        .unwrap();
        assert_eq!(paired_record(&home), None);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn ignores_a_link_pairing_it_cant_dial() {
        let home = tmp_home();
        for bad in [
            LinkRecord {
                host_key: "not a key".into(),
                ..record()
            },
            LinkRecord {
                relay: "http://euc1-1.relay.n0.iroh.link./".into(),
                ..record()
            },
            LinkRecord {
                host: " ".into(),
                ..record()
            },
            LinkRecord {
                device_id: String::new(),
                ..record()
            },
        ] {
            save(&home, &bad).unwrap();
            assert!(load(&home).is_none(), "{bad:?}");
        }
        std::fs::write(path(&home), "not json").unwrap();
        assert!(load(&home).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_record_without_a_mode_or_admin_flag_is_auto_and_not_admin() {
        let home = tmp_home();
        std::fs::create_dir_all(super::super::state_dir(&home)).unwrap();
        let written = serde_json::json!({
            "hostKey": host_key().to_string(),
            "relay": RELAY,
            "host": "h",
            "deviceId": "d",
            "label": "l",
            "pairedAt": "t",
        });
        std::fs::write(path(&home), written.to_string()).unwrap();
        let loaded = load(&home).expect("loads");
        assert_eq!(loaded.record.mode, LinkMode::Auto);
        assert!(!loaded.record.admin);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn keeps_this_devices_key_as_text() {
        let key = SecretKey::from_bytes(&[9; 32]);
        let text = encode_key(&key);
        assert_eq!(decode_key(&text).map(|k| k.public()), Some(key.public()));
        assert!(decode_key("not base64!").is_none());
        let short = base64::engine::general_purpose::STANDARD.encode([9u8; 31]);
        assert!(decode_key(&short).is_none());
    }

    #[test]
    fn names_the_modes_as_the_webview_does() {
        assert_eq!(
            serde_json::to_value(LinkMode::RelayOnly).unwrap(),
            "relayOnly"
        );
        assert_eq!(
            serde_json::from_value::<LinkMode>("auto".into()).unwrap(),
            LinkMode::Auto
        );
        assert!(serde_json::from_value::<LinkMode>("direct".into()).is_err());
        assert_eq!(Mode::from(LinkMode::Auto), Mode::Auto);
        assert_eq!(Mode::from(LinkMode::RelayOnly), Mode::RelayOnly);
    }

    #[test]
    fn a_ticket_check_shows_what_the_confirm_step_needs() {
        let ticket = Ticket::new(host_key(), &check_relay(RELAY).unwrap(), "abc-def")
            .unwrap()
            .to_json();
        assert_eq!(
            kleio_link_check_ticket(format!(" {ticket}\n")),
            Ok(TicketCheck {
                key_prefix: host_key().to_string()[..8].to_string(),
                relay_host: "euc1-1.relay.n0.iroh.link.".into(),
                code: "ABC-DEF".into(),
            })
        );
        assert_eq!(
            kleio_link_check_ticket("{}".into()),
            Err("This QR code isn't a Kleio pairing code.".to_string())
        );
    }

    #[test]
    fn a_resume_is_coming_back_on_screen_after_going_away() {
        let at = |changes, visible| OnScreen { changes, visible };
        assert!(came_back(at(1, false), at(2, true)));
        // Away and back between two looks.
        assert!(came_back(at(0, true), at(2, true)));
        // Going away, or a foreground while already on screen, isn't one.
        assert!(!came_back(at(0, true), at(1, false)));
        assert!(!came_back(at(0, true), at(1, true)));
        assert!(!came_back(at(0, true), at(3, false)));
    }

    /// Back from the background, the connection is kept under the host's idle
    /// timeout, and closed and dialled again at once from it on, or after a
    /// time not known.
    #[test]
    fn resuming_redials_at_once_from_the_hosts_idle_timeout_on() {
        assert!(!redial_on_resume(Some(Duration::ZERO)));
        assert!(!redial_on_resume(Some(Duration::from_secs(29))));
        assert!(!redial_on_resume(Some(
            HOST_IDLE_TIMEOUT - Duration::from_millis(1)
        )));
        assert!(redial_on_resume(Some(HOST_IDLE_TIMEOUT)));
        // About the 2026-10-21 15:04 return's 6.6 minutes.
        assert!(redial_on_resume(Some(Duration::from_secs(400))));
        assert!(redial_on_resume(None));
    }

    /// The time away is the longer of the two clocks': the wall clock's, which
    /// counts a sleeping phone's time, or `Instant`'s, if the wall clock was set
    /// back meanwhile.
    #[test]
    fn the_time_away_is_the_longer_clocks() {
        let now = Instant::now();
        let slept = WentAway {
            wall: SystemTime::now() - Duration::from_secs(400),
            uptime: now,
        };
        assert!(slept.ago() >= Duration::from_secs(400));
        let set_back = WentAway {
            wall: SystemTime::now() + Duration::from_secs(3600),
            uptime: now
                .checked_sub(Duration::from_secs(40))
                .expect("an earlier instant"),
        };
        let ago = set_back.ago();
        assert!(ago >= Duration::from_secs(40), "{ago:?}");
        assert!(ago < Duration::from_secs(60), "{ago:?}");
    }

    /// An absence is timed from the first move to the background seen, and
    /// the resume takes it, so the next absence starts afresh.
    #[test]
    fn times_an_absence_from_its_start_until_the_resume() {
        let runtime = LinkRuntime::default();
        runtime.note_background();
        let first = runtime.away_since().expect("noted").wall;
        std::thread::sleep(Duration::from_millis(5));
        runtime.note_background();
        assert_eq!(runtime.away_since().map(|went| went.wall), Some(first));
        // No link runs here: the resume only takes the time.
        tauri::async_runtime::block_on(runtime.resume());
        assert!(runtime.away_since().is_none(), "the resume took it");
    }

    /// Setup starts a saved link from the main thread, outside the async
    /// runtime. Its timer used to be made there, which panicked, so every
    /// launch with a link pairing saved aborted.
    #[test]
    fn starts_from_outside_the_runtime_and_gives_up_after_the_limit() {
        assert_eq!(block_on_within(Duration::from_secs(5), async { 7 }), Ok(7));
        let hung = block_on_within(Duration::from_millis(10), std::future::pending::<()>());
        assert!(hung.is_err(), "{hung:?}");
    }

    /// A loopback endpoint with no relay, as kleio-link's own tests make
    /// them: the test needs no network.
    async fn loopback_endpoint(seed: u8, alpns: &[&[u8]]) -> Endpoint {
        kleio_link::endpoint::builder(
            SecretKey::from_bytes(&[seed; 32]),
            kleio_link::iroh::RelayMode::Disabled,
            Mode::Auto,
        )
        .alpns(alpns.iter().map(|alpn| alpn.to_vec()).collect())
        .bind_addr("127.0.0.1:0")
        .expect("a loopback address")
        .bind_addr("[::1]:0")
        .expect("a loopback address")
        .bind()
        .await
        .expect("an endpoint binds on loopback")
    }

    /// A host that answers each stream with what the app sent on it.
    async fn echo_host(endpoint: Endpoint) {
        while let Some(incoming) = endpoint.accept().await {
            let Ok(conn) = incoming.await else { continue };
            tauri::async_runtime::spawn(async move {
                while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                    tauri::async_runtime::spawn(async move {
                        if let Ok(body) = recv.read_to_end(1 << 16).await {
                            let _ = send.write_all(&body).await;
                            let _ = send.finish();
                        }
                    });
                }
            });
        }
    }

    /// How long a test waits on loopback before it fails.
    const WAIT: Duration = Duration::from_secs(20);

    /// A request on a new loopback connection, half-closed once sent.
    fn send_request(addr: std::net::SocketAddr, body: &[u8]) -> std::net::TcpStream {
        use std::io::Write;
        let mut tcp = std::net::TcpStream::connect_timeout(&addr, WAIT).expect("taken at once");
        tcp.set_read_timeout(Some(WAIT)).expect("a read timeout");
        tcp.write_all(body).expect("the request is taken");
        tcp.shutdown(std::net::Shutdown::Write)
            .expect("half-closes");
        tcp
    }

    /// The whole answer to a request.
    fn read_reply(mut tcp: std::net::TcpStream) -> Vec<u8> {
        use std::io::Read;
        let mut back = Vec::new();
        tcp.read_to_end(&mut back).expect("an answer");
        back
    }

    /// The link between loopback endpoints (keys from `seed` and `seed + 1`),
    /// forwarding on `listener` as setup does on the boot read's.
    async fn running_on(listener: std::net::TcpListener, seed: u8) -> Running {
        let host = loopback_endpoint(seed, &[kleio_link::ALPN_HTTP]).await;
        let phone = loopback_endpoint(seed + 1, &[]).await;
        tauri::async_runtime::spawn(echo_host(host.clone()));
        let socket = host
            .bound_sockets()
            .into_iter()
            .find(|socket| socket.is_ipv4())
            .expect("a bound IPv4 loopback socket");
        Running::start_on(
            phone,
            SecretKey::from_bytes(&[seed + 1; 32]),
            EndpointAddr::from(host.id()).with_ip_addr(socket),
            LinkMode::Auto,
            PathEvents::new(KEPT_EVENTS),
            Some(listener),
        )
        .await
        .expect("starts")
    }

    /// The listener is up from the boot read, so a request sent before setup
    /// forwards (step 16's Live Activity token) is taken at once and answered
    /// once setup has started; and as soon as setup's start returns, a new
    /// connection is forwarded too, on that same listener.
    #[test]
    fn the_boot_listener_takes_requests_at_once_and_setup_forwards_them() {
        // The boot read's listener, on a free port here (LINK_PORT in the
        // app). Nothing forwards yet, and a request is taken all the same: it
        // waits in the backlog.
        let listener = Forward::listen(0).expect("listens on loopback");
        let addr = listener.local_addr().expect("an address");
        let early = send_request(addr, b"sent before setup");
        let boot = LinkBoot {
            host: EndpointAddr::from(SecretKey::from_bytes(&[31; 32]).public()),
            key: SecretKey::from_bytes(&[32; 32]),
            mode: LinkMode::Auto,
            listener: Mutex::new(Some(listener)),
        };

        // What setup does with it, between loopback endpoints.
        let listener = boot.take_listener().expect("the boot read's listener");
        assert!(boot.take_listener().is_none(), "setup takes it once");
        let running = block_on_within(WAIT, running_on(listener, 31)).expect("starts within 20 s");

        // As soon as that returns, a new request is forwarded, and the one
        // sent before setup has its answer too.
        assert_eq!(
            read_reply(send_request(addr, b"sent after setup")),
            b"sent after setup"
        );
        assert_eq!(read_reply(early), b"sent before setup");
        block_on_within(WAIT, running.stop()).expect("stops");
    }

    /// iOS can take a suspended app's listener away (TN2277), and the app's
    /// requests to the link are then refused (step 16, after a stay in the
    /// background). Coming back, the app finds nothing listening and listens
    /// again at once, before anything sends: a request is taken straight
    /// away, and answered once forwarding has moved to the new listener.
    #[test]
    fn a_listener_ios_took_away_is_replaced_before_anything_sends() {
        let listener = Forward::listen(0).expect("listens on loopback");
        let addr = listener.local_addr().expect("an address");
        let mut running =
            block_on_within(WAIT, running_on(listener, 33)).expect("starts within 20 s");
        assert_eq!(read_reply(send_request(addr, b"first")), b"first");
        // Still listening: nothing to do, and the check (a connection that
        // sends nothing) leaves forwarding as it was.
        assert!(listen_if_gone(addr.port()).is_none(), "it was listening");
        assert_eq!(read_reply(send_request(addr, b"second")), b"second");

        // What iOS does while the app is away: the listener goes, and a
        // request is refused.
        block_on_within(WAIT, running.stop_forwarding()).expect("within 20 s");
        assert!(
            !Forward::listening(addr.port()),
            "a request would be refused"
        );

        // Coming back: listening again at once, so a request is taken before
        // forwarding moves to the new listener...
        let again = listen_if_gone(addr.port())
            .expect("finds nothing listening")
            .expect("listens again");
        let early = send_request(addr, b"sent on coming back");
        // ...and answered once it has.
        block_on_within(WAIT, running.forward_again(Some(again), addr.port()))
            .expect("within 20 s")
            .expect("forwards again");
        assert_eq!(read_reply(early), b"sent on coming back");

        // Had the old socket still held the port, the new listener comes
        // once the old one has closed.
        block_on_within(WAIT, running.stop_forwarding()).expect("within 20 s");
        block_on_within(WAIT, running.forward_again(None, addr.port()))
            .expect("within 20 s")
            .expect("forwards again");
        assert_eq!(read_reply(send_request(addr, b"after")), b"after");
        block_on_within(WAIT, running.stop()).expect("stops");
    }

    #[test]
    fn passes_the_links_lines_at_info_and_the_rest_at_warn() {
        use tracing::Level;
        assert_eq!(threshold("kleio_link"), Level::INFO);
        assert_eq!(threshold("kleio_link::paths"), Level::INFO);
        assert_eq!(threshold("kleio_linker"), Level::WARN);
        assert_eq!(threshold("iroh::socket"), Level::WARN);
    }

    /// Each event's line as `LogBridge` writes it, for the test's own
    /// subscriber.
    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<String>>>);

    impl tracing::Subscriber for Capture {
        fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
            true
        }
        fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
            tracing::span::Id::from_u64(1)
        }
        fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
        fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
        fn event(&self, event: &tracing::Event<'_>) {
            self.0.lock().unwrap().push(render(event));
        }
        fn enter(&self, _: &tracing::span::Id) {}
        fn exit(&self, _: &tracing::span::Id) {}
    }

    #[test]
    fn writes_the_message_then_the_other_fields() {
        let capture = Capture::default();
        tracing::subscriber::with_default(capture.clone(), || {
            tracing::info!(target: "kleio_link::paths", "6ef5181507 +17.4s path selected: direct 192.168.4.68:56829");
            tracing::warn!(target: "iroh::relay", relay = "euc1-1", "relay throttled");
        });
        assert_eq!(
            *capture.0.lock().unwrap(),
            [
                "6ef5181507 +17.4s path selected: direct 192.168.4.68:56829",
                "relay throttled relay=\"euc1-1\"",
            ]
        );
    }
}
