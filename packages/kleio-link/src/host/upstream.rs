//! kleio-host's link listener, 127.0.0.1:8445 (packages/kleio-host/src/link.ts).
//! Each connection to it opens with one line, before any of the phone's
//! bytes, naming the device the bytes come from:
//!
//! ```text
//! KLEIO-LINK/1 <the device's key: 64 hex> <secure/link-upstream.token>\r\n
//! ```
//!
//! kleio-host then takes the device's token only if its device paired with
//! that key. The secret is never logged.

use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::sync::{PoisonError, RwLock};
use std::time::Duration;

use iroh::EndpointId;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tracing::debug;

/// kleio-host's link listener, as kleio-host listens by default.
pub const DEFAULT_UPSTREAM: SocketAddr = SocketAddr::V4(std::net::SocketAddrV4::new(
    std::net::Ipv4Addr::LOCALHOST,
    8445,
));

/// How long kleio-host gets to take a TCP connection.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// The link listener, and the secret its connections open with.
pub(crate) struct Upstream {
    addr: SocketAddr,
    secret: RwLock<String>,
}

impl fmt::Debug for Upstream {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Upstream")
            .field("addr", &self.addr)
            .finish_non_exhaustive()
    }
}

impl Upstream {
    pub(crate) fn new(addr: SocketAddr, secret: String) -> Self {
        Self {
            addr,
            secret: RwLock::new(secret),
        }
    }

    pub(crate) fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// kleio-host made a new secret: the next connections use it.
    pub(crate) fn set_secret(&self, secret: String) {
        *self.secret.write().unwrap_or_else(PoisonError::into_inner) = secret;
    }

    /// A connection to kleio-host for `key`'s bytes, its first line written.
    pub(crate) async fn connect(&self, key: &EndpointId) -> io::Result<TcpStream> {
        let mut tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(self.addr))
            .await
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("no connection within {} s", CONNECT_TIMEOUT.as_secs()),
                )
            })??;
        // Small writes, such as one event of a stream, go out at once instead
        // of waiting on Nagle's algorithm.
        if let Err(err) = tcp.set_nodelay(true) {
            debug!("couldn't turn off Nagle's algorithm: {err}");
        }
        let line = {
            let secret = self.secret.read().unwrap_or_else(PoisonError::into_inner);
            preamble(key, &secret)
        };
        tcp.write_all(line.as_bytes()).await?;
        Ok(tcp)
    }
}

/// The first line of a connection for `key`'s bytes.
pub(crate) fn preamble(key: &EndpointId, secret: &str) -> String {
    format!("KLEIO-LINK/1 {key} {secret}\r\n")
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;

    use super::*;

    #[test]
    fn names_the_key_as_kleio_host_reads_it() {
        let key = SecretKey::from_bytes(&[7; 32]).public();
        let secret = "Sx3_".repeat(10) + "abc";
        assert_eq!(
            preamble(&key, &secret),
            format!(
                "KLEIO-LINK/1 ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c {secret}\r\n"
            )
        );
        // kleio-host's PREAMBLE_MAX_BYTES, with the longest token.
        assert!(preamble(&key, &"a".repeat(128)).len() <= 256);
    }

    #[test]
    fn never_shows_the_secret() {
        let upstream = Upstream::new(DEFAULT_UPSTREAM, "t0k3n-t0k3n-t0k3n".into());
        let shown = format!("{upstream:?}");
        assert!(!shown.contains("t0k3n"), "{shown}");
        assert!(shown.contains("127.0.0.1:8445"), "{shown}");
    }
}
