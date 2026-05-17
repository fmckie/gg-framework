"""Wire global Python error handlers to the gg-pixel queue."""

from __future__ import annotations

import asyncio
import atexit
import logging
import platform
import sys
import threading
import uuid
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Optional, Union

from .context import capture_code_context
from .fingerprint import fingerprint
from .queue import BackgroundQueue
from .sink import HttpSink, Sink
from .stack import parse_traceback
from .types import Level, ReportInput, WireEvent

DEFAULT_INGEST_URL = "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest"


class PixelClient:
    def __init__(
        self,
        *,
        project_key: str,
        sink: Sink,
        runtime: str,
        capture_uncaught: bool,
        capture_unhandled_rejections: bool,
        capture_logging_errors: bool,
    ) -> None:
        self.project_key = project_key
        self.runtime = runtime
        self.queue = BackgroundQueue(sink)
        self._detach: list[Any] = []

        if capture_uncaught:
            self._install_excepthook()
            self._install_thread_excepthook()
        if capture_unhandled_rejections:
            self._install_asyncio_handler()
        if capture_logging_errors:
            self._install_logging_handler()

        atexit.register(self._on_exit)

    def report(self, msg: Union[str, ReportInput]) -> None:
        if isinstance(msg, str):
            inp = ReportInput(message=msg)
        else:
            inp = msg
        if inp.error is not None:
            event = self._build_event(inp.error, inp.level, manual=True)
            event.message = inp.message or event.message
            self.queue.enqueue(event)
        else:
            err = RuntimeError(inp.message)
            err.__class__.__name__  # noqa: B018 — keep ManualReport as the type below
            event = self._build_event(err, inp.level, manual=True, type_override="ManualReport")
            self.queue.enqueue(event)

    def capture_exception(self, exc: BaseException, *, level: Level = "error") -> None:
        event = self._build_event(exc, level, manual=True)
        self.queue.enqueue(event)

    def flush(self, timeout_s: float = 5.0) -> None:
        self.queue.flush(timeout_s=timeout_s)

    def close(self, timeout_s: float = 5.0) -> None:
        self.queue.close(timeout_s=timeout_s)

    # ── handler installation ────────────────────────────────

    def _install_excepthook(self) -> None:
        previous = sys.excepthook

        def handler(
            exc_type: type[BaseException],
            exc: BaseException,
            tb: Optional[TracebackType],
        ) -> None:
            try:
                event = self._build_event(exc, level="fatal", manual=False, tb=tb, exc_type=exc_type)
                # Sync emit — process is about to exit, no time for the worker.
                self.queue.emit_sync(event)
            finally:
                previous(exc_type, exc, tb)

        sys.excepthook = handler

    def _install_thread_excepthook(self) -> None:
        if not hasattr(threading, "excepthook"):
            return  # Python 3.7 (we require 3.8+, but defensive)
        previous = threading.excepthook

        def handler(args: Any) -> None:
            try:
                exc = args.exc_value
                if exc is not None:
                    event = self._build_event(
                        exc,
                        level="error",
                        manual=False,
                        tb=args.exc_traceback,
                        exc_type=args.exc_type,
                    )
                    self.queue.enqueue(event)
            finally:
                previous(args)

        threading.excepthook = handler  # type: ignore[assignment]

    def _install_asyncio_handler(self) -> None:
        try:
            loop = asyncio.get_event_loop_policy().get_event_loop()
        except RuntimeError:
            return  # No loop yet — user can call init_pixel later inside the loop.

        previous = loop.get_exception_handler()

        def handler(_loop: asyncio.AbstractEventLoop, ctx: dict[str, Any]) -> None:
            try:
                exc = ctx.get("exception")
                if isinstance(exc, BaseException):
                    event = self._build_event(exc, level="error", manual=False)
                    self.queue.enqueue(event)
            finally:
                if previous is not None:
                    previous(_loop, ctx)
                else:
                    _loop.default_exception_handler(ctx)

        loop.set_exception_handler(handler)

    def _install_logging_handler(self) -> None:
        client_self = self

        class PixelLoggingHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                if record.levelno < logging.ERROR:
                    return
                exc_info = record.exc_info
                if exc_info and isinstance(exc_info[1], BaseException):
                    event = client_self._build_event(
                        exc_info[1],
                        level="error" if record.levelno == logging.ERROR else "fatal",
                        manual=False,
                        tb=exc_info[2],
                        exc_type=exc_info[0],
                    )
                else:
                    err = RuntimeError(record.getMessage())
                    event = client_self._build_event(
                        err,
                        level="error" if record.levelno == logging.ERROR else "fatal",
                        manual=False,
                        type_override=record.name or "LogError",
                    )
                client_self.queue.enqueue(event)

        h = PixelLoggingHandler(level=logging.ERROR)
        logging.getLogger().addHandler(h)

    # ── event construction ──────────────────────────────────

    def _build_event(
        self,
        exc: BaseException,
        level: Level,
        *,
        manual: bool,
        tb: Optional[TracebackType] = None,
        exc_type: Optional[type[BaseException]] = None,
        type_override: Optional[str] = None,
    ) -> WireEvent:
        type_name = type_override or (exc_type.__name__ if exc_type else type(exc).__name__)
        message = str(exc) or type_name
        traceback_obj = tb if tb is not None else exc.__traceback__
        stack = parse_traceback(traceback_obj)
        ctx = capture_code_context(stack)
        return WireEvent(
            event_id=str(uuid.uuid4()),
            project_key=self.project_key,
            fingerprint=fingerprint(type_name, stack),
            type=type_name,
            message=message,
            stack=stack,
            code_context=ctx,
            runtime=self.runtime,
            manual_report=manual,
            level=level,
            occurred_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        )

    def _on_exit(self) -> None:
        self.queue.flush(timeout_s=2.0)


_active: Optional[PixelClient] = None


def init_pixel(
    *,
    project_key: str,
    ingest_url: str = DEFAULT_INGEST_URL,
    runtime: Optional[str] = None,
    capture_uncaught: bool = True,
    capture_unhandled_rejections: bool = True,
    capture_logging_errors: bool = False,
) -> PixelClient:
    global _active
    if _active is not None:
        raise RuntimeError("gg-pixel is already initialized; call close_pixel() first")
    sink = HttpSink(ingest_url)
    _active = PixelClient(
        project_key=project_key,
        sink=sink,
        runtime=runtime or _default_runtime(),
        capture_uncaught=capture_uncaught,
        capture_unhandled_rejections=capture_unhandled_rejections,
        capture_logging_errors=capture_logging_errors,
    )
    return _active


def report(message: str, *, error: Optional[BaseException] = None, level: Level = "error") -> None:
    if _active is None:
        return
    _active.report(ReportInput(message=message, error=error, level=level))


def capture_exception(exc: BaseException, *, level: Level = "error") -> None:
    if _active is None:
        return
    _active.capture_exception(exc, level=level)


def flush(timeout_s: float = 5.0) -> None:
    if _active is None:
        return
    _active.flush(timeout_s=timeout_s)


def close_pixel(timeout_s: float = 5.0) -> None:
    global _active
    if _active is None:
        return
    _active.close(timeout_s=timeout_s)
    _active = None


def _default_runtime() -> str:
    return f"python-{platform.python_version()}"
