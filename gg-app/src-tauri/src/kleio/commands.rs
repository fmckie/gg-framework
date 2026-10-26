//! Tauri commands for pairing and admin. The pairing request runs here, in
//! Rust, so the device token never transits the webview; it goes straight
//! from the host's response into the Keychain.
//!
//! Wire contract is `packages/kleio-host/src/{pair-code,host}.ts`:
//!   POST /kleio/pair/redeem {code, redemptionNonce, label}
//!     200 {ok:true, payload:{baseUrl?, host, token, label, deviceId, controlCredential?,
//!                            previewOrigin?}}
//!     (no baseUrl for a device paired over Kleio's link)
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
pub(super) struct PairingPayload {
    /// Empty for a device paired over Kleio's link: its token is no use off
    /// the link, so kleio-host gives it no address.
    #[serde(default)]
    pub(super) base_url: String,
    pub(super) host: String,
    pub(super) token: String,
    pub(super) label: String,
    pub(super) device_id: String,
    #[serde(default)]
    pub(super) control_credential: Option<String>,
    /// Where the host's site previews open; absent from a host without them.
    #[serde(default)]
    pub(super) preview_origin: Option<String>,
}

impl PairingPayload {
    /// The preview origin the pairing keeps: the host's, if it's one this
    /// build opens previews at (`files::preview_origin`). One it won't is
    /// left out, and logged: previews are optional, the pairing isn't.
    pub(super) fn kept_preview_origin(&self) -> Option<String> {
        let given = self.preview_origin.as_deref()?;
        let kept = super::files::preview_origin(given);
        if kept.is_none() {
            log::warn!("kleio: the host's preview origin isn't one Kleio opens; no site previews");
        }
        kept
    }
}

fn validate_payload(p: &PairingPayload) -> Result<(), String> {
    if !super::host_url_allowed(&p.base_url) {
        return Err("host returned a non-https base URL".into());
    }
    validate_device(p)
}

/// Everything but the base URL: the host's name, the device's token, label
/// and id, and the control credential if there is one.
fn validate_device(p: &PairingPayload) -> Result<(), String> {
    let non_empty = |s: &str| !s.trim().is_empty();
    if !(non_empty(&p.host)
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

/// The payload of a redeem answer that said `ok: true`, checked as
/// `kleio_pair` checks it. The link's pairing (`link.rs`) reads its answer
/// with [`checked_link_payload`], which gives the same errors.
pub(super) fn checked_payload(payload: serde_json::Value) -> Result<PairingPayload, String> {
    let payload: PairingPayload = serde_json::from_value(payload)
        .map_err(|_| "Host sent a malformed pairing ticket".to_string())?;
    validate_payload(&payload)?;
    Ok(payload)
}

/// [`checked_payload`] for a pairing over Kleio's link (`link.rs`), whose
/// payload has no base URL: the link is the way to the host.
#[cfg(any(target_os = "macos", target_os = "ios", test))]
pub(super) fn checked_link_payload(payload: serde_json::Value) -> Result<PairingPayload, String> {
    let payload: PairingPayload = serde_json::from_value(payload)
        .map_err(|_| "Host sent a malformed pairing ticket".to_string())?;
    validate_device(&payload)?;
    Ok(payload)
}

/// Puts a pairing's secrets in the Keychain under `host`: the device token,
/// and the control credential if one came, or else drops an old one.
pub(super) fn keep_secrets(host: &str, payload: &PairingPayload) -> Result<(), String> {
    keychain::put(host, keychain::Secret::DeviceToken, &payload.token)?;
    if let Some(c) = payload.control_credential.as_deref() {
        keychain::put(host, keychain::Secret::ControlCredential, c)
    } else {
        keychain::delete(host, keychain::Secret::ControlCredential)
    }
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

/// The address typed into "Connect over your own network" (`kleio_pair`), as
/// the base every request goes to: `https://<host>[:<port>]`, lower-case, with
/// a trailing slash dropped. Any https host passes, on the Mac and the iPhone:
/// Tailscale, another VPN or a home network's TLS proxy. Refused, each with
/// why: http (but, in a debug build, exactly `http://127.0.0.1:<port>`, a host
/// on this Mac), a username or password, a path, query or fragment, and an
/// empty, IP-literal or odd host name. A pairing QR code's address stays
/// Tailscale's only (`tailnetBase` in `src/kleio/pairTicket.ts`).
///
/// The certificate isn't checked here: the TLS handshake checks it, against the
/// system's trust store, and nothing in Kleio accepts one that isn't publicly
/// trusted. A proxy with a self-signed certificate fails at the first request.
fn normalize_base(raw: &str) -> Result<String, String> {
    typed_base_in(raw, cfg!(debug_assertions))
}

fn typed_base_in(raw: &str, debug_build: bool) -> Result<String, String> {
    let typed = raw.trim();
    let b = typed.strip_suffix('/').unwrap_or(typed);
    if debug_build && super::is_loopback_http(b) {
        return Ok(b.to_string());
    }
    let Some(rest) = b.strip_prefix("https://") else {
        return Err(if b.to_ascii_lowercase().starts_with("http://") {
            "Use an https:// address: Kleio doesn't send your device's token over plain http."
        } else {
            "The host's address starts with https://, such as https://mac-mini.your-tailnet.ts.net:8443."
        }
        .into());
    };
    if rest.contains(['/', '?', '#', '\\']) {
        return Err("Just the host's address and port, with nothing after it, such as https://mac-mini.example.com:8443.".into());
    }
    if rest.contains('@') {
        return Err("The address can't hold a username or password.".into());
    }
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if let Some(port) = port {
        let plain = !port.is_empty()
            && !port.starts_with('0')
            && port.bytes().all(|b| b.is_ascii_digit())
            && port.parse::<u16>().is_ok();
        if !plain {
            return Err("The port is a number from 1 to 65535.".into());
        }
    }
    if !is_host_name(host) {
        return Err(
            "That isn't a host name Kleio can pair with, such as mac-mini.your-tailnet.ts.net."
                .into(),
        );
    }
    let host = host.to_ascii_lowercase();
    Ok(match port {
        Some(p) => format!("https://{host}:{p}"),
        None => format!("https://{host}"),
    })
}

/// A DNS host name: dot-separated labels of letters, digits and hyphens, each
/// 1-63 long and not starting or ending with a hyphen, at most 253 in all, with
/// a letter somewhere so it isn't an IP address. One trailing dot is allowed.
fn is_host_name(host: &str) -> bool {
    let h = host.strip_suffix('.').unwrap_or(host);
    !h.is_empty()
        && h.len() <= 253
        && h.bytes().any(|b| b.is_ascii_alphabetic())
        && h.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
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

pub(super) fn now_iso() -> String {
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
    let label = label_or_default(&label);

    let client = host_client(&super::Transport::Url)
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
    let payload = checked_payload(body.get("payload").cloned().unwrap_or_default())?;
    if payload.base_url != base {
        // Not fatal — Serve may advertise a canonical name — but the record
        // must carry the URL the host wants us to use from now on.
        log::info!(
            "kleio: host advertises {} (entered {base})",
            payload.base_url
        );
    }

    let admin = payload.control_credential.is_some();
    keep_secrets(&payload.host, &payload)?;
    let preview_origin = payload.kept_preview_origin();
    let rec = store::HostRecord {
        base_url: payload.base_url,
        host: payload.host,
        device_id: payload.device_id,
        label: payload.label,
        admin,
        paired_at: now_iso(),
        preview_origin,
    };
    let home = crate::home_dir();
    store::save(&home, &rec)?;
    // kleio (macOS and iPhone): a link pairing wins at boot, so pairing by
    // the host's address sets it aside (the Connection page's "Advanced:
    // connect over your own network"). The host lists it until an admin
    // revokes it, as after Forget host.
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let replaced = super::link::forget(&home)
            .map_err(|e| format!("Paired, but Kleio couldn't set its link pairing aside: {e}"))?;
        if replaced {
            log::info!("kleio: the pairing by address replaces the link pairing");
        }
    }
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
    // kleio (macOS and iPhone): the link pairing, while there's one, is the
    // pairing shown and the next launch uses, so it's the one forgotten.
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    if super::link::forget(&home)? {
        return Ok(());
    }
    if let Some(rec) = store::load(&home) {
        keychain::delete(&rec.host, keychain::Secret::DeviceToken)?;
        keychain::delete(&rec.host, keychain::Secret::ControlCredential)?;
    }
    store::clear(&home)
}

/// The device name the user typed, or else this device's own.
pub(super) fn label_or_default(raw: &str) -> String {
    let label = raw.trim();
    if label.is_empty() {
        default_label()
    } else {
        label.to_string()
    }
}

fn default_label() -> String {
    // An iPhone app cannot run `scutil` (or any other program).
    if cfg!(target_os = "ios") {
        return "iPhone".to_string();
    }
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

pub(super) fn root_cause(e: &reqwest::Error) -> String {
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

/// The start of every client that talks to a host, so each reaches it the
/// same way: a link pairing's over the link's socket, which only this process
/// can use ([`super::LINK_BASE`] names the host, and is never looked up), and
/// anything else at its URL.
///
/// No redirect is followed: the host never sends one, and a request carrying
/// this device's token, or its control credential, never goes on to anywhere
/// else. reqwest strips only standard credentials (`Authorization` and
/// cookies) on a redirect to another origin, not Kleio's own headers.
pub(crate) fn host_client(transport: &super::Transport) -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    match transport {
        super::Transport::Url => builder,
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        super::Transport::Link(boot) => builder.unix_socket(boot.socket()),
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
    host_client(&r.transport)
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

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub display: String,
    pub expires_at: u64,
    pub admin: bool,
    /// The link's pairing ticket for this code: what the QR code and the
    /// pairing text carry. None from a host without the link, or while its
    /// link can't pair, when `ticket_error` says why.
    pub ticket: Option<String>,
    /// Why there's no ticket: `no_link`, `link_down`, `config` or `ticket`.
    /// None with a ticket, and from a host from before the link, which sends
    /// neither.
    pub ticket_error: Option<String>,
}

/// An offer, as `POST /kleio/pair/offer` answers it.
fn offer_from(body: &serde_json::Value) -> Offer {
    let text = |key: &str| body.get(key).and_then(|v| v.as_str()).map(str::to_string);
    Offer {
        display: text("display").unwrap_or_default(),
        expires_at: body.get("expiresAt").and_then(|v| v.as_u64()).unwrap_or(0),
        admin: body.get("admin").and_then(|v| v.as_bool()).unwrap_or(false),
        ticket: text("ticket"),
        ticket_error: text("ticketError"),
    }
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
    Ok(offer_from(&body))
}

#[tauri::command]
pub fn kleio_admin_state(gate: State<'_, BiometricGate>) -> super::biometric::UnlockState {
    gate.state()
}

#[tauri::command]
pub fn kleio_admin_lock(gate: State<'_, BiometricGate>) {
    gate.lock();
}

// ─── product routes (Kleio / Blobs / Groups / Apps panes) ─────────────────
//
// One generic, device-authenticated call for the phone-app product routes the
// desktop mirrors. Deliberately NOT the shared proxy client: that one also
// carries the admin control credential, which these routes never need. The
// allow-list below is the whole attack surface — the webview can't reach any
// other host route (pairing, devices, schedules, the OAuth callback) through it.

/// Blob create/patch waits for the auto-schedule model call (~25 s on the host).
const API_TIMEOUT: Duration = Duration::from_secs(60);

/// How long one call may take: the caller's own deadline when it gives one (a
/// reachability check wants an answer in seconds, not a minute, when the Mac
/// mini has dropped off Tailscale), kept between 1 s and `API_TIMEOUT`.
fn api_timeout(ms: Option<u64>) -> Duration {
    ms.map_or(API_TIMEOUT, |ms| {
        Duration::from_millis(ms).clamp(Duration::from_secs(1), API_TIMEOUT)
    })
}

/// Ordinary sidecar routes the pane may call against a specific session (the
/// home thread or a Blob's chat): the compact chat view. `/memories` (and
/// below) is matched separately.
const SESSION_ROUTES: &[&str] = &["/state", "/history", "/prompt", "/cancel"];

#[derive(serde::Serialize, Debug)]
pub struct ApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

fn safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~'))
}

fn safe_query(q: &str) -> bool {
    q.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'-' | b'_' | b'.' | b'~' | b'=' | b'&' | b'%' | b'+' | b':' | b','
            )
    })
}

/// Session ids are sidecar UUID-ish tokens; anything else never reaches a header.
pub(crate) fn safe_session(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

/// An `ask_user` id as the sidecar mints them: `ask-` + 1..=9 digits.
fn safe_ask_id(id: &str) -> bool {
    id.strip_prefix("ask-")
        .is_some_and(|n| (1..=9).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_digit()))
}

/// `true` when `segs` (the path split on `/`) is `root` itself or below it.
fn under(segs: &[&str], root: &[&str]) -> bool {
    segs.len() >= root.len() && segs[..root.len()] == *root
}

/// The allow-list. `Ok(true)` = a session-scoped route (needs `session`),
/// `Ok(false)` = a product route (must not carry one).
fn check_route(method: &str, path: &str, session: Option<&str>) -> Result<bool, String> {
    if !matches!(method, "GET" | "POST" | "PATCH" | "PUT" | "DELETE") {
        return Err(format!("kleio_api: method {method} not allowed"));
    }
    let (p, q) = match path.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (path, None),
    };
    let reject = || Err(format!("kleio_api: path not allowed: {path}"));
    let Some(rest) = p.strip_prefix('/') else {
        return reject();
    };
    let segs: Vec<&str> = rest.split('/').collect();
    if !segs.iter().all(|s| safe_segment(s)) || q.is_some_and(|q| !safe_query(q)) {
        return reject();
    }
    let product = matches!(
        segs.as_slice(),
        ["kleio", "home"]
            | ["kleio", "home", "new"]
            | ["kleio", "chats"]
            | ["kleio", "models"]
            | ["kleio", "health"]
            // The host's OS and whether it stays on, for the app's words
            // when it can't be reached (connectionDiagnosis.ts).
            | ["kleio", "host"]
            | ["kleio", "brief"]
            // Whether notifications quote what was said: any device reads it,
            // an admin device changes it (kleio-host notification-settings.ts).
            | ["kleio", "notifications"]
            | ["kleio", "voice"]
            | ["kleio", "voice", "key"]
            | ["kleio", "voice", "settings"]
            | ["kleio", "voice", "brain"]
            | ["kleio", "voice", "files"]
            | ["kleio", "voice", "files", "read"]
            // Settings → Setup: the status, an admin's Composio/Typesafe keys,
            // and dictation's speech model (its status, and starting its download).
            | ["kleio", "setup"]
            | ["kleio", "setup", "keys", "composio" | "typesafe"]
            | ["kleio", "setup", "dictation"]
            | ["kleio", "sessions"]
            | ["kleio", "sessions", _]
            | ["kleio", "projects"]
            | ["kleio", "projects", "code"]
    ) || under(&segs, &["kleio", "blobs"])
        || under(&segs, &["kleio", "groups"])
        || (under(&segs, &["kleio", "connections"])
            && !under(&segs, &["kleio", "connections", "callback"]));
    // Her voice's shows (kleio-host show.ts): POST makes one, GET …/<id>
    // says how it is, each with its own method and no query. A show's parts
    // (its text, picture or pages) come through `kleio_show_part` (show.rs).
    let show = q.is_none()
        && match segs.as_slice() {
            ["kleio", "voice", "show"] => method == "POST",
            ["kleio", "voice", "show", id] => method == "GET" && super::show::valid_show_id(id),
            _ => false,
        };
    let product = product || show;
    // Answering an `ask_user` band: POST /ask/ask-<n>, nothing else under /ask.
    let ask = method == "POST"
        && q.is_none()
        && matches!(segs.as_slice(), ["ask", id] if safe_ask_id(id));
    let scoped = under(&segs, &["memories"]) || SESSION_ROUTES.contains(&p) || ask;
    match (product, scoped, session) {
        (true, _, None) => Ok(false),
        (true, _, Some(_)) => Err("kleio_api: product routes take no session".into()),
        (false, true, Some(s)) if safe_session(s) => Ok(true),
        (false, true, Some(_)) => Err("kleio_api: bad session id".into()),
        (false, true, None) => Err(format!("kleio_api: {p} needs a session")),
        _ => reject(),
    }
}

/// A one-off client for a Live Activity answer or a Siri briefing (brief.rs):
/// short timeout (iOS gives an intent little time), the device token from `r`.
#[cfg(target_os = "ios")]
pub(super) fn answer_client(r: &super::Remote) -> Result<reqwest::Client, String> {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        DEVICE_TOKEN_HEADER,
        reqwest::header::HeaderValue::from_str(&r.device_token)
            .map_err(|_| "device token is not header-safe".to_string())?,
    );
    host_client(&r.transport)
        .default_headers(h)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

pub(super) fn api_client(r: &super::Remote) -> Result<&'static reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        DEVICE_TOKEN_HEADER,
        reqwest::header::HeaderValue::from_str(&r.device_token)
            .map_err(|_| "device token is not header-safe".to_string())?,
    );
    let c = host_client(&r.transport)
        .default_headers(h)
        .timeout(API_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| c))
}

/// Device-authenticated call to a Kleio product route (remote mode only).
/// Non-2xx statuses are returned, not raised, so the pane can tell a 404
/// ("stale session, re-open") from a 502 ("model unavailable").
#[tauri::command]
pub async fn kleio_api(
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    session: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<ApiResponse, String> {
    let r = super::remote().ok_or("kleio_api: not connected to a Kleio host")?;
    let method = method.to_ascii_uppercase();
    let scoped = check_route(&method, &path, session.as_deref())?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = api_client(r)?
        .request(m, format!("{}{}", r.base, path))
        .timeout(api_timeout(timeout_ms));
    if scoped {
        if let Some(s) = session.as_deref() {
            req = req.header("x-gg-session", s);
        }
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| root_cause(&e))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| root_cause(&e))?;
    let body = if text.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text))
    };
    Ok(ApiResponse { status, body })
}

/// The most SDP a voice call offer may carry (the host takes up to 64 KB).
const VOICE_SDP_MAX: usize = 64 * 1024;

/// Starts a conversation with Kleio's voice (packages/kleio-host/src/voice.ts):
/// sends this device's WebRTC offer to the host, which adds the OpenAI key and
/// the session and returns OpenAI's answer. SDP is plain text, so this is not
/// `kleio_api`. A non-2xx status comes back with the host's JSON error.
///
/// `mic`: `near` (a phone, or a headset) or `far` (a laptop or desk
/// microphone), so OpenAI filters the right kind of background noise.
#[tauri::command]
pub async fn kleio_voice_call(sdp: String, mic: Option<String>) -> Result<ApiResponse, String> {
    let r = super::remote().ok_or("kleio_voice_call: not connected to a Kleio host")?;
    if !sdp.starts_with("v=") || sdp.len() > VOICE_SDP_MAX {
        return Err("kleio_voice_call: not a WebRTC offer".into());
    }
    let mic = match mic.as_deref() {
        None | Some("near") => "near",
        Some("far") => "far",
        Some(_) => return Err("kleio_voice_call: mic is near or far".into()),
    };
    let started = std::time::Instant::now();
    let res = api_client(r)?
        .post(format!("{}/kleio/voice/call?mic={mic}", r.base))
        .header(reqwest::header::CONTENT_TYPE, "application/sdp")
        .body(sdp)
        .send()
        .await
        .map_err(|e| root_cause(&e))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| root_cause(&e))?;
    log::info!(
        "kleio: voice call status={status} elapsed_ms={}",
        started.elapsed().as_millis()
    );
    let body = if (200..300).contains(&status) {
        serde_json::Value::String(text)
    } else {
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null)
    };
    Ok(ApiResponse { status, body })
}

/// The only host routes `host_auth` may call.
fn auth_route_allowed(method: &str, path: &str) -> bool {
    matches!(
        (method, path),
        ("GET", "/auth/status") | ("POST", "/auth/apikey") | ("POST", "/auth/logout")
    )
}

/// The provider-auth routes on the host's sidecar, for Kleio's settings screen:
/// Kleio keeps no local credentials, so status, API keys and disconnects all go
/// to the host. Device-authenticated like `kleio_api`; a non-2xx answer is an
/// Err carrying the host's message.
///
/// `gg_session` is the calling window's sidecar session. The sidecar serves
/// `/auth/*` inside its per-session handler and answers 404 "unknown session"
/// without one — so it is required, like every other session-scoped route.
pub async fn host_auth(
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
    gg_session: &str,
) -> Result<serde_json::Value, String> {
    if !auth_route_allowed(method, path) {
        return Err(format!("host_auth: {method} {path} not allowed"));
    }
    let r = super::remote().ok_or("Not connected to your host.")?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = api_client(r)?
        .request(m, format!("{}{}", r.base, path))
        .header("x-gg-session", gg_session);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| root_cause(&e))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| root_cause(&e))?;
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        return Err(value
            .get("error")
            .and_then(|e| e.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Your host answered {}", status.as_u16())));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The offer passes on the host's ticket, or why it has none. A host from
    /// before the link sends neither.
    #[test]
    fn an_offer_carries_the_hosts_ticket_or_why_it_has_none() {
        let ticket = r#"{"v":4,"type":"kleio-pair","code":"ABC-DEF"}"#;
        let with = offer_from(&serde_json::json!({
            "code": "ABCDEF",
            "display": "ABC-DEF",
            "expiresAt": 1_792_000_000_000_u64,
            "admin": false,
            "ticket": ticket,
            "ticketError": null,
        }));
        assert_eq!(
            with,
            Offer {
                display: "ABC-DEF".into(),
                expires_at: 1_792_000_000_000,
                admin: false,
                ticket: Some(ticket.into()),
                ticket_error: None,
            }
        );
        assert_eq!(
            serde_json::to_value(&with).expect("serializes"),
            serde_json::json!({
                "display": "ABC-DEF",
                "expiresAt": 1_792_000_000_000_u64,
                "admin": false,
                "ticket": ticket,
                "ticketError": null,
            })
        );

        let down = offer_from(&serde_json::json!({
            "display": "GHJ-KMN",
            "expiresAt": 1_792_000_000_000_u64,
            "admin": true,
            "ticket": null,
            "ticketError": "link_down",
        }));
        assert_eq!(down.ticket, None);
        assert_eq!(down.ticket_error.as_deref(), Some("link_down"));
        assert!(down.admin);

        let before = offer_from(&serde_json::json!({
            "display": "PQR-STV",
            "expiresAt": 1_792_000_000_000_u64,
            "admin": false,
        }));
        assert_eq!((before.ticket, before.ticket_error), (None, None));
    }

    /// A URL pairing's clients go to its URL, as before the link.
    #[test]
    fn a_url_pairings_clients_go_to_its_url() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let addr = listener.local_addr().expect("an address");
        let served = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut conn, _) = listener.accept().expect("a connection");
            let mut head = Vec::new();
            let mut chunk = [0; 1024];
            while !head.windows(4).any(|end| end == b"\r\n\r\n") {
                let read = conn.read(&mut chunk).expect("reads");
                assert_ne!(read, 0, "the request ended early");
                head.extend_from_slice(&chunk[..read]);
            }
            conn.write_all(b"HTTP/1.1 204 No Content\r\nconnection: close\r\n\r\n")
                .expect("answers");
            String::from_utf8(head).expect("a text head")
        });
        // As `run()` does first: a client can't be built without one.
        crate::install_rustls_provider();
        let client = host_client(&super::super::Transport::Url)
            .build()
            .expect("a client");
        let status = tauri::async_runtime::block_on(async {
            client
                .get(format!("http://{addr}/kleio/health"))
                .send()
                .await
                .expect("an answer")
                .status()
        });
        assert_eq!(status, 204);
        let head = served.join().expect("served").to_ascii_lowercase();
        assert!(
            head.starts_with("get /kleio/health http/1.1\r\n"),
            "{head:?}"
        );
        assert!(head.contains(&format!("\r\nhost: {addr}\r\n")), "{head:?}");
    }

    #[test]
    fn host_auth_allows_only_the_three_auth_routes() {
        assert!(auth_route_allowed("GET", "/auth/status"));
        assert!(auth_route_allowed("POST", "/auth/apikey"));
        assert!(auth_route_allowed("POST", "/auth/logout"));
        assert!(!auth_route_allowed("POST", "/auth/status"));
        assert!(!auth_route_allowed("POST", "/auth/oauth/start"));
        assert!(!auth_route_allowed("GET", "/kleio/home"));
    }

    #[test]
    fn api_timeout_keeps_a_callers_deadline_within_bounds() {
        assert_eq!(api_timeout(None), API_TIMEOUT);
        assert_eq!(api_timeout(Some(6_000)), Duration::from_secs(6));
        assert_eq!(api_timeout(Some(10)), Duration::from_secs(1));
        assert_eq!(api_timeout(Some(600_000)), API_TIMEOUT);
    }

    #[test]
    fn health_is_a_product_route() {
        assert_eq!(check_route("GET", "/kleio/health", None), Ok(false));
    }

    #[test]
    fn the_hosts_own_facts_are_a_product_route() {
        assert_eq!(check_route("GET", "/kleio/host", None), Ok(false));
        assert!(check_route("GET", "/kleio/host", Some("s1")).is_err());
        assert!(check_route("GET", "/kleio/host/x", None).is_err());
    }

    #[test]
    fn chats_is_a_product_route() {
        assert_eq!(check_route("POST", "/kleio/chats", None), Ok(false));
        assert!(check_route("POST", "/kleio/chats", Some("s1")).is_err());
    }

    fn payload(base: &str, cred: Option<&str>) -> PairingPayload {
        PairingPayload {
            base_url: base.into(),
            host: "mac-mini-1.x.ts.net".into(),
            token: "t".repeat(64),
            label: "Laptop".into(),
            device_id: "dev-1".into(),
            control_credential: cred.map(str::to_string),
            preview_origin: None,
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

        // A host on this Mac (gg-app/scripts/dev-host.mjs), in debug builds only.
        let mut local = payload("http://127.0.0.1:52714", Some("admin-credential"));
        local.host = "127.0.0.1".into();
        assert_eq!(validate_payload(&local).is_ok(), cfg!(debug_assertions));
        local.base_url = "http://localhost:52714".into();
        assert!(validate_payload(&local).is_err());
    }

    /// Paired over Kleio's link, a device gets no base URL; off the link, a
    /// payload without one is refused as before.
    #[test]
    fn a_link_payload_needs_no_base_url() {
        let link = serde_json::json!({
            "host": "kleio-0123456789abcdef",
            "token": "t".repeat(64),
            "label": "iPhone",
            "deviceId": "dev-1",
        });
        let checked = checked_link_payload(link.clone()).expect("a link payload");
        assert_eq!(checked.base_url, "");
        assert_eq!(checked.device_id, "dev-1");
        assert!(checked_payload(link.clone()).is_err());
        let mut no_token = link;
        no_token["token"] = " ".into();
        assert!(checked_link_payload(no_token).is_err());
        assert!(checked_link_payload(serde_json::json!({"host": "h"})).is_err());
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

        // A host on this Mac (gg-app/scripts/dev-host.mjs), in debug builds only.
        assert_eq!(
            normalize_base(" http://127.0.0.1:52714/ ").ok().as_deref(),
            cfg!(debug_assertions).then_some("http://127.0.0.1:52714")
        );
        assert!(normalize_base("http://127.0.0.1:52714/kleio").is_err());
        assert!(normalize_base("http://localhost:52714").is_err());
    }

    /// The typed address's accepted shapes: any https host, a port or not, a
    /// trailing slash dropped, lower-cased, on the Mac and the iPhone alike.
    #[test]
    fn the_typed_address_takes_any_https_host_with_a_port_or_not() {
        for debug_build in [false, true] {
            for (typed, base) in [
                (
                    "https://mac-mini-1.taila6c237.ts.net:8443",
                    "https://mac-mini-1.taila6c237.ts.net:8443",
                ),
                (
                    "https://mac-mini-1.taila6c237.ts.net:8443/",
                    "https://mac-mini-1.taila6c237.ts.net:8443",
                ),
                ("  https://kleio.example.com  ", "https://kleio.example.com"),
                ("https://kleio.example.com/", "https://kleio.example.com"),
                (
                    "https://Mac-Mini.Example.COM:8443",
                    "https://mac-mini.example.com:8443",
                ),
                ("https://kleio.home.arpa:443", "https://kleio.home.arpa:443"),
                ("https://my-vpn-host:65535", "https://my-vpn-host:65535"),
                (
                    "https://1.mini.example.org:1",
                    "https://1.mini.example.org:1",
                ),
                ("https://host.example.com.", "https://host.example.com."),
            ] {
                assert_eq!(
                    typed_base_in(typed, debug_build).as_deref(),
                    Ok(base),
                    "{typed}"
                );
            }
        }
    }

    /// Each refusal, with words that say what to type instead. None depends on
    /// the build but the loopback host a debug build takes.
    #[test]
    fn the_typed_address_refuses_http_credentials_paths_and_odd_hosts() {
        // A host name with a non-ASCII letter, as a lookalike would be.
        let non_ascii = format!("https://mini.ex{}mple.com", '\u{e4}');
        let refusals: Vec<(&str, &str)> = vec![
            // http, anywhere but the debug build's loopback host.
            ("http://kleio.example.com", "Use an https:// address"),
            ("HTTP://kleio.example.com", "Use an https:// address"),
            ("http://mac-mini-1.x.ts.net:8443", "Use an https:// address"),
            ("http://localhost:52714", "Use an https:// address"),
            ("http://127.0.0.2:52714", "Use an https:// address"),
            // No scheme, or another.
            ("kleio.example.com:8443", "starts with https://"),
            ("ftp://kleio.example.com", "starts with https://"),
            ("HTTPS://kleio.example.com", "starts with https://"),
            ("", "starts with https://"),
            // A username or password.
            ("https://user@kleio.example.com", "username or password"),
            (
                "https://user:pass@kleio.example.com:8443",
                "username or password",
            ),
            // A path, query or fragment, or a backslash.
            ("https://kleio.example.com/kleio", "nothing after it"),
            ("https://kleio.example.com:8443/kleio/", "nothing after it"),
            ("https://kleio.example.com?x=1", "nothing after it"),
            ("https://kleio.example.com#x", "nothing after it"),
            (
                "https://kleio.example.com\\evil.example",
                "nothing after it",
            ),
            ("https://kleio.example.com//", "nothing after it"),
            // A port that isn't one.
            ("https://kleio.example.com:", "The port is a number"),
            ("https://kleio.example.com:0", "The port is a number"),
            ("https://kleio.example.com:080", "The port is a number"),
            ("https://kleio.example.com:65536", "The port is a number"),
            ("https://kleio.example.com:+80", "The port is a number"),
            ("https://kleio.example.com:http", "The port is a number"),
            ("https://kleio.example.com:8443:1", "That isn't a host name"),
            // An empty, IP-literal or odd host. (A bare `https://` is
            // `https:` once its trailing slash goes: no address at all.)
            ("https://", "starts with https://"),
            ("https://:8443", "That isn't a host name"),
            ("https://192.168.1.20:8443", "That isn't a host name"),
            ("https://[::1]:8443", "That isn't a host name"),
            ("https://-mini.example.com", "That isn't a host name"),
            ("https://mini-.example.com", "That isn't a host name"),
            ("https://mini..example.com", "That isn't a host name"),
            ("https://.example.com", "That isn't a host name"),
            ("https://mini_1.example.com", "That isn't a host name"),
            ("https://mini example.com", "That isn't a host name"),
            (non_ascii.as_str(), "That isn't a host name"),
        ];
        for debug_build in [false, true] {
            for (typed, words) in &refusals {
                let refused = typed_base_in(typed, debug_build)
                    .expect_err(&format!("{typed:?} should be refused"));
                assert!(refused.contains(words), "{typed:?}: {refused}");
            }
        }
        let long_label = format!("https://{}.example.com", "a".repeat(64));
        let long_name = format!("https://{}.com", vec!["a".repeat(63); 4].join("."));
        for typed in [long_label, long_name] {
            assert!(typed_base_in(&typed, false).is_err(), "{typed}");
        }
        assert!(typed_base_in(&format!("https://{}.com", "a".repeat(63)), false).is_ok());
    }

    #[test]
    fn a_debug_build_also_takes_the_loopback_dev_host_and_a_release_build_doesnt() {
        assert_eq!(
            typed_base_in("http://127.0.0.1:52714/", true).as_deref(),
            Ok("http://127.0.0.1:52714")
        );
        assert!(typed_base_in("http://127.0.0.1:52714", false).is_err());
        assert!(typed_base_in("http://127.0.0.1:52714/kleio", true).is_err());
    }

    /// A request carrying the device token never follows a redirect, so the
    /// token can't go on to another origin.
    #[test]
    fn a_host_client_follows_no_redirect_so_the_token_stays_with_the_host() {
        use std::io::{Read, Write};
        crate::install_rustls_provider();
        let elsewhere = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let elsewhere_addr = elsewhere.local_addr().unwrap();
        elsewhere.set_nonblocking(true).unwrap();
        let host = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let host_addr = host.local_addr().unwrap();
        let answer = std::thread::spawn(move || {
            let (mut s, _) = host.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = s.read(&mut buf);
            let reply = format!(
                "HTTP/1.1 302 Found\r\nlocation: http://{elsewhere_addr}/stolen\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            );
            s.write_all(reply.as_bytes()).unwrap();
        });
        let res = tauri::async_runtime::block_on(async {
            let client = host_client(&super::super::Transport::Url)
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            client
                .get(format!("http://{host_addr}/kleio/health"))
                .header(DEVICE_TOKEN_HEADER, "the-device-token")
                .send()
                .await
        })
        .expect("an answer");
        answer.join().unwrap();
        // The redirect itself comes back, unfollowed...
        assert_eq!(res.status(), 302);
        // ...and nothing reached the other origin.
        std::thread::sleep(Duration::from_millis(200));
        assert!(elsewhere.accept().is_err(), "the redirect was followed");
    }

    #[test]
    fn nonce_is_32_lowercase_hex() {
        let n = random_hex(16);
        assert_eq!(n.len(), 32);
        assert!(n.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        assert_ne!(n, random_hex(16));
    }

    #[test]
    fn kleio_api_allows_product_routes() {
        for (m, p) in [
            ("GET", "/kleio/home"),
            ("POST", "/kleio/home/new"),
            ("GET", "/kleio/models"),
            ("POST", "/kleio/brief"),
            ("GET", "/kleio/notifications"),
            ("POST", "/kleio/notifications"),
            ("GET", "/kleio/voice"),
            ("POST", "/kleio/voice/key"),
            ("DELETE", "/kleio/voice/key"),
            ("POST", "/kleio/voice/settings"),
            ("POST", "/kleio/voice/brain"),
            ("GET", "/kleio/voice/files?source=kleio"),
            ("GET", "/kleio/voice/files?source=specialist&id=b_1"),
            ("POST", "/kleio/voice/files/read"),
            ("GET", "/kleio/sessions?kind=chat"),
            ("GET", "/kleio/sessions/0b9f2c1e-5d4a-4c1b-9a8e-3f2d1c0b9a8e?kind=code"),
            ("GET", "/kleio/projects"),
            ("GET", "/kleio/projects?name=recipe%20app%20%28old%29"),
            ("POST", "/kleio/projects"),
            ("POST", "/kleio/projects/code"),
            ("GET", "/kleio/voice/files?source=project&id=recipe-app"),
            ("GET", "/kleio/blobs"),
            ("POST", "/kleio/blobs"),
            ("PATCH", "/kleio/blobs/b_1"),
            ("DELETE", "/kleio/blobs/b_1"),
            ("GET", "/kleio/blobs/b_1/session"),
            ("POST", "/kleio/blobs/b_1/session/new"),
            ("POST", "/kleio/blobs/b_1/schedules/s-2/run"),
            ("GET", "/kleio/blobs/b_1/runs?limit=20"),
            ("GET", "/kleio/groups"),
            (
                "GET",
                "/kleio/groups/g1/messages?before=2026-09-30T10%3A00%3A00Z&limit=50",
            ),
            // A new conversation; answering a member's question.
            ("POST", "/kleio/groups/g_0bc1704f/new"),
            ("POST", "/kleio/groups/g_0bc1704f/ask/ask-12"),
            ("GET", "/kleio/connections"),
            ("GET", "/kleio/connections/toolkits"),
            ("POST", "/kleio/connections/gmail/connect"),
            ("GET", "/kleio/setup"),
            ("POST", "/kleio/setup/keys/composio"),
            ("DELETE", "/kleio/setup/keys/composio"),
            ("POST", "/kleio/setup/keys/typesafe"),
            ("DELETE", "/kleio/setup/keys/typesafe"),
            ("GET", "/kleio/setup/dictation"),
            ("POST", "/kleio/setup/dictation"),
        ] {
            assert_eq!(check_route(m, p, None), Ok(false), "{m} {p}");
        }
    }

    #[test]
    fn kleio_api_allows_the_dictation_step_and_nothing_near_it() {
        // The exact path only: nothing below it, no session, and never the
        // sidecar's own /dictation routes (the host checks what they answer).
        for p in [
            "/kleio/setup/dictation/prepare",
            "/kleio/setup/dictations",
            "/dictation",
            "/dictation/prepare",
        ] {
            for m in ["GET", "POST"] {
                assert!(check_route(m, p, None).is_err(), "{m} {p}");
                assert!(
                    check_route(m, p, Some("sess-1")).is_err(),
                    "{m} {p} with a session"
                );
            }
        }
        assert!(check_route("GET", "/kleio/setup/dictation", Some("sess-1")).is_err());
    }

    #[test]
    fn kleio_api_allows_only_the_setup_keys_it_knows() {
        // Settings → Setup was refused ("path not allowed") until its routes
        // were listed here; only the two key names, nothing else under it.
        for p in [
            "/kleio/setup/keys",
            "/kleio/setup/keys/openai",
            "/kleio/setup/keys/composio/extra",
            "/kleio/setup/anything",
        ] {
            assert!(check_route("POST", p, None).is_err(), "{p}");
        }
        assert!(check_route("GET", "/kleio/setup", Some("sess-1")).is_err());
    }

    #[test]
    fn kleio_api_makes_a_show_and_asks_how_it_is_and_nothing_else() {
        let id = "sh_0123456789abcdef0123456789abcdef";
        assert_eq!(check_route("POST", "/kleio/voice/show", None), Ok(false));
        assert_eq!(
            check_route("GET", &format!("/kleio/voice/show/{id}"), None),
            Ok(false)
        );
        for (m, p) in [
            // Each route with its own method only.
            ("GET", "/kleio/voice/show".to_string()),
            ("PUT", "/kleio/voice/show".to_string()),
            ("DELETE", "/kleio/voice/show".to_string()),
            ("POST", format!("/kleio/voice/show/{id}")),
            ("DELETE", format!("/kleio/voice/show/{id}")),
            ("PATCH", format!("/kleio/voice/show/{id}")),
            // No query: a web address goes in the body.
            (
                "POST",
                "/kleio/voice/show?url=https%3A%2F%2Fexample.com".to_string(),
            ),
            ("GET", format!("/kleio/voice/show/{id}?x=1")),
            // Parts come through kleio_show_part, never as JSON.
            ("GET", format!("/kleio/voice/show/{id}/image")),
            ("GET", format!("/kleio/voice/show/{id}/text")),
            ("GET", format!("/kleio/voice/show/{id}/page-1")),
            // Only an id as the host makes them.
            ("GET", "/kleio/voice/show/sh_0123".to_string()),
            (
                "GET",
                "/kleio/voice/show/SH_0123456789ABCDEF0123456789ABCDEF".to_string(),
            ),
            (
                "GET",
                "/kleio/voice/show/sh_0123456789abcdef0123456789abcdeg".to_string(),
            ),
            ("GET", "/kleio/voice/show/..".to_string()),
            ("GET", "/kleio/voice/show/".to_string()),
            ("GET", "/kleio/voice/shows".to_string()),
            ("POST", "/kleio/voice/show/".to_string()),
        ] {
            assert!(check_route(m, &p, None).is_err(), "{m} {p}");
        }
        assert!(check_route("POST", "/kleio/voice/show", Some("sess-1")).is_err());
        assert!(check_route("GET", &format!("/kleio/voice/show/{id}"), Some("sess-1")).is_err());
    }

    #[test]
    fn kleio_api_keeps_file_paths_out_of_the_query() {
        // Paths go in the body: one in the query is refused for its characters.
        for p in [
            "/kleio/voice/files?source=chat&path=out/report (final).pdf",
            "/kleio/voice/files?source=chat&path=out/report.pdf",
            "/kleio/voice/files?source=chat&path=it's.pdf",
        ] {
            assert!(check_route("GET", p, None).is_err(), "{p}");
        }
        assert!(check_route("POST", "/kleio/voice/files/read/x", None).is_err());
    }

    #[test]
    fn kleio_api_scopes_session_routes() {
        for p in [
            "/memories",
            "/memories/m-1",
            "/state",
            "/history",
            "/prompt",
            "/cancel",
        ] {
            assert_eq!(check_route("GET", p, Some("sess-1_a")), Ok(true), "{p}");
            assert!(check_route("GET", p, None).is_err(), "{p} without session");
        }
        assert!(check_route("GET", "/state", Some("a b")).is_err());
        assert!(check_route("GET", "/state", Some("x\r\ny: z")).is_err());
        assert!(check_route("GET", "/state", Some(&"a".repeat(129))).is_err());
        assert!(check_route("GET", "/kleio/home", Some("sess-1")).is_err());
    }

    #[test]
    fn kleio_api_allows_answering_an_ask() {
        assert_eq!(check_route("POST", "/ask/ask-1", Some("sess-1")), Ok(true));
        assert_eq!(check_route("POST", "/ask/ask-123456789", Some("sess-1")), Ok(true));
        assert!(check_route("POST", "/ask/ask-1", None).is_err(), "needs a session");
        for (m, p) in [
            ("GET", "/ask/ask-1"),
            ("DELETE", "/ask/ask-1"),
            ("POST", "/ask"),
            ("POST", "/ask/"),
            ("POST", "/ask/ask-"),
            ("POST", "/ask/ask-1234567890"),
            ("POST", "/ask/ask-1a"),
            ("POST", "/ask/elicit-1"),
            ("POST", "/ask/ask-1/x"),
            ("POST", "/ask/ask-1?x=1"),
            ("POST", "/ask/.."),
        ] {
            assert!(check_route(m, p, Some("sess-1")).is_err(), "{m} {p}");
        }
    }

    #[test]
    fn kleio_api_rejects_everything_else() {
        for p in [
            "/kleio/connections/callback",
            "/kleio/connections/callback?code=x",
            "/kleio/connections/callback/x",
            "/kleio/pair/redeem",
            "/kleio/pair/offer",
            "/kleio/devices",
            "/kleio/devices/d1/revoke",
            "/kleio/push",
            "/kleio/health/x",
            "/kleio/home/other",
            "/kleio/homes",
            "/kleio/blobsx",
            "/kleio/sessionsx",
            "/kleio/sessions/a/b",
            "/kleio/projectsx",
            "/kleio/projects/recipe-app",
            "/kleio/projects/code/x",
            "/kleio/projects?name=it's",
            "/kleio/models/x",
            "/kleio/notifications/x",
            "/kleio/notificationsx",
            "/kleio/blobs/../devices",
            "/kleio/blobs/./x",
            "/kleio/blobs//x",
            "/kleio/blobs/%2e%2e/devices",
            "/kleio/blobs/x#frag",
            "/kleio/blobs?x=<y>",
            "/schedule",
            "/session",
            "/settings",
            "/statex",
            "/state/x",
            "kleio/home",
            "//evil.example/kleio/home",
            "https://evil.example/kleio/home",
            "",
        ] {
            assert!(check_route("GET", p, None).is_err(), "{p}");
            assert!(check_route("GET", p, Some("s1")).is_err(), "{p} + session");
        }
        assert!(check_route("TRACE", "/kleio/home", None).is_err());
        assert!(check_route("CONNECT", "/kleio/home", None).is_err());
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
