#!/usr/bin/env python3
"""Writes mockups/home-buttons/cloisonne/final.html: the locked look, Crimson Reverse with domed
enamel (../final.css, linked as it stands), on four full-size Homes, one per dome strength; the dome
is the only thing that differs between them. The Home is crimson.html's, with its status pill and
Settings still black Reverse from the same unchanged sources. Fails if final.css's dome has drifted
from depth.py's, or if a label falls under 4.5:1 where the crown is brightest behind it (hex values)."""
import base64
import html
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build as variations  # noqa: E402  (helpers and paths; importing it builds nothing)
import depth  # noqa: E402  (the dome as built)

HOME_TOOLS = variations.HOME / "_tools"
FINAL_CSS = variations.ROOT / "final.css"
OUT = variations.ROOT / "final.html"

# final.css's dome knobs: depth.py's f-dome, with no edge line.
LOCKED = dict(zip(("crown", "foot", "ends"), depth.DOMES["f-dome"])) | {"line": 0}
# letter, name, caption, the knobs it changes from final.css
FRAMES = [
    ("a", "Barely there", "Softer than B: the highlight at 7% and the shade at 12%, so the curve is barely there.",
     {"crown": 0.07, "foot": 0.12, "ends": 0.06}),
    ("b", "As built", "The dome exactly as built in crimson.html: a 16% highlight at the top, 26% shade at the bottom.", {}),
    ("c", "Brighter top", "B with a stronger highlight at the top, 22% instead of 16%; the shade is unchanged.", {"crown": 0.22}),
    ("d", "Edge light", "B plus a faint 1px highlight line along the enamel’s top inner edge.", {"line": 0.28}),
]
# Each label's top edge, px down the enamel (40px tall on the big buttons, 29px on the small one),
# and its ink at rest and when touched: icon, label, shortcut. The crown fades downward, so a
# label's top edge has the brightest dome behind it; the shading only darkens.
LABEL_TOPS = {
    40: [(11.0, "#f6f1f1", "#f6f1f1"), (12.5, "#f6f1f1", "#f6f1f1"), (14.5, "#f7e6e8", "#f7e6e8")],
    29: [(6.5, "#f7e6e8", "#f6f1f1"), (8.0, "#f7e6e8", "#f6f1f1"), (9.0, "#f7e6e8", "#f7e6e8")],
}
REST, HOVER, PRESS = "#b31d30", "#c42638", "#9a1728"


def lowest_contrast(crown: float):
    cases = []
    for height, tops in LABEL_TOPS.items():
        for top, rest_ink, touched_ink in tops:
            alpha = depth.crown_alpha(crown, height, top)
            rest, hover, press = (variations.over("#fff0f2", alpha, fill) for fill in (REST, HOVER, PRESS))
            where = f"{top:g}px down the {height}px enamel"
            cases += [
                (variations.ratio(rest_ink, rest), f"{rest_ink} at rest, {where}"),
                (variations.ratio(touched_ink, hover), f"{touched_ink} on hover, {where}"),
                (variations.ratio(rest_ink, press), f"{rest_ink} pressed, {where}"),
                (variations.ratio(touched_ink, press), f"{touched_ink} pressed, {where}"),
            ]
    return min(cases)


def glyph(name: str) -> str:
    d = variations.ICONS[name]["bold"][0]
    return f'<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="{d}"/></svg>'


def frame(letter: str, name: str, caption: str) -> str:
    g = glyph
    return f"""    <section class="concept" id="{letter}" aria-labelledby="{letter}-name">
      <header class="label">
        <span class="num">{letter.upper()}</span>
        <h2 id="{letter}-name">{html.escape(name)}</h2>
        <p class="why">{html.escape(caption)}</p>
      </header>
      <div class="window c-cloisonne v-reverse dome-{letter}">
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
    final_css = FINAL_CSS.read_text()
    c = depth.CROWN
    for needle in [*(f"--dome-{k}: {v:g};" for k, v in LOCKED.items()),
                   f"radial-gradient({c['rx']}% {c['ry']}% at 50% {c['cy']}%",
                   "radial-gradient(60% 150% at 50% 30%, rgb(0 0 0 / 0) 55%",
                   "linear-gradient(180deg, rgb(0 0 0 / 0) 46%"]:
        assert needle in final_css, f"final.css's dome has drifted from depth.py's: {needle}"
    worst = min(lowest_contrast((LOCKED | knobs)["crown"]) + (letter,) for letter, _, _, knobs in FRAMES)
    assert worst[0] >= 4.5, f"contrast {worst[0]:.2f}:1 in {worst[2].upper()}: {worst[1]}"

    font = base64.b64encode((variations.HOME / "assets" / "fonts" / "TejaratchiExLefti.woff2").read_bytes()).decode()
    font_face = (
        "/* The wordmark's face, embedded unmodified (../assets/fonts/1001fonts-tejaratchi-eula.txt). */\n"
        f'@font-face {{\n  font-family: "Tejaratchi Ex Lefti";\n  src: url(data:font/woff2;base64,{font}) format("woff2");\n'
        "  font-weight: 400;\n  font-style: normal;\n}\n"
    )
    home_css = (HOME_TOOLS / "home.css").read_text()
    assert home_css.count("url(assets/") == 1
    home_css = home_css.replace("url(assets/", "url(../assets/")
    overrides = "\n".join(
        f".dome-{letter} .kleio-cloisonne {{ " + " ".join(f"--dome-{k}: {v:g};" for k, v in knobs.items()) + " }"
        for letter, _, _, knobs in FRAMES if knobs
    )
    current = "\n".join(
        f'body:has(#{letter}:target) .rail a[href="#{letter}"] {{ color: var(--white); background: rgb(246 241 241 / 0.06); }}'
        for letter, *_ in FRAMES
    )
    css = "\n".join([
        font_face,
        (HOME_TOOLS / "page.css").read_text(),
        home_css,
        "/* ═══ buttons/_tools/concepts.css: the Cloisonné base, unchanged (status pill, Settings) ═══ */",
        variations.between(variations.CONCEPTS_CSS.read_text(), "/* ── 07 Cloisonné", "/* ── 08 Obsidian"),
        "/* ═══ cloisonne/_tools/variants.css: Reverse, unchanged ═══ */",
        variations.between((HERE / "variants.css").read_text(), "/* 12 Reverse:", "/* 13 Sink:"),
        variations.between((HOME_TOOLS / "home-concepts.css").read_text(), "/* ── Home on top", "/* Serif capitals"),
        (HERE / "final-page.css").read_text(),
        "/* ═══ The four dome strengths: final.css is B; A, C and D change only these ═══ */",
        overrides,
        current,
    ])
    nav = "\n".join(f'        <li><a href="#{letter}"><span class="num">{letter.upper()}</span>{html.escape(name)}</a></li>'
                    for letter, name, *_ in FRAMES)
    frames = "\n".join(frame(letter, name, caption) for letter, name, caption, _ in FRAMES)
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio: Crimson dome, final</title>
<style>
{css}</style>
<link rel="stylesheet" href="final.css">
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad</p>
    <h1>Final</h1>
    <p class="lede">Crimson Reverse with the domed enamel, locked, on the real Home at four dome strengths. The dome is the only thing that changes. All live: hover, press, Tab.</p>
    <nav aria-label="Dome strengths">
      <ol>
{nav}
      </ol>
    </nav>
    <p class="note">The look is in <a href="final.css">final.css</a>, set to B; A, C and D are swaps of its dome values, noted at the top. Status pill and Settings stay black. Back to <a href="crimson.html">Crimson</a>.</p>
  </aside>
  <main class="frames">
{frames}
  </main>
</div>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(variations.HOME.parent.parent)}: 4 Homes (A–D); lowest label contrast "
          f"{worst[0]:.2f}:1 (frame {worst[2].upper()}, {worst[1]})")


if __name__ == "__main__":
    main()
