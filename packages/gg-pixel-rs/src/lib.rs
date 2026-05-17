//! gg-pixel — universal error tracking, optimized for autonomous coding agents.
//!
//! See [README.md] for usage.

mod backtrace;
mod fingerprint;
mod queue;
mod sink;
mod types;

pub use sink::{HttpSink, Sink};
pub use types::{CodeContext, Level, StackFrame, WireEvent};

use std::panic;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use chrono::Utc;
use uuid::Uuid;

use crate::backtrace::capture_stack;
use crate::fingerprint::fingerprint;
use crate::queue::BackgroundQueue;

pub const DEFAULT_INGEST_URL: &str =
    "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest";

#[derive(Clone)]
pub struct PixelOptions {
    /// Project key minted by `POST /api/projects` (or `ggcoder pixel install`).
    pub project_key: String,
    /// Override the ingest URL. Defaults to the public gg-pixel server.
    pub ingest_url: String,
    /// Override the runtime label. Default: `rust-<version>`.
    pub runtime: Option<String>,
    /// If true (default), `panic::set_hook` is installed to capture panics.
    pub capture_panics: bool,
}

impl Default for PixelOptions {
    fn default() -> Self {
        Self {
            project_key: String::new(),
            ingest_url: DEFAULT_INGEST_URL.to_string(),
            runtime: None,
            capture_panics: true,
        }
    }
}

struct Active {
    options: PixelOptions,
    queue: Arc<BackgroundQueue>,
}

static ACTIVE: OnceLock<Mutex<Option<Active>>> = OnceLock::new();

fn active_lock() -> &'static Mutex<Option<Active>> {
    ACTIVE.get_or_init(|| Mutex::new(None))
}

/// Initialize gg-pixel. Call this once at the start of your program.
///
/// Installs a panic hook by default. Returns an error if already initialized.
pub fn init_pixel(options: PixelOptions) -> Result<(), String> {
    let mut guard = active_lock().lock().unwrap();
    if guard.is_some() {
        return Err("gg-pixel is already initialized; call close_pixel() first".into());
    }
    let sink: Arc<dyn Sink> = Arc::new(HttpSink::new(&options.ingest_url));
    let queue = Arc::new(BackgroundQueue::new(sink));
    let runtime = options
        .runtime
        .clone()
        .unwrap_or_else(|| format!("rust-{}", env!("CARGO_PKG_RUST_VERSION", "unknown")));
    let active = Active {
        options: PixelOptions {
            runtime: Some(runtime),
            ..options
        },
        queue: queue.clone(),
    };
    if active.options.capture_panics {
        install_panic_hook();
    }
    *guard = Some(active);
    Ok(())
}

/// Manually report a message. Captures the current stack.
pub fn capture(message: &str) {
    let guard = active_lock().lock().unwrap();
    let active = match guard.as_ref() {
        Some(a) => a,
        None => return,
    };
    let stack = capture_stack();
    let event = WireEvent {
        event_id: Uuid::new_v4().to_string(),
        project_key: active.options.project_key.clone(),
        fingerprint: fingerprint("ManualReport", &stack),
        type_: "ManualReport".into(),
        message: message.into(),
        stack: stack.iter().map(|f| f.to_wire()).collect(),
        code_context: None,
        runtime: active.options.runtime.clone().unwrap_or_default(),
        manual_report: true,
        level: Level::Error,
        occurred_at: Utc::now().to_rfc3339(),
    };
    active.queue.enqueue(event);
}

/// Capture an arbitrary error (anything `Display`).
pub fn capture_error<E: std::fmt::Display>(err: E) {
    capture(&format!("{}", err));
}

/// Block until queued events have been sent, with a timeout.
pub fn flush(timeout: Duration) {
    let guard = active_lock().lock().unwrap();
    if let Some(active) = guard.as_ref() {
        active.queue.flush(timeout);
    }
}

/// Tear down the SDK. Drains queued events first.
pub fn close_pixel() {
    let mut guard = active_lock().lock().unwrap();
    if let Some(active) = guard.take() {
        active.queue.close();
    }
}

fn install_panic_hook() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let guard = active_lock().lock().unwrap();
        if let Some(active) = guard.as_ref() {
            let payload = info.payload();
            let message = if let Some(s) = payload.downcast_ref::<&'static str>() {
                (*s).to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "panic with non-string payload".to_string()
            };
            let stack = capture_stack();
            let location = info
                .location()
                .map(|l| format!("{}:{}", l.file(), l.line()))
                .unwrap_or_else(|| "unknown".into());
            let event = WireEvent {
                event_id: Uuid::new_v4().to_string(),
                project_key: active.options.project_key.clone(),
                fingerprint: fingerprint("Panic", &stack),
                type_: "Panic".into(),
                message: format!("panic at {}: {}", location, message),
                stack: stack.iter().map(|f| f.to_wire()).collect(),
                code_context: None,
                runtime: active.options.runtime.clone().unwrap_or_default(),
                manual_report: false,
                level: Level::Fatal,
                occurred_at: Utc::now().to_rfc3339(),
            };
            // For fatal events: send synchronously so it lands before the
            // process unwinds. We bypass the queue and call the sink directly.
            let sink = HttpSink::new(&active.options.ingest_url);
            let _ = sink.emit(&event);
        }
        // Always call the previous hook so default behavior (print, abort) runs.
        previous(info);
    }));
}
