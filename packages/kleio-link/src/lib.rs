//! Kleio's link over iroh: the end-to-end encrypted connection between the
//! Kleio app and its host, in place of Tailscale
//! (docs/adr/0002-kleio-link-replaces-tailscale.md).
//!
//! The host runs `kleio-link-host` next to kleio-host; the phone dials it by
//! key through the relays the host names, first in its pairing ticket, with
//! no address lookup. Both ends share this crate, so they share one ticket
//! check, one relay list and one protocol definition.
//!
//! The phone's side:
//! - [`ticket`]: the v4 pairing ticket a QR code carries.
//! - [`endpoint`]: the iroh endpoint, with no address lookup and no port
//!   mapping, whose only relay is the host's.
//! - [`link`]: one cached connection on [`ALPN_HTTP`], dialled again on the
//!   first use after it closes, in two stages: the host's last relay, then
//!   every relay in its list.
//! - [`forward`]: the loopback listener, which turns each TCP connection into
//!   a stream on that connection.
//! - [`pair`]: pairing on [`ALPN_PAIR`], with a reason of its own for each
//!   way it can fail.
//! - [`paths`]: the path log the field tests' path timelines come from.
//! - [`relays`] and [`probe`]: relay lists, and asking a relay whether it's
//!   there, which both sides use.
//!
//! The host's side is module `host`, behind feature `host`: what
//! `kleio-link-host serve` runs, with its gate, pairing, and the files it
//! shares with kleio-host in kleio-host's state folder.

use std::error::Error;

pub mod endpoint;
pub mod forward;
#[cfg(feature = "host")]
pub mod host;
pub mod link;
pub mod pair;
pub mod paths;
pub mod probe;
pub mod relays;
pub mod ticket;

/// iroh, at the version this crate pins, for the keys and addresses its API
/// takes and returns. gg-app names them through here rather than pinning
/// iroh a second time.
pub use iroh;

/// HTTP to kleio-host. Each TCP connection on the phone's loopback listener
/// becomes one bidirectional stream, copied both ways to kleio-host. Only keys
/// on the forwarder's allow-list get this far, and every request still carries
/// the device token kleio-host checks.
pub const ALPN_HTTP: &[u8] = b"kleio/http/0";

/// Pairing, open to any key: one redeem request per connection, which the
/// forwarder passes to kleio-host's `POST /kleio/pair/redeem`.
pub const ALPN_PAIR: &[u8] = b"kleio/pair/0";

/// The host requests over the link name: `http://link.kleio.invalid`.
/// `.invalid` never resolves, so it can't be taken for a real address.
pub const LINK_HOST: &str = "link.kleio.invalid";

/// The QUIC close codes the host sends, which both ends read.
pub mod close {
    /// The exchange is over.
    pub const DONE: u32 = 0;
    /// `kleio/http/0` from a key that isn't on the host's allow-list.
    pub const NOT_PAIRED: u32 = 1;
    /// `kleio/pair/0` while another pairing is in flight, or after 10 in a
    /// minute.
    pub const PAIR_BUSY: u32 = 2;
    /// The pairing didn't finish: kleio-host didn't answer, the phone's
    /// stream failed, or it took too long.
    pub const PAIR_FAILED: u32 = 3;
    /// A protocol the host doesn't serve.
    pub const UNKNOWN_ALPN: u32 = 4;
    /// `kleio/http/0` from a key whose device was revoked.
    pub const REVOKED: u32 = 5;
}

/// An error and its causes on one line, for logs and messages. A cause whose
/// text the line already ends with is left out, so wrappers that repeat their
/// source don't print it twice.
pub(crate) fn error_chain(err: &dyn Error) -> String {
    let mut line = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !line.ends_with(&text) {
            line.push_str(": ");
            line.push_str(&text);
        }
        source = cause.source();
    }
    line
}

/// For tests that need no network: endpoints with no relay and sockets bound
/// to loopback only. (Binding the unspecified address could also raise the
/// macOS firewall's prompt for every new test binary.)
#[cfg(test)]
pub(crate) mod testing {
    use std::future::Future;
    use std::time::Duration;

    use iroh::endpoint::Builder;
    use iroh::{Endpoint, EndpointAddr, RelayMode, SecretKey};

    use crate::endpoint::{builder, EndpointOptions};

    /// `builder` with its sockets on loopback only.
    pub(crate) fn on_loopback(builder: Builder) -> Builder {
        builder
            .bind_addr("127.0.0.1:0")
            .expect("a loopback address")
            .bind_addr("[::1]:0")
            .expect("a loopback address")
    }

    pub(crate) async fn loopback_endpoint(seed: u8, alpns: &[&[u8]]) -> Endpoint {
        let configured = builder(
            SecretKey::from_bytes(&[seed; 32]),
            RelayMode::Disabled,
            &EndpointOptions::default(),
        )
        .alpns(alpns.iter().map(|alpn| alpn.to_vec()).collect());
        on_loopback(configured)
            .bind()
            .await
            .expect("an endpoint binds on loopback")
    }

    /// `endpoint`'s key and its IPv4 loopback socket: a direct address, which
    /// the tests dial instead of a relay.
    pub(crate) fn loopback_addr(endpoint: &Endpoint) -> EndpointAddr {
        let socket = endpoint
            .bound_sockets()
            .into_iter()
            .find(|socket| socket.is_ipv4())
            .expect("a bound IPv4 loopback socket");
        EndpointAddr::from(endpoint.id()).with_ip_addr(socket)
    }

    /// `test`, failing instead of hanging if it takes more than 30 s.
    pub(crate) async fn within_30_s<F: Future>(test: F) -> F::Output {
        tokio::time::timeout(Duration::from_secs(30), test)
            .await
            .expect("the test finishes within 30 s")
    }

    /// What Kleio says when pairing fails, case by case, and its steps: the
    /// table the app's tests read too (tests/fixtures/pairing-messages.json).
    pub(crate) fn pairing_table() -> serde_json::Value {
        serde_json::from_str(include_str!("../tests/fixtures/pairing-messages.json"))
            .expect("the pairing messages table is JSON")
    }

    /// The table's cases that `from` says, as (id, words), with `{relay}` as
    /// `example.com`.
    pub(crate) fn pairing_messages(from: &str) -> Vec<(String, String)> {
        pairing_table()["cases"]
            .as_array()
            .expect("the table's cases")
            .iter()
            .filter(|row| {
                row["from"]
                    .as_array()
                    .expect("what says it")
                    .iter()
                    .any(|says| says == from)
            })
            .map(|row| {
                let id = row["id"].as_str().expect("an id").to_string();
                let words = row["message"]
                    .as_str()
                    .expect("its words")
                    .replace("{relay}", "example.com");
                assert!(
                    !words.contains('{'),
                    "{id}: a stand-in the link doesn't fill"
                );
                (id, words)
            })
            .collect()
    }

    /// A folder of one test's own, deleted when dropped. `name` must be
    /// unique among the tests; the process id keeps two runs apart.
    #[cfg(any(feature = "host", unix))]
    pub(crate) struct TempDir(std::path::PathBuf);

    #[cfg(any(feature = "host", unix))]
    impl TempDir {
        pub(crate) fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("kleio-link-test-{}-{name}", std::process::id()));
            // Left over from an earlier run that had the same process id.
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("a temp folder");
            Self(path)
        }

        pub(crate) fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    #[cfg(any(feature = "host", unix))]
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A file's or folder's permission bits.
    #[cfg(unix)]
    pub(crate) fn mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .expect("it exists")
            .permissions()
            .mode()
            & 0o777
    }
}

#[cfg(test)]
mod tests {
    use std::fmt;

    use super::*;

    #[derive(Debug)]
    struct Wrapped {
        text: &'static str,
        source: Option<Box<Wrapped>>,
    }

    impl fmt::Display for Wrapped {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(self.text)
        }
    }

    impl Error for Wrapped {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            self.source.as_deref().map(|e| e as &(dyn Error + 'static))
        }
    }

    /// The first text, caused by the second, caused by the third…
    fn wrapped(texts: &[&'static str]) -> Wrapped {
        let (text, causes) = texts.split_first().expect("at least one text");
        Wrapped {
            text,
            source: (!causes.is_empty()).then(|| Box::new(wrapped(causes))),
        }
    }

    #[test]
    fn writes_an_error_and_its_causes_on_one_line() {
        let err = wrapped(&["dial failed", "no route", "network unreachable"]);
        assert_eq!(
            error_chain(&err),
            "dial failed: no route: network unreachable"
        );
    }

    #[test]
    fn leaves_out_a_cause_the_line_already_ends_with() {
        let err = wrapped(&["dial failed: timed out", "timed out"]);
        assert_eq!(error_chain(&err), "dial failed: timed out");
    }
}
