//! Kleio — remote host support for gg-app. SPIKE.
//!
//! Everything Kleio-specific on the Rust side lives in this directory. `lib.rs`
//! touches it at three points only: `sidecar_base`, the shared client's default
//! headers, and the daemon spawn / SSE-bridge branch. Upstream sync stays a merge.
//!
//! Activation (spike): environment only.
//!   KLEIO_HOST_URL=https://mac-mini-1.<tailnet>.ts.net:8443
//!   KLEIO_DEVICE_TOKEN=<64 hex>
//! When both are set, no local sidecar is spawned; every sidecar call goes to
//! the host, authenticated with `x-kleio-device-token`; the SSE bridge resumes
//! with `Last-Event-ID` after any disconnect.

use std::sync::OnceLock;

pub struct Remote {
    /// Base URL without trailing slash, e.g. `https://host:8443`.
    pub base: String,
    pub device_token: String,
}

static REMOTE: OnceLock<Option<Remote>> = OnceLock::new();

/// Read once from the environment. `None` = normal local sidecar.
pub fn remote() -> Option<&'static Remote> {
    REMOTE
        .get_or_init(|| {
            let base = std::env::var("KLEIO_HOST_URL").ok()?;
            let device_token = std::env::var("KLEIO_DEVICE_TOKEN").ok()?;
            let base = base.trim_end_matches('/').to_string();
            if !(base.starts_with("https://") || base.starts_with("http://127.0.0.1"))
                || device_token.len() < 32
            {
                log::warn!("kleio: KLEIO_HOST_URL must be https (or loopback) and the token >= 32 chars; ignoring");
                return None;
            }
            log::info!("kleio: remote host mode → {base}");
            Some(Remote { base, device_token })
        })
        .as_ref()
}

#[derive(serde::Serialize)]
pub struct RemoteStatus {
    pub base: Option<String>,
}

#[tauri::command]
pub fn kleio_remote_status() -> RemoteStatus {
    RemoteStatus {
        base: remote().map(|r| r.base.clone()),
    }
}

/// Header the Kleio host checks instead of the sidecar's `x-gg-token`.
pub const DEVICE_TOKEN_HEADER: &str = "x-kleio-device-token";

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
