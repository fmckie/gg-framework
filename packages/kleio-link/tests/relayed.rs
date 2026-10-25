//! Kleio's link through relays in the test process, with a stand-in for
//! kleio-host's link listener: kleio-link-host's `serve` as it runs, and
//! the phone's side as the app uses it. Pairing and how it fails, the gate's
//! close codes, revoking, the 502, failing over to the next relay, a
//! relay's rate limit, and why a phone didn't reach its host.

mod common;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{
    closed_port, closed_with, get, http_answer, json_body, phone, relay_only, status_and_body,
    stub_kleio_host, ticket, turned_away, until, watched_phone, within, write_allow, HostHome,
    Request, TestRelay,
};
use kleio_link::close;
use kleio_link::host::{self, FAILOVER_AFTER};
use kleio_link::iroh::{RelayUrl, SecretKey, Watcher};
use kleio_link::link::{LinkError, Route, Unreached};
use kleio_link::pair::{pair, PairError, PairStage, Refusal};
use kleio_link::probe::HttpsProbe;
use serde_json::json;

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
        home.state_when(|state| state["relay"] == relay.url.as_str())
            .await;

        let ticket = ticket(home.id(), &[&relay.url], "ABC-DEF");
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
        home.state_when(|state| state["relay"] == relay.url.as_str())
            .await;
        let probe = HttpsProbe::new(&options.trust).expect("a probe");

        for (code, refusal) in [
            ("AAA-111", Refusal::Used),
            ("BBB-222", Refusal::Unauthorized),
            ("CCC-333", Refusal::Expired),
        ] {
            let key = SecretKey::generate();
            let ticket = ticket(home.id(), &[&relay.url], code);
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

            // The key it tried with gets no further than the gate.
            let link = phone(key, Route::from_ticket(&ticket), &options).await;
            assert_eq!(turned_away(&link).await, LinkError::NotPaired);
        }
        assert!(
            requests.try_recv().is_err(),
            "nothing else reached kleio-host"
        );
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

        // A relay that isn't there: nothing answers at its address.
        let gone = closed_port().await;
        let nowhere = format!("https://{gone}/").parse().expect("a relay address");
        let ticket_nowhere = ticket(no_host, &[&nowhere], "ABC-DEF");
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

        // The relay is there, and no host with the ticket's key is on it.
        let ticket_no_host = ticket(no_host, &[&relay.url], "ABC-DEF");
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
        home.state_when(|state| state["relay"] == relay.url.as_str())
            .await;
        let route = || Route::from_ticket(&ticket(home.id(), &[&relay.url], "ABC-DEF"));

        for (key, refusal) in [
            (stranger, LinkError::NotPaired),
            (revoked, LinkError::Revoked),
        ] {
            let link = phone(key, route(), &options).await;
            assert_eq!(turned_away(&link).await, refusal);
        }
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
        home.state_when(|state| state["relay"] == relay.url.as_str())
            .await;

        let link = phone(
            key,
            Route::from_ticket(&ticket(home.id(), &[&relay.url], "ABC-DEF")),
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
        let route = Route::from_ticket(&ticket(home.id(), &[&first.url, &second.url], "ABC-DEF"));
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
            Route::from_ticket(&ticket(home.id(), &[&relay.url], "ABC-DEF")),
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
        home.state_when(|state| state["relay"] == relay.url.as_str())
            .await;
        let link = watched_phone(
            key,
            Route::from_ticket(&ticket(home.id(), &[&relay.url], "ABC-DEF")),
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

        // The relay answers; no host with the key is on it.
        let route = Route::from_ticket(&ticket(no_host, &[&relay.url], "ABC-DEF"));
        let link = watched_phone(SecretKey::generate(), route, &options).await;
        assert_eq!(link.unreached(), None, "nothing dialled yet");
        assert!(link.connection().await.is_err(), "no host answers");
        assert_eq!(link.unreached(), Some(Unreached::HostSilent));
        assert!(!link.dialling());

        // A relay that isn't there: nothing answers at its address, so the
        // relays are asked, and none answers.
        let gone = closed_port().await;
        let nowhere: RelayUrl = format!("https://{gone}/").parse().expect("a relay address");
        let route = Route::from_ticket(&ticket(no_host, &[&nowhere], "ABC-DEF"));
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
