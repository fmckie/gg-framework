//! Housekeeping, once a second:
//!
//! - kleio-host's allow-list and link secret, read again when they change;
//! - each open connection from a key the list no longer lets in, closed;
//! - `link/state.json`, written for kleio-host whenever what it says changes
//!   and at least every [`STATE_EVERY`], so a file older than kleio-host's
//!   90 s means kleio-link-host isn't running (link.ts).
//!
//! ```json
//! {"version":1,"updatedAt":"2026-10-23T12:03:04.567Z","pid":1234,
//!  "key":"<64 hex>","relay":"https://<relay>/" or null,
//!  "pairKey":"<64 hex>","pairRelay":"https://<relay>/" or null,
//!  "addrs":["192.0.2.1:7842"],"rateLimited":false,"connections":1,
//!  "relays":[{"url":"https://<relay>/","state":"home"}],
//!  "peers":[{"key":"<64 hex>","path":"direct","at":"<ISO 8601>"}]}
//! ```
//!
//! `key`, `relay`, `addrs` and the rest are the link endpoint's; `pairKey`
//! and `pairRelay` the pairing endpoint's, which has no address. kleio-host
//! puts those two in a QR code's ticket, and `addrs` only in what an
//! allowed device can ask for.

use std::cmp::Reverse;
use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use iroh::{Endpoint, EndpointId, Watcher};
use serde::Serialize;
use tokio::time::{Instant, MissedTickBehavior};
use tracing::{error, info};

use super::gate::AllowList;
use super::open::OpenLinks;
use super::relays::RelayBoard;
use super::state::{iso8601, signature, HostDir, Signature};
use super::upstream::Upstream;
use crate::endpoint::RateLimitWatch;
use crate::paths;

/// How often housekeeping runs.
pub(crate) const TICK: Duration = Duration::from_secs(1);

/// The longest the state file goes unwritten.
pub(crate) const STATE_EVERY: Duration = Duration::from_secs(30);

/// Direct addresses in the state file (kleio-host's MAX_INFO_ADDRS).
const MAX_ADDRS: usize = 8;

/// Devices in the state file (kleio-host's MAX_PEERS).
const MAX_PEERS: usize = 64;

/// What the state file says, apart from when and by whom.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    key: String,
    relay: Option<String>,
    pair_key: String,
    pair_relay: Option<String>,
    addrs: Vec<String>,
    rate_limited: bool,
    connections: usize,
    relays: Vec<RelayHealth>,
    peers: Vec<Peer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct RelayHealth {
    url: String,
    /// `home` (connected), `connecting` or `unreachable` for the relay the
    /// host is on; `standby` (it answered), `unreachable` or `untested` for
    /// the others.
    state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct Peer {
    key: String,
    /// `direct` or `relay`.
    path: &'static str,
    /// When its connection took that path.
    at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateFile<'a> {
    version: u32,
    updated_at: String,
    pid: u32,
    #[serde(flatten)]
    report: &'a Report,
}

/// The path a device's connection last took.
#[derive(Debug, Clone, Copy)]
struct Seen {
    serial: u64,
    direct: bool,
    at: SystemTime,
}

pub(crate) struct Housekeeper {
    endpoint: Endpoint,
    pairing: Endpoint,
    dir: HostDir,
    allow: Arc<AllowList>,
    upstream: Arc<Upstream>,
    open: OpenLinks,
    token_read: Option<Signature>,
    rate: RateLimitWatch,
    peers: BTreeMap<EndpointId, Seen>,
    written: Option<(Report, Instant)>,
    /// The last error of each kind, so each is logged once, not every second.
    errors: BTreeMap<&'static str, String>,
    /// How each relay in the list is (relays.rs); `None` when `--relay` pins one.
    board: Option<RelayBoard>,
}

impl Housekeeper {
    pub(crate) fn new(
        (endpoint, pairing): (Endpoint, Endpoint),
        dir: HostDir,
        allow: Arc<AllowList>,
        upstream: Arc<Upstream>,
        open: OpenLinks,
    ) -> Self {
        let token_read = signature(&dir.token_path()).ok().flatten();
        Self {
            endpoint,
            pairing,
            dir,
            allow,
            upstream,
            open,
            token_read,
            rate: RateLimitWatch::default(),
            peers: BTreeMap::new(),
            written: None,
            errors: BTreeMap::new(),
            board: None,
        }
    }

    /// Reports each relay's state from `board`, rather than only the pinned one.
    pub(crate) fn with_relays(mut self, board: Option<RelayBoard>) -> Self {
        self.board = board;
        self
    }

    /// Runs until either endpoint closes.
    pub(crate) async fn run(mut self) {
        let mut tick = tokio::time::interval(TICK);
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let (endpoint, pairing) = (self.endpoint.clone(), self.pairing.clone());
        let closed = endpoint.closed();
        let pairing_closed = pairing.closed();
        tokio::pin!(closed, pairing_closed);
        loop {
            tokio::select! {
                _ = &mut closed => return,
                _ = &mut pairing_closed => return,
                _ = tick.tick() => self.tick(Instant::now(), SystemTime::now()),
            }
        }
    }

    fn tick(&mut self, now: Instant, wall: SystemTime) {
        match self.allow.refresh() {
            Ok(true) => {
                self.clear("allow");
                info!("allow-list read again: {} keys", self.allow.len());
            }
            Ok(false) => {}
            Err(err) => self.report_error("allow", format!("{err}; keeping the last list")),
        }
        // Every tick, not only when the list changed here: a pairing reads
        // it again too.
        self.open.close_unwelcome(&self.allow);
        self.refresh_token();
        let report = self.report(wall);
        let due = match &self.written {
            None => true,
            Some((last, at)) => *last != report || now.duration_since(*at) >= STATE_EVERY,
        };
        if due {
            let file = StateFile {
                version: 1,
                updated_at: iso8601(wall),
                pid: std::process::id(),
                report: &report,
            };
            let mut bytes = serde_json::to_vec_pretty(&file).expect("the state serializes");
            bytes.push(b'\n');
            match self.dir.write_state(&bytes) {
                Ok(()) => {
                    self.clear("state");
                    self.written = Some((report, now));
                }
                Err(err) => self.report_error("state", err.to_string()),
            }
        }
    }

    /// Takes kleio-host's new link secret, if it made one.
    fn refresh_token(&mut self) {
        let path = self.dir.token_path();
        let now = signature(&path).ok().flatten();
        if now == self.token_read {
            return;
        }
        match self.dir.upstream_token() {
            Ok(token) => {
                self.upstream.set_secret(token);
                self.token_read = now;
                self.clear("token");
                info!("kleio-host's link secret changed; using the new one");
            }
            Err(err) => self.report_error("token", format!("{err}; keeping the last secret")),
        }
    }

    fn report(&mut self, wall: SystemTime) -> Report {
        let statuses = self.endpoint.home_relay_status().get();
        let relay = statuses
            .iter()
            .find(|status| status.is_connected())
            .map(|status| status.url().to_string());
        let pair_relay = home_relay(&self.pairing);
        let relays = match &self.board {
            Some(board) => board
                .get()
                .into_iter()
                .map(|(url, state)| RelayHealth { url, state })
                .collect(),
            None => statuses
                .iter()
                .map(|status| RelayHealth {
                    url: status.url().to_string(),
                    state: if status.is_connected() {
                        "home"
                    } else if status.last_error().is_some() {
                        "unreachable"
                    } else {
                        "connecting"
                    },
                })
                .collect(),
        };
        let rate_limited = self.rate.sample_endpoint(&self.endpoint);
        let live = self.open.live();
        for (key, serial, conn) in &live {
            let Some(direct) = paths::selected(conn).map(|path| path.direct) else {
                continue;
            };
            let changed = self
                .peers
                .get(key)
                .is_none_or(|seen| seen.serial != *serial || seen.direct != direct);
            if changed {
                let at = wall;
                self.peers.insert(
                    *key,
                    Seen {
                        serial: *serial,
                        direct,
                        at,
                    },
                );
            }
        }
        let mut peers: Vec<(EndpointId, Seen)> =
            self.peers.iter().map(|(key, seen)| (*key, *seen)).collect();
        peers.sort_by_key(|(key, seen)| (Reverse(seen.at), *key));
        peers.truncate(MAX_PEERS);
        self.peers = peers.iter().copied().collect();
        Report {
            key: self.endpoint.id().to_string(),
            relay,
            pair_key: self.pairing.id().to_string(),
            pair_relay,
            addrs: ranked_addrs(self.endpoint.addr().ip_addrs().copied()),
            rate_limited,
            connections: live.len(),
            relays,
            peers: peers
                .into_iter()
                .map(|(key, seen)| Peer {
                    key: key.to_string(),
                    path: if seen.direct { "direct" } else { "relay" },
                    at: iso8601(seen.at),
                })
                .collect(),
        }
    }

    fn report_error(&mut self, kind: &'static str, text: String) {
        if self.errors.get(kind) != Some(&text) {
            error!("{text}");
            self.errors.insert(kind, text);
        }
    }

    fn clear(&mut self, kind: &'static str) {
        self.errors.remove(kind);
    }
}

/// The relay `endpoint` is connected to, if any.
fn home_relay(endpoint: &Endpoint) -> Option<String> {
    endpoint
        .home_relay_status()
        .get()
        .iter()
        .find(|status| status.is_connected())
        .map(|status| status.url().to_string())
}

/// The addresses a phone could dial, best first: public IPv4, then private
/// IPv4 (a phone on the same network), then IPv6, at most [`MAX_ADDRS`].
/// Loopback, link-local, multicast and Tailscale addresses are left out.
fn ranked_addrs(addrs: impl Iterator<Item = SocketAddr>) -> Vec<String> {
    let mut ranked: Vec<(u8, SocketAddr)> = addrs
        .filter_map(|addr| {
            let ip = addr.ip().to_canonical();
            let rank = match ip {
                _ if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() => return None,
                _ if is_tailscale(ip) || addr.port() == 0 => return None,
                IpAddr::V4(v4) if v4.is_link_local() || v4.is_broadcast() => return None,
                IpAddr::V4(v4) if v4.is_private() => 1,
                IpAddr::V4(_) => 0,
                IpAddr::V6(v6) if v6.segments()[0] & 0xffc0 == 0xfe80 => return None,
                IpAddr::V6(v6) if v6.segments()[0] & 0xfe00 == 0xfc00 => 3,
                IpAddr::V6(_) => 2,
            };
            Some((rank, SocketAddr::new(ip, addr.port())))
        })
        .collect();
    ranked.sort();
    ranked.dedup();
    ranked
        .into_iter()
        .take(MAX_ADDRS)
        .map(|(_, addr)| addr.to_string())
        .collect()
}

/// Tailscale's address ranges: `100.64.0.0/10` and `fd7a:115c:a1e0::/48`.
fn is_tailscale(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(v4) => {
            let [first, second, ..] = v4.octets();
            first == 100 && second & 0xc0 == 0x40
        }
        IpAddr::V6(v6) => {
            let [a, b, c, ..] = v6.segments();
            [a, b, c] == [0xfd7a, 0x115c, 0xa1e0]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_tailscales_ranges() {
        for addr in [
            "100.64.0.0",
            "100.100.100.100",
            "100.127.255.255",
            "::ffff:100.64.0.1",
            "fd7a:115c:a1e0::1",
            "fd7a:115c:a1e0:ffff:ffff:ffff:ffff:ffff",
        ] {
            assert!(is_tailscale(addr.parse().unwrap()), "{addr}");
        }
        for addr in [
            "100.63.255.255",
            "100.128.0.0",
            "10.0.0.1",
            "192.168.1.10",
            "::ffff:192.168.1.10",
            "fd7a:115c:a1e1::1",
            "fd7b:115c:a1e0::1",
            "::1",
            "2001:db8::1",
        ] {
            assert!(!is_tailscale(addr.parse().unwrap()), "{addr}");
        }
    }

    #[test]
    fn ranks_the_addresses_a_phone_could_dial() {
        let addrs = [
            "[fd00::5]:7842",
            "127.0.0.1:7842",
            "100.101.102.103:7842",
            "192.168.1.20:52043",
            "[2001:db8::7]:7842",
            "203.0.113.7:7842",
            "169.254.1.1:7842",
            "[fe80::1]:7842",
            "[fd7a:115c:a1e0::1]:7842",
            "[::ffff:10.0.0.2]:7842",
            "0.0.0.0:7842",
            "203.0.113.7:7842",
            "198.51.100.1:0",
        ]
        .map(|text| text.parse::<SocketAddr>().expect("an address"));
        assert_eq!(
            ranked_addrs(addrs.into_iter()),
            [
                "203.0.113.7:7842",
                "10.0.0.2:7842",
                "192.168.1.20:52043",
                "[2001:db8::7]:7842",
                "[fd00::5]:7842",
            ]
        );
        let many = (1..=20).map(|n| SocketAddr::from(([203, 0, 113, n], 7842)));
        assert_eq!(ranked_addrs(many).len(), MAX_ADDRS);
    }
}
