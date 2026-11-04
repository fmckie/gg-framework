#!/usr/bin/env python3
"""Writes mockups/wordmark/final.html: Home as locked so far, in one full-size frame. The crimson
domed buttons (../home-buttons/cloisonne/final.css) and the Bone wordmark (../final.css) are linked
as they stand, so the page shows exactly the CSS to port. Today's .kleio-wordmark is left out, so
the locked rule has to stand on its own; everything else is variants.html's frame."""
import base64
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import variants  # noqa: E402  (its frame, paths and sources; importing it builds nothing)

v, b = variants, variants.variations
OUT = v.ROOT / "final.html"
CAPTION = "The crimson domed buttons under the Bone wordmark at 46px, each from its final.css."


def main() -> None:
    font = base64.b64encode((v.HOME / "assets" / "fonts" / "TejaratchiExLefti.woff2").read_bytes()).decode()
    font_face = (
        "/* The wordmark's face, embedded unmodified (../home-buttons/assets/fonts/1001fonts-tejaratchi-eula.txt). */\n"
        f'@font-face {{\n  font-family: "Tejaratchi Ex Lefti";\n  src: url(data:font/woff2;base64,{font}) format("woff2");\n'
        "  font-weight: 400;\n  font-style: normal;\n}\n"
    )
    home_css = (v.HOME / "_tools" / "home.css").read_text()
    assert home_css.count("url(assets/") == 1
    home_css = home_css.replace("url(assets/", "url(../home-buttons/assets/")
    css = "\n".join([
        font_face,
        (v.HOME / "_tools" / "page.css").read_text(),
        home_css,
        "/* ═══ gg-app/src/kleio/kleio-theme.css: today's mark, unchanged; its .kleio-wordmark is left out ═══ */",
        b.between(v.THEME.read_text(), "/* ── The Kleio mark", ".kleio-wordmark {\n  font-family"),
        "/* ═══ buttons/_tools/concepts.css: the Cloisonné base, unchanged (status pill, Settings) ═══ */",
        b.between(b.CONCEPTS_CSS.read_text(), "/* ── 07 Cloisonné", "/* ── 08 Obsidian"),
        "/* ═══ cloisonne/_tools/variants.css: Reverse, unchanged ═══ */",
        b.between((v.TOOLS / "variants.css").read_text(), "/* 12 Reverse:", "/* 13 Sink:"),
        b.between((v.HOME / "_tools" / "home-concepts.css").read_text(), "/* ── Home on top", "/* Serif capitals"),
        (v.TOOLS / "final-page.css").read_text(),
    ])
    frame = v.frame(0, "locked", "Locked", CAPTION, "")
    number = '        <span class="num">00</span>\n'
    assert frame.count(number) == 1
    frame = frame.replace(number, "")
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio: Home, locked</title>
<style>
{css}</style>
<link rel="stylesheet" href="../home-buttons/cloisonne/final.css">
<link rel="stylesheet" href="final.css">
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad</p>
    <h1>Home, locked</h1>
    <p class="lede">Everything chosen so far on one Home: the crimson domed buttons and the Bone wordmark at 46px. Both are linked straight from their final.css, ready to port.</p>
    <p class="note">Buttons: <a href="../home-buttons/cloisonne/final.css">home-buttons/cloisonne/final.css</a>, dome C. Wordmark: <a href="final.css">wordmark/final.css</a>, in place of today’s .kleio-wordmark. Status pill and Settings stay black. Compare with <a href="variants.html">the wordmark variants</a>.</p>
  </aside>
  <main class="frames">
{frame}
  </main>
</div>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(v.ROOT.parent.parent)}: one locked Home, {len(page):,} bytes")


if __name__ == "__main__":
    main()
