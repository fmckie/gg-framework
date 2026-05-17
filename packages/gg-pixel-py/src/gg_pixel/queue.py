"""Background queue — drain HTTP sink off the main thread."""

from __future__ import annotations

import queue
import sys
import threading
import time
from typing import Optional

from .sink import Sink
from .types import WireEvent


_MAX_BUFFER = 100
_BASE_DELAY_S = 0.2
_MAX_DELAY_S = 5.0
_MAX_ATTEMPTS = 5


class BackgroundQueue:
    """Bounded queue with a single drain worker thread.

    Mirrors the JS EventQueue contract: enqueue is sync + non-blocking,
    drain happens on a worker, retries with exponential backoff up to 5
    times, drops on permanent failure with a console warning.
    """

    def __init__(self, sink: Sink) -> None:
        self._sink = sink
        self._buffer: queue.Queue[WireEvent] = queue.Queue(maxsize=_MAX_BUFFER)
        self._closed = threading.Event()
        self._worker: Optional[threading.Thread] = None
        self._start_worker()

    def _start_worker(self) -> None:
        self._worker = threading.Thread(target=self._run, daemon=True, name="gg-pixel-worker")
        self._worker.start()

    def _run(self) -> None:
        while not self._closed.is_set():
            try:
                event = self._buffer.get(timeout=0.5)
            except queue.Empty:
                continue
            self._send_with_retry(event)
            self._buffer.task_done()

    def _send_with_retry(self, event: WireEvent) -> None:
        attempt = 0
        while attempt < _MAX_ATTEMPTS:
            try:
                self._sink.emit(event)
                return
            except Exception as e:  # noqa: BLE001 — best-effort SDK
                attempt += 1
                if attempt >= _MAX_ATTEMPTS:
                    print(
                        f"[gg-pixel] dropping event after {_MAX_ATTEMPTS} failed deliveries: {e}",
                        file=sys.stderr,
                    )
                    return
                delay = min(_BASE_DELAY_S * (2 ** (attempt - 1)), _MAX_DELAY_S)
                time.sleep(delay)

    def enqueue(self, event: WireEvent) -> None:
        if self._closed.is_set():
            return
        try:
            self._buffer.put_nowait(event)
        except queue.Full:
            # Drop the OLDEST event (FIFO replacement) — same policy as JS SDK.
            try:
                self._buffer.get_nowait()
                self._buffer.task_done()
            except queue.Empty:
                pass
            try:
                self._buffer.put_nowait(event)
            except queue.Full:
                pass

    def emit_sync(self, event: WireEvent) -> None:
        """Synchronous emit for fatal events — bypass the queue. Used by
        the sys.excepthook handler so the fatal event lands before the
        process dies."""
        try:
            self._sink.emit(event)
        except Exception as e:  # noqa: BLE001 — best-effort
            print(f"[gg-pixel] sync emit failed: {e}", file=sys.stderr)

    def flush(self, timeout_s: float = 5.0) -> None:
        """Block until the buffer is empty, with a timeout."""
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self._buffer.empty():
                return
            time.sleep(0.05)

    def close(self, timeout_s: float = 5.0) -> None:
        self.flush(timeout_s=timeout_s)
        self._closed.set()
        if self._worker is not None:
            self._worker.join(timeout=1.0)
