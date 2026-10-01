//! Files an agent on the Kleio host wrote and linked in chat by relative name.
//!
//! The webview names such a file by its owner (a Blob, or a Blob inside a
//! Group) plus the relative path — never by a local path. Rust validates both,
//! downloads the bytes over the device-authenticated client into the app cache
//! and previews (Quick Look thumbnail), opens (default app) or saves (native
//! dialog) the cached copy.
//!
//!   GET {base}/kleio/blobs/{blobId}/files/{path}
//!   GET {base}/kleio/groups/{groupId}/members/{blobId}/files/{path}
//!
//! 200 = raw bytes; errors are JSON `{"error": "..."}` (400 bad path, 404 no
//! such agent/group/file, 413 over the host's 50 MiB cap).

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::commands::{api_client, root_cause};

/// The host's cap (it answers 413 above it); we never buffer more than this.
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_SEGMENTS: usize = 16;
const MAX_PATH_BYTES: usize = 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);
/// Cached files live at `<app_cache_dir>/kleio-files/<owner key>/<segments…>`.
const CACHE_DIR: &str = "kleio-files";

/// Whose workspace a file lives in, exactly as the webview sends it:
/// `{ "kind": "blob", "blobId": "b_1234abcd" }` or
/// `{ "kind": "group", "groupId": "g_1234abcd", "blobId": "b_1234abcd" }`.
#[derive(Deserialize, Debug, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum FileOwner {
    Blob { blob_id: String },
    Group { group_id: String, blob_id: String },
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    /// The file name (last path segment).
    pub name: String,
    pub size: u64,
    /// The response's Content-Type essence, e.g. `application/pdf`.
    pub mime: String,
    /// `data:image/png;base64,…` from Quick Look (macOS), else null.
    pub thumbnail: Option<String>,
}

/// `prefix` followed by exactly 8 lowercase hex digits, e.g. `b_1234abcd`.
fn valid_id(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix).is_some_and(|hex| {
        hex.len() == 8 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

impl FileOwner {
    fn validate(&self) -> Result<(), String> {
        let ok = match self {
            FileOwner::Blob { blob_id } => valid_id(blob_id, "b_"),
            FileOwner::Group { group_id, blob_id } => {
                valid_id(group_id, "g_") && valid_id(blob_id, "b_")
            }
        };
        if ok {
            Ok(())
        } else {
            Err("kleio_file: bad agent id".to_string())
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            FileOwner::Blob { .. } => "blob",
            FileOwner::Group { .. } => "group",
        }
    }

    /// Host route up to (not including) the file path. Ids validated first.
    fn route(&self) -> String {
        match self {
            FileOwner::Blob { blob_id } => format!("/kleio/blobs/{blob_id}/files"),
            FileOwner::Group { group_id, blob_id } => {
                format!("/kleio/groups/{group_id}/members/{blob_id}/files")
            }
        }
    }

    /// One cache sub-directory per owner.
    fn cache_key(&self) -> String {
        match self {
            FileOwner::Blob { blob_id } => format!("blob-{blob_id}"),
            FileOwner::Group { group_id, blob_id } => format!("group-{group_id}-{blob_id}"),
        }
    }
}

fn bad_path(why: &str) -> String {
    format!("kleio_file: bad path ({why})")
}

/// The relative path's segments, or why it is refused. The host checks again;
/// this keeps a hostile path out of both the URL and the local cache dir.
fn path_segments(path: &str) -> Result<Vec<&str>, String> {
    if path.is_empty() {
        return Err(bad_path("empty"));
    }
    if path.len() > MAX_PATH_BYTES {
        return Err(bad_path("too long"));
    }
    let segs: Vec<&str> = path.split('/').collect();
    if segs.len() > MAX_SEGMENTS {
        return Err(bad_path("too deep"));
    }
    for s in &segs {
        // A leading '.' also rules out "." and ".." (and dotfiles).
        let plain = !s.is_empty()
            && !s.starts_with('.')
            && !s.chars().any(|c| c == '\\' || c.is_control())
            // Exactly one normal component on this OS as well (no `C:` drive
            // prefix on Windows), so pushing it can never leave the cache dir.
            && Path::new(s)
                .components()
                .eq([Component::Normal(OsStr::new(s))]);
        if !plain {
            return Err(bad_path("segment"));
        }
    }
    Ok(segs)
}

/// Percent-encode one path segment: RFC 3986 unreserved bytes stay, every
/// other UTF-8 byte becomes `%XX` (uppercase hex).
fn encode_segment(seg: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(seg.len() * 3);
    for b in seg.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(HEX[usize::from(b >> 4)] as char);
            out.push(HEX[usize::from(b & 0x0f)] as char);
        }
    }
    out
}

fn file_url(base: &str, owner: &FileOwner, segs: &[&str]) -> String {
    let encoded: Vec<String> = segs.iter().map(|s| encode_segment(s)).collect();
    format!("{base}{}/{}", owner.route(), encoded.join("/"))
}

fn cache_file(cache_root: &Path, owner: &FileOwner, segs: &[&str]) -> PathBuf {
    let mut p = cache_root.join(CACHE_DIR).join(owner.cache_key());
    p.extend(segs);
    p
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|e| format!("kleio_file: no cache dir: {e}"))
}

/// The host's `{"error": "..."}` message, else the status (as `host_auth`).
pub(super) fn host_error(status: u16, body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.as_str().map(str::to_string))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("Your Mac mini answered {status}"))
}

/// `text/plain` of `text/plain; charset=utf-8`, lowercase; octet-stream when
/// the header is absent or unreadable.
fn mime_of(content_type: Option<&str>) -> String {
    content_type
        .and_then(|s| s.split(';').next())
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "application/octet-stream".to_string())
}

fn too_large() -> String {
    format!(
        "That file is larger than {} MB.",
        MAX_FILE_BYTES / (1024 * 1024)
    )
}

/// Write-then-rename (as `store::save`) so the cache never holds a half file.
/// The temp name starts with '.', which no validated segment can.
fn write_atomic(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = dest.parent().ok_or("no parent dir")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(
        ".kleio-dl.{}.{}.tmp",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&tmp, bytes)
        .and_then(|()| std::fs::rename(&tmp, dest))
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
}

/// GET one file into memory (capped). Ok((bytes, mime)); Err carries the
/// host's message. Logs route kind, status, bytes and elapsed ms only.
async fn fetch_bytes(
    r: &super::Remote,
    kind: &str,
    url: &str,
) -> Result<(Vec<u8>, String), String> {
    let started = Instant::now();
    let fail = |status: Option<u16>, e: String| {
        let status = status.map_or_else(|| "no answer".to_string(), |s| s.to_string());
        let ms = started.elapsed().as_millis();
        log::warn!("kleio: file fetch ({kind}) failed ({status}) after {ms} ms: {e}");
        e
    };
    let mut res = match api_client(r)?.get(url).timeout(FETCH_TIMEOUT).send().await {
        Ok(res) => res,
        Err(e) => return Err(fail(None, root_cause(&e))),
    };
    let status = res.status().as_u16();
    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(fail(Some(status), host_error(status, &text)));
    }
    let mime = mime_of(
        res.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
    );
    let declared = res.content_length();
    if declared.is_some_and(|n| n > MAX_FILE_BYTES) {
        return Err(fail(Some(status), too_large()));
    }
    let mut bytes = Vec::with_capacity(declared.unwrap_or(0) as usize);
    loop {
        match res.chunk().await {
            Ok(Some(chunk)) => {
                if (bytes.len() + chunk.len()) as u64 > MAX_FILE_BYTES {
                    return Err(fail(Some(status), too_large()));
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return Err(fail(Some(status), root_cause(&e))),
        }
    }
    log::info!(
        "kleio: file fetch ({kind}) → {status}, {} bytes in {} ms",
        bytes.len(),
        started.elapsed().as_millis()
    );
    Ok((bytes, mime))
}

/// Download into the cache. Returns (cached file, size, mime).
async fn download(
    app: &AppHandle,
    owner: &FileOwner,
    segs: &[&str],
) -> Result<(PathBuf, u64, String), String> {
    let r = super::remote().ok_or("Not connected to your Mac mini.")?;
    let dest = cache_file(&cache_root(app)?, owner, segs);
    let (bytes, mime) = fetch_bytes(r, owner.kind(), &file_url(&r.base, owner, segs)).await?;
    let size = bytes.len() as u64;
    let target = dest.clone();
    tauri::async_runtime::spawn_blocking(move || write_atomic(&target, &bytes))
        .await
        .map_err(|e| e.to_string())??;
    Ok((dest, size, mime))
}

/// The cached copy if there is one, else a fresh download (no thumbnail).
async fn cached_or_fetch(
    app: &AppHandle,
    owner: &FileOwner,
    segs: &[&str],
) -> Result<PathBuf, String> {
    let cached = cache_file(&cache_root(app)?, owner, segs);
    if cached.is_file() {
        return Ok(cached);
    }
    Ok(download(app, owner, segs).await?.0)
}

/// Quick Look thumbnail as a PNG data URL. Any failure is None, never an error.
#[cfg(target_os = "macos")]
fn thumbnail(cache_root: &Path, file: &Path) -> Option<String> {
    use base64::Engine as _;
    use std::process::{Command, Stdio};

    const LIMIT: Duration = Duration::from_secs(10);
    static N: AtomicU32 = AtomicU32::new(0);
    // qlmanage waits forever on a missing file rather than failing.
    if !file.is_file() {
        return None;
    }
    let dir = cache_root.join(CACHE_DIR).join(format!(
        ".thumb.{}.{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).ok()?;
    let render = || -> Option<String> {
        let mut child = Command::new("/usr/bin/qlmanage")
            .args([OsStr::new("-t"), OsStr::new("-s"), OsStr::new("640")])
            .arg("-o")
            .arg(&dir)
            .arg(file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let deadline = Instant::now() + LIMIT;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
        // qlmanage names its output `<file name>.png`.
        let mut png = file.file_name()?.to_os_string();
        png.push(".png");
        let bytes = std::fs::read(dir.join(png))
            .ok()
            .filter(|b| !b.is_empty())?;
        Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    };
    let out = render();
    let _ = std::fs::remove_dir_all(&dir);
    out
}

#[cfg(not(target_os = "macos"))]
fn thumbnail(_cache_root: &Path, _file: &Path) -> Option<String> {
    None
}

/// Download a linked file into the cache (always fresh) and describe it.
#[tauri::command]
pub async fn kleio_file_fetch(
    app: AppHandle,
    owner: FileOwner,
    path: String,
) -> Result<FileInfo, String> {
    owner.validate()?;
    let segs = path_segments(&path)?;
    let name = segs.last().copied().unwrap_or_default().to_string();
    let (file, size, mime) = download(&app, &owner, &segs).await?;
    let root = cache_root(&app)?;
    let thumbnail = tauri::async_runtime::spawn_blocking(move || thumbnail(&root, &file))
        .await
        .ok()
        .flatten();
    Ok(FileInfo {
        name,
        size,
        mime,
        thumbnail,
    })
}

/// File types handed to their default app: documents, images and media only.
/// An agent reads untrusted web pages, so what it writes is untrusted too, and
/// some types act the moment they are opened (`.terminal` runs a command,
/// `.webloc` opens any URL, `.html`/`.svg` run script in a browser). Anything
/// not listed can still be saved; it is never opened from Kleio.
const OPENABLE: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "txt", "md", "csv", "json", "docx", "xlsx",
    "pptx", "mp3", "m4a", "wav", "mp4", "mov",
];

fn openable(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|ext| OPENABLE.contains(&ext.to_ascii_lowercase().as_str()))
}

/// Open the file with its default app (downloading it first if not cached).
/// Only `OPENABLE` types; the rest are refused before any download.
#[tauri::command]
pub async fn kleio_file_open(app: AppHandle, owner: FileOwner, path: String) -> Result<(), String> {
    owner.validate()?;
    let segs = path_segments(&path)?;
    if !segs.last().is_some_and(|name| openable(name)) {
        log::warn!(
            "kleio: file open ({}) refused: type not openable",
            owner.kind()
        );
        return Err("Kleio doesn't open this kind of file. Save a copy instead.".to_string());
    }
    let file = cached_or_fetch(&app, &owner, &segs).await?;
    log::info!("kleio: file open ({})", owner.kind());
    app.opener()
        .open_path(file.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

/// Save a copy where the user picks. Ok(false) when the dialog is cancelled.
#[tauri::command]
pub async fn kleio_file_save(
    app: AppHandle,
    owner: FileOwner,
    path: String,
) -> Result<bool, String> {
    owner.validate()?;
    let segs = path_segments(&path)?;
    let name = segs.last().copied().unwrap_or_default().to_string();
    let cached = cached_or_fetch(&app, &owner, &segs).await?;
    // The dialog posts to the main thread; block a worker, not the runtime.
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_file_name(name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(false);
    };
    let dest = picked.into_path().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::copy(&cached, &dest))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    log::info!(
        "kleio: file save ({}) → {bytes} bytes in {} ms",
        owner.kind(),
        started.elapsed().as_millis()
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One dir per call, even for tests running in parallel (see store.rs).
    fn tmp_dir() -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!(
            "kleio-files-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn blob() -> FileOwner {
        FileOwner::Blob {
            blob_id: "b_1234abcd".into(),
        }
    }

    fn group() -> FileOwner {
        FileOwner::Group {
            group_id: "g_00ff00ff".into(),
            blob_id: "b_1234abcd".into(),
        }
    }

    #[test]
    fn owner_deserializes_from_the_webview_shape() {
        let o: FileOwner =
            serde_json::from_str(r#"{ "kind": "blob", "blobId": "b_1234abcd" }"#).unwrap();
        assert_eq!(o, blob());
        let o: FileOwner = serde_json::from_str(
            r#"{ "kind": "group", "groupId": "g_00ff00ff", "blobId": "b_1234abcd" }"#,
        )
        .unwrap();
        assert_eq!(o, group());
        for bad in [
            r#"{ "kind": "Blob", "blobId": "b_1234abcd" }"#,
            r#"{ "kind": "blob", "blob_id": "b_1234abcd" }"#,
            r#"{ "kind": "group", "blobId": "b_1234abcd" }"#,
            r#"{ "kind": "file", "blobId": "b_1234abcd" }"#,
            r#"{ "blobId": "b_1234abcd" }"#,
        ] {
            assert!(serde_json::from_str::<FileOwner>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn only_documents_images_and_media_open() {
        for ok in [
            "Report.pdf",
            "chart.PNG",
            "notes.md",
            "Budget.xlsx",
            "clip.mov",
        ] {
            assert!(openable(ok), "{ok}");
        }
        for refused in [
            "run.terminal",
            "link.webloc",
            "link.inetloc",
            "place.fileloc",
            "page.html",
            "page.htm",
            "art.svg",
            "script.command",
            "tool.jar",
            "setup.pkg",
            "image.dmg",
            "profile.mobileconfig",
            "macro.docm",
            "Makefile",
            "report.pdf.terminal",
        ] {
            assert!(!openable(refused), "{refused}");
        }
    }

    #[test]
    fn owner_ids_are_validated() {
        assert!(blob().validate().is_ok());
        assert!(group().validate().is_ok());
        for id in [
            "",
            "b_",
            "b_1234abc",
            "b_1234abcde",
            "b_1234ABCD",
            "b_1234abcg",
            "g_1234abcd",
            "B_1234abcd",
            "b_1234ab/d",
            "b_../../x",
        ] {
            let o = FileOwner::Blob { blob_id: id.into() };
            assert!(o.validate().is_err(), "{id}");
        }
        let swapped = FileOwner::Group {
            group_id: "b_1234abcd".into(),
            blob_id: "g_00ff00ff".into(),
        };
        assert!(swapped.validate().is_err());
    }

    #[test]
    fn path_validation_table() {
        let deep_ok = vec!["a"; 16].join("/");
        let too_deep = vec!["a"; 17].join("/");
        let long_ok = "a".repeat(1024);
        let too_long = "a".repeat(1025);
        let cases: &[(&str, bool)] = &[
            ("report.md", true),
            ("out/summary 2026.pdf", true),
            ("a/b/c.txt", true),
            ("日本/レポート — final.md", true),
            ("a..b", true),
            ("v1.2/notes.", true),
            (&deep_ok, true),
            (&long_ok, true),
            ("", false),
            ("/abs/path", false),
            ("a//b", false),
            ("a/", false),
            (".", false),
            ("..", false),
            ("./a", false),
            ("a/./b", false),
            ("../x", false),
            ("a/../b", false),
            (".hidden", false),
            ("a/.git/config", false),
            ("a\\b", false),
            ("..\\x", false),
            ("a\u{0}b", false),
            ("a\nb", false),
            ("a\tb", false),
            ("a\u{7f}", false),
            ("a\u{85}", false),
            (&too_deep, false),
            (&too_long, false),
        ];
        for (path, ok) in cases {
            assert_eq!(path_segments(path).is_ok(), *ok, "{path:?}");
        }
        assert_eq!(
            path_segments("out/summary 2026.pdf").unwrap(),
            ["out", "summary 2026.pdf"]
        );
    }

    #[test]
    fn segments_are_percent_encoded() {
        assert_eq!(encode_segment("AZaz09-._~"), "AZaz09-._~");
        assert_eq!(encode_segment("my report.md"), "my%20report.md");
        assert_eq!(encode_segment("a — b"), "a%20%E2%80%94%20b");
        assert_eq!(encode_segment("café"), "caf%C3%A9");
        assert_eq!(encode_segment("日本"), "%E6%97%A5%E6%9C%AC");
        assert_eq!(
            encode_segment("100%+?#&=:;,"),
            "100%25%2B%3F%23%26%3D%3A%3B%2C"
        );
    }

    #[test]
    fn url_and_cache_path_per_owner() {
        let segs = path_segments("out/Q3 report — v2.pdf").unwrap();
        assert_eq!(
            file_url("https://host:8443", &blob(), &segs),
            "https://host:8443/kleio/blobs/b_1234abcd/files/out/Q3%20report%20%E2%80%94%20v2.pdf"
        );
        assert_eq!(
            file_url("https://host:8443", &group(), &segs),
            "https://host:8443/kleio/groups/g_00ff00ff/members/b_1234abcd/files/out/Q3%20report%20%E2%80%94%20v2.pdf"
        );
        let root = Path::new("cache");
        assert_eq!(
            cache_file(root, &blob(), &segs),
            root.join("kleio-files")
                .join("blob-b_1234abcd")
                .join("out")
                .join("Q3 report — v2.pdf")
        );
        assert_eq!(
            cache_file(root, &group(), &segs),
            root.join("kleio-files")
                .join("group-g_00ff00ff-b_1234abcd")
                .join("out")
                .join("Q3 report — v2.pdf")
        );
    }

    #[test]
    fn host_error_prefers_the_hosts_message() {
        assert_eq!(
            host_error(404, r#"{"error":"no such file"}"#),
            "no such file"
        );
        assert_eq!(
            host_error(413, r#"{"error":"file too large"}"#),
            "file too large"
        );
        assert_eq!(
            host_error(502, "<html>bad gateway</html>"),
            "Your Mac mini answered 502"
        );
        assert_eq!(
            host_error(500, r#"{"error":""}"#),
            "Your Mac mini answered 500"
        );
        assert_eq!(host_error(401, ""), "Your Mac mini answered 401");
    }

    #[test]
    fn mime_is_the_content_type_essence() {
        assert_eq!(mime_of(Some("application/pdf")), "application/pdf");
        assert_eq!(
            mime_of(Some("Text/Markdown; charset=utf-8")),
            "text/markdown"
        );
        assert_eq!(mime_of(Some("")), "application/octet-stream");
        assert_eq!(mime_of(None), "application/octet-stream");
    }

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp() {
        let dir = tmp_dir();
        let dest = dir.join("blob-b_1234abcd").join("out").join("r.md");
        write_atomic(&dest, b"first").unwrap();
        write_atomic(&dest, b"second").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"second");
        let names: Vec<_> = std::fs::read_dir(dest.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, [OsStr::new("r.md")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn thumbnail_failure_is_none_and_cleans_up() {
        let dir = tmp_dir();
        assert_eq!(thumbnail(&dir, &dir.join("missing.pdf")), None);
        let left = std::fs::read_dir(dir.join(CACHE_DIR))
            .map(|d| d.count())
            .unwrap_or(0);
        assert_eq!(left, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Quick Look may be unavailable on a headless CI runner, so only a local
    /// macOS run insists on a thumbnail; every run checks the shape + cleanup.
    #[cfg(target_os = "macos")]
    #[test]
    fn thumbnail_of_a_real_file_is_a_png_data_url() {
        let dir = tmp_dir();
        let file = dir
            .join(CACHE_DIR)
            .join("blob-b_1234abcd")
            .join("my report — v2.md");
        write_atomic(&file, b"# Report\n\nhello\n").unwrap();
        let thumb = thumbnail(&dir, &file);
        if std::env::var_os("CI").is_none() {
            assert!(thumb.is_some(), "qlmanage gave no thumbnail");
        }
        if let Some(t) = thumb {
            assert!(t.starts_with("data:image/png;base64,iVBOR"), "{}", &t[..40]);
        }
        let left: Vec<_> = std::fs::read_dir(dir.join(CACHE_DIR))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, [OsStr::new("blob-b_1234abcd")]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
