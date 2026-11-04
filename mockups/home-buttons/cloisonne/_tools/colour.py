#!/usr/bin/env python3
"""Writes mockups/home-buttons/cloisonne/colour.html: Cloisonné's Reverse variant (tile 12 of
index.html), flat, with one enamel shared by Kleio, Code, Specialists and Talk to Kleio, beside
today's crimson + black. Its sources are read unchanged: page.css, tiles.css, the button skeleton,
the Cloisonné base and the Reverse block; colour.css holds the palettes and their inks."""
import html
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build as variations  # noqa: E402  (its helpers and paths; importing it builds nothing)

OUT = variations.ROOT / "colour.html"

TODAY = ("today", "Today", "Reverse as it is: crimson Kleio; black enamel on Code, Specialists and Talk to Kleio.")
SHARED = [
    ("crimson", "Crimson", "All four in Kleio’s crimson, #b31d30, lettered white."),
    ("oxblood", "Oxblood", "All four in oxblood, #8a1424, a deep dark red, lettered white."),
    ("black", "Black", "All four in black enamel, #151112, lettered white."),
    ("graphite", "Graphite", "All four in graphite, #454041, a mid charcoal-grey, lettered white."),
    ("bone", "Bone", "All four in bone, #e6dedd, a warm off-white, lettered near-black."),
    ("redblack", "Red-black", "All four in red-black, #1c0b0e, near-black with a red cast, lettered white."),
]


def tile(num: int, key: str, name: str, what: str, classes: str) -> str:
    cls = " ".join(["tile c-cloisonne v-reverse", classes]).strip()
    return f"""    <article class="{cls}" id="{key}" aria-labelledby="{key}-name">
      <header class="cap">
        <span class="num">{num:02d}</span>
        <h3 id="{key}-name">{html.escape(name)}</h3>
        <p class="what">{html.escape(what)}</p>
      </header>
{variations.SET}
    </article>"""


def main() -> None:
    items = [(i, *item) for i, item in enumerate(SHARED, start=1)]
    tiles = "\n".join(tile(num, key, name, what, f"shared e-{key}") for num, key, name, what in items)
    toc = "\n".join(f'            <li><a href="#{k}"><span class="num">{i:02d}</span>{html.escape(n)}</a></li>'
                    for i, k, n, _ in items)
    current = "\n".join(
        f'body:has(#{k}:target) .rail a[href="#{k}"] {{ color: var(--white); background: rgb(246 241 241 / 0.06); }}'
        for _, k, _, _ in items
    )
    css = "\n".join([
        (variations.HOME / "_tools" / "page.css").read_text(),
        (HERE / "tiles.css").read_text(),
        variations.between((variations.HOME / "_tools" / "home.css").read_text(), "/* ── The button skeleton"),
        f"/* ═══ {variations.CONCEPTS_CSS.relative_to(variations.HOME.parent)}: the Cloisonné base, unchanged ═══ */",
        variations.between(variations.CONCEPTS_CSS.read_text(), "/* ── 07 Cloisonné", "/* ── 08 Obsidian"),
        "/* ═══ cloisonne/_tools/variants.css: Reverse, unchanged ═══ */",
        variations.between((HERE / "variants.css").read_text(), "/* 12 Reverse:", "/* 13 Sink:"),
        (HERE / "colour.css").read_text(),
        current,
    ])
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio: Cloisonné Reverse, one enamel</title>
<style>
{css}</style>
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad · home buttons</p>
    <h1>One enamel</h1>
    <p class="lede">Cloisonné Reverse, flat, with one enamel for all four buttons instead of crimson Kleio over black. Rim, corners, sweep and press are Reverse’s; each colour has its own hover and press shades, and each label the ink that clears 4.5:1 on it. Today stays pinned here.</p>
    <div class="pinned">
{tile(0, *TODAY, "")}
    </div>
    <nav class="toc" aria-label="Enamels">
        <div class="toc-group">
          <p class="toc-h">Shared enamel</p>
          <ol>
{toc}
          </ol>
        </div>
    </nav>
    <p class="note">Back to <a href="index.html">the sixteen variations</a> or <a href="depth.html">Reverse in depth</a>.</p>
  </aside>
  <main class="variants">
  <section class="group" id="shared" aria-labelledby="shared-h">
    <h2 class="group-h" id="shared-h">Shared enamel<span class="range">01–{len(items):02d}</span></h2>
{tiles}
  </section>
  </main>
</div>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(variations.HOME.parent.parent)}: today + {len(items)} shared enamels, {len(page):,} bytes")


if __name__ == "__main__":
    main()
