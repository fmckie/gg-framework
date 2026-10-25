//! Pairing over [`ALPN_PAIR`], in three steps, each of which the app shows
//! ([`PairStage`]), [`PAIR_TIMEOUT`] at most in all:
//!
//! 1. **Reaching the relay**: the one the ticket names first, and only that
//!    one. The pairing endpoint has it as its only relay, so it's the home
//!    relay, and iroh says when it's connected. If it isn't within
//!    [`RELAY_STEP`], one `GET /ping` (crate::probe) says whether nothing
//!    answers there or something that isn't a relay does.
//! 2. **Finding your host**: a dial of the ticket's key through that relay and
//!    the ticket's direct addresses, for up to [`HOST_STEP`]. If no host
//!    answers and the ticket names n0's relays, a throwaway key looks for the
//!    host on n0's other relays: a handshake and nothing more, never the
//!    code. Finding it there means the QR code's relay was changed.
//! 3. **Pairing**: one request on one stream, the answer on the same stream,
//!    then the phone closes the connection. The request is kleio-host's
//!    redeem body, `{code, redemptionNonce, label}`, at most
//!    [`MAX_PAIR_REQUEST_BYTES`]. The host's forwarder passes it to
//!    `POST /kleio/pair/redeem` and sends back kleio-host's answer as it is,
//!    at most [`MAX_PAIR_ANSWER_BYTES`]: `{"ok":true,"payload":{…}}` or
//!    `{"ok":false,"error":"…"}`. kleio-host decides, by code, expiry and the
//!    five tries.
//!
//! Each way it can fail has its own [`PairError`], in words a person can act
//! on. Nothing here logs the code, the nonce or the answer, which carries the
//! device token.

use std::error::Error;
use std::fmt;
use std::time::Duration;

use iroh::endpoint::{
    ConnectError, ConnectingError, Connection, ConnectionError, ReadToEndError, VarInt,
};
use iroh::{Endpoint, EndpointAddr, RelayUrl, SecretKey, TransportAddr, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{info, warn};

use crate::endpoint::{bind_client, EndpointOptions};
use crate::link::DIAL_TIMEOUT;
use crate::paths::relay_used;
use crate::probe::{Ping, Probe, PROBE_TIMEOUT};
use crate::relays::n0_relays;
use crate::ticket::Ticket;
use crate::{close, error_chain, ALPN_PAIR};

/// The most a pairing request may be. The forwarder reads no more.
pub const MAX_PAIR_REQUEST_BYTES: usize = 2 * 1024;

/// The most the phone reads of an answer.
pub const MAX_PAIR_ANSWER_BYTES: usize = 16 * 1024;

/// The whole of [`pair`], every step included.
pub const PAIR_TIMEOUT: Duration = Duration::from_secs(20);

/// How long the ticket's relay gets to connect.
pub const RELAY_STEP: Duration = Duration::from_secs(5);

/// How long the host gets to answer through it: a link's dial limit.
pub const HOST_STEP: Duration = DIAL_TIMEOUT;

/// How long the look on n0's other relays gets.
pub const ELSEWHERE_STEP: Duration = Duration::from_secs(4);

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

/// The step [`pair`] is on, for the app to show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PairStage {
    Relay,
    Host,
    Pairing,
}

impl PairStage {
    /// What the app shows while it's on this step.
    pub fn text(self) -> &'static str {
        match self {
            Self::Relay => "Reaching the relay…",
            Self::Host => "Finding your host…",
            Self::Pairing => "Pairing…",
        }
    }
}

/// Why kleio-host turned a code away: its redeem answer's `error`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// `used`: this code paired a device already.
    Used,
    /// `unauthorized`: not the code the host is waiting for.
    Unauthorized,
    /// `expired`: this code's five minutes are up.
    Expired,
    /// `not_found`: the host isn't waiting for a code.
    NotFound,
    /// `locked`: five wrong tries used this code up.
    Locked,
    /// `replaced`: the host has shown a newer code since.
    Replaced,
    /// Any other, such as `bad_request`.
    Other(String),
}

impl Refusal {
    pub fn from_code(code: &str) -> Self {
        match code {
            "used" => Self::Used,
            "unauthorized" => Self::Unauthorized,
            "expired" => Self::Expired,
            "not_found" => Self::NotFound,
            "locked" => Self::Locked,
            "replaced" => Self::Replaced,
            other => Self::Other(other.to_string()),
        }
    }

    /// kleio-host's code for it.
    pub fn code(&self) -> &str {
        match self {
            Self::Used => "used",
            Self::Unauthorized => "unauthorized",
            Self::Expired => "expired",
            Self::NotFound => "not_found",
            Self::Locked => "locked",
            Self::Replaced => "replaced",
            Self::Other(code) => code,
        }
    }
}

/// Why pairing failed. Each says so in words a person can act on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairError {
    /// The device name makes the request longer than
    /// [`MAX_PAIR_REQUEST_BYTES`].
    LabelTooLong,
    /// The link's endpoint didn't start.
    Endpoint(String),
    /// Nothing answered at the ticket's relay: DNS, connecting or TLS
    /// failed, or nothing came back in time. An offline device gets this.
    RelayUnreachable { relay: String, why: String },
    /// Something answered at the ticket's relay address, but not as a relay
    /// does, or it turned down the relay handshake.
    NotARelay { relay: String, why: String },
    /// The relay answered, but no host with the ticket's key did, through it
    /// or on n0's other relays.
    HostMissing,
    /// The relay answered without the host, but the key answers on another of
    /// n0's relays: the QR code's relay was changed.
    HostElsewhere { relay: String },
    /// The host is pairing another device, or has had ten tries this minute
    /// ([`close::PAIR_BUSY`]).
    Busy,
    /// The host's link answered, but couldn't get an answer from kleio-host
    /// ([`close::PAIR_FAILED`]).
    HostFailed,
    /// The host doesn't serve pairing on the link ([`close::UNKNOWN_ALPN`]).
    NotSupported,
    /// The connection opened, but the request or the answer didn't get
    /// through.
    Request(String),
    /// Not done within [`PAIR_TIMEOUT`].
    TimedOut,
    /// The answer wasn't a redeem answer, or was longer than
    /// [`MAX_PAIR_ANSWER_BYTES`].
    Unreadable,
    /// kleio-host turned the code away.
    Refused(Refusal),
}

impl fmt::Display for PairError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const NEW_QR: &str = "Show a new QR code on your host and scan that.";
        match self {
            Self::LabelTooLong => f.write_str("That device name is too long."),
            Self::Endpoint(why) => write!(f, "Kleio couldn't start its link: {why}"),
            Self::RelayUnreachable { relay, .. } => write!(
                f,
                "Kleio can't reach the relay in this QR code ({relay}). Check this device is online, or try another network."
            ),
            Self::NotARelay { relay, .. } => write!(
                f,
                "The relay in this QR code ({relay}) isn't a relay. {NEW_QR}"
            ),
            Self::HostMissing => f.write_str(
                "No host with this QR code's key answered. Check you're scanning the QR code on your own host, and that it's awake.",
            ),
            Self::HostElsewhere { .. } => write!(
                f,
                "Your host is online, but not on the relay this QR code names. {NEW_QR}"
            ),
            Self::Busy => f.write_str("Your host is pairing another device. Try again in a minute."),
            Self::HostFailed => f.write_str(
                "Your host's link answered, but Kleio on it didn't. Check Kleio is running on your host, then try again.",
            ),
            Self::NotSupported => f.write_str(
                "Your host doesn't pair this way. Update Kleio on your host, then show a new QR code.",
            ),
            Self::Request(why) => write!(f, "Pairing didn't finish: {why}"),
            Self::TimedOut => write!(
                f,
                "Pairing took longer than {} s. Check your connection, then try again.",
                PAIR_TIMEOUT.as_secs()
            ),
            Self::Unreadable => f.write_str(
                "Your host sent an answer Kleio can't read. Update Kleio on your host and on this device.",
            ),
            Self::Refused(refusal) => match refusal {
                Refusal::Used => f.write_str(
                    "This QR code was already used to pair a device. Show a new one on your host and scan that.",
                ),
                Refusal::Unauthorized => write!(
                    f,
                    "The code in this QR code doesn't match your host's. {NEW_QR}"
                ),
                Refusal::Expired => f.write_str(
                    "This QR code has expired: codes last 5 minutes. Show a new one on your host and scan it.",
                ),
                Refusal::NotFound => write!(
                    f,
                    "Your host isn't waiting for a pairing code. {NEW_QR}"
                ),
                Refusal::Locked => write!(
                    f,
                    "Too many wrong codes were tried with this QR code. {NEW_QR}"
                ),
                Refusal::Replaced => f.write_str(
                    "Your host has shown a newer QR code since this one. Scan the newest one.",
                ),
                Refusal::Other(code) => write!(f, "Your host refused the code ({code})."),
            },
        }
    }
}

impl Error for PairError {}

/// Pairs with the host `ticket` names, as `key`: the three steps above, with
/// `stage` told as each begins, from endpoints built with `options` (the
/// app's are the defaults). Returns kleio-host's pairing payload, which
/// carries the device token: the caller checks it, stores it and never logs
/// it. The pairing endpoint is closed before this returns.
pub async fn pair<P, F>(
    key: SecretKey,
    ticket: &Ticket,
    label: &str,
    options: &EndpointOptions,
    probe: &P,
    stage: F,
) -> Result<Value, PairError>
where
    P: Probe,
    F: Fn(PairStage) + Sync,
{
    let body = request_body(ticket.code(), &nonce()?, label)?;
    let relay = std::slice::from_ref(ticket.relay());
    let endpoint = bind_client(key, relay, options)
        .await
        .map_err(|err| PairError::Endpoint(error_chain(&err)))?;
    let peer = ticket.key().fmt_short();
    info!("pairing with {peer} through {}", ticket.relay());
    let steps = steps(&endpoint, ticket, &body, options, probe, &stage);
    let outcome = tokio::time::timeout(PAIR_TIMEOUT, steps)
        .await
        .unwrap_or(Err(PairError::TimedOut));
    endpoint.close().await;
    log_outcome(&peer.to_string(), &outcome);
    outcome
}

async fn steps<P: Probe>(
    endpoint: &Endpoint,
    ticket: &Ticket,
    body: &[u8],
    options: &EndpointOptions,
    probe: &P,
    stage: &(impl Fn(PairStage) + Sync),
) -> Result<Value, PairError> {
    stage(PairStage::Relay);
    reach_relay(endpoint, ticket.relay(), probe).await?;
    stage(PairStage::Host);
    let host = EndpointAddr::from_parts(
        ticket.key(),
        ticket.addrs().iter().copied().map(TransportAddr::Ip),
    )
    .with_relay_url(ticket.relay().clone());
    let conn = match tokio::time::timeout(HOST_STEP, endpoint.connect(host, ALPN_PAIR)).await {
        Ok(Ok(conn)) => conn,
        Ok(Err(err)) => return Err(connect_failure(&err)),
        Err(_) => return Err(look_elsewhere(ticket, options).await),
    };
    stage(PairStage::Pairing);
    exchange(&conn, body).await
}

/// Waits up to [`RELAY_STEP`] for the endpoint's home relay, `relay`, to
/// connect, and asks it `GET /ping` meanwhile, in case it doesn't.
async fn reach_relay<P: Probe>(
    endpoint: &Endpoint,
    relay: &RelayUrl,
    probe: &P,
) -> Result<(), PairError> {
    let asked = {
        let (probe, relay) = (probe.clone(), relay.clone());
        tokio::spawn(async move { probe.ping(relay).await })
    };
    if tokio::time::timeout(RELAY_STEP, connected(endpoint, relay))
        .await
        .is_ok()
    {
        asked.abort();
        return Ok(());
    }
    let ping = match tokio::time::timeout(PROBE_TIMEOUT, asked).await {
        Ok(Ok(ping)) => ping,
        Ok(Err(err)) => Ping::NoAnswer(err.to_string()),
        Err(_) => Ping::NoAnswer(format!("no answer within {} s", PROBE_TIMEOUT.as_secs())),
    };
    relay_verdict(relay, ping, relay_error(endpoint, relay))
}

/// What the relay step makes of a relay that didn't connect in time, from
/// what `GET /ping` heard and the relay connection's latest error.
fn relay_verdict(relay: &RelayUrl, ping: Ping, refused: Option<String>) -> Result<(), PairError> {
    let relay = relay.host_str().unwrap_or_default().to_string();
    match (ping, refused) {
        (Ping::NoAnswer(why), _) => Err(PairError::RelayUnreachable { relay, why }),
        (Ping::NotARelay(why), _) => Err(PairError::NotARelay { relay, why }),
        (Ping::Relay(_), Some(why)) => Err(PairError::NotARelay {
            relay,
            why: format!("it turned down the relay handshake: {why}"),
        }),
        // Answering as a relay, and just slow: on to the host.
        (Ping::Relay(_), None) => Ok(()),
    }
}

/// Once `relay`, the endpoint's home relay, is connected.
async fn connected(endpoint: &Endpoint, relay: &RelayUrl) {
    let mut watcher = endpoint.home_relay_status();
    let mut statuses = watcher.get();
    loop {
        if statuses
            .iter()
            .any(|status| status.url() == relay && status.is_connected())
        {
            return;
        }
        statuses = match watcher.updated().await {
            Ok(statuses) => statuses,
            Err(_) => return std::future::pending().await,
        };
    }
}

/// The latest error connecting to `relay`, the endpoint's home relay.
fn relay_error(endpoint: &Endpoint, relay: &RelayUrl) -> Option<String> {
    endpoint
        .home_relay_status()
        .get()
        .iter()
        .find(|status| status.url() == relay)
        .and_then(|status| status.last_error().map(ToString::to_string))
}

/// Whether the host is on another of n0's relays, if the ticket names
/// theirs: a dial from a throwaway key through all of the others, which only
/// completes a handshake. It never sends the code, so a QR code whose relay
/// was changed can't pair through a relay it doesn't name.
async fn look_elsewhere(ticket: &Ticket, options: &EndpointOptions) -> PairError {
    if !ticket.names_n0() {
        return PairError::HostMissing;
    }
    let others: Vec<RelayUrl> = n0_relays()
        .into_iter()
        .filter(|relay| relay != ticket.relay())
        .collect();
    if others.is_empty() {
        return PairError::HostMissing;
    }
    let Ok(endpoint) = bind_client(SecretKey::generate(), &others, options).await else {
        return PairError::HostMissing;
    };
    info!(
        "{} isn't on {}: looking on n0's other relays",
        ticket.key().fmt_short(),
        ticket.relay()
    );
    let host = EndpointAddr::from_parts(ticket.key(), others.into_iter().map(TransportAddr::Relay));
    let found = match tokio::time::timeout(ELSEWHERE_STEP, endpoint.connect(host, ALPN_PAIR)).await
    {
        Ok(Ok(conn)) => {
            let relay = relay_used(&conn);
            conn.close(VarInt::from_u32(close::DONE), b"only looking");
            Some(relay)
        }
        Ok(Err(_)) | Err(_) => None,
    };
    // Closing waits for the host to hear: no need to wait here.
    tokio::spawn(async move { endpoint.close().await });
    match found {
        Some(relay) => PairError::HostElsewhere {
            relay: relay.map_or_else(|| "another of n0's relays".to_string(), |r| r.to_string()),
        },
        None => PairError::HostMissing,
    }
}

/// [`pair`]'s last step on its own, to any address, without the relay and
/// host steps: for tests that dial a loopback address.
#[cfg(test)]
pub(crate) async fn redeem(
    endpoint: &Endpoint,
    host: EndpointAddr,
    code: &str,
    label: &str,
) -> Result<Value, PairError> {
    let body = request_body(code, &nonce()?, label)?;
    let peer = host.id.fmt_short().to_string();
    let call = async {
        let conn = endpoint
            .connect(host, ALPN_PAIR)
            .await
            .map_err(|err| connect_failure(&err))?;
        exchange(&conn, &body).await
    };
    let outcome = tokio::time::timeout(PAIR_TIMEOUT, call)
        .await
        .unwrap_or(Err(PairError::TimedOut));
    log_outcome(&peer, &outcome);
    outcome
}

fn log_outcome(peer: &str, outcome: &Result<Value, PairError>) {
    match outcome {
        Ok(_) => info!("paired with {peer}"),
        // Debug escapes whatever text the host sent.
        Err(err) => warn!("pairing with {peer} failed: {err:?}"),
    }
}

/// Sends `body`, finishes, and reads the answer to its end.
async fn exchange(conn: &Connection, body: &[u8]) -> Result<Value, PairError> {
    let sent = async {
        let (mut send, mut recv) = conn.open_bi().await.map_err(|err| failed(&err))?;
        send.write_all(body).await.map_err(|err| failed(&err))?;
        send.finish().map_err(|err| failed(&err))?;
        recv.read_to_end(MAX_PAIR_ANSWER_BYTES)
            .await
            .map_err(|err| match err {
                ReadToEndError::TooLong => PairError::Unreadable,
                err => failed(&err),
            })
    };
    let answer = match sent.await {
        Ok(answer) => answer,
        // The host may have closed the connection with a reason.
        Err(err) => {
            return Err(conn
                .close_reason()
                .as_ref()
                .and_then(closed_by_host)
                .unwrap_or(err))
        }
    };
    // The whole answer is in, and nothing else comes on this connection.
    conn.close(VarInt::from_u32(close::DONE), b"done");
    read_answer(&answer)
}

/// A failed dial, as a [`PairError`]: the host's reason if it closed the
/// connection with one.
fn connect_failure(err: &ConnectError) -> PairError {
    let reason = match err {
        ConnectError::Connection { source, .. } => Some(source),
        ConnectError::Connecting {
            source: ConnectingError::ConnectionError { source, .. },
            ..
        } => Some(source),
        _ => None,
    };
    reason
        .and_then(closed_by_host)
        .unwrap_or_else(|| PairError::Request(error_chain(err)))
}

/// The host's reason for closing a pairing connection, if it gave one.
fn closed_by_host(reason: &ConnectionError) -> Option<PairError> {
    let ConnectionError::ApplicationClosed(closed) = reason else {
        return None;
    };
    let code = closed.error_code.into_inner();
    [
        (close::PAIR_BUSY, PairError::Busy),
        (close::PAIR_FAILED, PairError::HostFailed),
        (close::UNKNOWN_ALPN, PairError::NotSupported),
    ]
    .into_iter()
    .find(|(close, _)| u64::from(*close) == code)
    .map(|(_, err)| err)
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
        }) => Err(PairError::Refused(Refusal::from_code(&code))),
        _ => Err(PairError::Unreadable),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::testing::{
        loopback_addr, loopback_endpoint, pairing_messages, pairing_table, within_30_s,
    };

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
    fn reads_each_refusal_kleio_host_sends() {
        for (code, refusal) in [
            ("used", Refusal::Used),
            ("unauthorized", Refusal::Unauthorized),
            ("expired", Refusal::Expired),
            ("not_found", Refusal::NotFound),
            ("locked", Refusal::Locked),
            ("replaced", Refusal::Replaced),
            ("bad_request", Refusal::Other("bad_request".into())),
        ] {
            let answer = json!({"ok": false, "error": code}).to_string();
            let err = read_answer(answer.as_bytes()).unwrap_err();
            assert_eq!(err, PairError::Refused(refusal.clone()), "{code}");
            assert_eq!(refusal.code(), code);
        }
    }

    /// The plan's pairing cases each have their own words: these are the
    /// table's (tests/fixtures/pairing-messages.json), whose words the app's
    /// tests check are all different, and no two errors here share words.
    #[test]
    fn says_each_case_in_its_own_words() {
        let relay = || "example.com".to_string();
        let rows = pairing_messages("pair.rs");
        assert_eq!(rows.len(), 11, "the table's cases from pair.rs");
        for (id, words) in &rows {
            let err = match id.as_str() {
                "used" => PairError::Refused(Refusal::Used),
                "unauthorized" => PairError::Refused(Refusal::Unauthorized),
                "expired" => PairError::Refused(Refusal::Expired),
                "not-found" => PairError::Refused(Refusal::NotFound),
                "locked" => PairError::Refused(Refusal::Locked),
                "replaced" => PairError::Refused(Refusal::Replaced),
                "host-missing" => PairError::HostMissing,
                "host-elsewhere" => PairError::HostElsewhere { relay: relay() },
                "not-a-relay" => PairError::NotARelay {
                    relay: relay(),
                    why: "it answered HTTP 404".into(),
                },
                "relay-unreachable" => PairError::RelayUnreachable {
                    relay: relay(),
                    why: "dns error".into(),
                },
                "busy" => PairError::Busy,
                other => panic!("the table has {other} from pair.rs, which says no such thing"),
            };
            assert_eq!(err.to_string(), *words, "{id}");
        }
        let all = [
            PairError::LabelTooLong,
            PairError::Endpoint("no socket".into()),
            PairError::RelayUnreachable {
                relay: relay(),
                why: "dns".into(),
            },
            PairError::NotARelay {
                relay: relay(),
                why: "404".into(),
            },
            PairError::HostMissing,
            PairError::HostElsewhere { relay: relay() },
            PairError::Busy,
            PairError::HostFailed,
            PairError::NotSupported,
            PairError::Request("reset".into()),
            PairError::TimedOut,
            PairError::Unreadable,
            PairError::Refused(Refusal::Used),
            PairError::Refused(Refusal::Unauthorized),
            PairError::Refused(Refusal::Expired),
            PairError::Refused(Refusal::NotFound),
            PairError::Refused(Refusal::Locked),
            PairError::Refused(Refusal::Replaced),
            PairError::Refused(Refusal::Other("bad_request".into())),
        ];
        let texts: std::collections::BTreeSet<String> =
            all.iter().map(ToString::to_string).collect();
        assert_eq!(texts.len(), all.len(), "two cases share words");
    }

    /// Each step in the table's words, sent to the app by the name the
    /// table files them under.
    #[test]
    fn names_each_step() {
        let stages = &pairing_table()["stages"];
        let steps = [PairStage::Relay, PairStage::Host, PairStage::Pairing];
        for step in steps {
            let name = serde_json::to_value(step).unwrap();
            let name = name.as_str().expect("a step's name");
            assert_eq!(step.text(), stages[name], "{name}");
        }
        assert_eq!(stages.as_object().map(|s| s.len()), Some(steps.len()));
        assert_eq!(
            steps.map(PairStage::text),
            ["Reaching the relay…", "Finding your host…", "Pairing…"]
        );
    }

    #[test]
    fn tells_a_relay_that_cant_be_reached_from_one_that_isnt_a_relay() {
        let relay: RelayUrl = "https://example.com/".parse().unwrap();
        let ms = Duration::from_millis;
        assert_eq!(
            relay_verdict(&relay, Ping::NoAnswer("dns error".into()), None),
            Err(PairError::RelayUnreachable {
                relay: "example.com".into(),
                why: "dns error".into()
            })
        );
        assert!(matches!(
            relay_verdict(&relay, Ping::NotARelay("it answered HTTP 404".into()), None),
            Err(PairError::NotARelay { .. })
        ));
        // It answers /ping as a relay does, but turned down the handshake.
        assert!(matches!(
            relay_verdict(
                &relay,
                Ping::Relay(ms(90)),
                Some("unexpected status 400".into())
            ),
            Err(PairError::NotARelay { .. })
        ));
        // It answers as a relay does, and just hasn't connected yet.
        assert_eq!(relay_verdict(&relay, Ping::Relay(ms(90)), None), Ok(()));
    }

    #[test]
    fn reads_the_hosts_reasons_for_closing() {
        use iroh::endpoint::ApplicationClose;
        let closed = |code: u32| {
            ConnectionError::ApplicationClosed(ApplicationClose {
                error_code: VarInt::from_u32(code),
                reason: Vec::new().into(),
            })
        };
        assert_eq!(
            closed_by_host(&closed(close::PAIR_BUSY)),
            Some(PairError::Busy)
        );
        assert_eq!(
            closed_by_host(&closed(close::PAIR_FAILED)),
            Some(PairError::HostFailed)
        );
        assert_eq!(
            closed_by_host(&closed(close::UNKNOWN_ALPN)),
            Some(PairError::NotSupported)
        );
        assert_eq!(closed_by_host(&closed(close::DONE)), None);
        assert_eq!(closed_by_host(&ConnectionError::TimedOut), None);
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
