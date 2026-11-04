#!/usr/bin/env python3
"""Re-renders Kleio's Home backdrop (gg-app/src/Dither.tsx: React Bits' dithered waves, Kleio's
colours from kleio/kleioWaves.ts) without any UI on it, at the moment the reference screenshot
mockups/home-buttons/instrument-default.png was taken. The crimson wash is CSS, as in the app.

  dither.py search            find the shader time (and pointer) that reproduces the screenshot
  dither.py render T [MX MY]  write assets/home-dither.png (1024x720, the canvas at dpr 1)
"""
import sys
import pathlib
import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
SHOT = HERE.parent / "instrument-default.png"
OUT = HERE.parent / "assets" / "home-dither.png"
W, H, CELL = 1024, 720, 2  # canvas px at dpr 1; pixelSize 2
WAVE, BG = (0.22, 0.03, 0.05), (0.047, 0.035, 0.039)
SPEED, FREQ, AMP, MOUSE_R = 0.05, 3.0, 0.3, 0.3
BAYER = np.array([
    0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31,
    8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
    2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29,
    10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21], float).reshape(8, 8) / 64.0


def mod289(x):
    return x - np.floor(x * (1.0 / 289.0)) * 289.0


def permute(x):
    return mod289(((x * 34.0) + 1.0) * x)


def cnoise(px, py):
    fx0, fy0 = np.floor(px), np.floor(py)
    ix = mod289(np.stack([fx0, fx0 + 1, fx0, fx0 + 1]))
    iy = mod289(np.stack([fy0, fy0, fy0 + 1, fy0 + 1]))
    rx, ry = px - fx0, py - fy0
    fx = np.stack([rx, rx - 1, rx, rx - 1])
    fy = np.stack([ry, ry, ry - 1, ry - 1])
    i = permute(permute(ix) + iy)
    gx = (i / 41.0 - np.floor(i / 41.0)) * 2.0 - 1.0
    gy = np.abs(gx) - 0.5
    gx = gx - np.floor(gx + 0.5)
    norm = 1.79284291400159 - 0.85373472095314 * (gx * gx + gy * gy)
    n = (gx * norm) * fx + (gy * norm) * fy  # n00, n10, n01, n11
    ux = rx * rx * rx * (rx * (rx * 6 - 15) + 10)
    uy = ry * ry * ry * (ry * (ry * 6 - 15) + 10)
    nx0 = n[0] + (n[1] - n[0]) * ux
    nx1 = n[2] + (n[3] - n[2]) * ux
    return 2.3 * (nx0 + (nx1 - nx0) * uy)


def fbm(px, py):
    value, amp = 0.0, 1.0
    for _ in range(4):
        value = value + amp * np.abs(cnoise(px, py))
        px, py, amp = px * FREQ, py * FREQ, amp * AMP
    return value


def cells(tiles=1):
    """Cell grid (top-down rows) and each cell's sample point in shader uv. tiles>1 keeps every
    tiles-th 8x8 Bayer tile, so a sparse grid still holds every threshold."""
    k = np.arange(W // CELL)
    r = np.arange(H // CELL)
    k, r = k[(k // 8) % tiles == 0], r[(r // 8) % tiles == 0]
    kk, rr = np.meshgrid(k, r)
    m = (H // CELL - 1) - rr  # GL rows count from the bottom
    # The dither pass samples the waves at the cell's lower-left corner.
    ux = (kk * CELL / W - 0.5) * (W / H)
    uy = m * CELL / H - 0.5
    threshold = BAYER[m % 8, kk % 8]
    return kk, rr, ux, uy, threshold


def lit(t, grid, mouse=None):
    kk, rr, ux, uy, threshold = grid
    s = t * SPEED
    inner = fbm(ux - s, uy - s)
    f = fbm(ux + inner, uy + inner)
    if mouse is not None:  # pointer in canvas px, top-down (as the app sets it)
        mx = (mouse[0] / W - 0.5) * (W / H)
        my = -(mouse[1] / H - 0.5)
        d = np.hypot(ux - mx, uy - my)
        e = np.clip(d / MOUSE_R, 0, 1)
        f = f - 0.5 * (1 - e * e * (3 - 2 * e))
    red = BG[0] + (WAVE[0] - BG[0]) * np.clip(f, 0, 1)
    c = np.clip(red + (threshold - 0.25) / 3.0 - 0.2, 0, 1)  # bias is 0.2: luminance stays < 0.45
    return np.floor(c * 3 + 0.5) >= 1


# The old Home's UI in the screenshot (canvas px, x0 y0 x1 y1), padded for text shadows.
UI = [(400, 140, 624, 190), (440, 196, 584, 322), (360, 330, 664, 398), (320, 410, 704, 446),
      (262, 456, 762, 520), (418, 528, 606, 580), (958, 6, 1018, 56), (8, 676, 72, 708)]


def observed(grid):
    kk, rr = grid[0], grid[1]
    im = np.asarray(Image.open(SHOT).convert("RGB")).astype(int)
    c = im[rr * 4 + 2, kk * 4 + 2]
    obs = (c[..., 0] > 110) & (c[..., 1] < 60)
    keep = np.ones(obs.shape, bool)
    for x0, y0, x1, y1 in UI:
        keep &= ~((kk * CELL >= x0) & (kk * CELL <= x1) & (rr * CELL >= y0) & (rr * CELL <= y1))
    return obs, keep


def iou(pred, obs, keep):
    a, b = pred & keep, obs & keep
    return (a & b).sum() / max(1, (a | b).sum())


def search():
    g4 = cells(4)
    obs4, keep4 = observed(g4)
    print("observed lit share", round(obs4[keep4].mean(), 3))
    best = sorted(((iou(lit(t, g4), obs4, keep4), t) for t in np.arange(0, 1800, 0.5)), reverse=True)
    print("coarse top:", [(round(float(s), 3), float(t)) for s, t in best[:5]])
    g1 = cells(1)
    obs, keep = observed(g1)
    t0 = best[0][1]
    fine = max((iou(lit(t, g1), obs, keep), t) for t in np.arange(t0 - 0.5, t0 + 0.5, 0.02))
    print("fine:", round(float(fine[0]), 4), round(float(fine[1]), 3))
    for mouse in [None, (0, 0)]:
        print("mouse", mouse, round(float(iou(lit(fine[1], g1, mouse), obs, keep)), 4))


def render(t, mouse=None):
    on = lit(t, cells(1), mouse)
    img = np.zeros((H, W, 3), np.uint8)
    img[np.repeat(np.repeat(on, CELL, 0), CELL, 1)] = (156, 0, 0)  # sRGB of the 1/3 level
    Image.fromarray(img).save(OUT, optimize=True)
    print(f"wrote {OUT.name}: t={t}, mouse={mouse}, {on.mean():.3f} of cells lit")


if __name__ == "__main__":
    if sys.argv[1] == "search":
        search()
    else:
        t = float(sys.argv[2])
        render(t, (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else None)
