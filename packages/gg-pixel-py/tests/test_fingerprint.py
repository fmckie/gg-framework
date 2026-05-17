from gg_pixel.fingerprint import fingerprint
from gg_pixel.types import StackFrame


def frame(**overrides) -> StackFrame:
    base = dict(file="/repo/src/foo.py", line=10, col=0, fn="foo", in_app=True)
    base.update(overrides)
    return StackFrame(**base)


def test_stable_for_same_input():
    a = fingerprint("TypeError", [frame()])
    b = fingerprint("TypeError", [frame()])
    assert a == b


def test_returns_16_char_hex():
    assert len(fingerprint("TypeError", [frame()])) == 16
    assert all(c in "0123456789abcdef" for c in fingerprint("TypeError", [frame()]))


def test_differs_when_type_differs():
    assert fingerprint("TypeError", [frame()]) != fingerprint("ValueError", [frame()])


def test_differs_when_top_frame_line_differs():
    assert fingerprint("TypeError", [frame(line=10)]) != fingerprint("TypeError", [frame(line=11)])


def test_handles_empty_stack():
    fp = fingerprint("TypeError", [])
    assert len(fp) == 16


def test_normalizes_site_packages_paths():
    a = fingerprint("E", [frame(file="/Users/a/.venv/lib/python3.14/site-packages/lib/x.py")])
    b = fingerprint("E", [frame(file="/home/b/other/site-packages/lib/x.py")])
    assert a == b
