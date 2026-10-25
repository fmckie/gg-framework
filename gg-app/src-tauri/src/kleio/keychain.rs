//! Secrets for the paired host live in the Keychain (macOS login Keychain, or
//! the iPhone app's own Keychain — same generic-password API on both).
//! One generic-password item per secret, keyed by host so two hosts never
//! collide. Nothing secret is ever written to disk (`~/.kleio`).
//!
//! On an iPhone each secret is written readable once the phone has been
//! unlocked after starting, and kept on this phone
//! (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronized). So
//! a launch while the phone is locked, such as iOS starting the app in the
//! background, still reads the pairing, and a backup restored to another phone
//! carries no identity. The Mac's login Keychain items are written as before:
//! that class needs the data protection keychain, and with it an entitlement
//! this app doesn't have.

#[cfg(any(target_os = "macos", target_os = "ios"))]
const SERVICE: &str = "com.kleio.gg-app";

#[derive(Debug, Clone, Copy)]
pub enum Secret {
    DeviceToken,
    ControlCredential,
    /// This device's own iroh key, for Kleio's link (`link.rs`).
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    IrohKey,
}

impl Secret {
    fn account(self, host: &str) -> String {
        match self {
            Secret::DeviceToken => format!("device-token:{host}"),
            Secret::ControlCredential => format!("control-credential:{host}"),
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            Secret::IrohKey => format!("iroh-key:{host}"),
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

#[cfg(target_os = "ios")]
pub fn put(host: &str, which: Secret, value: &str) -> Result<(), String> {
    let write = this_device::Write::new(SERVICE, &which.account(host), value.as_bytes());
    this_device::put(&write).map_err(|status| {
        format!(
            "keychain write failed: {}",
            security_framework::base::Error::from_code(status)
        )
    })
}

/// An iPhone's writes, through the Security framework's item calls, because
/// security-framework's can't set an item's class. On the Mac this is compiled
/// only for the tests, which check what it asks for.
#[cfg(any(target_os = "ios", all(test, target_os = "macos")))]
mod this_device {
    use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFRetained, CFString, CFType};
    use objc2_security::{
        kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, kSecAttrAccount,
        kSecAttrService, kSecAttrSynchronizable, kSecClass, kSecClassGenericPassword,
        kSecValueData,
    };

    pub(super) type Dictionary = CFRetained<CFDictionary<CFString, CFType>>;

    /// One secret to write: which item, and its value.
    pub(super) struct Write {
        service: CFRetained<CFString>,
        account: CFRetained<CFString>,
        value: CFRetained<CFData>,
    }

    impl Write {
        pub(super) fn new(service: &str, account: &str, value: &[u8]) -> Self {
            Self {
                service: CFString::from_str(service),
                account: CFString::from_str(account),
                value: CFData::from_bytes(value),
            }
        }

        /// Which item: the generic password with this service and account
        /// that isn't synchronized, whatever its class.
        fn item(&self) -> [(&CFString, &CFType); 4] {
            // SAFETY: the `kSec` names are constants the Security framework
            // exports, and nothing writes them.
            unsafe {
                [
                    (kSecClass, kSecClassGenericPassword),
                    (kSecAttrService, &self.service),
                    (kSecAttrAccount, &self.account),
                    (kSecAttrSynchronizable, CFBoolean::new(false)),
                ]
            }
        }

        /// What it's set to: the value, and the class.
        fn contents(&self) -> [(&CFString, &CFType); 2] {
            // SAFETY: as in `item`.
            unsafe {
                [
                    (kSecValueData, &self.value),
                    (
                        kSecAttrAccessible,
                        kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                    ),
                ]
            }
        }

        /// The search for an existing item, for `SecItemUpdate`. It names no
        /// class, so it finds an item of any.
        pub(super) fn query(&self) -> Dictionary {
            dictionary(&self.item())
        }

        /// What an existing item is updated with.
        pub(super) fn update(&self) -> Dictionary {
            dictionary(&self.contents())
        }

        /// A new item, for `SecItemAdd`: both.
        pub(super) fn add(&self) -> Dictionary {
            let pairs: Vec<_> = self.item().into_iter().chain(self.contents()).collect();
            dictionary(&pairs)
        }
    }

    /// Writes it. An existing item gets the value and the class, so one an
    /// older build wrote, of the default class, moves to this one the next
    /// time it's written. A missing one is added. `Err` is the Security
    /// framework's status.
    #[cfg(target_os = "ios")]
    pub(super) fn put(write: &Write) -> Result<(), i32> {
        use objc2_security::{errSecItemNotFound, errSecSuccess, SecItemAdd, SecItemUpdate};

        // SAFETY: each dictionary maps attribute names to values of the types
        // the Security framework documents for them, and `SecItemAdd` is asked
        // for no result.
        let status =
            unsafe { SecItemUpdate(write.query().as_opaque(), write.update().as_opaque()) };
        let status = if status == errSecItemNotFound {
            unsafe { SecItemAdd(write.add().as_opaque(), std::ptr::null_mut()) }
        } else {
            status
        };
        if status == errSecSuccess {
            Ok(())
        } else {
            Err(status)
        }
    }

    fn dictionary(pairs: &[(&CFString, &CFType)]) -> Dictionary {
        let (keys, values): (Vec<&CFString>, Vec<&CFType>) = pairs.iter().copied().unzip();
        CFDictionary::from_slices(&keys, &values)
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
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

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub fn delete(host: &str, which: Secret) -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, &which.account(host)) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == -25300 => Ok(()),
        Err(e) => Err(format!("keychain delete failed: {e}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn put(_host: &str, _which: Secret, _value: &str) -> Result<(), String> {
    Err("keychain unavailable on this platform".into())
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn get(_host: &str, _which: Secret) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
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

    /// What an iPhone write asks of the Keychain. The class is among what's
    /// set, not in the search, so an item an older build wrote, of the default
    /// class, is found and moved over rather than missed and duplicated.
    #[test]
    fn an_iphone_write_keeps_the_secret_on_this_phone_and_readable_after_its_first_unlock() {
        use objc2_core_foundation::{CFBoolean, CFData, CFString, CFType};
        use objc2_security::{
            kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, kSecAttrAccount,
            kSecAttrService, kSecAttrSynchronizable, kSecClass, kSecClassGenericPassword,
            kSecValueData,
        };

        fn cf<T: AsRef<CFType> + ?Sized>(value: &T) -> &CFType {
            value.as_ref()
        }

        let write = this_device::Write::new(SERVICE, "device-token:mini.invalid", b"s3cret");
        let service = CFString::from_str(SERVICE);
        let account = CFString::from_str("device-token:mini.invalid");
        let value = CFData::from_bytes(b"s3cret");
        // SAFETY: the `kSec` names are constants the Security framework
        // exports, and nothing writes them.
        let item = unsafe {
            [
                (kSecClass, cf(kSecClassGenericPassword)),
                (kSecAttrService, cf(&*service)),
                (kSecAttrAccount, cf(&*account)),
                (kSecAttrSynchronizable, cf(CFBoolean::new(false))),
            ]
        };
        let contents = unsafe {
            [
                (kSecValueData, cf(&*value)),
                (
                    kSecAttrAccessible,
                    cf(kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly),
                ),
            ]
        };

        let query = write.query();
        assert_eq!(query.len(), item.len());
        for (key, want) in item {
            assert_eq!(query.get(key).as_deref(), Some(want), "{key:?}");
        }
        assert_eq!(query.get(unsafe { kSecAttrAccessible }), None);

        let update = write.update();
        assert_eq!(update.len(), contents.len());
        for (key, want) in contents {
            assert_eq!(update.get(key).as_deref(), Some(want), "{key:?}");
        }

        let add = write.add();
        assert_eq!(add.len(), item.len() + contents.len());
        for (key, want) in item.into_iter().chain(contents) {
            assert_eq!(add.get(key).as_deref(), Some(want), "{key:?}");
        }
    }
}
