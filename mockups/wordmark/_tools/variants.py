#!/usr/bin/env python3
"""Writes mockups/wordmark/variants.html: today's KLEIO wordmark and nine variants, one change each,
on the full-size Home from home-buttons/cloisonne/final.html with the locked buttons
(../home-buttons/cloisonne/final.css, linked as it stands). Today's mark and wordmark rules are
inlined from gg-app/src/kleio/kleio-theme.css, read only; the rest of the frame comes unchanged
from the home-buttons tools, and wordmark.css holds the variants."""
import base64
import html
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent  # mockups/wordmark
HOME = ROOT.parent / "home-buttons"
TOOLS = HOME / "cloisonne" / "_tools"
THEME = ROOT.parent.parent / "gg-app" / "src" / "kleio" / "kleio-theme.css"
OUT = ROOT / "variants.html"
sys.path.insert(0, str(TOOLS))
import build as variations  # noqa: E402  (helpers, icons and paths; importing it builds nothing)
import final  # noqa: E402  (the locked buttons' glyphs)

# key, name, caption, the frame's wordmark.css classes
FRAMES = [
    ("today", "Today", "As the app has it: pure white, 56px, 0.4em tracking, over a tight dark shadow.", ""),
    ("bone", "Bone", "Warm off-white, #e8e0dc, instead of pure white.", "wm-bone"),
    ("ash", "Ash", "A softer grey-white, #cfc8c6, instead of pure white.", "wm-ash"),
    ("dimmed", "Dimmed", "Pure white at 75% opacity, so the crimson wash tints it.", "wm-dimmed"),
    ("carved", "Carved fill", "Filled dark, with a light 1px top edge and a dark bottom edge, as if cut into stone.", "wm-carved"),
    ("catch", "Light catch", "A vertical fill: bright white at the top, fading to grey at the foot.", "wm-catch"),
    ("blush", "Crimson-tinted white", "#f7e6e8, the pale pink-white of the buttons’ shortcuts, instead of pure white.", "wm-blush"),
    ("outline", "Hairline outline", "A 1px white stroke with no fill, so the waves show through the letters.", "wm-outline"),
    ("smaller", "Smaller", "Pure white at 46px with 0.34em tracking, instead of 56px and 0.4em.", "wm-smaller"),
    ("bone-smaller", "Bone + smaller", "Bone’s #e8e0dc at the smaller size: 46px with 0.34em tracking.", "wm-bone wm-smaller"),
]


def frame(num: int, key: str, name: str, caption: str, classes: str) -> str:
    g = final.glyph
    cls = " ".join(["window c-cloisonne v-reverse", classes]).strip()
    return f"""    <section class="concept" id="{key}" aria-labelledby="{key}-name">
      <header class="label">
        <span class="num">{num:02d}</span>
        <h2 id="{key}-name">{html.escape(name)}</h2>
        <p class="why">{html.escape(caption)}</p>
      </header>
      <div class="{cls}">
        <div class="home">
          <span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>
          <div class="status-row">
            <button type="button" class="k-btn k-sec k-small k-pill" title="Connection to your host"><span class="k-dot" aria-hidden="true"></span>Connected to studio-mini</button>
          </div>
          <div class="kleio-mark" role="img" aria-label="Kleio">
            <img class="kleio-mark-img" src="../home-buttons/assets/kleio-mark.png" alt="" draggable="false">
            <span class="kleio-wordmark" aria-hidden="true" data-word="KLEIO">KLEIO</span>
          </div>
          <p class="tagline">Talk to your work: chat, code and specialists in one app.</p>
          <div class="actions">
            <button type="button" class="kleio-cloisonne">{g("Sparkle")}Kleio</button>
            <button type="button" class="kleio-cloisonne">{g("Code")}Code</button>
            <button type="button" class="kleio-cloisonne" aria-keyshortcuts="Meta+Shift+L">{g("CirclesThree")}Specialists<kbd aria-hidden="true">⌘⇧L</kbd></button>
          </div>
          <button type="button" class="kleio-cloisonne is-small" aria-keyshortcuts="Meta+Shift+B">{g("Waveform")}Talk to Kleio<kbd aria-hidden="true">⌘⇧B</kbd></button>
          <button type="button" class="k-btn k-sec k-small k-icon settings" aria-label="Settings" title="Settings">{variations.icon("GearSix")}</button>
          <span class="version">v2.1.3</span>
        </div>
      </div>
    </section>"""


def main() -> None:
    font = base64.b64encode((HOME / "assets" / "fonts" / "TejaratchiExLefti.woff2").read_bytes()).decode()
    font_face = (
        "/* The wordmark's face, embedded unmodified (../home-buttons/assets/fonts/1001fonts-tejaratchi-eula.txt). */\n"
        f'@font-face {{\n  font-family: "Tejaratchi Ex Lefti";\n  src: url(data:font/woff2;base64,{font}) format("woff2");\n'
        "  font-weight: 400;\n  font-style: normal;\n}\n"
    )
    home_css = (HOME / "_tools" / "home.css").read_text()
    assert home_css.count("url(assets/") == 1
    home_css = home_css.replace("url(assets/", "url(../home-buttons/assets/")
    current = "\n".join(
        f'body:has(#{k}:target) .rail a[href="#{k}"] {{ color: var(--white); background: rgb(246 241 241 / 0.06); }}'
        for k, *_ in FRAMES
    )
    css = "\n".join([
        font_face,
        (HOME / "_tools" / "page.css").read_text(),
        home_css,
        "/* ═══ gg-app/src/kleio/kleio-theme.css: today's mark and wordmark, unchanged ═══ */",
        variations.between(THEME.read_text(), "/* ── The Kleio mark", ".kleio-mark.is-small .kleio-mark-img"),
        "/* ═══ buttons/_tools/concepts.css: the Cloisonné base, unchanged (status pill, Settings) ═══ */",
        variations.between(variations.CONCEPTS_CSS.read_text(), "/* ── 07 Cloisonné", "/* ── 08 Obsidian"),
        "/* ═══ cloisonne/_tools/variants.css: Reverse, unchanged ═══ */",
        variations.between((TOOLS / "variants.css").read_text(), "/* 12 Reverse:", "/* 13 Sink:"),
        variations.between((HOME / "_tools" / "home-concepts.css").read_text(), "/* ── Home on top", "/* Serif capitals"),
        (TOOLS / "final-page.css").read_text(),
        (HERE / "wordmark.css").read_text(),
        current,
    ])
    nav = "\n".join(f'        <li><a href="#{k}"><span class="num">{i:02d}</span>{html.escape(n)}</a></li>'
                    for i, (k, n, *_) in enumerate(FRAMES))
    frames = "\n".join(frame(i, *f) for i, f in enumerate(FRAMES))
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio: wordmark variants</title>
<style>
{css}</style>
<link rel="stylesheet" href="../home-buttons/cloisonne/final.css">
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad</p>
    <h1>Wordmark</h1>
    <p class="lede">Today’s KLEIO and nine variants on the real Home, each changing one thing about the wordmark. The column mark, the gap and the centring never change.</p>
    <nav aria-label="Wordmark variants">
      <ol>
{nav}
      </ol>
    </nav>
    <p class="note">Buttons are the locked <a href="../home-buttons/cloisonne/final.css">final.css</a>, dome C. Frame 00 is read from kleio-theme.css as it stands.</p>
  </aside>
  <main class="frames">
{frames}
  </main>
</div>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(ROOT.parent.parent)}: today + {len(FRAMES) - 1} variants, {len(page):,} bytes")


if __name__ == "__main__":
    main()
