//! Switching a device paired by address (over Tailscale, `remote.json`) to
//! Kleio's link (step 47), and putting the old pairing away afterwards.
//!
//! - **The switch** is a link pairing, as any is (`link::kleio_link_pair`),
//!   with `remote.json` left as it was. A device that's an admin now mints its
//!   own admin code, so it stays an admin; any other scans or pastes a code
//!   from an admin device (the Connection page).
//! - **The old pairing goes only after the first good link session:** a
//!   request answered over the link with the link pairing's token
//!   (`GET /kleio/link`, `link::is_good_session`), kept in `switch.json`
//!   ([`note_good_session`]). Then, in this order:
//!   1. `DELETE /kleio/devices/self` with the old token, at the old pairing's
//!      own address (the host takes that token only off the link, by design);
//!   2. the old Keychain items;
//!   3. `remote.json`, last, so a retry after any failure still finds the old
//!      pairing and finishes the job.
//! - **Only a 200 or a 404 means the host has dropped it.** Its 401 (or no
//!   token here to ask with) keeps the old pairing, as [`Cleanup::WaitingForHost`]
//!   with `refused`, which no retry can change: the Connection page then offers
//!   to remove it here ([`kleio_switch_remove_old`]).
//! - **The host's answer is kept** (`forgotOnHost` in `switch.json`) before
//!   the local steps. Its token is revoked once the host has dropped it, so a
//!   retry's `DELETE` would get a 401: a retry after the host answered skips
//!   it, and does only what's left here.
//! - **When it runs:** at launch, and each time the link connects
//!   ([`run`], one at a time). A failure stops it where it is, and the next run
//!   carries on from there. The link pairing is never touched. So a switch
//!   that fails, is cancelled or never reaches the host leaves the old pairing
//!   working, and a cleanup cut short is finished by the next run.
//! - **What it's waiting for** shows on the Connection page
//!   ([`kleio_switch_status`]).
//!
//! `switch.json` names pairings by host and device id, so a mark from an
//! earlier pairing is inert: it never counts for a newer one.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Duration;

use super::store::HostRecord;
use super::{commands, keychain, link, store, Transport, DEVICE_TOKEN_HEADER};

/// How long the old pairing's `DELETE` waits for the host at its address.
const DELETE_TIMEOUT: Duration = Duration::from_secs(15);

/// What this device is called in the words shown.
const DEVICE: &str = if cfg!(target_os = "ios") {
    "iPhone"
} else {
    "Mac"
};

/// The cleanup's record, beside `link.json`.
pub fn path(home: &Path) -> PathBuf {
    super::state_dir(home).join("switch.json")
}

/// What `switch.json` keeps.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchState {
    /// The link pairing that has had a good session: the old pairing may go.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub good_session: Option<Mark>,
    /// The old pairing the host has dropped (it answered 200 or 404).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forgot_on_host: Option<Mark>,
}

/// A pairing, by host and device id, and when it was marked.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub host: String,
    pub device_id: String,
    /// ISO-8601, display only.
    pub at: String,
}

impl Mark {
    fn now(host: &str, device_id: &str) -> Self {
        Self {
            host: host.to_string(),
            device_id: device_id.to_string(),
            at: commands::now_iso(),
        }
    }

    fn names(&self, host: &str, device_id: &str) -> bool {
        self.host == host && self.device_id == device_id
    }
}

/// The link pairing, as the cleanup needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkPairing {
    pub host: String,
    pub device_id: String,
}

/// What the host said to the old pairing's `DELETE`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostAnswer {
    /// It no longer lists it: a 200, or a 404.
    Gone,
    /// It can't be asked to drop it, now or by trying again: a 401, or no
    /// token here to ask with. Why, in words to show.
    Refused(String),
    /// Not now: it wasn't reached, or answered something else. Why.
    Failed(String),
}

/// How a run of the cleanup ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cleanup {
    /// Nothing to do: no old pairing, no link pairing, or one to another host.
    Nothing,
    /// The link pairing hasn't had a good session yet: the old pairing stays.
    WaitingForLink,
    /// The host hasn't dropped the old pairing: it stays here. `refused`: no
    /// retry can change that.
    WaitingForHost { reason: String, refused: bool },
    /// The host has dropped it, but something here couldn't be removed: the
    /// next run does what's left.
    Unfinished(String),
    /// The old pairing is gone, on the host and here.
    Done,
}

/// The old pairing's record on the host.
pub trait OldHost {
    /// `DELETE /kleio/devices/self` with the old pairing's token, at its own
    /// address ([`answer_from_status`]).
    fn forget_self(&self, old: &HostRecord) -> impl Future<Output = HostAnswer> + Send;
}

/// This device's pairings and `switch.json` (`Disk`; a fake in tests, to cut
/// a step short).
pub trait Local {
    fn link_pairing(&self) -> Option<LinkPairing>;
    fn old_pairing(&self) -> Option<HostRecord>;
    fn state(&self) -> SwitchState;
    fn keep_state(&self, state: &SwitchState) -> Result<(), String>;
    fn remove_old_secrets(&self, host: &str) -> Result<(), String>;
    fn remove_old_record(&self) -> Result<(), String>;
}

/// The old pairing, when there's a link pairing to the same host to replace
/// it, and whether that link pairing has had its good session.
fn replaced(local: &impl Local) -> Option<(HostRecord, LinkPairing, bool)> {
    let old = local.old_pairing()?;
    let link = local.link_pairing()?;
    // A link pairing to another host doesn't replace this one.
    if link.host != old.host || link.device_id == old.device_id {
        return None;
    }
    let good = local
        .state()
        .good_session
        .is_some_and(|m| m.names(&link.host, &link.device_id));
    Some((old, link, good))
}

/// One run of the cleanup, in the order the module says, stopping at the
/// first step that doesn't happen.
pub async fn step(local: &impl Local, old_host: &impl OldHost) -> Cleanup {
    let Some((old, _link, good)) = replaced(local) else {
        return Cleanup::Nothing;
    };
    if !good {
        return Cleanup::WaitingForLink;
    }
    let mut state = local.state();
    let answered = state
        .forgot_on_host
        .as_ref()
        .is_some_and(|m| m.names(&old.host, &old.device_id));
    if !answered {
        match old_host.forget_self(&old).await {
            HostAnswer::Gone => {
                state.forgot_on_host = Some(Mark::now(&old.host, &old.device_id));
                // Kept for a retry; without it this run still carries on.
                if let Err(e) = local.keep_state(&state) {
                    log::warn!("kleio-switch: couldn't keep the host's answer: {e}");
                }
            }
            HostAnswer::Refused(reason) => {
                return Cleanup::WaitingForHost {
                    reason,
                    refused: true,
                }
            }
            HostAnswer::Failed(reason) => {
                return Cleanup::WaitingForHost {
                    reason,
                    refused: false,
                }
            }
        }
    }
    if let Err(e) = local.remove_old_secrets(&old.host) {
        return Cleanup::Unfinished(format!("its Keychain items couldn't be removed: {e}"));
    }
    if let Err(e) = local.remove_old_record() {
        return Cleanup::Unfinished(format!("remote.json couldn't be removed: {e}"));
    }
    // Done: the marks have done their work.
    if let Err(e) = local.keep_state(&SwitchState::default()) {
        log::warn!("kleio-switch: couldn't clear switch.json: {e}");
    }
    Cleanup::Done
}

/// What a `DELETE /kleio/devices/self` status means. Only a 200 or a 404 is
/// the host having dropped it: a 401 may be a token it never had, so the
/// pairing stays.
pub fn answer_from_status(status: u16) -> HostAnswer {
    match status {
        200 | 404 => HostAnswer::Gone,
        401 => HostAnswer::Refused(format!(
            "The host didn't take this {DEVICE}'s old pairing's token (HTTP 401): it may have been revoked already, or it doesn't match."
        )),
        status => HostAnswer::Failed(format!("the host answered HTTP {status}")),
    }
}

/// The old pairing's own address, over Tailscale or the user's network.
pub struct AtItsAddress;

impl OldHost for AtItsAddress {
    fn forget_self(&self, old: &HostRecord) -> impl Future<Output = HostAnswer> + Send {
        let base = old.base_url.clone();
        let token = keychain::get(&old.host, keychain::Secret::DeviceToken);
        async move {
            let token = match token {
                Ok(Some(token)) => token,
                Ok(None) => {
                    return HostAnswer::Refused(format!(
                        "This {DEVICE} has no token for its old pairing, so the host can't be asked to drop it."
                    ))
                }
                Err(e) => return HostAnswer::Failed(e),
            };
            let client = match commands::host_client(&Transport::Url)
                .timeout(DELETE_TIMEOUT)
                .build()
            {
                Ok(client) => client,
                Err(e) => return HostAnswer::Failed(e.to_string()),
            };
            match client
                .delete(format!("{base}/kleio/devices/self"))
                .header(DEVICE_TOKEN_HEADER, token)
                .send()
                .await
            {
                Ok(res) => answer_from_status(res.status().as_u16()),
                Err(e) => HostAnswer::Failed(format!(
                    "couldn't reach it at {base}: {}",
                    commands::root_cause(&e)
                )),
            }
        }
    }
}

/// This device's own files and Keychain.
pub struct Disk {
    pub home: PathBuf,
}

impl Local for Disk {
    fn link_pairing(&self) -> Option<LinkPairing> {
        link::paired_record(&self.home).map(|r| LinkPairing {
            host: r.host,
            device_id: r.device_id,
        })
    }

    fn old_pairing(&self) -> Option<HostRecord> {
        store::load(&self.home)
    }

    fn state(&self) -> SwitchState {
        load(&self.home)
    }

    fn keep_state(&self, state: &SwitchState) -> Result<(), String> {
        if *state == SwitchState::default() {
            clear(&self.home)
        } else {
            save(&self.home, state)
        }
    }

    fn remove_old_secrets(&self, host: &str) -> Result<(), String> {
        keychain::delete(host, keychain::Secret::DeviceToken)?;
        keychain::delete(host, keychain::Secret::ControlCredential)
    }

    fn remove_old_record(&self) -> Result<(), String> {
        store::clear(&self.home)
    }
}

/// Reads `switch.json`: absent, or unreadable, is nothing marked.
pub fn load(home: &Path) -> SwitchState {
    std::fs::read_to_string(path(home))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Write-then-rename, as `store::save` does.
pub fn save(home: &Path, state: &SwitchState) -> Result<(), String> {
    let p = path(home);
    let dir = p.parent().ok_or("no parent dir")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".kleio-switch.{}.tmp", std::process::id()));
    let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn clear(home: &Path) -> Result<(), String> {
    match std::fs::remove_file(path(home)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Keeps that the link pairing `device_id` on `host` has had a good session,
/// when there's an old pairing to the same host for it to replace. `true` if
/// that's new.
pub fn note_good_session(local: &impl Local, host: &str, device_id: &str) -> Result<bool, String> {
    let Some(old) = local.old_pairing() else {
        return Ok(false);
    };
    // Only for the link pairing on disk, the one a cleanup would leave: a
    // session of one forgotten or replaced since this launch began isn't it.
    let on_disk = local
        .link_pairing()
        .is_some_and(|l| l.host == host && l.device_id == device_id);
    if !on_disk || old.host != host || old.device_id == device_id {
        return Ok(false);
    }
    let mut state = local.state();
    if state
        .good_session
        .as_ref()
        .is_some_and(|m| m.names(host, device_id))
    {
        return Ok(false);
    }
    state.good_session = Some(Mark::now(host, device_id));
    local.keep_state(&state)?;
    Ok(true)
}

/// One run at a time: at launch and on each new link connection they can meet.
fn one_at_a_time() -> &'static tokio::sync::Mutex<()> {
    static RUN: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    RUN.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// How the latest run ended, for [`kleio_switch_status`].
static LAST: Mutex<Option<Cleanup>> = Mutex::new(None);

fn last() -> std::sync::MutexGuard<'static, Option<Cleanup>> {
    LAST.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A run of the cleanup on this device (`link::setup` at launch, and after
/// each good link session).
pub async fn run(home: PathBuf) {
    let _one = one_at_a_time().lock().await;
    let done = step(&Disk { home }, &AtItsAddress).await;
    match &done {
        Cleanup::Nothing => {}
        Cleanup::WaitingForLink => log::info!(
            "kleio-switch: the pairing by address stays until the link has had a good session"
        ),
        Cleanup::WaitingForHost { reason, refused } => log::warn!(
            "kleio-switch: the host hasn't dropped the pairing by address{}: {reason}",
            if *refused { ", and won't be asked again" } else { "" }
        ),
        Cleanup::Unfinished(e) => log::warn!(
            "kleio-switch: the host has dropped the pairing by address, but {e}; the next run finishes it"
        ),
        Cleanup::Done => log::info!(
            "kleio-switch: removed the pairing by address, on the host and here: the link replaces it"
        ),
    }
    *last() = Some(done);
}

/// After a good link session in this launch (`link::refresh_route`): keep
/// it, then run the cleanup.
pub fn after_good_session(host: &str, device_id: &str) {
    let home = crate::home_dir();
    match note_good_session(&Disk { home: home.clone() }, host, device_id) {
        Ok(true) => log::info!(
            "kleio-switch: the link has had its good session, so the pairing by address can go"
        ),
        Ok(false) => {}
        Err(e) => log::warn!("kleio-switch: couldn't keep the link's good session: {e}"),
    }
    tauri::async_runtime::spawn(run(home));
}

/// What `kleio_switch_status` says.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchView {
    /// `none`, `waiting-for-link`, `pending`, `waiting-for-host`, `refused`
    /// or `unfinished`.
    pub state: &'static str,
    pub reason: Option<String>,
}

fn view(local: &impl Local, last: Option<&Cleanup>) -> SwitchView {
    let say = |state: &'static str, reason: Option<&String>| SwitchView {
        state,
        reason: reason.cloned(),
    };
    match replaced(local) {
        None => say("none", None),
        Some((_, _, false)) => say("waiting-for-link", None),
        Some((_, _, true)) => match last {
            Some(Cleanup::WaitingForHost {
                reason,
                refused: true,
            }) => say("refused", Some(reason)),
            Some(Cleanup::WaitingForHost { reason, .. }) => say("waiting-for-host", Some(reason)),
            Some(Cleanup::Unfinished(reason)) => say("unfinished", Some(reason)),
            _ => say("pending", None),
        },
    }
}

/// Where the switch's cleanup is, for the Connection page.
#[tauri::command]
pub fn kleio_switch_status() -> SwitchView {
    let last = last().clone();
    view(
        &Disk {
            home: crate::home_dir(),
        },
        last.as_ref(),
    )
}

/// Removes the old pairing here only, when the host won't drop it (a 401):
/// its Keychain items, then `remote.json`. Only once the link has had its
/// good session, so this device always keeps a working pairing. The host
/// lists the old device until an admin revokes it, as after Forget host.
#[tauri::command]
pub async fn kleio_switch_remove_old() -> Result<(), String> {
    let _one = one_at_a_time().lock().await;
    let local = Disk {
        home: crate::home_dir(),
    };
    let done = remove_here(&local)?;
    *last() = Some(done);
    Ok(())
}

fn remove_here(local: &impl Local) -> Result<Cleanup, String> {
    match replaced(local) {
        None => Err("There's no old pairing to remove.".to_string()),
        Some((_, _, false)) => Err(format!(
            "Kleio's link hasn't reached the host yet, so this {DEVICE}'s pairing over Tailscale stays as the way back."
        )),
        Some((old, _, true)) => {
            local.remove_old_secrets(&old.host)?;
            local.remove_old_record()?;
            if let Err(e) = local.keep_state(&SwitchState::default()) {
                log::warn!("kleio-switch: couldn't clear switch.json: {e}");
            }
            log::info!("kleio-switch: removed the pairing by address here, as asked");
            Ok(Cleanup::Done)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::rc::Rc;

    const HOST: &str = "mac-mini-1.tail0000.ts.net";

    /// What happened, in order, to this device and the host.
    type Journal = Rc<RefCell<Vec<&'static str>>>;

    fn old_pairing() -> HostRecord {
        HostRecord {
            base_url: "https://mac-mini-1.tail0000.ts.net:8443".into(),
            host: HOST.into(),
            device_id: "d-tailscale".into(),
            label: "Laptop".into(),
            admin: true,
            paired_at: "2026-09-22T21:46:51Z".into(),
            preview_origin: None,
        }
    }

    fn link_pairing(device_id: &str) -> LinkPairing {
        LinkPairing {
            host: HOST.into(),
            device_id: device_id.into(),
        }
    }

    /// This device: its pairings, `switch.json`, and steps set to fail.
    struct Here {
        journal: Journal,
        link: RefCell<Option<LinkPairing>>,
        old: RefCell<Option<HostRecord>>,
        /// The old pairing's Keychain items are here.
        secrets: Cell<bool>,
        state: RefCell<SwitchState>,
        /// How many removals of the Keychain items, or of remote.json, fail.
        fail_secrets: Cell<u32>,
        fail_record: Cell<u32>,
    }

    impl Here {
        /// A device paired by address, with no link pairing yet.
        fn by_address(journal: &Journal) -> Self {
            Here {
                journal: journal.clone(),
                link: RefCell::new(None),
                old: RefCell::new(Some(old_pairing())),
                secrets: Cell::new(true),
                state: RefCell::new(SwitchState::default()),
                fail_secrets: Cell::new(0),
                fail_record: Cell::new(0),
            }
        }

        /// ...that has paired over the link as `device_id`.
        fn switched(journal: &Journal, device_id: &str) -> Self {
            let here = Here::by_address(journal);
            *here.link.borrow_mut() = Some(link_pairing(device_id));
            here
        }

        /// The old pairing, here: its record and its Keychain items.
        fn has_old_pairing(&self) -> (bool, bool) {
            (self.old.borrow().is_some(), self.secrets.get())
        }
    }

    impl Local for Here {
        fn link_pairing(&self) -> Option<LinkPairing> {
            self.link.borrow().clone()
        }
        fn old_pairing(&self) -> Option<HostRecord> {
            self.old.borrow().clone()
        }
        fn state(&self) -> SwitchState {
            self.state.borrow().clone()
        }
        fn keep_state(&self, state: &SwitchState) -> Result<(), String> {
            *self.state.borrow_mut() = state.clone();
            self.journal.borrow_mut().push("keep switch.json");
            Ok(())
        }
        fn remove_old_secrets(&self, host: &str) -> Result<(), String> {
            assert_eq!(host, HOST);
            if self.fail_secrets.get() > 0 {
                self.fail_secrets.set(self.fail_secrets.get() - 1);
                return Err("the Keychain is locked".into());
            }
            self.secrets.set(false);
            self.journal.borrow_mut().push("remove the Keychain items");
            Ok(())
        }
        fn remove_old_record(&self) -> Result<(), String> {
            if self.fail_record.get() > 0 {
                self.fail_record.set(self.fail_record.get() - 1);
                return Err("permission denied".into());
            }
            *self.old.borrow_mut() = None;
            self.journal.borrow_mut().push("remove remote.json");
            Ok(())
        }
    }

    /// The host, as the real one answers: once it has dropped the old
    /// pairing, that pairing's token is revoked, so it answers 401 after.
    struct Host {
        journal: Journal,
        /// What it answers first, in order; then that it's gone.
        answers: RefCell<VecDeque<HostAnswer>>,
        asked: Cell<u32>,
        dropped: Cell<bool>,
    }

    impl Host {
        fn new(journal: &Journal, answers: Vec<HostAnswer>) -> Self {
            Host {
                journal: journal.clone(),
                answers: RefCell::new(answers.into()),
                asked: Cell::new(0),
                dropped: Cell::new(false),
            }
        }
    }

    impl OldHost for Host {
        fn forget_self(&self, old: &HostRecord) -> impl Future<Output = HostAnswer> + Send {
            assert_eq!(old.device_id, "d-tailscale");
            self.asked.set(self.asked.get() + 1);
            self.journal.borrow_mut().push("DELETE /kleio/devices/self");
            let answer = if self.dropped.get() {
                answer_from_status(401)
            } else {
                self.answers
                    .borrow_mut()
                    .pop_front()
                    .unwrap_or(HostAnswer::Gone)
            };
            if answer == HostAnswer::Gone {
                self.dropped.set(true);
            }
            std::future::ready(answer)
        }
    }

    fn run_step(here: &Here, host: &Host) -> Cleanup {
        tauri::async_runtime::block_on(step(here, host))
    }

    fn removals(journal: &Journal) -> Vec<&'static str> {
        journal
            .borrow()
            .iter()
            .copied()
            .filter(|e| e.starts_with("remove") || e.starts_with("DELETE"))
            .collect()
    }

    #[test]
    fn a_link_pairing_that_failed_or_was_cancelled_removes_nothing() {
        // No link.json: kleio_link_pair writes it only once the host paired it.
        let journal = Journal::default();
        let here = Here::by_address(&journal);
        let host = Host::new(&journal, vec![]);
        assert_eq!(run_step(&here, &host), Cleanup::Nothing);
        assert_eq!(note_good_session(&here, HOST, "d-link"), Ok(false));
        assert_eq!(run_step(&here, &host), Cleanup::Nothing);
        // So the pairing over Tailscale still works: its record and token are here.
        assert_eq!(here.has_old_pairing(), (true, true));
        assert_eq!(host.asked.get(), 0);
        assert!(journal.borrow().is_empty());
    }

    #[test]
    fn a_link_pairing_to_another_host_removes_nothing() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        here.link.borrow_mut().as_mut().unwrap().host = "studio.tail0000.ts.net".into();
        let host = Host::new(&journal, vec![]);
        assert_eq!(
            note_good_session(&here, "studio.tail0000.ts.net", "d-link"),
            Ok(false)
        );
        assert_eq!(run_step(&here, &host), Cleanup::Nothing);
        assert_eq!(here.has_old_pairing(), (true, true));
        assert_eq!(host.asked.get(), 0);
    }

    #[test]
    fn a_link_pairing_that_never_reached_the_host_removes_nothing() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        let host = Host::new(&journal, vec![]);
        for _ in 0..3 {
            assert_eq!(run_step(&here, &host), Cleanup::WaitingForLink);
        }
        assert_eq!(here.has_old_pairing(), (true, true));
        assert_eq!(host.asked.get(), 0);
        assert!(journal.borrow().is_empty());
    }

    #[test]
    fn after_the_first_good_session_the_host_drops_it_then_the_keychain_items_then_remote_json() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        let host = Host::new(&journal, vec![]);
        assert_eq!(note_good_session(&here, HOST, "d-link"), Ok(true));
        assert_eq!(note_good_session(&here, HOST, "d-link"), Ok(false));
        assert_eq!(run_step(&here, &host), Cleanup::Done);
        assert_eq!(
            *journal.borrow(),
            [
                "keep switch.json",
                "DELETE /kleio/devices/self",
                "keep switch.json",
                "remove the Keychain items",
                "remove remote.json",
                "keep switch.json",
            ]
        );
        assert_eq!(here.has_old_pairing(), (false, false));
        assert_eq!(here.state(), SwitchState::default());
        // The link pairing is never touched.
        assert_eq!(here.link_pairing(), Some(link_pairing("d-link")));
    }

    #[test]
    fn a_host_that_cant_be_reached_keeps_everything_until_it_can() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        let host = Host::new(
            &journal,
            vec![HostAnswer::Failed(
                "couldn't reach it at https://mac-mini-1.tail0000.ts.net:8443: connection refused"
                    .into(),
            )],
        );
        note_good_session(&here, HOST, "d-link").unwrap();
        let waiting = run_step(&here, &host);
        assert!(
            matches!(&waiting, Cleanup::WaitingForHost { refused: false, reason } if reason.contains("connection refused")),
            "{waiting:?}"
        );
        assert_eq!(here.has_old_pairing(), (true, true));
        assert_eq!(here.state().forgot_on_host, None);
        // Reached at the next run: done.
        assert_eq!(run_step(&here, &host), Cleanup::Done);
        assert_eq!(here.has_old_pairing(), (false, false));
    }

    #[test]
    fn a_401_keeps_the_old_pairing_and_says_why_and_isnt_done() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        let host = Host::new(
            &journal,
            vec![answer_from_status(401), answer_from_status(401)],
        );
        note_good_session(&here, HOST, "d-link").unwrap();
        for _ in 0..2 {
            let refused = run_step(&here, &host);
            let Cleanup::WaitingForHost { reason, refused } = refused else {
                panic!("not refused: {refused:?}");
            };
            assert!(refused);
            assert!(reason.contains("HTTP 401"), "{reason}");
            assert!(
                reason.contains("revoked already, or it doesn't match"),
                "{reason}"
            );
        }
        assert_eq!(here.has_old_pairing(), (true, true));
        assert_eq!(
            removals(&journal),
            ["DELETE /kleio/devices/self", "DELETE /kleio/devices/self"]
        );
    }

    #[test]
    fn a_keychain_removal_that_fails_once_is_finished_by_the_next_run() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        here.fail_secrets.set(1);
        let host = Host::new(&journal, vec![]);
        note_good_session(&here, HOST, "d-link").unwrap();
        let unfinished = run_step(&here, &host);
        assert!(
            matches!(&unfinished, Cleanup::Unfinished(e) if e.contains("Keychain items") && e.contains("locked")),
            "{unfinished:?}"
        );
        // remote.json is last, so it's still here for the retry to find.
        assert_eq!(here.has_old_pairing(), (true, true));
        // The host's answer was kept, as its token is revoked now (it'd answer 401).
        assert!(here.state().forgot_on_host.is_some());
        assert_eq!(run_step(&here, &host), Cleanup::Done);
        assert_eq!(host.asked.get(), 1);
        assert_eq!(
            removals(&journal),
            [
                "DELETE /kleio/devices/self",
                "remove the Keychain items",
                "remove remote.json",
            ]
        );
        assert_eq!(here.has_old_pairing(), (false, false));
        assert_eq!(here.link_pairing(), Some(link_pairing("d-link")));
    }

    #[test]
    fn a_remote_json_that_cant_be_removed_is_finished_by_the_next_run() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        here.fail_record.set(1);
        let host = Host::new(&journal, vec![]);
        note_good_session(&here, HOST, "d-link").unwrap();
        assert!(
            matches!(run_step(&here, &host), Cleanup::Unfinished(e) if e.contains("remote.json"))
        );
        assert_eq!(here.has_old_pairing(), (true, false));
        assert_eq!(run_step(&here, &host), Cleanup::Done);
        assert_eq!(host.asked.get(), 1);
        assert_eq!(here.has_old_pairing(), (false, false));
    }

    #[test]
    fn quitting_after_the_host_dropped_it_is_finished_by_the_next_launch() {
        // The app quit after keeping the host's answer, before anything here went.
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        *here.state.borrow_mut() = SwitchState {
            good_session: Some(Mark::now(HOST, "d-link")),
            forgot_on_host: Some(Mark::now(HOST, "d-tailscale")),
        };
        let host = Host::new(&journal, vec![]);
        host.dropped.set(true);
        assert_eq!(run_step(&here, &host), Cleanup::Done);
        assert_eq!(host.asked.get(), 0);
        assert_eq!(here.has_old_pairing(), (false, false));
        assert_eq!(here.link_pairing(), Some(link_pairing("d-link")));
    }

    #[test]
    fn quitting_after_the_keychain_items_went_is_finished_by_the_next_launch() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        here.secrets.set(false);
        *here.state.borrow_mut() = SwitchState {
            good_session: Some(Mark::now(HOST, "d-link")),
            forgot_on_host: Some(Mark::now(HOST, "d-tailscale")),
        };
        let host = Host::new(&journal, vec![]);
        host.dropped.set(true);
        assert_eq!(run_step(&here, &host), Cleanup::Done);
        assert_eq!(host.asked.get(), 0);
        assert_eq!(here.has_old_pairing(), (false, false));
    }

    #[test]
    fn quitting_before_the_hosts_answer_was_kept_leaves_it_for_you_to_remove() {
        // The host dropped it, and the app quit before keeping that: the retry's
        // DELETE gets 401, which isn't proof, so it stays until removed here.
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        note_good_session(&here, HOST, "d-link").unwrap();
        let host = Host::new(&journal, vec![]);
        host.dropped.set(true);
        assert!(matches!(
            run_step(&here, &host),
            Cleanup::WaitingForHost { refused: true, .. }
        ));
        assert_eq!(here.has_old_pairing(), (true, true));
        assert_eq!(remove_here(&here), Ok(Cleanup::Done));
        assert_eq!(here.has_old_pairing(), (false, false));
        assert_eq!(here.link_pairing(), Some(link_pairing("d-link")));
    }

    #[test]
    fn removing_it_here_needs_the_links_good_session_first() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        let early = remove_here(&here).unwrap_err();
        assert!(early.contains("hasn't reached the host yet"), "{early}");
        assert_eq!(here.has_old_pairing(), (true, true));
        let none = Here::by_address(&journal);
        assert!(remove_here(&none).is_err());
        assert_eq!(none.has_old_pairing(), (true, true));
    }

    #[test]
    fn the_switch_run_twice_counts_only_the_newest_link_pairings_good_session() {
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link-a");
        let host = Host::new(&journal, vec![HostAnswer::Failed("not now".into())]);
        note_good_session(&here, HOST, "d-link-a").unwrap();
        assert!(matches!(
            run_step(&here, &host),
            Cleanup::WaitingForHost { .. }
        ));
        // Switched again: a new link pairing, which hasn't had a session yet.
        *here.link.borrow_mut() = Some(link_pairing("d-link-b"));
        assert_eq!(run_step(&here, &host), Cleanup::WaitingForLink);
        assert_eq!(here.has_old_pairing(), (true, true));
        assert_eq!(note_good_session(&here, HOST, "d-link-b"), Ok(true));
        assert_eq!(run_step(&here, &host), Cleanup::Done);
        // And once done, again is nothing: the link pairing stays as it is.
        assert_eq!(run_step(&here, &host), Cleanup::Nothing);
        assert_eq!(here.link_pairing(), Some(link_pairing("d-link-b")));
        assert_eq!(host.asked.get(), 2);
    }

    #[test]
    fn a_good_session_with_no_pairing_by_address_isnt_kept() {
        // Paired over the link from the start: no switch.json.
        let journal = Journal::default();
        let here = Here::switched(&journal, "d-link");
        *here.old.borrow_mut() = None;
        assert_eq!(note_good_session(&here, HOST, "d-link"), Ok(false));
        assert_eq!(here.state(), SwitchState::default());
        assert!(journal.borrow().is_empty());
    }

    #[test]
    fn only_a_200_or_a_404_means_the_host_dropped_it() {
        assert_eq!(answer_from_status(200), HostAnswer::Gone);
        assert_eq!(answer_from_status(404), HostAnswer::Gone);
        assert!(
            matches!(answer_from_status(401), HostAnswer::Refused(r) if r.contains("HTTP 401"))
        );
        for status in [403, 405, 421, 500, 502] {
            assert_eq!(
                answer_from_status(status),
                HostAnswer::Failed(format!("the host answered HTTP {status}"))
            );
        }
    }

    #[test]
    fn the_view_says_what_its_waiting_for() {
        let journal = Journal::default();
        let says = |here: &Here, last: Option<Cleanup>| {
            let v = view(here, last.as_ref());
            (v.state, v.reason)
        };
        let not_switched = Here::by_address(&journal);
        assert_eq!(says(&not_switched, None), ("none", None));
        let here = Here::switched(&journal, "d-link");
        assert_eq!(says(&here, None), ("waiting-for-link", None));
        note_good_session(&here, HOST, "d-link").unwrap();
        assert_eq!(says(&here, None), ("pending", None));
        let host_down = Cleanup::WaitingForHost {
            reason: "not now".into(),
            refused: false,
        };
        assert_eq!(
            says(&here, Some(host_down)),
            ("waiting-for-host", Some("not now".into()))
        );
        let refused = Cleanup::WaitingForHost {
            reason: "HTTP 401".into(),
            refused: true,
        };
        assert_eq!(
            says(&here, Some(refused)),
            ("refused", Some("HTTP 401".into()))
        );
        assert_eq!(
            says(&here, Some(Cleanup::Unfinished("locked".into()))),
            ("unfinished", Some("locked".into()))
        );
        *here.old.borrow_mut() = None;
        assert_eq!(says(&here, Some(Cleanup::Done)), ("none", None));
    }

    fn tmp_home() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "kleio-switch-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn switch_json_round_trips_and_an_unreadable_one_marks_nothing() {
        let home = tmp_home();
        assert_eq!(load(&home), SwitchState::default());
        let state = SwitchState {
            good_session: Some(Mark::now(HOST, "d-link")),
            forgot_on_host: None,
        };
        save(&home, &state).unwrap();
        assert_eq!(load(&home), state);
        std::fs::write(path(&home), "not json").unwrap();
        assert_eq!(load(&home), SwitchState::default());
        let disk = Disk { home: home.clone() };
        disk.keep_state(&SwitchState::default()).unwrap();
        assert!(!path(&home).exists());
        let _ = std::fs::remove_dir_all(&home);
    }
}
