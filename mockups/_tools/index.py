#!/usr/bin/env python3
"""Writes mockups/index.html: the 12 screenshots in shots/ as a 4×3 grid, one
column per direction, each linking to its live page."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = [
    ("a-classical", "A · Classical editorial", "Ivory on near-black in Iowan and Didot, hairline rules and small caps. Brass marks what’s live; Ken writes in a paler gilt."),
    ("b-minimal", "B · Quiet minimal", "Flat graphite and system sans, a narrow column with space around it. Oxblood marks only what’s live; Ken in pale rose."),
    ("c-paper", "C · Paper", "Warm off-white with ink type: Charter to read, sans for controls. Red marks what’s live; Ken’s verdict reads like a red-brown pen note."),
    ("d-matte", "D · Matte dark", "Today’s crimson on red-black without the gloss, glass, dither or rain, and a size larger. Crimson for live; Ken in pale rose instead of teal."),
]
SCREENS = [("home", "Home"), ("chat", "Kleio chat"), ("code", "Code")]

heads = "\n".join(f'    <header class="dir"><h2>{name}</h2><p>{line}</p></header>' for _, name, line in DIRS)
rows = []
for key, label in SCREENS:
    rows.append(f'    <div class="screen">{label}</div>')
    for d, name, _ in DIRS:
        short = name.split(" · ")[0]
        rows.append(
            f'    <figure><a href="{d}/{key}.html"><img src="shots/{d}-{key}.png" width="1024" height="720" '
            f'alt="Direction {short}, {label} screen" loading="lazy"></a>'
            f'<figcaption><a href="{d}/{key}.html">Live page</a> · <a href="shots/{d}-{key}.png">Full-size PNG</a></figcaption></figure>'
        )
rows_html = "\n".join(rows)
html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kleio desktop: four visual directions</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    padding: 28px 28px 40px;
    background: #e3e1dc;
    color: #1d1c1a;
    font: 14px/1.45 system-ui, -apple-system, "Helvetica Neue", sans-serif;
  }}
  h1 {{ margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }}
  .lede {{ margin: 6px 0 24px; max-width: 820px; color: #4a4843; }}
  .grid {{ display: grid; grid-template-columns: 76px repeat(4, minmax(0, 1fr)); gap: 14px 16px; align-items: start; }}
  .dir h2 {{ margin: 0; font-size: 14px; font-weight: 650; }}
  .dir p {{ margin: 3px 0 0; font-size: 12.5px; color: #4a4843; }}
  .screen {{
    align-self: center;
    font-size: 11.5px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #4a4843;
  }}
  figure {{ margin: 0; }}
  figure img {{
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }}
  figure a:focus-visible {{ outline: 2px solid #1d1c1a; outline-offset: 3px; border-radius: 6px; }}
  figcaption {{ margin-top: 5px; font-size: 11.5px; color: #4a4843; }}
  figcaption a {{ color: inherit; }}
</style>
</head>
<body>
  <h1>Kleio desktop: four visual directions</h1>
  <p class="lede">The same three screens and copy in every direction, at the app’s default 1024×720 window, screenshotted in WebKit. The Code screen is caught mid-run, the way the app works: the transcript holds only the conversation, and the last three tool calls and the activity bar sit pinned above the composer. All content is made up. Click a screenshot to open the live mockup; the Code page animates and its ⋯ menu opens.</p>
  <main class="grid">
    <div aria-hidden="true"></div>
{heads}
{rows_html}
  </main>
</body>
</html>
"""
(ROOT / "index.html").write_text(html)
print("wrote", ROOT / "index.html")
