//! The pairing call on [`ALPN_PAIR`]: one request on one stream, the answer on
//! the same stream, then the phone closes the connection.
//!
//! The request is kleio-host's redeem body, `{code, redemptionNonce, label}`,
//! at most [`MAX_PAIR_REQUEST_BYTES`]. The host's forwarder passes it to
//! `POST /kleio/pair/redeem` and sends back kleio-host's answer as it is, at
//! most [`MAX_PAIR_ANSWER_BYTES`]: `{"ok":true,"payload":{…}}` or
//! `{"ok":false,"error":"…"}`. kleio-host decides, by code, expiry and the
//! five tries, and the errors read as `kleio_pair`'s do.
//!
//! Nothing here logs the code, the nonce or the answer, which carries the
//! device token.

use std::error::Error;
use std::fmt;
use std::time::Duration;

use iroh::endpoint::{ReadToEndError, VarInt};
use iroh::{Endpoint, EndpointAddr};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{info, warn};

use crate::link::host_addr;
use crate::ticket::Ticket;
use crate::{close, error_chain, ALPN_PAIR};

/// The most a pairing request may be. The forwarder reads no more.
pub const MAX_PAIR_REQUEST_BYTES: usize = 2 * 1024;

/// The most the phone reads of an answer.
pub const MAX_PAIR_ANSWER_BYTES: usize = 16 * 1024;

/// The whole call, dial included: `kleio_pair`'s request timeout.
pub const PAIR_TIMEOUT: Duration = Duration::from_secs(15);

/// Random bytes in a redemption nonce (`REDEMPTION_NONCE_BYTES` in
/// packages/kleio-host/src/pair-code.ts).
const NONCE_BYTES: usize = 16;

/// A pairing request: kleio-host's redeem body. It has no `Debug`, so the
/// code and nonce can't end up in a log by accident.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    /// The six-character code, without its dash.
    pub code: String,
    /// 32 lowercase hex characters, new for each call.
    pub redemption_nonce: String,
    /// The name the host lists the device under.
    pub label: String,
}

/// Why pairing failed. Each says so in words a person can act on, and reads
/// as `kleio_pair`'s errors do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairError {
    /// The device name makes the request longer than
    /// [`MAX_PAIR_REQUEST_BYTES`].
    LabelTooLong,
    /// No connection to the host: iroh's error and causes.
    Unreachable(String),
    /// The connection opened, but the request or the answer didn't get
    /// through.
    Request(String),
    /// No answer within [`PAIR_TIMEOUT`].
    TimedOut,
    /// The answer wasn't a redeem answer, or was longer than
    /// [`MAX_PAIR_ANSWER_BYTES`].
    Unreadable,
    /// The host turned the code away, with kleio-host's error code.
    Refused(String),
}

impl fmt::Display for PairError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LabelTooLong => f.write_str("That device name is too long."),
            Self::Unreachable(cause) => write!(f, "Can't reach the host: {cause}"),
            Self::Request(cause) => write!(f, "Pairing request failed: {cause}"),
            Self::TimedOut => write!(
                f,
                "Pairing request failed: no answer within {} s",
                PAIR_TIMEOUT.as_secs()
            ),
            Self::Unreadable => f.write_str("Host sent an unreadable reply"),
            Self::Refused(code) => match code.as_str() {
                "not_found" => f.write_str(
                    "No pair code is active on the host. Run `kleio-host pair` there first.",
                ),
                "unauthorized" => {
                    f.write_str("Code not recognised, or it expired. Mint a fresh one on the host.")
                }
                other => write!(f, "Host refused the code ({other})."),
            },
        }
    }
}

impl Error for PairError {}

/// Pairs with the host `ticket` names: dials its key through its relay, sends
/// the ticket's code with a new nonce and `label`, and returns kleio-host's
/// pairing payload. The payload carries the device token: the caller checks
/// it, stores it and never logs it.
pub async fn pair(endpoint: &Endpoint, ticket: &Ticket, label: &str) -> Result<Value, PairError> {
    let host = host_addr(ticket.key(), ticket.relay());
    redeem(endpoint, host, ticket.code(), label).await
}

/// [`pair`], to any address, so that the tests can dial a loopback one.
pub(crate) async fn redeem(
    endpoint: &Endpoint,
    host: EndpointAddr,
    code: &str,
    label: &str,
) -> Result<Value, PairError> {
    let body = request_body(code, &nonce()?, label)?;
    let peer = host.id.fmt_short();
    info!("pairing with {peer}");
    let outcome = match tokio::time::timeout(PAIR_TIMEOUT, exchange(endpoint, host, &body)).await {
        Ok(Ok(answer)) => read_answer(&answer),
        Ok(Err(err)) => Err(err),
        Err(_) => Err(PairError::TimedOut),
    };
    match &outcome {
        Ok(_) => info!("paired with {peer}"),
        // Debug escapes whatever text the host sent.
        Err(err) => warn!("pairing with {peer} failed: {err:?}"),
    }
    outcome
}

/// Dials, sends `body`, finishes, and reads the answer to its end.
async fn exchange(
    endpoint: &Endpoint,
    host: EndpointAddr,
    body: &[u8],
) -> Result<Vec<u8>, PairError> {
    let conn = endpoint
        .connect(host, ALPN_PAIR)
        .await
        .map_err(|err| PairError::Unreachable(error_chain(&err)))?;
    let (mut send, mut recv) = conn.open_bi().await.map_err(|err| failed(&err))?;
    send.write_all(body).await.map_err(|err| failed(&err))?;
    send.finish().map_err(|err| failed(&err))?;
    let answer = recv
        .read_to_end(MAX_PAIR_ANSWER_BYTES)
        .await
        .map_err(|err| match err {
            ReadToEndError::TooLong => PairError::Unreadable,
            err => failed(&err),
        })?;
    // The whole answer is in, and nothing else comes on this connection.
    conn.close(VarInt::from_u32(close::DONE), b"done");
    Ok(answer)
}

fn failed(err: &dyn Error) -> PairError {
    PairError::Request(error_chain(err))
}

/// The request's bytes. The code goes without its dash, as `kleio_pair`
/// sends it.
fn request_body(code: &str, nonce: &str, label: &str) -> Result<Vec<u8>, PairError> {
    let request = PairRequest {
        code: code.replace('-', ""),
        redemption_nonce: nonce.to_string(),
        label: label.to_string(),
    };
    let body = serde_json::to_vec(&request).map_err(|err| failed(&err))?;
    if body.len() > MAX_PAIR_REQUEST_BYTES {
        return Err(PairError::LabelTooLong);
    }
    Ok(body)
}

/// A new redemption nonce: 16 random bytes, as lowercase hex.
fn nonce() -> Result<String, PairError> {
    let mut bytes = [0u8; NONCE_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|err| PairError::Request(format!("no random nonce: {err}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// kleio-host's answer, read as `isPairRedeemResponse` reads it: a payload
/// object with `ok: true`, an error code with `ok: false`.
pub(crate) fn read_answer(answer: &[u8]) -> Result<Value, PairError> {
    #[derive(Deserialize)]
    struct Answer {
        ok: bool,
        payload: Option<Value>,
        error: Option<String>,
    }
    match serde_json::from_slice::<Answer>(answer) {
        Ok(Answer {
            ok: true,
            payload: Some(payload @ Value::Object(_)),
            ..
        }) => Ok(payload),
        Ok(Answer {
            ok: false,
            error: Some(code),
            ..
        }) => Err(PairError::Refused(code)),
        _ => Err(PairError::Unreadable),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::testing::{loopback_addr, loopback_endpoint, within_30_s};

    const NONCE: &str = "00112233445566778899aabbccddeeff";

    #[test]
    fn the_request_is_kleio_hosts_redeem_body() {
        let body = request_body("ABC-DEF", NONCE, "Finn's iPhone").unwrap();
        let sent: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            sent,
            json!({"code": "ABCDEF", "redemptionNonce": NONCE, "label": "Finn's iPhone"})
        );
    }

    #[test]
    fn refuses_a_label_that_takes_the_request_past_2_kib() {
        let room = MAX_PAIR_REQUEST_BYTES - request_body("ABC-DEF", NONCE, "").unwrap().len();
        let fits = request_body("ABC-DEF", NONCE, &"x".repeat(room)).unwrap();
        assert_eq!(fits.len(), MAX_PAIR_REQUEST_BYTES);
        assert_eq!(
            request_body("ABC-DEF", NONCE, &"x".repeat(room + 1)),
            Err(PairError::LabelTooLong)
        );
    }

    #[test]
    fn makes_a_new_nonce_each_time() {
        let (a, b) = (nonce().unwrap(), nonce().unwrap());
        assert_ne!(a, b);
        for n in [a, b] {
            assert_eq!(n.len(), 2 * NONCE_BYTES);
            assert!(
                n.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f')),
                "{n}"
            );
        }
    }

    #[test]
    fn reads_a_paired_answer() {
        let payload =
            read_answer(br#"{"ok":true,"payload":{"host":"mini","token":"t0k3n"}}"#).unwrap();
        assert_eq!(payload, json!({"host": "mini", "token": "t0k3n"}));
    }

    #[test]
    fn reads_a_refusal_in_kleio_pairs_words() {
        for (code, message) in [
            (
                "not_found",
                "No pair code is active on the host. Run `kleio-host pair` there first.",
            ),
            (
                "unauthorized",
                "Code not recognised, or it expired. Mint a fresh one on the host.",
            ),
            ("bad_request", "Host refused the code (bad_request)."),
        ] {
            let answer = json!({"ok": false, "error": code}).to_string();
            let err = read_answer(answer.as_bytes()).unwrap_err();
            assert_eq!(err, PairError::Refused(code.into()));
            assert_eq!(err.to_string(), message);
        }
    }

    #[test]
    fn anything_else_is_unreadable() {
        for answer in [
            "",
            "not json",
            "[]",
            "{}",
            r#"{"ok":true}"#,
            r#"{"ok":true,"payload":null}"#,
            r#"{"ok":true,"payload":"t0k3n"}"#,
            r#"{"ok":false}"#,
            r#"{"ok":false,"error":3}"#,
            r#"{"ok":"true","payload":{}}"#,
        ] {
            assert_eq!(
                read_answer(answer.as_bytes()),
                Err(PairError::Unreadable),
                "{answer:?}"
            );
        }
    }

    /// A host that answers one pairing request with `answer`, then hands back
    /// what it was sent.
    async fn pair_host(endpoint: Endpoint, answer: Vec<u8>) -> Value {
        let incoming = endpoint.accept().await.expect("a connection");
        let conn = incoming.await.expect("a handshake");
        assert_eq!(conn.alpn(), ALPN_PAIR);
        let (mut send, mut recv) = conn.accept_bi().await.expect("a stream");
        let request = recv
            .read_to_end(MAX_PAIR_REQUEST_BYTES)
            .await
            .expect("a request within 2 KiB");
        send.write_all(&answer).await.expect("answers");
        send.finish().expect("finishes");
        // The phone closes the connection once it has the answer.
        conn.closed().await;
        serde_json::from_slice(&request).expect("the request is JSON")
    }

    #[tokio::test]
    async fn pairs_over_one_stream() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let answer = br#"{"ok":true,"payload":{"host":"mini","token":"t0k3n"}}"#;
            let host_task = tokio::spawn(pair_host(host, answer.to_vec()));

            let payload = redeem(&phone, addr, "ABC-DEF", "Test iPhone").await;
            assert_eq!(payload, Ok(json!({"host": "mini", "token": "t0k3n"})));
            let sent = host_task.await.expect("the host finished");
            assert_eq!(sent["code"], "ABCDEF");
            assert_eq!(sent["label"], "Test iPhone");
            assert_eq!(sent["redemptionNonce"].as_str().map(str::len), Some(32));
        })
        .await;
    }

    #[tokio::test]
    async fn reads_no_more_than_16_kib_of_an_answer() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let answer = vec![b' '; MAX_PAIR_ANSWER_BYTES + 1];
            let host_task = tokio::spawn(pair_host(host, answer));

            let outcome = redeem(&phone, addr, "ABC-DEF", "Test iPhone").await;
            assert_eq!(outcome, Err(PairError::Unreadable));
            host_task.await.expect("the host finished");
        })
        .await;
    }
}
