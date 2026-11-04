#!/usr/bin/env python3
"""Writes each direction's home/chat/code.html (shared markup, icons inlined) and
style.css (base layout + the direction's skin). Usage: build.py [folder ...]"""
import pathlib, re, sys

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
DIRECTIONS = {
    "a-classical": "A · Classical editorial",
    "b-minimal": "B · Quiet minimal",
    "c-paper": "C · Paper",
    "d-matte": "D · Matte dark",
}
ICONS = {
    "back": '<path d="M15 18l-6-6 6-6"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "more": '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    "sparkle": '<path d="M12 3c.8 5.2 3.8 8.2 9 9-5.2.8-8.2 3.8-9 9-.8-5.2-3.8-8.2-9-9 5.2-.8 8.2-3.8 9-9z"/>',
    "code": '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>',
    "specialists": '<circle cx="12" cy="7.5" r="3.5"/><circle cx="6.5" cy="16.5" r="3.5"/><circle cx="17.5" cy="16.5" r="3.5"/>',
    "waveform": '<path d="M4 10v4M8 6.5v11M12 3.5v17M16 7.5v9M20 10.5v3"/>',
    "settings": '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    "attach": '<path d="M20.5 11.5l-8.3 8.3a5.3 5.3 0 0 1-7.5-7.5l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9"/>',
    "mic": '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    "send": '<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "file": '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M13.5 3v5.5H19"/>',
    "search": '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    "pencil": '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14.5 6l3 3"/>',
    "terminal": '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
    "calendar": '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
    "notes": '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3.5"/>',
    "tasks": '<path d="M4 6.5l1.5 1.5 3-3M4 12.5l1.5 1.5 3-3M4 18.5l1.5 1.5 3-3M12 7h8M12 13h8M12 19h8"/>',
    "play": '<circle cx="12" cy="12" r="9"/><path d="M10.2 8.8v6.4l5.3-3.2z"/>',
    "radio": '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7.5 8l9-4"/><circle cx="15.5" cy="14" r="2.5"/><path d="M6.5 12.5h4M6.5 15.5h4"/>',
    "layout": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M12 12h9"/>',
    "commit": '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
    "help": '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.1-2.5 3.6"/><path d="M12 17.2v.1"/>',
    "bolt": '<path d="M13 2.5L4.5 13.5H11L10 21.5l8.5-11H12z"/>',
    "branch": '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="7.5" r="2"/><path d="M6.5 7.5v9M17.5 9.5c0 3.5-2.5 5-6 5-2.5 0-4 .8-5 2"/>',
    "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    "chevron": '<path d="M6 9.5l6 6 6-6"/>',
    "orb": '<circle cx="12" cy="4" r="1.9" fill="currentColor" stroke="none" opacity="1"/><circle cx="6.34" cy="6.34" r="1.9" fill="currentColor" stroke="none" opacity="0.86"/><circle cx="4" cy="12" r="1.9" fill="currentColor" stroke="none" opacity="0.72"/><circle cx="6.34" cy="17.66" r="1.9" fill="currentColor" stroke="none" opacity="0.58"/><circle cx="12" cy="20" r="1.9" fill="currentColor" stroke="none" opacity="0.46"/><circle cx="17.66" cy="17.66" r="1.9" fill="currentColor" stroke="none" opacity="0.35"/><circle cx="20" cy="12" r="1.9" fill="currentColor" stroke="none" opacity="0.26"/><circle cx="17.66" cy="6.34" r="1.9" fill="currentColor" stroke="none" opacity="0.18"/>',
}

def icon(m):
    name = m.group(1)
    return (f'<svg class="i i-{name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')

def build(folder):
    out = ROOT / folder
    for page in ("home", "chat", "code"):
        html = (TOOLS / "templates" / f"{page}.html").read_text()
        html = re.sub(r"\{\{icon:([a-z]+)\}\}", icon, html).replace("{{DIRECTION}}", DIRECTIONS[folder])
        assert "{{" not in html, (folder, page)
        (out / f"{page}.html").write_text(html)
    base = (TOOLS / "templates" / "base.css").read_text()
    skin = (TOOLS / "skins" / f"{folder}.css").read_text()
    (out / "style.css").write_text(f"/* Kleio mockup, {DIRECTIONS[folder]}. Base layout, then this direction's look. */\n\n{base}\n{skin}")
    print("built", folder)

for folder in sys.argv[1:] or [f for f in DIRECTIONS if (TOOLS / "skins" / f"{f}.css").exists()]:
    build(folder)
