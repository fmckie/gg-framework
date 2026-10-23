//! kleio-host's state folder, as kleio-link-host uses it
//! (packages/kleio-host/src/paths.ts):
//!
//! ```text
//! secure/link.key             the host's secret key, 32 bytes, which kleio-host makes
//! secure/link-upstream.token  the secret each connection to kleio-host's link listener opens with
//! secure/link-allow.json      the paired keys, which kleio-host's device registry writes
//! link/config.json            the relay list, kleio-host's
//! link/state.json             where the link is, which this writes for kleio-host
//! ```
//!
//! The two secrets must be this user's alone: a file anyone else can read or
//! write, or in a folder anyone else can write, is refused, and so is one
//! that's missing (kleio-host makes them when it starts). Where there are
//! POSIX modes, that's 0600 files in a folder no one else can write. On
//! Windows it's their ACLs, which kleio-host locks to this user alone
//! (packages/kleio-host/src/acl.ts): an entry that lets anyone else in, the
//! file's or its folder's, is refused.
//!
//! `link/state.json` isn't secret: it's 0600 where there are POSIX modes,
//! and takes its folder's ACL on Windows.

use std::fs;
#[cfg(unix)]
use std::fs::DirBuilder;
use std::fs::{File, OpenOptions};
use std::io;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use iroh::SecretKey;
use serde_json::Value;

use super::{file_error, HostError};

/// kleio-host's state folder, and the files kleio-link-host uses in it.
#[derive(Debug, Clone)]
pub struct HostDir {
    home: PathBuf,
}

/// The most a secret file is read: a key is 32 bytes and a token 128.
const MAX_SECRET_BYTES: u64 = 256;

impl HostDir {
    pub fn new(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    /// kleio-host's own default (`resolveHostHome` in paths.ts):
    /// `KLEIO_HOST_HOME`, else the OS's place for per-user app state.
    pub fn default_home() -> Result<PathBuf, HostError> {
        let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
        if let Some(home) = var("KLEIO_HOST_HOME") {
            let home = PathBuf::from(home);
            return if home.is_absolute() {
                Ok(home)
            } else {
                Err(HostError::new(format!(
                    "KLEIO_HOST_HOME must be an absolute path, not {}",
                    home.display()
                )))
            };
        }
        let absolute = |name: &str| var(name).map(PathBuf::from).filter(|p| p.is_absolute());
        if cfg!(windows) {
            let local = absolute("LOCALAPPDATA")
                .or_else(|| absolute("USERPROFILE").map(|home| home.join("AppData").join("Local")))
                .ok_or_else(|| HostError::new("Neither LOCALAPPDATA nor USERPROFILE is set"))?;
            return Ok(local.join("Kleio").join("host"));
        }
        let home = absolute("HOME").ok_or_else(|| HostError::new("HOME isn't set"))?;
        if cfg!(target_os = "macos") {
            return Ok(home.join("Library/Application Support/Kleio/host"));
        }
        let state = absolute("XDG_STATE_HOME").unwrap_or_else(|| home.join(".local/state"));
        Ok(state.join("kleio").join("host"))
    }

    pub fn path(&self) -> &Path {
        &self.home
    }

    pub(crate) fn key_path(&self) -> PathBuf {
        self.home.join("secure").join("link.key")
    }

    pub(crate) fn token_path(&self) -> PathBuf {
        self.home.join("secure").join("link-upstream.token")
    }

    pub(crate) fn allow_path(&self) -> PathBuf {
        self.home.join("secure").join("link-allow.json")
    }

    pub(crate) fn link_dir(&self) -> PathBuf {
        self.home.join("link")
    }

    pub(crate) fn state_path(&self) -> PathBuf {
        self.link_dir().join("state.json")
    }

    /// kleio-host's relay list.
    pub(crate) fn config_path(&self) -> PathBuf {
        self.link_dir().join("config.json")
    }

    /// The host's secret key. kleio-host makes it; kleio-link-host never
    /// does, so the key in every ticket is the one kleio-host knows.
    pub fn secret_key(&self) -> Result<SecretKey, HostError> {
        let path = self.key_path();
        let bytes = read_secret(&path)?;
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
            HostError::new(format!(
                "{}: not a key (a key is 32 bytes). kleio-host makes it; don't replace it, or every paired device must pair again.",
                path.display()
            ))
        })?;
        Ok(SecretKey::from_bytes(&bytes))
    }

    /// The secret each connection to kleio-host's link listener opens with.
    pub(crate) fn upstream_token(&self) -> Result<String, HostError> {
        let path = self.token_path();
        let bytes = read_secret(&path)?;
        let token = String::from_utf8(bytes)
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|token| is_upstream_token(token))
            .ok_or_else(|| {
                HostError::new(format!(
                    "{}: not a token. kleio-host makes it: remove it, start kleio-host to make a new one, then start kleio-link-host again.",
                    path.display()
                ))
            })?;
        Ok(token)
    }

    /// Makes `link/` if it's missing: 0700 where there are POSIX modes.
    pub(crate) fn make_link_dir(&self) -> Result<(), HostError> {
        let dir = self.link_dir();
        if dir.is_dir() {
            return Ok(());
        }
        make_dir(&dir).map_err(|err| file_error(&dir, err))
    }

    /// Writes `link/state.json`.
    pub(crate) fn write_state(&self, bytes: &[u8]) -> Result<(), HostError> {
        let path = self.state_path();
        write_atomically(&path, bytes).map_err(|err| file_error(&path, err))
    }
}

/// What a token looks like, as kleio-host's `newUpstreamToken` makes one
/// (`isUpstreamToken` in link.ts).
pub(crate) fn is_upstream_token(token: &str) -> bool {
    (16..=128).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A secret file's bytes, if only this user can read or write it, and no
/// one else can write its folder.
fn read_secret(path: &Path) -> Result<Vec<u8>, HostError> {
    let at = |why: &str| HostError::new(format!("{}: {why}", path.display()));
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Err(at(
            "missing. kleio-host makes it when it starts: start kleio-host, then kleio-link-host.",
        )),
        Err(err) => return Err(file_error(path, err)),
    };
    // The open file's own metadata and ACL, so what's checked is what's read.
    let meta = file.metadata().map_err(|err| file_error(path, err))?;
    if !meta.is_file() {
        return Err(at("not a file"));
    }
    private::check_file(&file, &meta).map_err(|why| at(&why))?;
    if let Some(dir) = path.parent() {
        private::check_folder(dir, path)
            .map_err(|why| HostError::new(format!("{}: {why}", dir.display())))?;
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_SECRET_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| file_error(path, err))?;
    if bytes.len() as u64 > MAX_SECRET_BYTES {
        return Err(at("too long to be a key or a token"));
    }
    Ok(bytes)
}

/// Whether a secret file and its folder are this user's alone, by their
/// POSIX modes.
#[cfg(unix)]
mod private {
    use std::fs::{self, File, Metadata};
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;

    pub(super) fn check_file(_file: &File, meta: &Metadata) -> Result<(), String> {
        let mode = meta.mode() & 0o777;
        if mode & 0o077 != 0 {
            return Err(format!(
                "other users can read or write it (mode {mode:o}); it must be 600. kleio-host makes it so."
            ));
        }
        Ok(())
    }

    pub(super) fn check_folder(dir: &Path, file: &Path) -> Result<(), String> {
        let mode = fs::metadata(dir).map_err(|err| err.to_string())?.mode() & 0o777;
        if mode & 0o022 != 0 {
            return Err(format!(
                "other users can write this folder (mode {mode:o}), so they could replace {}; it must be 700. kleio-host makes it so.",
                file.display()
            ));
        }
        Ok(())
    }
}

/// Whether a secret file and its folder are this user's alone, by their
/// ACLs.
#[cfg(windows)]
mod private {
    use std::fs::{File, Metadata};
    use std::path::Path;

    use super::{acl, not_private};

    /// What to do about either.
    const LOCK: &str = "it must be this user's alone. kleio-host locks it so when it starts: start kleio-host, then kleio-link-host.";

    pub(super) fn check_file(file: &File, _meta: &Metadata) -> Result<(), String> {
        let entries =
            acl::file_entries(file).map_err(|err| format!("can't read its ACL: {err}"))?;
        match not_private(entries.as_deref()) {
            None => Ok(()),
            Some(why) => Err(format!("{why}; {LOCK}")),
        }
    }

    pub(super) fn check_folder(dir: &Path, file: &Path) -> Result<(), String> {
        let entries =
            acl::folder_entries(dir).map_err(|err| format!("can't read its ACL: {err}"))?;
        match not_private(entries.as_deref()) {
            None => Ok(()),
            Some(why) => Err(format!(
                "{why}, so they could replace {}; {LOCK}",
                file.display()
            )),
        }
    }
}

/// Elsewhere there's no telling a file is this user's alone, so the
/// secrets are refused.
#[cfg(not(any(unix, windows)))]
mod private {
    use std::fs::{File, Metadata};
    use std::path::Path;

    pub(super) fn check_file(_file: &File, _meta: &Metadata) -> Result<(), String> {
        Err("kleio-link-host can't tell this file is this user's alone on this OS".into())
    }

    pub(super) fn check_folder(_dir: &Path, _file: &Path) -> Result<(), String> {
        Ok(())
    }
}

/// One entry of a Windows ACL, as the secrets' check reads it.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AceKind {
    /// It lets someone in: this user, or someone else.
    Allows { user: bool },
    /// It keeps someone out, which leaves the file no less private.
    Denies,
    /// Another kind (an object or a conditional entry, say), which this
    /// doesn't read, or one Windows didn't give back.
    Unread,
}

/// Why an ACL with `entries` isn't this user's alone, or `None` if it is.
/// No ACL at all (`None`) lets everyone in.
#[cfg(any(windows, test))]
pub(crate) fn not_private(entries: Option<&[AceKind]>) -> Option<String> {
    let Some(entries) = entries else {
        return Some("it has no ACL, so everyone can get at it".into());
    };
    let count = |kind: AceKind| entries.iter().filter(|entry| **entry == kind).count();
    let (others, unread) = (
        count(AceKind::Allows { user: false }),
        count(AceKind::Unread),
    );
    if others > 0 {
        let accounts = if others == 1 { "account" } else { "accounts" };
        Some(format!("its ACL lets {others} other {accounts} in"))
    } else if unread > 0 {
        let entries = if unread == 1 { "entry" } else { "entries" };
        Some(format!(
            "its ACL has {unread} {entries} of a kind this doesn't read"
        ))
    } else {
        None
    }
}

/// The ACLs of the host's secrets and their folder, read through Win32.
#[cfg(windows)]
mod acl {
    use std::ffi::c_void;
    use std::fs::File;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::Security::Authorization::{
        GetNamedSecurityInfoW, GetSecurityInfo, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        EqualSid, GetAce, GetTokenInformation, TokenUser, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL,
        DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    use super::AceKind;

    /// The ACE types (winnt.h) that let in or keep out by SID alone.
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    const ACCESS_DENIED_ACE_TYPE: u8 = 1;

    /// This process's user: what `GetTokenInformation(TokenUser)` wrote, in
    /// a buffer aligned for `TOKEN_USER`, whose SID points into it.
    struct User(Vec<u64>);

    impl User {
        fn current() -> io::Result<Self> {
            let mut token: HANDLE = ptr::null_mut();
            // SAFETY: GetCurrentProcess's pseudo-handle needs no closing, and
            // OpenProcessToken writes a handle to `token` when it succeeds.
            if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
                return Err(io::Error::last_os_error());
            }
            let user = Self::of(token);
            // SAFETY: the handle opened above, closed once.
            unsafe { CloseHandle(token) };
            user
        }

        fn of(token: HANDLE) -> io::Result<Self> {
            let mut needed = 0u32;
            // SAFETY: with no buffer it only says how long one must be.
            unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed) };
            if needed == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
            // SAFETY: `buf` holds at least `needed` bytes, aligned for TOKEN_USER.
            let got = unsafe {
                GetTokenInformation(
                    token,
                    TokenUser,
                    buf.as_mut_ptr().cast::<c_void>(),
                    needed,
                    &mut needed,
                )
            };
            if got == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(buf))
        }

        fn sid(&self) -> PSID {
            // SAFETY: the buffer holds the TOKEN_USER GetTokenInformation wrote.
            unsafe { (*self.0.as_ptr().cast::<TOKEN_USER>()).User.Sid }
        }
    }

    /// A DACL Windows gave back, and the security descriptor it lives in,
    /// which is freed when this is dropped.
    struct Dacl {
        acl: *const ACL,
        descriptor: PSECURITY_DESCRIPTOR,
    }

    impl Dacl {
        /// What a `Get(Named)SecurityInfo` call that returned `status` gave.
        fn from_call(
            status: u32,
            acl: *mut ACL,
            descriptor: PSECURITY_DESCRIPTOR,
        ) -> io::Result<Self> {
            let dacl = Self { acl, descriptor };
            if status != ERROR_SUCCESS {
                return Err(io::Error::from_raw_os_error(status as i32));
            }
            Ok(dacl)
        }

        /// Each entry, as the check reads it; `None` for no DACL at all.
        fn entries(&self, user: &User) -> Option<Vec<AceKind>> {
            if self.acl.is_null() {
                return None;
            }
            // SAFETY: a DACL Windows gave back, in a descriptor still held.
            let count = u32::from(unsafe { (*self.acl).AceCount });
            let mut kinds = Vec::new();
            for index in 0..count {
                let mut ace: *mut c_void = ptr::null_mut();
                // SAFETY: `index` is below the ACL's count; GetAce writes a
                // pointer into the ACL when it succeeds.
                if unsafe { GetAce(self.acl, index, &mut ace) } == 0 || ace.is_null() {
                    kinds.push(AceKind::Unread);
                    continue;
                }
                // SAFETY: every ACE starts with an ACE_HEADER.
                let kind = unsafe { (*ace.cast::<ACE_HEADER>()).AceType };
                kinds.push(match kind {
                    ACCESS_ALLOWED_ACE_TYPE => {
                        // SAFETY: an ACCESS_ALLOWED_ACE, whose SID starts at
                        // SidStart; the user's SID is valid while `user` is.
                        let same = unsafe {
                            let allowed = ace.cast::<ACCESS_ALLOWED_ACE>();
                            let sid: PSID = ptr::addr_of_mut!((*allowed).SidStart).cast();
                            EqualSid(sid, user.sid())
                        };
                        AceKind::Allows { user: same != 0 }
                    }
                    ACCESS_DENIED_ACE_TYPE => AceKind::Denies,
                    _ => AceKind::Unread,
                });
            }
            Some(kinds)
        }
    }

    impl Drop for Dacl {
        fn drop(&mut self) {
            if !self.descriptor.is_null() {
                // SAFETY: Get(Named)SecurityInfo allocated it with LocalAlloc.
                unsafe { LocalFree(self.descriptor) };
            }
        }
    }

    /// The entries of the open `file`'s ACL, so they're the ACL of the file
    /// read. Files open with READ_CONTROL, which GENERIC_READ includes.
    pub(super) fn file_entries(file: &File) -> io::Result<Option<Vec<AceKind>>> {
        let user = User::current()?;
        let mut acl: *mut ACL = ptr::null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
        // SAFETY: an open handle, and out pointers to locals.
        let status = unsafe {
            GetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut acl,
                ptr::null_mut(),
                &mut descriptor,
            )
        };
        Ok(Dacl::from_call(status, acl, descriptor)?.entries(&user))
    }

    /// The entries of the folder `dir`'s ACL.
    pub(super) fn folder_entries(dir: &Path) -> io::Result<Option<Vec<AceKind>>> {
        let user = User::current()?;
        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut acl: *mut ACL = ptr::null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
        // SAFETY: a NUL-terminated path, and out pointers to locals.
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut acl,
                ptr::null_mut(),
                &mut descriptor,
            )
        };
        Ok(Dacl::from_call(status, acl, descriptor)?.entries(&user))
    }
}

#[cfg(unix)]
fn make_dir(dir: &Path) -> io::Result<()> {
    match DirBuilder::new().mode(0o700).create(dir) {
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        made => made,
    }
}

#[cfg(not(unix))]
fn make_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)
}

/// Saves `client --pair`'s pairing, device token included, at `path`: a 0600
/// file, so only where there are POSIX modes.
pub fn save_private_json(path: &Path, value: &Value) -> Result<(), HostError> {
    if !cfg!(unix) {
        return Err(HostError::new(format!(
            "{}: can't make a file this user's alone on this OS",
            path.display()
        )));
    }
    let mut bytes = serde_json::to_vec_pretty(value).expect("a JSON value serializes");
    bytes.push(b'\n');
    write_atomically(path, &bytes).map_err(|err| file_error(path, err))
}

/// Writes `bytes` to `path` atomically: a new file in the same folder,
/// flushed to disk, then renamed over `path`. It's 0600 where there are
/// POSIX modes, and takes its folder's ACL on Windows. Callers never write
/// one file from two places at once.
pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
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
        .and_then(|()| sync_folder(dir));
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Flushes a rename in `dir` to disk. Windows opens no folder as a file, and
/// NTFS logs a rename itself.
fn sync_folder(dir: &Path) -> io::Result<()> {
    if cfg!(unix) {
        File::open(dir)?.sync_all()
    } else {
        Ok(())
    }
}

/// What tells a file has changed: its size, its time and, where there are
/// inodes, which file it is (kleio-host replaces its files by renaming).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Signature {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    inode: (u64, u64),
}

/// `path`'s signature, or `None` if it's missing.
pub(crate) fn signature(path: &Path) -> io::Result<Option<Signature>> {
    match fs::metadata(path) {
        Ok(meta) => Ok(Some(Signature {
            len: meta.len(),
            modified: meta.modified().ok(),
            #[cfg(unix)]
            inode: (meta.dev(), meta.ino()),
        })),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

/// `at` in UTC as JavaScript's `toISOString` writes it:
/// `2026-10-23T12:03:04.567Z`.
pub(crate) fn iso8601(at: SystemTime) -> String {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let rest = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        since.subsec_millis()
    )
}

/// Days since 1970-01-01 as a (year, month, day) date: Howard Hinnant's
/// `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::testing::TempDir;

    #[test]
    fn writes_times_as_javascript_does() {
        let at = |secs: u64, millis: u64| {
            iso8601(UNIX_EPOCH + Duration::from_secs(secs) + Duration::from_millis(millis))
        };
        assert_eq!(at(0, 0), "1970-01-01T00:00:00.000Z");
        // new Date(Date.UTC(2026, 9, 23, 12, 3, 4, 567)).toISOString()
        assert_eq!(at(1_792_756_984, 567), "2026-10-23T12:03:04.567Z");
        // A leap day, and the day after.
        assert_eq!(at(1_709_164_800, 0), "2024-02-29T00:00:00.000Z");
        assert_eq!(at(1_709_251_199, 999), "2024-02-29T23:59:59.999Z");
        assert_eq!(at(1_709_251_200, 0), "2024-03-01T00:00:00.000Z");
        assert_eq!(at(951_782_400, 0), "2000-02-29T00:00:00.000Z");
    }

    /// An ACL is this user's alone when no entry lets anyone else in.
    #[test]
    fn reads_an_acl_as_this_users_alone_only_if_no_one_else_is_let_in() {
        use AceKind::{Allows, Denies, Unread};
        let user = Allows { user: true };
        let other = Allows { user: false };
        for entries in [
            vec![user],
            vec![user, Denies],
            vec![Denies, user, user],
            vec![],
        ] {
            assert_eq!(not_private(Some(&entries)), None, "{entries:?}");
        }
        for (entries, why) in [
            (vec![user, other], "its ACL lets 1 other account in"),
            (
                vec![other, Denies, other],
                "its ACL lets 2 other accounts in",
            ),
            (
                vec![user, Unread],
                "its ACL has 1 entry of a kind this doesn't read",
            ),
            (vec![Unread, other], "its ACL lets 1 other account in"),
        ] {
            assert_eq!(not_private(Some(&entries)).as_deref(), Some(why));
        }
        assert_eq!(
            not_private(None).as_deref(),
            Some("it has no ACL, so everyone can get at it")
        );
    }

    #[test]
    fn takes_only_tokens_kleio_host_makes() {
        assert!(is_upstream_token(&"a".repeat(16)));
        assert!(is_upstream_token("Sx3_-Sx3_-Sx3_-Sx3_-Sx3_-Sx3_-Sx3_-abc"));
        for bad in [
            "",
            "short",
            "has space in it ok",
            "dots.are.not.in.it.at.all",
        ] {
            assert!(!is_upstream_token(bad), "{bad:?}");
        }
        assert!(!is_upstream_token(&"a".repeat(129)));
    }

    #[cfg(unix)]
    mod unix {
        use std::os::unix::fs::PermissionsExt;

        use super::*;

        /// A state folder with a 0700 `secure/`, as kleio-host makes it.
        fn host_dir(tmp: &TempDir) -> HostDir {
            let dir = HostDir::new(tmp.path().join("host"));
            let secure = dir.path().join("secure");
            fs::create_dir_all(&secure).expect("made");
            fs::set_permissions(&secure, fs::Permissions::from_mode(0o700)).expect("set");
            dir
        }

        fn put(path: &Path, bytes: &[u8], mode: u32) {
            fs::write(path, bytes).expect("written");
            fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("set");
        }

        #[test]
        fn reads_the_key_kleio_host_made_and_never_makes_one() {
            let tmp = TempDir::new("state-key");
            let dir = host_dir(&tmp);
            let missing = dir.secret_key().expect_err("no key yet");
            assert!(
                missing.to_string().contains("start kleio-host"),
                "{missing}"
            );
            assert!(!dir.key_path().exists());

            put(&dir.key_path(), &[7; 32], 0o600);
            assert_eq!(
                dir.secret_key().expect("a key").public(),
                SecretKey::from_bytes(&[7; 32]).public()
            );
            put(&dir.key_path(), &[7; 31], 0o600);
            assert!(dir.secret_key().is_err());
            assert_eq!(fs::read(dir.key_path()).expect("left alone"), [7; 31]);
        }

        #[test]
        fn refuses_secrets_other_users_can_reach() {
            let tmp = TempDir::new("state-modes");
            let dir = host_dir(&tmp);
            for mode in [0o644, 0o640, 0o620, 0o604, 0o602, 0o660] {
                put(&dir.key_path(), &[7; 32], mode);
                let refused = dir.secret_key().expect_err("refused");
                assert!(
                    refused.to_string().contains("other users"),
                    "{mode:o}: {refused}"
                );
            }
            put(&dir.key_path(), &[7; 32], 0o400);
            assert!(dir.secret_key().is_ok());

            let secure = dir.path().join("secure");
            fs::set_permissions(&secure, fs::Permissions::from_mode(0o770)).expect("set");
            let refused = dir.secret_key().expect_err("a folder others can write");
            assert!(refused.to_string().contains("this folder"), "{refused}");
            fs::set_permissions(&secure, fs::Permissions::from_mode(0o700)).expect("set");
        }

        #[test]
        fn reads_the_upstream_token_trimmed() {
            let tmp = TempDir::new("state-token");
            let dir = host_dir(&tmp);
            let token = "Sx3_".repeat(10) + "abc";
            put(&dir.token_path(), format!("{token}\n").as_bytes(), 0o600);
            assert_eq!(dir.upstream_token().expect("a token"), token);
            put(&dir.token_path(), b"not a token!\n", 0o600);
            assert!(dir.upstream_token().is_err());
            put(&dir.token_path(), &[b'a'; 300], 0o600);
            assert!(dir.upstream_token().is_err());
        }

        #[test]
        fn writes_the_state_file_0600_in_a_0700_link_folder() {
            let tmp = TempDir::new("state-file");
            let dir = host_dir(&tmp);
            dir.make_link_dir().expect("made");
            assert_eq!(crate::testing::mode(&dir.link_dir()), 0o700);
            dir.write_state(b"{}\n").expect("written");
            assert_eq!(crate::testing::mode(&dir.state_path()), 0o600);
            assert_eq!(fs::read(dir.state_path()).expect("read"), b"{}\n");
            // A link folder kleio-host made is left as it is.
            dir.make_link_dir().expect("still fine");
        }

        #[test]
        fn a_signature_changes_when_the_file_is_replaced() {
            let tmp = TempDir::new("state-signature");
            let path = tmp.path().join("f.json");
            assert_eq!(signature(&path).expect("reads"), None);
            write_atomically(&path, b"[1]").expect("written");
            let first = signature(&path).expect("reads");
            assert!(first.is_some());
            assert_eq!(signature(&path).expect("reads"), first);
            write_atomically(&path, b"[2]").expect("written");
            assert_ne!(signature(&path).expect("reads"), first);
        }
    }

    /// The secrets' ACLs, set as kleio-host's acl.ts sets them, with icacls.
    #[cfg(windows)]
    mod windows {
        use std::process::Command;

        use super::*;

        fn system32(program: &str) -> PathBuf {
            let root = std::env::var_os("SystemRoot").expect("SystemRoot is set");
            PathBuf::from(root).join("System32").join(program)
        }

        /// This user's SID, from `whoami /user /fo csv /nh`.
        fn user_sid() -> String {
            let out = Command::new(system32("whoami.exe"))
                .args(["/user", "/fo", "csv", "/nh"])
                .output()
                .expect("whoami runs");
            let text = String::from_utf8_lossy(&out.stdout).into_owned();
            let sid = text.trim().rsplit(',').next().unwrap_or_default();
            let sid = sid.trim().trim_matches('"').to_string();
            assert!(sid.starts_with("S-1-"), "whoami said {text:?}");
            sid
        }

        /// Leaves this user the only one with any access to `path`.
        fn lock(path: &Path, folder: bool) {
            let rights = if folder { "(OI)(CI)F" } else { "F" };
            let grant = format!("*{}:{rights}", user_sid());
            let out = Command::new(system32("icacls.exe"))
                .arg(path)
                .args(["/inheritance:r", "/grant:r", &grant])
                .output()
                .expect("icacls runs");
            assert!(out.status.success(), "icacls {}: {out:?}", path.display());
        }

        #[test]
        fn reads_a_secret_only_once_it_and_its_folder_are_this_users_alone() {
            let tmp = TempDir::new("state-acl");
            let dir = HostDir::new(tmp.path().join("host"));
            let secure = dir.path().join("secure");
            fs::create_dir_all(&secure).expect("made");
            fs::write(dir.key_path(), [7; 32]).expect("written");

            // As made in the temp folder: SYSTEM and Administrators are in.
            let refused = dir.secret_key().expect_err("others are let in");
            assert!(refused.to_string().contains("other account"), "{refused}");
            lock(&dir.key_path(), false);
            let refused = dir.secret_key().expect_err("the folder lets others in");
            assert!(refused.to_string().contains("could replace"), "{refused}");
            lock(&secure, true);
            assert_eq!(
                dir.secret_key().expect("a key").public(),
                SecretKey::from_bytes(&[7; 32]).public()
            );

            // A token made in the locked folder takes its one entry.
            let token = "Sx3_".repeat(10) + "abc";
            fs::write(dir.token_path(), &token).expect("written");
            assert_eq!(dir.upstream_token().expect("a token"), token);
        }

        #[test]
        fn writes_the_state_file_over_the_last_one() {
            let tmp = TempDir::new("state-file-windows");
            let dir = HostDir::new(tmp.path().join("host"));
            fs::create_dir_all(dir.path()).expect("made");
            dir.make_link_dir().expect("made");
            dir.write_state(b"{}\n").expect("written");
            dir.write_state(b"{\"a\":1}\n").expect("written over");
            assert_eq!(fs::read(dir.state_path()).expect("read"), b"{\"a\":1}\n");
        }
    }
}
