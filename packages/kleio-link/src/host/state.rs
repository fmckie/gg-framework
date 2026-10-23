//! The forwarder's folder, `~/Library/Application Support/Kleio/link-proto/`
//! (0700): the host's secret key, the allow-list and the relay it's reached
//! through. Every file in it is 0600 and written atomically.
//!
//! Only where there are POSIX modes. Elsewhere (Windows) the folder and its
//! files are refused rather than left open to more than this user, until the
//! host's key moves to kleio-host's locked `secure/` folder
//! (docs/adr/0002-kleio-link-replaces-tailscale.md).

use std::fs;
#[cfg(unix)]
use std::fs::{DirBuilder, File, OpenOptions};
use std::io;
#[cfg(unix)]
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use iroh::{RelayUrl, SecretKey};
use serde_json::Value;
use tracing::info;

use super::{file_error, HostError};
use crate::ticket::check_relay;

/// The host's secret key, 32 bytes. Its public half is the key in every
/// ticket, so it's made once and never replaced.
pub(crate) const SECRET_KEY_FILE: &str = "secret.key";
/// The keys allowed on `kleio/http/0`.
pub(crate) const ALLOW_FILE: &str = "allow.json";
/// The relay the host is reached through, which `serve` records for `qr`.
pub(crate) const RELAY_FILE: &str = "relay.txt";
/// `client --pair`'s pairing, device token included.
pub(crate) const CLIENT_PAIRING_FILE: &str = "client-pairing.json";

/// The forwarder's folder.
#[derive(Debug, Clone)]
pub struct StateDir {
    dir: PathBuf,
}

impl StateDir {
    /// `~/Library/Application Support/Kleio/link-proto/`.
    pub fn default_path() -> Result<PathBuf, HostError> {
        let home = std::env::var_os("HOME")
            .filter(|home| !home.is_empty())
            .ok_or_else(|| HostError::new("HOME isn't set"))?;
        Ok(PathBuf::from(home).join("Library/Application Support/Kleio/link-proto"))
    }

    /// The folder at [`default_path`](Self::default_path).
    pub fn open_default() -> Result<Self, HostError> {
        Self::open(Self::default_path()?)
    }

    /// The folder at `dir`: made if it's missing, and 0700 either way.
    pub fn open(dir: impl Into<PathBuf>) -> Result<Self, HostError> {
        let dir = dir.into();
        make_private_dir(&dir)?;
        Ok(Self { dir })
    }

    /// Where the folder is.
    pub fn path(&self) -> &Path {
        &self.dir
    }

    /// The host's secret key, made on first use. A file there that isn't a
    /// key is an error, never replaced: a new key would orphan every ticket
    /// and pairing.
    pub fn secret_key(&self) -> Result<SecretKey, HostError> {
        let path = self.dir.join(SECRET_KEY_FILE);
        match fs::read(&path) {
            Ok(bytes) => {
                let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
                    HostError::new(format!(
                        "{}: not a key (a key is 32 bytes). Moving it aside makes a new one, which gives the host a new key.",
                        path.display()
                    ))
                })?;
                Ok(SecretKey::from_bytes(&bytes))
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                let key = SecretKey::generate();
                write_private(&path, &key.to_bytes()).map_err(|err| file_error(&path, err))?;
                info!("made the host's key: {}", key.public());
                Ok(key)
            }
            Err(err) => Err(file_error(&path, err)),
        }
    }

    /// Where the allow-list is.
    pub(crate) fn allow_path(&self) -> PathBuf {
        self.dir.join(ALLOW_FILE)
    }

    /// The relay `serve` recorded, if it has.
    pub fn relay(&self) -> Result<Option<RelayUrl>, HostError> {
        let path = self.dir.join(RELAY_FILE);
        match fs::read_to_string(&path) {
            Ok(text) => check_relay(text.trim())
                .map(Some)
                .map_err(|_| HostError::new(format!("{}: not a relay address", path.display()))),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(file_error(&path, err)),
        }
    }

    /// Records the relay the host is reached through, for `qr`.
    pub(crate) fn record_relay(&self, relay: &RelayUrl) -> Result<(), HostError> {
        let path = self.dir.join(RELAY_FILE);
        write_private(&path, format!("{}\n", relay.as_str()).as_bytes())
            .map_err(|err| file_error(&path, err))
    }

    /// Saves `client --pair`'s pairing, and says where.
    pub fn save_client_pairing(&self, payload: &Value) -> Result<PathBuf, HostError> {
        let path = self.dir.join(CLIENT_PAIRING_FILE);
        let mut bytes = serde_json::to_vec_pretty(payload).expect("a JSON value serializes");
        bytes.push(b'\n');
        write_private(&path, &bytes).map_err(|err| file_error(&path, err))?;
        Ok(path)
    }
}

/// Makes `dir` if it's missing, and 0700 either way.
#[cfg(unix)]
fn make_private_dir(dir: &Path) -> Result<(), HostError> {
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent).map_err(|err| file_error(parent, err))?;
    }
    match DirBuilder::new().mode(0o700).create(dir) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {}
        Err(err) => return Err(file_error(dir, err)),
    }
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|err| file_error(dir, err))
}

/// Without POSIX modes the folder can't be made this user's alone, so it's
/// refused (see the top of this file).
#[cfg(not(unix))]
fn make_private_dir(dir: &Path) -> Result<(), HostError> {
    Err(HostError::new(format!(
        "{}: kleio-link-host can't keep its key on this OS yet, because it can't make the folder this user's alone",
        dir.display()
    )))
}

/// Writes `bytes` to `path` as a 0600 file, atomically: a new file in the
/// same folder, flushed to disk, then renamed over `path`. Callers never
/// write one file from two places at once.
#[cfg(unix)]
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a file in a folder",
        ));
    };
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id()
    ));
    // A file left by a crash keeps its own mode, so start afresh.
    match fs::remove_file(&tmp) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    let written = write_new(&tmp, bytes)
        .and_then(|()| fs::rename(&tmp, path))
        .and_then(|()| File::open(dir)?.sync_all());
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written
}

/// Without POSIX modes a file can't be made 0600, so nothing is written
/// (see the top of this file).
#[cfg(not(unix))]
pub(crate) fn write_private(path: &Path, _bytes: &[u8]) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        format!(
            "{}: can't make a file this user's alone on this OS",
            path.display()
        ),
    ))
}

#[cfg(unix)]
fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

// Every test here opens the folder, which only POSIX modes allow.
#[cfg(all(test, unix))]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::testing::{mode, TempDir};

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("a folder")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn makes_the_folder_0700_and_the_key_0600_once() {
        let tmp = TempDir::new("state-key");
        let dir = tmp.path().join("link-proto");
        // A folder that's already there but too open: opening it tightens it.
        fs::create_dir(&dir).expect("made");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).expect("set");
        let state = StateDir::open(&dir).expect("opens");
        assert_eq!(mode(&dir), 0o700);

        let key = state.secret_key().expect("a key");
        let file = dir.join(SECRET_KEY_FILE);
        assert_eq!(mode(&file), 0o600);
        assert_eq!(fs::read(&file).expect("saved"), key.to_bytes());
        assert_eq!(
            state.secret_key().expect("the same key").public(),
            key.public()
        );
        // The atomic write left nothing else behind.
        assert_eq!(names(&dir), [SECRET_KEY_FILE]);
    }

    #[test]
    fn never_replaces_a_damaged_key() {
        let tmp = TempDir::new("state-damaged-key");
        let state = StateDir::open(tmp.path().join("link-proto")).expect("opens");
        let file = state.path().join(SECRET_KEY_FILE);
        fs::write(&file, [7u8; 31]).expect("written");
        assert!(state.secret_key().is_err());
        assert_eq!(fs::read(&file).expect("still there"), [7u8; 31]);
    }

    #[test]
    fn records_the_relay_for_qr() {
        let tmp = TempDir::new("state-relay");
        let state = StateDir::open(tmp.path().join("link-proto")).expect("opens");
        assert_eq!(mode(state.path()), 0o700);
        assert_eq!(state.relay().expect("reads"), None);

        let relay: RelayUrl = "https://euc1-1.relay.n0.iroh.link./"
            .parse()
            .expect("a URL");
        state.record_relay(&relay).expect("recorded");
        assert_eq!(state.relay().expect("reads"), Some(relay));
        assert_eq!(mode(&state.path().join(RELAY_FILE)), 0o600);
    }

    #[test]
    fn saves_the_client_pairing_0600() {
        let tmp = TempDir::new("state-client-pairing");
        let state = StateDir::open(tmp.path().join("link-proto")).expect("opens");
        let path = state
            .save_client_pairing(&json!({"token": "t0k3n"}))
            .expect("saved");
        assert_eq!(path, state.path().join(CLIENT_PAIRING_FILE));
        assert_eq!(mode(&path), 0o600);
        let saved: Value = serde_json::from_slice(&fs::read(&path).expect("read")).expect("JSON");
        assert_eq!(saved, json!({"token": "t0k3n"}));
    }
}
