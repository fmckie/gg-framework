"""HTTP sink — POSTs JSON events to the configured ingest URL."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Protocol

from .types import WireEvent


class Sink(Protocol):
    def emit(self, event: WireEvent) -> None: ...


class HttpSink:
    """Synchronous HTTP sink using stdlib `urllib`. Zero deps.

    Sync is intentional for the Python SDK — the BackgroundQueue runs this
    on a worker thread, so the main thread never blocks. If callers want
    truly async, they can wrap us in their own task system.
    """

    USER_AGENT = "gg-pixel-python/4.3.68"

    def __init__(self, ingest_url: str, *, timeout_s: float = 5.0) -> None:
        self.ingest_url = ingest_url.rstrip("/")
        self.timeout_s = timeout_s

    def emit(self, event: WireEvent) -> None:
        body = json.dumps(event.to_dict()).encode("utf-8")
        # Many CDNs (Cloudflare included) block the default Python-urllib UA
        # as suspected bot traffic — supply a real one so requests aren't
        # silently 403'd.
        req = urllib.request.Request(
            self.ingest_url,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "x-pixel-key": event.project_key,
                "user-agent": self.USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as res:
                status = res.status
                if status >= 400:
                    raise RuntimeError(f"pixel ingest failed: {status}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"pixel ingest network error: {e}") from e
