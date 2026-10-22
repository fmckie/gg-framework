//! `kleio/http/0`: each stream of an allowed connection, copied both ways to
//! kleio-host over TCP, or answered with a 502 when kleio-host doesn't take
//! the connection.

use std::fmt::Display;
use std::net::SocketAddr;
use std::time::Duration;

use iroh::endpoint::{Connection, RecvStream, SendStream};
use tracing::{debug, warn};

use super::connect_upstream;

/// A stream's answer when kleio-host doesn't take the connection, as
/// `tailscale serve` answers when kleio-host is down.
pub(crate) const BAD_GATEWAY: &[u8] =
    b"HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";

/// How long, after a 502, the forwarder keeps reading what the phone sends,
/// so that the phone isn't told to stop sending before it has read the 502.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

/// Forwards each stream until the connection closes. The path log says why
/// it closed.
pub(super) async fn serve(conn: Connection, upstream: SocketAddr) {
    let peer = conn.remote_id().fmt_short();
    while let Ok((send, recv)) = conn.accept_bi().await {
        tokio::spawn(forward(send, recv, upstream, peer));
    }
}

async fn forward(
    send: SendStream,
    recv: RecvStream,
    upstream: SocketAddr,
    peer: impl Display + Send + 'static,
) {
    let mut tcp = match connect_upstream(upstream).await {
        Ok(tcp) => tcp,
        Err(err) => {
            warn!(
                "{peer}: kleio-host at {upstream} didn't take the connection ({err}); answered 502"
            );
            bad_gateway(send, recv).await;
            return;
        }
    };
    let mut stream = tokio::io::join(recv, send);
    match tokio::io::copy_bidirectional(&mut stream, &mut tcp).await {
        Ok((to_host, from_host)) => {
            debug!("{peer}: stream finished: {to_host} B to kleio-host, {from_host} B back")
        }
        Err(err) => debug!("{peer}: stream ended: {err}"),
    }
}

async fn bad_gateway(mut send: SendStream, mut recv: RecvStream) {
    if send.write_all(BAD_GATEWAY).await.is_err() || send.finish().is_err() {
        return;
    }
    let mut sink = tokio::io::sink();
    let drain = tokio::io::copy(&mut recv, &mut sink);
    let _ = tokio::time::timeout(DRAIN_TIMEOUT, drain).await;
}
