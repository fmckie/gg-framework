//! What Kleio's voice shows beside her on a call (kleio-host show.ts): the
//! parts of a show, as raw bytes for the panel (ShowPanel.tsx) to draw.
//!
//!   GET {base}/kleio/voice/show/{id}/{part}   part = text | image | page-<n>
//!
//! 200 = the part: plain text for `text`, a PNG, JPEG, GIF or WebP picture for
//! `image`, a PNG for a page. Errors are JSON `{"error", "detail"?, "pages"?}`.
//! The webview names a part only by the show's id and the part's name, both
//! checked here; the host checks them again, and that the show is this
//! device's. Making a show and asking how it is go through `kleio_api`
//! (commands.rs), whose allow-list takes this module's id check.

use std::time::{Duration, Instant};

use super::commands::{api_client, root_cause};
use super::files::mime_of;

/// The most a part may be: the host's cap on a PDF (its pictures stay under 20 MB).
const MAX_PART_BYTES: u64 = 50 * 1024 * 1024;
/// The highest page a part may name (the host shows at most 100).
const MAX_PAGE: u32 = 500;
/// A PDF's page is drawn on the host when it is asked for: give it time.
const PART_TIMEOUT: Duration = Duration::from_secs(60);
/// The longest reason or detail passed on from the host, in characters.
const MESSAGE_MAX: usize = 300;

/// A show's id as the host makes them: `sh_` and 32 lowercase hex digits.
pub(crate) fn valid_show_id(id: &str) -> bool {
    id.strip_prefix("sh_").is_some_and(|hex| {
        hex.len() == 32 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Part {
    Text,
    Image,
    Page(u32),
}

impl Part {
    /// `text`, `image` or `page-<n>` with n from 1 to `MAX_PAGE`, written
    /// plainly (digits only, no sign or leading zero); None for anything else.
    fn parse(s: &str) -> Option<Part> {
        match s {
            "text" => Some(Part::Text),
            "image" => Some(Part::Image),
            _ => {
                let n = s.strip_prefix("page-")?;
                if n.is_empty()
                    || n.len() > 3
                    || n.starts_with('0')
                    || !n.bytes().all(|b| b.is_ascii_digit())
                {
                    return None;
                }
                let n: u32 = n.parse().ok()?;
                (1..=MAX_PAGE).contains(&n).then_some(Part::Page(n))
            }
        }
    }

    /// The part as the host's route names it.
    fn name(self) -> String {
        match self {
            Part::Text => "text".to_string(),
            Part::Image => "image".to_string(),
            Part::Page(n) => format!("page-{n}"),
        }
    }

    /// The part's kind, for the log (never which show or page).
    fn kind(self) -> &'static str {
        match self {
            Part::Text => "text",
            Part::Image => "image",
            Part::Page(_) => "page",
        }
    }

    /// Whether the host may send this part as `mime`: text as plain text, a
    /// page as a PNG, a picture as one of the four kinds a show draws.
    fn allows(self, mime: &str) -> bool {
        match self {
            Part::Text => mime == "text/plain",
            Part::Image => matches!(
                mime,
                "image/png" | "image/jpeg" | "image/gif" | "image/webp"
            ),
            Part::Page(_) => mime == "image/png",
        }
    }
}

/// Why a part couldn't be had, for the panel: the host's status (0 when the
/// host was never asked) and its reason, e.g. `expired` or `changed`.
#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShowPartError {
    pub status: u16,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// A PDF's page count, with `no_page`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<u32>,
}

impl ShowPartError {
    fn new(status: u16, error: &str) -> Self {
        Self {
            status,
            error: error.to_string(),
            detail: None,
            pages: None,
        }
    }
}

/// `s`, cut to `MESSAGE_MAX` characters.
fn clipped(s: &str) -> String {
    s.chars().take(MESSAGE_MAX).collect()
}

/// The host's JSON failure, else its status alone.
fn host_failure(status: u16, body: &str) -> ShowPartError {
    let v = serde_json::from_str::<serde_json::Value>(body).unwrap_or_default();
    let text = |key: &str| {
        v.get(key)
            .and_then(|s| s.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(clipped)
    };
    ShowPartError {
        status,
        error: text("error").unwrap_or_else(|| format!("http_{status}")),
        detail: text("detail"),
        pages: v
            .get("pages")
            .and_then(|p| p.as_u64())
            .and_then(|p| u32::try_from(p).ok()),
    }
}

/// The part is over the cap: by what the host declared, or once read.
fn too_large() -> ShowPartError {
    ShowPartError {
        detail: Some("That's too big to show.".to_string()),
        ..ShowPartError::new(413, "too_large")
    }
}

/// One part of one of this device's shows, as raw bytes (an `ArrayBuffer` in
/// the webview). Only the types `Part::allows` are passed on.
#[tauri::command]
pub async fn kleio_show_part(
    id: String,
    part: String,
) -> Result<tauri::ipc::Response, ShowPartError> {
    if !valid_show_id(&id) {
        return Err(ShowPartError::new(0, "bad_request"));
    }
    let Some(p) = Part::parse(&part) else {
        return Err(ShowPartError::new(0, "bad_request"));
    };
    let r = super::remote().ok_or_else(|| ShowPartError::new(0, "not_connected"))?;
    let client = api_client(r).map_err(|e| ShowPartError {
        detail: Some(clipped(&e)),
        ..ShowPartError::new(0, "internal")
    })?;
    let kind = p.kind();
    let started = Instant::now();
    let fail = |e: ShowPartError| {
        let ms = started.elapsed().as_millis();
        log::warn!(
            "kleio: show part ({kind}) failed ({} {}) after {ms} ms",
            e.status,
            e.error
        );
        e
    };
    let url = format!("{}/kleio/voice/show/{id}/{}", r.base, p.name());
    let mut res = match client.get(url).timeout(PART_TIMEOUT).send().await {
        Ok(res) => res,
        Err(e) => {
            return Err(fail(ShowPartError {
                detail: Some(clipped(&root_cause(&e))),
                ..ShowPartError::new(0, "unreachable")
            }))
        }
    };
    let status = res.status().as_u16();
    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(fail(host_failure(status, &text)));
    }
    let mime = mime_of(
        res.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
    );
    if !p.allows(&mime) {
        return Err(fail(ShowPartError::new(502, "unexpected_type")));
    }
    if res.content_length().is_some_and(|n| n > MAX_PART_BYTES) {
        return Err(fail(too_large()));
    }
    let mut bytes = Vec::with_capacity(res.content_length().unwrap_or(0) as usize);
    loop {
        match res.chunk().await {
            Ok(Some(chunk)) => {
                if (bytes.len() + chunk.len()) as u64 > MAX_PART_BYTES {
                    return Err(fail(too_large()));
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => {
                return Err(fail(ShowPartError {
                    detail: Some(clipped(&root_cause(&e))),
                    ..ShowPartError::new(0, "unreachable")
                }))
            }
        }
    }
    log::info!(
        "kleio: show part ({kind}) → {status}, {} bytes in {} ms",
        bytes.len(),
        started.elapsed().as_millis()
    );
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_ids_are_sh_and_32_lowercase_hex_digits() {
        assert!(valid_show_id("sh_0123456789abcdef0123456789abcdef"));
        for bad in [
            "",
            "sh_",
            "sh_0123456789abcdef0123456789abcde",
            "sh_0123456789abcdef0123456789abcdef0",
            "sh_0123456789ABCDEF0123456789abcdef",
            "sh_0123456789abcdef0123456789abcdeg",
            "SH_0123456789abcdef0123456789abcdef",
            "s_0123456789abcdef0123456789abcdef",
            "sh-0123456789abcdef0123456789abcdef",
            "sh_0123456789abcdef/123456789abcdef",
            "sh_../../kleio/devices/abcdef012345",
            "sh_0123456789abcdef0123456789abcde\u{0}",
        ] {
            assert!(!valid_show_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn parts_are_text_image_or_a_page_from_1_to_500() {
        assert_eq!(Part::parse("text"), Some(Part::Text));
        assert_eq!(Part::parse("image"), Some(Part::Image));
        assert_eq!(Part::parse("page-1"), Some(Part::Page(1)));
        assert_eq!(Part::parse("page-42"), Some(Part::Page(42)));
        assert_eq!(Part::parse("page-500"), Some(Part::Page(500)));
        for bad in [
            "",
            "TEXT",
            "Image",
            "text/",
            "text?x=1",
            "../text",
            "images",
            "page",
            "page-",
            "page-0",
            "page-501",
            "page-999",
            "page-1000",
            "page-01",
            "page-001",
            "page-+1",
            "page--1",
            "page- 1",
            "page-1 ",
            "page-1a",
            "page-1/x",
            "page-1.0",
            "page-١",
            "Page-1",
            "pages-1",
        ] {
            assert_eq!(Part::parse(bad), None, "{bad:?}");
        }
        assert_eq!(Part::Page(12).name(), "page-12");
        assert_eq!(Part::Text.name(), "text");
    }

    #[test]
    fn each_part_comes_only_as_its_own_types() {
        let cases: &[(Part, &str, bool)] = &[
            (Part::Text, "text/plain", true),
            (Part::Text, "text/markdown", false),
            (Part::Text, "text/html", false),
            (Part::Text, "image/png", false),
            (Part::Image, "image/png", true),
            (Part::Image, "image/jpeg", true),
            (Part::Image, "image/gif", true),
            (Part::Image, "image/webp", true),
            (Part::Image, "image/svg+xml", false),
            (Part::Image, "image/heic", false),
            (Part::Image, "text/html", false),
            (Part::Image, "application/octet-stream", false),
            (Part::Page(1), "image/png", true),
            (Part::Page(1), "image/jpeg", false),
            (Part::Page(1), "application/pdf", false),
        ];
        for (part, mime, ok) in cases {
            assert_eq!(part.allows(mime), *ok, "{part:?} as {mime}");
        }
        // The header's essence, as `mime_of` reads it.
        assert!(Part::Text.allows(&mime_of(Some("text/plain; charset=utf-8"))));
        assert!(Part::Page(3).allows(&mime_of(Some("Image/PNG"))));
        assert!(!Part::Image.allows(&mime_of(None)));
    }

    #[test]
    fn host_failures_keep_the_reason_detail_and_page_count() {
        assert_eq!(
            host_failure(
                410,
                r#"{"error":"expired","detail":"That has expired. Ask Kleio to show it again."}"#
            ),
            ShowPartError {
                status: 410,
                error: "expired".into(),
                detail: Some("That has expired. Ask Kleio to show it again.".into()),
                pages: None,
            }
        );
        assert_eq!(
            host_failure(
                416,
                r#"{"error":"no_page","detail":"There's no such page.","pages":12}"#
            )
            .pages,
            Some(12)
        );
        assert_eq!(
            host_failure(502, "<html>bad gateway</html>"),
            ShowPartError::new(502, "http_502")
        );
        assert_eq!(host_failure(404, r#"{"error":"  "}"#).error, "http_404");
        assert_eq!(
            host_failure(416, r#"{"error":"no_page","pages":-1}"#).pages,
            None
        );
        let long = format!(r#"{{"error":"failed","detail":"{}"}}"#, "é".repeat(400));
        let detail = host_failure(500, &long).detail.unwrap_or_default();
        assert_eq!(detail.chars().count(), MESSAGE_MAX);
    }

    #[test]
    fn a_failure_serializes_for_the_webview() {
        let e = ShowPartError {
            detail: Some("That's too big to show.".into()),
            ..ShowPartError::new(413, "too_large")
        };
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            serde_json::json!({ "status": 413, "error": "too_large", "detail": "That's too big to show." })
        );
        assert_eq!(too_large(), e);
        assert_eq!(
            serde_json::to_value(ShowPartError::new(0, "bad_request")).unwrap(),
            serde_json::json!({ "status": 0, "error": "bad_request" })
        );
    }

    #[test]
    fn bad_ids_and_parts_are_refused_before_anything_is_asked() {
        let run = |id: &str, part: &str| {
            tauri::async_runtime::block_on(kleio_show_part(id.to_string(), part.to_string()))
        };
        let id = "sh_0123456789abcdef0123456789abcdef";
        for (bad_id, bad_part) in [
            ("sh_short", "text"),
            ("../../kleio/devices", "image"),
            (id, "page-0"),
            (id, "page-1/../../x"),
            (id, "thumbnail"),
        ] {
            match run(bad_id, bad_part) {
                Err(e) => assert_eq!(
                    e,
                    ShowPartError::new(0, "bad_request"),
                    "{bad_id} {bad_part}"
                ),
                Ok(_) => panic!("{bad_id} {bad_part} was asked for"),
            }
        }
    }
}
