//! Kleio — remote host support for gg-app.
//!
//! Everything Kleio-specific on the Rust side lives in this directory. `lib.rs`
//! touches it at three points only: `sidecar_base`, the shared client's default
//! headers, and the daemon spawn / SSE-bridge branch. Upstream sync stays a merge.
//!
//! Activation, in priority order, decided once at boot:
//!   1. Environment (dev override): KLEIO_HOST_URL + KLEIO_DEVICE_TOKEN.
//!   2. A paired host: `~/.gg/kleio-remote.json` (`store.rs`) plus the device
//!      token from the login Keychain (`keychain.rs`). Pairing happens in the
//!      app (`commands.rs`) and takes effect on the next launch.
//!   3. Neither → normal local sidecar. Nothing below is touched.
//! When remote, no local sidecar is spawned; every sidecar call goes to the
//! host, authenticated with `x-kleio-device-token` (and `x-kleio-control` for
//! admin devices); the SSE bridge resumes with `Last-Event-ID`.

pub mod biometric;
pub mod commands;
pub mod keychain;
pub mod store;

use std::sync::OnceLock;

pub struct Remote {
    /// Base URL without trailing slash, e.g. `https://host:8443`.
    pub base: String,
    /// Tailnet host name as the host reports it.
    pub host: String,
    pub device_id: String,
    pub label: String,
    pub device_token: String,
    /// Control macaroon, present only for admin devices.
    pub control_credential: Option<String>,
    pub admin: bool,
}

static REMOTE: OnceLock<Option<Remote>> = OnceLock::new();

/// Decided once per process. `None` = normal local sidecar.
pub fn remote() -> Option<&'static Remote> {
    REMOTE
        .get_or_init(|| from_env().or_else(from_store))
        .as_ref()
}

fn from_env() -> Option<Remote> {
    let base = std::env::var("KLEIO_HOST_URL").ok()?;
    let device_token = std::env::var("KLEIO_DEVICE_TOKEN").ok()?;
    let base = base.trim_end_matches('/').to_string();
    if !(base.starts_with("https://") || base.starts_with("http://127.0.0.1"))
        || device_token.len() < 32
    {
        log::warn!(
            "kleio: KLEIO_HOST_URL must be https (or loopback) and the token >= 32 chars; ignoring"
        );
        return None;
    }
    log::info!("kleio: remote host mode (env) → {base}");
    let host = base
        .split("//")
        .nth(1)
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_string();
    Some(Remote {
        base,
        host,
        device_id: String::new(),
        label: String::from("env"),
        device_token,
        control_credential: std::env::var("KLEIO_CONTROL_CREDENTIAL").ok(),
        admin: false,
    })
}

fn from_store() -> Option<Remote> {
    let rec = store::load(&crate::home_dir())?;
    let device_token = match keychain::get(&rec.host, keychain::Secret::DeviceToken) {
        Ok(Some(t)) => t,
        Ok(None) => {
            log::warn!(
                "kleio: paired to {} but its token is not in the Keychain; staying local",
                rec.host
            );
            return None;
        }
        Err(e) => {
            log::warn!("kleio: {e}; staying local");
            return None;
        }
    };
    let control_credential = if rec.admin {
        keychain::get(&rec.host, keychain::Secret::ControlCredential)
            .ok()
            .flatten()
    } else {
        None
    };
    log::info!("kleio: remote host mode → {} ({})", rec.base_url, rec.label);
    Some(Remote {
        base: rec.base_url,
        host: rec.host,
        device_id: rec.device_id,
        label: rec.label,
        device_token,
        admin: rec.admin,
        control_credential,
    })
}

/// What the webview sees. `active` is what THIS process booted with; `paired`
/// is what is on disk now — they differ between pairing/forgetting and the
/// restart that applies it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub active: Option<ActiveRemote>,
    pub paired: Option<store::HostRecord>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRemote {
    pub base: String,
    pub host: String,
    pub device_id: String,
    pub label: String,
    pub admin: bool,
}

#[tauri::command]
pub fn kleio_remote_status() -> RemoteStatus {
    RemoteStatus {
        active: remote().map(|r| ActiveRemote {
            base: r.base.clone(),
            host: r.host.clone(),
            device_id: r.device_id.clone(),
            label: r.label.clone(),
            admin: r.admin,
        }),
        paired: store::load(&crate::home_dir()),
    }
}

/// Header the Kleio host checks instead of the sidecar's `x-gg-token`.
pub const DEVICE_TOKEN_HEADER: &str = "x-kleio-device-token";
/// Control macaroon header; admin routes accept it as an alternative to the
/// device's own admin flag.
pub const CONTROL_HEADER: &str = "x-kleio-control";

/// Port placeholder reported to the webview when remote. The frontend only uses
/// the port as a readiness signal and passes it back to Rust commands.
pub const REMOTE_PORT_SENTINEL: u16 = 1;

/// Parse the `id:` line from one SSE frame, if any.
pub fn sse_frame_id(frame: &str) -> Option<u64> {
    frame
        .lines()
        .find_map(|l| l.strip_prefix("id: ").or_else(|| l.strip_prefix("id:")))
        .and_then(|v| v.trim().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_id_line() {
        assert_eq!(sse_frame_id("id: 42\ndata: {}"), Some(42));
        assert_eq!(sse_frame_id("data: {}"), None);
        assert_eq!(sse_frame_id("id:7\ndata: {}"), Some(7));
    }
}

// ── Host-owned settings ─────────────────────────────────────────────────────
// The sidecar's /settings is the HOST's `~/.gg/gg-app.json`. Session-scoped
// like every other sidecar route; the managed client carries the device token.

/// Marker cwd for "let the host's sidecar pick": never sent on the wire.
pub const HOST_DEFAULT_CWD: &str = "kleio://host-default";

pub async fn host_settings(
    client: &reqwest::Client,
    base: &str,
    gg_sid: &str,
) -> Result<serde_json::Value, String> {
    let res = client
        .get(format!("{base}/settings"))
        .header("x-gg-session", gg_sid)
        .send()
        .await
        .map_err(|e| format!("host settings: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("host settings: HTTP {}", res.status()));
    }
    res.json().await.map_err(|e| format!("host settings: {e}"))
}

pub async fn host_settings_save(
    client: &reqwest::Client,
    base: &str,
    gg_sid: &str,
    projects_root: &str,
) -> Result<serde_json::Value, String> {
    let res = client
        .post(format!("{base}/settings"))
        .header("x-gg-session", gg_sid)
        .json(&serde_json::json!({ "projectsRoot": projects_root }))
        .send()
        .await
        .map_err(|e| format!("host settings: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("host settings: HTTP {}", res.status()));
    }
    res.json().await.map_err(|e| format!("host settings: {e}"))
}
