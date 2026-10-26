//! The host's side, feature `host`: `kleio-link-host serve`, the forwarder
//! that runs next to kleio-host (docs/adr/0002-kleio-link-replaces-tailscale.md).
//!
//! - The gate, an `after_handshake` hook, decides who gets in before any
//!   stream: `kleio/http/0` only from keys on kleio-host's allow-list (a
//!   revoked device's key is told so), `kleio/pair/0` from any key, and
//!   nothing else.
//! - Each stream of an allowed `kleio/http/0` connection is copied both ways
//!   to kleio-host's link listener, which the connection's first line tells
//!   whose bytes they are (upstream.rs). When kleio-host doesn't take the
//!   connection, the stream gets a 502 that says so.
//! - Each `kleio/pair/0` connection carries one redeem request, which goes to
//!   kleio-host's `POST /kleio/pair/redeem` the same way, so kleio-host binds
//!   the new device to the phone's key. At most 10 a minute, one at a time,
//!   and at most [`MAX_UNPAIRED`] connections not yet known to be paired at
//!   once.
//! - Once a second, housekeeping (report.rs): the allow-list and the secret
//!   read again when they change, connections from keys taken off the list
//!   closed, and `link/state.json` written for kleio-host.
//! - The host is on one relay at a time, chosen from kleio-host's relay list
//!   and changed only by the rules in relays.rs: failover after 15 s without
//!   it, failback after 5 minutes.
//! - [`HostDir`] is kleio-host's state folder, where all of it lives.
//!
//! Logged: each key's short form, the ALPN, the outcome and path events, plus
//! iroh's relay warnings. Never a code, nonce, token or secret.

mod budget;
mod gate;
mod http;
mod open;
mod pairing;
mod relays;
mod report;
mod state;
mod upstream;

use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use iroh::endpoint::{Builder, Incoming, QuicTransportConfig, VarInt};
use iroh::{Endpoint, RelayMap, RelayMode, RelayUrl, SecretKey, Watcher};
use noq_proto::congestion::Bbr3Config;
use tokio::sync::Semaphore;
use tracing::{debug, info, warn};

use crate::endpoint::{builder, EndpointOptions};
use crate::probe::HttpsProbe;
use crate::{close, error_chain, paths, ALPN_HTTP, ALPN_PAIR};
use budget::PairBudget;
use gate::{AllowList, Gate};
use open::OpenLinks;
use relays::{Pinner, RelayBoard};
pub use relays::{FAILBACK_AFTER, FAILOVER_AFTER};
use report::Housekeeper;
pub use state::{save_private_json, HostDir};
use upstream::Upstream;
pub use upstream::DEFAULT_UPSTREAM;

/// The most connections not yet known to be paired, open at once: those in
/// their handshake, and pairings. One more is refused before its handshake.
pub const MAX_UNPAIRED: usize = 32;

/// What `serve` forwards to, from where, and through which relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// kleio-host's state folder, with the key, the secret and the
    /// allow-list in `secure/`, and `link/`.
    pub home: PathBuf,
    /// kleio-host's link listener: [`DEFAULT_UPSTREAM`], 127.0.0.1:8445.
    pub upstream: SocketAddr,
    /// One relay to pin, for good; `None` to follow kleio-host's relay list.
    pub relay: Option<RelayUrl>,
    /// The endpoint's mode and relay certificates: the defaults, but for
    /// tests, which go through relays only and trust their own.
    pub options: EndpointOptions,
}

/// Why a command couldn't do its job, in words a person can act on.
#[derive(Debug)]
pub struct HostError(String);

impl HostError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for HostError {}

/// A file's error, with the file it was about.
fn file_error(path: &Path, err: io::Error) -> HostError {
    HostError::new(format!("{}: {err}", path.display()))
}

/// Runs the forwarder until its endpoint closes.
pub async fn serve(config: Config) -> Result<(), HostError> {
    if !config.upstream.ip().is_loopback() {
        return Err(HostError::new(format!(
            "kleio-host's link listener is on this machine, not {}",
            config.upstream
        )));
    }
    let dir = HostDir::new(&config.home);
    let secret_key = dir.secret_key()?;
    let upstream = Arc::new(Upstream::new(config.upstream, dir.upstream_token()?));
    let allow = Arc::new(AllowList::load(dir.allow_path())?);
    dir.make_link_dir()?;
    let board = RelayBoard::default();
    let pinner = match &config.relay {
        Some(_) => None,
        None => {
            let list = relays::read_config(&dir.config_path())?;
            let probe = HttpsProbe::new(&config.options.trust).map_err(HostError::new)?;
            let pinning = relays::start(&list.0, &probe).await;
            board.set(pinning.board(tokio::time::Instant::now()));
            Some((list, probe, pinning))
        }
    };
    let relay_mode = match (&config.relay, &pinner) {
        (Some(relay), _) => RelayMode::custom([relay.clone()]),
        (None, Some((_, _, pinning))) => {
            RelayMode::Custom(RelayMap::from(pinning.current().clone()))
        }
        (None, None) => unreachable!("without --relay there's a pinning"),
    };
    let endpoint = host_builder(secret_key, relay_mode, &config.options, Arc::clone(&allow))
        .bind()
        .await
        .map_err(|err| {
            HostError::new(format!("Can't start the endpoint: {}", error_chain(&err)))
        })?;
    info!(
        "serving as {}, for kleio-host at {} from {}; {} keys on the allow-list",
        endpoint.id(),
        config.upstream,
        dir.path().display(),
        allow.len()
    );
    let open = OpenLinks::default();
    tokio::spawn(watch_relay(endpoint.clone(), config.relay.is_some()));
    let pinned = pinner.is_none();
    if let Some((list, probe, pinning)) = pinner {
        let path = dir.config_path();
        let pinner = Pinner::new(endpoint.clone(), probe, pinning, board.clone(), path, list);
        tokio::spawn(pinner.run());
    }
    tokio::spawn(
        Housekeeper::new(
            endpoint.clone(),
            dir,
            Arc::clone(&allow),
            Arc::clone(&upstream),
            open.clone(),
        )
        .with_relays((!pinned).then_some(board))
        .run(),
    );
    Server::new(upstream, allow, open, MAX_UNPAIRED)
        .run(endpoint)
        .await;
    Ok(())
}

/// The host's endpoint: the shared builder, with the two ALPNs, the gate
/// and its congestion control ([`transport`]).
fn host_builder(
    secret_key: SecretKey,
    relay_mode: RelayMode,
    options: &EndpointOptions,
    allow: Arc<AllowList>,
) -> Builder {
    builder(secret_key, relay_mode, options)
        .alpns(vec![ALPN_HTTP.to_vec(), ALPN_PAIR.to_vec()])
        .hooks(Gate::new(allow))
        .transport_config(transport())
}

/// The host's QUIC transport: iroh's default, with BBRv3 congestion control
/// in place of Cubic, so a big answer through a shared relay doesn't hold
/// up the connection's other answers.
///
/// A shared relay such as n0's limits what each endpoint sends it, to about
/// 1 MB/s, by reading more slowly rather than by dropping what's over. Cubic
/// slows down only for loss, so it never slowed: a big answer filled the
/// relay's path up to its stream's flow-control window, and every other
/// answer waited behind it. In Phase 2's check, while a 45 MiB file came
/// through n0's relay, the round trip went from 0.1 s to 8.8 s and chats
/// waited up to 20 s. BBRv3 paces at the rate the path delivers and keeps
/// about a round trip's worth in flight, so the relay's queue stays short.
///
/// Through a test relay limited to 1 MiB/s, with a 45 MiB answer
/// (tests/pacing.rs): requests alongside it took 0.2 s at most, against
/// 1.2–2.1 s with Cubic, and the answer came at 95% of the relay's limit
/// either way. On a direct path it measured the same as Cubic. Only the host sends
/// big answers, so the phone keeps iroh's default.
fn transport() -> QuicTransportConfig {
    QuicTransportConfig::builder()
        .congestion_controller_factory(Arc::new(Bbr3Config::default()))
        .build()
}

/// Logs the relay the host is reached through each time it changes.
async fn watch_relay(endpoint: Endpoint, pinned: bool) {
    let mut statuses = endpoint.home_relay_status();
    let mut current: Option<RelayUrl> = None;
    loop {
        let now = statuses.get();
        let connected = now
            .iter()
            .find(|status| status.is_connected())
            .map(|status| status.url().clone());
        if connected != current {
            match &connected {
                Some(relay) if pinned => info!("relay: connected to {relay}, pinned by --relay"),
                Some(relay) => info!("relay: connected to {relay}"),
                None => {
                    let why = now
                        .iter()
                        .find_map(|status| status.last_error())
                        .map(|err| err.to_string())
                        .unwrap_or_else(|| "no error given".into());
                    warn!("relay: not connected: {why}");
                }
            }
            current = connected;
        }
        if statuses.updated().await.is_err() {
            return;
        }
    }
}

/// What each accepted connection needs.
#[derive(Clone)]
struct Server {
    upstream: Arc<Upstream>,
    allow: Arc<AllowList>,
    budget: PairBudget,
    open: OpenLinks,
    unpaired: Arc<Semaphore>,
}

impl Server {
    fn new(
        upstream: Arc<Upstream>,
        allow: Arc<AllowList>,
        open: OpenLinks,
        max_unpaired: usize,
    ) -> Self {
        Self {
            upstream,
            allow,
            budget: PairBudget::default(),
            open,
            unpaired: Arc::new(Semaphore::new(max_unpaired)),
        }
    }

    /// Serves connections until the endpoint closes.
    async fn run(self, endpoint: Endpoint) {
        while let Some(incoming) = endpoint.accept().await {
            tokio::spawn(self.clone().handle(incoming));
        }
    }

    async fn handle(self, incoming: Incoming) {
        // Held until the connection is known to be paired, or for the whole
        // of a pairing.
        let Ok(unpaired) = Arc::clone(&self.unpaired).try_acquire_owned() else {
            warn!("refused a connection: {MAX_UNPAIRED} not yet known to be paired are open");
            incoming.refuse();
            return;
        };
        let conn = match incoming.await {
            Ok(conn) => conn,
            // The gate logs each connection it turns away.
            Err(err) => {
                debug!("connection not set up: {}", error_chain(&err));
                return;
            }
        };
        paths::spawn_log(&conn);
        if conn.alpn() == ALPN_HTTP {
            // The gate let it in, so its key is on the allow-list.
            drop(unpaired);
            self.open.add(&conn);
            http::serve(conn, self.upstream).await;
        } else if conn.alpn() == ALPN_PAIR {
            pairing::serve(conn, &self.upstream, &self.allow, &self.budget).await;
            drop(unpaired);
        } else {
            // The gate turns these away first.
            conn.close(VarInt::from_u32(close::UNKNOWN_ALPN), b"unknown protocol");
        }
    }
}

/// The host with loopback endpoints, a stand-in for kleio-host's link
/// listener and the phone's loopback forward: the gate, the first line, the
/// 502, pairing, revoking and the state file, end to end.
// Every test here runs the forwarder in a state folder, which only POSIX
// modes allow (state.rs).
#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use iroh::endpoint::{ConnectError, ConnectingError, ConnectionError};
    use iroh::EndpointId;
    use serde_json::{json, Value};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::mpsc;

    use super::*;
    use crate::forward::Forward;
    use crate::link::Link;
    use crate::pair::{redeem, PairError, Refusal};
    use crate::testing::{
        loopback_addr, loopback_endpoint, mode, on_loopback, within_30_s, TempDir,
    };

    const REQUEST: &[u8] = b"GET /kleio/health HTTP/1.1\r\nhost: link.kleio.invalid\r\n\r\n";

    /// The secret the tests' kleio-host expects.
    const SECRET: &str = "Sx3_Sx3_Sx3_Sx3_Sx3_Sx3_Sx3_Sx3_Sx3_Sx3_abc";

    /// An answer as kleio-host's `json()` writes one.
    fn http_answer(status: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    /// The allow-list kleio-host would write.
    fn allow_doc(devices: &[(EndpointId, &str)], revoked: &[EndpointId]) -> String {
        let devices: Vec<Value> = devices
            .iter()
            .map(|(key, label)| {
                json!({"key": key.to_string(), "deviceId": format!("id-{label}"), "label": label})
            })
            .collect();
        let revoked: Vec<String> = revoked.iter().map(ToString::to_string).collect();
        json!({"version": 1, "devices": devices, "revoked": revoked}).to_string()
    }

    /// What the stand-in for kleio-host got: each connection's first line,
    /// and its request.
    type Received = mpsc::UnboundedReceiver<(String, Vec<u8>)>;

    /// A stand-in for kleio-host's link listener. It hands the test each
    /// connection's first line and request, then answers with `answer`, or
    /// with `None` never answers. With `pairs`, it first writes the
    /// allow-list with the key the first line names, as kleio-host does
    /// before it answers a redeem.
    async fn fake_kleio_host(
        answer: Option<Vec<u8>>,
        pairs: Option<PathBuf>,
    ) -> (SocketAddr, Received) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("binds");
        let addr = listener.local_addr().expect("has an address");
        let (requests, received) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((mut tcp, _)) = listener.accept().await {
                let requests = requests.clone();
                let answer = answer.clone();
                let pairs = pairs.clone();
                tokio::spawn(async move {
                    let (line, request) = read_request(&mut tcp).await;
                    if let Some(path) = &pairs {
                        let key = line.split(' ').nth(1).unwrap_or_default();
                        let key: EndpointId = key.parse().expect("the line names a key");
                        fs::write(path, allow_doc(&[(key, "Test iPhone")], &[])).expect("written");
                    }
                    let _ = requests.send((line, request));
                    match answer {
                        Some(answer) => {
                            let _ = tcp.write_all(&answer).await;
                            let _ = tcp.shutdown().await;
                        }
                        None => std::future::pending::<()>().await,
                    }
                });
            }
        });
        (addr, received)
    }

    /// One connection's first line, and its request: the head, and the body
    /// its `content-length` gives.
    async fn read_request(tcp: &mut TcpStream) -> (String, Vec<u8>) {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            if let Some(nl) = bytes.iter().position(|&b| b == b'\n') {
                let request = &bytes[nl + 1..];
                if let Some(end) = pairing::head_end(request) {
                    let head = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                    let length = head
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        let line = String::from_utf8_lossy(&bytes[..=nl]).into_owned();
                        return (line, request.to_vec());
                    }
                }
            }
            match tcp.read(&mut chunk).await {
                Ok(0) | Err(_) => {
                    return (String::from_utf8_lossy(&bytes).into_owned(), Vec::new())
                }
                Ok(n) => bytes.extend_from_slice(&chunk[..n]),
            }
        }
    }

    /// A loopback port nothing listens on.
    async fn closed_port() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("binds");
        listener.local_addr().expect("has an address")
    }

    struct Rig {
        host: Endpoint,
        allow: Arc<AllowList>,
        dir: HostDir,
        _tmp: TempDir,
    }

    /// kleio-host's state folder, with an empty allow-list.
    fn host_dir(tmp: &TempDir) -> HostDir {
        let dir = HostDir::new(tmp.path().join("host"));
        let secure = dir.path().join("secure");
        fs::create_dir_all(&secure).expect("made");
        fs::set_permissions(&secure, fs::Permissions::from_mode(0o700)).expect("set");
        fs::write(dir.allow_path(), allow_doc(&[], &[])).expect("written");
        dir
    }

    /// The forwarder on loopback, with housekeeping, forwarding to
    /// `upstream`, taking at most `max_unpaired` unpaired connections.
    async fn start_host_with(tmp: TempDir, upstream: SocketAddr, max_unpaired: usize) -> Rig {
        let dir = host_dir(&tmp);
        let allow = Arc::new(AllowList::load(dir.allow_path()).expect("loads"));
        let host = on_loopback(host_builder(
            SecretKey::from_bytes(&[1; 32]),
            RelayMode::Disabled,
            &EndpointOptions::default(),
            Arc::clone(&allow),
        ))
        .bind()
        .await
        .expect("binds");
        let upstream = Arc::new(Upstream::new(upstream, SECRET.into()));
        let open = OpenLinks::default();
        dir.make_link_dir().expect("made");
        let server = Server::new(
            Arc::clone(&upstream),
            Arc::clone(&allow),
            open.clone(),
            max_unpaired,
        );
        tokio::spawn(server.run(host.clone()));
        let housekeeper = Housekeeper::new(
            host.clone(),
            dir.clone(),
            Arc::clone(&allow),
            upstream,
            open,
        );
        tokio::spawn(housekeeper.run());
        Rig {
            host,
            allow,
            dir,
            _tmp: tmp,
        }
    }

    async fn start_host(name: &str, upstream: SocketAddr) -> Rig {
        start_host_with(TempDir::new(name), upstream, MAX_UNPAIRED).await
    }

    impl Rig {
        /// kleio-host pairs `keys`: the allow-list it writes, read at once.
        fn pair(&self, keys: &[EndpointId], revoked: &[EndpointId]) {
            let devices: Vec<(EndpointId, &str)> = keys.iter().map(|key| (*key, "Phone")).collect();
            fs::write(self.dir.allow_path(), allow_doc(&devices, revoked)).expect("written");
            self.allow.reload().expect("reads");
        }
    }

    /// The phone's loopback forward to `host`, dialling from `phone`.
    async fn forward_from(phone: Endpoint, host: &Endpoint) -> SocketAddr {
        let link = Link::new(phone, loopback_addr(host).into());
        let forward = Forward::bind(0, link).await.expect("binds");
        let addr = forward.local_addr().expect("has an address");
        tokio::spawn(forward.run());
        addr
    }

    /// Sends `body` on a new TCP connection, half-closes it, and returns all
    /// that comes back: nothing, if the connection is dropped.
    async fn round_trip(addr: SocketAddr, body: &[u8]) -> Vec<u8> {
        let mut tcp = TcpStream::connect(addr).await.expect("connects");
        let _ = tcp.write_all(body).await;
        let _ = tcp.shutdown().await;
        let mut back = Vec::new();
        let _ = tcp.read_to_end(&mut back).await;
        back
    }

    /// The application close code of `reason`, if it was one.
    fn app_code(reason: ConnectionError) -> Option<u64> {
        match reason {
            ConnectionError::ApplicationClosed(app_close) => {
                Some(app_close.error_code.into_inner())
            }
            _ => None,
        }
    }

    /// The close code `endpoint` gets when it dials `host` on `alpn`.
    async fn close_code(endpoint: &Endpoint, host: &Endpoint, alpn: &[u8]) -> Option<u64> {
        let reason = match endpoint.connect(loopback_addr(host), alpn).await {
            Ok(conn) => conn.closed().await,
            Err(ConnectError::Connection { source, .. }) => source,
            Err(ConnectError::Connecting {
                source: ConnectingError::ConnectionError { source, .. },
                ..
            }) => source,
            Err(err) => panic!("the dial failed: {err}"),
        };
        app_code(reason)
    }

    /// kleio-host's state file, once it says `ready`.
    async fn state_when(dir: &HostDir, ready: impl Fn(&Value) -> bool) -> Value {
        loop {
            if let Ok(bytes) = fs::read(dir.state_path()) {
                if let Ok(state) = serde_json::from_slice::<Value>(&bytes) {
                    if ready(&state) {
                        return state;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Neither publishing where it is nor asking where others are.
    #[tokio::test]
    async fn the_host_has_no_address_lookup() {
        within_30_s(async {
            let rig = start_host("host-no-lookup", closed_port().await).await;
            let lookup = rig.host.address_lookup().expect("open");
            assert!(lookup.is_empty(), "no address lookup");
        })
        .await;
    }

    #[tokio::test]
    async fn forwards_a_paired_keys_streams_naming_its_key_with_the_secret() {
        within_30_s(async {
            let answer = http_answer("200 OK", r#"{"ok":true}"#);
            let (upstream, mut requests) = fake_kleio_host(Some(answer.clone()), None).await;
            let rig = start_host("host-paired", upstream).await;
            let phone = loopback_endpoint(2, &[]).await;
            rig.pair(&[phone.id()], &[]);

            let forward = forward_from(phone.clone(), &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, answer);
            let (line, request) = requests.recv().await.expect("a request");
            assert_eq!(line, format!("KLEIO-LINK/1 {} {SECRET}\r\n", phone.id()));
            assert_eq!(request, REQUEST);
        })
        .await;
    }

    #[tokio::test]
    async fn turns_away_an_unknown_key_and_tells_a_revoked_one_so() {
        within_30_s(async {
            let answer = http_answer("200 OK", r#"{"ok":true}"#);
            let (upstream, mut requests) = fake_kleio_host(Some(answer), None).await;
            let rig = start_host("host-unknown", upstream).await;
            let stranger = loopback_endpoint(3, &[]).await;
            let revoked = loopback_endpoint(4, &[]).await;
            rig.pair(&[], &[revoked.id()]);

            assert_eq!(
                close_code(&stranger, &rig.host, ALPN_HTTP).await,
                Some(close::NOT_PAIRED.into())
            );
            assert_eq!(
                close_code(&revoked, &rig.host, ALPN_HTTP).await,
                Some(close::REVOKED.into())
            );
            // Through the loopback forward, a request gets no answer at all.
            let forward = forward_from(stranger, &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, b"");
            assert!(requests.try_recv().is_err(), "a request reached kleio-host");
        })
        .await;
    }

    #[tokio::test]
    async fn revoking_closes_an_open_connection_within_2_s() {
        within_30_s(async {
            let answer = http_answer("200 OK", r#"{"ok":true}"#);
            let (upstream, _requests) = fake_kleio_host(Some(answer), None).await;
            let rig = start_host("host-revoke", upstream).await;
            let (phone, other) = (
                loopback_endpoint(2, &[]).await,
                loopback_endpoint(3, &[]).await,
            );
            rig.pair(&[phone.id(), other.id()], &[]);
            let conn = phone
                .connect(loopback_addr(&rig.host), ALPN_HTTP)
                .await
                .expect("let in");
            let kept = other
                .connect(loopback_addr(&rig.host), ALPN_HTTP)
                .await
                .expect("let in");

            // kleio-host revokes the phone; housekeeping reads the list.
            fs::write(
                rig.dir.allow_path(),
                allow_doc(&[(other.id(), "Other")], &[phone.id()]),
            )
            .expect("written");
            let closed = tokio::time::timeout(Duration::from_secs(2), conn.closed())
                .await
                .expect("closed within 2 s");
            assert_eq!(app_code(closed), Some(close::REVOKED.into()));
            assert!(
                kept.close_reason().is_none(),
                "the other device stays connected"
            );
        })
        .await;
    }

    #[tokio::test]
    async fn answers_502_saying_kleio_is_down_when_kleio_host_is() {
        within_30_s(async {
            let rig = start_host("host-502", closed_port().await).await;
            let phone = loopback_endpoint(2, &[]).await;
            rig.pair(&[phone.id()], &[]);

            let forward = forward_from(phone, &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, http::BAD_GATEWAY);
        })
        .await;
    }

    #[tokio::test]
    async fn pairing_goes_through_the_link_listener_naming_the_phones_key() {
        within_30_s(async {
            let tmp = TempDir::new("host-pair");
            let allow_path = tmp.path().join("host/secure/link-allow.json");
            let paired = http_answer(
                "200 OK",
                r#"{"ok":true,"payload":{"host":"mini","token":"t0k3n","label":"Test iPhone","deviceId":"d1"}}"#,
            );
            let (upstream, mut requests) = fake_kleio_host(Some(paired.clone()), Some(allow_path)).await;
            let rig = start_host_with(tmp, upstream, MAX_UNPAIRED).await;
            let phone = loopback_endpoint(2, &[]).await;

            let payload = redeem(&phone, loopback_addr(&rig.host), "ABC-DEF", "Test iPhone")
                .await
                .expect("pairs");
            assert_eq!(payload["deviceId"], "d1");

            // kleio-host got the phone's key and its redeem body, and only that.
            let (line, request) = requests.recv().await.expect("a request");
            assert_eq!(line, format!("KLEIO-LINK/1 {} {SECRET}\r\n", phone.id()));
            assert!(request.starts_with(b"POST /kleio/pair/redeem HTTP/1.1\r\nhost: link.kleio.invalid\r\n"));
            let end = pairing::head_end(&request).expect("a whole request");
            let sent: Value = serde_json::from_slice(&request[end + 4..]).expect("JSON");
            assert_eq!(sent["code"], "ABCDEF");
            assert_eq!(sent["label"], "Test iPhone");
            assert_eq!(sent["redemptionNonce"].as_str().map(str::len), Some(32));
            assert_eq!(sent.as_object().map(|fields| fields.len()), Some(3));

            // The list kleio-host wrote was read before the phone got its
            // answer, so its HTTP gets through at once.
            assert!(rig.allow.contains(&phone.id()));
            let forward = forward_from(phone, &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, paired);
        })
        .await;
    }

    #[tokio::test]
    async fn a_pairing_kleio_host_couldnt_write_down_still_gets_in() {
        within_30_s(async {
            let paired = http_answer(
                "200 OK",
                r#"{"ok":true,"payload":{"host":"mini","token":"t0k3n","label":"Test iPhone","deviceId":"d1"}}"#,
            );
            // kleio-host answers, but its allow-list write failed.
            let (upstream, _requests) = fake_kleio_host(Some(paired), None).await;
            let rig = start_host("host-pair-unwritten", upstream).await;
            let phone = loopback_endpoint(2, &[]).await;
            redeem(&phone, loopback_addr(&rig.host), "ABC-DEF", "Test iPhone")
                .await
                .expect("pairs");
            assert!(rig.allow.contains(&phone.id()));
        })
        .await;
    }

    #[tokio::test]
    async fn a_refused_code_adds_no_key() {
        within_30_s(async {
            let refused = http_answer("410 Gone", r#"{"ok":false,"error":"used"}"#);
            let (upstream, _requests) = fake_kleio_host(Some(refused), None).await;
            let rig = start_host("host-pair-refused", upstream).await;
            let phone = loopback_endpoint(2, &[]).await;

            let outcome = redeem(&phone, loopback_addr(&rig.host), "ABC-DEF", "Test iPhone").await;
            assert_eq!(outcome, Err(PairError::Refused(Refusal::Used)));
            assert!(!rig.allow.contains(&phone.id()));
        })
        .await;
    }

    #[tokio::test]
    async fn turns_away_a_second_pairing_while_one_is_in_flight() {
        within_30_s(async {
            // kleio-host takes the first request and never answers it.
            let (upstream, mut requests) = fake_kleio_host(None, None).await;
            let rig = start_host("host-pair-busy", upstream).await;
            let first = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&rig.host);
            let pending =
                tokio::spawn(async move { redeem(&first, addr, "ABC-DEF", "First").await });
            // Once its request reaches kleio-host, the first pairing has the turn.
            requests.recv().await.expect("the first request");

            let second = loopback_endpoint(3, &[]).await;
            assert_eq!(
                close_code(&second, &rig.host, ALPN_PAIR).await,
                Some(close::PAIR_BUSY.into())
            );
            assert!(
                requests.try_recv().is_err(),
                "a second request reached kleio-host"
            );
            pending.abort();
        })
        .await;
    }

    #[tokio::test]
    async fn refuses_connections_past_the_unpaired_cap_before_their_handshake() {
        within_30_s(async {
            let (upstream, mut requests) = fake_kleio_host(None, None).await;
            let rig = start_host_with(TempDir::new("host-unpaired-cap"), upstream, 1).await;
            let first = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&rig.host);
            let pending =
                tokio::spawn(async move { redeem(&first, addr, "ABC-DEF", "First").await });
            requests.recv().await.expect("the first request");

            // Refused outright, not closed by the budget after a handshake.
            let second = loopback_endpoint(3, &[]).await;
            assert_eq!(close_code(&second, &rig.host, ALPN_PAIR).await, None);
            pending.abort();
        })
        .await;
    }

    #[tokio::test]
    async fn writes_its_state_for_kleio_host() {
        within_30_s(async {
            let answer = http_answer("200 OK", r#"{"ok":true}"#);
            let (upstream, _requests) = fake_kleio_host(Some(answer.clone()), None).await;
            let rig = start_host("host-state", upstream).await;
            let state = state_when(&rig.dir, |_| true).await;
            assert_eq!(state["version"], 1);
            assert_eq!(state["pid"], std::process::id());
            assert_eq!(state["key"], rig.host.id().to_string());
            assert_eq!(state["relay"], Value::Null, "no relay in the tests");
            assert_eq!(state["rateLimited"], false);
            assert_eq!(state["connections"], 0);
            assert!(state["updatedAt"]
                .as_str()
                .is_some_and(|at| at.ends_with('Z')));
            assert!(
                state["addrs"]
                    .as_array()
                    .is_some_and(|addrs| addrs.is_empty()),
                "loopback only"
            );
            assert_eq!(mode(&rig.dir.state_path()), 0o600);

            let phone = loopback_endpoint(2, &[]).await;
            rig.pair(&[phone.id()], &[]);
            let forward = forward_from(phone.clone(), &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, answer);
            let state = state_when(&rig.dir, |state| state["connections"] == 1).await;
            assert_eq!(state["peers"][0]["key"], phone.id().to_string());
            assert_eq!(state["peers"][0]["path"], "direct");
        })
        .await;
    }

    #[tokio::test]
    async fn takes_kleio_hosts_new_secret() {
        within_30_s(async {
            let answer = http_answer("200 OK", r#"{"ok":true}"#);
            let (upstream, mut requests) = fake_kleio_host(Some(answer), None).await;
            let rig = start_host("host-new-secret", upstream).await;
            let phone = loopback_endpoint(2, &[]).await;
            rig.pair(&[phone.id()], &[]);

            let fresh = "N3w_".repeat(10) + "xyz";
            let token = rig.dir.token_path();
            fs::write(&token, format!("{fresh}\n")).expect("written");
            fs::set_permissions(&token, fs::Permissions::from_mode(0o600)).expect("set");
            // Housekeeping reads it within a tick or two.
            tokio::time::sleep(Duration::from_millis(2500)).await;
            let forward = forward_from(phone.clone(), &rig.host).await;
            round_trip(forward, REQUEST).await;
            let (line, _) = requests.recv().await.expect("a request");
            assert_eq!(line, format!("KLEIO-LINK/1 {} {fresh}\r\n", phone.id()));
        })
        .await;
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;

    /// The host changes only its congestion control: noq's `Debug` leaves the
    /// controller out, so the rest, the idle timeout among it, reads as
    /// iroh's default.
    #[test]
    fn the_host_changes_only_its_congestion_control() {
        let default = format!("{:?}", QuicTransportConfig::default());
        assert_eq!(format!("{:?}", transport()), default);
        let idle = format!(
            "max_idle_timeout: Some({})",
            crate::endpoint::IDLE_TIMEOUT.as_millis()
        );
        assert!(default.contains(&idle), "iroh's default config: {default}");
    }
}
