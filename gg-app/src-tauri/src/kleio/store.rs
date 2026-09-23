//! The paired-host record, `~/.gg/kleio-remote.json`. Non-secret only: the
//! device token and control credential are in the Keychain (`keychain.rs`).
//! Same home-dir-file convention as `gg-app.json` / `gg-app-workspace.json`.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRecord {
    /// `https://host:port`, no trailing slash.
    pub base_url: String,
    /// Tailnet host name as the host reports it (the macaroon node caveat).
    pub host: String,
    pub device_id: String,
    pub label: String,
    #[serde(default)]
    pub admin: bool,
    /// ISO-8601, display only.
    pub paired_at: String,
}

pub fn path(home: &Path) -> PathBuf {
    home.join(".gg").join("kleio-remote.json")
}

pub fn load(home: &Path) -> Option<HostRecord> {
    let raw = std::fs::read_to_string(path(home)).ok()?;
    match serde_json::from_str::<HostRecord>(&raw) {
        Ok(r) if r.base_url.starts_with("https://") && !r.device_id.is_empty() => Some(r),
        Ok(_) => {
            log::warn!("kleio: ignoring kleio-remote.json (not https or no deviceId)");
            None
        }
        Err(e) => {
            log::warn!("kleio: ignoring unreadable kleio-remote.json: {e}");
            None
        }
    }
}

/// Write-then-rename so a crash mid-write never leaves a half file.
pub fn save(home: &Path, rec: &HostRecord) -> Result<(), String> {
    let p = path(home);
    let dir = p.parent().ok_or("no parent dir")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".kleio-remote.{}.tmp", std::process::id()));
    let body = serde_json::to_string_pretty(rec).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn clear(home: &Path) -> Result<(), String> {
    match std::fs::remove_file(path(home)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One dir per call, even for tests running in parallel in this process.
    /// A timestamp is not unique enough: Windows' clock ticks coarsely, and two
    /// tests sharing a dir saw one's "not json" under the other's load().
    fn tmp_home() -> PathBuf {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!(
            "kleio-store-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn rec() -> HostRecord {
        HostRecord {
            base_url: "https://mac-mini-1.example.ts.net:8443".into(),
            host: "mac-mini-1.example.ts.net".into(),
            device_id: "dev_abc".into(),
            label: "Laptop".into(),
            admin: true,
            paired_at: "2026-09-22T00:00:00Z".into(),
        }
    }

    #[test]
    fn round_trip_then_clear() {
        let home = tmp_home();
        assert_eq!(load(&home), None);
        save(&home, &rec()).unwrap();
        assert_eq!(load(&home), Some(rec()));
        // No temp file left behind.
        let leftovers: Vec<_> = std::fs::read_dir(home.join(".gg"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        clear(&home).unwrap();
        assert_eq!(load(&home), None);
        clear(&home).unwrap(); // idempotent
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rejects_http_and_garbage() {
        let home = tmp_home();
        std::fs::create_dir_all(home.join(".gg")).unwrap();
        std::fs::write(
            path(&home),
            r#"{"baseUrl":"http://x","host":"x","deviceId":"d","label":"l","pairedAt":"t"}"#,
        )
        .unwrap();
        assert_eq!(load(&home), None);
        std::fs::write(path(&home), "not json").unwrap();
        assert_eq!(load(&home), None);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn older_record_without_admin_reads_as_non_admin() {
        let home = tmp_home();
        std::fs::create_dir_all(home.join(".gg")).unwrap();
        std::fs::write(
            path(&home),
            r#"{"baseUrl":"https://x","host":"x","deviceId":"d","label":"l","pairedAt":"t"}"#,
        )
        .unwrap();
        assert!(!load(&home).unwrap().admin);
        let _ = std::fs::remove_dir_all(&home);
    }
}
