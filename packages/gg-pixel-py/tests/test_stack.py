import sys
from gg_pixel.stack import parse_traceback


def test_parses_a_real_traceback():
    try:
        raise TypeError("boom")
    except TypeError:
        _, _, tb = sys.exc_info()
    frames = parse_traceback(tb)
    assert len(frames) >= 1
    top = frames[0]
    assert top.fn  # at minimum, has a function name (test runner frame)


def test_marks_user_code_as_in_app():
    try:
        raise ValueError("v")
    except ValueError:
        _, _, tb = sys.exc_info()
    frames = parse_traceback(tb)
    user_frames = [f for f in frames if "tests/test_stack.py" in f.file]
    assert any(f.in_app for f in user_frames)


def test_returns_innermost_frame_first():
    def inner():
        raise RuntimeError("inner")

    def outer():
        inner()

    try:
        outer()
    except RuntimeError:
        _, _, tb = sys.exc_info()
    frames = parse_traceback(tb)
    fn_names = [f.fn for f in frames]
    # innermost (inner) should be first
    inner_idx = fn_names.index("inner")
    outer_idx = fn_names.index("outer")
    assert inner_idx < outer_idx


def test_handles_none_traceback():
    assert parse_traceback(None) == []
