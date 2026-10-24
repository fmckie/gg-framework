//! `kleio/pair/0`: one redeem request per connection, passed to kleio-host's
//! `POST /kleio/pair/redeem` through its link listener, which names the
//! phone's key, and kleio-host's answer passed back as it is.
//!
//! kleio-host decides, by code, expiry and the five tries, and binds the new
//! device to the key. The forwarder reads at most 2 KiB of request and
//! 16 KiB of answer, and sends kleio-host only `{code, redemptionNonce,
//! label}`. kleio-host writes its allow-list before it answers, so on
//! `ok: true` the forwarder reads the list again before the phone gets the
//! answer, and the phone's next connection gets in. Nothing here logs the
//! request or the answer: they carry the code, the nonce and the device
//! token.

use std::fmt;
use std::io;
use std::time::Duration;

use iroh::endpoint::{Connection, ReadToEndError, VarInt};
use iroh::EndpointId;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::Instant;
use tracing::{error, info, warn};

use super::budget::PairBudget;
use super::gate::{AllowList, Device};
use super::upstream::Upstream;
use crate::pair::{
    read_answer, PairError, PairRequest, MAX_PAIR_ANSWER_BYTES, MAX_PAIR_REQUEST_BYTES,
};
use crate::{close, LINK_HOST};

/// kleio-host's redeem route (`PAIR_REDEEM_PATH` in pair-code.ts).
const REDEEM_PATH: &str = "/kleio/pair/redeem";

/// How long one pairing exchange may take here, from the phone's stream to
/// its closing the connection.
const EXCHANGE_TIMEOUT: Duration = Duration::from_secs(15);

/// How long kleio-host gets to answer a redeem request, connecting included.
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(10);

/// The most of an answer's status line and headers the forwarder reads.
const MAX_HEAD_BYTES: usize = 4 * 1024;

/// The answer to a request that isn't a redeem body: kleio-host's own answer
/// to one.
const BAD_REQUEST: &[u8] = br#"{"ok":false,"error":"bad_request"}"#;

/// Handles one pairing connection, if the budget lets it in.
pub(super) async fn serve(
    conn: Connection,
    upstream: &Upstream,
    allow: &AllowList,
    budget: &PairBudget,
) {
    let key = conn.remote_id();
    let peer = key.fmt_short();
    let _turn = match budget.try_start(Instant::now()) {
        Ok(turn) => turn,
        Err(refusal) => {
            warn!("{peer} pairing turned away: {refusal}");
            conn.close(VarInt::from_u32(close::PAIR_BUSY), refusal.reason());
            return;
        }
    };
    match tokio::time::timeout(EXCHANGE_TIMEOUT, exchange(&conn, key, upstream, allow)).await {
        Ok(Ok(())) => {}
        Ok(Err(failure)) => {
            warn!("{peer} pairing failed: {failure}");
            conn.close(VarInt::from_u32(close::PAIR_FAILED), failure.reason());
        }
        Err(_) => {
            warn!(
                "{peer} pairing failed: not done within {} s",
                EXCHANGE_TIMEOUT.as_secs()
            );
            conn.close(
                VarInt::from_u32(close::PAIR_FAILED),
                b"pairing took too long",
            );
        }
    }
}

/// Why a pairing exchange didn't finish.
enum Failure {
    /// The phone's side of the stream failed.
    Phone(String),
    /// kleio-host didn't answer.
    Upstream(UpstreamError),
}

impl Failure {
    /// The close reason the phone gets.
    fn reason(&self) -> &'static [u8] {
        match self {
            Self::Phone(_) => b"pairing failed",
            Self::Upstream(_) => b"kleio-host didn't answer",
        }
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Phone(why) => write!(f, "the phone's stream failed: {why}"),
            Self::Upstream(why) => write!(f, "kleio-host didn't answer: {why}"),
        }
    }
}

/// Reads the request, gets kleio-host's answer, and sends it back.
async fn exchange(
    conn: &Connection,
    key: EndpointId,
    upstream: &Upstream,
    allow: &AllowList,
) -> Result<(), Failure> {
    let peer = key.fmt_short();
    let phone = |err: &dyn fmt::Display| Failure::Phone(err.to_string());
    let (mut send, mut recv) = conn.accept_bi().await.map_err(|err| phone(&err))?;
    let answer = match recv.read_to_end(MAX_PAIR_REQUEST_BYTES).await {
        Ok(request) => match serde_json::from_slice::<PairRequest>(&request) {
            Ok(request) => {
                let body = serde_json::to_vec(&request).expect("a request of strings serializes");
                let answer =
                    tokio::time::timeout(UPSTREAM_TIMEOUT, post_redeem(upstream, &key, &body))
                        .await
                        .unwrap_or(Err(UpstreamError::TimedOut))
                        .map_err(Failure::Upstream)?;
                record_outcome(key, &answer, allow);
                answer
            }
            Err(_) => {
                warn!("{peer} pairing refused: not a redeem request");
                BAD_REQUEST.to_vec()
            }
        },
        Err(ReadToEndError::TooLong) => {
            warn!("{peer} pairing refused: a request over {MAX_PAIR_REQUEST_BYTES} bytes");
            BAD_REQUEST.to_vec()
        }
        Err(err) => return Err(phone(&err)),
    };
    send.write_all(&answer).await.map_err(|err| phone(&err))?;
    send.finish().map_err(|err| phone(&err))?;
    // The phone closes the connection once it has the whole answer.
    conn.closed().await;
    Ok(())
}

/// Reads the allow-list again if kleio-host paired the key, so its next
/// connection gets in, and logs the outcome.
fn record_outcome(key: EndpointId, answer: &[u8], allow: &AllowList) {
    let peer = key.fmt_short();
    match read_answer(answer) {
        Ok(payload) => {
            let device = Device::from_payload(&payload);
            let label = device.label.clone().unwrap_or_default();
            // kleio-host wrote its allow-list before it answered.
            if let Err(err) = allow.reload() {
                error!("{peer} paired as {label:?}, but the allow-list can't be read: {err}");
            }
            if allow.contains(&key) {
                info!(
                    "{peer} paired as {label:?}; {} keys on the allow-list",
                    allow.len()
                );
            } else {
                allow.add_provisional(key, device);
                warn!(
                    "{peer} paired as {label:?}, but kleio-host's allow-list doesn't have it, so it gets in only until the list next changes"
                );
            }
        }
        Err(PairError::Refused(code)) => info!("{peer} pairing refused by kleio-host ({code:?})"),
        Err(_) => {
            warn!("{peer} pairing: kleio-host's answer isn't a redeem answer; passed on as it is")
        }
    }
}

/// Why kleio-host's answer didn't come.
#[derive(Debug)]
enum UpstreamError {
    Io(io::Error),
    TimedOut,
    TooLong,
    Malformed,
}

impl fmt::Display for UpstreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "{err}"),
            Self::TimedOut => write!(f, "no answer within {} s", UPSTREAM_TIMEOUT.as_secs()),
            Self::TooLong => write!(f, "an answer over {MAX_PAIR_ANSWER_BYTES} bytes"),
            Self::Malformed => f.write_str("not an HTTP answer it can read"),
        }
    }
}

/// `POST /kleio/pair/redeem` with `body`, for `key`, and the answer's body.
async fn post_redeem(
    upstream: &Upstream,
    key: &EndpointId,
    body: &[u8],
) -> Result<Vec<u8>, UpstreamError> {
    let mut tcp = upstream.connect(key).await.map_err(UpstreamError::Io)?;
    let head = format!(
        "POST {REDEEM_PATH} HTTP/1.1\r\nhost: {LINK_HOST}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );
    tcp.write_all(head.as_bytes())
        .await
        .map_err(UpstreamError::Io)?;
    tcp.write_all(body).await.map_err(UpstreamError::Io)?;
    let limit = MAX_HEAD_BYTES + MAX_PAIR_ANSWER_BYTES;
    let mut response = Vec::new();
    (&mut tcp)
        .take(limit as u64 + 1)
        .read_to_end(&mut response)
        .await
        .map_err(UpstreamError::Io)?;
    if response.len() > limit {
        return Err(UpstreamError::TooLong);
    }
    answer_body(&response)
}

/// Where an HTTP message's head ends: the index of its blank line's `\r\n\r\n`.
pub(super) fn head_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

/// The body of kleio-host's answer. kleio-host always sends a
/// `content-length` and closes the connection after one answer, so a chunked
/// answer isn't read.
fn answer_body(response: &[u8]) -> Result<Vec<u8>, UpstreamError> {
    let end = head_end(response).ok_or(UpstreamError::Malformed)?;
    let head = std::str::from_utf8(&response[..end]).map_err(|_| UpstreamError::Malformed)?;
    let mut lines = head.split("\r\n");
    if !lines
        .next()
        .is_some_and(|status| status.starts_with("HTTP/1."))
    {
        return Err(UpstreamError::Malformed);
    }
    let mut length = None;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(UpstreamError::Malformed)?;
        let name = name.trim();
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(UpstreamError::Malformed);
        }
        if name.eq_ignore_ascii_case("content-length") {
            let value = value.trim().parse::<usize>();
            length = Some(value.map_err(|_| UpstreamError::Malformed)?);
        }
    }
    let rest = &response[end + 4..];
    let body = match length {
        Some(length) => rest.get(..length).ok_or(UpstreamError::Malformed)?,
        None => rest,
    };
    if body.len() > MAX_PAIR_ANSWER_BYTES {
        return Err(UpstreamError::TooLong);
    }
    Ok(body.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(head: &str, body: &str) -> Vec<u8> {
        format!("{head}\r\n\r\n{body}").into_bytes()
    }

    #[test]
    fn reads_the_body_of_kleio_hosts_answer() {
        let body = r#"{"ok":false,"error":"unauthorized"}"#;
        let head = format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close",
            body.len()
        );
        assert_eq!(
            answer_body(&response(&head, body)).expect("read"),
            body.as_bytes()
        );
    }

    #[test]
    fn reads_to_the_end_without_a_length() {
        let answer = response("HTTP/1.1 200 OK\r\nconnection: close", "{}");
        assert_eq!(answer_body(&answer).expect("read"), b"{}");
    }

    #[test]
    fn refuses_an_answer_cut_short_chunked_or_not_http() {
        for answer in [
            response("HTTP/1.1 200 OK\r\ncontent-length: 10", "{}"),
            response("HTTP/1.1 200 OK\r\ncontent-length: x", "{}"),
            response(
                "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked",
                "2\r\n{}\r\n0\r\n\r\n",
            ),
            response("SSH-2.0-OpenSSH_9.8", ""),
            response("HTTP/1.1 200 OK\r\nno colon here", "{}"),
            b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n".to_vec(),
        ] {
            assert!(
                matches!(answer_body(&answer), Err(UpstreamError::Malformed)),
                "{:?}",
                String::from_utf8_lossy(&answer)
            );
        }
    }

    #[test]
    fn reads_no_more_than_16_kib_of_answer() {
        let fits = " ".repeat(MAX_PAIR_ANSWER_BYTES);
        let read = answer_body(&response("HTTP/1.1 200 OK", &fits)).expect("read");
        assert_eq!(read.len(), MAX_PAIR_ANSWER_BYTES);
        let over = " ".repeat(MAX_PAIR_ANSWER_BYTES + 1);
        assert!(matches!(
            answer_body(&response("HTTP/1.1 200 OK", &over)),
            Err(UpstreamError::TooLong)
        ));
    }
}
