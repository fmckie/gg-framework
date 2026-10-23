//! What the link's integration tests share: relays in the test process,
//! kleio-host's state folder with its secrets, a stand-in for kleio-host's
//! link listener, a phone, and HTTP over its link.
//!
//! Every end goes through relays only, so none binds a UDP socket, and the
//! relays listen on 127.0.0.1: nothing leaves this machine, and macOS's
//! firewall has nothing to ask about.

// Each test file uses some of it.
#![allow(dead_code)]

#[cfg(windows)]
mod windows_acl;

use std::fs;
use std::future::Future;
use std::net::{Ipv4Addr, SocketAddr};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use iroh_relay::server::{
    CertConfig, ClientRateLimit, RelayConfig, Server, ServerConfig, TlsConfig,
};
use kleio_link::endpoint::{bind_client, EndpointOptions, Mode, RelayTrust};
use kleio_link::host::Config;
use kleio_link::iroh::endpoint::{Connection, ConnectionError};
use kleio_link::iroh::{EndpointId, RelayUrl, SecretKey};
use kleio_link::link::{Link, LinkError, Route};
use kleio_link::ticket::Ticket;
use kleio_link::{ALPN_HTTP, LINK_HOST};
use rustls_pki_types::CertificateDer;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

/// The device token header kleio-host reads (`DEVICE_TOKEN_HEADER`).
pub const TOKEN_HEADER: &str = "x-kleio-device-token";

/// `test`, failing instead of hanging if it takes longer than `limit`.
pub async fn within<F: Future>(limit: Duration, test: F) -> F::Output {
    match tokio::time::timeout(limit, test).await {
        Ok(output) => output,
        Err(_) => panic!("the test didn't finish within {} s", limit.as_secs()),
    }
}

/// Waits for `ready` to give something, checking every 50 ms.
pub async fn until<T>(mut ready: impl FnMut() -> Option<T>) -> T {
    loop {
        if let Some(value) = ready() {
            return value;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// A folder of one test's own, deleted when dropped. `name` must be unique
/// among the tests; the process id keeps two runs apart.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new(name: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("kleio-link-it-{}-{name}", std::process::id()));
        // Left over from an earlier run that had the same process id.
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("a temp folder");
        Self(path)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// An iroh relay in the test process, on 127.0.0.1, with iroh-relay's
/// self-signed test certificate, which only the tests' ends trust.
pub struct TestRelay {
    pub url: RelayUrl,
    certs: Vec<CertificateDer<'static>>,
    server: Option<Server>,
}

impl TestRelay {
    pub async fn start() -> Self {
        Self::start_with(None).await
    }

    /// One that reads `bytes_per_second` from each client once it has read
    /// `burst` bytes, and tells the client it's being rate-limited.
    pub async fn rate_limited(bytes_per_second: u32, burst: u32) -> Self {
        let nonzero = |n: u32| NonZeroU32::new(n).expect("not zero");
        let mut limit = ClientRateLimit::new(nonzero(bytes_per_second));
        limit.max_burst_bytes = Some(nonzero(burst));
        Self::start_with(Some(limit)).await
    }

    async fn start_with(limit: Option<ClientRateLimit>) -> Self {
        let (certs, server_config) =
            iroh_relay::server::testing::self_signed_tls_certs_and_config();
        let mut relay = RelayConfig::new((Ipv4Addr::LOCALHOST, 0));
        relay.tls = Some(TlsConfig::new(
            (Ipv4Addr::LOCALHOST, 0),
            CertConfig::Manual { server_config },
        ));
        relay.limits.client_rx = limit;
        let mut config = ServerConfig::default();
        config.relay = Some(relay);
        let server = Server::spawn(config).await.expect("the relay starts");
        let addr = server.https_addr().expect("it serves https");
        let url = format!("https://{addr}/").parse().expect("a relay address");
        Self {
            url,
            certs,
            server: Some(server),
        }
    }

    /// Stops it: nothing answers at its address any more.
    pub async fn stop(&mut self) {
        if let Some(server) = self.server.take() {
            // It reports how its tasks ended, which doesn't matter here.
            let _ = server.shutdown().await;
        }
    }

    /// Its certificate as PEM, for `kleio-link-host --relay-ca`.
    pub fn pem(&self) -> String {
        let mut pem = String::new();
        for cert in &self.certs {
            pem.push_str("-----BEGIN CERTIFICATE-----\n");
            let base64 = data_encoding::BASE64.encode(cert);
            for line in base64.as_bytes().chunks(64) {
                pem.push_str(std::str::from_utf8(line).expect("base64 is ASCII"));
                pem.push('\n');
            }
            pem.push_str("-----END CERTIFICATE-----\n");
        }
        pem
    }
}

/// An end that goes through relays only, trusting `relays`' certificates.
pub fn relay_only(relays: &[&TestRelay]) -> EndpointOptions {
    EndpointOptions {
        mode: Mode::RelayOnly,
        trust: RelayTrust::with_roots(relays.iter().flat_map(|relay| relay.certs.iter().cloned())),
    }
}

/// A v4 ticket for `host` through `relays`, as kleio-host builds one.
pub fn ticket(host: EndpointId, relays: &[&RelayUrl], code: &str) -> Ticket {
    let relays: Vec<&str> = relays.iter().map(|relay| relay.as_str()).collect();
    json!({
        "v": 4,
        "type": "kleio-pair",
        "name": "Test host",
        "key": host.to_string(),
        "relays": relays,
        "addrs": [],
        "code": code,
    })
    .to_string()
    .parse()
    .expect("a ticket")
}

/// A phone with `key` whose link leads along `route`.
pub async fn phone(key: SecretKey, route: Route, options: &EndpointOptions) -> Link {
    let relays: Vec<RelayUrl> = route.relay().cloned().into_iter().collect();
    let endpoint = bind_client(key, &relays, options)
        .await
        .expect("the phone's endpoint binds");
    Link::new(endpoint, route)
}

/// `GET path` over `link`, as the app's forwarder passes a request on, with
/// `token` as the device's: the whole answer. Like the app's HTTP client, it
/// sends no end until the answer is in: Node's HTTP server, kleio-host's,
/// ends a connection once its client does, answered or not.
pub async fn get(link: &Link, path: &str, token: Option<&str>) -> Result<Vec<u8>, String> {
    let conn = link.connection().await.map_err(|err| err.to_string())?;
    let (mut send, mut recv) = conn.open_bi().await.map_err(|err| err.to_string())?;
    let token = token
        .map(|token| format!("{TOKEN_HEADER}: {token}\r\n"))
        .unwrap_or_default();
    let request =
        format!("GET {path} HTTP/1.1\r\nhost: {LINK_HOST}\r\n{token}connection: close\r\n\r\n");
    send.write_all(request.as_bytes())
        .await
        .map_err(|err| err.to_string())?;
    let answer = recv
        .read_to_end(8 << 20)
        .await
        .map_err(|err| err.to_string());
    // The answer is in, or the stream failed: either way, this end is done.
    let _ = send.finish();
    answer
}

/// The application close code the host closed `conn` with.
pub async fn closed_with(conn: &Connection) -> Option<u64> {
    match conn.closed().await {
        ConnectionError::ApplicationClosed(closed) => Some(closed.error_code.into_inner()),
        _ => None,
    }
}

/// How the host turns `link`'s key away: just after the handshake, so
/// usually once the dial has finished, and sometimes before.
pub async fn turned_away(link: &Link) -> LinkError {
    match link.connection().await {
        Ok(conn) => {
            assert_eq!(conn.alpn(), ALPN_HTTP);
            conn.closed().await;
            link.refusal().expect("the host's reason")
        }
        Err(err) => err,
    }
}

/// An HTTP answer as kleio-host's `json()` writes one.
pub fn http_answer(status: &str, body: &[u8]) -> Vec<u8> {
    let mut answer = format!(
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    answer.extend_from_slice(body);
    answer
}

/// An answer's status code and body.
pub fn status_and_body(answer: &[u8]) -> (u16, Vec<u8>) {
    let end = head_end(answer).expect("a whole head");
    let head = String::from_utf8_lossy(&answer[..end]);
    let status = head
        .split(' ')
        .nth(1)
        .and_then(|code| code.parse().ok())
        .expect("a status line");
    (status, answer[end + 4..].to_vec())
}

/// An answer's body, as JSON.
pub fn json_body(answer: &[u8]) -> Value {
    serde_json::from_slice(&status_and_body(answer).1).expect("a JSON body")
}

fn head_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

/// kleio-host's state folder as it leaves it for kleio-link-host: the link
/// key and secret in a `secure/` that's this user's alone, an allow-list,
/// and the relay list.
pub struct HostHome {
    tmp: TempDir,
    key: SecretKey,
    pub secret: String,
}

impl HostHome {
    pub fn new(name: &str) -> Self {
        let home = Self {
            tmp: TempDir::new(name),
            key: SecretKey::generate(),
            secret: random_hex(32),
        };
        let secure = home.secure();
        fs::create_dir_all(&secure).expect("made");
        lock_to_user(&secure, true);
        put_secret(&secure.join("link.key"), &home.key.to_bytes());
        put_secret(&secure.join("link-upstream.token"), home.secret.as_bytes());
        home.allow(&[], &[]);
        fs::create_dir_all(home.path().join("link")).expect("made");
        home
    }

    pub fn path(&self) -> PathBuf {
        self.tmp.path().join("host")
    }

    fn secure(&self) -> PathBuf {
        self.path().join("secure")
    }

    /// The host's key.
    pub fn id(&self) -> EndpointId {
        self.key.public()
    }

    pub fn allow_path(&self) -> PathBuf {
        self.secure().join("link-allow.json")
    }

    /// kleio-host's allow-list: `paired` keys, and `revoked` ones.
    pub fn allow(&self, paired: &[EndpointId], revoked: &[EndpointId]) {
        write_allow(&self.allow_path(), paired, revoked);
    }

    /// kleio-host's relay list.
    pub fn relays(&self, relays: &[&RelayUrl]) {
        let relays: Vec<&str> = relays.iter().map(|relay| relay.as_str()).collect();
        let doc = json!({"version": 1, "listVersion": 1, "relays": relays});
        fs::write(self.path().join("link/config.json"), doc.to_string()).expect("written");
    }

    /// `kleio-link-host serve`'s config for this folder.
    pub fn config(&self, upstream: SocketAddr, options: EndpointOptions) -> Config {
        Config {
            home: self.path(),
            upstream,
            relay: None,
            options,
        }
    }

    /// kleio-link-host's state file, once `ready` says it is.
    pub async fn state_when(&self, ready: impl Fn(&Value) -> bool) -> Value {
        let path = self.path().join("link/state.json");
        until(|| {
            let state: Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
            ready(&state).then_some(state)
        })
        .await
    }
}

/// Writes kleio-host's allow-list at `path`, as its device registry does:
/// whole, by renaming a new file over it.
pub fn write_allow(path: &Path, paired: &[EndpointId], revoked: &[EndpointId]) {
    let devices: Vec<Value> = paired
        .iter()
        .enumerate()
        .map(|(n, key)| {
            json!({"key": key.to_string(), "deviceId": format!("d{n}"), "label": format!("Phone {n}")})
        })
        .collect();
    let revoked: Vec<String> = revoked.iter().map(ToString::to_string).collect();
    let doc = json!({"version": 1, "devices": devices, "revoked": revoked});
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, doc.to_string()).expect("written");
    fs::rename(&tmp, path).expect("renamed");
}

/// `n` random bytes as lowercase hex.
fn random_hex(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).expect("random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Writes a secret only this user can get at: 0600 where there are POSIX
/// modes; on Windows it takes the locked folder's one entry.
fn put_secret(path: &Path, bytes: &[u8]) {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path).expect("made");
    std::io::Write::write_all(&mut file, bytes).expect("written");
}

/// Leaves this user the only one with any access to `path`, as kleio-host
/// does (0700 for a folder, or its acl.ts on Windows).
pub fn lock_to_user(path: &Path, folder: bool) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if folder { 0o700 } else { 0o600 };
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("set");
    }
    #[cfg(windows)]
    windows_acl::lock(path, folder);
}

/// What the stand-in for kleio-host's link listener got on one connection.
#[derive(Debug, Clone)]
pub struct Request {
    /// The key the connection's first line names.
    pub key: String,
    /// The secret it gives.
    pub secret: String,
    /// The request line, such as `GET /kleio/health HTTP/1.1`.
    pub line: String,
    pub body: Vec<u8>,
}

impl Request {
    pub fn device(&self) -> EndpointId {
        self.key.parse().expect("the first line names a key")
    }

    /// The JSON body.
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).expect("a JSON body")
    }
}

/// A stand-in for kleio-host's link listener, on 127.0.0.1: `answer` gets
/// each connection's first line and request, and what it gives goes back;
/// given nothing, the connection is held open unanswered. Each request also
/// comes out of the receiver, once answered.
pub async fn stub_kleio_host<F>(answer: F) -> (SocketAddr, mpsc::UnboundedReceiver<Request>)
where
    F: Fn(&Request) -> Option<Vec<u8>> + Send + Sync + 'static,
{
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("binds");
    let addr = listener.local_addr().expect("has an address");
    let (requests, received) = mpsc::unbounded_channel();
    let answer = Arc::new(answer);
    tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            let (requests, answer) = (requests.clone(), Arc::clone(&answer));
            tokio::spawn(async move {
                let Some(request) = read_request(&mut tcp).await else {
                    return;
                };
                let reply = answer(&request);
                let _ = requests.send(request);
                match reply {
                    Some(reply) => {
                        let _ = tcp.write_all(&reply).await;
                        let _ = tcp.shutdown().await;
                    }
                    None => std::future::pending::<()>().await,
                }
            });
        }
    });
    (addr, received)
}

/// A port on 127.0.0.1 nothing listens on.
pub async fn closed_port() -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("binds");
    listener.local_addr().expect("has an address")
}

async fn read_request(tcp: &mut TcpStream) -> Option<Request> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        if let Some(request) = parse_request(&bytes) {
            return Some(request);
        }
        match tcp.read(&mut chunk).await {
            Ok(0) | Err(_) => return None,
            Ok(n) => bytes.extend_from_slice(&chunk[..n]),
        }
    }
}

/// The first line and a whole request, once `bytes` has them.
fn parse_request(bytes: &[u8]) -> Option<Request> {
    let nl = bytes.iter().position(|&b| b == b'\n')?;
    let first = std::str::from_utf8(&bytes[..nl]).ok()?.trim_end();
    let mut words = first.split(' ');
    if words.next()? != "KLEIO-LINK/1" {
        return None;
    }
    let (key, secret) = (words.next()?.to_string(), words.next()?.to_string());
    let rest = &bytes[nl + 1..];
    let end = head_end(rest)?;
    let head = std::str::from_utf8(&rest[..end]).ok()?;
    let length = head
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let body = rest.get(end + 4..end + 4 + length)?.to_vec();
    Some(Request {
        key,
        secret,
        line: head.lines().next()?.to_string(),
        body,
    })
}
