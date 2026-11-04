#!/usr/bin/env python3
"""Writes mockups/home-buttons/cloisonne/index.html: sixteen variants of the Cloisonné button
(concept 07, mockups/buttons), each changing one thing, on a crop of the Home backdrop, with the
base pinned beside them. The base is read unchanged from buttons/_tools/concepts.css; page.css,
the button skeleton and the icons come from the home-buttons page. Fails if any label in CHECKS
falls under 4.5:1 on its fill."""
import html
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent  # mockups/home-buttons/cloisonne
HOME = ROOT.parent  # mockups/home-buttons
OUT = ROOT / "index.html"
CONCEPTS_CSS = HOME.parent / "buttons" / "_tools" / "concepts.css"
ICONS = json.loads((HOME / "_tools" / "icons.json").read_text())


def between(text: str, start: str, end: str | None = None) -> str:
    assert text.count(start) == 1, start
    tail = text[text.index(start):]
    if end is None:
        return tail
    assert tail.count(end) == 1, end
    return tail[: tail.index(end)]


BASE = ("base", "Base", "Concept 07 as it stands: 2px polished rim, flat red enamel, a shine that slides on hover.")
GROUPS = [
    ("rim", "Rim", [
        ("hairline", "Hairline", "Rim: a 1px hairline instead of 2px."),
        ("bezel", "Bezel", "Rim: a heavier 3px bezel instead of 2px."),
        ("gunmetal", "Gunmetal", "Rim: dark gunmetal; its brightest glint is mid grey, never white."),
        ("double", "Double rim", "Rim: two fine rims with a hairline groove between them."),
        ("carved", "Carved", "Rim: a square 4px corner instead of 10px, so it reads cut, not pressed."),
    ]),
    ("enamel", "Enamel", [
        ("dome", "Dome", "Enamel: a very slight dome, lighter at the crown, shaded at the foot."),
        ("grain", "Grain", "Enamel: a fine fired grain instead of a flat fill."),
        ("oxblood", "Oxblood", "Enamel: a deeper oxblood, #8a1424 instead of #b31d30."),
        ("cells", "Cells", "Enamel: two fine wires divide it into cells, as true cloisonné is made."),
        ("deep", "Deep set", "Enamel: set deeper, under a stronger shadow from the rim."),
    ]),
    ("interaction", "Interaction", [
        ("lit", "Lit", "Hover: lights the enamel from within; the rim stays still."),
        ("reverse", "Reverse", "Hover: the shine sweeps left to right instead of right to left."),
        ("sink", "Sink", "Press: the enamel and label sink; the rim and its shadow stay put."),
    ]),
    ("secondary", "Secondary", [
        ("jet", "Jet", "Secondary: jet-black enamel instead of charcoal."),
        ("bone", "Bone", "Secondary: bone-white enamel with black lettering."),
        ("outline", "Rim only", "Secondary: no enamel, only the rim; labels sit on the waves like the tagline."),
    ]),
]


def lum(hex_: str) -> float:
    rgb = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def ratio(a: str, b: str) -> float:
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def over(top: str, alpha: float, under: str) -> str:
    t = [int(top[i:i + 2], 16) for i in (1, 3, 5)]
    u = [int(under[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(a * alpha + b * (1 - alpha)):02x}" for a, b in zip(t, u))


# (what, label colour, the fills it sits on at rest / hover / press)
CHECKS = [
    ("Kleio on red enamel", "#f6f1f1", ["#b31d30", "#c42638", "#9a1728"]),
    ("labels on charcoal", "#f6f1f1", ["#151112", "#201a1b", "#0d0a0b"]),
    ("Talk to Kleio on charcoal", "#d3c9ca", ["#151112", "#201a1b", "#0d0a0b"]),
    ("shortcuts on charcoal", "#a69c9d", ["#151112", "#201a1b", "#0d0a0b"]),
    ("06 Kleio under the dome's crown", "#f6f1f1", [over("#fff0f2", 0.08, "#b31d30"), over("#fff0f2", 0.08, "#c42638")]),
    ("08 Kleio on oxblood", "#f6f1f1", ["#8a1424", "#9c1b2c", "#741020"]),
    ("07 shortcuts on the charcoal's palest grain", "#a69c9d", ["#2f2b2c"]),
    ("14 labels on jet", "#f6f1f1", ["#070505", "#130f10", "#000000"]),
    ("14 shortcuts on jet", "#a69c9d", ["#070505", "#130f10", "#000000"]),
    ("15 labels on bone", "#1c1415", ["#e6dedd", "#f1ebea", "#d4cbca"]),
    ("15 Talk to Kleio on bone", "#3b3233", ["#e6dedd", "#f1ebea", "#d4cbca"]),
    ("15 shortcuts on bone", "#574d4e", ["#e6dedd", "#f1ebea", "#d4cbca"]),
    ("16 labels on a wave dot", "#f6f1f1", ["#9c0000"]),
    ("16 Talk to Kleio and shortcuts on a wave dot", "#d3c9ca", ["#9c0000"]),
]


def icon(name: str) -> str:
    d = ICONS[name]["bold"][0]
    return (f'<svg class="k-ico" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" '
            f'focusable="false"><path d="{d}"/></svg>')


SET = f"""      <div class="stage">
        <div class="set">
          <button type="button" class="k-btn k-pri home-action">{icon("Sparkle")}Kleio</button>
          <button type="button" class="k-btn k-sec home-action">{icon("Code")}Code</button>
          <button type="button" class="k-btn k-sec home-action" aria-keyshortcuts="Meta+Shift+L">{icon("CirclesThree")}Specialists<kbd class="k-kbd" aria-hidden="true">⌘⇧L</kbd></button>
          <button type="button" class="k-btn k-sec k-small k-quiet" aria-keyshortcuts="Meta+Shift+B">{icon("Waveform")}Talk to Kleio<kbd class="k-kbd" aria-hidden="true">⌘⇧B</kbd></button>
        </div>
      </div>"""


def tile(num: int, key: str, name: str, what: str, variant: bool = True) -> str:
    classes = f"tile c-cloisonne v-{key}" if variant else "tile c-cloisonne"
    return f"""    <article class="{classes}" id="{key}" aria-labelledby="{key}-name">
      <header class="cap">
        <span class="num">{num:02d}</span>
        <h3 id="{key}-name">{html.escape(name)}</h3>
        <p class="what">{html.escape(what)}</p>
      </header>
{SET}
    </article>"""


def main() -> None:
    worst = min((ratio(label, fill), what) for what, label, fills in CHECKS for fill in fills)
    assert worst[0] >= 4.5, f"contrast {worst[0]:.2f}:1 for {worst[1]}"

    numbered, n = [], 1
    for gkey, gname, items in GROUPS:
        numbered.append((gkey, gname, [(n + i, *item) for i, item in enumerate(items)]))
        n += len(items)

    sections = []
    for gkey, gname, items in numbered:
        tiles = "\n".join(tile(*item) for item in items)
        sections.append(
            f'  <section class="group" id="{gkey}" aria-labelledby="{gkey}-h">\n'
            f'    <h2 class="group-h" id="{gkey}-h">{gname}<span class="range">{items[0][0]:02d}–{items[-1][0]:02d}</span></h2>\n'
            f"{tiles}\n  </section>"
        )
    toc = "\n".join(
        f'        <div class="toc-group">\n          <p class="toc-h">{gname}</p>\n          <ol>\n'
        + "\n".join(f'            <li><a href="#{k}"><span class="num">{i:02d}</span>{html.escape(nm)}</a></li>' for i, k, nm, _ in items)
        + "\n          </ol>\n        </div>"
        for gkey, gname, items in numbered
    )
    current = "\n".join(
        f'body:has(#{k}:target) .rail a[href="#{k}"] {{ color: var(--white); background: rgb(246 241 241 / 0.06); }}'
        for _, _, items in numbered for _, k, _, _ in items
    )
    css = "\n".join([
        (HOME / "_tools" / "page.css").read_text(),
        (HERE / "tiles.css").read_text(),
        between((HOME / "_tools" / "home.css").read_text(), "/* ── The button skeleton"),
        f"/* ═══ {CONCEPTS_CSS.relative_to(HOME.parent)}: the base, unchanged ═══ */",
        between(CONCEPTS_CSS.read_text(), "/* ── 07 Cloisonné", "/* ── 08 Obsidian"),
        (HERE / "variants.css").read_text(),
        current,
    ])
    count = sum(len(items) for _, _, items in GROUPS)
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio: Cloisonné variations</title>
<style>
{css}</style>
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad · home buttons</p>
    <h1>Cloisonné</h1>
    <p class="lede">{count} variations on concept 07, each changing one thing; its caption says what. The base stays pinned here beside whichever you’re looking at. All live: hover, press, Tab.</p>
    <div class="pinned">
{tile(0, *BASE, variant=False)}
    </div>
    <nav class="toc" aria-label="Variants">
{toc}
    </nav>
  </aside>
  <main class="variants">
{chr(10).join(sections)}
  </main>
</div>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(HOME.parent.parent)}: base + {count} variants, {len(page):,} bytes; "
          f"lowest label contrast {worst[0]:.2f}:1 ({worst[1]})")


if __name__ == "__main__":
    main()
