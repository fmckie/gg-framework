#!/usr/bin/env python3
"""Writes mockups/home-buttons/cloisonne/crimson.html: the locked Crimson enamel (colour.html, tile 01)
in Cloisonné's Reverse rim, first flat on a full-size Home, then flat and in each depth treatment from
depth.html, with Kleio's darker-crimson wall under every button. Its sources are read unchanged:
page.css, home.css (its backdrop URL rebased to this folder), home-concepts.css, tiles.css, the
Cloisonné base, Reverse, colour.css and depth.css; depth.py supplies every press as built.

Inks on crimson (colour.css .e-crimson), read from the hex: #f6f1f1 is 5.99:1 on #b31d30 and 5.10:1 on
hover #c42638; #f7e6e8 (Talk to Kleio, shortcuts) 5.56:1 and 4.74:1; pressed #9a1728 is darker still."""
import base64
import html
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build as variations  # noqa: E402  (helpers and paths; importing it builds nothing)
import depth  # noqa: E402  (the depth recipes and generators, as built)

HOME_TOOLS = variations.HOME / "_tools"
OUT = variations.ROOT / "crimson.html"

FLAT = ("flat", "Flat", "Crimson Reverse as locked: all four in #b31d30, with no depth.")
# depth.html's captions, where the crimson walls change them.
CAPTIONS = {
    "plinth": "A 4px wall of darker crimson under the face; press drops the face onto it.",
    "plinth-dome": "A 3px darker-crimson wall and a softer dome, both held back.",
}


def crimson_walls(recipe):
    """The same recipe and press, with Kleio's darker-crimson wall under every button."""
    return lambda size, _kind: recipe(size, "pri")


def home_frame() -> str:
    """home-buttons/_tools/build.py's Home; the shared crimson goes on its four buttons only."""
    i = variations.icon
    return f"""    <div class="window c-cloisonne v-reverse">
      <div class="home">
        <span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>
        <div class="status-row">
          <button type="button" class="k-btn k-sec k-small k-pill" title="Connection to your host"><span class="k-dot" aria-hidden="true"></span>Connected to studio-mini</button>
        </div>
        <div class="mark" role="img" aria-label="Kleio">
          <img src="../assets/kleio-mark.png" alt="" draggable="false">
          <span class="wordmark" aria-hidden="true">KLEIO</span>
        </div>
        <p class="tagline">Talk to your work: chat, code and specialists in one app.</p>
        <div class="actions c-cloisonne shared e-crimson">
          <button type="button" class="k-btn k-pri home-action">{i("Sparkle")}Kleio</button>
          <button type="button" class="k-btn k-sec home-action">{i("Code")}Code</button>
          <button type="button" class="k-btn k-sec home-action" aria-keyshortcuts="Meta+Shift+L">{i("CirclesThree")}Specialists<kbd class="k-kbd" aria-hidden="true">⌘⇧L</kbd></button>
        </div>
        <div class="brief c-cloisonne shared e-crimson">
          <button type="button" class="k-btn k-sec k-small k-quiet" aria-keyshortcuts="Meta+Shift+B">{i("Waveform")}Talk to Kleio<kbd class="k-kbd" aria-hidden="true">⌘⇧B</kbd></button>
        </div>
        <button type="button" class="k-btn k-sec k-small k-icon settings" aria-label="Settings" title="Settings">{i("GearSix")}</button>
        <span class="version">v2.1.3</span>
      </div>
    </div>"""


def main() -> None:
    treatments = [item for _, _, group in depth.GROUPS for item in group]
    items = [(num, key, name, CAPTIONS.get(key, what), features, recipe)
             for num, (key, name, what, features, recipe) in enumerate(treatments, start=1)]

    font = base64.b64encode((variations.HOME / "assets" / "fonts" / "TejaratchiExLefti.woff2").read_bytes()).decode()
    font_face = (
        "/* The wordmark's face, embedded unmodified (../assets/fonts/1001fonts-tejaratchi-eula.txt). */\n"
        f'@font-face {{\n  font-family: "Tejaratchi Ex Lefti";\n  src: url(data:font/woff2;base64,{font}) format("woff2");\n'
        "  font-weight: 400;\n  font-style: normal;\n}\n"
    )
    home_css = (HOME_TOOLS / "home.css").read_text()
    assert home_css.count("url(assets/") == 1
    home_css = home_css.replace("url(assets/", "url(../assets/")

    generated = [f"/* {num:02d} {name} */\n" + depth.depth_css(key, crimson_walls(recipe))
                 for num, key, name, _, _, recipe in items]
    generated += [depth.dome_css(cls, *alphas) for cls, alphas in depth.DOMES.items()]
    links = [(0, FLAT[0], FLAT[1])] + [(num, key, name) for num, key, name, *_ in items]
    current = "\n".join(
        f'body:has(#{k}:target) .rail a[href="#{k}"] {{ color: var(--white); background: rgb(246 241 241 / 0.06); }}'
        for _, k, _ in links
    )
    css = "\n".join([
        font_face,
        (HOME_TOOLS / "page.css").read_text(),
        (HERE / "tiles.css").read_text(),
        home_css,
        f"/* ═══ {variations.CONCEPTS_CSS.relative_to(variations.HOME.parent)}: the Cloisonné base, unchanged ═══ */",
        variations.between(variations.CONCEPTS_CSS.read_text(), "/* ── 07 Cloisonné", "/* ── 08 Obsidian"),
        "/* ═══ cloisonne/_tools/variants.css: Reverse, unchanged ═══ */",
        variations.between((HERE / "variants.css").read_text(), "/* 12 Reverse:", "/* 13 Sink:"),
        variations.between((HOME_TOOLS / "home-concepts.css").read_text(), "/* ── Home on top", "/* Serif capitals"),
        (HERE / "colour.css").read_text(),
        (HERE / "depth.css").read_text(),
        "/* ═══ Generated from depth.py: every press as built, crimson walls throughout, and the domes ═══ */",
        "\n\n".join(generated),
        (HERE / "crimson.css").read_text(),
        current,
    ])
    tiles = "\n".join([depth.tile(0, *FLAT, "shared e-crimson")] + [
        depth.tile(num, key, name, what, f"shared e-crimson depth d-{key} {features}".strip())
        for num, key, name, what, features, _ in items
    ])
    nav = "\n".join(f'        <li><a href="#{k}"><span class="num">{n:02d}</span>{html.escape(name)}</a></li>'
                    for n, k, name in links)
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio: Crimson, locked</title>
<style>
{css}</style>
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad</p>
    <h1>Crimson</h1>
    <p class="lede">Locked: Kleio, Code, Specialists and Talk to Kleio share one crimson enamel in Reverse’s rim. Here on the real Home, then flat and in each depth treatment. All live: hover, press, Tab.</p>
    <nav aria-label="Depth treatments">
      <ol>
{nav}
      </ol>
    </nav>
    <p class="note">On Home, the status pill and Settings keep Reverse’s black enamel. Back to <a href="index.html">the sixteen variations</a>, <a href="depth.html">Reverse in depth</a> or <a href="colour.html">one enamel</a>.</p>
  </aside>
  <section class="on-home" id="home" aria-labelledby="home-name">
    <header class="label">
      <h2 id="home-name">On Home</h2>
      <p class="why">Flat crimson Reverse on the real backdrop, under the column mark and wordmark.</p>
    </header>
{home_frame()}
  </section>
  <section class="group in-depth" id="depth" aria-labelledby="depth-h">
    <h2 class="group-h" id="depth-h">In depth<span class="range">00–{len(items):02d}</span></h2>
    <div class="tiles">
{tiles}
    </div>
  </section>
</div>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(variations.HOME.parent.parent)}: Home + flat + {len(items)} depth tiles, {len(page):,} bytes")


if __name__ == "__main__":
    main()
