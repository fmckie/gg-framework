//! Pairing over [`ALPN_PAIR`], in three steps, each of which the app shows
//! ([`PairStage`]), [`PAIR_TIMEOUT`] at most in all, then a wait for an
//! admin's Allow if kleio-host asks for one:
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
//!    redeem body, `{code, redemptionNonce, label, waits}`, at most
//!    [`MAX_PAIR_REQUEST_BYTES`]. The host's forwarder passes it to
//!    `POST /kleio/pair/redeem` and sends back kleio-host's answer as it is,
//!    at most [`MAX_PAIR_ANSWER_BYTES`]: `{"ok":true,"payload":{…}}` or
//!    `{"ok":false,"error":"…"}`. kleio-host decides, by code, expiry and the
//!    five tries, and holds the request a few seconds for an admin's Allow.
//! 4. **Waiting for an Allow**: an admin is asked about this device's code
//!    ([`device_code`]) as soon as kleio-host has the request, so the app
//!    shows it too once kleio-host has held the request for
//!    [`SHOW_WAIT_AFTER`], or answers `pending`: no admin has allowed the
//!    device yet. Then the phone asks again with the same request on a new
//!    connection, after the `retryAfterMs` kleio-host gives, until it has the
//!    payload or a refusal, or [`ALLOW_WAIT`] is up, or the app stops it
//!    ([`pair_until`]). Meanwhile a busy host and a connection that fails
//!    are asked again too.
//!
//! Each way it can fail has its own [`PairError`], in words a person can act
//! on. Nothing here logs the code, the nonce or the answer, which carries the
//! device token.

use std::error::Error;
use std::fmt;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use iroh::endpoint::{
    ConnectError, ConnectingError, Connection, ConnectionError, ReadToEndError, VarInt,
};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayUrl, SecretKey, TransportAddr, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::Instant;
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

/// [`pair`]'s first three steps together, and each time it asks again while
/// it waits for an Allow.
pub const PAIR_TIMEOUT: Duration = Duration::from_secs(20);

/// How long the ticket's relay gets to connect.
pub const RELAY_STEP: Duration = Duration::from_secs(5);

/// How long the host gets to answer through it: a link's dial limit.
pub const HOST_STEP: Duration = DIAL_TIMEOUT;

/// How long the look on n0's other relays gets.
pub const ELSEWHERE_STEP: Duration = Duration::from_secs(4);

/// How long the phone waits for an admin's Allow, from kleio-host's first
/// `pending`. It asks no more after that.
pub const ALLOW_WAIT: Duration = Duration::from_secs(120);

/// How long the first request may go unanswered before the app shows the
/// wait, with this device's code. kleio-host holds a request up to 5 s for
/// an admin's Allow (`PAIR_HOLD_MS` in packages/kleio-host/src/pair-code.ts),
/// and the admin is shown the code at once. A host that answers sooner, with
/// the payload or a refusal, shows no wait.
pub const SHOW_WAIT_AFTER: Duration = Duration::from_secs(1);

/// How long the phone waits to ask again after a busy host or a failed
/// connection, while it waits for an Allow (`PAIR_RETRY_AFTER_MS` in
/// packages/kleio-host/src/pair-code.ts).
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(3);

/// The least and the most of kleio-host's `retryAfterMs` the phone waits
/// before asking again: a host can't have it ask in a tight loop, or hold
/// off asking for long after an admin's Allow.
const MIN_RETRY_AFTER: Duration = Duration::from_millis(250);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(10);

/// How many of a key's hex characters its device code shows
/// (`DEVICE_CODE_LENGTH` in packages/kleio-host/src/pair-code.ts).
const DEVICE_CODE_LENGTH: usize = 6;

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
    /// The phone waits for an admin's Allow, asking again after `pending`, as
    /// kleio-host has a pairing over the link do. The app always sends
    /// `true`. A request from an app too old to send it reads as `false`, is
    /// passed on so, and kleio-host refuses it as `update_required`.
    #[serde(default)]
    pub waits: bool,
}

/// The step [`pair`] is on, for the app to show. The first three go to the
/// app as their names, `"relay"`; the wait as
/// `{"waiting":{"deviceCode":"3F9 AC2"}}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PairStage {
    Relay,
    Host,
    Pairing,
    /// Waiting for an admin's Allow. The admin is asked about the same
    /// device code ([`device_code`]).
    #[serde(rename_all = "camelCase")]
    Waiting {
        device_code: String,
    },
}

impl PairStage {
    /// What the app shows while it's on this step. Where this says "this
    /// device", the app names it ("this iPhone"), and shows the device code
    /// beside the wait's words.
    pub fn text(&self) -> &'static str {
        match self {
            Self::Relay => "Reaching the relay…",
            Self::Host => "Finding your host…",
            Self::Pairing => "Pairing…",
            Self::Waiting { .. } => "Waiting for your host to allow this device…",
        }
    }
}

/// A device's code, which the app shows while it waits for an Allow, and the
/// admin asked to allow it sees too: the first six hex characters of its key,
/// in capitals, in two groups, such as `3F9 AC2` (`formatDeviceCode` in
/// packages/kleio-host/src/pair-code.ts). The app makes a new key for each
/// pairing, so the code is new each time too.
pub fn device_code(key: &EndpointId) -> String {
    let hex = key.to_string()[..DEVICE_CODE_LENGTH].to_ascii_uppercase();
    let (first, second) = hex.split_at(DEVICE_CODE_LENGTH / 2);
    format!("{first} {second}")
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
    /// The device wasn't allowed: an admin's Deny, or the code closed or ran
    /// out while it waited (`denied`).
    Denied,
    /// Another device is waiting on this code (`claimed`).
    Claimed,
    /// No admin allowed the device within [`ALLOW_WAIT`].
    NotAllowedInTime,
    /// kleio-host refused a request that doesn't wait for an Allow
    /// (`update_required`). This app always waits, so the host's
    /// kleio-link-host, which passes the request on, is older than its
    /// kleio-host.
    UpdateRequired,
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
            Self::Denied => f.write_str(
                "Your host didn't allow this device. To try again, show a new QR code on your host and scan that.",
            ),
            Self::Claimed => write!(
                f,
                "Another device is already waiting to pair with this QR code. {NEW_QR}"
            ),
            Self::NotAllowedInTime => write!(
                f,
                "Nobody allowed this device on your host within {} minutes. Show a new QR code on your host, scan it, then allow the device there.",
                ALLOW_WAIT.as_secs() / 60
            ),
            Self::UpdateRequired => f.write_str(
                "Part of Kleio on your host is out of date, so it can't pair this device. Update Kleio on your host, then show a new QR code.",
            ),
        }
    }
}

impl Error for PairError {}

impl PairError {
    /// Whether it may pass: a busy host, or a connection that failed or took
    /// too long. While the phone waits for an Allow, it asks again after one.
    fn passes(&self) -> bool {
        matches!(
            self,
            Self::Busy | Self::HostFailed | Self::Request(_) | Self::TimedOut
        )
    }
}

/// Pairs with the host `ticket` names, as `key`: the steps above, with
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
    let unstopped = std::future::pending();
    pair_until(key, ticket, label, options, probe, stage, unstopped)
        .await
        .expect("a pairing nothing stops ends with its outcome")
}

/// [`pair`], unless `stop` completes first, as the app's Cancel does while
/// the phone waits for an Allow: then `None`, and the phone asks no more.
/// Its endpoint is closed either way, so an Allow after that pairs nothing
/// here. An ask under way is dropped with it, so kleio-host may list a
/// device whose Allow came just as the phone stopped.
pub async fn pair_until<P, F, S>(
    key: SecretKey,
    ticket: &Ticket,
    label: &str,
    options: &EndpointOptions,
    probe: &P,
    stage: F,
    stop: S,
) -> Option<Result<Value, PairError>>
where
    P: Probe,
    F: Fn(PairStage) + Sync,
    S: Future<Output = ()>,
{
    // One nonce for every ask: kleio-host knows the device by it and its key.
    let body = match nonce().and_then(|nonce| request_body(ticket.code(), &nonce, label)) {
        Ok(body) => body,
        Err(err) => return Some(Err(err)),
    };
    let code = device_code(&key.public());
    let relay = std::slice::from_ref(ticket.relay());
    let endpoint = match bind_client(key, relay, options).await {
        Ok(endpoint) => endpoint,
        Err(err) => return Some(Err(PairError::Endpoint(error_chain(&err)))),
    };
    let peer = ticket.key().fmt_short();
    info!("pairing with {peer} through {}", ticket.relay());
    let waiting = once(|| {
        info!("waiting for {peer} to allow device {code}");
        stage(PairStage::Waiting {
            device_code: code.clone(),
        });
    });
    let pairing = async {
        let steps = steps(&endpoint, ticket, &body, options, probe, &stage, &waiting);
        let first = tokio::time::timeout(PAIR_TIMEOUT, steps)
            .await
            .unwrap_or(Err(PairError::TimedOut));
        let host = host_addr(ticket);
        settle(first, &endpoint, host, &body, &waiting, ALLOW_WAIT).await
    };
    let outcome = tokio::select! {
        // A stop wins over an answer that comes with it.
        biased;
        () = stop => None,
        outcome = pairing => Some(outcome),
    };
    endpoint.close().await;
    match &outcome {
        Some(outcome) => log_outcome(&peer.to_string(), outcome),
        None => info!("pairing with {peer} stopped"),
    }
    outcome
}

/// `tell`, the first time only: the wait shows once, though both a held
/// first request and a `pending` begin it.
fn once(tell: impl Fn()) -> impl Fn() {
    let told = AtomicBool::new(false);
    move || {
        if !told.swap(true, Ordering::Relaxed) {
            tell();
        }
    }
}

async fn steps<P: Probe>(
    endpoint: &Endpoint,
    ticket: &Ticket,
    body: &[u8],
    options: &EndpointOptions,
    probe: &P,
    stage: &(impl Fn(PairStage) + Sync),
    waiting: &(impl Fn() + Sync),
) -> Result<Answer, PairError> {
    stage(PairStage::Relay);
    reach_relay(endpoint, ticket.relay(), probe).await?;
    stage(PairStage::Host);
    let conn = match tokio::time::timeout(HOST_STEP, endpoint.connect(host_addr(ticket), ALPN_PAIR))
        .await
    {
        Ok(Ok(conn)) => conn,
        Ok(Err(err)) => return Err(connect_failure(&err)),
        Err(_) => return Err(look_elsewhere(ticket, options).await),
    };
    stage(PairStage::Pairing);
    first_exchange(&conn, body, waiting).await
}

/// The host as the ticket names it: its key, through the ticket's relay and
/// at its direct addresses.
fn host_addr(ticket: &Ticket) -> EndpointAddr {
    EndpointAddr::from_parts(
        ticket.key(),
        ticket.addrs().iter().copied().map(TransportAddr::Ip),
    )
    .with_relay_url(ticket.relay().clone())
}

/// What the first answer comes to: the payload or a refusal, or, after
/// `pending`, what asking again comes to. `waiting` is told as the wait
/// begins, unless the first ask told it already ([`once`]). After `limit`
/// it asks no more, though an ask under way gets its answer: an Allow just
/// in time still pairs.
async fn settle(
    first: Result<Answer, PairError>,
    endpoint: &Endpoint,
    host: EndpointAddr,
    body: &[u8],
    waiting: &(impl Fn() + Sync),
    limit: Duration,
) -> Result<Value, PairError> {
    let mut retry_after = match first? {
        Answer::Paired(payload) => return Ok(payload),
        Answer::Pending(retry_after) => retry_after,
    };
    waiting();
    let deadline = Instant::now() + limit;
    loop {
        tokio::time::sleep_until(deadline.min(Instant::now() + retry_after)).await;
        if Instant::now() >= deadline {
            return Err(PairError::NotAllowedInTime);
        }
        let asked = tokio::time::timeout(PAIR_TIMEOUT, ask(endpoint, host.clone(), body))
            .await
            .unwrap_or(Err(PairError::TimedOut));
        retry_after = match asked {
            Ok(Answer::Paired(payload)) => return Ok(payload),
            Ok(Answer::Pending(next)) => next,
            Err(err) if err.passes() => {
                // Debug escapes whatever text the host sent.
                info!("asking {} again after {err:?}", host.id.fmt_short());
                RETRY_AFTER_FAILURE
            }
            Err(err) => return Err(err),
        };
    }
}

/// The request again, on a new connection to the host the first ask found.
async fn ask(endpoint: &Endpoint, host: EndpointAddr, body: &[u8]) -> Result<Answer, PairError> {
    let conn = dial(endpoint, host).await?;
    exchange(&conn, body).await
}

/// A new pairing connection to `host`, within [`HOST_STEP`].
async fn dial(endpoint: &Endpoint, host: EndpointAddr) -> Result<Connection, PairError> {
    match tokio::time::timeout(HOST_STEP, endpoint.connect(host, ALPN_PAIR)).await {
        Ok(Ok(conn)) => Ok(conn),
        Ok(Err(err)) => Err(connect_failure(&err)),
        Err(_) => Err(PairError::TimedOut),
    }
}

/// [`exchange`], telling `waiting` if the answer takes longer than
/// [`SHOW_WAIT_AFTER`]: kleio-host is holding the request for an admin's
/// Allow, and has shown the admin this device's code.
async fn first_exchange(
    conn: &Connection,
    body: &[u8],
    waiting: &(impl Fn() + Sync),
) -> Result<Answer, PairError> {
    let answer = exchange(conn, body);
    tokio::pin!(answer);
    if let Ok(answer) = tokio::time::timeout(SHOW_WAIT_AFTER, &mut answer).await {
        return answer;
    }
    waiting();
    answer.await
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

/// [`pair`]'s last steps on their own, to any address, without the relay and
/// host steps, waiting for an Allow up to `limit`: for tests that dial a
/// loopback address.
#[cfg(test)]
pub(crate) async fn redeem(
    endpoint: &Endpoint,
    host: EndpointAddr,
    code: &str,
    label: &str,
    limit: Duration,
    stage: impl Fn(PairStage) + Sync,
) -> Result<Value, PairError> {
    let body = request_body(code, &nonce()?, label)?;
    let peer = host.id.fmt_short().to_string();
    let waiting = once(|| {
        stage(PairStage::Waiting {
            device_code: device_code(&endpoint.id()),
        })
    });
    let first = async {
        let conn = dial(endpoint, host.clone()).await?;
        first_exchange(&conn, &body, &waiting).await
    };
    let first = tokio::time::timeout(PAIR_TIMEOUT, first)
        .await
        .unwrap_or(Err(PairError::TimedOut));
    let outcome = settle(first, endpoint, host, &body, &waiting, limit).await;
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
async fn exchange(conn: &Connection, body: &[u8]) -> Result<Answer, PairError> {
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
        waits: true,
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

/// kleio-host's answer to a redeem request, short of a refusal.
pub(crate) enum Answer {
    /// Paired: kleio-host's pairing payload, which carries the device token.
    Paired(Value),
    /// No admin has allowed the device yet: ask again after this long.
    Pending(Duration),
}

impl fmt::Debug for Answer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // The payload carries the device token: never shown.
            Self::Paired(_) => f.write_str("Paired(…)"),
            Self::Pending(after) => f.debug_tuple("Pending").field(after).finish(),
        }
    }
}

/// kleio-host's answer, read as `isPairRedeemResponse` reads it: a payload
/// object with `ok: true`; with `ok: false`, `pending` with when to ask again
/// and when the code runs out, or why it was refused.
pub(crate) fn read_answer(answer: &[u8]) -> Result<Answer, PairError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Raw {
        ok: bool,
        payload: Option<Value>,
        error: Option<String>,
        retry_after_ms: Option<Value>,
        expires_at: Option<Value>,
    }
    let refused = match serde_json::from_slice::<Raw>(answer) {
        Ok(Raw {
            ok: true,
            payload: Some(payload @ Value::Object(_)),
            ..
        }) => return Ok(Answer::Paired(payload)),
        Ok(Raw {
            ok: false,
            error: Some(code),
            retry_after_ms,
            expires_at,
            ..
        }) => match code.as_str() {
            "pending" => {
                let after = retry_after_ms.as_ref().and_then(Value::as_u64);
                let runs_out = expires_at.as_ref().is_some_and(Value::is_number);
                return match after {
                    Some(ms) if runs_out => Ok(Answer::Pending(retry_after(ms))),
                    _ => Err(PairError::Unreadable),
                };
            }
            "denied" => PairError::Denied,
            "claimed" => PairError::Claimed,
            "update_required" => PairError::UpdateRequired,
            code => PairError::Refused(Refusal::from_code(code)),
        },
        _ => PairError::Unreadable,
    };
    Err(refused)
}

/// How long to wait before asking again, from kleio-host's `retryAfterMs`:
/// at least [`MIN_RETRY_AFTER`], at most [`MAX_RETRY_AFTER`].
fn retry_after(ms: u64) -> Duration {
    Duration::from_millis(ms).clamp(MIN_RETRY_AFTER, MAX_RETRY_AFTER)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

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
            json!({"code": "ABCDEF", "redemptionNonce": NONCE, "label": "Finn's iPhone", "waits": true})
        );
    }

    #[test]
    fn an_older_apps_request_reads_as_one_that_doesnt_wait() {
        let old = json!({"code": "ABCDEF", "redemptionNonce": NONCE, "label": "Old iPhone"});
        let request: PairRequest = serde_json::from_value(old).unwrap();
        assert!(!request.waits);
        // Passed on so, kleio-host refuses it as update_required.
        let passed = serde_json::to_value(&request).unwrap();
        assert_eq!(passed["waits"], false);
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

    /// The key kleio-host's preamble test names
    /// (`names_the_key_as_kleio_host_reads_it` in host/upstream.rs), whose
    /// hex begins `ea4a6c`.
    #[test]
    fn a_device_code_is_its_keys_first_six_hex_characters_in_two_groups() {
        let key = SecretKey::from_bytes(&[7; 32]).public();
        assert!(key.to_string().starts_with("ea4a6c"));
        assert_eq!(device_code(&key), "EA4 A6C");
        let other = SecretKey::from_bytes(&[8; 32]).public();
        assert_ne!(device_code(&other), device_code(&key));
    }

    fn paired(answer: Result<Answer, PairError>) -> Value {
        match answer {
            Ok(Answer::Paired(payload)) => payload,
            other => panic!("not paired: {other:?}"),
        }
    }

    #[test]
    fn reads_a_paired_answer() {
        let payload = paired(read_answer(
            br#"{"ok":true,"payload":{"host":"mini","token":"t0k3n"}}"#,
        ));
        assert_eq!(payload, json!({"host": "mini", "token": "t0k3n"}));
    }

    #[test]
    fn never_shows_a_paired_answers_payload() {
        let answer = read_answer(br#"{"ok":true,"payload":{"token":"t0k3n"}}"#);
        assert_eq!(format!("{answer:?}"), "Ok(Paired(…))");
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

    #[test]
    fn reads_a_wait_for_an_allow_and_how_one_ends() {
        let pending = |retry: Value| {
            let answer = json!({"ok": false, "error": "pending", "retryAfterMs": retry, "expiresAt": 1_700_000_300_000_u64});
            read_answer(answer.to_string().as_bytes())
        };
        let ms = Duration::from_millis;
        for (retry, after) in [
            (json!(3000), ms(3000)),
            // Not in a tight loop, nor long after an Allow.
            (json!(0), MIN_RETRY_AFTER),
            (json!(600_000), MAX_RETRY_AFTER),
        ] {
            match pending(retry.clone()) {
                Ok(Answer::Pending(got)) => assert_eq!(got, after, "{retry}"),
                other => panic!("{retry}: {other:?}"),
            }
        }
        for retry in [json!(-1), json!(1.5), json!("3000"), Value::Null] {
            assert!(
                matches!(pending(retry.clone()), Err(PairError::Unreadable)),
                "{retry}"
            );
        }
        // kleio-host always says when the code runs out.
        let no_end = br#"{"ok":false,"error":"pending","retryAfterMs":3000}"#;
        assert!(matches!(read_answer(no_end), Err(PairError::Unreadable)));

        for (code, err) in [
            ("denied", PairError::Denied),
            ("claimed", PairError::Claimed),
            ("update_required", PairError::UpdateRequired),
        ] {
            let answer = json!({"ok": false, "error": code}).to_string();
            assert_eq!(read_answer(answer.as_bytes()).unwrap_err(), err, "{code}");
        }
    }

    /// The plan's pairing cases each have their own words: these are the
    /// table's (tests/fixtures/pairing-messages.json), whose words the app's
    /// tests check are all different, and no two errors here share words.
    #[test]
    fn says_each_case_in_its_own_words() {
        let relay = || "example.com".to_string();
        let rows = pairing_messages("pair.rs");
        assert_eq!(rows.len(), 15, "the table's cases from pair.rs");
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
                "denied" => PairError::Denied,
                "claimed" => PairError::Claimed,
                "not-allowed-in-time" => PairError::NotAllowedInTime,
                "update-required" => PairError::UpdateRequired,
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
            PairError::Denied,
            PairError::Claimed,
            PairError::NotAllowedInTime,
            PairError::UpdateRequired,
        ];
        let texts: std::collections::BTreeSet<String> =
            all.iter().map(ToString::to_string).collect();
        assert_eq!(texts.len(), all.len(), "two cases share words");
    }

    /// Each step in the table's words, with "this device" where the app names
    /// it, sent to the app by the name the table files them under: the wait
    /// with its device code.
    #[test]
    fn names_each_step() {
        let stages = &pairing_table()["stages"];
        let waiting = PairStage::Waiting {
            device_code: "3F9 AC2".into(),
        };
        let steps = [
            PairStage::Relay,
            PairStage::Host,
            PairStage::Pairing,
            waiting.clone(),
        ];
        for step in &steps {
            let sent = serde_json::to_value(step).unwrap();
            let name = match &sent {
                Value::String(name) => name.clone(),
                Value::Object(fields) => fields.keys().next().expect("a step's name").clone(),
                other => panic!("{other}"),
            };
            let words = stages[&name].as_str().expect("the table's words");
            assert_eq!(step.text(), words.replace("{device}", "device"), "{name}");
        }
        assert_eq!(stages.as_object().map(|s| s.len()), Some(steps.len()));
        assert_eq!(
            serde_json::to_value(&waiting).unwrap(),
            json!({"waiting": {"deviceCode": "3F9 AC2"}})
        );
        assert_eq!(
            steps.each_ref().map(PairStage::text),
            [
                "Reaching the relay…",
                "Finding your host…",
                "Pairing…",
                "Waiting for your host to allow this device…"
            ]
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
            r#"{"ok":false,"error":"pending"}"#,
        ] {
            assert!(
                matches!(read_answer(answer.as_bytes()), Err(PairError::Unreadable)),
                "{answer:?}"
            );
        }
    }

    /// Only a busy host and a connection that failed or took too long are
    /// asked again while the phone waits for an Allow.
    #[test]
    fn asks_again_only_after_what_may_pass() {
        for err in [
            PairError::Busy,
            PairError::HostFailed,
            PairError::Request("reset".into()),
            PairError::TimedOut,
        ] {
            assert!(err.passes(), "{err:?}");
        }
        for err in [
            PairError::Denied,
            PairError::Claimed,
            PairError::UpdateRequired,
            PairError::NotSupported,
            PairError::Unreadable,
            PairError::Refused(Refusal::Expired),
            PairError::Refused(Refusal::NotFound),
        ] {
            assert!(!err.passes(), "{err:?}");
        }
    }

    /// What the host does with one pairing connection.
    enum Reply {
        /// Answers the request with this.
        Answer(Vec<u8>),
        /// Holds the request this long, as kleio-host does while it waits
        /// for an admin's Allow, then answers with this.
        Held(Duration, Vec<u8>),
        /// Closes the connection as busy, as kleio-link-host does when another
        /// pairing is in flight.
        Busy,
    }

    fn pending_body(retry_after_ms: u64) -> Vec<u8> {
        let answer = json!({"ok": false, "error": "pending", "retryAfterMs": retry_after_ms, "expiresAt": 1_700_000_300_000_u64});
        answer.to_string().into_bytes()
    }

    fn pending_answer(retry_after_ms: u64) -> Reply {
        Reply::Answer(pending_body(retry_after_ms))
    }

    const PAIRED: &[u8] = br#"{"ok":true,"payload":{"host":"mini","token":"t0k3n"}}"#;

    /// A host that deals with one pairing connection after another as
    /// `replies` say, then hands back each request it was sent.
    async fn pair_host(endpoint: Endpoint, replies: Vec<Reply>) -> Vec<Value> {
        let mut requests = Vec::new();
        for reply in replies {
            let incoming = endpoint.accept().await.expect("a connection");
            let conn = incoming.await.expect("a handshake");
            assert_eq!(conn.alpn(), ALPN_PAIR);
            let (held, answer) = match reply {
                Reply::Answer(answer) => (Duration::ZERO, answer),
                Reply::Held(held, answer) => (held, answer),
                Reply::Busy => {
                    conn.close(VarInt::from_u32(close::PAIR_BUSY), b"busy");
                    continue;
                }
            };
            let (mut send, mut recv) = conn.accept_bi().await.expect("a stream");
            let request = recv
                .read_to_end(MAX_PAIR_REQUEST_BYTES)
                .await
                .expect("a request within 2 KiB");
            tokio::time::sleep(held).await;
            send.write_all(&answer).await.expect("answers");
            send.finish().expect("finishes");
            // The phone closes the connection once it has the answer.
            conn.closed().await;
            requests.push(serde_json::from_slice(&request).expect("the request is JSON"));
        }
        requests
    }

    /// The steps `redeem` told, and a way to tell them.
    fn told() -> (Arc<Mutex<Vec<PairStage>>>, impl Fn(PairStage)) {
        let stages = Arc::new(Mutex::new(Vec::new()));
        let tell = {
            let stages = Arc::clone(&stages);
            move |stage| stages.lock().expect("not poisoned").push(stage)
        };
        (stages, tell)
    }

    #[tokio::test]
    async fn pairs_over_one_stream() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let host_task = tokio::spawn(pair_host(host, vec![Reply::Answer(PAIRED.to_vec())]));
            let (stages, tell) = told();

            let payload = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, tell).await;
            assert_eq!(payload, Ok(json!({"host": "mini", "token": "t0k3n"})));
            let sent = host_task.await.expect("the host finished");
            assert_eq!(sent.len(), 1);
            assert_eq!(sent[0]["code"], "ABCDEF");
            assert_eq!(sent[0]["label"], "Test iPhone");
            assert_eq!(sent[0]["redemptionNonce"].as_str().map(str::len), Some(32));
            assert_eq!(sent[0]["waits"], true);
            // Allowed at once: no wait to show.
            assert!(stages.lock().expect("not poisoned").is_empty());
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
            let host_task = tokio::spawn(pair_host(host, vec![Reply::Answer(answer)]));

            let outcome = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, |_| {}).await;
            assert_eq!(outcome, Err(PairError::Unreadable));
            host_task.await.expect("the host finished");
        })
        .await;
    }

    #[tokio::test]
    async fn waits_for_an_allow_asking_again_with_the_same_request() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let replies = vec![
                pending_answer(50),
                pending_answer(50),
                Reply::Answer(PAIRED.to_vec()),
            ];
            let host_task = tokio::spawn(pair_host(host, replies));
            let (stages, tell) = told();

            let payload = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, tell).await;
            assert_eq!(payload, Ok(json!({"host": "mini", "token": "t0k3n"})));
            let sent = host_task.await.expect("the host finished");
            assert_eq!(sent.len(), 3);
            // The same nonce each time: kleio-host knows the device by it.
            assert!(sent.iter().all(|request| *request == sent[0]), "{sent:?}");
            // The wait shows once, with this device's code.
            assert_eq!(
                *stages.lock().expect("not poisoned"),
                [PairStage::Waiting {
                    device_code: device_code(&phone.id())
                }]
            );
        })
        .await;
    }

    /// An admin's prompt shows the device code at once: the phone shows it
    /// too while kleio-host holds its request, and an Allow within the hold
    /// pairs.
    #[tokio::test]
    async fn shows_the_wait_while_the_host_holds_the_request() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let held = SHOW_WAIT_AFTER + Duration::from_millis(500);
            let replies = vec![Reply::Held(held, PAIRED.to_vec())];
            let host_task = tokio::spawn(pair_host(host, replies));
            let (stages, tell) = told();

            let payload = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, tell).await;
            assert_eq!(payload, Ok(json!({"host": "mini", "token": "t0k3n"})));
            assert_eq!(host_task.await.expect("the host finished").len(), 1);
            assert_eq!(
                *stages.lock().expect("not poisoned"),
                [PairStage::Waiting {
                    device_code: device_code(&phone.id())
                }]
            );
        })
        .await;
    }

    #[tokio::test]
    async fn shows_the_wait_once_though_a_held_request_then_waits() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let held = SHOW_WAIT_AFTER + Duration::from_millis(500);
            let replies = vec![
                Reply::Held(held, pending_body(50)),
                Reply::Answer(PAIRED.to_vec()),
            ];
            let host_task = tokio::spawn(pair_host(host, replies));
            let (stages, tell) = told();

            let payload = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, tell).await;
            assert_eq!(payload, Ok(json!({"host": "mini", "token": "t0k3n"})));
            assert_eq!(host_task.await.expect("the host finished").len(), 2);
            assert_eq!(
                *stages.lock().expect("not poisoned"),
                [PairStage::Waiting {
                    device_code: device_code(&phone.id())
                }]
            );
        })
        .await;
    }

    #[tokio::test]
    async fn a_deny_while_waiting_ends_it() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let denied = br#"{"ok":false,"error":"denied"}"#.to_vec();
            let replies = vec![pending_answer(50), Reply::Answer(denied)];
            let host_task = tokio::spawn(pair_host(host, replies));

            let outcome = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, |_| {}).await;
            assert_eq!(outcome, Err(PairError::Denied));
            assert_eq!(host_task.await.expect("the host finished").len(), 2);
        })
        .await;
    }

    #[tokio::test]
    async fn a_refusal_at_first_ends_it_with_no_wait() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let claimed = br#"{"ok":false,"error":"claimed"}"#.to_vec();
            let host_task = tokio::spawn(pair_host(host, vec![Reply::Answer(claimed)]));
            let (stages, tell) = told();

            let outcome = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, tell).await;
            assert_eq!(outcome, Err(PairError::Claimed));
            host_task.await.expect("the host finished");
            assert!(stages.lock().expect("not poisoned").is_empty());
        })
        .await;
    }

    #[tokio::test]
    async fn a_busy_host_while_waiting_is_asked_again() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let replies = vec![
                pending_answer(50),
                Reply::Busy,
                Reply::Answer(PAIRED.to_vec()),
            ];
            let host_task = tokio::spawn(pair_host(host, replies));

            let payload = redeem(&phone, addr, "ABC-DEF", "Test iPhone", ALLOW_WAIT, |_| {}).await;
            assert_eq!(payload, Ok(json!({"host": "mini", "token": "t0k3n"})));
            // The busy connection had no request to hand back.
            assert_eq!(host_task.await.expect("the host finished").len(), 2);
        })
        .await;
    }

    #[tokio::test]
    async fn asks_no_more_once_the_wait_is_up() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_PAIR]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let addr = loopback_addr(&host);
            let replies = (0..10).map(|_| pending_answer(50)).collect();
            let host_task = tokio::spawn(pair_host(host, replies));

            let limit = Duration::from_millis(600);
            let started = Instant::now();
            let outcome = redeem(&phone, addr, "ABC-DEF", "Test iPhone", limit, |_| {}).await;
            assert_eq!(outcome, Err(PairError::NotAllowedInTime));
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "{:?}",
                started.elapsed()
            );
            host_task.abort();
        })
        .await;
    }
}
