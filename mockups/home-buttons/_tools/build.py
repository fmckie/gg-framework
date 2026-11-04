#!/usr/bin/env python3
"""Writes mockups/home-buttons/index.html: the ten button concepts from mockups/buttons, each
dressed on a full-size Kleio Home (1024x720) over the real backdrop, plus today's Instrument
style for reference. concepts.css is read from the buttons page unchanged, so refining a concept
there and re-running this carries it here. One offline file plus assets/ (the wordmark's font is
embedded so file:// pages load it in any browser)."""
import base64
import html
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "index.html"
CONCEPTS_CSS = ROOT.parent / "buttons" / "_tools" / "concepts.css"
ICONS = json.loads((HERE / "icons.json").read_text())

# key, name, why, icon weight (Phosphor; the app uses bold)
CONCEPTS = [
    ("today", "Today", "Instrument, as the app has it now: opaque, hairline-edged, with a faint crimson glint along the top. For reference.", "bold"),
    ("lacquer", "Lacquer", "Urushi built coat on coat: the red sits deep and glows from inside; the black ones hide a red coat that wakes when touched.", "bold"),
    ("inscribed", "Inscribed", "A stone tablet with its panel cut in. The primary’s letters are filled red, as Roman letter-cutters filled theirs.", "regular"),
    ("door", "Door Ajar", "A shut black door with light under it; hover opens the gap. The three quiet controls keep theirs nearly shut.", "bold"),
    ("ember", "Ember", "A banked fire: the red lives under the edge, never on the face. Everything else is cold ash until you touch it.", "bold"),
    ("fluted", "Fluted", "The logo’s Ionic column as faint flutes lit from the left. On hover the light comes round.", "bold"),
    ("editorial", "Editorial", "No box: Didot capitals set between two hairline rules, as a book sets a heading. The rules close in on hover.", "light"),
    ("cloisonne", "Cloisonné", "Flat red enamel in a thin polished rim. The enamel never shines; the rim catches the light as you pass.", "bold"),
    ("obsidian", "Obsidian", "Black volcanic glass with one knife-sharp highlight along its top edge, and red deep inside the primary.", "bold"),
    ("keycap", "Keycap", "A real key: a skirt below the top and 2px of travel. It sinks when pressed and comes back up.", "bold"),
    ("velvet", "Velvet", "Matte red pile with a soft inner shadow and a fine nap. Nothing shines; the edges lift when touched.", "regular"),
]


def icon(name: str, weight: str) -> str:
    d = ICONS[name][weight][0]
    return f'<svg class="k-ico" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="{d}"/></svg>'


def home(key: str, name: str, weight: str) -> str:
    return f"""      <div class="window c-{key}" role="group" aria-labelledby="{key}-name">
        <div class="home">
          <span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>
          <div class="status-row">
            <button type="button" class="k-btn k-sec k-small k-pill" title="Connection to your host"><span class="k-dot" aria-hidden="true"></span>Connected to studio-mini</button>
          </div>
          <div class="mark" role="img" aria-label="Kleio">
            <img src="assets/kleio-mark.png" alt="" draggable="false">
            <span class="wordmark" aria-hidden="true">KLEIO</span>
          </div>
          <p class="tagline">Talk to your work: chat, code and specialists in one app.</p>
          <div class="actions">
            <button type="button" class="k-btn k-pri home-action">{icon("Sparkle", weight)}Kleio</button>
            <button type="button" class="k-btn k-sec home-action">{icon("Code", weight)}Code</button>
            <button type="button" class="k-btn k-sec home-action" aria-keyshortcuts="Meta+Shift+L">{icon("CirclesThree", weight)}Specialists<kbd class="k-kbd" aria-hidden="true">⌘⇧L</kbd></button>
          </div>
          <button type="button" class="k-btn k-sec k-small k-quiet" aria-keyshortcuts="Meta+Shift+B">{icon("Waveform", weight)}Talk to Kleio<kbd class="k-kbd" aria-hidden="true">⌘⇧B</kbd></button>
          <button type="button" class="k-btn k-sec k-small k-icon settings" aria-label="Settings" title="Settings">{icon("GearSix", weight)}</button>
          <span class="version">v2.1.3</span>
        </div>
      </div>"""


def section(index: int, key: str, name: str, why: str, weight: str) -> str:
    return f"""    <section class="concept" id="{key}">
      <header class="label">
        <span class="num">{index:02d}</span>
        <h2 id="{key}-name">{html.escape(name)}</h2>
        <p class="why">{html.escape(why)}</p>
      </header>
{home(key, name, weight)}
    </section>"""


font = base64.b64encode((ROOT / "assets" / "fonts" / "TejaratchiExLefti.woff2").read_bytes()).decode()
font_face = f"""/* The wordmark's face, embedded unmodified (assets/fonts/1001fonts-tejaratchi-eula.txt). */
@font-face {{
  font-family: "Tejaratchi Ex Lefti";
  src: url(data:font/woff2;base64,{font}) format("woff2");
  font-weight: 400;
  font-style: normal;
}}
"""
# The rail marks the window you jumped to.
current = "\n".join(
    f'body:has(#{k}:target) .rail a[href="#{k}"] {{ color: var(--white); background: rgb(246 241 241 / 0.06); }}'
    for k, *_ in CONCEPTS
)
css = "\n".join([
    font_face,
    (HERE / "page.css").read_text(),
    current,
    (HERE / "home.css").read_text(),
    f"/* ═══ {CONCEPTS_CSS.relative_to(ROOT.parent)}, unchanged ═══ */",
    CONCEPTS_CSS.read_text(),
    (HERE / "home-concepts.css").read_text(),
])
nav = "\n".join(
    f'          <li><a href="#{k}"><span class="num">{i:02d}</span>{html.escape(n)}</a></li>'
    for i, (k, n, *_) in enumerate(CONCEPTS)
)
sections = "\n".join(section(i, *c) for i, c in enumerate(CONCEPTS))
page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio home buttons: ten concepts on Home</title>
<style>
{css}</style>
</head>
<body>
<div class="page">
  <aside class="rail">
    <p class="eyebrow">Kleio · scratch pad</p>
    <h1>Home buttons</h1>
    <p class="lede">The ten button concepts on the real Home: same backdrop, mark and layout; only the controls change. All live: hover, press, Tab.</p>
    <nav aria-label="Concepts">
      <ol>
{nav}
      </ol>
    </nav>
    <p class="note">Talk to Kleio, the status pill and Settings wear each concept’s secondary dress, one size down. Connected is a white dot: the palette has no green.</p>
  </aside>
  <main class="frames">
{sections}
  </main>
</div>
</body>
</html>
"""
OUT.write_text(page)
print(f"wrote {OUT.relative_to(ROOT.parent.parent)}: {len(CONCEPTS)} homes, {len(page):,} bytes")
