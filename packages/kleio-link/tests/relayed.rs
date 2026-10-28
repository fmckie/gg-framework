//! Kleio's link through relays in the test process, with a stand-in for
//! kleio-host's link listener: kleio-link-host's `serve` as it runs, and
//! the phone's side as the app uses it. Pairing, how it fails and how the
//! app stops a phone that waits for an Allow, the gate's
//! close codes, revoking, the 502, failing over to the next relay, a
//! relay's rate limit, why a phone didn't reach its host, and that no device
//! learns the host's addresses before an admin allows it.

mod common;

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{
    closed_port, closed_with, get, http_answer, json_body, loopback_direct, phone,
    refused_before_handshake, relay_only, status_and_body, stub_kleio_host, ticket, turned_away,
    until, watched_phone, within, write_allow, HostHome, Request, TestRelay,
};
use futures_util::StreamExt;
use kleio_link::endpoint::bind_client;
use kleio_link::host::{self, FAILOVER_AFTER};
use kleio_link::iroh::endpoint::{
    ConnectError, ConnectingError, Connection, ConnectionError, PathEvent, TransportErrorCode,
    VarInt,
};
use kleio_link::iroh::{
    Endpoint, EndpointAddr, EndpointId, RelayUrl, SecretKey, TransportAddr, Watcher,
};
use kleio_link::link::{LinkError, Route, Unreached};
use kleio_link::pair::{
    pair, pair_until, PairError, PairRequest, PairStage, Refusal, MAX_PAIR_ANSWER_BYTES,
};
use kleio_link::probe::HttpsProbe;
use kleio_link::{close, ALPN_HTTP, ALPN_PAIR};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// kleio-host's answer to a code that pairs.
const PAIRED: &str = r#"{"ok":true,"payload":{"host":"Test host","token":"t0k3n","label":"Test iPhone","deviceId":"d1"}}"#;

/// kleio-host's answer to anything else here.
const HEALTH: &str = r#"{"ok":true}"#;

/// kleio-host, as far as these tests need it: a redeem pairs the key the
/// first line names, writing its allow-list first as kleio-host does, and
/// anything else gets [`HEALTH`].
fn kleio_host(allow: std::path::PathBuf) -> impl Fn(&Request) -> Option<Vec<u8>> + Send + Sync {
    move |request: &Request| {
        if request.line.starts_with("POST /kleio/pair/redeem ") {
            write_allow(&allow, &[request.device()], &[]);
            Some(http_answer("200 OK", PAIRED.as_bytes()))
        } else {
            Some(http_answer("200 OK", HEALTH.as_bytes()))
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pairs_through_a_relay_then_forwards_the_phones_requests() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let home = HostHome::new("pairs");
        home.relays(&[&relay.url]);
        let (upstream, mut requests) = stub_kleio_host(kleio_host(home.allow_path())).await;
        let options = relay_only(&[&relay]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.on_relay(&relay.url).await;

        let ticket = ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF");
        let key = SecretKey::generate();
        let stages = Arc::new(Mutex::new(Vec::new()));
        let told = Arc::clone(&stages);
        let probe = HttpsProbe::new(&options.trust).expect("a probe");
        let payload = pair(
            key.clone(),
            &ticket,
            "Test iPhone",
            &options,
            &probe,
            move |stage| {
                told.lock().expect("not poisoned").push(stage);
            },
        )
        .await
        .expect("pairs");
        assert_eq!(payload["token"], "t0k3n");
        assert_eq!(
            *stages.lock().expect("not poisoned"),
            [PairStage::Relay, PairStage::Host, PairStage::Pairing]
        );
        // kleio-host got the phone's key, the secret, and the code.
        let redeem = requests.recv().await.expect("the redeem request");
        assert_eq!(redeem.device(), key.public());
        assert_eq!(redeem.secret, home.secret);
        assert_eq!(redeem.json()["code"], "ABCDEF");

        // The paired phone's requests reach kleio-host through the relay.
        let link = phone(key.clone(), Route::from_ticket(&ticket), &options).await;
        let answer = get(&link, "/kleio/health", Some("t0k3n"))
            .await
            .expect("an answer");
        assert_eq!(status_and_body(&answer), (200, HEALTH.as_bytes().to_vec()));
        let forwarded = requests.recv().await.expect("the request");
        assert_eq!(forwarded.device(), key.public());
        assert_eq!(forwarded.line, "GET /kleio/health HTTP/1.1");
        assert_eq!(link.path().map(|path| path.direct), Some(false));
        // kleio-host sees the phone on the relay in kleio-link-host's state.
        let state = home
            .state_when(|state| state["connections"] == 1 && state["peers"][0]["path"] == "relay")
            .await;
        assert_eq!(state["peers"][0]["key"], key.public().to_string());
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_a_used_wrong_or_expired_code_and_lets_no_key_in() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let home = HostHome::new("refusals");
        home.relays(&[&relay.url]);
        // kleio-host's answers to each, as host.ts sends them.
        let (upstream, mut requests) = stub_kleio_host(|request| {
            let (status, error) = match request.json()["code"].as_str() {
                Some("AAA111") => ("410 Gone", "used"),
                Some("BBB222") => ("401 Unauthorized", "unauthorized"),
                _ => ("410 Gone", "expired"),
            };
            let body = json!({"ok": false, "error": error}).to_string();
            Some(http_answer(status, body.as_bytes()))
        })
        .await;
        let options = relay_only(&[&relay]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.on_relay(&relay.url).await;
        let probe = HttpsProbe::new(&options.trust).expect("a probe");

        for (code, refusal) in [
            ("AAA-111", Refusal::Used),
            ("BBB-222", Refusal::Unauthorized),
            ("CCC-333", Refusal::Expired),
        ] {
            let key = SecretKey::generate();
            let ticket = ticket(home.id(), home.pair_id(), &[&relay.url], code);
            let outcome = pair(
                key.clone(),
                &ticket,
                "Test iPhone",
                &options,
                &probe,
                |_| {},
            )
            .await;
            assert_eq!(outcome, Err(PairError::Refused(refusal)), "{code}");
            requests.recv().await.expect("the redeem request");

            // The key it tried with isn't paired: refused before its
            // handshake, as it comes through the relay.
            let link = phone(key, Route::from_ticket(&ticket), &options).await;
            refused_before_handshake(&link).await;
        }
        assert!(
            requests.try_recv().is_err(),
            "nothing else reached kleio-host"
        );
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_told_to_stop_while_it_waits_asks_no_more() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let home = HostHome::new("stops");
        home.relays(&[&relay.url]);
        // kleio-host with no admin to allow the phone.
        let (upstream, mut requests) = stub_kleio_host(|_| {
            let body = json!({"ok": false, "error": "pending", "retryAfterMs": 250, "expiresAt": 1_700_000_300_000_u64});
            Some(http_answer("202 Accepted", body.to_string().as_bytes()))
        })
        .await;
        let options = relay_only(&[&relay]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.on_relay(&relay.url).await;
        let probe = HttpsProbe::new(&options.trust).expect("a probe");

        // Cancel, as the waiting screen has it, once the phone waits.
        let key = SecretKey::generate();
        let ticket = ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF");
        let (told, mut stages) = mpsc::unbounded_channel();
        let cancel = async move {
            while let Some(stage) = stages.recv().await {
                if matches!(stage, PairStage::Waiting { .. }) {
                    return;
                }
            }
        };
        let tell = move |stage| {
            let _ = told.send(stage);
        };
        let outcome = pair_until(
            key.clone(),
            &ticket,
            "Test iPhone",
            &options,
            &probe,
            tell,
            cancel,
        )
        .await;
        assert_eq!(outcome, None);
        requests.recv().await.expect("the first ask");
        // It would have asked again within 250 ms.
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(
            requests.try_recv().is_err(),
            "the phone asked again after it stopped"
        );
        let link = phone(key, Route::from_ticket(&ticket), &options).await;
        refused_before_handshake(&link).await;
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn says_whether_the_relay_or_the_host_is_missing() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let options = relay_only(&[&relay]);
        let probe = HttpsProbe::new(&options.trust).expect("a probe");
        let no_host = SecretKey::generate().public();
        let no_pairing = SecretKey::generate().public();

        // A relay that isn't there: nothing answers at its address.
        let gone = closed_port().await;
        let nowhere = format!("https://{gone}/").parse().expect("a relay address");
        let ticket_nowhere = ticket(no_host, no_pairing, &[&nowhere], "ABC-DEF");
        let started = Instant::now();
        let outcome = pair(
            SecretKey::generate(),
            &ticket_nowhere,
            "Test",
            &options,
            &probe,
            |_| {},
        )
        .await;
        assert!(
            matches!(outcome, Err(PairError::RelayUnreachable { .. })),
            "{outcome:?}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(12),
            "{:?}",
            started.elapsed()
        );

        // The relay is there, and no host with the ticket's keys is on it.
        let ticket_no_host = ticket(no_host, no_pairing, &[&relay.url], "ABC-DEF");
        let outcome = pair(
            SecretKey::generate(),
            &ticket_no_host,
            "Test",
            &options,
            &probe,
            |_| {},
        )
        .await;
        assert_eq!(outcome, Err(PairError::HostMissing));
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn tells_a_stranger_and_a_revoked_device_apart_and_revokes_within_2_s() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let home = HostHome::new("gate");
        home.relays(&[&relay.url]);
        let (upstream, mut requests) = stub_kleio_host(kleio_host(home.allow_path())).await;
        let options = relay_only(&[&relay]);
        let (paired, other, revoked, stranger) = (
            SecretKey::generate(),
            SecretKey::generate(),
            SecretKey::generate(),
            SecretKey::generate(),
        );
        home.allow(&[paired.public(), other.public()], &[revoked.public()]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.on_relay(&relay.url).await;
        let route =
            || Route::from_ticket(&ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF"));

        // A key the host doesn't know is refused before its handshake, as it
        // comes through the relay; a revoked one is told so after it.
        let link = phone(stranger, route(), &options).await;
        refused_before_handshake(&link).await;
        let link = phone(revoked, route(), &options).await;
        assert_eq!(turned_away(&link).await, LinkError::Revoked);
        assert!(requests.try_recv().is_err(), "nothing reached kleio-host");

        // A paired phone with a connection open, and another device.
        let link = phone(paired.clone(), route(), &options).await;
        get(&link, "/kleio/health", None).await.expect("an answer");
        let conn = link.connection().await.expect("still open");
        let kept = phone(other.clone(), route(), &options).await;
        get(&kept, "/kleio/health", None).await.expect("an answer");

        // kleio-host revokes the phone: its connection closes within 2 s.
        home.allow(&[other.public()], &[paired.public()]);
        let code = tokio::time::timeout(Duration::from_secs(2), closed_with(&conn))
            .await
            .expect("closed within 2 s");
        assert_eq!(code, Some(close::REVOKED.into()));
        assert_eq!(link.refusal(), Some(LinkError::Revoked));
        // Each request after that fails at once with the refusal, and
        // dials nothing.
        let redials = link.status().redials;
        for _ in 0..3 {
            let again = get(&link, "/kleio/health", None).await;
            assert_eq!(again, Err(LinkError::Revoked.to_string()));
        }
        assert_eq!(
            link.status().redials,
            redials,
            "a revoked phone dialled again"
        );
        // The other device is still connected.
        let still = kept.connection().await.expect("still open");
        assert!(still.close_reason().is_none());
        get(&kept, "/kleio/health", None).await.expect("an answer");
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn answers_502_through_the_relay_when_kleio_host_is_down() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let home = HostHome::new("down");
        home.relays(&[&relay.url]);
        let options = relay_only(&[&relay]);
        let key = SecretKey::generate();
        home.allow(&[key.public()], &[]);
        tokio::spawn(host::serve(
            home.config(closed_port().await, options.clone()),
        ));
        home.on_relay(&relay.url).await;

        let link = phone(
            key,
            Route::from_ticket(&ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF")),
            &options,
        )
        .await;
        let answer = get(&link, "/kleio/health", None).await.expect("an answer");
        let (status, _) = status_and_body(&answer);
        assert_eq!(status, 502);
        assert_eq!(json_body(&answer), json!({"error": "kleio_down"}));
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fails_over_to_the_next_relay_where_the_phone_finds_it() {
    within(Duration::from_secs(90), async {
        let mut first = TestRelay::start().await;
        let second = TestRelay::start().await;
        let home = HostHome::new("failover");
        home.relays(&[&first.url, &second.url]);
        let (upstream, _requests) = stub_kleio_host(kleio_host(home.allow_path())).await;
        let options = relay_only(&[&first, &second]);
        let key = SecretKey::generate();
        home.allow(&[key.public()], &[]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        let state = home
            .state_when(|state| state["relay"] == first.url.as_str())
            .await;
        assert_eq!(state["relays"][1]["state"], "standby");

        // The phone knows the host's list, and that it was on the first.
        let route = Route::from_ticket(&ticket(
            home.id(),
            home.pair_id(),
            &[&first.url, &second.url],
            "ABC-DEF",
        ));
        let link = phone(key, route, &options).await;
        get(&link, "/kleio/health", None).await.expect("an answer");

        // Timed from before the stop, as the host may notice before it ends.
        let stopped = Instant::now();
        first.stop().await;
        home.state_when(|state| state["relay"] == second.url.as_str())
            .await;
        let moved = stopped.elapsed();
        assert!(moved >= FAILOVER_AFTER, "moved after {moved:?}");

        // As the app does once its connection is gone: it dials again, and
        // the second stage finds the host on the second relay, which is
        // then the phone's one relay.
        link.close_connection();
        let answer = get(&link, "/kleio/health", None).await.expect("an answer");
        assert_eq!(status_and_body(&answer).0, 200);
        assert_eq!(link.route().relay(), Some(&second.url));
        // iroh takes the change to its relays on its next net report.
        let mut statuses = link.endpoint().home_relay_status();
        let home_relays = until(|| {
            let now = statuses.get();
            now.iter().any(|status| status.is_connected()).then(|| {
                now.iter()
                    .map(|status| status.url().clone())
                    .collect::<Vec<_>>()
            })
        })
        .await;
        assert_eq!(home_relays, std::slice::from_ref(&second.url));
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn says_when_the_relay_is_rate_limiting_the_host() {
    within(Duration::from_secs(60), async {
        // 32 KiB a second after the first 16 KiB, from each end.
        let relay = TestRelay::rate_limited(32 * 1024, 16 * 1024).await;
        let home = HostHome::new("rate-limit");
        home.relays(&[&relay.url]);
        let big = vec![b'x'; 512 * 1024];
        let (upstream, _requests) =
            stub_kleio_host(move |_| Some(http_answer("200 OK", &big))).await;
        let options = relay_only(&[&relay]);
        let key = SecretKey::generate();
        home.allow(&[key.public()], &[]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        let state = home
            .state_when(|state| state["relay"] == relay.url.as_str())
            .await;
        assert_eq!(state["rateLimited"], false);

        // A download the relay slows: the host is told, and says so.
        let link = phone(
            key,
            Route::from_ticket(&ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF")),
            &options,
        )
        .await;
        let download = tokio::spawn(async move { get(&link, "/big", None).await });
        home.state_when(|state| state["rateLimited"] == true).await;
        download.abort();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn says_when_the_relay_is_rate_limiting_this_device() {
    within(Duration::from_secs(60), async {
        // 32 KiB a second after the first 16 KiB, from each end.
        let relay = TestRelay::rate_limited(32 * 1024, 16 * 1024).await;
        let home = HostHome::new("rate-limit-phone");
        home.relays(&[&relay.url]);
        let (upstream, _requests) = stub_kleio_host(|_| Some(http_answer("200 OK", b"{}"))).await;
        let options = relay_only(&[&relay]);
        let key = SecretKey::generate();
        home.allow(&[key.public()], &[]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.on_relay(&relay.url).await;
        let link = watched_phone(
            key,
            Route::from_ticket(&ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF")),
            &options,
        )
        .await;
        get(&link, "/kleio/health", None).await.expect("an answer");
        assert!(!link.rate_limited(), "nothing big has gone yet");

        // An upload the relay slows: it tells this device.
        let conn = link.connection().await.expect("connected");
        let upload = tokio::spawn(async move {
            let (mut send, _recv) = conn.open_bi().await.expect("a stream");
            let _ = send.write_all(&vec![b'x'; 512 * 1024]).await;
        });
        until(|| link.rate_limited().then_some(())).await;
        upload.abort();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn says_whether_the_host_or_the_relay_wasnt_there() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let options = relay_only(&[&relay]);
        let no_host = SecretKey::generate().public();
        let no_pairing = SecretKey::generate().public();

        // The relay answers; no host with the key is on it.
        let route = Route::from_ticket(&ticket(no_host, no_pairing, &[&relay.url], "ABC-DEF"));
        let link = watched_phone(SecretKey::generate(), route, &options).await;
        assert_eq!(link.unreached(), None, "nothing dialled yet");
        assert!(link.connection().await.is_err(), "no host answers");
        assert_eq!(link.unreached(), Some(Unreached::HostSilent));
        assert!(!link.dialling());

        // A relay that isn't there: nothing answers at its address, so the
        // relays are asked, and none answers.
        let gone = closed_port().await;
        let nowhere: RelayUrl = format!("https://{gone}/").parse().expect("a relay address");
        let route = Route::from_ticket(&ticket(no_host, no_pairing, &[&nowhere], "ABC-DEF"));
        let link = watched_phone(SecretKey::generate(), route, &options).await;
        assert!(link.connection().await.is_err(), "no relay answers");
        let why = until(|| link.unreached()).await;
        assert_eq!(
            why,
            Unreached::NoRelay {
                tried: vec![nowhere]
            }
        );
    })
    .await;
}

/// How long a phone here keeps a pairing connection open once it has its
/// answer: time for a host to tell it its addresses, and for the phone to
/// try them.
const HOLD: Duration = Duration::from_secs(3);

/// kleio-host's answer while no admin has allowed the device.
const PENDING: &str =
    r#"{"ok":false,"error":"pending","retryAfterMs":250,"expiresAt":1700000300000}"#;

/// The redeem body the app sends, with `code`.
fn redeem_request(code: &str) -> Vec<u8> {
    serde_json::to_vec(&PairRequest {
        code: code.replace('-', ""),
        redemption_nonce: "00112233445566778899aabbccddeeff".into(),
        label: "Test iPhone".into(),
        waits: true,
    })
    .expect("a redeem body")
}

/// What a phone got from one pairing ask.
struct Asked {
    /// kleio-host's answer.
    answer: Value,
    /// The remote address of each path the connection had.
    paths: Vec<TransportAddr>,
    /// The IP addresses the phone's endpoint knew for the host's keys at the
    /// end of the hold.
    known: Vec<SocketAddr>,
}

impl Asked {
    /// Whether the phone learnt none of the host's IP addresses.
    fn learnt_no_address(&self) -> bool {
        self.known.is_empty()
            && !self
                .paths
                .iter()
                .any(|addr| matches!(addr, TransportAddr::Ip(_)))
    }
}

/// One pairing ask from `phone` to `host` through `relay` only, as the app
/// makes it: `body` on one stream and the answer to its end, then the
/// connection held for [`HOLD`] before the phone closes it. `keys` are the
/// host's keys the phone's endpoint is asked about then.
async fn ask_holding(
    phone: &Endpoint,
    host: EndpointId,
    relay: &RelayUrl,
    body: &[u8],
    keys: &[EndpointId],
) -> Asked {
    let addr = EndpointAddr::from(host).with_relay_url(relay.clone());
    let conn = phone
        .connect(addr, ALPN_PAIR)
        .await
        .expect("the host answers");
    let paths = watch_paths(&conn);
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    send.write_all(body).await.expect("sent");
    send.finish().expect("finished");
    let answer = recv
        .read_to_end(MAX_PAIR_ANSWER_BYTES)
        .await
        .expect("the answer");
    tokio::time::sleep(HOLD).await;
    let mut known = Vec::new();
    for key in keys {
        known.extend(known_ips(phone, *key).await);
    }
    conn.close(VarInt::from_u32(close::DONE), b"done");
    Asked {
        answer: serde_json::from_slice(&answer).expect("a JSON answer"),
        paths: paths.await.expect("watched"),
        known,
    }
}

/// The remote address of each path `conn` has, from now until it closes.
fn watch_paths(conn: &Connection) -> JoinHandle<Vec<TransportAddr>> {
    let mut seen: Vec<TransportAddr> = conn
        .paths()
        .iter()
        .map(|path| path.remote_addr().clone())
        .collect();
    let events = conn.path_events();
    let closed = conn.weak_handle().closed();
    tokio::spawn(async move {
        tokio::pin!(closed, events);
        loop {
            tokio::select! {
                _ = &mut closed => return seen,
                event = events.next() => match event {
                    Some(
                        PathEvent::Opened { remote_addr, .. }
                        | PathEvent::Selected { remote_addr, .. },
                    ) => seen.push(remote_addr),
                    // A path it missed could have been direct.
                    Some(PathEvent::Lagged { .. }) => panic!("missed path events"),
                    Some(_) => {}
                    None => return seen,
                },
            }
        }
    })
}

/// Whether `err` is the host refusing the connection before its handshake:
/// QUIC's CONNECTION_REFUSED, with no close code of the host's.
fn refused_outright(err: &ConnectError) -> bool {
    let reason = match err {
        ConnectError::Connection { source, .. }
        | ConnectError::Connecting {
            source: ConnectingError::ConnectionError { source, .. },
            ..
        } => source,
        _ => return false,
    };
    matches!(
        reason,
        ConnectionError::ConnectionClosed(close)
            if close.error_code == TransportErrorCode::CONNECTION_REFUSED
    )
}

/// The IP addresses `phone`'s endpoint knows for `key`.
async fn known_ips(phone: &Endpoint, key: EndpointId) -> Vec<SocketAddr> {
    let Some(info) = phone.remote_info(key).await else {
        return Vec::new();
    };
    info.addrs()
        .filter_map(|known| match known.addr() {
            TransportAddr::Ip(addr) => Some(*addr),
            _ => None,
        })
        .collect()
}

/// BP-002: a phone that waits for an admin's Allow, asking again and again,
/// learns none of the host's addresses, though the host has some, and gives
/// them once the phone is allowed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_waiting_phone_learns_no_address_of_the_host_till_its_allowed() {
    within(Duration::from_secs(90), async {
        let relay = TestRelay::start().await;
        let home = HostHome::new("waiting-no-address");
        home.relays(&[&relay.url]);
        // kleio-host: `pending` twice, then an admin allows the phone.
        let allow = home.allow_path();
        let asks = AtomicUsize::new(0);
        let (upstream, mut requests) = stub_kleio_host(move |request| {
            if !request.line.starts_with("POST /kleio/pair/redeem ") {
                return Some(http_answer("200 OK", HEALTH.as_bytes()));
            }
            if asks.fetch_add(1, Ordering::SeqCst) < 2 {
                return Some(http_answer("202 Accepted", PENDING.as_bytes()));
            }
            write_allow(&allow, &[request.device()], &[]);
            Some(http_answer("200 OK", PAIRED.as_bytes()))
        })
        .await;
        // Both ends go direct where they can, on loopback.
        let options = loopback_direct(&[&relay]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.on_relay(&relay.url).await;
        let ticket = ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF");
        let keys = [ticket.key(), ticket.pair_key()];

        let key = SecretKey::generate();
        let relays = std::slice::from_ref(ticket.relay());
        let waiting = bind_client(key.clone(), relays, &options)
            .await
            .expect("the phone's endpoint binds");
        let body = redeem_request(ticket.code());
        for ask in 1..=3 {
            let asked =
                ask_holding(&waiting, ticket.pair_key(), ticket.relay(), &body, &keys).await;
            requests.recv().await.expect("the redeem request");
            assert_eq!(asked.answer["ok"], ask == 3, "ask {ask}: {}", asked.answer);
            assert!(
                asked.learnt_no_address(),
                "ask {ask}: the phone learnt the host's addresses: paths {:?}, known {:?}",
                asked.paths,
                asked.known
            );
        }
        waiting.close().await;

        // Allowed, the phone goes direct: what the asks were checked for.
        let link = phone(key, Route::from_ticket(&ticket), &options).await;
        let answer = get(&link, "/kleio/health", Some("t0k3n"))
            .await
            .expect("an answer");
        assert_eq!(status_and_body(&answer).0, 200);
        until(|| link.path().filter(|path| path.direct)).await;
    })
    .await;
}

/// BP-002: a key the host doesn't know, with a ticket's keys and relay,
/// learns none of the host's addresses: not with a wrong code on the
/// pairing endpoint, nor by dialling the link endpoint, which refuses it
/// before its handshake.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stranger_with_a_ticket_learns_no_address_of_the_host() {
    within(Duration::from_secs(60), async {
        let relay = TestRelay::start().await;
        let home = HostHome::new("stranger-no-address");
        home.relays(&[&relay.url]);
        let (upstream, mut requests) = stub_kleio_host(|_| {
            let body = br#"{"ok":false,"error":"unauthorized"}"#;
            Some(http_answer("401 Unauthorized", body))
        })
        .await;
        let options = loopback_direct(&[&relay]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.on_relay(&relay.url).await;
        let ticket = ticket(home.id(), home.pair_id(), &[&relay.url], "ABC-DEF");
        let keys = [ticket.key(), ticket.pair_key()];
        let relays = std::slice::from_ref(ticket.relay());
        let stranger = bind_client(SecretKey::generate(), relays, &options)
            .await
            .expect("the stranger's endpoint binds");

        // A wrong code on kleio/pair/0.
        let body = redeem_request("XYZ-123");
        let asked = ask_holding(&stranger, ticket.pair_key(), ticket.relay(), &body, &keys).await;
        requests.recv().await.expect("the redeem request");
        assert_eq!(asked.answer, json!({"ok": false, "error": "unauthorized"}));
        assert!(
            asked.learnt_no_address(),
            "a wrong code learnt the host's addresses: paths {:?}, known {:?}",
            asked.paths,
            asked.known
        );

        // The link's key on kleio/http/0, through the relay.
        let addr = EndpointAddr::from(ticket.key()).with_relay_url(ticket.relay().clone());
        let err = stranger
            .connect(addr, ALPN_HTTP)
            .await
            .expect_err("the link endpoint refuses a stranger");
        assert!(refused_outright(&err), "{err}");
        for key in keys {
            let known = known_ips(&stranger, key).await;
            assert!(known.is_empty(), "the stranger learnt {known:?}");
        }
        assert!(
            requests.try_recv().is_err(),
            "nothing more reached kleio-host"
        );
        stranger.close().await;
    })
    .await;
}
