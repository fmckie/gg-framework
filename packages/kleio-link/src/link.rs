//! The phone's one connection to the host on [`ALPN_HTTP`], shared by every
//! request and dialled again on the first use after it closes.
//!
//! iOS suspends the app in the background, so the connection is often dead
//! when the app comes back. Redialling on use, not the moment it drops, means
//! a suspended or offline phone dials nothing, and the first request after a
//! resume brings the link back. A dial gets [`DIAL_TIMEOUT`]. Requests that
//! arrive while one is in flight wait for it and share its outcome, so a burst
//! of requests during an outage costs one dial, not one each.
//!
//! Once the host has turned this device's key away ([`LinkError::NotPaired`]
//! or [`LinkError::Revoked`]), the link holds that answer and never dials
//! again: every request fails with it at once. The key can't be let back in,
//! so only a new pairing, with a new key and a new link, reaches the host.
//! Without this, a revoked phone dialled 185 times in 124 s, one dial for each
//! request the app retried.
//!
//! The host refuses such a key's dial before its handshake, so that the key
//! learns none of the host's addresses, and that says nothing of why. So the
//! link then asks the host's pairing endpoint where the key stands
//! ([`ALPN_STANDING`]), through the route's relays, if the route has its key
//! ([`Route::pair_key`]). Without the key, or an answer, the dial fails as
//! one that found no host does
//! (docs/adr/0005-link-connections-start-through-the-relay.md).
//!
//! There's no address lookup, and a relay drops what it gets for a key that
//! isn't connected to it, so the phone finds the host only through the
//! relays the host names, and the host may have moved relay (it does after
//! 15 s without its own: host/relays.rs). While the host is on a relay, it
//! answers a new connection only through one, which names this device's key,
//! and a direct dial not at all. So a dial ([`Route::stages`]) goes in two
//! stages:
//!
//! 1. For up to [`FIRST_STAGE`]: the relay the host was last reached through,
//!    and its last direct addresses only while this device is on no relay
//!    (the host may be on none either), or if the route has no relay.
//! 2. Then, alongside the first, until [`DIAL_TIMEOUT`]: every relay in the
//!    host's list, and the direct addresses, as well.
//!
//! A connection that starts through a relay goes direct once it can. The
//! relay that worked becomes the route's, and the endpoint's home relay
//! ([`switch_relay`]): the phone keeps one relay connection, and it's the
//! host's. So the endpoint should start with the route's relay as its only
//! one, as `bind_client(key, &[relay], options)` binds it.
//!
//! For a status screen, a link says which path the open connection takes
//! ([`Link::path`]), whether the host turned this device away
//! ([`Link::refusal`]), can keep each connection's path events
//! ([`Link::with_path_events`]), and times a resume: from
//! [`Link::begin_resume`] to the first byte back from the host in reply to a
//! request sent after it.
//!
//! It also says whether a dial is under way ([`Link::dialling`]), when bytes
//! last came from the host ([`Link::last_heard`]), whether this device's
//! relay says it's rate-limiting it ([`Link::rate_limited`]), and, after a
//! dial that found no host, why ([`Link::unreached`]): a relay answered and
//! the host didn't, no relay answered, or the relay turned this version of
//! its protocol away. A connected home relay answers that at once. Otherwise
//! the app's link ([`Link::watched`]) asks every relay on the route
//! `GET /ping`, in the background, so the requests that waited on the dial
//! fail without waiting for that. Each new connection moves
//! [`Link::watch_connections`] on, so the app can ask the host for its relay
//! list again.

use std::collections::BTreeMap;
use std::fmt;
use std::future::Future;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use iroh::endpoint::{
    ConnectError, ConnectingError, Connection, ConnectionError, TransportErrorCode, VarInt,
};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayUrl, TransportAddr, Watcher};
use tokio::sync::watch;
use tokio::time::Instant;
use tracing::{info, warn};

use crate::endpoint::{switch_relay, RateLimitWatch};
use crate::paths::{PathEvents, SelectedPath};
use crate::probe::{ping_all, HttpsProbe, Ping};
use crate::relays::{every_relay, RelayEntry};
use crate::ticket::Ticket;
use crate::{close, error_chain, paths, ALPN_HTTP, ALPN_STANDING};

/// How long one dial may take before the requests waiting on it fail.
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a dial tries only its first stage ([`Route::stages`]) before it
/// tries the second too.
pub const FIRST_STAGE: Duration = Duration::from_secs(4);

/// How long a dial the host refused before its handshake may take to ask the
/// host's pairing endpoint where this device stands ([`ALPN_STANDING`]),
/// within the dial's [`DIAL_TIMEOUT`].
pub const STANDING_TIMEOUT: Duration = Duration::from_secs(4);

/// The most direct addresses a route keeps: as many as `GET /kleio/link`
/// gives (`MAX_INFO_ADDRS` in packages/kleio-host/src/link.ts).
pub const MAX_ROUTE_ADDRS: usize = 8;

/// Where the phone looks for its host: its key, the relay it was last
/// reached through, its last direct addresses, its relay list, and its
/// pairing endpoint's key, which says where this device stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    key: EndpointId,
    relay: Option<RelayUrl>,
    addrs: Vec<SocketAddr>,
    relays: Vec<RelayEntry>,
    pair: Option<EndpointId>,
}

impl Route {
    /// `addrs` best first; past [`MAX_ROUTE_ADDRS`], and repeats, are dropped.
    /// No pairing key: [`with_pair_key`](Self::with_pair_key) adds one.
    pub fn new(
        key: EndpointId,
        relay: Option<RelayUrl>,
        addrs: Vec<SocketAddr>,
        relays: Vec<RelayEntry>,
    ) -> Self {
        Self {
            key,
            relay,
            addrs: first_few(addrs),
            relays,
            pair: None,
        }
    }

    /// What a pairing ticket says: the relay the host was on, its addresses,
    /// its list, and a v5 ticket's pairing key.
    pub fn from_ticket(ticket: &Ticket) -> Self {
        Self::new(
            ticket.key(),
            Some(ticket.relay().clone()),
            ticket.addrs().to_vec(),
            ticket.relays().to_vec(),
        )
        .with_pair_key(ticket.pair_key())
    }

    /// The route with `pair` as the host's pairing endpoint's key. The link
    /// key is left out: a v4 ticket's one key is no pairing endpoint's.
    pub fn with_pair_key(mut self, pair: EndpointId) -> Self {
        self.take_pair_key(pair);
        self
    }

    pub fn key(&self) -> EndpointId {
        self.key
    }

    /// The host's pairing endpoint's key, if the route has it: a v5
    /// ticket's, or the one `GET /kleio/link` gave.
    pub fn pair_key(&self) -> Option<EndpointId> {
        self.pair
    }

    /// The relay the host was last reached through.
    pub fn relay(&self) -> Option<&RelayUrl> {
        self.relay.as_ref()
    }

    /// The host's last direct addresses, best first.
    pub fn addrs(&self) -> &[SocketAddr] {
        &self.addrs
    }

    /// The host's relay list.
    pub fn relays(&self) -> &[RelayEntry] {
        &self.relays
    }

    /// Every relay the route names: its relay, then each the list names, in
    /// order, n0's for its entry.
    pub fn every_relay(&self) -> Vec<RelayUrl> {
        let mut all: Vec<RelayUrl> = self.relay.iter().cloned().collect();
        for url in every_relay(&self.relays) {
            if !all.contains(&url) {
                all.push(url);
            }
        }
        all
    }

    /// A dial's two stages. The first: the relay the host was last reached
    /// through and, if `direct_first` or the route has no relay, the host's
    /// direct addresses. The second: every relay and the direct addresses,
    /// or `None` if that's no more than the first.
    ///
    /// While the host is on a relay it answers no direct dial
    /// (docs/adr/0005-link-connections-start-through-the-relay.md), so a
    /// phone with a relay connection starts through the relay, and its
    /// connection goes direct once it can. A phone on no relay may be
    /// dialling a host on none either, so the direct addresses go first.
    pub fn stages(&self, direct_first: bool) -> (EndpointAddr, Option<EndpointAddr>) {
        let direct = || self.addrs.iter().copied().map(TransportAddr::Ip);
        let first = match &self.relay {
            Some(relay) if !direct_first => {
                EndpointAddr::new(self.key).with_relay_url(relay.clone())
            }
            Some(relay) => {
                EndpointAddr::from_parts(self.key, direct()).with_relay_url(relay.clone())
            }
            None => EndpointAddr::from_parts(self.key, direct()),
        };
        let all = first
            .clone()
            .with_addrs(direct().chain(self.every_relay().into_iter().map(TransportAddr::Relay)));
        let second = (all != first).then_some(all);
        (first, second)
    }

    /// Where a dial the host refused before its handshake asks where this
    /// device stands: the pairing endpoint's key through every relay the
    /// route names, as it has no address. `None` without that key or a
    /// relay.
    pub fn pairing_addr(&self) -> Option<EndpointAddr> {
        let pair = self.pair?;
        let relays = self.every_relay();
        (!relays.is_empty())
            .then(|| EndpointAddr::from_parts(pair, relays.into_iter().map(TransportAddr::Relay)))
    }

    fn take_pair_key(&mut self, pair: EndpointId) {
        if pair != self.key {
            self.pair = Some(pair);
        }
    }
}

/// A route to exactly `addr`: its first relay, its IP addresses, and its
/// relays as the list. For tests and tools that dial a known address.
impl From<EndpointAddr> for Route {
    fn from(addr: EndpointAddr) -> Self {
        let relays: Vec<RelayUrl> = addr.relay_urls().cloned().collect();
        Self::new(
            addr.id,
            relays.first().cloned(),
            addr.ip_addrs().copied().collect(),
            relays.into_iter().map(RelayEntry::Url).collect(),
        )
    }
}

/// `addrs` without repeats, at most [`MAX_ROUTE_ADDRS`].
fn first_few(addrs: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let mut out: Vec<SocketAddr> = Vec::new();
    for addr in addrs {
        if out.len() < MAX_ROUTE_ADDRS && !out.contains(&addr) {
            out.push(addr);
        }
    }
    out
}

/// Why the link has no connection to offer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// iroh couldn't open the connection: its error and causes.
    Dial(String),
    /// No connection within [`DIAL_TIMEOUT`].
    TimedOut,
    /// The host turned this device's key away: it isn't on its allow-list
    /// ([`close::NOT_PAIRED`]). The host may have been set up again.
    NotPaired,
    /// The host turned this device's key away: the device was revoked
    /// ([`close::REVOKED`]).
    Revoked,
}

impl fmt::Display for LinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Dial(cause) => write!(f, "Can't reach the host: {cause}"),
            Self::TimedOut => write!(
                f,
                "Can't reach the host: no connection within {} s",
                DIAL_TIMEOUT.as_secs()
            ),
            Self::NotPaired => f.write_str(
                "Your host doesn't know this device. It may have been set up again: pair this device again.",
            ),
            Self::Revoked => {
                f.write_str("This device was removed from your host. Pair it again to use it.")
            }
        }
    }
}

impl std::error::Error for LinkError {}

/// Why the latest dial found no host, as far as the link could tell
/// ([`Link::unreached`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unreached {
    /// A relay answered, but the host didn't within [`DIAL_TIMEOUT`]: it's
    /// asleep or offline, or its link isn't running.
    HostSilent,
    /// No relay on the route answered as a relay: looking it up, connecting
    /// or TLS failed, or nothing came back in time. With no direct path
    /// either, this network may be blocking them. Each relay tried, in the
    /// order the route names them.
    NoRelay { tried: Vec<RelayUrl> },
    /// The relay answers `GET /ping`, but turned down this device's relay
    /// connection, as a relay does a version of its protocol it no longer
    /// takes.
    RelayRefused { relay: RelayUrl },
}

impl fmt::Display for Unreached {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HostSilent => f.write_str("a relay answered, but the host didn't"),
            Self::NoRelay { tried } => {
                f.write_str("no relay answered:")?;
                for relay in tried {
                    write!(f, " {relay}")?;
                }
                Ok(())
            }
            Self::RelayRefused { relay } => {
                write!(f, "{relay} turned down this version's relay connection")
            }
        }
    }
}

/// What the link is doing, for the Link card.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkStatus {
    /// A connection is open now.
    pub connected: bool,
    /// How long the open connection has been up.
    pub connected_for: Option<Duration>,
    /// Dials since the first connection, whether or not they connected.
    pub redials: u64,
}

/// The cached connection to one host. Cheap to clone; clones share it.
#[derive(Clone)]
pub struct Link {
    inner: Arc<Inner>,
}

struct Inner {
    endpoint: Endpoint,
    route: Mutex<Route>,
    kept: Option<PathEvents>,
    /// Asks the route's relays why a dial found no host. Without it, only a
    /// connected home relay says.
    probe: Option<HttpsProbe>,
    cache: Cache<Connection>,
    resume: Resume,
    heard: Heard,
    /// Why the latest dial found no host. Kept until a dial connects, so it
    /// doesn't come and go with each retry.
    unreached: Mutex<Option<Unreached>>,
    rate: Mutex<RateLimitWatch>,
    /// Connections made so far: [`Link::watch_connections`].
    made: watch::Sender<u64>,
}

impl Inner {
    fn route(&self) -> MutexGuard<'_, Route> {
        // Every update is a plain assignment, so the route is whole even if a
        // holder panicked.
        self.route.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn unreached(&self) -> MutexGuard<'_, Option<Unreached>> {
        // One assignment at a time, so it's whole even if a holder panicked.
        self.unreached
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

impl Link {
    /// A link to the host `route` leads to. Nothing is dialled until the
    /// first [`connection`](Self::connection).
    pub fn new(endpoint: Endpoint, route: Route) -> Self {
        Self::build(endpoint, route, None, None)
    }

    /// [`new`](Self::new), keeping each connection's path events in `events`
    /// as well as logging them.
    pub fn with_path_events(endpoint: Endpoint, route: Route, events: PathEvents) -> Self {
        Self::build(endpoint, route, Some(events), None)
    }

    /// The app's link: [`with_path_events`](Self::with_path_events), and
    /// when a dial finds no host and the home relay isn't connected, it asks
    /// the route's relays with `probe` why ([`unreached`](Self::unreached)).
    pub fn watched(
        endpoint: Endpoint,
        route: Route,
        events: PathEvents,
        probe: HttpsProbe,
    ) -> Self {
        Self::build(endpoint, route, Some(events), Some(probe))
    }

    fn build(
        endpoint: Endpoint,
        route: Route,
        kept: Option<PathEvents>,
        probe: Option<HttpsProbe>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                endpoint,
                route: Mutex::new(route),
                kept,
                probe,
                cache: Cache::new(),
                resume: Resume::default(),
                heard: Heard::new(),
                unreached: Mutex::new(None),
                rate: Mutex::default(),
                made: watch::Sender::new(0),
            }),
        }
    }

    /// The endpoint the link dials from.
    pub fn endpoint(&self) -> &Endpoint {
        &self.inner.endpoint
    }

    /// The route the next dial takes: the one the link was given, with the
    /// relay the host was last reached through.
    pub fn route(&self) -> Route {
        self.inner.route().clone()
    }

    /// Takes the host's relay list, direct addresses and pairing endpoint's
    /// key, as `GET /kleio/link` gives them, for the next dial. Given no
    /// pairing key, as a host from before ADR 0005 gives none, or the link
    /// key, the route keeps the one it has.
    pub fn refresh(
        &self,
        relays: Vec<RelayEntry>,
        addrs: Vec<SocketAddr>,
        pair: Option<EndpointId>,
    ) {
        let mut route = self.inner.route();
        route.relays = relays;
        route.addrs = first_few(addrs);
        if let Some(pair) = pair {
            route.take_pair_key(pair);
        }
    }

    /// The open connection, dialling first if there is none or it has closed.
    /// Each new connection gets the path log.
    pub async fn connection(&self) -> Result<Connection, LinkError> {
        let inner = &*self.inner;
        inner
            .cache
            .get_then(|| dial(inner), |failure| self.found_no_host(failure))
            .await
    }

    /// Whether the host has turned this device away:
    /// [`LinkError::NotPaired`] or [`LinkError::Revoked`]. Through a relay,
    /// its link endpoint refuses such a dial before the handshake, and its
    /// pairing endpoint says why. Otherwise it takes the handshake and
    /// closes the connection with the reason, as it closes one open when
    /// the device is revoked. Once it has, the link never dials again (see
    /// the module docs). Never dials.
    pub fn refusal(&self) -> Option<LinkError> {
        self.inner.cache.refusal()
    }

    /// What the link is doing now. Never dials.
    pub fn status(&self) -> LinkStatus {
        self.inner.cache.status()
    }

    /// Whether a dial is under way. Never dials.
    pub fn dialling(&self) -> bool {
        self.inner.cache.dialling()
    }

    /// How long ago bytes last came from the host, or a connection to it
    /// opened. `None` before either. Never dials.
    pub fn last_heard(&self) -> Option<Duration> {
        self.inner.heard.ago()
    }

    /// Why the latest dial found no host, once the link has looked. `None`
    /// while a connection is open, before a dial has failed, while it's still
    /// looking after the first failure, and once the host has turned this
    /// device away ([`refusal`](Self::refusal) says so). Never dials.
    pub fn unreached(&self) -> Option<Unreached> {
        if self.status().connected || self.refusal().is_some() {
            return None;
        }
        self.inner.unreached().clone()
    }

    /// Whether this device's relay has said it's rate-limiting this device,
    /// on the relay connection open now. Never dials.
    pub fn rate_limited(&self) -> bool {
        self.inner
            .rate
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .sample_endpoint(&self.inner.endpoint)
    }

    /// How many connections the link has made, moving on each time one
    /// opens: the app asks the host for its relay list then.
    pub fn watch_connections(&self) -> watch::Receiver<u64> {
        self.inner.made.subscribe()
    }

    /// The path the open connection's bytes take now. Never dials.
    pub fn path(&self) -> Option<SelectedPath> {
        self.inner
            .cache
            .current()
            .as_ref()
            .and_then(paths::selected)
    }

    /// Closes the open connection, if there is one, so the next use dials
    /// again. It's for a connection the host may have dropped while this end
    /// couldn't tell, such as one held while the app was suspended for longer
    /// than the host's idle timeout. Streams on it fail at once. Never dials.
    /// Whether there was one to close.
    pub fn close_connection(&self) -> bool {
        let Some(conn) = self.inner.cache.current() else {
            return false;
        };
        conn.close(VarInt::from_u32(0), b"closed on resume");
        true
    }

    /// The app is back on screen: [`last_resume`](Self::last_resume) then
    /// times from now to the first byte back from the host in reply to a
    /// request sent from now on. Bytes the host owed before, such as a reply
    /// that came in while the app was suspended, don't count.
    pub fn begin_resume(&self) {
        self.inner.resume.begin();
    }

    /// How long the latest resume took, from
    /// [`begin_resume`](Self::begin_resume) to the first byte back from the
    /// host in reply to a request sent after it. `None` until one has
    /// finished.
    pub fn last_resume(&self) -> Option<Duration> {
        self.inner.resume.last()
    }

    /// The latest resume's number, 0 before the first. A stream notes it each
    /// time the app sends bytes on it.
    pub(crate) fn resume_number(&self) -> u64 {
        self.inner.resume.number()
    }

    /// Bytes came back from the host on a stream the app last sent on during
    /// resume `sent_in`. They end the resume under way only if it's that one:
    /// a reply to a request sent before it began ends nothing.
    pub(crate) fn bytes_from_host(&self, sent_in: u64) {
        self.inner.heard.note();
        self.inner.resume.end(sent_in);
    }

    /// After a dial that found no host, other than by turning this device
    /// away: why, for [`unreached`](Self::unreached). A connected home relay
    /// means a relay answered and the host didn't. Otherwise, with a probe,
    /// it asks every relay on the route `GET /ping` in the background, and
    /// the answer before stands until theirs is in.
    fn found_no_host(&self, failure: &LinkError) {
        if matches!(failure, LinkError::NotPaired | LinkError::Revoked) {
            return;
        }
        if relay_connected(&self.inner.endpoint) {
            *self.inner.unreached() = Some(Unreached::HostSilent);
            return;
        }
        let Some(probe) = self.inner.probe.clone() else {
            return;
        };
        let home = self.inner.endpoint.home_relay_status().get();
        let turned_down = home.iter().find_map(|status| {
            let error = error_chain(status.last_error()?);
            turned_down_by_relay(&error).then(|| status.url().clone())
        });
        let link = self.clone();
        tokio::spawn(async move {
            let relays = link.route().every_relay();
            let pings = ping_all(&probe, relays.clone()).await;
            let why = unreached_by(relays, &pings, turned_down);
            // A dial may have connected while the relays answered.
            if !link.status().connected {
                warn!("the host wasn't reached: {why}");
                *link.inner.unreached() = Some(why);
            }
        });
    }
}

/// Why a dial found no host, from what the route's relays answered to
/// `GET /ping` and the home relay that turned this device's connection
/// down as a protocol version it doesn't take, if one did.
fn unreached_by(
    relays: Vec<RelayUrl>,
    pings: &BTreeMap<RelayUrl, Ping>,
    turned_down: Option<RelayUrl>,
) -> Unreached {
    let answered = |relay: &RelayUrl| matches!(pings.get(relay), Some(Ping::Relay(_)));
    if let Some(relay) = turned_down.filter(|relay| answered(relay)) {
        return Unreached::RelayRefused { relay };
    }
    if relays.iter().any(answered) {
        return Unreached::HostSilent;
    }
    Unreached::NoRelay { tried: relays }
}

/// Whether a relay connection's error is the relay turning down this
/// version of the relay protocol: iroh-relay answers an upgrade with a
/// version it doesn't take with 400, and one that has to change protocol
/// would say 426 or name a version this end doesn't know. Read from the
/// error's words, which is all iroh shows of it (`RelayStatus::last_error`);
/// a test pins them.
fn turned_down_by_relay(error: &str) -> bool {
    const UPGRADE: &str = "Unexpected status during upgrade: ";
    error
        .split(UPGRADE)
        .skip(1)
        .any(|rest| rest.starts_with("400") || rest.starts_with("426"))
        || error.contains("invalid iroh-relay version header")
}

/// When bytes last came from the host: every read from it notes the time,
/// so it's one atomic store, with no lock.
struct Heard {
    since: Instant,
    /// Milliseconds after `since`, plus one; 0 for never.
    at: AtomicU64,
}

impl Heard {
    fn new() -> Self {
        Self {
            since: Instant::now(),
            at: AtomicU64::new(0),
        }
    }

    fn note(&self) {
        let ms = u64::try_from(self.since.elapsed().as_millis()).unwrap_or(u64::MAX - 1);
        self.at.store(ms.saturating_add(1), Ordering::Release);
    }

    fn ago(&self) -> Option<Duration> {
        let at = self.at.load(Ordering::Acquire).checked_sub(1)?;
        Some(
            self.since
                .elapsed()
                .saturating_sub(Duration::from_millis(at)),
        )
    }
}

/// Whether `endpoint` has a relay connection now.
fn relay_connected(endpoint: &Endpoint) -> bool {
    endpoint
        .home_relay_status()
        .get()
        .iter()
        .any(|status| status.is_connected())
}

/// One dial, in two stages, along the route as it is now: through the relay
/// first while this device has a relay connection. The relay that worked
/// becomes the route's and the endpoint's.
async fn dial(inner: &Inner) -> Result<Connection, LinkError> {
    let route = inner.route().clone();
    let endpoint = &inner.endpoint;
    let (first, second) = route.stages(!relay_connected(endpoint));
    let pairing = route.pairing_addr();
    let first = connect(endpoint, first, pairing.clone());
    let second = second.map(|addr| connect_later(endpoint, addr, pairing));
    let conn = in_two_stages(first, second).await?;
    inner.heard.note();
    *inner.unreached() = None;
    inner.made.send_modify(|made| *made += 1);
    if let Some(relay) = paths::relay_used(&conn) {
        if route.relay() != Some(&relay) {
            info!("the host is on {relay} now");
            inner.route().relay = Some(relay.clone());
            switch_relay(endpoint, &relay, route.relay()).await;
        }
    }
    match inner.kept.clone() {
        Some(events) => paths::spawn_log_keeping(&conn, events),
        None => paths::spawn_log(&conn),
    };
    Ok(conn)
}

/// Dials `host` on [`ALPN_HTTP`]. If the host refuses the dial before its
/// handshake, which says nothing of why, it asks the host's pairing endpoint
/// at `pairing` where this device stands.
async fn connect(
    endpoint: &Endpoint,
    host: EndpointAddr,
    pairing: Option<EndpointAddr>,
) -> Result<Connection, LinkError> {
    let err = match endpoint.connect(host, ALPN_HTTP).await {
        Ok(conn) => return Ok(conn),
        Err(err) => err,
    };
    if let Some(refused) = refused_while_dialling(&err) {
        return Err(refused);
    }
    let failed = LinkError::Dial(error_chain(&err));
    match pairing {
        Some(pairing) if refused_outright(&err) => {
            Err(standing(endpoint, pairing).await.unwrap_or(failed))
        }
        _ => Err(failed),
    }
}

/// Why the connection closed while the dial was under way, if it did.
fn closed_while_dialling(err: &ConnectError) -> Option<&ConnectionError> {
    match err {
        ConnectError::Connection { source, .. }
        | ConnectError::Connecting {
            source: ConnectingError::ConnectionError { source, .. },
            ..
        } => Some(source),
        _ => None,
    }
}

/// The host's refusal, if it closed the connection with one before the dial
/// finished. It closes just after the handshake, which is usually after this
/// end's dial has finished too, but not always.
fn refused_while_dialling(err: &ConnectError) -> Option<LinkError> {
    refused_with(closed_while_dialling(err)?)
}

/// Whether the host refused the dial before its handshake: QUIC's
/// `CONNECTION_REFUSED`, with no close code of the host's.
fn refused_outright(err: &ConnectError) -> bool {
    matches!(
        closed_while_dialling(err),
        Some(ConnectionError::ConnectionClosed(close))
            if close.error_code == TransportErrorCode::CONNECTION_REFUSED
    )
}

/// Asks the host's pairing endpoint at `pairing` where this device stands,
/// for up to [`STANDING_TIMEOUT`]: the refusal its close means, if it's one.
/// [`close::PAIRED`], no answer, or a host too old to take [`ALPN_STANDING`]
/// is none.
async fn standing(endpoint: &Endpoint, pairing: EndpointAddr) -> Option<LinkError> {
    info!("the host refused the dial before its handshake: asking its pairing endpoint why");
    let asked = async {
        match endpoint.connect(pairing, ALPN_STANDING).await {
            // It answers by closing, right after the handshake.
            Ok(conn) => refused_with(&conn.closed().await),
            Err(err) => refused_while_dialling(&err),
        }
    };
    match tokio::time::timeout(STANDING_TIMEOUT, asked).await {
        Ok(Some(told)) => Some(told),
        Ok(None) => {
            info!("the host's pairing endpoint didn't turn this device away");
            None
        }
        Err(_) => {
            info!(
                "the host's pairing endpoint didn't answer within {} s",
                STANDING_TIMEOUT.as_secs()
            );
            None
        }
    }
}

/// [`connect`] for the second stage, which says so first.
async fn connect_later(
    endpoint: &Endpoint,
    host: EndpointAddr,
    pairing: Option<EndpointAddr>,
) -> Result<Connection, LinkError> {
    let relays = host.relay_urls().count();
    let ips = host.ip_addrs().count();
    info!("not found yet: trying all {relays} of the host's relays and its {ips} direct addresses");
    connect(endpoint, host, pairing).await
}

/// `first` alone for up to [`FIRST_STAGE`], or until it fails; then `second`,
/// if there is one, alongside it, until one connects. Each keeps going if the
/// other fails, unless the host turned this device away: that ends the dial
/// at once, as the other would be turned away too. The caller stops the
/// whole at [`DIAL_TIMEOUT`].
async fn in_two_stages<C, F1, F2>(first: F1, second: Option<F2>) -> Result<C, LinkError>
where
    F1: Future<Output = Result<C, LinkError>>,
    F2: Future<Output = Result<C, LinkError>>,
{
    let turned_away = |err: &LinkError| matches!(err, LinkError::NotPaired | LinkError::Revoked);
    tokio::pin!(first);
    let first_failed = match tokio::time::timeout(FIRST_STAGE, &mut first).await {
        Ok(Ok(conn)) => return Ok(conn),
        Ok(Err(err)) if turned_away(&err) => return Err(err),
        Ok(Err(err)) => Some(err),
        Err(_) => None,
    };
    let Some(second) = second else {
        return match first_failed {
            Some(err) => Err(err),
            None => first.await,
        };
    };
    if first_failed.is_some() {
        return second.await;
    }
    tokio::pin!(second);
    tokio::select! {
        outcome = &mut first => match outcome {
            Err(err) if !turned_away(&err) => second.await,
            outcome => outcome,
        },
        outcome = &mut second => match outcome {
            Err(err) if !turned_away(&err) => first.await,
            outcome => outcome,
        },
    }
}

/// The refusal a connection closed for `reason` means, if it's one.
fn refused_with(reason: &ConnectionError) -> Option<LinkError> {
    let ConnectionError::ApplicationClosed(closed) = reason else {
        return None;
    };
    told_by(closed.error_code.into_inner())
}

/// The refusal a close code of the host's means, if it's one.
/// [`close::PAIRED`], the pairing endpoint's answer for a key it lets in,
/// is none.
fn told_by(code: u64) -> Option<LinkError> {
    if code == u64::from(close::NOT_PAIRED) {
        Some(LinkError::NotPaired)
    } else if code == u64::from(close::REVOKED) {
        Some(LinkError::Revoked)
    } else {
        None
    }
}

/// A resume's timing, from [`Link::begin_resume`] to the first byte back in
/// reply to a request sent after it.
///
/// Each resume has a number, one more than the one before. A stream notes the
/// number each time the app sends bytes on it, and passes its note with each
/// read from the host. Only a stream that sent during the resume under way can
/// end it, so a reply to an earlier request ends nothing, even when it's read
/// only now. An HTTP client sends on a connection only once it has read the
/// reply before, so what such a stream reads is the reply to that request.
#[derive(Default)]
struct Resume {
    /// The latest resume's number, 0 before the first. Every write to the
    /// host reads it.
    number: AtomicU64,
    /// Whether that resume is waiting for its first byte. Every read from the
    /// host checks it, so it's an atomic, and the lock is taken only to begin
    /// or end one. Both change it, and `begin` changes the number, while
    /// holding the lock.
    waiting: AtomicBool,
    times: Mutex<ResumeTimes>,
}

#[derive(Default)]
struct ResumeTimes {
    began: Option<Instant>,
    last: Option<Duration>,
}

impl Resume {
    fn begin(&self) {
        let mut times = self.times();
        times.began = Some(Instant::now());
        self.number.fetch_add(1, Ordering::AcqRel);
        self.waiting.store(true, Ordering::Release);
    }

    fn number(&self) -> u64 {
        self.number.load(Ordering::Acquire)
    }

    /// Bytes back from the host, on a stream that last sent during resume
    /// `sent_in`.
    fn end(&self, sent_in: u64) {
        // Most reads come with no resume waiting, or on a stream that last
        // sent before it began, and take no lock.
        if !self.waiting.load(Ordering::Acquire) || sent_in != self.number() {
            return;
        }
        let mut times = self.times();
        // Again with the lock, which `begin` holds: one may have begun since.
        if sent_in != self.number() {
            return;
        }
        if let Some(began) = times.began.take() {
            times.last = Some(began.elapsed());
        }
        self.waiting.store(false, Ordering::Release);
    }

    fn last(&self) -> Option<Duration> {
        self.times().last
    }

    fn times(&self) -> MutexGuard<'_, ResumeTimes> {
        // Every update is a plain assignment, so the times are whole even if
        // a holder panicked.
        self.times.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// What [`Cache`] needs to know about a connection.
pub(crate) trait Closable: Clone {
    fn is_closed(&self) -> bool;
    /// How the host turned this device away, if it closed the connection
    /// for that.
    fn refusal(&self) -> Option<LinkError>;
}

impl Closable for Connection {
    fn is_closed(&self) -> bool {
        self.close_reason().is_some()
    }

    fn refusal(&self) -> Option<LinkError> {
        refused_with(&self.close_reason()?)
    }
}

/// One shared connection, dialled again on the first use after it closes, as
/// the module docs describe. Generic so that the tests can use a fake
/// connection and need no network.
pub(crate) struct Cache<C> {
    /// Held for the whole of a dial, so there is one dial at a time.
    dialling: tokio::sync::Mutex<()>,
    state: Mutex<State<C>>,
}

struct State<C> {
    conn: Option<C>,
    connected_at: Option<Instant>,
    ever_connected: bool,
    /// Dials that have finished, either way.
    dials_done: u64,
    redials: u64,
    /// The latest dial's error, until a dial connects.
    last_failure: Option<LinkError>,
    /// The host's refusal, once it has turned this device away: kept for the
    /// cache's life, so nothing dials again.
    refused: Option<LinkError>,
}

impl<C: Closable> State<C> {
    fn open(&self) -> Option<C> {
        self.conn.as_ref().filter(|conn| !conn.is_closed()).cloned()
    }

    /// The host's refusal, if it has turned this device away, on a dial or
    /// by closing the latest connection. Held from the first time it's seen.
    fn refusal(&mut self) -> Option<LinkError> {
        if self.refused.is_none() {
            let closed = self.conn.as_ref().filter(|conn| conn.is_closed());
            if let Some(refused) = closed.and_then(Closable::refusal) {
                self.hold(refused);
            }
        }
        self.refused.clone()
    }

    fn hold(&mut self, refused: LinkError) {
        warn!("the host turned this device away, so the link won't dial it again: {refused}");
        self.refused = Some(refused);
    }
}

impl<C: Closable> Cache<C> {
    pub(crate) fn new() -> Self {
        Self {
            dialling: tokio::sync::Mutex::new(()),
            state: Mutex::new(State {
                conn: None,
                connected_at: None,
                ever_connected: false,
                dials_done: 0,
                redials: 0,
                last_failure: None,
                refused: None,
            }),
        }
    }

    /// The open connection, or else the outcome of `dial`. Once the host
    /// has turned this device away, its refusal, with no dial.
    #[cfg(test)]
    pub(crate) async fn get<F, Fut>(&self, dial: F) -> Result<C, LinkError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<C, LinkError>>,
    {
        self.get_then(dial, |_| {}).await
    }

    /// [`get`](Self::get), calling `failed` with the error of a dial this
    /// request made that failed: once a dial, not for the requests that
    /// shared it.
    pub(crate) async fn get_then<F, Fut, G>(&self, dial: F, failed: G) -> Result<C, LinkError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<C, LinkError>>,
        G: FnOnce(&LinkError),
    {
        let dials_seen = {
            let mut state = self.state();
            if let Some(conn) = state.open() {
                return Ok(conn);
            }
            if let Some(refused) = state.refusal() {
                return Err(refused);
            }
            state.dials_done
        };
        let _dialling = self.dialling.lock().await;
        let redial = {
            let mut state = self.state();
            if let Some(conn) = state.open() {
                return Ok(conn);
            }
            if let Some(refused) = state.refusal() {
                return Err(refused);
            }
            // A dial finished while this request waited, and left no
            // connection: share its error rather than dial again at once.
            if state.dials_done != dials_seen {
                if let Some(failure) = &state.last_failure {
                    return Err(failure.clone());
                }
            }
            if state.ever_connected {
                state.redials += 1;
                Some(state.redials)
            } else {
                None
            }
        };
        match redial {
            Some(n) => info!("dialling the host again (redial {n})"),
            None => info!("dialling the host"),
        }
        let started = Instant::now();
        let outcome = tokio::time::timeout(DIAL_TIMEOUT, dial())
            .await
            .unwrap_or(Err(LinkError::TimedOut));
        let took = started.elapsed().as_secs_f64();
        let mut state = self.state();
        state.dials_done += 1;
        match outcome {
            Ok(conn) => {
                info!("connected in {took:.2} s");
                state.conn = Some(conn.clone());
                state.connected_at = Some(Instant::now());
                state.ever_connected = true;
                state.last_failure = None;
                Ok(conn)
            }
            Err(failure) => {
                warn!("no connection after {took:.2} s: {failure}");
                state.conn = None;
                state.connected_at = None;
                state.last_failure = Some(failure.clone());
                if matches!(failure, LinkError::NotPaired | LinkError::Revoked) {
                    state.hold(failure.clone());
                }
                // `failed` may read the state.
                drop(state);
                failed(&failure);
                Err(failure)
            }
        }
    }

    /// Whether a dial is under way. Never dials.
    pub(crate) fn dialling(&self) -> bool {
        self.dialling.try_lock().is_err()
    }

    /// The host's refusal, if it has turned this device away. Never dials.
    pub(crate) fn refusal(&self) -> Option<LinkError> {
        self.state().refusal()
    }

    /// The open connection, if there is one. Never dials.
    pub(crate) fn current(&self) -> Option<C> {
        self.state().open()
    }

    pub(crate) fn status(&self) -> LinkStatus {
        let state = self.state();
        let connected = state.open().is_some();
        LinkStatus {
            connected,
            connected_for: state
                .connected_at
                .filter(|_| connected)
                .map(|at| at.elapsed()),
            redials: state.redials,
        }
    }

    fn state(&self) -> MutexGuard<'_, State<C>> {
        // Every update is a few plain assignments, so the state is whole even
        // if a holder panicked.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use std::future::{pending, ready};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

    use super::*;

    #[derive(Debug, Clone)]
    struct Fake {
        id: u32,
        closed: Arc<AtomicBool>,
        refused: Arc<Mutex<Option<LinkError>>>,
    }

    impl Fake {
        fn new(id: u32) -> Self {
            Self {
                id,
                closed: Arc::default(),
                refused: Arc::default(),
            }
        }

        fn close(&self) {
            self.closed.store(true, Ordering::SeqCst);
        }

        /// What the host does to a key it turns away: closes the connection,
        /// saying why.
        fn turn_away(&self, why: LinkError) {
            *self.refused.lock().unwrap() = Some(why);
            self.close();
        }
    }

    impl Closable for Fake {
        fn is_closed(&self) -> bool {
            self.closed.load(Ordering::SeqCst)
        }

        fn refusal(&self) -> Option<LinkError> {
            self.refused.lock().unwrap().clone()
        }
    }

    /// Counts the dials the cache starts. Each method is one dial's outcome.
    #[derive(Default)]
    struct Dialer {
        dials: AtomicU32,
    }

    impl Dialer {
        fn count(&self) -> u32 {
            self.dials.load(Ordering::SeqCst)
        }

        fn start(&self) {
            self.dials.fetch_add(1, Ordering::SeqCst);
        }

        fn connects(&self, id: u32) -> impl Future<Output = Result<Fake, LinkError>> {
            self.start();
            ready(Ok(Fake::new(id)))
        }

        fn fails(&self) -> impl Future<Output = Result<Fake, LinkError>> {
            self.start();
            ready(Err(refused()))
        }

        /// The host turns the key away before the dial has finished.
        fn turned_away(&self, why: LinkError) -> impl Future<Output = Result<Fake, LinkError>> {
            self.start();
            ready(Err(why))
        }

        fn slowly_connects(&self, id: u32) -> impl Future<Output = Result<Fake, LinkError>> {
            self.start();
            async move {
                tokio::time::sleep(Duration::from_secs(1)).await;
                Ok(Fake::new(id))
            }
        }

        fn slowly_fails(&self) -> impl Future<Output = Result<Fake, LinkError>> {
            self.start();
            async {
                tokio::time::sleep(Duration::from_secs(1)).await;
                Err(refused())
            }
        }

        fn hangs(&self) -> impl Future<Output = Result<Fake, LinkError>> {
            self.start();
            pending()
        }
    }

    fn refused() -> LinkError {
        LinkError::Dial("connection refused".into())
    }

    fn status(connected: bool, connected_for_s: Option<u64>, redials: u64) -> LinkStatus {
        LinkStatus {
            connected,
            connected_for: connected_for_s.map(Duration::from_secs),
            redials,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn dials_once_then_shares_the_connection() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        assert_eq!(cache.status(), status(false, None, 0));
        let first = cache.get(|| dialer.connects(1)).await.unwrap();
        let second = cache.get(|| dialer.connects(2)).await.unwrap();
        assert_eq!((first.id, second.id), (1, 1));
        assert_eq!(dialer.count(), 1);
        assert_eq!(cache.status(), status(true, Some(0), 0));
    }

    #[tokio::test(start_paused = true)]
    async fn dials_again_on_the_first_use_after_it_closes() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        let first = cache.get(|| dialer.connects(1)).await.unwrap();
        first.close();
        assert_eq!(cache.status(), status(false, None, 0));
        let second = cache.get(|| dialer.connects(2)).await.unwrap();
        assert_eq!(second.id, 2);
        assert_eq!(dialer.count(), 2);
        assert_eq!(cache.status(), status(true, Some(0), 1));
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_no_failed_dial() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        assert_eq!(cache.get(|| dialer.fails()).await.unwrap_err(), refused());
        assert_eq!(cache.status(), status(false, None, 0));
        // The next request dials again. Dials before the first connection
        // aren't redials.
        let conn = cache.get(|| dialer.connects(1)).await.unwrap();
        assert_eq!((conn.id, dialer.count()), (1, 2));
        assert_eq!(cache.status(), status(true, Some(0), 0));
    }

    #[tokio::test(start_paused = true)]
    async fn gives_up_on_a_dial_after_10_s() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        let started = Instant::now();
        let failed = cache.get(|| dialer.hangs()).await;
        assert_eq!(failed.unwrap_err(), LinkError::TimedOut);
        assert_eq!(started.elapsed(), DIAL_TIMEOUT);
        let conn = cache.get(|| dialer.connects(1)).await.unwrap();
        assert_eq!((conn.id, dialer.count()), (1, 2));
    }

    #[tokio::test(start_paused = true)]
    async fn requests_during_a_dial_wait_for_it() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        let (a, b, c) = tokio::join!(
            cache.get(|| dialer.slowly_connects(1)),
            cache.get(|| dialer.connects(2)),
            cache.get(|| dialer.connects(3)),
        );
        assert_eq!((a.unwrap().id, b.unwrap().id, c.unwrap().id), (1, 1, 1));
        assert_eq!(dialer.count(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn requests_during_a_failed_dial_share_its_error() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        let (a, b) = tokio::join!(
            cache.get(|| dialer.slowly_fails()),
            cache.get(|| dialer.connects(2)),
        );
        assert_eq!((a.unwrap_err(), b.unwrap_err()), (refused(), refused()));
        assert_eq!(dialer.count(), 1);
        // A request that comes after the failure dials again.
        let conn = cache.get(|| dialer.connects(3)).await.unwrap();
        assert_eq!((conn.id, dialer.count()), (3, 2));
    }

    #[tokio::test(start_paused = true)]
    async fn counts_every_redial_whether_or_not_it_connects() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        cache.get(|| dialer.connects(1)).await.unwrap().close();
        assert_eq!(cache.get(|| dialer.fails()).await.unwrap_err(), refused());
        assert_eq!(
            cache.get(|| dialer.hangs()).await.unwrap_err(),
            LinkError::TimedOut
        );
        let conn = cache.get(|| dialer.connects(2)).await.unwrap();
        assert_eq!(conn.id, 2);
        assert_eq!(cache.status(), status(true, Some(0), 3));
    }

    /// A revoked phone dialled 185 times in 124 s, once for each request the
    /// app retried (step 30). Turned away, the link dials no more.
    #[tokio::test(start_paused = true)]
    async fn once_the_host_turns_this_device_away_it_never_dials_again() {
        for why in [LinkError::NotPaired, LinkError::Revoked] {
            // Just after the handshake: the connection closes, saying why.
            let cache = Cache::new();
            let dialer = Dialer::default();
            let conn = cache.get(|| dialer.connects(1)).await.unwrap();
            assert_eq!(cache.refusal(), None);
            conn.turn_away(why.clone());
            for id in 2..5 {
                let again = cache.get(|| dialer.connects(id)).await;
                assert_eq!(again.unwrap_err(), why);
            }
            assert_eq!((dialer.count(), cache.refusal()), (1, Some(why.clone())));
            assert_eq!(cache.status(), status(false, None, 0));

            // Before the dial has finished: the dial fails, saying why.
            let cache = Cache::new();
            let dialer = Dialer::default();
            let first = cache.get(|| dialer.turned_away(why.clone())).await;
            assert_eq!(first.unwrap_err(), why);
            let (a, b) = tokio::join!(
                cache.get(|| dialer.connects(1)),
                cache.get(|| dialer.connects(2)),
            );
            assert_eq!((a.unwrap_err(), b.unwrap_err()), (why.clone(), why.clone()));
            assert_eq!((dialer.count(), cache.refusal()), (1, Some(why)));
        }
    }

    /// Only the host's refusal is held: a connection closed for any other
    /// reason is dialled again, as before.
    #[tokio::test(start_paused = true)]
    async fn holds_nothing_else() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        cache.get(|| dialer.connects(1)).await.unwrap().close();
        assert_eq!(cache.get(|| dialer.fails()).await.unwrap_err(), refused());
        let timed_out = cache.get(|| dialer.turned_away(LinkError::TimedOut)).await;
        assert_eq!(timed_out.unwrap_err(), LinkError::TimedOut);
        assert_eq!(cache.refusal(), None);
        assert_eq!(cache.get(|| dialer.connects(2)).await.unwrap().id, 2);
        assert_eq!(dialer.count(), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn says_how_long_the_open_connection_has_been_up() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        let conn = cache.get(|| dialer.connects(1)).await.unwrap();
        tokio::time::advance(Duration::from_secs(5)).await;
        assert_eq!(cache.status(), status(true, Some(5), 0));
        conn.close();
        assert_eq!(cache.status(), status(false, None, 0));
    }

    #[test]
    fn says_why_there_is_no_connection() {
        assert_eq!(
            refused().to_string(),
            "Can't reach the host: connection refused"
        );
        assert_eq!(
            LinkError::TimedOut.to_string(),
            "Can't reach the host: no connection within 10 s"
        );
        assert!(LinkError::Revoked.to_string().contains("removed"));
        assert_ne!(
            LinkError::NotPaired.to_string(),
            LinkError::Revoked.to_string()
        );
    }

    /// The hook hears each failed dial once, not each request that shared
    /// it, and nothing of one that connected.
    #[tokio::test(start_paused = true)]
    async fn hears_each_failed_dial_once() {
        let cache = Cache::new();
        let dialer = Dialer::default();
        let heard = Mutex::new(Vec::new());
        let note = |failure: &LinkError| heard.lock().unwrap().push(failure.clone());
        let (a, b) = tokio::join!(
            cache.get_then(|| dialer.slowly_fails(), note),
            cache.get_then(|| dialer.connects(2), note),
        );
        assert_eq!((a.unwrap_err(), b.unwrap_err()), (refused(), refused()));
        assert_eq!(*heard.lock().unwrap(), vec![refused()]);
        let timed_out = cache.get_then(|| dialer.hangs(), note).await;
        assert_eq!(timed_out.unwrap_err(), LinkError::TimedOut);
        cache
            .get_then(|| dialer.connects(3), note)
            .await
            .expect("connects");
        assert_eq!(*heard.lock().unwrap(), vec![refused(), LinkError::TimedOut]);
    }

    #[tokio::test(start_paused = true)]
    async fn says_while_a_dial_is_under_way() {
        let cache: Cache<Fake> = Cache::new();
        let dialer = Dialer::default();
        assert!(!cache.dialling());
        let dial = cache.get(|| dialer.slowly_connects(1));
        tokio::pin!(dial);
        assert!(tokio::time::timeout(Duration::from_millis(500), &mut dial)
            .await
            .is_err());
        assert!(cache.dialling(), "half way through the dial");
        dial.await.expect("connects");
        assert!(!cache.dialling());
    }

    #[tokio::test(start_paused = true)]
    async fn says_how_long_ago_the_host_was_heard() {
        let heard = Heard::new();
        assert_eq!(heard.ago(), None, "never");
        tokio::time::advance(Duration::from_secs(3)).await;
        heard.note();
        assert_eq!(heard.ago(), Some(Duration::ZERO));
        tokio::time::advance(Duration::from_secs(90)).await;
        assert_eq!(heard.ago(), Some(Duration::from_secs(90)));
        heard.note();
        assert_eq!(heard.ago(), Some(Duration::ZERO));
    }

    fn pings(answers: &[(&RelayUrl, Ping)]) -> BTreeMap<RelayUrl, Ping> {
        answers
            .iter()
            .map(|(relay, ping)| ((*relay).clone(), ping.clone()))
            .collect()
    }

    #[test]
    fn tells_a_silent_host_from_relays_that_dont_answer() {
        let (own, n0) = (
            relay("relay.example.com"),
            relay("euc1-1.relay.n0.iroh.link."),
        );
        let both = vec![own.clone(), n0.clone()];
        let up = Ping::Relay(Duration::from_millis(40));
        let down = Ping::NoAnswer("dns error".into());
        let not_one = Ping::NotARelay("it answered HTTP 404".into());

        // One relay answering is enough: the host is the one that's missing.
        let one_up = pings(&[(&own, down.clone()), (&n0, up.clone())]);
        assert_eq!(
            unreached_by(both.clone(), &one_up, None),
            Unreached::HostSilent
        );

        // None answering as a relay does, a web page included: every one tried.
        let none_up = pings(&[(&own, not_one), (&n0, down.clone())]);
        assert_eq!(
            unreached_by(both.clone(), &none_up, None),
            Unreached::NoRelay {
                tried: both.clone()
            }
        );
        assert_eq!(
            unreached_by(both.clone(), &BTreeMap::new(), None),
            Unreached::NoRelay {
                tried: both.clone()
            },
            "a relay the probe never heard back from"
        );

        // The home relay answers /ping, yet turned this version away.
        let home_up = pings(&[(&own, up.clone()), (&n0, up)]);
        assert_eq!(
            unreached_by(both.clone(), &home_up, Some(own.clone())),
            Unreached::RelayRefused { relay: own.clone() }
        );
        // One that doesn't answer at all is just not there.
        assert_eq!(
            unreached_by(both.clone(), &one_up, Some(own)),
            Unreached::HostSilent
        );
        assert_eq!(
            unreached_by(both.clone(), &none_up, Some(n0)),
            Unreached::NoRelay { tried: both }
        );
    }

    /// The words iroh-relay's client puts to a relay turning the upgrade
    /// down (`ConnectError` in iroh-relay 1.4.1's client.rs), as the relay
    /// connection's error carries them.
    #[test]
    fn knows_a_relay_turning_this_version_away() {
        let upgrade = |status: reqwest::StatusCode| {
            format!("Failed to connect to relay server: Unexpected status during upgrade: {status}")
        };
        assert!(turned_down_by_relay(&upgrade(
            reqwest::StatusCode::BAD_REQUEST
        )));
        assert!(turned_down_by_relay(&upgrade(
            reqwest::StatusCode::UPGRADE_REQUIRED
        )));
        assert!(turned_down_by_relay(
            "Server replied with invalid iroh-relay version header: iroh-relay-v9"
        ));
        for other in [
            upgrade(reqwest::StatusCode::TOO_MANY_REQUESTS),
            upgrade(reqwest::StatusCode::SERVICE_UNAVAILABLE),
            "Failed to connect to relay server: dns error: no record found".to_string(),
            "tls connection failed: invalid peer certificate: UnknownIssuer".to_string(),
        ] {
            assert!(!turned_down_by_relay(&other), "{other}");
        }
    }

    #[test]
    fn says_why_the_host_wasnt_reached() {
        let tried = vec![
            relay("relay.example.com"),
            relay("euc1-1.relay.n0.iroh.link."),
        ];
        assert_eq!(
            Unreached::NoRelay { tried }.to_string(),
            "no relay answered: https://relay.example.com/ https://euc1-1.relay.n0.iroh.link./"
        );
        assert_eq!(
            Unreached::RelayRefused {
                relay: relay("relay.example.com")
            }
            .to_string(),
            "https://relay.example.com/ turned down this version's relay connection"
        );
        assert_eq!(
            Unreached::HostSilent.to_string(),
            "a relay answered, but the host didn't"
        );
    }

    fn relay(name: &str) -> RelayUrl {
        format!("https://{name}/").parse().expect("a relay")
    }

    fn key() -> EndpointId {
        iroh::SecretKey::from_bytes(&[7; 32]).public()
    }

    /// The host's pairing endpoint's key.
    fn pair() -> EndpointId {
        iroh::SecretKey::from_bytes(&[8; 32]).public()
    }

    fn addr(text: &str) -> SocketAddr {
        text.parse().expect("an address")
    }

    fn relays_of(addr: &EndpointAddr) -> Vec<String> {
        addr.relay_urls().map(ToString::to_string).collect()
    }

    fn ips_of(addr: &EndpointAddr) -> Vec<SocketAddr> {
        addr.ip_addrs().copied().collect()
    }

    #[test]
    fn dials_the_last_relay_first_then_every_relay_in_the_list() {
        let route = Route::new(
            key(),
            Some(relay("relay.example.com")),
            vec![addr("192.168.1.20:52043"), addr("[2001:db8::7]:7842")],
            vec![RelayEntry::Url(relay("relay.example.com")), RelayEntry::N0],
        );
        let ips = [addr("192.168.1.20:52043"), addr("[2001:db8::7]:7842")];
        let mut expected = vec!["https://relay.example.com/".to_string()];
        expected.extend(crate::relays::n0_relays().iter().map(ToString::to_string));
        expected.sort();
        for direct_first in [true, false] {
            let (first, second) = route.stages(direct_first);
            assert_eq!(first.id, key());
            assert_eq!(relays_of(&first), ["https://relay.example.com/"]);
            let second = second.expect("a second stage");
            assert_eq!(relays_of(&second), expected);
            assert_eq!(ips_of(&second), ips, "the second stage goes direct too");
        }
        assert_eq!(ips_of(&route.stages(true).0), ips);
        assert_eq!(route.every_relay().len(), 5);
        assert_eq!(route.every_relay()[0], relay("relay.example.com"));
    }

    /// A list without "n0": no stage of a dial names any of n0's relays, so
    /// the phone's endpoint (bound with the route's relays alone) never
    /// contacts them.
    #[test]
    fn a_list_without_n0_never_dials_n0s_relays() {
        let own = relay("relay.example.com");
        let other = relay("relay.example.org");
        for last in [None, Some(own.clone()), Some(other.clone())] {
            let route = Route::new(
                key(),
                last,
                vec![addr("192.168.1.20:52043")],
                vec![RelayEntry::Url(own.clone()), RelayEntry::Url(other.clone())],
            )
            .with_pair_key(pair());
            let mut named = route.every_relay();
            for direct_first in [true, false] {
                let (first, second) = route.stages(direct_first);
                named.extend(first.relay_urls().cloned());
                if let Some(second) = second {
                    named.extend(second.relay_urls().cloned());
                }
            }
            let asked = route.pairing_addr().expect("where to ask");
            named.extend(asked.relay_urls().cloned());
            assert!(!named.is_empty());
            assert!(
                !named.iter().any(crate::relays::is_n0_relay),
                "n0 named: {named:?}"
            );
        }
    }

    #[test]
    fn has_no_second_stage_when_the_list_adds_nothing() {
        let own = relay("relay.example.com");
        let route = Route::new(key(), Some(own.clone()), vec![], vec![RelayEntry::Url(own)]);
        assert_eq!(route.stages(true).1, None);
        assert_eq!(route.stages(false).1, None);
    }

    /// ADR 0005: while the host is on a relay it answers no direct dial, so
    /// a phone with a relay connection names the direct addresses only in
    /// the second stage. With none, or a route with no relay, they go first.
    #[test]
    fn names_the_direct_addresses_first_only_while_on_no_relay() {
        let own = relay("relay.example.com");
        let lan = addr("192.168.1.20:52043");
        let route = Route::new(
            key(),
            Some(own.clone()),
            vec![lan],
            vec![RelayEntry::Url(own.clone())],
        );
        let (first, second) = route.stages(false);
        assert_eq!(relays_of(&first), [own.to_string()]);
        assert_eq!(ips_of(&first), [], "through the relay alone");
        let second = second.expect("the direct addresses in the second stage");
        assert_eq!(
            (relays_of(&second), ips_of(&second)),
            (vec![own.to_string()], vec![lan])
        );

        let (first, second) = route.stages(true);
        assert_eq!(
            (relays_of(&first), ips_of(&first)),
            (vec![own.to_string()], vec![lan])
        );
        assert_eq!(second, None, "the list adds nothing");

        // With no relay of its own to start from, the first stage has only
        // the direct addresses, and the list is the second.
        let route = Route::new(key(), None, vec![lan], vec![RelayEntry::Url(own.clone())]);
        for direct_first in [true, false] {
            let (first, second) = route.stages(direct_first);
            assert_eq!((relays_of(&first), ips_of(&first)), (vec![], vec![lan]));
            let second = second.expect("a second stage");
            assert_eq!(
                (relays_of(&second), ips_of(&second)),
                (vec![own.to_string()], vec![lan])
            );
        }
    }

    #[test]
    fn keeps_the_first_8_addresses_once_each() {
        let many: Vec<SocketAddr> = (1..=10)
            .flat_map(|n| [addr(&format!("10.0.0.{n}:1")); 2])
            .collect();
        let route = Route::new(key(), None, many, vec![]);
        let kept: Vec<String> = route.addrs().iter().map(ToString::to_string).collect();
        assert_eq!(kept.len(), MAX_ROUTE_ADDRS);
        assert_eq!(kept[0], "10.0.0.1:1");
        assert_eq!(kept[7], "10.0.0.8:1");
    }

    #[test]
    fn takes_a_tickets_route() {
        let ticket: crate::ticket::Ticket = format!(
            r#"{{"v":4,"type":"kleio-pair","name":"mini","key":"{}","relays":["https://euc1-1.relay.n0.iroh.link./","n0"],"addrs":["192.168.1.20:52043"],"code":"ABC-DEF"}}"#,
            key()
        )
        .parse()
        .expect("a ticket");
        let route = Route::from_ticket(&ticket);
        assert_eq!(route.key(), key());
        assert_eq!(route.relay(), Some(ticket.relay()));
        assert_eq!(route.addrs(), ticket.addrs());
        assert_eq!(route.relays(), ticket.relays());
        // n0's EU relay is the ticket's, and n0's entry names it again.
        assert_eq!(route.every_relay().len(), 4);
        // A v4 ticket's one key is no pairing endpoint's.
        assert_eq!((route.pair_key(), route.pairing_addr()), (None, None));
    }

    #[test]
    fn takes_a_v5_tickets_pairing_key_and_asks_it_through_every_relay() {
        let ticket: crate::ticket::Ticket = format!(
            r#"{{"v":5,"type":"kleio-pair","name":"mini","key":"{}","pair":"{}","relays":["https://relay.example.com/","n0"],"code":"ABC-DEF"}}"#,
            key(),
            pair()
        )
        .parse()
        .expect("a ticket");
        let route = Route::from_ticket(&ticket);
        assert_eq!((route.key(), route.pair_key()), (key(), Some(pair())));
        let asked = route.pairing_addr().expect("where to ask");
        assert_eq!(asked.id, pair());
        assert_eq!(ips_of(&asked), [], "the pairing endpoint has no address");
        let mut every: Vec<String> = route
            .every_relay()
            .iter()
            .map(ToString::to_string)
            .collect();
        every.sort();
        assert_eq!(relays_of(&asked), every);

        // Without a relay there's nowhere to ask, and the link key isn't a
        // pairing key.
        let lan = vec![addr("10.0.0.2:1")];
        let direct = Route::new(key(), None, lan, vec![]).with_pair_key(pair());
        assert_eq!(direct.pairing_addr(), None);
        assert_eq!(route.clone().with_pair_key(key()).pair_key(), Some(pair()));
        assert_eq!(
            Route::new(key(), None, vec![], vec![])
                .with_pair_key(key())
                .pair_key(),
            None
        );
    }

    /// `GET /kleio/link` gives the pairing key; a host from before ADR 0005
    /// gives none, and the route keeps the one it has.
    #[tokio::test]
    async fn refreshing_replaces_the_pairing_key_and_keeps_it_when_given_none() {
        use crate::testing::{loopback_endpoint, within_30_s};

        within_30_s(async {
            let own = relay("relay.example.com");
            let route = Route::new(key(), Some(own.clone()), vec![], vec![RelayEntry::Url(own)]);
            let link = Link::new(loopback_endpoint(13, &[]).await, route);
            let lan = addr("192.168.1.20:52043");
            link.refresh(vec![RelayEntry::N0], vec![lan], Some(pair()));
            let route = link.route();
            assert_eq!(route.relays(), [RelayEntry::N0]);
            assert_eq!(route.addrs(), [lan]);
            assert_eq!(route.pair_key(), Some(pair()));

            let newer = iroh::SecretKey::from_bytes(&[9; 32]).public();
            link.refresh(vec![RelayEntry::N0], vec![], Some(newer));
            assert_eq!(link.route().pair_key(), Some(newer), "replaced");
            link.refresh(vec![RelayEntry::N0], vec![], None);
            assert_eq!(link.route().pair_key(), Some(newer), "kept");
            link.refresh(vec![RelayEntry::N0], vec![], Some(key()));
            assert_eq!(
                link.route().pair_key(),
                Some(newer),
                "the link key left out"
            );
            assert_eq!(link.route().addrs(), []);
        })
        .await;
    }

    #[test]
    fn reads_the_hosts_close_codes() {
        let told = |code: u32| told_by(u64::from(code));
        assert_eq!(told(close::NOT_PAIRED), Some(LinkError::NotPaired));
        assert_eq!(told(close::REVOKED), Some(LinkError::Revoked));
        // The pairing endpoint's answer for a key it lets in.
        assert_eq!(told(close::PAIRED), None);
        for other in [
            close::DONE,
            close::PAIR_BUSY,
            close::PAIR_FAILED,
            close::UNKNOWN_ALPN,
            7,
        ] {
            assert_eq!(told(other), None, "{other}");
        }
    }

    /// One stage's dial: connects as `id` after `after`, fails then, or
    /// never finishes.
    async fn stage(after: u64, outcome: Option<Result<u32, LinkError>>) -> Result<u32, LinkError> {
        tokio::time::sleep(Duration::from_secs(after)).await;
        match outcome {
            Some(outcome) => outcome,
            None => pending().await,
        }
    }

    /// `in_two_stages`' outcome and when it came.
    async fn two_stages(
        first: (u64, Option<Result<u32, LinkError>>),
        second: Option<(u64, Option<Result<u32, LinkError>>)>,
    ) -> (Result<u32, LinkError>, Duration) {
        let started = Instant::now();
        let second = second.map(|(after, outcome)| stage(after, outcome));
        let outcome = tokio::time::timeout(
            Duration::from_secs(60),
            in_two_stages(stage(first.0, first.1), second),
        )
        .await
        .unwrap_or(Err(LinkError::TimedOut));
        (outcome, started.elapsed())
    }

    #[tokio::test(start_paused = true)]
    async fn the_first_stage_alone_when_it_connects_within_4_s() {
        let secs = Duration::from_secs;
        assert_eq!(
            two_stages((1, Some(Ok(1))), Some((0, Some(Ok(2))))).await,
            (Ok(1), secs(1))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_second_stage_starts_after_4_s_alongside_the_first() {
        let secs = Duration::from_secs;
        // The second stage connects 2 s after it starts.
        assert_eq!(
            two_stages((0, None), Some((2, Some(Ok(2))))).await,
            (Ok(2), secs(6))
        );
        // The first keeps going, and connects at 5 s.
        assert_eq!(
            two_stages((5, Some(Ok(1))), Some((0, None))).await,
            (Ok(1), secs(5))
        );
        // The first fails at 5 s, so the second's outcome counts.
        assert_eq!(
            two_stages((5, Some(Err(refused()))), Some((3, Some(Ok(2))))).await,
            (Ok(2), secs(7))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_first_stage_that_fails_goes_on_to_the_second_at_once() {
        let secs = Duration::from_secs;
        assert_eq!(
            two_stages((1, Some(Err(refused()))), Some((1, Some(Ok(2))))).await,
            (Ok(2), secs(2))
        );
        assert_eq!(
            two_stages((1, Some(Err(refused()))), None).await,
            (Err(refused()), secs(1))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn with_no_second_stage_the_first_has_all_the_time() {
        let secs = Duration::from_secs;
        assert_eq!(two_stages((9, Some(Ok(1))), None).await, (Ok(1), secs(9)));
    }

    /// The host turning this device away ends the dial at once, from either
    /// stage: the other would be turned away too, and ask why again.
    #[tokio::test(start_paused = true)]
    async fn a_refusal_from_either_stage_ends_the_dial() {
        let secs = Duration::from_secs;
        for why in [LinkError::NotPaired, LinkError::Revoked] {
            assert_eq!(
                two_stages((1, Some(Err(why.clone()))), Some((0, Some(Ok(2))))).await,
                (Err(why.clone()), secs(1)),
                "the second never starts"
            );
            assert_eq!(
                two_stages((5, Some(Err(why.clone()))), Some((0, None))).await,
                (Err(why.clone()), secs(5))
            );
            assert_eq!(
                two_stages((0, None), Some((1, Some(Err(why.clone()))))).await,
                (Err(why.clone()), secs(5))
            );
            assert_eq!(
                two_stages((1, Some(Err(refused()))), Some((1, Some(Err(why.clone()))))).await,
                (Err(why), secs(2))
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_second_stage_that_fails_leaves_the_first_going() {
        let secs = Duration::from_secs;
        assert_eq!(
            two_stages((8, Some(Ok(1))), Some((1, Some(Err(refused()))))).await,
            (Ok(1), secs(8))
        );
        // Neither connects: the caller's 10 s ends it.
        assert_eq!(
            two_stages((0, None), Some((1, Some(Err(refused()))))).await,
            (Err(LinkError::TimedOut), secs(60))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn times_a_resume_to_the_first_reply_to_a_request_sent_after_it() {
        let resume = Resume::default();
        // Bytes with no resume waiting time nothing.
        let before = resume.number();
        resume.end(before);
        assert_eq!(resume.last(), None);

        resume.begin();
        let during = resume.number();
        assert_ne!(during, before);
        // A reply to a request sent before the resume began ends nothing.
        tokio::time::advance(Duration::from_millis(100)).await;
        resume.end(before);
        assert_eq!(resume.last(), None);
        tokio::time::advance(Duration::from_millis(150)).await;
        resume.end(during);
        // Later bytes leave it as it is.
        tokio::time::advance(Duration::from_millis(250)).await;
        resume.end(during);
        assert_eq!(resume.last(), Some(Duration::from_millis(250)));

        // The next resume replaces it once it ends, not before, and only a
        // stream that sent during it can end it.
        resume.begin();
        tokio::time::advance(Duration::from_millis(40)).await;
        resume.end(during);
        assert_eq!(resume.last(), Some(Duration::from_millis(250)));
        resume.end(resume.number());
        assert_eq!(resume.last(), Some(Duration::from_millis(40)));
    }

    /// Closing the open connection makes the next use dial again, once. With
    /// no connection open there's nothing to close, and nothing is dialled.
    #[tokio::test]
    async fn closing_the_connection_makes_the_next_use_dial_again() {
        use crate::testing::{loopback_addr, loopback_endpoint, within_30_s};

        within_30_s(async {
            let host = loopback_endpoint(11, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(12, &[]).await;
            let (accepted_tx, mut accepted) = tokio::sync::mpsc::unbounded_channel();
            let accepting = host.clone();
            tokio::spawn(async move {
                while let Some(incoming) = accepting.accept().await {
                    if let Ok(conn) = incoming.await {
                        let _ = accepted_tx.send(conn);
                    }
                }
            });
            let link = Link::new(phone, loopback_addr(&host).into());
            assert!(!link.close_connection(), "nothing to close before a dial");
            assert_eq!(link.status(), status(false, None, 0));
            let mut made = link.watch_connections();
            assert_eq!((*made.borrow_and_update(), link.last_heard()), (0, None));

            let first = link.connection().await.expect("dials");
            assert!(made.has_changed().expect("the link is there"));
            assert_eq!(*made.borrow_and_update(), 1);
            assert!(
                link.last_heard().is_some(),
                "a connection is hearing from the host"
            );
            let host_side = accepted.recv().await.expect("the host accepted");
            assert!(link.close_connection(), "closes the open connection");
            assert!(first.close_reason().is_some(), "the connection is closed");
            assert!(!link.status().connected);
            assert!(!link.close_connection(), "nothing left to close");
            // The host hears at once, rather than after its idle timeout.
            host_side.closed().await;

            let second = link.connection().await.expect("dials again");
            accepted.recv().await.expect("the host accepted again");
            assert_ne!(first.stable_id(), second.stable_id());
            let now = link.status();
            assert!(now.connected);
            assert_eq!(now.redials, 1);
            assert_eq!(*made.borrow_and_update(), 2);
            assert_eq!(link.unreached(), None, "it's connected");
        })
        .await;
    }
}
