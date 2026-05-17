"""Convert a Python traceback into the universal StackFrame shape."""

from __future__ import annotations

import os
import sys
import sysconfig
from types import TracebackType
from typing import Optional

from .types import StackFrame


_STDLIB_PATHS = tuple(
    p
    for p in (
        sysconfig.get_paths().get("stdlib"),
        sysconfig.get_paths().get("platstdlib"),
    )
    if p
)


def parse_traceback(tb: Optional[TracebackType]) -> list[StackFrame]:
    frames: list[StackFrame] = []
    cur = tb
    while cur is not None:
        co = cur.tb_frame.f_code
        filename = co.co_filename
        frames.append(
            StackFrame(
                file=filename,
                line=cur.tb_lineno,
                col=0,  # Python tracebacks don't carry column by default
                fn=co.co_name or "<anon>",
                in_app=_is_in_app(filename),
            )
        )
        cur = cur.tb_next
    # Tracebacks are oldest→newest. We want newest (innermost) first to
    # match the JS convention used by other SDKs.
    return list(reversed(frames))


def _is_in_app(file: str) -> bool:
    if not file:
        return False
    if file.startswith("<"):  # <string>, <stdin>, <frozen importlib._bootstrap>
        return False
    abs_file = os.path.abspath(file)
    if "site-packages" in abs_file or "dist-packages" in abs_file:
        return False
    for stdlib_path in _STDLIB_PATHS:
        if abs_file.startswith(stdlib_path):
            return False
    if abs_file.startswith(sys.prefix) and "site-packages" not in abs_file:
        # Frozen stdlib modules (e.g. /opt/homebrew/.../python3.14/...).
        # Conservative: still mark them out-of-app.
        if any(seg in abs_file for seg in ("/python3.", "/lib/python")):
            return False
    return True
