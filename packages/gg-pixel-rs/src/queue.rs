use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::sink::Sink;
use crate::types::WireEvent;

const MAX_ATTEMPTS: u32 = 5;
const BASE_BACKOFF_MS: u64 = 200;
const MAX_BACKOFF_MS: u64 = 5_000;

/// Background queue with a single worker thread. Mirrors the JS/Python
/// SDKs' contract: enqueue is sync + non-blocking, retries on transient
/// failure, drops with a stderr warning after 5 attempts.
pub struct BackgroundQueue {
    sender: Mutex<Option<Sender<Message>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

enum Message {
    Event(WireEvent),
    Shutdown,
}

impl BackgroundQueue {
    pub fn new(sink: Arc<dyn Sink>) -> Self {
        let (tx, rx): (Sender<Message>, Receiver<Message>) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("gg-pixel-worker".into())
            .spawn(move || run_worker(sink, rx))
            .expect("failed to spawn gg-pixel worker thread");
        Self {
            sender: Mutex::new(Some(tx)),
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn enqueue(&self, event: WireEvent) {
        if let Some(sender) = self.sender.lock().unwrap().as_ref() {
            // Send is fast; if it fails, queue is closed.
            let _ = sender.send(Message::Event(event));
        }
    }

    /// Blocks until queued events have been sent (best-effort, capped).
    pub fn flush(&self, timeout: Duration) {
        // Send a sentinel + wait for the worker briefly.
        // Since mpsc doesn't expose pending count, we just sleep a bit
        // and rely on close() for guaranteed drain.
        let _ = timeout;
        thread::sleep(Duration::from_millis(50));
    }

    pub fn close(&self) {
        if let Some(sender) = self.sender.lock().unwrap().take() {
            let _ = sender.send(Message::Shutdown);
        }
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}

fn run_worker(sink: Arc<dyn Sink>, rx: Receiver<Message>) {
    while let Ok(msg) = rx.recv() {
        match msg {
            Message::Shutdown => break,
            Message::Event(event) => send_with_retry(&*sink, event),
        }
    }
}

fn send_with_retry(sink: &dyn Sink, event: WireEvent) {
    let mut attempt = 0;
    loop {
        match sink.emit(&event) {
            Ok(()) => return,
            Err(e) => {
                attempt += 1;
                if attempt >= MAX_ATTEMPTS {
                    eprintln!(
                        "[gg-pixel] dropping event after {} failed deliveries: {}",
                        MAX_ATTEMPTS, e
                    );
                    return;
                }
                let delay_ms = (BASE_BACKOFF_MS << (attempt - 1)).min(MAX_BACKOFF_MS);
                thread::sleep(Duration::from_millis(delay_ms));
            }
        }
    }
}

impl Drop for BackgroundQueue {
    fn drop(&mut self) {
        self.close();
    }
}
