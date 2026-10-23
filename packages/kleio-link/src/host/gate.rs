//! The gate, an `after_handshake` hook: who gets in, on which protocol,
//! before any stream.
//!
//! - `kleio/http/0`: only keys on the allow-list. A revoked device's key is
//!   closed with [`close::REVOKED`], any other with [`close::NOT_PAIRED`].
//! - `kleio/pair/0`: any key (the pairing budget limits them).
//! - Anything else: closed with [`close::UNKNOWN_ALPN`].
//!
//! The allow-list is kleio-host's `secure/link-allow.json`, which its device
//! registry writes on every pairing and revoke (device-registry.ts):
//!
//! ```json
//! {"version":1,
//!  "devices":[{"key":"<64 hex>","deviceId":"…","label":"…"}],
//!  "revoked":["<64 hex>"]}
//! ```
//!
//! It's read again whenever it changes (the forwarder checks every second),
//! and right after kleio-host pairs a key. A key kleio-host paired but whose
//! write failed gets in until the file next changes.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::future::{ready, Future};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Mutex, MutexGuard, PoisonError};

use iroh::endpoint::{AfterHandshakeOutcome, Connection, EndpointHooks, Side, VarInt};
use iroh::EndpointId;
use serde::Deserialize;
use serde_json::Value;
use tracing::{info, warn};

use super::state::{signature, Signature};
use super::{file_error, HostError};
use crate::{close, ALPN_HTTP, ALPN_PAIR};

/// The allow-list's version this reads.
const ALLOW_VERSION: u64 = 1;

/// The largest allow-list read.
const MAX_ALLOW_BYTES: u64 = 1024 * 1024;

/// A paired device, as the allow-list names it, for the log.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Device {
    pub(crate) device_id: Option<String>,
    pub(crate) label: Option<String>,
}

impl Device {
    /// The device in kleio-host's pairing payload.
    pub(crate) fn from_payload(payload: &Value) -> Self {
        let text = |field: &str| {
            payload
                .get(field)
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        Self {
            device_id: text("deviceId"),
            label: text("label"),
        }
    }
}

/// Where a key stands with the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Standing {
    Paired,
    Revoked,
    Unknown,
}

#[derive(Deserialize)]
struct Document {
    version: u64,
    devices: Vec<Entry>,
    revoked: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    key: String,
    device_id: String,
    label: String,
}

#[derive(Debug, Default)]
struct List {
    devices: BTreeMap<EndpointId, Device>,
    revoked: BTreeSet<EndpointId>,
    /// Keys kleio-host paired that the file doesn't have yet.
    provisional: BTreeMap<EndpointId, Device>,
    /// The file as last read; `None` while it's missing.
    read: Option<Signature>,
}

/// kleio-host's allow-list, as last read.
#[derive(Debug)]
pub(crate) struct AllowList {
    path: PathBuf,
    list: Mutex<List>,
}

impl AllowList {
    /// The list at `path`. A missing file is an empty list (kleio-host
    /// writes it when it starts); one that can't be read is an error.
    pub(crate) fn load(path: PathBuf) -> Result<Self, HostError> {
        let allow = Self {
            path,
            list: Mutex::default(),
        };
        allow.reload()?;
        Ok(allow)
    }

    /// Reads the file again if it has changed since it was last read, and
    /// says whether it had. A file that can't be read leaves the list as it
    /// was, and is an error.
    pub(crate) fn refresh(&self) -> Result<bool, HostError> {
        let now = signature(&self.path).map_err(|err| file_error(&self.path, err))?;
        if now == self.locked().read {
            return Ok(false);
        }
        self.reload()?;
        Ok(true)
    }

    /// Reads the file again, changed or not.
    pub(crate) fn reload(&self) -> Result<(), HostError> {
        let read = signature(&self.path).map_err(|err| file_error(&self.path, err))?;
        let (devices, revoked) = match read {
            None => (BTreeMap::new(), BTreeSet::new()),
            Some(_) => parse(&read_capped(&self.path)?)
                .map_err(|why| HostError::new(format!("{}: {why}", self.path.display())))?,
        };
        let mut list = self.locked();
        *list = List {
            devices,
            revoked,
            provisional: BTreeMap::new(),
            read,
        };
        Ok(())
    }

    pub(crate) fn standing(&self, key: &EndpointId) -> Standing {
        let list = self.locked();
        if list.devices.contains_key(key) || list.provisional.contains_key(key) {
            Standing::Paired
        } else if list.revoked.contains(key) {
            Standing::Revoked
        } else {
            Standing::Unknown
        }
    }

    pub(crate) fn contains(&self, key: &EndpointId) -> bool {
        self.standing(key) == Standing::Paired
    }

    /// Lets in a key kleio-host has just paired, until the file next
    /// changes: kleio-host writes the file before it answers, so this is
    /// only for a write that failed.
    pub(crate) fn add_provisional(&self, key: EndpointId, device: Device) {
        self.locked().provisional.insert(key, device);
    }

    /// How many keys it lets in.
    pub(crate) fn len(&self) -> usize {
        let list = self.locked();
        list.devices.len()
            + list
                .provisional
                .keys()
                .filter(|key| !list.devices.contains_key(*key))
                .count()
    }

    /// The label the list gives `key`, for the log.
    pub(crate) fn label(&self, key: &EndpointId) -> Option<String> {
        let list = self.locked();
        list.devices
            .get(key)
            .or_else(|| list.provisional.get(key))
            .and_then(|device| device.label.clone())
    }

    fn locked(&self) -> MutexGuard<'_, List> {
        // Every update replaces the list whole, so it's whole even if a
        // holder panicked.
        self.list.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn read_capped(path: &Path) -> Result<Vec<u8>, HostError> {
    let file = File::open(path).map_err(|err| file_error(path, err))?;
    let mut bytes = Vec::new();
    file.take(MAX_ALLOW_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| file_error(path, err))?;
    if bytes.len() as u64 > MAX_ALLOW_BYTES {
        return Err(HostError::new(format!(
            "{}: too long to be an allow-list",
            path.display()
        )));
    }
    Ok(bytes)
}

type Parsed = (BTreeMap<EndpointId, Device>, BTreeSet<EndpointId>);

fn parse(bytes: &[u8]) -> Result<Parsed, String> {
    let doc: Document = serde_json::from_slice(bytes).map_err(|err| err.to_string())?;
    if doc.version != ALLOW_VERSION {
        return Err(format!(
            "version {} (kleio-link-host reads version {ALLOW_VERSION}); update kleio-link-host",
            doc.version
        ));
    }
    let key = |text: &str| {
        // kleio-host writes 64 lowercase hex characters; iroh would read
        // other forms too, so they're refused here.
        if text.len() != 64 || !text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(format!("{text:?} isn't a key"));
        }
        EndpointId::from_str(text).map_err(|_| format!("{text:?} isn't a key"))
    };
    let mut devices = BTreeMap::new();
    for entry in doc.devices {
        let device = Device {
            device_id: Some(entry.device_id),
            label: Some(entry.label),
        };
        devices.insert(key(&entry.key)?, device);
    }
    let mut revoked = BTreeSet::new();
    for text in &doc.revoked {
        let revoked_key = key(text)?;
        if !devices.contains_key(&revoked_key) {
            revoked.insert(revoked_key);
        }
    }
    Ok((devices, revoked))
}

/// What the gate decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    Accept,
    NotPaired,
    Revoked,
    UnknownAlpn,
}

/// The `after_handshake` hook.
#[derive(Debug, Clone)]
pub(crate) struct Gate {
    allow: std::sync::Arc<AllowList>,
}

impl Gate {
    pub(crate) fn new(allow: std::sync::Arc<AllowList>) -> Self {
        Self { allow }
    }

    pub(crate) fn verdict(&self, side: Side, key: &EndpointId, alpn: &[u8]) -> Verdict {
        if matches!(side, Side::Client) {
            // The hook sees outgoing connections too; the forwarder makes none.
            Verdict::Accept
        } else if alpn == ALPN_HTTP {
            match self.allow.standing(key) {
                Standing::Paired => Verdict::Accept,
                Standing::Revoked => Verdict::Revoked,
                Standing::Unknown => Verdict::NotPaired,
            }
        } else if alpn == ALPN_PAIR {
            Verdict::Accept
        } else {
            Verdict::UnknownAlpn
        }
    }
}

impl EndpointHooks for Gate {
    fn after_handshake<'a>(
        &'a self,
        conn: &'a Connection,
    ) -> impl Future<Output = AfterHandshakeOutcome> + Send + 'a {
        let key = conn.remote_id();
        let peer = key.fmt_short();
        let alpn = String::from_utf8_lossy(conn.alpn());
        let outcome = match self.verdict(conn.side(), &key, conn.alpn()) {
            Verdict::Accept => {
                match self.allow.label(&key).filter(|_| conn.alpn() == ALPN_HTTP) {
                    Some(label) => info!("{peer} ({label:?}) on {alpn}: let in"),
                    None => info!("{peer} on {alpn}: let in"),
                }
                AfterHandshakeOutcome::Accept
            }
            Verdict::NotPaired => {
                warn!("{peer} on {alpn}: turned away, not paired");
                reject(close::NOT_PAIRED, b"not paired with this host")
            }
            Verdict::Revoked => {
                warn!("{peer} on {alpn}: turned away, revoked");
                reject(close::REVOKED, b"this device was revoked")
            }
            Verdict::UnknownAlpn => {
                warn!("{peer} on {alpn:?}: turned away, unknown protocol");
                reject(close::UNKNOWN_ALPN, b"unknown protocol")
            }
        };
        ready(outcome)
    }
}

fn reject(code: u32, reason: &[u8]) -> AfterHandshakeOutcome {
    AfterHandshakeOutcome::Reject {
        error_code: VarInt::from_u32(code),
        reason: reason.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;

    use iroh::SecretKey;
    use serde_json::json;

    use super::*;
    use crate::testing::TempDir;

    fn key(seed: u8) -> EndpointId {
        SecretKey::from_bytes(&[seed; 32]).public()
    }

    /// The allow-list kleio-host would write for `devices` and `revoked`.
    fn allow_doc(devices: &[(EndpointId, &str)], revoked: &[EndpointId]) -> String {
        let devices: Vec<Value> = devices
            .iter()
            .map(|(key, label)| json!({"key": key.to_string(), "deviceId": format!("id-{label}"), "label": label}))
            .collect();
        let revoked: Vec<String> = revoked.iter().map(ToString::to_string).collect();
        json!({"version": 1, "devices": devices, "revoked": revoked}).to_string()
    }

    #[test]
    fn lets_paired_keys_use_http_and_tells_revoked_keys_apart() {
        let tmp = TempDir::new("gate-verdict");
        let path = tmp.path().join("link-allow.json");
        let (paired, revoked, stranger) = (key(1), key(2), key(3));
        fs::write(&path, allow_doc(&[(paired, "Phone")], &[revoked])).expect("written");
        let gate = Gate::new(Arc::new(AllowList::load(path).expect("loads")));

        let verdict = |key: &EndpointId, alpn: &[u8]| gate.verdict(Side::Server, key, alpn);
        assert_eq!(verdict(&paired, ALPN_HTTP), Verdict::Accept);
        assert_eq!(verdict(&revoked, ALPN_HTTP), Verdict::Revoked);
        assert_eq!(verdict(&stranger, ALPN_HTTP), Verdict::NotPaired);
        // Any key may pair, a revoked one too: it may be paired again.
        assert_eq!(verdict(&stranger, ALPN_PAIR), Verdict::Accept);
        assert_eq!(verdict(&revoked, ALPN_PAIR), Verdict::Accept);
        assert_eq!(verdict(&paired, b"kleio/http/1"), Verdict::UnknownAlpn);
    }

    #[test]
    fn a_missing_list_is_empty_and_is_read_once_kleio_host_writes_it() {
        let tmp = TempDir::new("gate-missing");
        let path = tmp.path().join("link-allow.json");
        let allow = AllowList::load(path.clone()).expect("loads");
        assert_eq!(allow.len(), 0);
        assert!(!allow.refresh().expect("reads"));

        fs::write(&path, allow_doc(&[(key(1), "Phone")], &[])).expect("written");
        assert!(allow.refresh().expect("reads"));
        assert!(allow.contains(&key(1)));
        assert_eq!(allow.label(&key(1)).as_deref(), Some("Phone"));
        assert!(!allow.refresh().expect("reads"), "unchanged");

        // Gone again: no one gets in.
        fs::remove_file(&path).expect("removed");
        assert!(allow.refresh().expect("reads"));
        assert_eq!(allow.standing(&key(1)), Standing::Unknown);
    }

    #[test]
    fn a_damaged_list_is_an_error_and_leaves_the_last_one() {
        let tmp = TempDir::new("gate-damaged");
        let path = tmp.path().join("link-allow.json");
        fs::write(&path, allow_doc(&[(key(1), "Phone")], &[])).expect("written");
        let allow = AllowList::load(path.clone()).expect("loads");
        let upper = allow_doc(&[(key(1), "Phone")], &[])
            .replace(&key(1).to_string(), &key(1).to_string().to_uppercase());
        for damaged in [
            "not json".to_string(),
            "[]".to_string(),
            r#"{"version":2,"devices":[],"revoked":[]}"#.to_string(),
            r#"{"version":1,"devices":[{"key":"nope","deviceId":"d","label":"l"}],"revoked":[]}"#
                .to_string(),
            r#"{"version":1,"devices":[]}"#.to_string(),
            upper,
        ] {
            fs::write(&path, &damaged).expect("written");
            assert!(allow.refresh().is_err(), "{damaged}");
            assert!(allow.contains(&key(1)), "{damaged}: the last list stays");
            assert!(AllowList::load(path.clone()).is_err(), "{damaged}");
        }
    }

    #[test]
    fn a_key_both_paired_and_revoked_is_paired() {
        // A phone revoked, then paired again: kleio-host lists it once, live,
        // but a hand-edited file could name it twice.
        let tmp = TempDir::new("gate-both");
        let path = tmp.path().join("link-allow.json");
        fs::write(&path, allow_doc(&[(key(1), "Phone")], &[key(1)])).expect("written");
        let allow = AllowList::load(path).expect("loads");
        assert_eq!(allow.standing(&key(1)), Standing::Paired);
    }

    #[test]
    fn a_provisional_key_gets_in_until_the_file_next_changes() {
        let tmp = TempDir::new("gate-provisional");
        let path = tmp.path().join("link-allow.json");
        fs::write(&path, allow_doc(&[], &[])).expect("written");
        let allow = AllowList::load(path.clone()).expect("loads");
        allow.add_provisional(key(1), Device::default());
        assert!(allow.contains(&key(1)));
        assert_eq!(allow.len(), 1);
        assert!(!allow.refresh().expect("reads"));
        assert!(allow.contains(&key(1)), "the file hasn't changed");

        // kleio-host writes the list again, and it's the record.
        fs::write(&path, allow_doc(&[(key(2), "Other")], &[key(1)])).expect("written");
        assert!(allow.refresh().expect("reads"));
        assert_eq!(allow.standing(&key(1)), Standing::Revoked);
    }

    #[test]
    fn reads_the_device_from_kleio_hosts_payload() {
        let payload = json!({"token": "t0k3n", "deviceId": "d1", "label": "Test iPhone"});
        assert_eq!(
            Device::from_payload(&payload),
            Device {
                device_id: Some("d1".into()),
                label: Some("Test iPhone".into()),
            }
        );
        assert_eq!(Device::from_payload(&json!({})), Device::default());
    }
}
