//! The path log: which way a connection's bytes go (through the relay, or
//! direct), when that changes, and how much each path carries. The field
//! tests' path timelines and relay byte counts come from these lines
//! (`kleio-connection-prototype.md`, "Tests per criterion").
//!
//! Each line names the peer by its key's short form, and says how long after
//! the connection opened it happened, so "relay at the start, then direct
//! after x s" reads straight off the log.
//!
//! A status screen gets the same lines: [`PathEvents`] keeps a link's latest
//! path events (not the numbers every [`STATS_EVERY`]), and [`selected`] says
//! which path a connection's bytes take now.

use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime};

use futures_util::StreamExt;
use iroh::endpoint::{Closed, Connection, Path, PathEvent, PathStats};
use iroh::{RelayUrl, TransportAddr};
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior};
use tracing::{info, warn};

/// How often the log writes each open path's numbers.
pub const STATS_EVERY: Duration = Duration::from_secs(30);

/// One line of the path log, as [`PathEvents`] keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathLine {
    /// When it was written.
    pub at: SystemTime,
    /// The line, as the log has it.
    pub text: String,
}

/// The latest path events of a link's connections, for a status screen such
/// as gg-app's Link card: each connection's opening, its path changes and its
/// close, but not the numbers every [`STATS_EVERY`], which would soon push
/// the events out. Cheap to clone; clones share the list.
#[derive(Debug, Clone)]
pub struct PathEvents {
    keep: usize,
    lines: Arc<Mutex<VecDeque<PathLine>>>,
}

impl PathEvents {
    /// A list that keeps the latest `keep` lines.
    pub fn new(keep: usize) -> Self {
        Self {
            keep,
            lines: Arc::default(),
        }
    }

    /// The lines kept, oldest first.
    pub fn lines(&self) -> Vec<PathLine> {
        self.locked().iter().cloned().collect()
    }

    fn push(&self, text: String) {
        if self.keep == 0 {
            return;
        }
        let mut lines = self.locked();
        while lines.len() >= self.keep {
            lines.pop_front();
        }
        lines.push_back(PathLine {
            at: SystemTime::now(),
            text,
        });
    }

    fn locked(&self) -> MutexGuard<'_, VecDeque<PathLine>> {
        // Every update is one push and its pops, so the list is whole even if
        // a holder panicked.
        self.lines.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The path a connection's bytes take now, for a status screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedPath {
    /// Direct over IP, rather than through the relay.
    pub direct: bool,
    /// The relay's URL, or the direct path's `ip:port`.
    pub addr: String,
    /// Its round-trip time.
    pub rtt: Duration,
}

/// `conn`'s selected path, if one is open.
pub fn selected(conn: &Connection) -> Option<SelectedPath> {
    let list = conn.paths();
    let path = list.iter().find(|path| path.is_selected())?;
    let (direct, addr) = match path.remote_addr() {
        TransportAddr::Relay(url) => (false, url.to_string()),
        TransportAddr::Ip(addr) => (true, addr.to_string()),
        other => (false, other.to_string()),
    };
    Some(SelectedPath {
        direct,
        addr,
        rtt: path.rtt(),
    })
}

/// The relay `conn` came through: its selected path's if that's a relay,
/// else its first open relay path's. `None` for a connection that's direct
/// only.
pub(crate) fn relay_used(conn: &Connection) -> Option<RelayUrl> {
    let list = conn.paths();
    let relays: Vec<(bool, RelayUrl)> = list
        .iter()
        .filter_map(|path| match path.remote_addr() {
            TransportAddr::Relay(url) => Some((path.is_selected(), url.clone())),
            _ => None,
        })
        .collect();
    relays
        .iter()
        .find(|(selected, _)| *selected)
        .or_else(|| relays.first())
        .map(|(_, url)| url.clone())
}

/// Logs `conn`'s open paths now, then each path event and, every
/// [`STATS_EVERY`], each open path's numbers, until the connection closes.
/// The task holds only a weak handle, so it never keeps a connection open.
pub fn spawn_log(conn: &Connection) -> JoinHandle<()> {
    spawn(conn, None)
}

/// [`spawn_log`], keeping the path events in `events` as well.
pub fn spawn_log_keeping(conn: &Connection, events: PathEvents) -> JoinHandle<()> {
    spawn(conn, Some(events))
}

fn spawn(conn: &Connection, kept: Option<PathEvents>) -> JoinHandle<()> {
    let log = Log {
        peer: conn.remote_id().fmt_short().to_string(),
        opened: Instant::now(),
        kept,
    };
    log.event(format_args!("connected: {}", Paths(conn)));
    let events = conn.path_events();
    let weak = conn.weak_handle();
    tokio::spawn(async move {
        let closing = weak.closed();
        tokio::pin!(closing, events);
        let mut stats = tokio::time::interval_at(log.opened + STATS_EVERY, STATS_EVERY);
        // A suspended app misses ticks: one line when it wakes, not a burst.
        stats.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                closed = &mut closing => {
                    log.closed(closed.as_ref());
                    return;
                }
                event = events.next() => match event {
                    Some(event) => log.path_event(&event),
                    None => break,
                },
                _ = stats.tick() => match weak.upgrade() {
                    Some(conn) => log.stats(&conn),
                    None => break,
                },
            }
        }
        // The events have ended, or the last handle has gone: it's closing.
        let closed = closing.await;
        log.closed(closed.as_ref());
    })
}

/// Where one connection's lines go: the log and, if there is one, the kept
/// list. Each line starts with the peer, and how long after the connection
/// opened it was written.
struct Log {
    peer: String,
    opened: Instant,
    kept: Option<PathEvents>,
}

impl Log {
    /// A path event, logged and kept.
    fn event(&self, what: fmt::Arguments<'_>) {
        let line = self.line(what);
        info!("{line}");
        self.keep(line);
    }

    /// A path event that's a warning, logged and kept.
    fn warning(&self, what: fmt::Arguments<'_>) {
        let line = self.line(what);
        warn!("{line}");
        self.keep(line);
    }

    /// The numbers every [`STATS_EVERY`], logged only.
    fn stats(&self, conn: &Connection) {
        info!("{}", self.line(format_args!("stats: {}", Paths(conn))));
    }

    fn path_event(&self, event: &PathEvent) {
        match event {
            PathEvent::Opened { remote_addr, .. } => {
                self.event(format_args!("path opened: {}", Addr(remote_addr)))
            }
            PathEvent::Selected { remote_addr, .. } => {
                self.event(format_args!("path selected: {}", Addr(remote_addr)))
            }
            PathEvent::Closed {
                remote_addr,
                last_stats,
                ..
            } => self.event(format_args!(
                "path closed: {}, {}",
                Addr(remote_addr),
                Traffic(last_stats)
            )),
            PathEvent::Lagged { missed, .. } => {
                self.warning(format_args!("missed {missed} path events"))
            }
            other => self.event(format_args!("path event: {other:?}")),
        }
    }

    fn closed(&self, closed: Option<&Closed>) {
        match closed {
            Some(closed) => self.event(format_args!(
                "connection closed: {}; sent {} B, received {} B",
                closed.reason, closed.stats.udp_tx.bytes, closed.stats.udp_rx.bytes
            )),
            None => self.event(format_args!("connection closed")),
        }
    }

    fn line(&self, what: fmt::Arguments<'_>) -> String {
        format!("{} {} {what}", self.peer, since(self.opened))
    }

    fn keep(&self, line: String) {
        if let Some(kept) = &self.kept {
            kept.push(line);
        }
    }
}

/// `+12.3s`: how long after the connection opened.
fn since(opened: Instant) -> String {
    format!("+{:.1}s", opened.elapsed().as_secs_f64())
}

/// A path's far end: `relay <url>` or `direct <ip:port>`.
struct Addr<'a>(&'a TransportAddr);

impl fmt::Display for Addr<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            TransportAddr::Relay(url) => write!(f, "relay {url}"),
            TransportAddr::Ip(addr) => write!(f, "direct {addr}"),
            other => write!(f, "{other}"),
        }
    }
}

/// A path's numbers: its round-trip time, the bytes each way, and the
/// packets lost.
struct Traffic<'a>(&'a PathStats);

impl fmt::Display for Traffic<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let stats = self.0;
        write!(
            f,
            "rtt {} ms, sent {} B, received {} B, lost {} packets",
            stats.rtt.as_millis(),
            stats.udp_tx.bytes,
            stats.udp_rx.bytes,
            stats.lost_packets
        )
    }
}

/// Every open path of a connection: the selected one first and marked, the
/// rest by address.
struct Paths<'a>(&'a Connection);

impl fmt::Display for Paths<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let list = self.0.paths();
        let mut paths: Vec<Path<'_>> = list.iter().collect();
        if paths.is_empty() {
            return f.write_str("no open path");
        }
        paths.sort_by(|a, b| {
            b.is_selected()
                .cmp(&a.is_selected())
                .then_with(|| a.remote_addr().cmp(b.remote_addr()))
        });
        for (i, path) in paths.iter().enumerate() {
            if i > 0 {
                f.write_str("; ")?;
            }
            write!(f, "{}", Addr(path.remote_addr()))?;
            if path.is_selected() {
                f.write_str(" (selected)")?;
            }
            write!(f, ", {}", Traffic(&path.stats()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use iroh::RelayUrl;

    use super::*;

    fn ip(addr: &str) -> TransportAddr {
        TransportAddr::Ip(addr.parse::<SocketAddr>().unwrap())
    }

    #[test]
    fn says_which_way_a_path_goes() {
        let relay: RelayUrl = "https://euc1-1.relay.n0.iroh.link./".parse().unwrap();
        assert_eq!(
            Addr(&TransportAddr::Relay(relay)).to_string(),
            "relay https://euc1-1.relay.n0.iroh.link./"
        );
        assert_eq!(
            Addr(&ip("203.0.113.5:51234")).to_string(),
            "direct 203.0.113.5:51234"
        );
        assert_eq!(
            Addr(&ip("[2001:db8::5]:51234")).to_string(),
            "direct [2001:db8::5]:51234"
        );
    }

    #[test]
    fn a_direct_path_over_tailscale_is_direct_like_any_other() {
        // Kleio's link is end to end over Tailscale too: nothing to flag.
        assert_eq!(
            Addr(&ip("100.101.102.103:41641")).to_string(),
            "direct 100.101.102.103:41641"
        );
        assert_eq!(
            Addr(&ip("[fd7a:115c:a1e0::5]:41641")).to_string(),
            "direct [fd7a:115c:a1e0::5]:41641"
        );
    }

    #[test]
    fn writes_a_paths_numbers() {
        let mut stats = PathStats::default();
        stats.rtt = Duration::from_millis(18);
        stats.udp_tx.bytes = 1_200;
        stats.udp_rx.bytes = 47_185_920;
        stats.lost_packets = 2;
        assert_eq!(
            Traffic(&stats).to_string(),
            "rtt 18 ms, sent 1200 B, received 47185920 B, lost 2 packets"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn says_how_long_after_the_connection_opened() {
        let opened = Instant::now();
        assert_eq!(since(opened), "+0.0s");
        tokio::time::advance(Duration::from_millis(12_340)).await;
        assert_eq!(since(opened), "+12.3s");
    }

    fn texts(events: &PathEvents) -> Vec<String> {
        events.lines().into_iter().map(|line| line.text).collect()
    }

    #[test]
    fn keeps_the_latest_events_oldest_first() {
        let events = PathEvents::new(3);
        for n in 1..=5 {
            events.push(format!("event {n}"));
        }
        assert_eq!(texts(&events), ["event 3", "event 4", "event 5"]);
    }

    #[test]
    fn clones_share_one_list() {
        let events = PathEvents::new(20);
        events.clone().push("from a clone".into());
        assert_eq!(texts(&events), ["from a clone"]);
    }

    #[test]
    fn keeping_none_keeps_nothing() {
        let events = PathEvents::new(0);
        events.push("event".into());
        assert_eq!(events.lines(), []);
    }
}
