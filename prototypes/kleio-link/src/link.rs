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
//! For a status screen, a link says which path the open connection takes
//! ([`Link::path`]), can keep each connection's path events
//! ([`Link::with_path_events`]), and times a resume: from
//! [`Link::begin_resume`] to the first byte back from the host in reply to a
//! request sent after it.

use std::fmt;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use iroh::endpoint::{Connection, VarInt};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayUrl};
use tokio::time::Instant;
use tracing::{info, warn};

use crate::paths::{PathEvents, SelectedPath};
use crate::{error_chain, paths, ALPN_HTTP};

/// How long one dial may take before the requests waiting on it fail.
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(10);

/// The host's address as the phone dials it: its key and its relay, with no
/// IP address and no lookup. iroh finds a direct path from there.
pub fn host_addr(key: EndpointId, relay: &RelayUrl) -> EndpointAddr {
    EndpointAddr::from(key).with_relay_url(relay.clone())
}

/// Why the link has no connection to offer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// iroh couldn't open the connection: its error and causes.
    Dial(String),
    /// No connection within [`DIAL_TIMEOUT`].
    TimedOut,
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
    host: EndpointAddr,
    kept: Option<PathEvents>,
    cache: Cache<Connection>,
    resume: Resume,
}

impl Link {
    /// A link to `host` (see [`host_addr`]). Nothing is dialled until the
    /// first [`connection`](Self::connection).
    pub fn new(endpoint: Endpoint, host: EndpointAddr) -> Self {
        Self::build(endpoint, host, None)
    }

    /// [`new`](Self::new), keeping each connection's path events in `events`
    /// as well as logging them.
    pub fn with_path_events(endpoint: Endpoint, host: EndpointAddr, events: PathEvents) -> Self {
        Self::build(endpoint, host, Some(events))
    }

    fn build(endpoint: Endpoint, host: EndpointAddr, kept: Option<PathEvents>) -> Self {
        Self {
            inner: Arc::new(Inner {
                endpoint,
                host,
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

    /// The open connection, dialling first if there is none or it has closed.
    /// Each new connection gets the path log.
    pub async fn connection(&self) -> Result<Connection, LinkError> {
        let inner = &*self.inner;
        inner
            .cache
            .get(|| dial(&inner.endpoint, inner.host.clone(), inner.kept.clone()))
            .await
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

async fn dial(
    endpoint: &Endpoint,
    host: EndpointAddr,
    kept: Option<PathEvents>,
) -> Result<Connection, LinkError> {
    let conn = endpoint
        .connect(host, ALPN_HTTP)
        .await
        .map_err(|err| LinkError::Dial(error_chain(&err)))?;
    match kept {
        Some(events) => paths::spawn_log_keeping(&conn, events),
        None => paths::spawn_log(&conn),
    };
    Ok(conn)
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
            let link = Link::new(phone, loopback_addr(&host));
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
