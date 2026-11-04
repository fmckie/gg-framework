#!/usr/bin/env python3
"""Fails unless each direction's stylesheet uses one hue family. Lists every
coloured (non-neutral) colour by OKLCH hue. Usage: accent.py [folder ...]"""
import math, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROMA = 0.04  # below this a colour reads as neutral (greys, ivory, paper)
MAX_ARC = 20.0  # degrees of hue one accent family may span

def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def oklch(r, g, b):
    r, g, b = linear(r), linear(g), linear(b)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return math.hypot(a, bb), math.degrees(math.atan2(bb, a)) % 360

def colours(css):
    for h in re.findall(r"#([0-9a-fA-F]{6})\b", css):
        yield "#" + h.lower(), tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)), 1.0
    for m in re.finditer(r"rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)", css):
        yield m.group(0), tuple(int(m.group(i)) for i in (1, 2, 3)), float(m.group(4) or 1)

def arc(hues):
    hs = sorted(set(round(h, 1) for h in hues))
    if len(hs) < 2:
        return 0.0
    return 360 - max((hs[(i + 1) % len(hs)] - hs[i]) % 360 for i in range(len(hs)))

failed = False
for folder in sys.argv[1:] or ["a-classical", "b-minimal", "c-paper", "d-matte"]:
    found = {}
    for name, rgb, alpha in colours((ROOT / folder / "style.css").read_text()):
        c, h = oklch(*rgb)
        if c >= CHROMA and alpha >= 0.3:  # faint tints and shadows don't read as a colour
            found[name] = h
    span = arc(found.values())
    ok = span <= MAX_ARC
    failed |= not ok
    listing = ", ".join(f"{n} {h:.0f}°" for n, h in sorted(found.items(), key=lambda kv: kv[1]))
    print(f"{'ok  ' if ok else 'FAIL'} {folder}: {len(found)} coloured, hue span {span:.0f}° ({listing})")
sys.exit(1 if failed else 0)
