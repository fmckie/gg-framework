//! Secrets for the paired host live in the user's login Keychain (macOS only).
//! One generic-password item per secret, keyed by host so two hosts never
//! collide. Nothing secret is ever written to `~/.gg`.

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.kleio.gg-app";

#[derive(Debug, Clone, Copy)]
pub enum Secret {
    DeviceToken,
    ControlCredential,
}

impl Secret {
    fn account(self, host: &str) -> String {
        match self {
            Secret::DeviceToken => format!("device-token:{host}"),
            Secret::ControlCredential => format!("control-credential:{host}"),
        }
    }
}

#[cfg(target_os = "macos")]
pub fn put(host: &str, which: Secret, value: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(
        SERVICE,
        &which.account(host),
        value.as_bytes(),
    )
    .map_err(|e| format!("keychain write failed: {e}"))
}

#[cfg(target_os = "macos")]
pub fn get(host: &str, which: Secret) -> Result<Option<String>, String> {
    match security_framework::passwords::get_generic_password(SERVICE, &which.account(host)) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "keychain item is not UTF-8".to_string()),
        // errSecItemNotFound
        Err(e) if e.code() == -25300 => Ok(None),
        Err(e) => Err(format!("keychain read failed: {e}")),
    }
}

#[cfg(target_os = "macos")]
pub fn delete(host: &str, which: Secret) -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, &which.account(host)) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == -25300 => Ok(()),
        Err(e) => Err(format!("keychain delete failed: {e}")),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn put(_host: &str, _which: Secret, _value: &str) -> Result<(), String> {
    Err("keychain unavailable on this platform".into())
}

#[cfg(not(target_os = "macos"))]
pub fn get(_host: &str, _which: Secret) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
pub fn delete(_host: &str, _which: Secret) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// Touches the real login Keychain under a throwaway host name and cleans up.
    #[test]
    fn round_trip_and_delete() {
        let host = format!("test-{}.invalid", std::process::id());
        assert_eq!(get(&host, Secret::DeviceToken).unwrap(), None);
        put(&host, Secret::DeviceToken, "abc123").unwrap();
        assert_eq!(
            get(&host, Secret::DeviceToken).unwrap().as_deref(),
            Some("abc123")
        );
        put(&host, Secret::DeviceToken, "def456").unwrap();
        assert_eq!(
            get(&host, Secret::DeviceToken).unwrap().as_deref(),
            Some("def456")
        );
        delete(&host, Secret::DeviceToken).unwrap();
        assert_eq!(get(&host, Secret::DeviceToken).unwrap(), None);
        delete(&host, Secret::DeviceToken).unwrap(); // idempotent
    }
}
