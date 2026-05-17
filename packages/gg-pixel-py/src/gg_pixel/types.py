"""Wire-format types for gg-pixel events. Matches the JS/Node SDKs' shape."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

Level = Literal["error", "warning", "fatal"]


@dataclass
class StackFrame:
    file: str
    line: int
    col: int
    fn: str
    in_app: bool


@dataclass
class CodeContext:
    file: str
    error_line: int
    lines: list[str]


@dataclass
class WireEvent:
    event_id: str
    project_key: str
    fingerprint: str
    type: str
    message: str
    stack: list[StackFrame]
    code_context: Optional[CodeContext]
    runtime: str
    manual_report: bool
    level: Level
    occurred_at: str

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # asdict turns dataclasses recursively — already correct shape for JSON.
        return d


@dataclass
class ReportInput:
    message: str
    error: Optional[BaseException] = None
    level: Level = "error"
    context: dict[str, Any] = field(default_factory=dict)
