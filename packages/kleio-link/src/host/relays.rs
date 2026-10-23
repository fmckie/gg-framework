//! Which relay the host is on (docs/adr/0002-kleio-link-replaces-tailscale.md).
//!
//! Phones find the host only through the relays its tickets and
//! `GET /kleio/link` name, with no address lookup, and a relay drops what it
//! gets for a key that isn't connected to it. So the host is on exactly one
//! relay at a time, pinned, and changes relay only like this:
//!
//! - The order is kleio-host's relay list (`link/config.json`), where n0's
//!   entry stands for n0's relays, fastest to answer `GET /ping` first.
//! - It starts on the first relay in the order that answers.
//! - After [`FAILOVER_AFTER`] without its home relay, it moves to the first
//!   other relay in the order that answers, and stays put while none does:
//!   then it's this machine's network that's down, not the relay.
//! - On any relay but the first, it asks those ahead of it every
//!   [`PROBE_EVERY`], and moves back to one once it has answered for
//!   [`FAILBACK_AFTER`].
//! - When kleio-host changes the list, it's read again: a relay no longer on
//!   it is left at once, and one now ahead is moved to by the rule above.
//!
//! A probe is one HTTPS `GET /ping` (crate::probe). It asks only what it
//! must: nothing while the host is on its first relay and connected.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use iroh::{Endpoint, RelayUrl, Watcher};
use tokio::time::{Instant, MissedTickBehavior};
use tracing::{error, info, warn};

use super::state::{signature, Signature};
use super::HostError;
use crate::probe::{ping_all, Ping, Probe};
use crate::relays::{every_relay, n0_relays, LinkConfig, RelayEntry};

/// How long the host goes without its home relay before it moves.
pub const FAILOVER_AFTER: Duration = Duration::from_secs(15);

/// How long a relay ahead in the order must answer before the host moves back.
pub const FAILBACK_AFTER: Duration = Duration::from_secs(5 * 60);

/// How often the relays ahead are asked, while the host is on another.
pub const PROBE_EVERY: Duration = Duration::from_secs(30);

/// How often the relay list is checked for a change.
const CONFIG_EVERY: Duration = Duration::from_secs(5);

/// How often the pinning looks at its home relay.
const TICK: Duration = Duration::from_secs(1);

/// Asks each of `relays` at once, and gives each one's answer time, or
/// `None` for one that didn't answer as a relay does.
async fn probe_all<P: Probe>(
    probe: &P,
    relays: Vec<RelayUrl>,
) -> BTreeMap<RelayUrl, Option<Duration>> {
    ping_all(probe, relays)
        .await
        .into_iter()
        .map(|(relay, answer)| {
            let latency = answer.latency();
            if let Ping::NotARelay(why) | Ping::NoAnswer(why) = answer {
                info!("relay: {relay} didn't answer: {why}");
            }
            (relay, latency)
        })
        .collect()
}

/// Every relay `entries` names, n0's for its entry.
fn candidates(entries: &[RelayEntry]) -> Vec<RelayUrl> {
    every_relay(entries)
}

/// The order the host tries relays in: `entries` in order, n0's entry as its
/// relays fastest first, those that didn't answer after them.
fn rank(entries: &[RelayEntry], answers: &BTreeMap<RelayUrl, Option<Duration>>) -> Vec<RelayUrl> {
    let mut order: Vec<RelayUrl> = Vec::new();
    for entry in entries {
        let mut urls = match entry {
            RelayEntry::N0 => n0_relays(),
            RelayEntry::Url(url) => vec![url.clone()],
        };
        let latency = |url: &RelayUrl| answers.get(url).copied().flatten();
        urls.sort_by_key(|url| (latency(url).is_none(), latency(url), url.clone()));
        for url in urls {
            if !order.contains(&url) {
                order.push(url);
            }
        }
    }
    order
}

/// What the host last heard from a relay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Heard {
    /// It has answered every probe since `since`.
    Answering { since: Instant },
    /// Its last probe failed.
    Unreachable,
}

/// Why the host moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Why {
    /// Its home relay was gone for [`FAILOVER_AFTER`].
    Failover,
    /// A relay ahead answered for [`FAILBACK_AFTER`].
    Failback,
    /// kleio-host's list no longer has its relay.
    Dropped,
}

impl Why {
    fn text(self) -> String {
        match self {
            Self::Failover => format!("no home relay for {} s", FAILOVER_AFTER.as_secs()),
            Self::Failback => format!(
                "it's ahead in the list and has answered for {} minutes",
                FAILBACK_AFTER.as_secs() / 60
            ),
            Self::Dropped => "the relay list no longer has the current one".into(),
        }
    }
}

/// A move the pinning decided on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Move {
    pub(crate) to: RelayUrl,
    pub(crate) why: Why,
}

/// The relay the host is pinned to, and the rules for moving. Pure: the
/// times come from the caller.
#[derive(Debug, Clone)]
pub(crate) struct Pinning {
    order: Vec<RelayUrl>,
    heard: BTreeMap<RelayUrl, Heard>,
    current: RelayUrl,
    /// Since when the home relay has been gone; `None` while it's connected.
    down_since: Option<Instant>,
}

impl Pinning {
    /// On the first relay in `order` that `answers` says answered, else on
    /// the first, not yet connected.
    pub(crate) fn start(
        order: Vec<RelayUrl>,
        answers: &BTreeMap<RelayUrl, Option<Duration>>,
        now: Instant,
    ) -> Option<Self> {
        let current = order
            .iter()
            .find(|url| answers.get(*url).copied().flatten().is_some())
            .or_else(|| order.first())?
            .clone();
        let mut pinning = Self {
            order,
            heard: BTreeMap::new(),
            current,
            down_since: Some(now),
        };
        pinning.hear_all(answers, now);
        Some(pinning)
    }

    pub(crate) fn current(&self) -> &RelayUrl {
        &self.current
    }

    pub(crate) fn order(&self) -> &[RelayUrl] {
        &self.order
    }

    fn rank_of(&self, relay: &RelayUrl) -> Option<usize> {
        self.order.iter().position(|url| url == relay)
    }

    /// Whether the home relay is connected now.
    pub(crate) fn home(&mut self, connected: bool, now: Instant) {
        if connected {
            self.down_since = None;
        } else if self.down_since.is_none() {
            self.down_since = Some(now);
        }
    }

    /// Whether the home relay has been gone for [`FAILOVER_AFTER`].
    pub(crate) fn failover_due(&self, now: Instant) -> bool {
        self.down_since
            .is_some_and(|since| now.saturating_duration_since(since) >= FAILOVER_AFTER)
    }

    /// What a probe of `relay` heard: answered or not.
    pub(crate) fn hear(&mut self, relay: &RelayUrl, answered: bool, now: Instant) {
        let heard = match (answered, self.heard.get(relay)) {
            (true, Some(Heard::Answering { since })) => Heard::Answering { since: *since },
            (true, _) => Heard::Answering { since: now },
            (false, _) => Heard::Unreachable,
        };
        self.heard.insert(relay.clone(), heard);
    }

    pub(crate) fn hear_all(
        &mut self,
        answers: &BTreeMap<RelayUrl, Option<Duration>>,
        now: Instant,
    ) {
        for (relay, latency) in answers {
            self.hear(relay, latency.is_some(), now);
        }
    }

    /// The relays ahead of the current one, which failback asks about: all
    /// of them if kleio-host's list no longer has it.
    pub(crate) fn ahead(&self) -> Vec<RelayUrl> {
        let rank = self.rank_of(&self.current).unwrap_or(self.order.len());
        self.order[..rank].to_vec()
    }

    /// Every relay but the current one, which failover asks about.
    pub(crate) fn others(&self) -> Vec<RelayUrl> {
        self.order
            .iter()
            .filter(|url| **url != self.current)
            .cloned()
            .collect()
    }

    fn answering(&self, relay: &RelayUrl) -> Option<Instant> {
        match self.heard.get(relay) {
            Some(Heard::Answering { since }) => Some(*since),
            _ => None,
        }
    }

    /// Where to move now, if anywhere.
    pub(crate) fn decide(&self, now: Instant) -> Option<Move> {
        let Some(rank) = self.rank_of(&self.current) else {
            // Off the list: the first that answers, else the first.
            let to = self
                .order
                .iter()
                .find(|url| self.answering(url).is_some())
                .or_else(|| self.order.first())?;
            return Some(Move {
                to: to.clone(),
                why: Why::Dropped,
            });
        };
        if self.failover_due(now) {
            return self
                .order
                .iter()
                .find(|url| **url != self.current && self.answering(url).is_some())
                .map(|to| Move {
                    to: to.clone(),
                    why: Why::Failover,
                });
        }
        self.order[..rank]
            .iter()
            .find(|url| {
                self.answering(url)
                    .is_some_and(|since| now.saturating_duration_since(since) >= FAILBACK_AFTER)
            })
            .map(|to| Move {
                to: to.clone(),
                why: Why::Failback,
            })
    }

    /// The host is now pinned to `to`, not yet connected.
    pub(crate) fn moved(&mut self, to: RelayUrl, now: Instant) {
        self.current = to;
        self.down_since = Some(now);
    }

    /// kleio-host's new order; the current relay stays until [`decide`](Self::decide) says.
    pub(crate) fn reorder(&mut self, order: Vec<RelayUrl>) {
        self.heard.retain(|relay, _| order.contains(relay));
        self.order = order;
    }

    /// Each relay in order, and how it is, for `link/state.json`: `home`,
    /// `connecting` or `unreachable` for the current one, else `standby` (it
    /// answered), `unreachable` or `untested`.
    pub(crate) fn board(&self, now: Instant) -> Vec<(String, &'static str)> {
        self.order
            .iter()
            .map(|url| {
                let state = if *url == self.current {
                    match self.down_since {
                        None => "home",
                        Some(_) if self.failover_due(now) => "unreachable",
                        Some(_) => "connecting",
                    }
                } else {
                    match self.heard.get(url) {
                        Some(Heard::Answering { .. }) => "standby",
                        Some(Heard::Unreachable) => "unreachable",
                        None => "untested",
                    }
                };
                (url.to_string(), state)
            })
            .collect()
    }
}

/// How each relay is, shared with the state file (report.rs).
#[derive(Debug, Clone, Default)]
pub(crate) struct RelayBoard(Arc<Mutex<Vec<(String, &'static str)>>>);

impl RelayBoard {
    pub(crate) fn set(&self, board: Vec<(String, &'static str)>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = board;
    }

    pub(crate) fn get(&self) -> Vec<(String, &'static str)> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

/// The relay list as the host starts with it: `link/config.json`, or n0's
/// relays alone without the file. One that can't be read is an error: the
/// host doesn't fall back to n0's relays when the list may leave them out.
pub(crate) fn read_config(
    path: &std::path::Path,
) -> Result<(LinkConfig, Option<Signature>), HostError> {
    let read = signature(path).map_err(|err| super::file_error(path, err))?;
    if read.is_none() {
        return Ok((LinkConfig::default(), None));
    }
    let bytes = std::fs::read(path).map_err(|err| super::file_error(path, err))?;
    let config = LinkConfig::parse(&bytes)
        .map_err(|why| HostError::new(format!("{}: {why}", path.display())))?;
    Ok((config, read))
}

/// Where the host starts: every relay in `config` asked at once, n0's
/// ranked, the first that answers chosen.
pub(crate) async fn start<P: Probe>(config: &LinkConfig, probe: &P) -> Pinning {
    let answers = probe_all(probe, candidates(&config.relays)).await;
    let order = rank(&config.relays, &answers);
    let pinning = Pinning::start(order, &answers, Instant::now())
        .expect("a relay list has at least one entry");
    let latency = answers
        .get(pinning.current())
        .copied()
        .flatten()
        .map(|latency| format!("answered in {} ms", latency.as_millis()))
        .unwrap_or_else(|| "none answered yet".into());
    info!(
        "relay: starting on {} ({latency}); order: {}",
        pinning.current(),
        join(pinning.order())
    );
    pinning
}

fn join(relays: &[RelayUrl]) -> String {
    relays
        .iter()
        .map(|url| url.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Keeps the endpoint pinned to the right relay, until it closes.
pub(crate) struct Pinner<P> {
    endpoint: Endpoint,
    probe: P,
    pinning: Pinning,
    board: RelayBoard,
    config_path: std::path::PathBuf,
    entries: Vec<RelayEntry>,
    config_read: Option<Signature>,
    config_error: Option<String>,
    last_config_check: Instant,
    last_ahead_probe: Option<Instant>,
    last_failover_probe: Option<Instant>,
}

impl<P: Probe> Pinner<P> {
    pub(crate) fn new(
        endpoint: Endpoint,
        probe: P,
        pinning: Pinning,
        board: RelayBoard,
        config_path: std::path::PathBuf,
        config: (LinkConfig, Option<Signature>),
    ) -> Self {
        Self {
            endpoint,
            probe,
            pinning,
            board,
            config_path,
            entries: config.0.relays,
            config_read: config.1,
            config_error: None,
            last_config_check: Instant::now(),
            last_ahead_probe: None,
            last_failover_probe: None,
        }
    }

    pub(crate) async fn run(mut self) {
        let mut tick = tokio::time::interval(TICK);
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let endpoint = self.endpoint.clone();
        let closed = endpoint.closed();
        tokio::pin!(closed);
        loop {
            tokio::select! {
                _ = &mut closed => return,
                _ = tick.tick() => self.tick().await,
            }
        }
    }

    async fn tick(&mut self) {
        let now = Instant::now();
        let current = self.pinning.current().clone();
        let connected = self
            .endpoint
            .home_relay_status()
            .get()
            .iter()
            .any(|status| *status.url() == current && status.is_connected());
        self.pinning.home(connected, now);

        if now.saturating_duration_since(self.last_config_check) >= CONFIG_EVERY {
            self.last_config_check = now;
            self.reread_config().await;
        }
        if self.pinning.failover_due(now)
            && self
                .last_failover_probe
                .is_none_or(|at| now.saturating_duration_since(at) >= FAILOVER_AFTER)
        {
            self.last_failover_probe = Some(now);
            let others = self.pinning.others();
            warn!(
                "relay: no home relay for {} s; asking the others",
                FAILOVER_AFTER.as_secs()
            );
            self.ask(others).await;
        }
        let ahead = self.pinning.ahead();
        if !ahead.is_empty()
            && self
                .last_ahead_probe
                .is_none_or(|at| now.saturating_duration_since(at) >= PROBE_EVERY)
        {
            self.last_ahead_probe = Some(now);
            self.ask(ahead).await;
        }
        if let Some(step) = self.pinning.decide(Instant::now()) {
            self.switch(step).await;
        }
        self.board.set(self.pinning.board(Instant::now()));
    }

    async fn ask(&mut self, relays: Vec<RelayUrl>) {
        let answers = probe_all(&self.probe, relays).await;
        self.pinning.hear_all(&answers, Instant::now());
    }

    async fn switch(&mut self, step: Move) {
        let from = self.pinning.current().clone();
        info!(
            "relay: moving from {from} to {}: {}",
            step.to,
            step.why.text()
        );
        let config = Arc::new(iroh::RelayConfig::from(step.to.clone()));
        self.endpoint.insert_relay(step.to.clone(), config).await;
        self.endpoint.remove_relay(&from).await;
        self.pinning.moved(step.to, Instant::now());
        self.last_failover_probe = None;
    }

    /// Reads kleio-host's relay list again if it changed. One that can't be
    /// read leaves the last.
    async fn reread_config(&mut self) {
        let now = match signature(&self.config_path) {
            Ok(now) => now,
            Err(err) => {
                return self.config_failed(format!("{}: {err}", self.config_path.display()))
            }
        };
        if now == self.config_read {
            return;
        }
        let (config, read) = match read_config(&self.config_path) {
            Ok(read) => read,
            Err(err) => return self.config_failed(format!("{err}; keeping the last relay list")),
        };
        self.config_read = read;
        self.config_error = None;
        if config.relays == self.entries {
            return;
        }
        let answers = probe_all(&self.probe, candidates(&config.relays)).await;
        let order = rank(&config.relays, &answers);
        info!("relay: the relay list changed; order: {}", join(&order));
        self.entries = config.relays;
        self.pinning.reorder(order);
        self.pinning.hear_all(&answers, Instant::now());
    }

    fn config_failed(&mut self, text: String) {
        if self.config_error.as_ref() != Some(&text) {
            error!("{text}");
            self.config_error = Some(text);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::future::Future;

    use super::*;
    use crate::relays::check_relay_url;

    fn url(text: &str) -> RelayUrl {
        check_relay_url(text).expect("a relay")
    }

    fn own() -> RelayUrl {
        url("https://relay.example.com/")
    }

    fn other() -> RelayUrl {
        url("https://relay2.example.net:8443/")
    }

    fn answers(list: &[(RelayUrl, Option<u64>)]) -> BTreeMap<RelayUrl, Option<Duration>> {
        list.iter()
            .map(|(url, ms)| (url.clone(), ms.map(Duration::from_millis)))
            .collect()
    }

    /// A probe that answers as `answers` says, after the latency it gives.
    #[derive(Clone)]
    struct FakeProbe(Arc<BTreeMap<RelayUrl, Option<Duration>>>);

    impl Probe for FakeProbe {
        fn ping(&self, relay: RelayUrl) -> impl Future<Output = Ping> + Send {
            let answer = match self.0.get(&relay).copied().flatten() {
                Some(latency) => Ping::Relay(latency),
                None => Ping::NoAnswer("no".into()),
            };
            async move { answer }
        }
    }

    #[tokio::test]
    async fn starts_on_the_first_relay_that_answers_with_n0s_fastest_first() {
        let n0 = n0_relays();
        let mut heard: Vec<(RelayUrl, Option<u64>)> = vec![
            (n0[0].clone(), Some(90)),
            (n0[1].clone(), Some(20)),
            (n0[2].clone(), None),
        ];
        heard.push((n0[3].clone(), Some(40)));
        heard.push((own(), None));
        let probe = FakeProbe(Arc::new(answers(&heard)));
        let config = LinkConfig {
            list_version: 1,
            relays: vec![RelayEntry::Url(own()), RelayEntry::N0],
        };
        let pinning = start(&config, &probe).await;
        assert_eq!(
            pinning.order(),
            [
                own(),
                n0[1].clone(),
                n0[3].clone(),
                n0[0].clone(),
                n0[2].clone()
            ]
        );
        // Its own relay didn't answer, so it starts on n0's fastest.
        assert_eq!(pinning.current(), &n0[1]);
    }

    #[test]
    fn with_nothing_answering_it_starts_on_the_first() {
        let order = vec![own(), other()];
        let pinning = Pinning::start(order, &BTreeMap::new(), Instant::now()).expect("a relay");
        assert_eq!(pinning.current(), &own());
        assert!(Pinning::start(Vec::new(), &BTreeMap::new(), Instant::now()).is_none());
    }

    #[test]
    fn fails_over_after_15_s_only_to_a_relay_that_answers() {
        let t0 = Instant::now();
        let order = vec![own(), other()];
        let mut pinning =
            Pinning::start(order, &answers(&[(own(), Some(10))]), t0).expect("a relay");
        pinning.home(true, t0);
        pinning.home(false, t0 + Duration::from_secs(1));
        assert!(!pinning.failover_due(t0 + Duration::from_secs(15)));
        assert_eq!(pinning.decide(t0 + Duration::from_secs(15)), None);
        let due = t0 + Duration::from_secs(16);
        assert!(pinning.failover_due(due));
        // Nothing else answers: it stays put.
        pinning.hear(&other(), false, due);
        assert_eq!(pinning.decide(due), None);
        pinning.hear(&other(), true, due);
        assert_eq!(
            pinning.decide(due),
            Some(Move {
                to: other(),
                why: Why::Failover
            })
        );
        pinning.moved(other(), due);
        assert_eq!(pinning.current(), &other());
        // The new relay gets its own 15 s to connect.
        assert_eq!(pinning.decide(due + Duration::from_secs(14)), None);
    }

    #[test]
    fn coming_back_within_15_s_isnt_a_failover() {
        let t0 = Instant::now();
        let mut pinning = Pinning::start(vec![own(), other()], &answers(&[(own(), Some(10))]), t0)
            .expect("a relay");
        pinning.hear(&other(), true, t0);
        pinning.home(false, t0);
        pinning.home(true, t0 + Duration::from_secs(10));
        pinning.home(false, t0 + Duration::from_secs(11));
        assert_eq!(pinning.decide(t0 + Duration::from_secs(20)), None);
        assert!(pinning.decide(t0 + Duration::from_secs(26)).is_some());
    }

    #[test]
    fn fails_back_once_the_first_has_answered_for_5_minutes() {
        let t0 = Instant::now();
        let mut pinning =
            Pinning::start(vec![own(), other()], &answers(&[(other(), Some(10))]), t0)
                .expect("a relay");
        assert_eq!(pinning.current(), &other());
        pinning.home(true, t0);
        assert_eq!(pinning.ahead(), [own()]);
        let at = |secs: u64| t0 + Duration::from_secs(secs);
        pinning.hear(&own(), true, at(30));
        pinning.hear(&own(), true, at(60));
        // A missed answer starts the count again.
        pinning.hear(&own(), false, at(90));
        pinning.hear(&own(), true, at(120));
        assert_eq!(pinning.decide(at(119 + 300)), None);
        assert_eq!(
            pinning.decide(at(120 + 300)),
            Some(Move {
                to: own(),
                why: Why::Failback
            })
        );
        pinning.moved(own(), at(420));
        assert!(
            pinning.ahead().is_empty(),
            "nothing is asked on the first relay"
        );
    }

    #[test]
    fn a_list_change_keeps_the_relay_while_its_listed_and_leaves_it_if_not() {
        let t0 = Instant::now();
        let mut pinning = Pinning::start(vec![own(), other()], &answers(&[(own(), Some(10))]), t0)
            .expect("a relay");
        pinning.home(true, t0);
        pinning.reorder(vec![other(), own()]);
        assert_eq!(pinning.current(), &own());
        assert_eq!(
            pinning.decide(t0),
            None,
            "a relay now ahead must answer for 5 minutes first"
        );

        pinning.reorder(vec![other()]);
        assert_eq!(
            pinning.decide(t0),
            Some(Move {
                to: other(),
                why: Why::Dropped
            })
        );
    }

    #[test]
    fn the_board_says_how_each_relay_is() {
        let t0 = Instant::now();
        let third = url("https://relay3.example.org/");
        let mut pinning = Pinning::start(
            vec![own(), other(), third.clone()],
            &answers(&[(own(), Some(10)), (other(), None)]),
            t0,
        )
        .expect("a relay");
        let states = |pinning: &Pinning, now| -> Vec<&'static str> {
            pinning
                .board(now)
                .into_iter()
                .map(|(_, state)| state)
                .collect()
        };
        assert_eq!(
            states(&pinning, t0),
            ["connecting", "unreachable", "untested"]
        );
        pinning.home(true, t0);
        assert_eq!(states(&pinning, t0), ["home", "unreachable", "untested"]);
        pinning.home(false, t0);
        assert_eq!(
            states(&pinning, t0 + FAILOVER_AFTER),
            ["unreachable", "unreachable", "untested"]
        );
        pinning.hear(&third, true, t0);
        assert_eq!(pinning.board(t0)[2], (third.to_string(), "standby"));
    }

    /// Over the internet, so only on request:
    /// `cargo test --features host -- --ignored asks_n0s_relays`.
    #[tokio::test]
    #[ignore = "asks n0's public relays over the internet"]
    async fn asks_n0s_relays_over_the_internet() {
        let probe = crate::probe::HttpsProbe::new(&crate::endpoint::RelayTrust::default())
            .expect("a probe");
        let answers = probe_all(&probe, n0_relays()).await;
        for (relay, latency) in &answers {
            eprintln!("{relay}: {latency:?}");
        }
        assert!(
            answers.values().any(Option::is_some),
            "none of n0's relays answered"
        );
        let missing = probe_all(&probe, vec![url("https://relay.invalid/")]).await;
        assert_eq!(missing.values().next(), Some(&None));
    }

    #[test]
    fn reads_no_file_as_n0s_relays_alone_and_refuses_a_damaged_one() {
        let tmp = crate::testing::TempDir::new("relays-config");
        let path = tmp.path().join("config.json");
        let (config, read) = read_config(&path).expect("reads");
        assert_eq!(config, LinkConfig::default());
        assert!(read.is_none());
        std::fs::write(
            &path,
            r#"{"version":1,"listVersion":2,"relays":["https://relay.example.com/"]}"#,
        )
        .expect("written");
        let (config, read) = read_config(&path).expect("reads");
        assert_eq!(config.relays, [RelayEntry::Url(own())]);
        assert!(read.is_some());
        std::fs::write(&path, r#"{"version":1,"listVersion":2,"relays":[]}"#).expect("written");
        assert!(read_config(&path).is_err());
    }
}
