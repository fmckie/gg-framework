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
//! There's no address lookup, and a relay drops what it gets for a key that
//! isn't connected to it, so the phone finds the host only through the
//! relays the host names, and the host may have moved relay (it does after
//! 15 s without its own: host/relays.rs). A dial ([`Route`]) goes in two
//! stages:
//!
//! 1. For up to [`FIRST_STAGE`]: the relay the host was last reached through,
//!    and its last direct addresses.
//! 2. Then, alongside the first, until [`DIAL_TIMEOUT`]: every relay in the
//!    host's list as well.
//!
//! The relay that worked becomes the route's, and the endpoint's home relay
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

use std::fmt;
use std::future::Future;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use iroh::endpoint::{ConnectError, ConnectingError, Connection, ConnectionError, VarInt};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayUrl, TransportAddr};
use tokio::time::Instant;
use tracing::{info, warn};

use crate::endpoint::switch_relay;
use crate::paths::{PathEvents, SelectedPath};
use crate::relays::{every_relay, RelayEntry};
use crate::ticket::Ticket;
use crate::{close, error_chain, paths, ALPN_HTTP};

/// How long one dial may take before the requests waiting on it fail.
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a dial tries only the relay the host was last reached through,
/// and its direct addresses, before it tries every relay in its list too.
pub const FIRST_STAGE: Duration = Duration::from_secs(4);

/// The most direct addresses a route keeps: as many as `GET /kleio/link`
/// gives (`MAX_INFO_ADDRS` in packages/kleio-host/src/link.ts).
pub const MAX_ROUTE_ADDRS: usize = 8;

/// Where the phone looks for its host: its key, the relay it was last
/// reached through, its last direct addresses, and its relay list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    key: EndpointId,
    relay: Option<RelayUrl>,
    addrs: Vec<SocketAddr>,
    relays: Vec<RelayEntry>,
}

impl Route {
    /// `addrs` best first; past [`MAX_ROUTE_ADDRS`], and repeats, are dropped.
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
        }
    }

    /// What a pairing ticket says: the relay the host was on, its addresses
    /// and its list.
    pub fn from_ticket(ticket: &Ticket) -> Self {
        Self::new(
            ticket.key(),
            Some(ticket.relay().clone()),
            ticket.addrs().to_vec(),
            ticket.relays().to_vec(),
        )
    }

    pub fn key(&self) -> EndpointId {
        self.key
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

    /// The first stage's address: the relay and the direct addresses.
    pub fn first_stage(&self) -> EndpointAddr {
        let addr =
            EndpointAddr::from_parts(self.key, self.addrs.iter().copied().map(TransportAddr::Ip));
        match &self.relay {
            Some(relay) => addr.with_relay_url(relay.clone()),
            None => addr,
        }
    }

    /// The second stage's: every relay as well. `None` if that's no more
    /// than the first stage's.
    pub fn second_stage(&self) -> Option<EndpointAddr> {
        let first = self.first_stage();
        let all = first
            .clone()
            .with_addrs(self.every_relay().into_iter().map(TransportAddr::Relay));
        (all != first).then_some(all)
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
    cache: Cache<Connection>,
    resume: Resume,
}

impl Inner {
    fn route(&self) -> MutexGuard<'_, Route> {
        // Every update is a plain assignment, so the route is whole even if a
        // holder panicked.
        self.route.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Link {
    /// A link to the host `route` leads to. Nothing is dialled until the
    /// first [`connection`](Self::connection).
    pub fn new(endpoint: Endpoint, route: Route) -> Self {
        Self::build(endpoint, route, None)
    }

    /// [`new`](Self::new), keeping each connection's path events in `events`
    /// as well as logging them.
    pub fn with_path_events(endpoint: Endpoint, route: Route, events: PathEvents) -> Self {
        Self::build(endpoint, route, Some(events))
    }

    fn build(endpoint: Endpoint, route: Route, kept: Option<PathEvents>) -> Self {
        Self {
            inner: Arc::new(Inner {
                endpoint,
                route: Mutex::new(route),
                kept,
                cache: Cache::new(),
                resume: Resume::default(),
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

    /// Takes the host's relay list and direct addresses, as
    /// `GET /kleio/link` gives them, for the next dial.
    pub fn refresh(&self, relays: Vec<RelayEntry>, addrs: Vec<SocketAddr>) {
        let mut route = self.inner.route();
        route.relays = relays;
        route.addrs = first_few(addrs);
    }

    /// The open connection, dialling first if there is none or it has closed.
    /// Each new connection gets the path log.
    pub async fn connection(&self) -> Result<Connection, LinkError> {
        let inner = &*self.inner;
        inner.cache.get(|| dial(inner)).await
    }

    /// Whether the host turned this device away on the latest connection:
    /// [`LinkError::NotPaired`] or [`LinkError::Revoked`]. It does so just
    /// after the handshake, so a dial succeeds and the connection then closes
    /// with the reason. Never dials.
    pub fn refusal(&self) -> Option<LinkError> {
        self.inner.cache.latest().and_then(|conn| refusal(&conn))
    }

    /// What the link is doing now. Never dials.
    pub fn status(&self) -> LinkStatus {
        self.inner.cache.status()
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
        self.inner.resume.end(sent_in);
    }
}

/// One dial, in two stages, along the route as it is now. The relay that
/// worked becomes the route's and the endpoint's.
async fn dial(inner: &Inner) -> Result<Connection, LinkError> {
    let route = inner.route().clone();
    let endpoint = &inner.endpoint;
    let first = connect(endpoint, route.first_stage());
    let second = route
        .second_stage()
        .map(|addr| connect_later(endpoint, addr));
    let conn = in_two_stages(first, second).await?;
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

async fn connect(endpoint: &Endpoint, host: EndpointAddr) -> Result<Connection, LinkError> {
    endpoint.connect(host, ALPN_HTTP).await.map_err(|err| {
        refused_while_dialling(&err).unwrap_or_else(|| LinkError::Dial(error_chain(&err)))
    })
}

/// The host's refusal, if it turned the key away before the dial finished.
/// It does so just after the handshake, which is usually after this end's
/// dial has finished too, but not always.
fn refused_while_dialling(err: &ConnectError) -> Option<LinkError> {
    match err {
        ConnectError::Connection { source, .. }
        | ConnectError::Connecting {
            source: ConnectingError::ConnectionError { source, .. },
            ..
        } => refused_with(source),
        _ => None,
    }
}

/// [`connect`] for the second stage, which says so first.
async fn connect_later(endpoint: &Endpoint, host: EndpointAddr) -> Result<Connection, LinkError> {
    let relays = host.relay_urls().count();
    info!("not found yet: trying all {relays} of the host's relays as well");
    connect(endpoint, host).await
}

/// `first` alone for up to [`FIRST_STAGE`], or until it fails; then `second`,
/// if there is one, alongside it, until one connects. Each keeps going if the
/// other fails. The caller stops the whole at [`DIAL_TIMEOUT`].
async fn in_two_stages<C, F1, F2>(first: F1, second: Option<F2>) -> Result<C, LinkError>
where
    F1: Future<Output = Result<C, LinkError>>,
    F2: Future<Output = Result<C, LinkError>>,
{
    tokio::pin!(first);
    let first_failed = match tokio::time::timeout(FIRST_STAGE, &mut first).await {
        Ok(Ok(conn)) => return Ok(conn),
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
            Ok(conn) => Ok(conn),
            Err(_) => second.await,
        },
        outcome = &mut second => match outcome {
            Ok(conn) => Ok(conn),
            Err(_) => first.await,
        },
    }
}

/// How the host turned `conn` away, if it did.
fn refusal(conn: &Connection) -> Option<LinkError> {
    refused_with(&conn.close_reason()?)
}

/// The refusal a connection closed for `reason` means, if it's one.
fn refused_with(reason: &ConnectionError) -> Option<LinkError> {
    let ConnectionError::ApplicationClosed(closed) = reason else {
        return None;
    };
    let code = closed.error_code.into_inner();
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
}

impl Closable for Connection {
    fn is_closed(&self) -> bool {
        self.close_reason().is_some()
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
}

impl<C: Closable> State<C> {
    fn open(&self) -> Option<C> {
        self.conn.as_ref().filter(|conn| !conn.is_closed()).cloned()
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
            }),
        }
    }

    /// The open connection, or else the outcome of `dial`.
    pub(crate) async fn get<F, Fut>(&self, dial: F) -> Result<C, LinkError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<C, LinkError>>,
    {
        let dials_seen = {
            let state = self.state();
            if let Some(conn) = state.open() {
                return Ok(conn);
            }
            state.dials_done
        };
        let _dialling = self.dialling.lock().await;
        let redial = {
            let mut state = self.state();
            if let Some(conn) = state.open() {
                return Ok(conn);
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
                Err(failure)
            }
        }
    }

    /// The open connection, if there is one. Never dials.
    pub(crate) fn current(&self) -> Option<C> {
        self.state().open()
    }

    /// The latest connection, open or closed, until a dial fails. Never
    /// dials.
    pub(crate) fn latest(&self) -> Option<C> {
        self.state().conn.clone()
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
    }

    impl Fake {
        fn new(id: u32) -> Self {
            Self {
                id,
                closed: Arc::default(),
            }
        }

        fn close(&self) {
            self.closed.store(true, Ordering::SeqCst);
        }
    }

    impl Closable for Fake {
        fn is_closed(&self) -> bool {
            self.closed.load(Ordering::SeqCst)
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

    fn relay(name: &str) -> RelayUrl {
        format!("https://{name}/").parse().expect("a relay")
    }

    fn key() -> EndpointId {
        iroh::SecretKey::from_bytes(&[7; 32]).public()
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
        let first = route.first_stage();
        assert_eq!(first.id, key());
        assert_eq!(relays_of(&first), ["https://relay.example.com/"]);
        assert_eq!(
            ips_of(&first),
            [addr("192.168.1.20:52043"), addr("[2001:db8::7]:7842")]
        );
        let second = route.second_stage().expect("a second stage");
        let mut expected = vec!["https://relay.example.com/".to_string()];
        expected.extend(crate::relays::n0_relays().iter().map(ToString::to_string));
        expected.sort();
        assert_eq!(relays_of(&second), expected);
        assert_eq!(ips_of(&second), ips_of(&first));
        assert_eq!(route.every_relay().len(), 5);
        assert_eq!(route.every_relay()[0], relay("relay.example.com"));
    }

    #[test]
    fn has_no_second_stage_when_the_list_adds_nothing() {
        let own = relay("relay.example.com");
        let route = Route::new(key(), Some(own.clone()), vec![], vec![RelayEntry::Url(own)]);
        assert_eq!(route.second_stage(), None);
        // With no relay of its own to start from, the list is the second
        // stage, and the first has only the direct addresses.
        let route = Route::new(
            key(),
            None,
            vec![addr("10.0.0.2:1")],
            vec![RelayEntry::Url(relay("relay.example.com"))],
        );
        assert_eq!(relays_of(&route.first_stage()), Vec::<String>::new());
        assert_eq!(
            relays_of(&route.second_stage().expect("a second stage")),
            ["https://relay.example.com/"]
        );
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

            let first = link.connection().await.expect("dials");
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
        })
        .await;
    }
}
