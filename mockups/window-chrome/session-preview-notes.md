# Session preview — Direction 1 approved

The user approved this visual execution on 4 November 2026:
- Full-page Chats browser without the conversation toolbar.
- Chats / conversation title in the top window title bar, with no duplicate row.
- Empty-state WakeScreen with #ed7380 rain at 0.85 opacity, 20px bold (700)
  glyphs, current falling/typing motion, dark-wash trails, 160px overscan,
  soft bottom fade and protected invitation clearance.
- Decorative-rain-only palette exception; no glow or recoloring of other UI.
- Accessible static invitation, reduced-motion/no-JavaScript fallbacks and
  hidden/offscreen pausing retained.

Only the decorative WakeScreen runs. Session search, navigation and
unsent-draft/attachment persistence remain unimplemented. Native field editing,
scrolling, hover and focus do not constitute implemented session behavior.

Current behavior and visuals reuse the passing rain-tone-2 verification at
1680px/1024px; no rerender or behavior change was needed to record approval.
The current final verification captures are the session-wake-*.png files
produced by that run. These include full states, focus/hover, long titles,
animation frames, bottom-edge progression, peak stress and reduced motion.
The captures precede only the approval wording update in the preview heading.
Obsolete session-chromium-*, session-v2-*, session-webkit-* and
session-empty-focus-* captures are excluded from this approval commit.

This approval supersedes the historical awaiting-approval statuses below.
`session-preview.html` is a separate static session study with a scoped WakeScreen effect. Approved previews,
builders and locked CSS are unchanged. No sidebar or session dropdown.

References: the supplied 19:18:33 Chats browser, 19:18:40 conversation and
19:18:49 empty-state screenshots. Titles are readable editorial summaries of
reference excerpts, not a proposed automatic naming feature. Message counts
and relative dates are retained for the eleven illustrated rows; 21 is the
reference total, not a claim that all sessions are reproduced here. The long
reinforcement-learning title tests wrapping without clipping. Current-session
and Draft markers are illustrative, not inferred from the reference highlight.
Conversation copy is a shortened illustrative excerpt, not a complete history.

The Chats browser retains the window title bar but removes the conversation
toolbar. Its single New chat action now sits beside search in the browser header.
The conversation and empty states retain their conversation toolbar and single
New chat action. Chats / title replaces project and branch identity in the top
window title bar; there is no extra identity row above the transcript. Native
traffic-light samples and other title-bar actions remain in their existing order.
The title can wrap within its flexible space, with the same title bar growing in
height rather than clipping or colliding with actions. The browser project label
is illustrative kleio-projects; branch, usage and model labels are static samples.
The Chats browser occupies the body, with no composer. The empty state says Untitled chat,
has an empty native textarea and retains the approved composer controls and
More/Branch trigger row. Activity is idle rather than showing a running task;
context is zero in the empty sample. Shared composer styling is not changed.
More still contains only Checklist and Project Health; Branch remains approved.
Their open views are in the unchanged panels-preview.html. No tool-call tray.

## Intended behavior, not implemented

- Chats opens the full-page browser. Choosing a row resumes that session.
- Search filters session titles; the sample field does not filter anything.
- New chat starts an untitled session in the same project and window, without
  clearing the old conversation. It does not open a project or window.
- Starting fresh or switching sessions preserves each session's unsent text
  and attachments. Returning restores that session's draft. If preservation
  fails, remain in the current session rather than discard anything.
- More/Branch replace the composer body; close, Escape or the active trigger
  returns to the same draft, following the approved panel intention.

Only native scrolling, field editing, pointer hover, keyboard focus and the empty-state WakeScreen effect work.
No search, navigation, send, attachment handling or persistence is implemented.
Edits in these static fields disappear on reload. No new runtime dependencies.

## Historical iteration record

The following entries describe prior decisions and checks, not the current
approval status or final values. The approval above is authoritative.

## Initial visual checks — 4 November 2026 (before title-bar correction)

- Chromium screenshots inspected at 1680px and 1024px: all three states,
  readable wrapped long title, current/draft markers and centered empty state.
  Each sample window is 788px high. No horizontal overflow or clipped labels
  in the checked title, chrome, status, composer and search regions.
- Actual pointer hover and keyboard Tab focus verified in Chromium for search,
  session rows, all three New chat actions, both Chats identity controls and
  the empty composer. Lapis state colors and 2px focus outlines passed.
  Search/row focus, long-title hover and empty-input focus captures are saved
  as session-chromium-* and session-empty-focus-* screenshots.
- Native macOS WebKit screenshots inspected at both widths. Final full-page
  captures are session-webkit-full-{1680,1024}.png (2900px capture height):
  no outside elements, clipped horizontal text, broken assets, load errors or
  external requests. Earlier 2840px captures cropped only 5px of page padding;
  the full captures correct the capture boundary without altering the design.
- Playwright WebKit was unavailable; no browser/package was installed.
  Native WebKit supplied rendering evidence; interaction checks used Chromium.
- WCAG text contrast calculated for foreground palette and gilt's darkest
  stop against the page, window, brightest bloom, dock and hover surfaces:
  minimum 4.74:1. New session text, muted labels and lapis all exceed 4.5:1.
- Static checks pass: three states, exactly one New chat per state, no script,
  no tool-call tray. Native input accepts local text, without persistence.

Technical checks are not visual approval. Direction 1 remains selected;
this execution remains awaiting approval.

## Title-bar correction — historical verification

Only session-preview.html, session-preview.css and these notes are revised.
Browser conversation toolbar removed; search/New chat stay in its body header.
Conversation identity moved into the top title bar, replacing project/branch.
No additional identity row, sidebar, dropdown or session behavior is introduced.

At this earlier stage, the Matrix effect was blocked pending a permitted reference location. The mockup
HTML/CSS/JS search found no Matrix, code-rain, falling-glyph or canvas effect;
existing keyframes are blink, orb, shimmer and gilt. The brief explicitly excludes
Matrix rain, not an implementation reference. The supplied 19:18:49 screenshot
shows the desired visual motif but cannot establish motion timing or source.
No substitute effect or JavaScript has been invented. The requested animation
exception is acknowledged; when a reference is supplied it must remain subtle,
decorative, non-interactive, behind content, aria-hidden and still/absent with
prefers-reduced-motion. Brightest-effect contrast cannot be verified until then.

### Correction verification

Chromium checks pass at 1680px and 1024px. Inspected session-v2 screenshots
for all three states, both title-bar Chats focus states, a longer injected title,
and reduced-motion output. The stress-test title is only injected into the
browser for the capture, not substituted into the sample content. It wraps
inside the title bar with no horizontal overflow, clipped title text or action
collisions. Native lights and right-hand actions remain present; the separate
conversation toolbar is preserved. Chats browser has only its title bar plus
search/New chat in the browser heading. The list still scrolls intentionally.
Keyboard Tab produces the lapis focus outline on both title-bar Chats controls.
Reduced-motion inspection found zero running animations; no Matrix effect exists
to test yet. Current palette contrast, including the brightest existing bloom,
is at least 4.74:1. This does not certify a future Matrix effect's brightest frame.

This earlier verification predates the supplied public WakeScreen reference.

## WakeScreen adaptation — execution awaiting approval

User authorized standalone JavaScript only for this effect. Source is public
fmckie/gg-framework, revision 9a89e75c6a8ba4f1e372bbdd2b9ca87b1468c1af:
WakeScreen.tsx and its App.css rules. GitHub's license endpoint reports MIT;
the full copyright and permission notice is retained in session-wake-LICENSE.txt
and the script links that notice. No React, packages or source theme are imported.

The existing toolbar/title corrections are retained. Rain and typing appear only
in the new empty conversation. Rain uses the existing muted neutral token, capped
at 32% canvas opacity, and the reference's elliptical mask. No crimson rain.
It retains the 14px glyphs, 70ms rain steps, 55ms typing, 1400ms hold and 22ms
erasing cadence. The final invitation is “Talk to me. I’m listening.”
Canvas and visual typing are decorative, pointer-inert and aria-hidden. A static
heading supplies the same final invitation to assistive technology, without live
announcements. Without JavaScript/canvas the static heading stays visible.
Reduced motion, including a live preference change, hides rain/typing and shows
the final static invitation immediately. RAF and cursor animation pause when
hidden or offscreen; typing resumes without catching up through hidden time.
Search, navigation, send and draft/attachment persistence remain unimplemented.

### WakeScreen verification

Run `node mockups/window-chrome/session-wake.check.mjs` with the preview server
on localhost:4791. Chromium checks cover both 1680px and 1024px: all three states,
no title collisions or horizontal clipping, long title wrapping, pointer hover,
keyboard Tab focus, canvas changes and typing completion over elapsed time,
hidden-page pause/resume (visibility simulated in the browser), initial and live
reduced-motion preferences, and the no-JavaScript static fallback. Runtime and
console errors are collected and asserted empty. Live reduced-motion testing
caught a CSS specificity delay; media rules now hide animated text and reveal
the static heading immediately, independently of JavaScript's change event.

Saved session-wake-* screenshots include all states, title focus, list hover,
long-title stress, early/final animation, peak-brightness stress and reduced
motion at both widths. Peak stress paints a fully opaque neutral canvas beneath
the original 10% layer: these initial measurements are superseded below. The unaffected palette remains at least 4.74:1.
Decorative glyphs and cursor are not readable content and are aria-hidden.
No public-site/source calls are made by the preview; attribution is a local file.

Direction 1 remains selected; this visual execution still awaits approval.

## WakeScreen fidelity correction — awaiting approval

Canvas opacity restored to 32%, without changing glyph density, sizes, mask or
chat sequence. Trails now use the reference's 18% source-over dark wash rather
than destination-out erasing. Wash uses the approved neutral window background
#161213 instead of importing source theme colors. Typing uses independent
setTimeout delays: 450ms start, 55ms characters, 1400ms hold, 22ms erasing,
220ms between lines. Hidden/offscreen pauses preserve the outstanding timer's
remaining delay. Reduced-motion, static accessibility and no-JS fallbacks remain.
The subtitle alone is raised from muted to existing text-2 (#d3c9ca) for contrast
at full 32% opacity. Rain stays neutral and text glow stays absent deliberately;
color/glow still differ from the public source. No other session UI is changed.

Correction checks pass at 1680px and 1024px. The browser clock verifies all 94
visible typing/erasing changes against the reference timer schedule within 1ms,
including the initial delay, holds and between-line delay (not frame-rounded).
Existing animation-over-time, hidden pause/resume, reduced-motion/live preference,
no-JavaScript fallback, layout and browser-error assertions also pass. Final,
peak-brightness stress and reduced-motion screenshots were inspected at both
widths. At 32% peak rain over the brightest existing bloom, invitation/subtitle
contrast is at least 5.57:1; other text remains at least 4.74:1. Opacity is asserted
as 0.32 in the browser and was not reduced for contrast. The preview opens at
session-preview.html#empty for visual confirmation.

## Decorative red rain exception — awaiting approval

Explicit user-authorized palette exception: only the empty-conversation
WakeScreen rain glyphs now use vivid red #ff3045. This supersedes the neutral
rain choice above, not the palette rules for any other UI. The red is selected
for a clear saturated red hue against the approved oxblood surface. Canvas
opacity remains 32%; 18% neutral dark-wash fading, glyph alpha distribution,
density, font sizes, elliptical mask, animation and typing timings are unchanged.
Invitation, subtitle, cursor and all other UI retain their previous colors.
No glow is added. Reduced-motion and accessible/no-JavaScript fallbacks remain.
Locked CSS and other previews are untouched. Approval is still outstanding.

Verified at 1680px and 1024px: inspected early and settled animation screenshots;
glyphs read as saturated red rather than grey, with intentionally faint fading
trails under the preserved 32% layer. Browser checks confirm red canvas pixels,
unchanged invitation/subtitle/cursor colors, reduced motion and fallback behavior,
94 exact typing events, hidden pause/resume and no browser errors. Peak-brightness
contrast (opaque #ff3045 beneath 32% canvas opacity over the brightest bloom)
is 6.15:1 minimum for foreground invitation/subtitle text. No opacity, density,
mask or timing adjustments were made to achieve this result.

## Light-red visibility correction — awaiting approval

Read-only served diagnosis confirmed session-wake.js matched disk (SHA256
cd44841c3ea311492d9ffe2068cf173a23ae6d30feae03b077b8d161b5fc53a9).
Computed canvas opacity was 0.32 with 14px normal-weight glyphs; most glyphs
also had 0.55 draw alpha, before the fading mask. Canvas/ancestors had no filters
or non-normal blending and ancestors had opacity 1. Stale source was not found
in the inspected browser; low compounded opacity was the visibility problem.

This revision supersedes the earlier 32%/14px limits: #ff8792 light red, 95%
canvas opacity, 20px monospace, weight 700, full-alpha new glyphs. The 18%
dark wash, falling animation, typing schedule and outer elliptical mask remain.
A feathered transparent center in the rain mask keeps light glyphs away from the
unchanged invitation/subtitle. Their text colors, cursor, layout and all other
UI remain unchanged; no glow. Only the decorative rain has the palette exception.
The scoped CSS/script URLs carry v=light-red-1 to invalidate old assets, and the
preview is opened with the same query and #empty. Reduced motion and hidden-page
pausing remain. Locked styles are not modified.

Verification passed at 1680px and 1024px. Inspected actual rendered full-window
and 420×180 native-size close-up crops at two animation times, 700ms apart.
Fresh glyphs are visibly bold light red, with darker fading trails. Screenshot
pixel checks (after CSS opacity/masks/compositing, not merely canvas fillStyle)
found 613/940 light-red pixels respectively in the sampled frames. Current
computed canvas font is bold 20px and opacity is 0.95. The rain-free mask center
fully contains both foreground text bounds at both sizes: peak foreground
contrast is at least 9.59:1, without recoloring or glowing the text. Peak stress
screenshots intentionally fill the whole canvas with light red to check the mask;
that filled field is not the running effect. Reduced-motion, no-JS, hidden-page
pause/resume, all 94 typing events and no-browser-error assertions still pass.

## Rain boundary correction — awaiting approval

Served inspection at 1680/1024 found the rain viewport already filled the entire
1560×494 / 952×494 area from chrome bottom to dock top; it was not sized from
the invitation's 55px content box. The actual hard edge came from the 494px
canvas/overflow clip: the outer 80%-height ellipse still had opacity at its
bottom center. Drop reset began at the canvas bottom with no offscreen gutter.

The empty-state region is now explicitly padding-free and the invitation is
absolutely centered independently of its size. A separate background field fills
the entire toolbar-to-dock region. Its canvas extends 160px above and below,
with resets beyond the offscreen bottom and re-entry above the visible top.
A vertical edge mask fades the last 100px to zero before the bottom clip (and
first 60px at the top). The existing outer ellipse and protected text center
remain. Thus neither heads nor trails meet a visible rectangular cutoff.
Light red #ff8792, 95% opacity, 20px/700 glyphs, no glow, dark-wash trails,
falling/typing timings, foreground text and other session samples are unchanged.
Scoped asset URLs now use v=rain-boundary-1. Locked styles remain untouched.

Boundary verification passes at 1680px and 1024px. Browser geometry confirms the
field exactly spans the full background to dock top, with 160px canvas overscan
on each vertical edge. Instrumented draw coordinates confirm heads travel beyond
the visible bottom before reset. Inspected full-window frames and bottom-edge
close-ups across 700ms at both widths: trails fade smoothly before the former
cutoff, with no rain entering chrome/dock and no page overflow. Foreground bounds
remain entirely within the protected mask center; peak text contrast stays at
least 9.59:1. Light-red rendered-pixel checks, all 94 typing events, reduced
motion, no-JavaScript fallback, hidden pause/resume and browser-error checks pass.
This visual execution remains awaiting approval.

## Rain tone adjustment — awaiting approval

Requested exact changes: glyph color #ff8792 → #ed7380 and canvas opacity
0.95 → 0.85. Glyph size/weight, density, timing, trails, overscan, bottom fade,
invitation clearance and all other UI are unchanged. Locked styles untouched.
Scoped asset URLs now use v=rain-tone-2 for a cache-busted #empty preview.

Verified at 1680px and 1024px: running-animation frames and bottom-edge crops
remain visibly red with soft trails and no returning rectangular boundary.
The unchanged rendered-pixel visibility checks pass at both widths. Geometry,
overscan, reduced motion, hidden pause/resume, no-JS fallback, all 94 typing
events and browser-error checks pass. Foreground contrast remains at least
9.59:1 within the unchanged invitation clearance. Awaiting visual approval.
