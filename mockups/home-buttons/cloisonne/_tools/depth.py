#!/usr/bin/env python3
"""Writes mockups/home-buttons/cloisonne/depth.html: Cloisonné's Reverse variant (tile 12 of
index.html) with one depth treatment per tile, flat Reverse pinned beside them. Its sources are
read unchanged: page.css, tiles.css, the button skeleton, the Cloisonné base and the Reverse block.

Every press is generated from one rule: the face goes down by d and every shadow under it comes up
by d, so the wall's foot and the shadows hold still on the ground while the face sinks. Fails if any
label falls under 4.5:1, the domed enamel's crown included."""
import html
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build as variations  # noqa: E402  (its helpers and paths; importing it builds nothing)

OUT = variations.ROOT / "depth.html"

# Side walls (band under the face, band at the foot): red under red enamel, black under black.
WALLS = {"pri": ("#6a1220", "#3a0911"), "sec": ("#1a1516", "#080606")}
# Domed enamel: the crown's highlight is an ellipse rx% by ry% of the enamel, centred cy% down.
CROWN = {"rx": 64, "ry": 30, "cy": 4}
DOMES = {  # feature class: alphas of (crown highlight, shade at the foot, shade at the ends)
    "f-dome": (0.16, 0.26, 0.14),
    "f-dome-soft": (0.11, 0.18, 0.10),
}
# Each button kind's enamel at rest, hover and press, and the labels on it.
ENAMELS = {"pri": ["#b31d30", "#c42638", "#9a1728"], "sec": ["#151112", "#201a1b", "#0d0a0b"]}
LABELS = {"pri": ["#f6f1f1"], "sec": ["#f6f1f1", "#d3c9ca", "#a69c9d"]}
# Highest glyph top, px down the enamel: 40px tall on the big buttons, 29px on the small one.
GLYPH_TOP = [(40, 13.5), (29, 9.0)]


def mix(a: str, b: str, t: float) -> str:
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(pa, pb))


def wall(kind: str, height: int) -> list:
    top, foot = WALLS[kind]
    return [(k, 0, 0, mix(top, foot, (k - 1) / max(1, height - 1))) for k in range(1, height + 1)]


# Recipes: (size, kind) -> (press depth d, shadows as (y, blur, spread, colour)), top layer first.
def plinth(height_large: int, d_large: float, height_small: int, d_small: float):
    def recipe(size: str, kind: str):
        if size == "large":
            h = height_large
            return d_large, wall(kind, h) + [(h + 1, 3, 0, "rgb(0 0 0 / 0.5)"), (h + 9, 18, -10, "rgb(0 0 0 / 0.9)")]
        h = height_small
        return d_small, wall(kind, h) + [(h + 1, 2, 0, "rgb(0 0 0 / 0.5)"), (h + 6, 12, -7, "rgb(0 0 0 / 0.9)")]
    return recipe


def standing(size: str, kind: str):
    """On the surface: a contact line as deep as the press, over the base's soft shadow."""
    if size == "large":
        return 2, [(2, 0, 0, "rgb(0 0 0 / 0.6)"), (9, 16, -8, "rgb(0 0 0 / 0.95)")]
    return 1.5, [(1.5, 0, 0, "rgb(0 0 0 / 0.6)"), (6.5, 10, -6, "rgb(0 0 0 / 0.95)")]


def floating(size: str, kind: str):
    if size == "large":
        return 3, [(4, 3, -1, "rgb(0 0 0 / 0.8)"), (22, 28, -12, "rgb(0 0 0 / 0.95)")]
    return 2, [(3, 2, -1, "rgb(0 0 0 / 0.8)"), (15, 20, -9, "rgb(0 0 0 / 0.95)")]


def bedded(size: str, kind: str):
    if size == "large":
        return 2, [(2, 0, 0, "rgb(0 0 0 / 0.65)"), (5, 7, -3, "rgb(0 0 0 / 0.85)")]
    return 1.5, [(1.5, 0, 0, "rgb(0 0 0 / 0.65)"), (4, 5, -2, "rgb(0 0 0 / 0.85)")]


FLAT = ("flat", "Flat", "Reverse as built: polished rim, flat enamel, the shine sweeps left to right.")
GROUPS = [
    ("single", "One treatment", [
        ("plinth", "Plinth", "A 4px wall under the face, red or black to match; press drops the face onto it.", "", plinth(4, 3, 3, 2)),
        ("chamfer", "Chamfer", "A 2px bevel cut round the rim’s outer edge, lit top-left, shaded bottom-right.", "f-chamfer", standing),
        ("dome", "Domed enamel", "The enamel rises in the middle, lit at the crown; the rim stays flat.", "f-dome", standing),
        ("cast", "Cast shadow", "The button floats on a tight contact shadow and a long soft one.", "", floating),
        ("bed", "Recessed bed", "Each button sits raised in a pocket cut into the surface.", "f-bed", bedded),
    ]),
    ("combined", "Combined", [
        ("plinth-dome", "Plinth + dome", "A 3px wall and a softer dome, both held back.", "f-dome-soft", plinth(3, 2, 2, 1)),
        ("chamfer-bed", "Chamfer + bed", "The chamfered button, set in its pocket.", "f-chamfer f-bed", bedded),
    ]),
]
TARGETS = [(".k-pri", "large", "pri"), (".k-sec", "large", "sec"), (".k-sec.k-small", "small", "sec")]


def px(v: float) -> str:
    return "0" if v == 0 else f"{v:g}px"


def shadows(layers: list, lift: float = 0) -> str:
    # A hard wall band that would rise past the face's bottom edge just tucks in under it.
    return ",\n    ".join(
        f"0 {px(max(0, y - lift))} {px(blur)} {px(spread)} {colour}" for y, blur, spread, colour in layers
    )


def depth_css(key: str, recipe) -> str:
    rest, pressed = [], []
    for sel, size, kind in TARGETS:
        d, layers = recipe(size, kind)
        assert all(y >= d for y, blur, _, _ in layers if blur), f"{key}: a soft shadow would pass under the face"
        rest.append(f".c-cloisonne.d-{key} {sel} {{\n  box-shadow:\n    {shadows(layers)};\n}}")
        pressed.append(
            f".c-cloisonne.d-{key} {sel}:is(:active, .is-pressed):not(:disabled) {{\n"
            f"  transform: translateY({d:g}px);\n  box-shadow:\n    {shadows(layers, d)};\n}}"
        )
    return "\n".join(rest + pressed)


def dome_css(cls: str, crown: float, foot: float, ends: float) -> str:
    c = CROWN
    return (
        f".c-cloisonne.{cls} .k-btn::before {{\n  background-image:\n"
        f"    radial-gradient({c['rx']}% {c['ry']}% at 50% {c['cy']}%, rgb(255 240 242 / {crown}), rgb(255 240 242 / 0)),\n"
        f"    radial-gradient(60% 150% at 50% 30%, rgb(0 0 0 / 0) 55%, rgb(0 0 0 / {ends})),\n"
        f"    linear-gradient(180deg, rgb(0 0 0 / 0) 46%, rgb(0 0 0 / {foot}));\n}}"
    )


def crown_alpha(peak: float, height: float, y: float) -> float:
    cy, ry = CROWN["cy"] / 100 * height, CROWN["ry"] / 100 * height
    return peak * max(0.0, 1 - abs(y - cy) / ry)


def worst_contrast():
    """Lowest label contrast anywhere: flat enamel, and under each dome's crown at the glyph tops
    (the shading only darkens, which lifts these light labels)."""
    cases = []
    for cls, (crown, _, _) in [("flat enamel", (0.0, 0, 0)), *DOMES.items()]:
        for height, top in GLYPH_TOP:
            a = crown_alpha(crown, height, top)
            for kind, fills in ENAMELS.items():
                for fill in fills:
                    bg = variations.over("#fff0f2", a, fill)
                    for label in LABELS[kind]:
                        cases.append((variations.ratio(label, bg), f"{label} on {fill}, {cls}"))
    return min(cases)


def button_set() -> str:
    i = variations.icon
    return f"""      <div class="stage">
        <div class="set">
          <span class="slot"><button type="button" class="k-btn k-pri home-action">{i("Sparkle")}Kleio</button></span>
          <span class="slot"><button type="button" class="k-btn k-sec home-action">{i("Code")}Code</button></span>
          <span class="slot"><button type="button" class="k-btn k-sec home-action" aria-keyshortcuts="Meta+Shift+L">{i("CirclesThree")}Specialists<kbd class="k-kbd" aria-hidden="true">⌘⇧L</kbd></button></span>
          <span class="slot slot-small"><button type="button" class="k-btn k-sec k-small k-quiet" aria-keyshortcuts="Meta+Shift+B">{i("Waveform")}Talk to Kleio<kbd class="k-kbd" aria-hidden="true">⌘⇧B</kbd></button></span>
        </div>
      </div>"""


def tile(num: int, key: str, name: str, what: str, classes: str) -> str:
    cls = " ".join(["tile c-cloisonne v-reverse", classes]).strip()
    return f"""    <article class="{cls}" id="{key}" aria-labelledby="{key}-name">
      <header class="cap">
        <span class="num">{num:02d}</span>
        <h3 id="{key}-name">{html.escape(name)}</h3>
        <p class="what">{html.escape(what)}</p>
      </header>
{button_set()}
    </article>"""


def main() -> None:
    worst = worst_contrast()
    assert worst[0] >= 4.5, f"contrast {worst[0]:.2f}:1 for {worst[1]}"

    numbered, n = [], 1
    for gkey, gname, items in GROUPS:
        numbered.append((gkey, gname, [(n + i, *item) for i, item in enumerate(items)]))
        n += len(items)

    generated = [f"/* {num:02d} {name} */\n" + depth_css(key, recipe)
                 for _, _, items in numbered for num, key, name, _, _, recipe in items]
    generated += [dome_css(cls, *alphas) for cls, alphas in DOMES.items()]
    current = "\n".join(
        f'body:has(#{k}:target) .rail a[href="#{k}"] {{ color: var(--white); background: rgb(246 241 241 / 0.06); }}'
        for _, _, items in numbered for _, k, *_ in items
    )
    css = "\n".join([
        (variations.HOME / "_tools" / "page.css").read_text(),
        (HERE / "tiles.css").read_text(),
        variations.between((variations.HOME / "_tools" / "home.css").read_text(), "/* ── The button skeleton"),
        f"/* ═══ {variations.CONCEPTS_CSS.relative_to(variations.HOME.parent)}: the Cloisonné base, unchanged ═══ */",
        variations.between(variations.CONCEPTS_CSS.read_text(), "/* ── 07 Cloisonné", "/* ── 08 Obsidian"),
        "/* ═══ cloisonne/_tools/variants.css: Reverse, unchanged ═══ */",
        variations.between((HERE / "variants.css").read_text(), "/* 12 Reverse:", "/* 13 Sink:"),
        (HERE / "depth.css").read_text(),
        "/* ═══ Generated by depth.py: every press (face down by d, shadows up by d) and the domes ═══ */",
        "\n\n".join(generated),
        current,
    ])
    sections = []
    for gkey, gname, items in numbered:
        tiles = "\n".join(tile(num, key, name, what, f"depth d-{key} {features}".strip())
                          for num, key, name, what, features, _ in items)
        sections.append(
            f'  <section class="group" id="{gkey}" aria-labelledby="{gkey}-h">\n'
            f'    <h2 class="group-h" id="{gkey}-h">{gname}<span class="range">{items[0][0]:02d}–{items[-1][0]:02d}</span></h2>\n'
            f"{tiles}\n  </section>"
        )
    toc = "\n".join(
        f'        <div class="toc-group">\n          <p class="toc-h">{gname}</p>\n          <ol>\n'
        + "\n".join(f'            <li><a href="#{k}"><span class="num">{i:02d}</span>{html.escape(nm)}</a></li>'
                    for i, k, nm, *_ in items)
        + "\n          </ol>\n        </div>"
        for _, gname, items in numbered
    )
    count = sum(len(items) for _, _, items in GROUPS)
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio: Cloisonné Reverse, in depth</title>
<style>
{css}</style>
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad · home buttons</p>
    <h1>Reverse, in depth</h1>
    <p class="lede">Cloisonné Reverse with one depth treatment per tile; flat Reverse stays pinned here to compare. Press any of them: the face sinks by its depth while whatever is under it stays on the ground.</p>
    <div class="pinned">
{tile(0, *FLAT, "")}
    </div>
    <nav class="toc" aria-label="Treatments">
{toc}
    </nav>
    <p class="note">Presses move only transform and box-shadow, so nothing around a button shifts. Back to <a href="index.html">the sixteen variations</a>.</p>
  </aside>
  <main class="variants">
{chr(10).join(sections)}
  </main>
</div>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(variations.HOME.parent.parent)}: flat + {count} depth tiles, {len(page):,} bytes; "
          f"lowest label contrast {worst[0]:.2f}:1 ({worst[1]})")


if __name__ == "__main__":
    main()
