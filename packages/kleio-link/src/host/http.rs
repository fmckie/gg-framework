//! `kleio/http/0`: each stream of an allowed connection, copied both ways to
//! kleio-host's link listener (upstream.rs), or answered with a 502 when
//! kleio-host doesn't take the connection.

use std::sync::Arc;
use std::time::Duration;

use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::EndpointId;
use tracing::{debug, warn};

use super::upstream::Upstream;

/// A stream's answer when kleio-host doesn't take the connection, so the app
/// can say Kleio isn't running on the host.
pub(crate) const BAD_GATEWAY: &[u8] = b"HTTP/1.1 502 Bad Gateway\r\ncontent-type: application/json\r\ncontent-length: 22\r\nconnection: close\r\n\r\n{\"error\":\"kleio_down\"}";

/// How long, after a 502, the forwarder keeps reading what the phone sends,
/// so that the phone isn't told to stop sending before it has read the 502.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

/// Forwards each stream until the connection closes. The path log says why
/// it closed.
pub(super) async fn serve(conn: Connection, upstream: Arc<Upstream>) {
    let key = conn.remote_id();
    while let Ok((send, recv)) = conn.accept_bi().await {
        tokio::spawn(forward(send, recv, Arc::clone(&upstream), key));
    }
}

async fn forward(send: SendStream, recv: RecvStream, upstream: Arc<Upstream>, key: EndpointId) {
    let peer = key.fmt_short();
    let mut tcp = match upstream.connect(&key).await {
        Ok(tcp) => tcp,
        Err(err) => {
            warn!(
                "{peer}: kleio-host at {} didn't take the connection ({err}); answered 502",
                upstream.addr()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_502s_length_is_its_body() {
        let text = std::str::from_utf8(BAD_GATEWAY).expect("text");
        let (head, body) = text.split_once("\r\n\r\n").expect("a head and a body");
        assert_eq!(body, r#"{"error":"kleio_down"}"#);
        assert!(head.contains(&format!("content-length: {}", body.len())));
    }
}
