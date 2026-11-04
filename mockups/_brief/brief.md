# Kleio desktop mockups: shared brief

Static HTML/CSS mockups of **Kleio**, a macOS desktop app that puts chat, code and
"specialist" agents in one window. The agents run on the user's own host Mac (a
Mac mini named `studio-mini`). Four visual directions are built in parallel from
this one brief so they can be compared side by side. **Content, structure and
copy are fixed here; the visual treatment is your direction's.**

## Files (inside your direction folder, e.g. `mockups/b-minimal/`)
- `home.html`, `chat.html`, `code.html`: one screen each.
- `style.css`: shared by the three pages.
- `assets/kleio-mark.png`: the real Kleio logo, already copied in. A white glyph
  (a classical "K" under a scrolled capital) on transparent, 381×360. Don't edit
  the file. Recolour it with CSS if you need to: `mask` (e.g.
  `-webkit-mask: url(assets/kleio-mark.png) center / contain no-repeat;
  mask: ...; background: <colour>`, with `aspect-ratio: 381 / 360`), or
  `filter: brightness(0)` for black ink.
- Don't create or change anything outside your folder (screenshots for your own
  checks go in `mockups/_review/<your-folder>/`).

## Hard rules
- Plain HTML + CSS only: no JavaScript, frameworks, CDNs or network URLs of any
  kind, no web fonts, no emoji, no icon fonts, and no images except the logo.
  Icons are inline SVG (see below).
- Every page starts with `<!doctype html>`, `<html lang="en">`,
  `<meta charset="utf-8">` (without it, typographic characters like the em dash
  and ellipsis render as garbage), a `<title>`, and `<link rel="stylesheet" href="style.css">`.
- Fonts: macOS system fonts only, via `font-family` stacks. Installed here:
  `system-ui`/`-apple-system` (SF Pro), `ui-serif` (New York), `ui-monospace`
  (SF Mono), "Iowan Old Style", Charter, "Hoefler Text", Baskerville,
  "Big Caslon", Didot, "Bodoni 72", Athelas, Cochin, Palatino, Georgia, Optima,
  "Avenir Next", Avenir, Seravek, "Gill Sans", Futura, "Helvetica Neue", Menlo.
  `ui-serif`/`ui-monospace` work in WebKit (Safari and the app) but not Chrome,
  so always follow them with a named font and a generic family, e.g.
  `ui-monospace, Menlo, monospace`.
- **The page is the window**: `html, body { margin: 0; width: 1024px;
  height: 720px; overflow: hidden; }`. Everything fits in 1024×720 with no
  scrollbars and nothing cut off by accident. Transcripts: make the transcript
  region `overflow: hidden` and bottom-anchored (flex column,
  `justify-content: flex-end`) so the newest message sits just above the composer
  and older content slides under the header, as if scrolled to the latest
  message. Make the top edge look natural.
- **One accent colour per direction**, defined once as `--accent` (tints and
  shades of that same hue are fine). Everything else is neutral. No second hue
  anywhere: no green "success", amber "warning", teal, blue links, or red errors
  (unless red is your accent). Diffs mark added lines with the accent (tinted
  background or gutter) and removed lines in neutral (dimmed, struck through or
  greyed). Status dots, test results, toggles and focus rings are accent or
  neutral.
- No glow, gloss, glass or blur (`backdrop-filter`), shine gradients, noise or
  dither textures, animated backgrounds, or Matrix-style rain.
- **Window controls**: the app uses a macOS overlay title bar, so draw the three
  traffic-light circles yourself at the top-left of every screen: 12px circles
  with centres at x = 26, 46, 66 and y = 19 (top 13px; left 20, 40, 60px). Draw
  them in a neutral grey, as macOS shows an unfocused window, so they add no
  colours. Keep the top-left 80×38px clear of other UI.
- **Content**: use exactly the copy below. It's made up. You may tighten a line
  that truly doesn't fit, but don't invent new personal details, and don't read
  anything from the machine (no `~/.gg`, no real sessions or memories).
- Accessibility basics: real `<button>` elements, `aria-label` on icon-only
  buttons, body text contrast at least 4.5:1, UI glyphs and large text at least 3:1.

## Screen 1: Home (`home.html`)
The hub. Every other screen's Back returns here. Calm and centred, not a dashboard.
1. **Connection status**: a small pill (it's a button that opens Connection
   settings) with a status dot and "Connected to studio-mini". Top row, right of
   the window controls, or top-centre.
2. **Logo**: `assets/kleio-mark.png` with the wordmark "KLEIO" under it. The
   current app sets it in Didot with wide letter-spacing (~0.3em); restyle with
   system fonts if your direction wants.
3. **Tagline**: "Talk to your work: chat, code and specialists in one app."
4. **Three destinations**, equal size, in this order: **Kleio** (sparkle icon,
   the primary one), **Code** (code icon), **Specialists** (three-circles icon).
5. **Talk to Kleio**: the voice action (waveform icon), quieter than the three,
   with its shortcut "⌘⇧B" shown subtly.
6. **Settings**: icon-only button (sliders icon, `aria-label="Settings"`),
   top-right or bottom-right.
7. **Version** "v2.1.3": tiny, in a bottom corner.
Nothing else: no recents, stats or background art.

## Screen 2: Kleio chat (`chat.html`)
**Header**, one row starting right of the window controls: Back (chevron +
"Back"), the title "Kleio" with a quiet subtitle "Lisbon offsite", then
right-aligned: New (plus icon + "New") and one overflow button (⋯,
`aria-label="More"`). The overflow stays closed on this screen.

**Transcript** (newest at the bottom, above the composer). Timestamps are
optional and quiet.
1. **You**, 9:12: "We've got the Lisbon offsite on the 14th. Can you work out
   what's still open? Flights are booked."
2. **Kleio**, 9:12
   - Activity lines (small, muted, one per line, with icon):
     `Searched your notes for “offsite”` (search icon) and
     `Read your calendar, Nov 10–16` (calendar icon).
   - Reply, styled as rendered markdown:
     > Flights are done. Here's what's still open for Lisbon (Nov 14–16):
     >
     > **This week**
     > - Book dinner for 12 on the 14th. Taberna do Largo only holds tables over 10 with a €100 deposit.
     > - Send the agenda draft to Priya. She asked for it by Wednesday.
     >
     > **Next week**
     > - Arrange a transfer for the three people landing after 22:00 (Marta, Joel and Sam).
     > - Print the workshop cards. You ordered 40 last time.
     >
     > Want me to draft the note to Priya now?
3. **You**, 9:14: "Yes. Keep it short, and say the workshop moved to Saturday morning."
4. **Kleio**, 9:14
   - "Here's a draft:"
   - An email card: `To: Priya Nair` and `Subject: Lisbon agenda (draft)`, then
     the body: "Hi Priya, here's the draft agenda for Lisbon. One change: the
     workshop is now Saturday, 10:00–12:30, which frees Friday afternoon for
     travel. Happy to adjust anything before Wednesday. Alex"
   - Two option buttons under the card: **Send from Gmail** (primary) and
     **Make it warmer** (secondary).

**Composer** (bottom): a text field showing the placeholder "Ask anything…",
attach (paperclip, `aria-label="Attach files"`), dictate (mic,
`aria-label="Dictate"`), and send (arrow up, `aria-label="Send"`). A small meta
row with "Thinking: medium", "Claude Sonnet 4.5" and context "12%".

## Screen 3: Code workspace (`code.html`)
**Header: exactly four things and nothing else**: Back (chevron + "Back"), the
project name "pantry", New (plus icon + "New"), and ONE overflow button (⋯,
`aria-label="More"`). No branch, badges or other buttons in the header.

**Show the overflow menu open.** Build it as `<details class="..." open>` with
the ⋯ button as its `<summary>` (hide the default marker with
`summary { list-style: none } summary::-webkit-details-marker { display: none }`),
so it's plain HTML and still toggles. Anchor it under the ⋯ button at the right
edge, about 240px wide and compact. It may overlap the right side of the
transcript but must not cover the composer. Items, in order, in four groups with
separators:
- Notes (notes icon) · Tasks (tasks icon) with "2 open"
- Autopilot (play-circle icon) with a small switch showing Off · Radio (radio
  icon) "Off" · Window layout (layout icon)
- `/commit` (commit icon), set in mono, with the hint "3 files changed"
- Help & shortcuts (help icon) · "Level 7 · 1,240 XP" (bolt icon) with a thin
  progress bar at 62%

**Transcript** (newest at the bottom):
1. **You**, 10:41: "The shopping list doubles items when two recipes share an
   ingredient: 2 onions + 1 onion shows as two rows. Merge them."
2. **Kleio**, 10:41
   - "I'll check how the list is built."
   - Tool row, collapsed: Read `src/list/buildList.ts`, "62 lines" (file icon).
   - Tool row, collapsed: Search `"key"` in `src/list`, "4 matches" (search icon).
   - Text: "Rows are keyed by `recipeId:name`, so the same ingredient from two
     recipes never meets. I'll key by normalised name and unit, and sum the
     quantities."
   - Tool row, expanded: Edit `src/list/buildList.ts` (pencil icon), "+7 −1",
     with this diff in mono (line number, sign, code):
     ```
     32     for (const item of recipe.items) {
     33 -     const key = `${recipe.id}:${item.name}`;
     33 +     const key = `${normalise(item.name)}|${item.unit ?? ""}`;
     34 +     const existing = rows.get(key);
     35 +     if (existing) {
     36 +       existing.qty += item.qty;
     37 +       existing.from.push(recipe.title);
     38 +       continue;
     39 +     }
     40       rows.set(key, { ...item, from: [recipe.title] });
     ```
   - Tool row: Run `pnpm vitest run src/list` (terminal icon), result
     "15 passed (1 new)" with a check icon in the accent.
   - Final text: "Fixed. Items with the same name and unit now merge into one
     row and list the recipes they came from. Different units stay separate, so
     200 g butter and 2 tbsp butter aren't added together. I added a test for
     the two-onion case."
   - A small muted line under the reply: "Worked for 1m 12s".

**Composer**: placeholder "Describe a change, or ask about pantry…", attach,
dictate, send. Meta row: on the left "main · 3 changed" (branch icon; the only
place branch info appears), on the right "Thinking: high", "Claude Sonnet 4.5"
and context "34%".

## Icons
Inline SVG: `viewBox="0 0 24 24" fill="none" stroke="currentColor"
stroke-linecap="round" stroke-linejoin="round"`, `aria-hidden="true"`. Set
`stroke-width` in CSS for your direction (1.25–2). Use these shapes, or draw
equivalents in the same spirit:
- back `<path d="M15 18l-6-6 6-6"/>`
- plus `<path d="M12 5v14M5 12h14"/>`
- more `<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>`
- sparkle `<path d="M12 3c.8 5.2 3.8 8.2 9 9-5.2.8-8.2 3.8-9 9-.8-5.2-3.8-8.2-9-9 5.2-.8 8.2-3.8 9-9z"/>`
- code `<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>`
- specialists `<circle cx="12" cy="7.5" r="3.5"/><circle cx="6.5" cy="16.5" r="3.5"/><circle cx="17.5" cy="16.5" r="3.5"/>`
- waveform `<path d="M4 10v4M8 6.5v11M12 3.5v17M16 7.5v9M20 10.5v3"/>`
- settings (sliders) `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`
- attach `<path d="M20.5 11.5l-8.3 8.3a5.3 5.3 0 0 1-7.5-7.5l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9"/>`
- mic `<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>`
- send `<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>`
- check `<path d="M5 12.5l4.5 4.5L19 7.5"/>`
- file `<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M13.5 3v5.5H19"/>`
- search `<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`
- pencil `<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14.5 6l3 3"/>`
- terminal `<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>`
- calendar `<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`
- mail `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>`
- notes `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3.5"/>`
- tasks `<path d="M4 6.5l1.5 1.5 3-3M4 12.5l1.5 1.5 3-3M4 18.5l1.5 1.5 3-3M12 7h8M12 13h8M12 19h8"/>`
- play-circle `<circle cx="12" cy="12" r="9"/><path d="M10.2 8.8v6.4l5.3-3.2z"/>`
- radio `<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7.5 8l9-4"/><circle cx="15.5" cy="14" r="2.5"/><path d="M6.5 12.5h4M6.5 15.5h4"/>`
- layout `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M12 12h9"/>`
- commit `<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>`
- help `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.1-2.5 3.6"/><path d="M12 17.2v.1"/>`
- bolt `<path d="M13 2.5L4.5 13.5H11L10 21.5l8.5-11H12z"/>`
- branch `<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="7.5" r="2"/><path d="M6.5 7.5v9M17.5 9.5c0 3.5-2.5 5-6 5-2.5 0-4 .8-5 2"/>`

## Reference (read-only)
To see what exists today you may read, but never edit:
`gg-app/src/kleio/KleioHome.tsx`, `gg-app/src/WorkspaceHeader.tsx`,
`gg-app/src/WorkspaceHeaderActions.tsx`, `gg-app/src/Composer.tsx`,
`gg-app/src/AppFooter.tsx` and `gg-app/src/kleio/kleio-theme.css` (the current
dark-red tokens).

## Self-check (before you finish)
A local server serves `mockups/` at `http://127.0.0.1:4791/`. Screenshot your
pages in WebKit, the app's engine (it renders offscreen; no window appears):

    mockups/_tools/snap http://127.0.0.1:4791/<folder>/home.html mockups/_review/<folder>/home.png \
                        http://127.0.0.1:4791/<folder>/chat.html mockups/_review/<folder>/chat.png \
                        http://127.0.0.1:4791/<folder>/code.html mockups/_review/<folder>/code.png

It writes 2048×1440 PNGs and prints one JSON line per page. `"scroll"` must be
`[1024,720]`. `"broken"`, `"errors"`, `"outside"` and `"external"` must be empty.
`"cutX"` lists elements whose text is cut off horizontally; it must be empty or
contain only clipping you did on purpose. Then open each PNG and look closely:
alignment, spacing, overlaps, truncated or wrapped text, contrast, and only one
accent hue. Fix and re-shoot until every screen is clean.

## Parked

- Remove Ken from gg-app. The mentor is @help (Kleio's help, consults another
  AI). Prefer a display-layer rename (labels, colours, handle) over deleting
  upstream Ken code, to keep sync/upstream merges clean. Do it on its own branch
  with tests, not in a design session.
