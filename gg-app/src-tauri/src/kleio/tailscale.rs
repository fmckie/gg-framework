// Read-only Tailscale status for Kleio's Connection page: is the private
// network up on this Mac, and can it see the paired Mac mini? Runs the
// Tailscale CLI from fixed paths (no PATH lookup, no shell) with a timeout and
// keeps only the few fields the page shows. The CLI's output is untrusted:
// every field is optional and a bad document becomes an error message.

use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The Mac app's bundled CLI first, then the standalone installs. Fixed paths
/// only: a GUI app's PATH is not worth trusting with what it runs.
const CLI_PATHS: [&str; 3] = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
];
const TIMEOUT: Duration = Duration::from_secs(4);
/// `status --json` grows with the tailnet; anything past this is not a status.
const MAX_OUTPUT: u64 = 4 * 1024 * 1024;
const MAX_HEALTH: usize = 5;

/// One machine on the tailnet, trimmed to what the page shows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleNode {
    pub name: String,
    /// MagicDNS name without the trailing dot.
    pub dns_name: String,
    /// First IPv4 address, else the first address.
    pub ip: Option<String>,
    pub os: Option<String>,
    pub online: bool,
    pub last_seen: Option<String>,
    /// A direct (peer-to-peer) path is up, rather than a relay.
    pub direct: bool,
    /// DERP relay region code, when there is one.
    pub relay: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    /// A CLI binary was found.
    pub installed: bool,
    /// Tailscale is connected (`BackendState == "Running"`).
    pub running: bool,
    pub backend_state: Option<String>,
    pub tailnet: Option<String>,
    pub magic_dns_suffix: Option<String>,
    pub version: Option<String>,
    pub health: Vec<String>,
    #[serde(rename = "self")]
    pub self_node: Option<TailscaleNode>,
    /// The paired Mac mini, found among this Mac's peers.
    pub host: Option<TailscaleNode>,
    /// Why there is no status, in words for the page.
    pub error: Option<String>,
}

impl TailscaleStatus {
    fn unavailable(installed: bool, error: &str) -> Self {
        Self {
            installed,
            running: false,
            backend_state: None,
            tailnet: None,
            magic_dns_suffix: None,
            version: None,
            health: Vec::new(),
            self_node: None,
            host: None,
            error: Some(error.to_string()),
        }
    }
}

const NOT_INSTALLED: &str = "Tailscale isn't installed on this Mac.";
const NOT_RUNNING: &str = "Tailscale isn't running on this Mac. Open Tailscale and sign in.";

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn node(v: &Value) -> Option<TailscaleNode> {
    let dns_name = text(v, "DNSName")?.trim_end_matches('.').to_string();
    if dns_name.is_empty() {
        return None;
    }
    let name = text(v, "HostName")
        .unwrap_or_else(|| dns_name.split('.').next().unwrap_or_default().to_string());
    let ips: Vec<&str> = v
        .get("TailscaleIPs")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let ip = ips
        .iter()
        .find(|ip| ip.contains('.'))
        .or_else(|| ips.first())
        .map(|ip| (*ip).to_string());
    Some(TailscaleNode {
        name,
        dns_name,
        ip,
        os: text(v, "OS"),
        online: v.get("Online").and_then(Value::as_bool).unwrap_or(false),
        // Go's zero time means "never".
        last_seen: text(v, "LastSeen").filter(|s| !s.starts_with("0001-")),
        direct: text(v, "CurAddr").is_some(),
        relay: text(v, "Relay"),
    })
}

/// The peer that is the paired host: its full MagicDNS name, else its first
/// label (a host renamed on the tailnet keeps its machine name).
fn find_host(peers: &[TailscaleNode], host: &str) -> Option<TailscaleNode> {
    let want = host.trim_end_matches('.').to_ascii_lowercase();
    if want.is_empty() {
        return None;
    }
    let want_label = want.split('.').next().unwrap_or_default().to_string();
    peers
        .iter()
        .find(|p| p.dns_name.to_ascii_lowercase() == want)
        .or_else(|| {
            peers.iter().find(|p| {
                p.dns_name
                    .split('.')
                    .next()
                    .unwrap_or_default()
                    .to_ascii_lowercase()
                    == want_label
            })
        })
        .cloned()
}

/// Parse `tailscale status --json`. `host` is the paired host's tailnet name.
pub fn parse_status(json: &str, host: Option<&str>) -> TailscaleStatus {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return TailscaleStatus::unavailable(true, NOT_RUNNING);
    };
    if !v.is_object() {
        return TailscaleStatus::unavailable(true, NOT_RUNNING);
    }
    let backend_state = text(&v, "BackendState");
    let running = backend_state.as_deref() == Some("Running");
    let tailnet_obj = v.get("CurrentTailnet");
    let peers: Vec<TailscaleNode> = v
        .get("Peer")
        .and_then(Value::as_object)
        .map(|m| m.values().filter_map(node).collect())
        .unwrap_or_default();
    let error = match backend_state.as_deref() {
        Some("Running") => None,
        Some("NeedsLogin") => Some("Tailscale needs you to sign in on this Mac.".to_string()),
        Some("NeedsMachineAuth") => {
            Some("This Mac is waiting for approval on your tailnet.".to_string())
        }
        Some("Stopped") => Some("Tailscale is turned off on this Mac.".to_string()),
        _ => Some(NOT_RUNNING.to_string()),
    };
    TailscaleStatus {
        installed: true,
        running,
        backend_state,
        tailnet: tailnet_obj.and_then(|t| text(t, "Name")),
        magic_dns_suffix: tailnet_obj
            .and_then(|t| text(t, "MagicDNSSuffix"))
            .or_else(|| text(&v, "MagicDNSSuffix")),
        version: text(&v, "Version"),
        health: v
            .get("Health")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .take(MAX_HEALTH)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        self_node: v.get("Self").and_then(node),
        host: host.and_then(|h| find_host(&peers, h)),
        error,
    }
}

enum CliError {
    NotInstalled,
    Failed(String),
}

/// Run `tailscale status --json`, killing it if it outlives the timeout.
fn run_cli() -> Result<String, CliError> {
    let bin = CLI_PATHS
        .iter()
        .find(|p| Path::new(p).is_file())
        .ok_or(CliError::NotInstalled)?;
    let mut child = Command::new(bin)
        .args(["status", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| CliError::Failed(format!("Couldn't run Tailscale: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CliError::Failed("Couldn't read Tailscale's answer.".to_string()))?;
    // Drain stdout on its own thread so a large status can't fill the pipe
    // and stall the CLI while we wait on it.
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.take(MAX_OUTPUT).read_to_string(&mut out);
        out
    });
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CliError::Failed(
                    "Tailscale didn't answer in time.".to_string(),
                ));
            }
            Err(e) => return Err(CliError::Failed(format!("Couldn't run Tailscale: {e}"))),
        }
    }
    reader
        .join()
        .map_err(|_| CliError::Failed("Couldn't read Tailscale's answer.".to_string()))
}

/// Tailscale on this Mac, and the paired Mac mini as a peer.
#[tauri::command]
pub async fn kleio_tailscale_status() -> TailscaleStatus {
    let host = super::remote().map(|r| r.host.clone());
    tauri::async_runtime::spawn_blocking(move || match run_cli() {
        Ok(out) => parse_status(&out, host.as_deref()),
        Err(CliError::NotInstalled) => TailscaleStatus::unavailable(false, NOT_INSTALLED),
        Err(CliError::Failed(msg)) => {
            log::warn!("tailscale status failed");
            TailscaleStatus::unavailable(true, &msg)
        }
    })
    .await
    .unwrap_or_else(|_| TailscaleStatus::unavailable(true, "Couldn't check Tailscale."))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNNING: &str = r#"{
      "BackendState": "Running",
      "Version": "1.90.0",
      "Health": ["one", "two", "three", "four", "five", "six"],
      "MagicDNSSuffix": "example-tail.ts.net",
      "CurrentTailnet": { "Name": "demo@example.com", "MagicDNSSuffix": "example-tail.ts.net", "MagicDNSEnabled": true },
      "Self": {
        "HostName": "Laptop", "DNSName": "laptop.example-tail.ts.net.", "OS": "macOS",
        "Online": true, "TailscaleIPs": ["fd7a:115c::1", "100.64.0.1"], "CurAddr": "", "Relay": "lhr"
      },
      "Peer": {
        "nodekey:a": {
          "HostName": "Phone", "DNSName": "phone.example-tail.ts.net.", "OS": "iOS",
          "Online": false, "LastSeen": "2026-09-01T10:00:00Z", "TailscaleIPs": ["100.64.0.3"]
        },
        "nodekey:b": {
          "HostName": "mac-mini-1", "DNSName": "mac-mini-1.example-tail.ts.net.", "OS": "macOS",
          "Online": true, "LastSeen": "0001-01-01T00:00:00Z", "TailscaleIPs": ["100.64.0.2"],
          "CurAddr": "192.0.2.10:41641", "Relay": "lhr"
        }
      }
    }"#;

    #[test]
    fn reads_a_running_tailnet_and_finds_the_host() {
        let s = parse_status(RUNNING, Some("mac-mini-1.example-tail.ts.net"));
        assert!(s.installed && s.running);
        assert_eq!(s.error, None);
        assert_eq!(s.tailnet.as_deref(), Some("demo@example.com"));
        assert_eq!(s.magic_dns_suffix.as_deref(), Some("example-tail.ts.net"));
        assert_eq!(s.health.len(), MAX_HEALTH);
        let me = s.self_node.expect("self");
        assert_eq!(me.dns_name, "laptop.example-tail.ts.net");
        assert_eq!(me.ip.as_deref(), Some("100.64.0.1"), "prefers IPv4");
        assert!(!me.direct);
        let host = s.host.expect("host");
        assert_eq!(host.name, "mac-mini-1");
        assert!(host.online && host.direct);
        assert_eq!(host.relay.as_deref(), Some("lhr"));
        assert_eq!(host.last_seen, None, "zero time means never");
    }

    #[test]
    fn matches_the_host_case_insensitively_or_by_machine_name() {
        let s = parse_status(RUNNING, Some("MAC-MINI-1.example-tail.ts.net."));
        assert_eq!(s.host.map(|h| h.name).as_deref(), Some("mac-mini-1"));
        let s = parse_status(RUNNING, Some("mac-mini-1.renamed.ts.net"));
        assert_eq!(s.host.map(|h| h.name).as_deref(), Some("mac-mini-1"));
        let s = parse_status(RUNNING, Some("somewhere-else.example-tail.ts.net"));
        assert_eq!(s.host, None);
        assert_eq!(parse_status(RUNNING, None).host, None);
    }

    #[test]
    fn explains_a_stopped_or_signed_out_tailscale() {
        let s = parse_status(r#"{"BackendState":"Stopped"}"#, None);
        assert!(s.installed && !s.running);
        assert_eq!(
            s.error.as_deref(),
            Some("Tailscale is turned off on this Mac.")
        );
        let s = parse_status(
            r#"{"BackendState":"NeedsLogin","Peer":null,"Health":null}"#,
            None,
        );
        assert!(!s.running);
        assert!(s.error.is_some_and(|e| e.contains("sign in")));
    }

    #[test]
    fn treats_garbage_as_not_running() {
        for bad in ["", "not json", "[]", "null", "\"Running\""] {
            let s = parse_status(bad, Some("mac-mini-1.example-tail.ts.net"));
            assert!(s.installed && !s.running, "{bad:?}");
            assert_eq!(s.error.as_deref(), Some(NOT_RUNNING), "{bad:?}");
        }
    }

    #[test]
    fn skips_nodes_without_a_name_and_bad_field_types() {
        let s = parse_status(
            r#"{"BackendState":"Running","Self":{"DNSName":7},"Peer":{"x":{"DNSName":"."},"y":{"DNSName":"ok.t.ts.net.","Online":"yes","TailscaleIPs":[1,"100.64.0.9"]}}}"#,
            Some("ok.t.ts.net"),
        );
        assert_eq!(s.self_node, None);
        let host = s.host.expect("host");
        assert!(!host.online, "non-bool Online reads as offline");
        assert_eq!(host.ip.as_deref(), Some("100.64.0.9"));
    }

    #[test]
    fn serializes_self_under_its_page_name() {
        let s = parse_status(RUNNING, None);
        let json = serde_json::to_value(&s).expect("json");
        assert!(json.get("self").is_some());
        assert!(json.get("magicDnsSuffix").is_some());
        assert!(json.get("selfNode").is_none());
    }
}
