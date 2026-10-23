//! Who gets in: the `after_handshake` hook, and the allow-list it reads.
//!
//! The hook runs once the TLS handshake has proved the remote's key, before
//! any stream: `kleio/http/0` only from keys on the allow-list, `kleio/pair/0`
//! from any key (the pair handler applies the budget), and nothing else.
//! Each key gets in or is turned away with a close code from
//! [`crate::close`].

use std::collections::BTreeMap;
use std::fs;
use std::future::{ready, Future};
use std::io;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use iroh::endpoint::{AfterHandshakeOutcome, Connection, EndpointHooks, Side, VarInt};
use iroh::EndpointId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{info, warn};

use super::state::write_private;
use super::{file_error, HostError};
use crate::{close, ALPN_HTTP, ALPN_PAIR};

/// A paired device, as kleio-host named it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Device {
    pub(crate) device_id: Option<String>,
    pub(crate) label: Option<String>,
}

impl Device {
    /// The device kleio-host's pairing payload names: its id and label.
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

/// The keys allowed on `kleio/http/0`, kept in `allow.json`: a JSON array of
/// `{key, deviceId, label}`, sorted by key. It never holds a token.
#[derive(Debug)]
pub(crate) struct AllowList {
    path: PathBuf,
    devices: Mutex<BTreeMap<EndpointId, Device>>,
}

/// One entry of `allow.json`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
}

impl AllowList {
    /// The list at `path`, empty if there's no file yet. A file that can't
    /// be read is an error: starting empty would turn away every paired
    /// device without saying why.
    pub(crate) fn load(path: PathBuf) -> Result<Self, HostError> {
        let devices = match fs::read(&path) {
            Ok(bytes) => {
                parse(&bytes).map_err(|why| HostError::new(format!("{}: {why}", path.display())))?
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => BTreeMap::new(),
            Err(err) => return Err(file_error(&path, err)),
        };
        Ok(Self {
            path,
            devices: Mutex::new(devices),
        })
    }

    pub(crate) fn contains(&self, key: &EndpointId) -> bool {
        self.devices().contains_key(key)
    }

    pub(crate) fn len(&self) -> usize {
        self.devices().len()
    }

    /// Adds `key`, writes the file, and says how many keys it now has. If
    /// the write fails, the key still gets in until the forwarder restarts.
    pub(crate) fn add(&self, key: EndpointId, device: Device) -> Result<usize, HostError> {
        let mut devices = self.devices();
        devices.insert(key, device);
        write_private(&self.path, &serialize(&devices))
            .map_err(|err| file_error(&self.path, err))?;
        Ok(devices.len())
    }

    fn devices(&self) -> MutexGuard<'_, BTreeMap<EndpointId, Device>> {
        // Every update is one insert, so the map is whole even if a holder
        // panicked.
        self.devices.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn parse(bytes: &[u8]) -> Result<BTreeMap<EndpointId, Device>, String> {
    let entries: Vec<Entry> = serde_json::from_slice(bytes).map_err(|err| err.to_string())?;
    entries
        .into_iter()
        .map(|entry| {
            let key = EndpointId::from_str(&entry.key)
                .map_err(|_| format!("{:?} isn't a key", entry.key))?;
            let device = Device {
                device_id: entry.device_id,
                label: entry.label,
            };
            Ok((key, device))
        })
        .collect()
}

fn serialize(devices: &BTreeMap<EndpointId, Device>) -> Vec<u8> {
    let entries: Vec<Entry> = devices
        .iter()
        .map(|(key, device)| Entry {
            key: key.to_string(),
            device_id: device.device_id.clone(),
            label: device.label.clone(),
        })
        .collect();
    let mut bytes = serde_json::to_vec_pretty(&entries).expect("entries of strings serialize");
    bytes.push(b'\n');
    bytes
}

/// What the gate decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    Accept,
    NotPaired,
    UnknownAlpn,
}

/// The `after_handshake` hook.
#[derive(Debug, Clone)]
pub(crate) struct Gate {
    allow: Arc<AllowList>,
}

impl Gate {
    pub(crate) fn new(allow: Arc<AllowList>) -> Self {
        Self { allow }
    }

    pub(crate) fn verdict(&self, side: Side, key: &EndpointId, alpn: &[u8]) -> Verdict {
        if matches!(side, Side::Client) {
            // The hook sees outgoing connections too; the forwarder makes none.
            Verdict::Accept
        } else if alpn == ALPN_HTTP {
            if self.allow.contains(key) {
                Verdict::Accept
            } else {
                Verdict::NotPaired
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
                info!("{peer} on {alpn}: let in");
                AfterHandshakeOutcome::Accept
            }
            Verdict::NotPaired => {
                warn!("{peer} on {alpn}: turned away, not paired");
                reject(close::NOT_PAIRED, b"not paired with this host")
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
    use iroh::SecretKey;
    use serde_json::json;

    use super::*;
    #[cfg(unix)]
    use crate::testing::mode;
    use crate::testing::TempDir;

    fn key(seed: u8) -> EndpointId {
        SecretKey::from_bytes(&[seed; 32]).public()
    }

    fn device(id: &str, label: &str) -> Device {
        Device {
            device_id: Some(id.into()),
            label: Some(label.into()),
        }
    }

    // Adding a key saves the list, which only POSIX modes allow (state.rs).
    #[cfg(unix)]
    #[test]
    fn lets_only_paired_keys_use_http() {
        let tmp = TempDir::new("gate-verdict");
        let allow = Arc::new(AllowList::load(tmp.path().join("allow.json")).expect("loads"));
        let (paired, stranger) = (key(1), key(2));
        allow.add(paired, Device::default()).expect("saves");
        let gate = Gate::new(allow);

        assert_eq!(
            gate.verdict(Side::Server, &paired, ALPN_HTTP),
            Verdict::Accept
        );
        assert_eq!(
            gate.verdict(Side::Server, &stranger, ALPN_HTTP),
            Verdict::NotPaired
        );
        // Any key may pair.
        assert_eq!(
            gate.verdict(Side::Server, &stranger, ALPN_PAIR),
            Verdict::Accept
        );
        assert_eq!(
            gate.verdict(Side::Server, &paired, b"kleio/http/1"),
            Verdict::UnknownAlpn
        );
    }

    #[cfg(unix)]
    #[test]
    fn saves_the_list_0600_sorted_and_reads_it_back() {
        let tmp = TempDir::new("gate-save");
        let path = tmp.path().join("allow.json");
        let allow = AllowList::load(path.clone()).expect("loads");
        let mut keys = [key(1), key(2)];
        keys.sort();
        allow.add(keys[1], device("d2", "Second")).expect("saves");
        assert_eq!(allow.add(keys[0], device("d1", "First")).expect("saves"), 2);

        assert_eq!(mode(&path), 0o600);
        let saved: Value = serde_json::from_slice(&fs::read(&path).expect("read")).expect("JSON");
        assert_eq!(
            saved,
            json!([
                {"key": keys[0].to_string(), "deviceId": "d1", "label": "First"},
                {"key": keys[1].to_string(), "deviceId": "d2", "label": "Second"},
            ])
        );
        let again = AllowList::load(path).expect("loads");
        assert_eq!(again.len(), 2);
        assert!(again.contains(&keys[0]) && again.contains(&keys[1]));
    }

    #[test]
    fn refuses_a_damaged_list() {
        let tmp = TempDir::new("gate-damaged");
        let path = tmp.path().join("allow.json");
        let extra = format!(r#"[{{"key":"{}","token":"t0k3n"}}]"#, key(1));
        for damaged in ["not json", "{}", r#"[{"key":"nope"}]"#, extra.as_str()] {
            fs::write(&path, damaged).expect("written");
            assert!(AllowList::load(path.clone()).is_err(), "{damaged}");
        }
    }

    #[test]
    fn reads_the_device_from_kleio_hosts_payload() {
        let payload = json!({"token": "t0k3n", "deviceId": "d1", "label": "Test iPhone"});
        assert_eq!(Device::from_payload(&payload), device("d1", "Test iPhone"));
        assert_eq!(Device::from_payload(&json!({})), Device::default());
    }
}
