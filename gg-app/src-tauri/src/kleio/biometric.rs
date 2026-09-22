//! The laptop's local biometric gate (ADR-0002, ported from the old
//! `biometric-gate.ts`).
//!
//! Admin actions against the Kleio host (list devices, mint pair codes, revoke)
//! are allowed only while a Touch ID window is open. The window is tracked on a
//! MONOTONIC clock: rolling the wall clock back cannot re-open or extend it.
//! It fails CLOSED — no Touch ID hardware, or a lockout, means admin is refused
//! rather than silently granted. The host itself only ever verifies bearers;
//! the prompt fires here and only here.
//!
//! Non-macOS builds keep the type so `lib.rs` compiles unchanged; every call
//! reports `Unavailable`.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const WINDOW: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Denied {
    /// No usable biometry right now (no hardware, not enrolled, lockout). Never prompted.
    Unavailable,
    /// Prompted, but the user cancelled or failed to match.
    Denied,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockState {
    pub unlocked: bool,
    /// Wall-clock ms since epoch, display only. Authority is the monotonic deadline.
    pub expires_at: Option<u64>,
    pub available: bool,
}

#[derive(Default)]
pub struct BiometricGate {
    deadline: Mutex<Option<(Instant, u64)>>,
}

impl BiometricGate {
    fn is_open(&self) -> bool {
        matches!(*self.deadline.lock().unwrap(), Some((d, _)) if Instant::now() < d)
    }

    fn open_window(&self) {
        let wall = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
            + WINDOW.as_millis() as u64;
        *self.deadline.lock().unwrap() = Some((Instant::now() + WINDOW, wall));
    }

    pub fn lock(&self) {
        *self.deadline.lock().unwrap() = None;
    }

    pub fn state(&self) -> UnlockState {
        let open = self.is_open();
        UnlockState {
            unlocked: open,
            expires_at: if open {
                self.deadline.lock().unwrap().map(|(_, w)| w)
            } else {
                None
            },
            available: can_prompt(),
        }
    }

    /// Ensure the admin window is open. Prompts only when closed (or when
    /// `force` — the high-risk path). A failed prompt never extends an
    /// existing window.
    pub fn ensure_unlocked(&self, reason: &str, force: bool) -> Result<(), Denied> {
        if !can_prompt() {
            log::warn!("kleio: Touch ID unavailable; refusing admin action");
            return Err(Denied::Unavailable);
        }
        if self.is_open() && !force {
            return Ok(());
        }
        prompt(reason)?;
        self.open_window();
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn can_prompt() -> bool {
    use objc2_local_authentication::{LAContext, LAPolicy};
    // SAFETY: LAContext::new has no preconditions; canEvaluatePolicy_error is a
    // read-only capability probe.
    unsafe {
        let ctx = LAContext::new();
        ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
            .is_ok()
    }
}

#[cfg(target_os = "macos")]
fn prompt(reason: &str) -> Result<(), Denied> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;

    // The reply lands on a private LocalAuthentication queue; bridge it back to
    // this (Tauri blocking-pool) thread with a channel. The context must stay
    // alive until the reply — dropping it cancels the evaluation.
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let block = RcBlock::new(move |ok: Bool, err: *mut NSError| {
        let r = if ok.as_bool() {
            Ok(())
        } else {
            // SAFETY: LocalAuthentication passes either null or a valid NSError.
            Err(unsafe { err.as_ref() }
                .map(|e| e.localizedDescription().to_string())
                .unwrap_or_else(|| "denied".into()))
        };
        let _ = tx.send(r);
    });
    // SAFETY: reason is non-empty (checked by callers via `reason_for`); the
    // block is Send-safe (owns only an mpsc Sender).
    let ctx = unsafe { LAContext::new() };
    unsafe {
        ctx.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &NSString::from_str(reason),
            &block,
        );
    }
    match rx.recv_timeout(Duration::from_secs(90)) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(m)) => {
            log::info!("kleio: Touch ID rejected: {m}");
            Err(Denied::Denied)
        }
        Err(_) => {
            log::warn!("kleio: Touch ID prompt timed out");
            Err(Denied::Denied)
        }
    }
    // ctx dropped here, after the reply.
}

#[cfg(not(target_os = "macos"))]
fn can_prompt() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
fn prompt(_reason: &str) -> Result<(), Denied> {
    Err(Denied::Unavailable)
}

/// Prompt copy: "gg-app is trying to <reason>".
pub fn reason_for(op: Option<&str>) -> String {
    match op {
        Some(op) => format!("authorise \"{op}\" on your Kleio host"),
        None => "authorise admin access to your Kleio host".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_is_closed_by_default_and_after_lock() {
        let g = BiometricGate::default();
        assert!(!g.state().unlocked);
        g.open_window();
        assert!(g.state().unlocked);
        assert!(g.state().expires_at.is_some());
        g.lock();
        assert!(!g.state().unlocked);
        assert_eq!(g.state().expires_at, None);
    }

    #[test]
    fn expired_window_reads_closed() {
        let g = BiometricGate::default();
        *g.deadline.lock().unwrap() = Some((Instant::now() - Duration::from_secs(1), 0));
        assert!(!g.is_open());
    }

    /// Real Touch ID prompt. Run by hand: `cargo test --lib real_touch_id -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_touch_id() {
        let g = BiometricGate::default();
        eprintln!("available: {}", can_prompt());
        let r = g.ensure_unlocked(&reason_for(Some("precheck")), false);
        eprintln!("result: {r:?}; state: {:?}", g.state());
        assert_eq!(r, Ok(()));
        // Second call rides the window: no second prompt.
        assert_eq!(g.ensure_unlocked("x", false), Ok(()));
    }
}
