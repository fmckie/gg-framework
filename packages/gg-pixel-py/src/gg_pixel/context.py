"""Capture a small window of source lines around the error site."""

from __future__ import annotations

import linecache
from typing import Optional

from .types import CodeContext, StackFrame

_WINDOW = 2


def capture_code_context(stack: list[StackFrame]) -> Optional[CodeContext]:
    top = next((f for f in stack if f.in_app), None) or (stack[0] if stack else None)
    if top is None:
        return None
    lines: list[str] = []
    start = max(1, top.line - _WINDOW)
    end = top.line + _WINDOW
    for ln in range(start, end + 1):
        line = linecache.getline(top.file, ln)
        if not line and ln == top.line:
            return None  # source unavailable — bail out entirely
        lines.append(line.rstrip("\n"))
    return CodeContext(file=top.file, error_line=top.line, lines=lines)
