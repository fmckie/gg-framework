//! The host's side, feature `host`: `kleio-link-host serve`, the forwarder
//! that runs next to kleio-host.
//!
//! - The gate, an `after_handshake` hook, decides who gets in before any
//!   stream: `kleio/http/0` only from keys on the allow-list, `kleio/pair/0`
//!   from any key, and nothing else.
//! - Each stream of an allowed `kleio/http/0` connection is copied both ways
//!   to kleio-host over TCP. When kleio-host doesn't take the connection, the
//!   stream gets a minimal `HTTP/1.1 502`, as `tailscale serve` answers today.
//! - Each `kleio/pair/0` connection carries one redeem request, which goes to
//!   kleio-host's `POST /kleio/pair/redeem`; on `ok: true` the key goes on the
//!   allow-list. At most 10 a minute, one at a time.
//! - [`StateDir`] keeps the host's key, the allow-list and its relay.
//!
//! Logged: each key's short form, the ALPN, the outcome and path events, plus
//! iroh's relay warnings. Never a code, nonce or token.

mod budget;
mod gate;
mod http;
mod pairing;
mod state;

use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use iroh::endpoint::{Builder, Incoming, VarInt};
use iroh::{Endpoint, RelayMode, RelayUrl, SecretKey, Watcher};
use tokio::net::TcpStream;
use tracing::{debug, info, warn};

use crate::endpoint::{builder, Mode};
use crate::{close, error_chain, paths, ALPN_HTTP, ALPN_PAIR};
use budget::PairBudget;
use gate::{AllowList, Gate};
pub use state::StateDir;

/// How long kleio-host gets to take a TCP connection.
const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// What `serve` forwards to, and through which relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// kleio-host's loopback address: `127.0.0.1:8443` on the mini.
    pub upstream: SocketAddr,
    /// The relay to pin, or `None` to pick one of n0's.
    pub relay: Option<RelayUrl>,
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
pub async fn serve(state: &StateDir, config: Config) -> Result<(), HostError> {
    let secret_key = state.secret_key()?;
    let allow = Arc::new(AllowList::load(state.allow_path())?);
    let relay_mode = match &config.relay {
        Some(relay) => RelayMode::custom([relay.clone()]),
        None => RelayMode::Default,
    };
    let endpoint = host_builder(secret_key, relay_mode, Arc::clone(&allow))
        .bind()
        .await
        .map_err(|err| {
            HostError::new(format!("Can't start the endpoint: {}", error_chain(&err)))
        })?;
    info!(
        "serving as {}, for kleio-host at {}; {} keys on the allow-list",
        endpoint.id(),
        config.upstream,
        allow.len()
    );
    tokio::spawn(watch_relay(
        endpoint.clone(),
        state.clone(),
        config.relay.is_some(),
    ));
    Server::new(config.upstream, allow).run(endpoint).await;
    Ok(())
}

/// The host's endpoint: the shared builder, with the two ALPNs and the gate.
fn host_builder(secret_key: SecretKey, relay_mode: RelayMode, allow: Arc<AllowList>) -> Builder {
    builder(secret_key, relay_mode, Mode::Auto)
        .alpns(vec![ALPN_HTTP.to_vec(), ALPN_PAIR.to_vec()])
        .hooks(Gate::new(allow))
}

/// Logs the relay the host is reached through each time it changes, and
/// records it for `qr`.
async fn watch_relay(endpoint: Endpoint, state: StateDir, pinned: bool) {
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
                Some(relay) if pinned => info!("relay: connected to {relay}, pinned"),
                Some(relay) => info!("relay: connected to {relay}; pin it with --relay {relay}"),
                None => {
                    let why = now
                        .iter()
                        .find_map(|status| status.last_error())
                        .map(|err| err.to_string())
                        .unwrap_or_else(|| "no error given".into());
                    warn!("relay: not connected: {why}");
                }
            }
            if let Some(relay) = &connected {
                if let Err(err) = state.record_relay(relay) {
                    warn!("relay: couldn't record it for `qr`: {err}");
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
    upstream: SocketAddr,
    allow: Arc<AllowList>,
    budget: PairBudget,
}

impl Server {
    fn new(upstream: SocketAddr, allow: Arc<AllowList>) -> Self {
        Self {
            upstream,
            allow,
            budget: PairBudget::default(),
        }
    }

    /// Serves connections until the endpoint closes.
    async fn run(self, endpoint: Endpoint) {
        while let Some(incoming) = endpoint.accept().await {
            tokio::spawn(self.clone().handle(incoming));
        }
    }

    async fn handle(self, incoming: Incoming) {
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
            http::serve(conn, self.upstream).await;
        } else if conn.alpn() == ALPN_PAIR {
            pairing::serve(conn, self.upstream, &self.allow, &self.budget).await;
        } else {
            // The gate turns these away first.
            conn.close(VarInt::from_u32(close::UNKNOWN_ALPN), b"unknown protocol");
        }
    }
}

/// A TCP connection to kleio-host, within [`UPSTREAM_CONNECT_TIMEOUT`].
async fn connect_upstream(upstream: SocketAddr) -> io::Result<TcpStream> {
    let tcp = tokio::time::timeout(UPSTREAM_CONNECT_TIMEOUT, TcpStream::connect(upstream))
        .await
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "no connection within {} s",
                    UPSTREAM_CONNECT_TIMEOUT.as_secs()
                ),
            )
        })??;
    // Small writes, such as one event of a stream, go out at once instead of
    // waiting on Nagle's algorithm. The field tests time them.
    if let Err(err) = tcp.set_nodelay(true) {
        debug!("couldn't turn off Nagle's algorithm: {err}");
    }
    Ok(tcp)
}

/// The host with loopback endpoints, a stand-in for kleio-host and the
/// phone's loopback forward: the gate, the 502 and pairing, end to end.
#[cfg(test)]
mod tests {
    use std::fs;

    use iroh::endpoint::{ConnectError, ConnectingError, ConnectionError};
    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    use super::gate::Device;
    use super::*;
    use crate::forward::Forward;
    use crate::link::Link;
    use crate::pair::{redeem, PairError};
    use crate::testing::{
        loopback_addr, loopback_endpoint, mode, on_loopback, within_30_s, TempDir,
    };

    const REQUEST: &[u8] = b"GET /kleio/health HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n";

    /// An answer as kleio-host's `json()` writes one.
    fn http_answer(status: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    /// A stand-in for kleio-host. It hands the test each request it gets,
    /// then answers with `answer`, or with `None` never answers.
    async fn fake_kleio_host(
        answer: Option<Vec<u8>>,
    ) -> (SocketAddr, mpsc::UnboundedReceiver<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("binds");
        let addr = listener.local_addr().expect("has an address");
        let (requests, received) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((mut tcp, _)) = listener.accept().await {
                let requests = requests.clone();
                let answer = answer.clone();
                tokio::spawn(async move {
                    let _ = requests.send(read_request(&mut tcp).await);
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

    /// One request: its head, and the body its `content-length` gives.
    async fn read_request(tcp: &mut TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            if let Some(end) = pairing::head_end(&request) {
                let head = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                let length = head
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .and_then(|value| value.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    return request;
                }
            }
            match tcp.read(&mut chunk).await {
                Ok(0) | Err(_) => return request,
                Ok(n) => request.extend_from_slice(&chunk[..n]),
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
        state: StateDir,
        _dir: TempDir,
    }

    /// The forwarder on loopback, in a state folder of its own, forwarding
    /// to `upstream`.
    async fn start_host(name: &str, upstream: SocketAddr) -> Rig {
        let dir = TempDir::new(name);
        let state = StateDir::open(dir.path().join("link-proto")).expect("opens");
        let allow = Arc::new(AllowList::load(state.allow_path()).expect("loads"));
        let host = on_loopback(host_builder(
            SecretKey::from_bytes(&[1; 32]),
            RelayMode::Disabled,
            Arc::clone(&allow),
        ))
        .bind()
        .await
        .expect("binds");
        tokio::spawn(Server::new(upstream, Arc::clone(&allow)).run(host.clone()));
        Rig {
            host,
            allow,
            state,
            _dir: dir,
        }
    }

    /// The phone's loopback forward to `host`, dialling from `phone`.
    async fn forward_from(phone: Endpoint, host: &Endpoint) -> SocketAddr {
        let link = Link::new(phone, loopback_addr(host));
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
        match reason {
            ConnectionError::ApplicationClosed(app_close) => {
                Some(app_close.error_code.into_inner())
            }
            _ => None,
        }
    }

    #[tokio::test]
    async fn forwards_a_paired_keys_streams_to_kleio_host() {
        within_30_s(async {
            let answer = http_answer("200 OK", r#"{"ok":true}"#);
            let (upstream, mut requests) = fake_kleio_host(Some(answer.clone())).await;
            let rig = start_host("host-paired", upstream).await;
            let phone = loopback_endpoint(2, &[]).await;
            rig.allow.add(phone.id(), Device::default()).expect("saves");

            let forward = forward_from(phone, &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, answer);
            assert_eq!(requests.recv().await.expect("a request"), REQUEST);
        })
        .await;
    }

    #[tokio::test]
    async fn turns_away_an_unknown_key_before_any_stream() {
        within_30_s(async {
            let answer = http_answer("200 OK", r#"{"ok":true}"#);
            let (upstream, mut requests) = fake_kleio_host(Some(answer)).await;
            let rig = start_host("host-unknown", upstream).await;
            let stranger = loopback_endpoint(3, &[]).await;

            assert_eq!(
                close_code(&stranger, &rig.host, ALPN_HTTP).await,
                Some(close::NOT_PAIRED.into())
            );
            // Through the loopback forward, a request gets no answer at all.
            let forward = forward_from(stranger, &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, b"");
            assert!(requests.try_recv().is_err(), "a request reached kleio-host");
        })
        .await;
    }

    #[tokio::test]
    async fn answers_502_when_kleio_host_is_down() {
        within_30_s(async {
            let rig = start_host("host-502", closed_port().await).await;
            let phone = loopback_endpoint(2, &[]).await;
            rig.allow.add(phone.id(), Device::default()).expect("saves");

            let forward = forward_from(phone, &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, http::BAD_GATEWAY);
        })
        .await;
    }

    #[tokio::test]
    async fn pairing_puts_the_key_on_the_allow_list() {
        within_30_s(async {
            let paired = http_answer(
                "200 OK",
                r#"{"ok":true,"payload":{"baseUrl":"https://mini.example.ts.net:8443","host":"mini","token":"t0k3n","label":"Test iPhone","deviceId":"d1"}}"#,
            );
            let (upstream, mut requests) = fake_kleio_host(Some(paired.clone())).await;
            let rig = start_host("host-pair", upstream).await;
            let phone = loopback_endpoint(2, &[]).await;

            let payload = redeem(&phone, loopback_addr(&rig.host), "ABC-DEF", "Test iPhone")
                .await
                .expect("pairs");
            assert_eq!(payload["deviceId"], "d1");

            // kleio-host got its redeem body, and only that.
            let request = requests.recv().await.expect("a request");
            assert!(request.starts_with(b"POST /kleio/pair/redeem HTTP/1.1\r\n"));
            let end = pairing::head_end(&request).expect("a whole request");
            let sent: Value = serde_json::from_slice(&request[end + 4..]).expect("JSON");
            assert_eq!(sent["code"], "ABCDEF");
            assert_eq!(sent["label"], "Test iPhone");
            assert_eq!(sent["redemptionNonce"].as_str().map(str::len), Some(32));
            assert_eq!(sent.as_object().map(|fields| fields.len()), Some(3));

            // The key is on the allow-list, saved 0600, without the token.
            assert!(rig.allow.contains(&phone.id()));
            let file = rig.state.allow_path();
            assert_eq!(mode(&file), 0o600);
            let saved = fs::read_to_string(&file).expect("saved");
            assert!(saved.contains(&phone.id().to_string()));
            assert!(!saved.contains("t0k3n"));

            // So its HTTP now gets through.
            let forward = forward_from(phone, &rig.host).await;
            assert_eq!(round_trip(forward, REQUEST).await, paired);
        })
        .await;
    }

    #[tokio::test]
    async fn a_refused_code_adds_no_key() {
        within_30_s(async {
            let refused = http_answer("401 Unauthorized", r#"{"ok":false,"error":"unauthorized"}"#);
            let (upstream, _requests) = fake_kleio_host(Some(refused)).await;
            let rig = start_host("host-pair-refused", upstream).await;
            let phone = loopback_endpoint(2, &[]).await;

            let outcome = redeem(&phone, loopback_addr(&rig.host), "ABC-DEF", "Test iPhone").await;
            assert_eq!(outcome, Err(PairError::Refused("unauthorized".into())));
            assert!(!rig.allow.contains(&phone.id()));
            assert!(!rig.state.allow_path().exists());
        })
        .await;
    }

    #[tokio::test]
    async fn turns_away_a_second_pairing_while_one_is_in_flight() {
        within_30_s(async {
            // kleio-host takes the first request and never answers it.
            let (upstream, mut requests) = fake_kleio_host(None).await;
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
}
