//! Kleio's link end to end: the real kleio-host (Node, from its build:
//! `pnpm --filter @kleio/host build`), the real kleio-link-host, a relay in
//! the test process, and a phone in it. kleio-host makes the pairing code
//! and the ticket; the phone pairs through the relay once an admin allows it
//! by its device code, uses its device token over the link, and is cut off
//! when an admin revokes it. A phone an admin denies gets nothing.
//!
//! Ignored unless asked for, since it needs Node and kleio-host's build. CI
//! runs it on every OS:
//! `cargo test --features host --test end_to_end -- --ignored`.

mod common;

use std::fs;
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use common::{
    get, json_body, phone, relay_only, status_and_body, turned_away, until, within, TempDir,
    TestRelay, TOKEN_HEADER,
};
use kleio_link::iroh::SecretKey;
use kleio_link::link::{LinkError, Route};
use kleio_link::pair::{device_code, pair, PairError, PairStage};
use kleio_link::probe::HttpsProbe;
use kleio_link::ticket::Ticket;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

/// kleio-host's command, built.
fn kleio_host_cli() -> PathBuf {
    let cli = Path::new(env!("CARGO_MANIFEST_DIR")).join("../kleio-host/dist/cli.js");
    assert!(
        cli.is_file(),
        "kleio-host isn't built ({} is missing): run `pnpm --filter @kleio/host build` first",
        cli.display()
    );
    cli
}

/// A port on 127.0.0.1 free a moment ago.
fn free_port() -> u16 {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("binds");
    listener.local_addr().expect("has an address").port()
}

/// A program the test started, stopped when dropped. If the test fails, its
/// log is shown.
struct Running {
    name: &'static str,
    child: Child,
    log: PathBuf,
}

impl Running {
    fn start(name: &'static str, command: &mut Command, log: PathBuf) -> Self {
        let out = fs::File::create(&log).expect("a log file");
        let err = out.try_clone().expect("the log file again");
        let child = command
            .stdin(Stdio::null())
            .stdout(out)
            .stderr(err)
            .spawn()
            .unwrap_or_else(|err| panic!("{name} doesn't start: {err}"));
        Self { name, child, log }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if std::thread::panicking() {
            let log = fs::read_to_string(&self.log).unwrap_or_default();
            eprintln!("--- {}'s log ---\n{log}--- end ---", self.name);
        }
    }
}

/// kleio-host in a folder of the test's own, on ports of its own.
struct KleioHost {
    cli: PathBuf,
    home: PathBuf,
    user_home: PathBuf,
    api: u16,
    link: u16,
    preview: u16,
}

impl KleioHost {
    /// `kleio-host <args>`, with none of this machine's Kleio settings and
    /// a home folder of its own.
    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new("node");
        command.arg(&self.cli).args(args);
        for (name, _) in std::env::vars_os() {
            if let Some(name) = name.to_str() {
                if name.starts_with("KLEIO_") || name.starts_with("TYPESAFE_") {
                    command.env_remove(name);
                }
            }
        }
        command
            .env("KLEIO_HOST_HOME", &self.home)
            .env("KLEIO_HOST_PORT", self.api.to_string())
            .env("KLEIO_LINK_PORT", self.link.to_string())
            .env("KLEIO_PREVIEW_PORT", self.preview.to_string())
            .env("KLEIO_HOME_CWD", self.user_home.join("Kleio"))
            .env("HOME", &self.user_home)
            .env("USERPROFILE", &self.user_home);
        command
    }
}

/// `method path` on kleio-host's API port, with `token` as the device's:
/// the status and the JSON body.
async fn call(port: u16, method: &str, path: &str, token: Option<&str>) -> (u16, Value) {
    call_with(port, method, path, token, None).await
}

/// [`call`], with `body` as the request's JSON.
async fn call_with(
    port: u16,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<&Value>,
) -> (u16, Value) {
    let mut tcp = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
        .await
        .expect("kleio-host's API port answers");
    let token = token
        .map(|token| format!("{TOKEN_HEADER}: {token}\r\n"))
        .unwrap_or_default();
    let (kind, body) = match body {
        Some(body) => ("content-type: application/json\r\n", body.to_string()),
        None => ("", String::new()),
    };
    let request = format!(
        "{method} {path} HTTP/1.1\r\nhost: 127.0.0.1:{port}\r\n{token}{kind}content-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    tcp.write_all(request.as_bytes()).await.expect("sent");
    let mut answer = Vec::new();
    tcp.read_to_end(&mut answer).await.expect("an answer");
    let (status, body) = status_and_body(&answer);
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

/// Once kleio-host's API answers.
async fn wait_for_api(port: u16) {
    let start = Instant::now();
    loop {
        if let Ok(mut tcp) = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await {
            let request = format!(
                "GET /kleio/health HTTP/1.1\r\nhost: 127.0.0.1:{port}\r\nconnection: close\r\n\r\n"
            );
            let mut answer = Vec::new();
            if tcp.write_all(request.as_bytes()).await.is_ok()
                && tcp.read_to_end(&mut answer).await.is_ok()
                && answer.starts_with(b"HTTP/1.1 200")
            {
                return;
            }
        }
        assert!(
            start.elapsed() < Duration::from_secs(30),
            "kleio-host's API didn't answer within 30 s"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// The device waiting on the live code, as `GET /kleio/pair` shows it to an
/// admin, once one is.
async fn waiting_device(port: u16, admin: &str) -> Value {
    loop {
        let (status, offer) = call(port, "GET", "/kleio/pair", Some(admin)).await;
        assert_eq!(status, 200, "{offer}");
        if offer["claim"].is_object() {
            return offer["claim"].clone();
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// An admin's Allow or Deny for the device waiting with `device_code`, as
/// "Pair a device" sends it.
async fn decide(port: u16, admin: &str, device_code: &str, allow: bool) {
    let body = json!({"allow": allow, "deviceCode": device_code});
    let (status, decided) =
        call_with(port, "POST", "/kleio/pair/decide", Some(admin), Some(&body)).await;
    assert_eq!(status, 200, "{decided}");
    assert_eq!(decided["deviceCode"], device_code);
}

/// Once `log` has `line` in it.
async fn logged(log: &Path, line: &str) {
    until(|| {
        fs::read_to_string(log)
            .ok()
            .filter(|text| text.contains(line))
    })
    .await;
}

/// The device code the phone shows once it waits for an Allow, or `None` if
/// pairing ended first.
async fn shown_code(stages: &mut mpsc::UnboundedReceiver<PairStage>) -> Option<String> {
    while let Some(stage) = stages.recv().await {
        if let PairStage::Waiting { device_code } = stage {
            return Some(device_code);
        }
    }
    None
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs Node and kleio-host's build (pnpm --filter @kleio/host build); CI runs it"]
async fn a_phone_pairs_uses_and_loses_the_link_through_kleio_host() {
    within(Duration::from_secs(120), async {
        let tmp = TempDir::new("end-to-end");
        let relay = TestRelay::start().await;
        let kleio = KleioHost {
            cli: kleio_host_cli(),
            home: tmp.path().join("host"),
            user_home: tmp.path().join("home"),
            api: free_port(),
            link: free_port(),
            preview: free_port(),
        };
        fs::create_dir_all(&kleio.user_home).expect("made");

        // kleio-host set up, with the test's relay as its list, and running.
        let init = kleio
            .command(&["init"])
            .output()
            .expect("kleio-host init runs");
        assert!(
            init.status.success(),
            "kleio-host init failed:\n{}{}",
            String::from_utf8_lossy(&init.stdout),
            String::from_utf8_lossy(&init.stderr)
        );
        fs::create_dir_all(kleio.home.join("link")).expect("made");
        let relays = json!({"version": 1, "listVersion": 1, "relays": [relay.url.as_str()]});
        fs::write(kleio.home.join("link/config.json"), relays.to_string()).expect("written");
        let _kleio_host = Running::start(
            "kleio-host serve",
            &mut kleio.command(&["serve"]),
            tmp.path().join("kleio-host.log"),
        );
        wait_for_api(kleio.api).await;

        // kleio-link-host beside it, through the relay alone.
        let pem = tmp.path().join("relay.pem");
        fs::write(&pem, relay.pem()).expect("written");
        let mut link_host = Command::new(env!("CARGO_BIN_EXE_kleio-link-host"));
        // Its own log levels: the test waits for a line it logs at info.
        link_host
            .env_remove("RUST_LOG")
            .arg("serve")
            .arg("--state-dir")
            .arg(&kleio.home)
            .arg("--upstream")
            .arg(format!("127.0.0.1:{}", kleio.link))
            .arg("--relay-ca")
            .arg(&pem)
            .arg("--relay-only");
        let link_log = tmp.path().join("kleio-link-host.log");
        let _link_host = Running::start("kleio-link-host serve", &mut link_host, link_log.clone());
        let state_path = kleio.home.join("link/state.json");
        let state =
            until(|| read_json(&state_path).filter(|state| state["relay"] == relay.url.as_str()))
                .await;

        // An admin asks for a pairing code, as "Pair a device" does.
        let admin = fs::read_to_string(kleio.home.join("secure/admin.token"))
            .expect("init made the admin token");
        let admin = admin.trim();
        let (status, offer) = call(kleio.api, "POST", "/kleio/pair/offer", Some(admin)).await;
        assert_eq!(status, 200, "{}", offer["error"]);
        let ticket: Ticket = offer["ticket"]
            .as_str()
            .unwrap_or_else(|| panic!("no ticket: {}", offer["ticketError"]))
            .parse()
            .expect("a ticket the phone reads");
        assert_eq!(
            Some(ticket.key().to_string().as_str()),
            state["key"].as_str()
        );
        assert_eq!(ticket.relay(), &relay.url);

        // The phone pairs through the relay. kleio-host holds its request
        // for an admin's Allow, so the phone shows its device code, then
        // answers that it waits, so the phone asks again. An admin sees the
        // same code, and allows it. (The payload carries the device token:
        // nothing here prints it.)
        let options = relay_only(&[&relay]);
        let probe = HttpsProbe::new(&options.trust).expect("a probe");
        let key = SecretKey::generate();
        let (told, mut stages) = mpsc::unbounded_channel();
        let (paired, ()) = tokio::join!(
            pair(
                key.clone(),
                &ticket,
                "End-to-end phone",
                &options,
                &probe,
                move |stage| {
                    let _ = told.send(stage);
                },
            ),
            async {
                let Some(shown) = shown_code(&mut stages).await else {
                    return;
                };
                assert_eq!(shown, device_code(&key.public()));
                let waiting = waiting_device(kleio.api, admin).await;
                assert_eq!(waiting["deviceCode"], shown.as_str());
                assert_eq!(waiting["label"], "End-to-end phone");
                assert_eq!(waiting["contested"], false);
                assert!(waiting.get("redemptionNonce").is_none());
                logged(&link_log, "pairing waits for an admin to allow it").await;
                decide(kleio.api, admin, &shown, true).await;
            },
        );
        let payload = paired.expect("pairs once allowed");
        let token = payload["token"]
            .as_str()
            .expect("a device token")
            .to_string();
        let device = payload["deviceId"].as_str().expect("a device").to_string();
        assert!(
            payload.get("baseUrl").is_none(),
            "a host on the link only has no address"
        );

        // Its token works over the link...
        let link = phone(key, Route::from_ticket(&ticket), &options).await;
        let answer = get(&link, "/kleio/link", Some(&token))
            .await
            .expect("an answer");
        assert_eq!(status_and_body(&answer).0, 200);
        let info = json_body(&answer);
        assert_eq!(info["key"], state["key"]);
        assert_eq!(info["relay"], relay.url.as_str());
        assert_eq!(info["running"], true);
        // ...and nowhere else: not on kleio-host's API port.
        let (status, _) = call(kleio.api, "GET", "/kleio/link", Some(&token)).await;
        assert_eq!(status, 401);

        // A key that never paired gets no further than kleio-link-host.
        let stranger = phone(SecretKey::generate(), Route::from_ticket(&ticket), &options).await;
        assert_eq!(turned_away(&stranger).await, LinkError::NotPaired);

        // An admin revokes the phone: its open connection is closed as
        // revoked, within 2 s of kleio-host's answer (3 s allows for a slow
        // machine).
        let conn = link.connection().await.expect("still open");
        let revoke = format!("/kleio/devices/{device}/revoke");
        let (status, _) = call(kleio.api, "POST", &revoke, Some(admin)).await;
        assert_eq!(status, 200);
        tokio::time::timeout(Duration::from_secs(3), conn.closed())
            .await
            .expect("closed within 3 s");
        assert_eq!(link.refusal(), Some(LinkError::Revoked));
        let again = get(&link, "/kleio/link", Some(&token)).await;
        assert!(again.is_err(), "a revoked phone's request went through");

        // An admin denies the next phone while kleio-host holds its first
        // request: it's told so at once, the code is gone, and its key gets
        // no further than kleio-link-host.
        let (status, offer) = call(kleio.api, "POST", "/kleio/pair/offer", Some(admin)).await;
        assert_eq!(status, 200, "{}", offer["error"]);
        let ticket: Ticket = offer["ticket"]
            .as_str()
            .unwrap_or_else(|| panic!("no ticket: {}", offer["ticketError"]))
            .parse()
            .expect("a ticket the phone reads");
        let key = SecretKey::generate();
        let (denied, ()) = tokio::join!(
            pair(
                key.clone(),
                &ticket,
                "Someone else's phone",
                &options,
                &probe,
                |_| {}
            ),
            async {
                let waiting = waiting_device(kleio.api, admin).await;
                assert_eq!(waiting["label"], "Someone else's phone");
                let code = device_code(&key.public());
                assert_eq!(waiting["deviceCode"], code.as_str());
                decide(kleio.api, admin, &code, false).await;
            },
        );
        assert_eq!(denied.map(|_| ()), Err(PairError::Denied));
        let (status, offer) = call(kleio.api, "GET", "/kleio/pair", Some(admin)).await;
        assert_eq!((status, &offer["active"]), (200, &json!(false)));
        let denied = phone(key, Route::from_ticket(&ticket), &options).await;
        assert_eq!(turned_away(&denied).await, LinkError::NotPaired);
    })
    .await;
}
