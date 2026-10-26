//! A big answer through a shared relay doesn't hold up the connection's other
//! answers (the plan's step 52): kleio-link-host's congestion control keeps
//! the relay's queue short (src/host/mod.rs, `transport`).

mod common;

use std::time::{Duration, Instant};

use common::{
    get, http_answer, phone, relay_only, stub_kleio_host, ticket, within, HostHome, TestRelay,
};
use kleio_link::host;
use kleio_link::iroh::SecretKey;
use kleio_link::link::{Link, Route};

/// The relay's limit, about n0's.
const LIMIT: u32 = 1024 * 1024;

/// The answer: Phase 2's file.
const SIZE: usize = 45 * 1024 * 1024;

/// Reads a whole answer on a stream of its own: its bytes, head and body.
async fn download(link: Link, path: &str) -> usize {
    let conn = link.connection().await.expect("connected");
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    let request =
        format!("GET {path} HTTP/1.1\r\nhost: link.kleio.invalid\r\nconnection: close\r\n\r\n");
    send.write_all(request.as_bytes()).await.expect("sends");
    let mut total = 0;
    let mut buf = vec![0; 64 * 1024];
    while let Some(n) = recv.read(&mut buf).await.expect("reads") {
        total += n;
    }
    let _ = send.finish();
    total
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_request_alongside_a_big_answer_through_a_rate_limited_relay_takes_under_a_second() {
    within(Duration::from_secs(120), async {
        // 1 MiB a second after the first 256 KiB, from each end.
        let relay = TestRelay::rate_limited(LIMIT, 256 * 1024).await;
        let home = HostHome::new("pacing");
        home.relays(&[&relay.url]);
        let big = vec![b'x'; SIZE];
        let (upstream, _requests) = stub_kleio_host(move |request| {
            if request.line.starts_with("GET /big ") {
                Some(http_answer("200 OK", &big))
            } else {
                Some(http_answer("200 OK", br#"{"ok":true}"#))
            }
        })
        .await;
        let options = relay_only(&[&relay]);
        let key = SecretKey::generate();
        home.allow(&[key.public()], &[]);
        tokio::spawn(host::serve(home.config(upstream, options.clone())));
        home.state_when(|state| state["relay"] == relay.url.as_str())
            .await;
        let route = Route::from_ticket(&ticket(home.id(), &[&relay.url], "ABC-DEF"));
        let link = phone(key, route, &options).await;
        get(&link, "/kleio/health", None).await.expect("an answer");

        // A request each second while the answer comes.
        let started = Instant::now();
        let answer = tokio::spawn(download(link.clone(), "/big"));
        let mut slowest = Duration::ZERO;
        let mut asked = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if answer.is_finished() {
                break;
            }
            let asking = Instant::now();
            get(&link, "/kleio/health", None).await.expect("an answer");
            slowest = slowest.max(asking.elapsed());
            asked += 1;
        }
        let bytes = answer.await.expect("downloaded");
        let took = started.elapsed();

        assert!(bytes > SIZE, "the whole answer: {bytes} B");
        assert!(
            slowest < Duration::from_secs(1),
            "the slowest request alongside took {slowest:?}"
        );
        assert!(asked >= 30, "asked {asked} times");
        // At the relay's limit: 90% of it, with the requests and the first
        // 256 KiB in the time.
        let speed = SIZE as f64 / took.as_secs_f64() / f64::from(LIMIT);
        assert!(speed >= 0.9, "{SIZE} B in {took:?}: {speed:.2} of the limit");
        eprintln!(
            "{SIZE} B in {took:.1?} ({speed:.2} of the limit); {asked} requests alongside, the slowest {slowest:.1?}"
        );
    })
    .await;
}
