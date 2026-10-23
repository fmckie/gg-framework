//! Windows ACLs for kleio-link's tests, set as kleio-host's acl.ts sets
//! them: this user's alone. The unit tests (src/host/state.rs) and the
//! integration tests (tests/common) each include this file by path, so it
//! uses nothing of either's.

/// SDDL's names for the well-known SIDs that are the same on every
/// machine, as kleio-host's acl.ts maps them, so an entry for one can be
/// removed by its SID.
pub const WELL_KNOWN_SIDS: [(&str, &str); 19] = [
    ("AC", "S-1-15-2-1"),
    ("AN", "S-1-5-7"),
    ("AU", "S-1-5-11"),
    ("BA", "S-1-5-32-544"),
    ("BG", "S-1-5-32-546"),
    ("BU", "S-1-5-32-545"),
    ("CG", "S-1-3-1"),
    ("CO", "S-1-3-0"),
    ("IU", "S-1-5-4"),
    ("LS", "S-1-5-19"),
    ("NS", "S-1-5-20"),
    ("NU", "S-1-5-2"),
    ("OW", "S-1-3-4"),
    ("PU", "S-1-5-32-547"),
    ("RC", "S-1-5-12"),
    ("SU", "S-1-5-6"),
    ("SY", "S-1-5-18"),
    ("WD", "S-1-1-0"),
    ("WR", "S-1-5-33"),
];

/// The accounts other than `user` (a SID) with entries in the DACL that
/// `icacls <path> /save` wrote, as SIDs, sorted: what kleio-host's acl.ts
/// removes. The file is UTF-16LE: the path's name, then its SDDL, which
/// writes the machine's own Administrator (RID 500) as `LA`.
pub fn other_sids(saved: &[u8], user: &str) -> Vec<String> {
    let (pairs, _) = saved.as_chunks::<2>();
    let units: Vec<u16> = pairs.iter().map(|pair| u16::from_le_bytes(*pair)).collect();
    let text = String::from_utf16_lossy(&units).replace(['\u{feff}', '\0'], "");
    let sddl = text
        .lines()
        .find(|line| line.starts_with("D:"))
        .unwrap_or_else(|| panic!("no DACL in {text:?}"));
    // A SACL may follow the DACL's entries.
    let dacl = sddl.find(")S:").map_or(sddl, |end| &sddl[..=end]);
    let mut sids: Vec<String> = dacl
        .split('(')
        .skip(1)
        .filter_map(|entry| entry.split_once(')').map(|(ace, _)| ace))
        .map(|ace| ace.rsplit(';').next().unwrap_or_default())
        .filter(|sid| *sid != user && !(*sid == "LA" && user.ends_with("-500")))
        .map(|sid| {
            if sid.starts_with("S-1-") {
                return sid.to_string();
            }
            WELL_KNOWN_SIDS
                .iter()
                .find(|(name, _)| *name == sid)
                .map(|(_, full)| (*full).to_string())
                .unwrap_or_else(|| panic!("no SID for {sid:?} in {sddl:?}"))
        })
        .collect();
    sids.sort();
    sids.dedup();
    sids
}

/// Leaves this user the only one with any access to `path`, as kleio-host's
/// acl.ts does: inheritance cut off and this user's grant, then every other
/// account's entries removed. The grant alone keeps the entries Windows gives
/// the path itself when the folder above passes nothing down: SYSTEM's and
/// the Administrators group's, on CI's runners.
#[cfg(windows)]
pub fn lock(path: &std::path::Path, folder: bool) {
    let user = user_sid();
    let rights = if folder { "(OI)(CI)F" } else { "F" };
    let grant = format!("*{user}:{rights}");
    icacls(path, &["/inheritance:r", "/grant:r", &grant]);
    for sid in others_in(path, &user) {
        icacls(path, &["/remove", &format!("*{sid}")]);
    }
    let left = others_in(path, &user);
    assert!(left.is_empty(), "{} still lets {left:?} in", path.display());
}

#[cfg(windows)]
fn system32(program: &str) -> std::path::PathBuf {
    let root = std::env::var_os("SystemRoot").expect("SystemRoot is set");
    std::path::PathBuf::from(root)
        .join("System32")
        .join(program)
}

/// This user's SID, from `whoami /user /fo csv /nh`.
#[cfg(windows)]
fn user_sid() -> String {
    let out = std::process::Command::new(system32("whoami.exe"))
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .expect("whoami runs");
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let sid = text.trim().rsplit(',').next().unwrap_or_default();
    let sid = sid.trim().trim_matches('"').to_string();
    assert!(sid.starts_with("S-1-"), "whoami said {text:?}");
    sid
}

/// The accounts other than `user` with entries in `path`'s ACL, from what
/// `icacls <path> /save` writes, beside `path` and removed once read.
#[cfg(windows)]
fn others_in(path: &std::path::Path, user: &str) -> Vec<String> {
    let name = path
        .file_name()
        .expect("a path with a name")
        .to_string_lossy();
    let file = path.with_file_name(format!("{name}.acl-saved"));
    let out = std::process::Command::new(system32("icacls.exe"))
        .arg(path)
        .arg("/save")
        .arg(&file)
        .output()
        .expect("icacls runs");
    assert!(
        out.status.success(),
        "icacls {} /save: {out:?}",
        path.display()
    );
    let saved = std::fs::read(&file).expect("icacls saved the ACL");
    std::fs::remove_file(&file).expect("the saved ACL is removed");
    other_sids(&saved, user)
}

#[cfg(windows)]
fn icacls(path: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new(system32("icacls.exe"))
        .arg(path)
        .args(args)
        .output()
        .expect("icacls runs");
    assert!(
        out.status.success(),
        "icacls {} {args:?}: {out:?}",
        path.display()
    );
}
