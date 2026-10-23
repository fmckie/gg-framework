//! Asking a relay whether it's there: one HTTPS `GET /ping`, as iroh's net
//! report sends one, with iroh's certificate roots and no proxy.
//!
//! An iroh relay answers `/ping` with 200 and nothing in it. Anything else
//! that answers is a web server but not a relay: that's how pairing tells a QR
//! code whose relay was changed to some other https address. The host asks
//! its relays the same way to choose one (host/relays.rs).

use std::collections::BTreeMap;
use std::future::Future;
use std::time::Duration;

use iroh::RelayUrl;
use tokio::task::JoinSet;
use tokio::time::Instant;

use crate::endpoint::RelayTrust;
use crate::error_chain;

/// How long a relay gets to answer.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// iroh-relay's `RELAY_PROBE_PATH`.
const PROBE_PATH: &str = "/ping";

/// The most of an answer's body read. A relay's has nothing in it.
const MAX_BODY_BYTES: usize = 1024;

/// What a relay said to `GET /ping`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ping {
    /// It answered as an iroh relay does, in this long.
    Relay(Duration),
    /// Something answered, but not as a relay does: what it said.
    NotARelay(String),
    /// Nothing answered: why (DNS, connecting, TLS, or the time limit).
    NoAnswer(String),
}

impl Ping {
    /// How long it took to answer as a relay, if it did.
    pub fn latency(&self) -> Option<Duration> {
        match self {
            Self::Relay(latency) => Some(*latency),
            Self::NotARelay(_) | Self::NoAnswer(_) => None,
        }
    }
}

/// Asks a relay whether it's there. The tests use a fake one.
pub trait Probe: Clone + Send + Sync + 'static {
    /// What `relay` answers to `GET /ping`.
    fn ping(&self, relay: RelayUrl) -> impl Future<Output = Ping> + Send;
}

/// [`Probe`] over HTTPS: the certificate roots the endpoint has for relays
/// (iroh's, and any `trust` adds), iroh's TLS provider, no proxy, no
/// redirects, and [`PROBE_TIMEOUT`].
#[derive(Debug, Clone)]
pub struct HttpsProbe {
    client: reqwest::Client,
}

impl HttpsProbe {
    pub fn new(trust: &RelayTrust) -> Result<Self, String> {
        let tls = trust
            .ca_tls_config()
            .client_config(iroh::tls::default_provider())
            .map_err(|err| format!("Can't set up TLS to ask relays: {err}"))?;
        let client = reqwest::Client::builder()
            .tls_backend_preconfigured(tls)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(PROBE_TIMEOUT)
            .build()
            .map_err(|err| format!("Can't set up asking relays: {err}"))?;
        Ok(Self { client })
    }
}

impl Probe for HttpsProbe {
    fn ping(&self, relay: RelayUrl) -> impl Future<Output = Ping> + Send {
        let client = self.client.clone();
        async move {
            let url = match relay.join(PROBE_PATH) {
                Ok(url) => url,
                Err(err) => return Ping::NoAnswer(err.to_string()),
            };
            let start = Instant::now();
            let mut answer = match client.get(url).send().await {
                Ok(answer) => answer,
                Err(err) => return Ping::NoAnswer(error_chain(&err)),
            };
            let latency = start.elapsed();
            let status = answer.status();
            let mut body = 0;
            while body <= MAX_BODY_BYTES {
                match answer.chunk().await {
                    Ok(Some(chunk)) => body += chunk.len(),
                    Ok(None) => break,
                    Err(err) => {
                        return Ping::NotARelay(format!(
                            "it answered {status}, then broke off: {}",
                            error_chain(&err)
                        ))
                    }
                }
            }
            read_ping(status.as_u16(), body, latency)
        }
    }
}

/// What an answer to `GET /ping` with `status` and a `body`-byte body says.
fn read_ping(status: u16, body: usize, latency: Duration) -> Ping {
    match (status, body) {
        (200, 0) => Ping::Relay(latency),
        (200, _) => Ping::NotARelay("it answered 200 with a page, which a relay doesn't".into()),
        (status, _) => Ping::NotARelay(format!("it answered HTTP {status}")),
    }
}

/// Asks each of `relays` at once, and gives what each said.
pub async fn ping_all<P: Probe>(probe: &P, relays: Vec<RelayUrl>) -> BTreeMap<RelayUrl, Ping> {
    let mut asked = JoinSet::new();
    for relay in relays {
        let probe = probe.clone();
        asked.spawn(async move {
            let answer = tokio::time::timeout(PROBE_TIMEOUT, probe.ping(relay.clone()))
                .await
                .unwrap_or_else(|_| {
                    Ping::NoAnswer(format!("no answer within {} s", PROBE_TIMEOUT.as_secs()))
                });
            (relay, answer)
        });
    }
    let mut answers = BTreeMap::new();
    while let Some(done) = asked.join_next().await {
        if let Ok((relay, answer)) = done {
            answers.insert(relay, answer);
        }
    }
    answers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_empty_200_is_a_relay() {
        let latency = Duration::from_millis(150);
        assert_eq!(read_ping(200, 0, latency), Ping::Relay(latency));
        assert_eq!(read_ping(200, 0, latency).latency(), Some(latency));
        for (status, body) in [
            (200, 1),
            (200, 5000),
            (204, 0),
            (404, 0),
            (404, 120),
            (502, 0),
        ] {
            let ping = read_ping(status, body, latency);
            assert!(
                matches!(ping, Ping::NotARelay(_)),
                "{status} {body}: {ping:?}"
            );
            assert_eq!(ping.latency(), None);
        }
    }

    /// A probe that never answers.
    #[derive(Clone)]
    struct Silent;

    impl Probe for Silent {
        fn ping(&self, _relay: RelayUrl) -> impl Future<Output = Ping> + Send {
            std::future::pending()
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_relay_that_never_answers_gets_5_s() {
        let relay: RelayUrl = "https://relay.example.com/".parse().expect("a relay");
        let start = Instant::now();
        let answers = ping_all(&Silent, vec![relay.clone()]).await;
        assert_eq!(start.elapsed(), PROBE_TIMEOUT);
        assert_eq!(
            answers.get(&relay),
            Some(&Ping::NoAnswer("no answer within 5 s".into()))
        );
    }
}
