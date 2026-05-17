"""gg-pixel — universal error tracking, optimized for autonomous coding agents.

Quick start:

    from gg_pixel import init_pixel, report, capture_exception

    init_pixel(project_key="pk_live_...")

    # Anything uncaught after this point is automatically reported.
    # You can also report manually:
    try:
        risky()
    except Exception as e:
        capture_exception(e)
"""

from .runtime import (
    DEFAULT_INGEST_URL,
    PixelClient,
    capture_exception,
    close_pixel,
    flush,
    init_pixel,
    report,
)
from .types import CodeContext, Level, ReportInput, StackFrame, WireEvent

__all__ = [
    "DEFAULT_INGEST_URL",
    "PixelClient",
    "init_pixel",
    "report",
    "capture_exception",
    "flush",
    "close_pixel",
    "CodeContext",
    "Level",
    "ReportInput",
    "StackFrame",
    "WireEvent",
]
