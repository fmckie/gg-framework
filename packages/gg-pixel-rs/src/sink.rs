use crate::types::WireEvent;

/// HTTP sink — POSTs JSON events to the configured ingest URL.
/// Synchronous via `ureq`. The queue runs this on a worker thread, so
/// callers don't block.
pub trait Sink: Send + Sync {
    fn emit(&self, event: &WireEvent) -> Result<(), String>;
}

pub struct HttpSink {
    pub ingest_url: String,
}

impl HttpSink {
    pub fn new(ingest_url: impl Into<String>) -> Self {
        let mut url = ingest_url.into();
        while url.ends_with('/') {
            url.pop();
        }
        Self { ingest_url: url }
    }
}

impl Sink for HttpSink {
    fn emit(&self, event: &WireEvent) -> Result<(), String> {
        let body = serde_json::to_string(event).map_err(|e| e.to_string())?;
        let res = ureq::post(&self.ingest_url)
            .set("content-type", "application/json")
            .set("x-pixel-key", &event.project_key)
            .set("user-agent", concat!("gg-pixel-rust/", env!("CARGO_PKG_VERSION")))
            .send_string(&body);
        match res {
            Ok(r) if r.status() < 400 => Ok(()),
            Ok(r) => Err(format!("ingest failed: {}", r.status())),
            Err(e) => Err(format!("network error: {}", e)),
        }
    }
}
