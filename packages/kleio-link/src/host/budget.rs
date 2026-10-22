//! The pairing budget: at most [`PAIRS_PER_WINDOW`] pairing connections in
//! any [`WINDOW`], one at a time. Only the pairings let in count, so a flood
//! of turned-away attempts doesn't keep the budget used up.

use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::time::Instant;

/// Pairings let in per [`WINDOW`].
pub(crate) const PAIRS_PER_WINDOW: usize = 10;

/// The window [`PAIRS_PER_WINDOW`] counts over.
pub(crate) const WINDOW: Duration = Duration::from_secs(60);

/// The budget, shared by every pairing connection.
#[derive(Debug, Clone, Default)]
pub(crate) struct PairBudget {
    state: Arc<Mutex<State>>,
}

#[derive(Debug, Default)]
struct State {
    /// When each pairing in the last [`WINDOW`] started.
    started: VecDeque<Instant>,
    busy: bool,
}

/// The turn of the one pairing in flight: the next can start once it's
/// dropped.
#[derive(Debug)]
pub(crate) struct PairTurn {
    state: Arc<Mutex<State>>,
}

/// Why a pairing wasn't let in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// Another pairing is in flight.
    Busy,
    /// [`PAIRS_PER_WINDOW`] pairings started in the last [`WINDOW`].
    TooMany,
}

impl Refusal {
    /// The close reason the phone gets.
    pub(crate) fn reason(self) -> &'static [u8] {
        match self {
            Self::Busy => b"another pairing is in flight; try again in a minute",
            Self::TooMany => b"too many pairings in the last minute; try again in a minute",
        }
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy => f.write_str("another pairing is in flight"),
            Self::TooMany => write!(
                f,
                "{PAIRS_PER_WINDOW} pairings in the last {} s",
                WINDOW.as_secs()
            ),
        }
    }
}

impl PairBudget {
    /// The turn to pair, if the budget allows one at `now`.
    pub(crate) fn try_start(&self, now: Instant) -> Result<PairTurn, Refusal> {
        let mut state = lock(&self.state);
        while state
            .started
            .front()
            .is_some_and(|&at| now.duration_since(at) >= WINDOW)
        {
            state.started.pop_front();
        }
        if state.busy {
            return Err(Refusal::Busy);
        }
        if state.started.len() >= PAIRS_PER_WINDOW {
            return Err(Refusal::TooMany);
        }
        state.started.push_back(now);
        state.busy = true;
        Ok(PairTurn {
            state: Arc::clone(&self.state),
        })
    }
}

impl Drop for PairTurn {
    fn drop(&mut self) {
        lock(&self.state).busy = false;
    }
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    // Every update is a few plain assignments, so the state is whole even if
    // a holder panicked.
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn lets_in_ten_pairings_a_minute() {
        let budget = PairBudget::default();
        let start = Instant::now();
        for i in 0..10 {
            drop(
                budget
                    .try_start(start + secs(i))
                    .expect("within the budget"),
            );
        }
        assert_eq!(
            budget.try_start(start + secs(30)).unwrap_err(),
            Refusal::TooMany
        );
        // A minute after the first, there's room for one more.
        drop(
            budget
                .try_start(start + secs(60))
                .expect("the first has aged out"),
        );
        assert_eq!(
            budget.try_start(start + secs(60)).unwrap_err(),
            Refusal::TooMany
        );
        drop(
            budget
                .try_start(start + secs(61))
                .expect("the second has aged out"),
        );
    }

    #[test]
    fn lets_in_one_at_a_time() {
        let budget = PairBudget::default();
        let start = Instant::now();
        let turn = budget.try_start(start).expect("the first");
        assert_eq!(
            budget.try_start(start + secs(1)).unwrap_err(),
            Refusal::Busy
        );
        drop(turn);
        drop(
            budget
                .try_start(start + secs(2))
                .expect("the next, once the first is done"),
        );
    }

    #[test]
    fn turning_one_away_uses_none_of_the_budget() {
        let budget = PairBudget::default();
        let start = Instant::now();
        let turn = budget.try_start(start).expect("the first");
        for i in 1..=20 {
            assert_eq!(
                budget.try_start(start + secs(i)).unwrap_err(),
                Refusal::Busy
            );
        }
        drop(turn);
        // Nine more fit in the minute, which makes ten.
        for i in 21..30 {
            drop(
                budget
                    .try_start(start + secs(i))
                    .expect("within the budget"),
            );
        }
        assert_eq!(
            budget.try_start(start + secs(30)).unwrap_err(),
            Refusal::TooMany
        );
    }

    #[test]
    fn says_why_in_words() {
        assert_eq!(Refusal::Busy.to_string(), "another pairing is in flight");
        assert_eq!(Refusal::TooMany.to_string(), "10 pairings in the last 60 s");
    }
}
