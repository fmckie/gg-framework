"""Integration tests with a stub sink — verify the full enqueue → emit path."""

from __future__ import annotations

import time

from gg_pixel.queue import BackgroundQueue
from gg_pixel.types import WireEvent


class CollectingSink:
    def __init__(self, fail_first_n: int = 0) -> None:
        self.events: list[WireEvent] = []
        self.fail_first_n = fail_first_n
        self.attempts = 0

    def emit(self, event: WireEvent) -> None:
        self.attempts += 1
        if self.attempts <= self.fail_first_n:
            raise RuntimeError("simulated failure")
        self.events.append(event)


def make_event(fp: str = "fp1") -> WireEvent:
    return WireEvent(
        event_id=f"evt_{fp}",
        project_key="pk_test",
        fingerprint=fp,
        type="TypeError",
        message="boom",
        stack=[],
        code_context=None,
        runtime="python-test",
        manual_report=False,
        level="error",
        occurred_at="2026-04-29T00:00:00Z",
    )


def wait_for(predicate, timeout_s=2.0):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_enqueue_drains_through_sink():
    sink = CollectingSink()
    q = BackgroundQueue(sink)
    try:
        q.enqueue(make_event("a"))
        q.enqueue(make_event("b"))
        assert wait_for(lambda: len(sink.events) == 2)
        assert {e.fingerprint for e in sink.events} == {"a", "b"}
    finally:
        q.close(timeout_s=1.0)


def test_retries_on_transient_failure():
    sink = CollectingSink(fail_first_n=2)
    q = BackgroundQueue(sink)
    try:
        q.enqueue(make_event("retry-test"))
        assert wait_for(lambda: len(sink.events) == 1, timeout_s=5.0)
        assert sink.attempts >= 3  # 2 failures + 1 success
    finally:
        q.close(timeout_s=1.0)


def test_drops_after_5_failed_attempts():
    sink = CollectingSink(fail_first_n=999)  # always fails
    q = BackgroundQueue(sink)
    try:
        q.enqueue(make_event("doomed"))
        # Sum of backoffs: 0.2 + 0.4 + 0.8 + 1.6 = 3s before drop
        assert wait_for(lambda: sink.attempts >= 5, timeout_s=10.0)
        assert len(sink.events) == 0
    finally:
        q.close(timeout_s=1.0)


def test_emit_sync_bypasses_queue():
    sink = CollectingSink()
    q = BackgroundQueue(sink)
    try:
        q.emit_sync(make_event("urgent"))
        # No wait — emit_sync is synchronous.
        assert len(sink.events) == 1
        assert sink.events[0].fingerprint == "urgent"
    finally:
        q.close(timeout_s=1.0)
