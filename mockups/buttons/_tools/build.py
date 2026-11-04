#!/usr/bin/env python3
"""Writes mockups/buttons/index.html: ten button concepts for Kleio, each shown over a strip
of the real Home background and on the plain app surface. The CSS is inlined from page.css
and concepts.css, so the page is one offline file plus assets/home-strip.png."""
import html
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "index.html"

CONCEPTS = [
    ("lacquer", "Lacquer",
     "Urushi is built coat on coat, so the red sits deep and glows from inside; the black one hides a red coat that wakes when touched."),
    ("inscribed", "Inscribed",
     "A stone tablet with its panel cut in. The primary’s letters are filled red, as Roman letter-cutters filled theirs."),
    ("door", "Door Ajar",
     "A shut black door with light under it. Hover opens the gap; the secondary’s light is white."),
    ("ember", "Ember",
     "A banked fire: the red lives under the edge, never on the face. The secondary is cold ash until you touch it."),
    ("fluted", "Fluted",
     "The logo’s Ionic column as faint flutes lit from the left. On hover the light comes round."),
    ("editorial", "Editorial",
     "No box: Didot capitals set between two hairline rules, as a book sets a heading. The rules close in on hover."),
    ("cloisonne", "Cloisonné",
     "Flat red enamel in a thin polished rim. The enamel never shines; the rim catches the light as you pass."),
    ("obsidian", "Obsidian",
     "Black volcanic glass with one knife-sharp highlight along its top edge, and red deep inside the primary."),
    ("keycap", "Keycap",
     "A real key: a skirt below the top and 2px of travel. It sinks when pressed and comes back up."),
    ("velvet", "Velvet",
     "Matte red pile with a soft inner shadow and a fine nap. Nothing shines; the edges lift when touched."),
]

# (element, classes, attributes, label). The pressed and focus samples are drawn, not live,
# so they are spans hidden from assistive tech.
ROW = [
    ("button", "k-pri", ' type="button"', "Chat"),
    ("button", "k-sec", ' type="button"', "Code"),
    ("button", "k-pri", ' type="button" disabled', "Connect"),
    ("button", "k-pri k-small", ' type="button"', "Send"),
    None,
    ("span", "k-pri is-pressed", ' aria-hidden="true"', "Chat"),
    ("span", "k-pri is-focus", ' aria-hidden="true"', "Chat"),
]
CAPTIONS = ["Primary", "Secondary", "Disabled", "Small", "", "Pressed", "Focus"]
STAGES = [("on-home", "Over Home"), ("on-app", "App surface")]


def band(stage: str) -> str:
    cells = []
    for item in ROW:
        if item is None:
            cells.append('          <span class="rule" aria-hidden="true"></span>')
            continue
        tag, classes, attrs, label = item
        cells.append(f'          <{tag} class="k-btn {classes}"{attrs}>{html.escape(label)}</{tag}>')
    captions = "".join(f"<span>{c}</span>" for c in CAPTIONS)
    return (
        f'        <div class="band {stage}">\n' + "\n".join(cells) + "\n        </div>\n"
        f'        <div class="captions" aria-hidden="true">{captions}</div>'
    )


def card(index: int, key: str, name: str, why: str) -> str:
    stages = "\n".join(
        f'      <section class="stage" aria-label="{html.escape(name)}, {label.lower()}">\n'
        f'        <p class="stage-tag">{label}</p>\n{band(stage)}\n      </section>'
        for stage, label in STAGES
    )
    return (
        f'  <article class="concept c-{key}" id="{key}" aria-labelledby="{key}-name">\n'
        f'    <header class="concept-head">\n'
        f'      <span class="num">{index:02d}</span>\n'
        f'      <h2 id="{key}-name">{html.escape(name)}</h2>\n'
        f'      <p class="why">{html.escape(why)}</p>\n'
        f"    </header>\n"
        f'    <div class="stages">\n{stages}\n    </div>\n'
        f"  </article>"
    )


css = (HERE / "page.css").read_text() + "\n" + (HERE / "concepts.css").read_text()
cards = "\n".join(card(i, *c) for i, c in enumerate(CONCEPTS, 1))
page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio buttons: ten concepts</title>
<style>
{css}</style>
</head>
<body>
<header class="page-head">
  <div>
    <p class="eyebrow">Kleio · scratch pad · buttons</p>
    <h1>Ten buttons</h1>
    <p class="lede">Red, white and black only; still at rest and alive when touched. The first four
      in each row are live: hover them, press them, Tab to them. Pressed and Focus are drawn samples.</p>
  </div>
  <dl class="legend">
    <dt>Over Home</dt><dd>A strip of the real Home background</dd>
    <dt>App surface</dt><dd>The plain dark app surface, #0c090a</dd>
    <dt>Pressed, Focus</dt><dd>Drawn samples of those two states</dd>
  </dl>
</header>
<main class="concepts">
{cards}
</main>
</body>
</html>
"""
OUT.write_text(page)
print(f"wrote {OUT.relative_to(HERE.parent.parent.parent)}: {len(CONCEPTS)} concepts, {len(page):,} bytes")
