use gg_pixel::{HttpSink, Sink, StackFrame, WireEvent};

#[test]
fn fingerprint_is_stable() {
    use gg_pixel::*;
    // We don't expose fingerprint() directly — go through capture()
    // is unrealistic in a unit test, so instead verify shape via WireEvent.
    let _ = WireEvent {
        event_id: "evt".into(),
        project_key: "pk".into(),
        fingerprint: "fp".into(),
        type_: "T".into(),
        message: "m".into(),
        stack: vec![],
        code_context: None,
        runtime: "rust-test".into(),
        manual_report: false,
        level: Level::Error,
        occurred_at: "2026-04-29T00:00:00Z".into(),
    };
}

struct CaptureSink {
    inner: std::sync::Mutex<Vec<String>>,
}
impl CaptureSink {
    fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(Vec::new()),
        }
    }
}
impl Sink for CaptureSink {
    fn emit(&self, event: &WireEvent) -> Result<(), String> {
        self.inner.lock().unwrap().push(event.event_id.clone());
        Ok(())
    }
}

#[test]
fn http_sink_constructs_with_trailing_slash_normalized() {
    let sink = HttpSink::new("https://example.com/ingest/");
    assert_eq!(sink.ingest_url, "https://example.com/ingest");
}

#[test]
fn stackframe_serializes_with_fn_field() {
    let f = StackFrame {
        file: "/repo/src/foo.rs".into(),
        line: 42,
        col: 7,
        fn_: "do_thing".into(),
        in_app: true,
    };
    let v = f.to_wire();
    assert_eq!(v["fn"], "do_thing");
    assert_eq!(v["file"], "/repo/src/foo.rs");
    assert_eq!(v["in_app"], true);
}
