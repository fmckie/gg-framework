//! Tauri commands for pairing and admin. The pairing request runs here, in
//! Rust, so the device token never transits the webview; it goes straight
//! from the host's response into the Keychain.
//!
//! Wire contract is `packages/kleio-host/src/{pair-code,host}.ts`:
//!   POST /kleio/pair/redeem {code, redemptionNonce, label}
//!     200 {ok:true, payload:{baseUrl, host, token, label, deviceId, controlCredential?}}
//!     400|401|404 {ok:false, error}
//!   admin (device token + control macaroon):
//!     GET  /kleio/devices                → {devices:[...]}
//!     POST /kleio/devices/:id/revoke     → {devices:[...]}
//!     POST /kleio/pair/offer {admin?}    → {code, display, expiresAt, admin}

use super::biometric::{reason_for, BiometricGate, Denied};
use super::{keychain, store, CONTROL_HEADER, DEVICE_TOKEN_HEADER};
use std::time::Duration;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(15);

/// A pair-code redemption ticket from the host, validated field-by-field
/// (mirrors `isPairingPayload`). The host is untrusted input.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingPayload {
    base_url: String,
    host: String,
    token: String,
    label: String,
    device_id: String,
    #[serde(default)]
    control_credential: Option<String>,
}

fn validate_payload(p: &PairingPayload) -> Result<(), String> {
    let non_empty = |s: &str| !s.trim().is_empty();
    if !p.base_url.starts_with("https://") {
        return Err("host returned a non-https base URL".into());
    }
    if !(non_empty(&p.base_url)
        && non_empty(&p.host)
        && non_empty(&p.token)
        && non_empty(&p.label)
        && non_empty(&p.device_id))
    {
        return Err("host returned an incomplete pairing ticket".into());
    }
    if p.control_credential
        .as_deref()
        .is_some_and(|c| c.trim().is_empty())
    {
        return Err("host returned an empty control credential".into());
    }
    if !p
        .device_id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("host returned a malformed device id".into());
    }
    Ok(())
}

/// The user types the code; the host normalises confusables and case itself
/// (`normalizePairCode`), so only strip separators and reject the obviously wrong.
fn compact_code(raw: &str) -> Result<String, String> {
    let c: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    if c.len() != 6 || !c.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Pair codes are 6 letters/digits, like ABC-DEF.".into());
    }
    Ok(c.to_ascii_uppercase())
}

fn normalize_base(raw: &str) -> Result<String, String> {
    let b = raw.trim().trim_end_matches('/').to_string();
    if !b.starts_with("https://") {
        return Err("Host URL must start with https:// (Tailscale Serve terminates TLS).".into());
    }
    if b.len() < "https://x".len() || b["https://".len()..].contains('/') {
        return Err("Host URL should be just scheme, host and port — no path.".into());
    }
    Ok(b)
}

fn random_hex(bytes: usize) -> String {
    // uuid v4 is 16 random bytes; two of them cover any nonce size we use.
    let mut out = String::new();
    while out.len() < bytes * 2 {
        out.push_str(&uuid::Uuid::new_v4().simple().to_string());
    }
    out.truncate(bytes * 2);
    out
}

fn now_iso() -> String {
    // No chrono in the tree; seconds-since-epoch rendered as a fixed-format
    // ISO date is enough for a display-only field.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's days→civil; exact for the proleptic Gregorian calendar.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Pair this laptop to a host. Probes `/kleio/health` first so a typo in the
/// URL fails with a network message, not "code not recognised".
#[tauri::command]
pub async fn kleio_pair(
    base_url: String,
    code: String,
    label: String,
) -> Result<store::HostRecord, String> {
    let base = normalize_base(&base_url)?;
    let code = compact_code(&code)?;
    let label = label.trim().to_string();
    let label = if label.is_empty() {
        default_label()
    } else {
        label
    };

    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let health = client
        .get(format!("{base}/kleio/health"))
        .send()
        .await
        .map_err(|e| format!("Can't reach {base}: {}", root_cause(&e)))?;
    if !health.status().is_success() {
        return Err(format!(
            "{base} answered {} on /kleio/health — is that the Kleio host?",
            health.status()
        ));
    }

    let nonce = random_hex(16);
    let res = client
        .post(format!("{base}/kleio/pair/redeem"))
        .json(&serde_json::json!({ "code": code, "redemptionNonce": nonce, "label": label }))
        .send()
        .await
        .map_err(|e| format!("Pairing request failed: {}", root_cause(&e)))?;
    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Host sent an unreadable reply".to_string())?;
    if !status.is_success() || body.get("ok") != Some(&serde_json::Value::Bool(true)) {
        return Err(match body.get("error").and_then(|e| e.as_str()) {
            Some("not_found") => {
                "No pair code is active on the host. Run `kleio-host pair` there first.".into()
            }
            Some("unauthorized") => {
                "Code not recognised, or it expired. Mint a fresh one on the host.".into()
            }
            Some(other) => format!("Host refused the code ({other})."),
            None => format!("Host refused the code (HTTP {status})."),
        });
    }
    let payload: PairingPayload =
        serde_json::from_value(body.get("payload").cloned().unwrap_or_default())
            .map_err(|_| "Host sent a malformed pairing ticket".to_string())?;
    validate_payload(&payload)?;
    if payload.base_url != base {
        // Not fatal — Serve may advertise a canonical name — but the record
        // must carry the URL the host wants us to use from now on.
        log::info!(
            "kleio: host advertises {} (entered {base})",
            payload.base_url
        );
    }

    let admin = payload.control_credential.is_some();
    keychain::put(&payload.host, keychain::Secret::DeviceToken, &payload.token)?;
    if let Some(c) = payload.control_credential.as_deref() {
        keychain::put(&payload.host, keychain::Secret::ControlCredential, c)?;
    } else {
        keychain::delete(&payload.host, keychain::Secret::ControlCredential)?;
    }
    let rec = store::HostRecord {
        base_url: payload.base_url,
        host: payload.host,
        device_id: payload.device_id,
        label: payload.label,
        admin,
        paired_at: now_iso(),
    };
    store::save(&crate::home_dir(), &rec)?;
    log::info!(
        "kleio: paired to {} as {} (admin={admin}); takes effect on restart",
        rec.host,
        rec.label
    );
    Ok(rec)
}

/// Drop the pairing: Keychain items and the record. The host still lists the
/// device until an admin revokes it there.
#[tauri::command]
pub fn kleio_forget() -> Result<(), String> {
    let home = crate::home_dir();
    if let Some(rec) = store::load(&home) {
        keychain::delete(&rec.host, keychain::Secret::DeviceToken)?;
        keychain::delete(&rec.host, keychain::Secret::ControlCredential)?;
    }
    store::clear(&home)
}

fn default_label() -> String {
    std::process::Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Laptop".to_string())
}

fn root_cause(e: &reqwest::Error) -> String {
    let mut src: &dyn std::error::Error = e;
    while let Some(next) = src.source() {
        src = next;
    }
    src.to_string()
}

// ─── admin ────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminError {
    pub kind: &'static str,
    pub message: String,
}

fn gated(gate: &BiometricGate, op: &str) -> Result<(), AdminError> {
    gate.ensure_unlocked(&reason_for(Some(op)), false)
        .map_err(|d| AdminError {
            kind: match d {
                Denied::Unavailable => "unavailable",
                Denied::Denied => "denied",
            },
            message: match d {
                Denied::Unavailable => {
                    "Touch ID isn't available on this Mac, so admin actions are locked.".into()
                }
                Denied::Denied => "Touch ID was cancelled or didn't match.".into(),
            },
        })
}

fn admin_remote() -> Result<&'static super::Remote, AdminError> {
    match super::remote() {
        Some(r) if r.admin => Ok(r),
        Some(_) => Err(AdminError {
            kind: "forbidden",
            message: "This device isn't an admin on the host.".into(),
        }),
        None => Err(AdminError {
            kind: "not_remote",
            message: "Not connected to a Kleio host.".into(),
        }),
    }
}

fn admin_client(r: &super::Remote) -> Result<reqwest::Client, AdminError> {
    let mut h = reqwest::header::HeaderMap::new();
    let hv = |s: &str| {
        reqwest::header::HeaderValue::from_str(s).map_err(|_| AdminError {
            kind: "internal",
            message: "credential is not header-safe".into(),
        })
    };
    h.insert(DEVICE_TOKEN_HEADER, hv(&r.device_token)?);
    if let Some(c) = r.control_credential.as_deref() {
        h.insert(CONTROL_HEADER, hv(c)?);
    }
    reqwest::Client::builder()
        .default_headers(h)
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| AdminError {
            kind: "internal",
            message: e.to_string(),
        })
}

async fn admin_json(req: reqwest::RequestBuilder) -> Result<serde_json::Value, AdminError> {
    let res = req.send().await.map_err(|e| AdminError {
        kind: "network",
        message: root_cause(&e),
    })?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    if !status.is_success() {
        let msg = body
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("request failed");
        return Err(AdminError {
            kind: if status == 403 {
                "forbidden"
            } else if status == 401 {
                "unauthorized"
            } else {
                "host"
            },
            message: format!("{msg} (HTTP {status})"),
        });
    }
    Ok(body)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub device_id: String,
    pub label: String,
    pub created: String,
    pub last_seen: Option<String>,
    pub revoked: bool,
    #[serde(default)]
    pub admin: bool,
    /// True for the device this app is running as; the UI disables its Revoke.
    #[serde(default)]
    pub this_device: bool,
}

fn devices_from(body: &serde_json::Value, me: &str) -> Result<Vec<Device>, AdminError> {
    let mut v: Vec<Device> =
        serde_json::from_value(body.get("devices").cloned().unwrap_or_default()).map_err(|_| {
            AdminError {
                kind: "host",
                message: "malformed device list".into(),
            }
        })?;
    for d in &mut v {
        d.this_device = d.device_id == me;
    }
    Ok(v)
}

#[tauri::command]
pub async fn kleio_devices(gate: State<'_, BiometricGate>) -> Result<Vec<Device>, AdminError> {
    let r = admin_remote()?;
    gated(&gate, "list devices")?;
    let body = admin_json(admin_client(r)?.get(format!("{}/kleio/devices", r.base))).await?;
    devices_from(&body, &r.device_id)
}

#[tauri::command]
pub async fn kleio_revoke(
    gate: State<'_, BiometricGate>,
    device_id: String,
) -> Result<Vec<Device>, AdminError> {
    let r = admin_remote()?;
    if device_id == r.device_id {
        return Err(AdminError {
            kind: "self",
            message: "Use \"Forget host\" to disconnect this device.".into(),
        });
    }
    if !device_id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(AdminError {
            kind: "bad_request",
            message: "malformed device id".into(),
        });
    }
    gated(&gate, "revoke a device")?;
    let body =
        admin_json(admin_client(r)?.post(format!("{}/kleio/devices/{device_id}/revoke", r.base)))
            .await?;
    devices_from(&body, &r.device_id)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub display: String,
    pub expires_at: u64,
    pub admin: bool,
}

#[tauri::command]
pub async fn kleio_offer(gate: State<'_, BiometricGate>, admin: bool) -> Result<Offer, AdminError> {
    let r = admin_remote()?;
    gated(
        &gate,
        if admin {
            "mint an admin pair code"
        } else {
            "mint a pair code"
        },
    )?;
    let body = admin_json(
        admin_client(r)?
            .post(format!("{}/kleio/pair/offer", r.base))
            .json(&serde_json::json!({ "admin": admin })),
    )
    .await?;
    Ok(Offer {
        display: body
            .get("display")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        expires_at: body.get("expiresAt").and_then(|v| v.as_u64()).unwrap_or(0),
        admin: body.get("admin").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

#[tauri::command]
pub fn kleio_admin_state(gate: State<'_, BiometricGate>) -> super::biometric::UnlockState {
    gate.state()
}

#[tauri::command]
pub fn kleio_admin_lock(gate: State<'_, BiometricGate>) {
    gate.lock();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(base: &str, cred: Option<&str>) -> PairingPayload {
        PairingPayload {
            base_url: base.into(),
            host: "mac-mini-1.x.ts.net".into(),
            token: "t".repeat(64),
            label: "Laptop".into(),
            device_id: "dev-1".into(),
            control_credential: cred.map(str::to_string),
        }
    }

    #[test]
    fn payload_validation_mirrors_is_pairing_payload() {
        assert!(validate_payload(&payload("https://h:8443", None)).is_ok());
        assert!(validate_payload(&payload("https://h:8443", Some("mac1.x"))).is_ok());
        assert!(validate_payload(&payload("http://h:8443", None)).is_err());
        assert!(validate_payload(&payload("https://h:8443", Some(""))).is_err());
        let mut p = payload("https://h:8443", None);
        p.device_id = "../x".into();
        assert!(validate_payload(&p).is_err());
        p.device_id = "dev-1".into();
        p.token = " ".into();
        assert!(validate_payload(&p).is_err());
    }

    #[test]
    fn code_and_base_normalisation() {
        assert_eq!(compact_code(" abc-def ").unwrap(), "ABCDEF");
        assert_eq!(compact_code("ABC DEF").unwrap(), "ABCDEF");
        assert!(compact_code("ABCDE").is_err());
        assert!(compact_code("ABC-DE!").is_err());
        assert_eq!(
            normalize_base(" https://h:8443/ ").unwrap(),
            "https://h:8443"
        );
        assert!(normalize_base("http://h:8443").is_err());
        assert!(normalize_base("https://h:8443/kleio").is_err());
    }

    #[test]
    fn nonce_is_32_lowercase_hex() {
        let n = random_hex(16);
        assert_eq!(n.len(), 32);
        assert!(n.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        assert_ne!(n, random_hex(16));
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(20_718), (2026, 9, 22));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod live {
    //! Against the real mini. `KLEIO_LIVE_BASE=https://… KLEIO_LIVE_CODE=ABC-DEF cargo test --lib live_pair -- --ignored --nocapture`.
    use super::*;

    #[test]
    #[ignore]
    fn live_pair() {
        tauri::async_runtime::block_on(live_pair_inner());
    }

    async fn live_pair_inner() {
        // The app does this once at boot; the test has no boot.
        crate::install_rustls_provider();
        let base = std::env::var("KLEIO_LIVE_BASE").expect("KLEIO_LIVE_BASE");
        let code = std::env::var("KLEIO_LIVE_CODE").expect("KLEIO_LIVE_CODE");
        let rec = kleio_pair(base, code, "Step-4 laptop".into())
            .await
            .expect("pair");
        eprintln!("paired: {rec:?}");
        assert!(rec.admin, "expected an admin ticket");
        // Both secrets landed in the Keychain; the record is on disk; the
        // next process would boot remote.
        assert!(keychain::get(&rec.host, keychain::Secret::DeviceToken)
            .unwrap()
            .is_some());
        assert!(
            keychain::get(&rec.host, keychain::Secret::ControlCredential)
                .unwrap()
                .is_some()
        );
        assert_eq!(store::load(&crate::home_dir()).as_ref(), Some(&rec));
        let r = super::super::from_store().expect("from_store resolves");
        assert!(r.admin && r.control_credential.is_some());
        // And the credentials actually authenticate: list devices as admin.
        let client = reqwest::Client::new();
        let res = client
            .get(format!("{}/kleio/devices", r.base))
            .header(DEVICE_TOKEN_HEADER, &r.device_token)
            .header(CONTROL_HEADER, r.control_credential.as_deref().unwrap())
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        let body: serde_json::Value = res.json().await.unwrap();
        eprintln!(
            "devices: {}",
            serde_json::to_string_pretty(&body["devices"]).unwrap()
        );
    }
}
