"""Stable fingerprint of an exception for grouping recurrences.

Same algorithm as the Node SDK: sha256 of `type | normalized_top_frame |
fn | line`, truncated to 16 hex chars.
"""

from __future__ import annotations

import hashlib
import re

from .types import StackFrame

_NODE_MODULES_RE = re.compile(r"^.*/site-packages/")


def fingerprint(exc_type: str, stack: list[StackFrame]) -> str:
    if stack:
        top = stack[0]
        normalized = f"{exc_type}|{_normalize_file(top.file)}|{top.fn or '<anon>'}|{top.line}"
    else:
        normalized = f"{exc_type}|<no-stack>"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _normalize_file(file: str) -> str:
    """Strip path prefixes that vary between machines so the same library
    error fingerprints identically everywhere."""
    file = file.split("?", 1)[0]
    file = _NODE_MODULES_RE.sub("site-packages/", file)
    return file
