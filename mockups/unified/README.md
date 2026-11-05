# Unified approved preview

Preview: http://127.0.0.1:4791/unified/index.html

Mockup only; originals remain unchanged. No application integration.

## Source map

- Session/chrome `2c8f426e`: current title/toolbar, Chats, empty WakeScreen,
  conversation, composer, no tool tray. Session decision notes and the
  window-chrome README govern dimensions and anchored controls.
- Model/thinking `2f2bd5ce`: existing model-preview.js/css and More/Branch
  templates. More contains only Checklist and Project Health.
- Usage `8539e11c`: existing usage-preview.js/css; illustrative context only.
  The usage preview already consolidates these first three sources.
- Plan `fb3bd946`: only the original pending/approved transcript contents and
  final.css. Gold titles, outlined actions, sticky feedback/review bar retained.
  No older chrome, dock, tool tray, or rejected plan-review redesign imported.
- Help `6cf71f94`: only the approved transcript and Fine-frame CSS. Separate
  prompt/sent samples preserve the gold sent tick and green completion ticks.
- Home: wordmark/final.html records “Home, locked” and its chosen dome-C buttons
  and Bone 46px wordmark, linked from their final.css files. Its inline decision
  notes are the recorded selection. The original window and styles are reused
  in an isolated Home page, without session chrome or redesigned controls.

## Layout mapping and explicit decision

Code retains the approved session window height of 788px and original responsive
width (1560px at a 1680px viewport, 952px at 1024px). Home retains 1024×720.
Only one frame/state is shown; the preview selector and notices sit outside it.
Plan/help content scrolls inside the session transcript; the plan review bar
remains pinned to its foot. Composer controls and the status row stay anchored.

A read-only Chromium composition probe found a genuine conflict at both widths:
Model leaves a 60px plan transcript, of which the pinned actions occupy 56px.
The user selected separate preview states rather than shrinking content or
increasing window height: opening Model from pending review switches to the
regular Code-session sample. Return through the external selector; feedback,
scroll position, draft and attachment references remain in memory.

## Simulation boundary

Model search/selection/cancellation, thinking, More/Branch replacement panels,
Usage dismissal and local draft/attachment references use approved helpers.
State selection and current-session/Back/New-chat links are local preview
navigation only. Plan Approve/Reject and Send to KLEIO remain static, matching
their approved samples: select approved/sent externally. Other app controls,
Home destinations, historical chat rows, Checklist/Project Health destinations,
Branch actions, terminal, microphone and sending do not run application actions.
No model, pricing, billing, file upload, host connection or execution is real.
All drafts, feedback and file references are lost on reload.
The unified editable draft uses plaintext-only input so replacing an initial
@help mention cannot hide replacement text: a scoped text-fill rule also guards
against Chromium retaining inline mention styling during editing.

Build: `node mockups/unified/build.mjs`
Check: `node mockups/unified/preview.check.mjs`
Requires the existing mockup server at port 4791 and installed Playwright.
Checks and screenshots are confined to this directory.

## Final approval — 5 November 2026

The user approved the unified mockup with **Mukta Malar** for composer input
and response `.prose`, using the existing locally bundled Regular/Medium/
SemiBold/Bold fonts and SIL OFL in `fonts/mukta-malar/`. Source revision and
SHA-256 hashes are retained there. No CDN or UI library is required.

Only the family changes. Composer remains 15.5px / 400 / 23.25px;
response body 15px / 400 / 23.25px; response h3 17.55px / 700 / 27.2025px.
Existing weights within prose remain intact. Inline code stays monospace;
user bubbles, chrome, Home, carved plan titles and controls keep their fonts.
The font distribution has no italic face; italic styles use browser synthesis.

Also approved and retained:

- Red WakeScreen cursor `#ed7380`; original blink animation and reduced-motion
  static fallback unchanged.
- Plan mode / Plan review gold mixes its existing hue with 8% white, without
  changing title sizes or weights. Button gold, @help accents and sent tick stay
  at their original values.
- Existing Home, session chrome, Model, Usage, original plan layout, anchored
  controls and @help Fine frame, with the simulation boundaries above.

No original approved preview or application source is modified. Experiments
remain local and uncommitted; they are not runtime dependencies or approval
artifacts. The committed preview is `index.html`, not a font comparison page.

## Final verification

Run `node mockups/unified/approved.check.mjs` with the local mockup server on
port 4791. This runs the existing unified/Model interaction checks, then checks
all eight final default states at 1680px and 1024px. An in-memory baseline blocks
only the selected font stylesheet to compare metrics, colors, non-target font
families and frame/control geometry; no experiment files are required.

The check verifies locally rendered Mukta Malar glyphs, all four bundled weights,
no external runtime requests, no asset/page errors, wrapping/overflow, preserved
monospace, plan titles/actions and WakeScreen animation/reduced motion. Existing
interaction assertions cover keyboard/focus, drafts/files/feedback, scroll,
Model/thinking, More/Branch, Usage dismissal and plan-to-Model separation.

Representative final evidence is in `checks/final/`: eight states at each width,
plus scrolled Plan review and active WakeScreen. Redundant regression captures
are not selected for commit. All 16 state/width checks and the interaction suite pass; final screenshots
were inspected at both widths. Build output is reproducible and selected asset
hashes match their recorded sources. Verification is Chromium-only, not app/WebKit testing.
