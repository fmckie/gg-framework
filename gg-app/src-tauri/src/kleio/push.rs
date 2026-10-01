//! iPhone: notifications when an agent finishes.
//!
//! The host sends them (packages/kleio-host/src/apns.ts) to every paired phone
//! that has told it where: an APNs device token, and which Apple push service
//! the token belongs to. This module holds that token and registers it with
//! the host. Getting the token from iOS is in `phone.rs`.
//!
//! Only the iPhone build uses it; it is compiled everywhere so its logic is
//! tested on the Mac.
#![cfg_attr(not(target_os = "ios"), allow(dead_code))]

use std::sync::Mutex;

/// Which Apple push service a device token belongs to. Development-signed
/// builds (from Xcode, or `tauri ios build --export-method debugging`) get
/// tokens for the sandbox service; App Store and TestFlight builds get
/// production ones. The host only sends a token to the service it is set up
/// for (`KLEIO_APNS_ENV`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApnsEnv {
    Sandbox,
    Production,
}

/// Which push service this build's signing allows, read from the app's
/// embedded provisioning profile (`embedded.mobileprovision`). The profile is a
/// signed plist whose XML is stored as is, so the `aps-environment` value can
/// be found in its bytes. The App Store strips the profile, and an App Store
/// build only ever gets production tokens. The simulator always uses sandbox.
/// `None`: the build is not allowed to receive pushes at all.
pub fn apns_env(profile: Option<&[u8]>, simulator: bool) -> Option<ApnsEnv> {
    if simulator {
        return Some(ApnsEnv::Sandbox);
    }
    let Some(bytes) = profile else {
        return Some(ApnsEnv::Production);
    };
    let text = String::from_utf8_lossy(bytes);
    let after_key = text.split("<key>aps-environment</key>").nth(1)?;
    let value = after_key
        .trim_start()
        .strip_prefix("<string>")?
        .split("</string>")
        .next()?;
    match value.trim() {
        "development" => Some(ApnsEnv::Sandbox),
        "production" => Some(ApnsEnv::Production),
        _ => None,
    }
}

/// An APNs device token as the host expects it: lowercase hex.
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}

/// The newest token iOS gave this launch, and whether the host has it yet.
/// A registration that failed (no network at launch, the host restarting) is
/// retried each time the app comes back on screen.
#[derive(Default)]
pub struct PushToken(Mutex<Option<Held>>);

struct Held {
    token: String,
    env: ApnsEnv,
    registered: bool,
}

impl PushToken {
    /// iOS handed over a token; the host does not have it yet.
    pub fn set(&self, token: String, env: ApnsEnv) {
        *self.0.lock().unwrap() = Some(Held {
            token,
            env,
            registered: false,
        });
    }

    /// The token still to register with the host, if any.
    pub fn unregistered(&self) -> Option<(String, ApnsEnv)> {
        let held = self.0.lock().unwrap();
        held.as_ref()
            .filter(|h| !h.registered)
            .map(|h| (h.token.clone(), h.env))
    }

    /// The host has `token`. A newer token that arrived meanwhile stays due.
    pub fn registered(&self, token: &str) {
        if let Some(h) = self.0.lock().unwrap().as_mut().filter(|h| h.token == token) {
            h.registered = true;
        }
    }
}

/// Register this launch's token with the host, if it does not have it yet.
/// Every launch registers: tokens can change, and the host keeps the newest.
pub async fn register_due(tokens: &PushToken) {
    let Some((token, env)) = tokens.unregistered() else {
        return;
    };
    match register_with_host(&token, env).await {
        Ok(()) => tokens.registered(&token),
        Err(e) => log::warn!("kleio: could not register the push token with the host: {e}"),
    }
}

/// Tell the paired host where to send this phone's notifications.
async fn register_with_host(token: &str, env: ApnsEnv) -> Result<(), String> {
    let remote = super::remote().ok_or("not paired with a Kleio host")?;
    let started = std::time::Instant::now();
    let res = super::commands::api_client(remote)?
        .post(format!("{}/kleio/push", remote.base))
        .json(&serde_json::json!({ "token": token, "env": env }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    log::info!(
        "kleio: push token registered with host status={} env={env:?} elapsed_ms={}",
        status.as_u16(),
        started.elapsed().as_millis()
    );
    if status.is_success() {
        Ok(())
    } else {
        Err(format!("the host answered {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEV_PROFILE: &[u8] = b"\x30\x82junk<plist><dict><key>Entitlements</key><dict>\
        <key>aps-environment</key>\n\t\t<string>development</string>\
        <key>get-task-allow</key><true/></dict></dict></plist>\x00\x01";

    #[test]
    fn a_development_signed_build_gets_sandbox_tokens() {
        assert_eq!(apns_env(Some(DEV_PROFILE), false), Some(ApnsEnv::Sandbox));
    }

    #[test]
    fn a_distribution_profile_means_production() {
        let profile = b"<key>aps-environment</key><string>production</string>";

        assert_eq!(apns_env(Some(profile), false), Some(ApnsEnv::Production));
    }

    #[test]
    fn an_app_store_build_has_no_profile_and_uses_production() {
        assert_eq!(apns_env(None, false), Some(ApnsEnv::Production));
    }

    #[test]
    fn a_profile_without_push_means_no_notifications() {
        let profile = b"<key>get-task-allow</key><true/>";

        assert_eq!(apns_env(Some(profile), false), None);
    }

    #[test]
    fn the_simulator_always_uses_sandbox() {
        assert_eq!(apns_env(None, true), Some(ApnsEnv::Sandbox));
    }

    #[test]
    fn a_token_is_due_until_the_host_has_it() {
        let tokens = PushToken::default();
        tokens.set("ab12".into(), ApnsEnv::Sandbox);

        assert_eq!(
            tokens.unregistered(),
            Some(("ab12".to_string(), ApnsEnv::Sandbox))
        );
        tokens.registered("ab12");
        assert_eq!(tokens.unregistered(), None);
    }

    #[test]
    fn a_newer_token_stays_due_when_an_older_one_registers() {
        let tokens = PushToken::default();
        tokens.set("old0".into(), ApnsEnv::Sandbox);
        tokens.set("new1".into(), ApnsEnv::Sandbox);

        tokens.registered("old0");

        assert_eq!(
            tokens.unregistered(),
            Some(("new1".to_string(), ApnsEnv::Sandbox))
        );
    }

    #[test]
    fn tokens_are_lowercase_hex() {
        assert_eq!(hex(&[0x00, 0xab, 0x7f, 0xff]), "00ab7fff");
    }

    #[test]
    fn the_env_is_sent_as_the_host_spells_it() {
        let body = serde_json::json!({ "env": ApnsEnv::Sandbox });

        assert_eq!(body["env"], "sandbox");
    }
}
