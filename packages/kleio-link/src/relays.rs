//! Relay lists, as kleio-host keeps one in `link/config.json` and as tickets
//! and `GET /kleio/link` carry one: up to [`MAX_RELAYS`] entries, in order,
//! each a relay's address or [`N0_ALIAS`], which stands for n0's public
//! relays as this crate has them built in (iroh's `defaults::prod`).
//!
//! A relay's address is `https://<host>[:<port>]/` and nothing else, written
//! exactly as a URL parser writes it, as kleio-host's `isRelayUrl` takes one
//! (packages/kleio-host/src/link.ts).

use std::collections::BTreeSet;
use std::str::FromStr;

use iroh::RelayUrl;
use serde::Deserialize;

/// n0's public relays, in a relay list.
pub const N0_ALIAS: &str = "n0";

/// The most entries in a relay list.
pub const MAX_RELAYS: usize = 4;

/// The longest relay address taken. n0's are 35 characters.
pub const MAX_RELAY_URL_LENGTH: usize = 200;

/// The relay list's version this reads.
pub const CONFIG_VERSION: u64 = 1;

/// One entry of a relay list.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RelayEntry {
    /// n0's public relays: the lowest-latency one is used.
    N0,
    /// A relay of the host's own choosing.
    Url(RelayUrl),
}

impl RelayEntry {
    /// The entry as a list writes it.
    pub fn as_str(&self) -> &str {
        match self {
            Self::N0 => N0_ALIAS,
            Self::Url(url) => url.as_str(),
        }
    }
}

/// n0's public relays, as this crate has them built in.
pub fn n0_relays() -> Vec<RelayUrl> {
    let mut relays: Vec<RelayUrl> = iroh::defaults::prod::default_relay_map().urls();
    relays.sort();
    relays
}

/// Whether `relay` is one of n0's public relays.
pub fn is_n0_relay(relay: &RelayUrl) -> bool {
    n0_relays().contains(relay)
}

/// Every relay `entries` names, in order, n0's for its entry, each once.
pub fn every_relay(entries: &[RelayEntry]) -> Vec<RelayUrl> {
    let mut all: Vec<RelayUrl> = Vec::new();
    for entry in entries {
        let urls = match entry {
            RelayEntry::N0 => n0_relays(),
            RelayEntry::Url(url) => vec![url.clone()],
        };
        for url in urls {
            if !all.contains(&url) {
                all.push(url);
            }
        }
    }
    all
}

/// `s` as a relay's address: `https://<host>[:<port>]/`, with no user,
/// password, path, query or fragment, and exactly as the URL parser writes
/// it, so the relay a person is shown is the one dialled.
pub fn check_relay_url(s: &str) -> Option<RelayUrl> {
    if s.len() > MAX_RELAY_URL_LENGTH {
        return None;
    }
    let relay = RelayUrl::from_str(s).ok()?;
    let only_a_host = relay.scheme() == "https"
        && relay.host_str().is_some_and(|host| !host.is_empty())
        && relay.username().is_empty()
        && relay.password().is_none()
        && relay.path() == "/"
        && relay.query().is_none()
        && relay.fragment().is_none();
    (only_a_host && relay.as_str() == s).then_some(relay)
}

/// One entry: [`N0_ALIAS`] or a relay's address.
pub fn check_relay_entry(s: &str) -> Option<RelayEntry> {
    if s == N0_ALIAS {
        Some(RelayEntry::N0)
    } else {
        check_relay_url(s).map(RelayEntry::Url)
    }
}

/// A relay list: 1 to [`MAX_RELAYS`] entries, none twice.
pub fn check_relay_list<'a>(entries: impl IntoIterator<Item = &'a str>) -> Option<Vec<RelayEntry>> {
    let mut list = Vec::new();
    let mut seen = BTreeSet::new();
    for text in entries {
        let entry = check_relay_entry(text)?;
        if !seen.insert(entry.clone()) {
            return None;
        }
        list.push(entry);
    }
    (1..=MAX_RELAYS).contains(&list.len()).then_some(list)
}

/// The relay list kleio-host keeps in `link/config.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkConfig {
    /// Goes up by one each time kleio-host changes the list.
    pub list_version: u64,
    pub relays: Vec<RelayEntry>,
}

impl Default for LinkConfig {
    /// Without the file: n0's relays alone.
    fn default() -> Self {
        Self {
            list_version: 0,
            relays: vec![RelayEntry::N0],
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    version: u64,
    list_version: u64,
    relays: Vec<String>,
}

impl LinkConfig {
    /// `link/config.json`'s bytes, as kleio-host's `readLinkConfig` reads
    /// them; other fields are left for kleio-host.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let file: ConfigFile = serde_json::from_slice(bytes).map_err(|err| err.to_string())?;
        if file.version != CONFIG_VERSION {
            return Err(format!(
                "version {} (this reads version {CONFIG_VERSION})",
                file.version
            ));
        }
        let relays = check_relay_list(file.relays.iter().map(String::as_str)).ok_or_else(|| {
            format!(
                "relays must be 1 to {MAX_RELAYS} relay addresses (https://<host>/) or \"{N0_ALIAS}\", none twice"
            )
        })?;
        Ok(Self {
            list_version: file.list_version,
            relays,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_n0s_four_relays_built_in() {
        let relays: Vec<String> = n0_relays().iter().map(ToString::to_string).collect();
        assert_eq!(
            relays,
            [
                "https://aps1-1.relay.n0.iroh.link./",
                "https://euc1-1.relay.n0.iroh.link./",
                "https://use1-1.relay.n0.iroh.link./",
                "https://usw1-1.relay.n0.iroh.link./",
            ]
        );
        assert!(n0_relays().iter().all(is_n0_relay));
        let own = check_relay_url("https://relay.example.com/").expect("a relay");
        assert!(!is_n0_relay(&own));
    }

    #[test]
    fn takes_a_relay_address_with_a_port_as_kleio_host_does() {
        for relay in [
            "https://euc1-1.relay.n0.iroh.link./",
            "https://relay.example.com/",
            "https://relay2.example.net:8443/",
            "https://203.0.113.7/",
            "https://[2001:db8::7]:8443/",
        ] {
            assert_eq!(
                check_relay_url(relay).map(|r| r.to_string()).as_deref(),
                Some(relay)
            );
        }
    }

    #[test]
    fn refuses_anything_else_or_any_other_way_of_writing_it() {
        let long = format!("https://{}.example.com/", "a".repeat(190));
        for relay in [
            "http://relay.example.com/",
            "wss://relay.example.com/",
            "HTTPS://relay.example.com/",
            "https://RELAY.example.com/",
            "https://relay.example.com",
            "https://relay.example.com:443/",
            "https://relay.example.com/relay",
            "https://relay.example.com/?x=1",
            "https://relay.example.com/#x",
            "https://me@relay.example.com/",
            "https://relay.exämple.com/",
            "https://relay%2Eexample.com/",
            "https:///",
            "n1",
            "",
            long.as_str(),
        ] {
            assert_eq!(check_relay_url(relay), None, "{relay:?}");
        }
    }

    #[test]
    fn reads_a_list_of_one_to_four_entries_none_twice() {
        let own = "https://relay.example.com/";
        assert_eq!(
            check_relay_list([own, "n0"]),
            Some(vec![
                RelayEntry::Url(check_relay_url(own).expect("a relay")),
                RelayEntry::N0
            ])
        );
        assert!(check_relay_list(["n0"]).is_some());
        assert!(check_relay_list([]).is_none());
        assert!(check_relay_list(["n0", "n0"]).is_none());
        assert!(check_relay_list([own, own]).is_none());
        assert!(check_relay_list([
            own,
            "n0",
            "https://a.example.com/",
            "https://b.example.com/"
        ])
        .is_some());
        assert!(check_relay_list([
            own,
            "n0",
            "https://a.example.com/",
            "https://b.example.com/",
            "https://c.example.com/"
        ])
        .is_none());
        assert!(check_relay_list(["n0", "http://relay.example.com/"]).is_none());
    }

    #[test]
    fn reads_kleio_hosts_config_file() {
        let config = LinkConfig::parse(
            br#"{"version":1,"listVersion":3,"relays":["https://relay.example.com/","n0"],"note":"kleio-host's"}"#,
        )
        .expect("reads");
        assert_eq!(config.list_version, 3);
        assert_eq!(config.relays.len(), 2);
        assert_eq!(LinkConfig::default().relays, [RelayEntry::N0]);
        // While a new list waits for devices, `relays` is the host's order,
        // and `list` and `promoted` are kleio-host's (link-relays.ts), as the
        // shared fixture has it.
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/relay-config.json"))
                .expect("the fixture is JSON");
        let waiting = LinkConfig::parse(fixture["waiting"].to_string().as_bytes()).expect("reads");
        assert_eq!(waiting.list_version, 4);
        assert_eq!(
            waiting.relays,
            [
                RelayEntry::N0,
                RelayEntry::Url(check_relay_url("https://relay.example.com/").expect("a relay")),
            ]
        );
        for bad in [
            &br#"{"version":2,"listVersion":0,"relays":["n0"]}"#[..],
            br#"{"version":1,"relays":["n0"]}"#,
            br#"{"version":1,"listVersion":-1,"relays":["n0"]}"#,
            br#"{"version":1,"listVersion":0,"relays":[]}"#,
            br#"{"version":1,"listVersion":0,"relays":["n0","n0"]}"#,
            br#"{"version":1,"listVersion":0,"relays":"n0"}"#,
            b"not json",
        ] {
            assert!(
                LinkConfig::parse(bad).is_err(),
                "{}",
                String::from_utf8_lossy(bad)
            );
        }
    }
}
