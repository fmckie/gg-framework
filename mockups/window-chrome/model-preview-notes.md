# Model picker — approved interactive mockup

## Approval — 5 November 2026

Approved for mockup design only, including the final thinking refinements.
The full-width Model panel opens from the existing model control and replaces
only the composer body, with both bottom control rows anchored. The approved
selection, cancellation, draft-preserving return, provider grouping, search and
reference billing-warning design below is retained.

Thinking uses the exact reference labels/order and grey/periwinkle/yellow/pink
palette. Selection is marked by fill, border, bold text and a checkmark; hover
and selection use restrained 160ms transitions with reduced-motion support.
The lower shared thinking control is text-only with a keyboard-focus outline.
All catalogue, availability, billing and model behavior remains illustrative.
This approval does not authorize application integration or changes to the
approved session/chrome baseline, authentication, real models or Usage.

The current passing 1680px/1024px verification and inspected screenshots are
reused for this approval commit. Only these decision notes changed after that
verification; no preview code or check logic changed during commit preparation.


Open `model-preview.html#conversation` or `#empty`; use the existing Kleio model
control in the bottom status row. No extra entry button or overlay. The panel
replaces the full composer body, grows upward, and leaves both bottom rows fixed.
Approved session, chrome, composer, More/Branch and WakeScreen source files are
unchanged. Chats remains toolbar-free. More has only Checklist and Project Health;
Branch is copied from the approved study. No tool-call tray or Usage workflow.

## Reference content

Settings screenshots show four connected providers: Anthropic, OpenAI, Tinfoil,
Ollama. This study groups 17 representative screenshot names under those providers;
it does not claim catalogue completeness, actual connection state or availability.
Disconnected providers are omitted. Settings would govern real availability.

The thinking order is exactly Off, Low, Medium, High, X-High, Max, Ultra. These
are reference labels, not verified per-model support. No capability filtering,
fallback inference or context-window claims are made. The user-requested reference
palette applies only to this mockup's thinking controls: Off/Low grey, Medium
periwinkle, High yellow, X-High/Max/Ultra pink. Native radios expose all seven
labels in order; the selected level has a tinted fill, colored 2px border, bold
label and checkmark. A separate offset lapis outline identifies keyboard focus.
The shared composer control now uses only the matching font color, with no
visible border, fill or hover shadow; its offset keyboard-focus outline remains.
The radio buttons transition background, border and color over 160ms ease-out,
without transforms, glow or geometry changes. Reduced motion disables transitions.
This supersedes the earlier mockup's reused thinking palette; approved baseline
styles outside this study are unchanged.
Billing multipliers/credit caveats are visibly labelled unverified reference copy.
Models without supplied billing information do not imply free usage.

## Local simulation

Search matches model and provider names, keeps provider groups and handles zero
results. Current model is pinned; the checked Current row differs from the bordered
candidate row and keyboard focus. Row activation stages a candidate. Arrow keys
move focus; Enter/Space stages it. Use model confirms without sending a message.
Relevant billing copy stays visible in the review strip before confirmation.

Thinking is one transactional setting: the panel selector previews the same
composer label, and the underlying composer thinking control is disabled while
Model is open. Confirm applies both; cancellation restores both. When closed,
the composer control cycles the exact reference order. No model-specific support
is asserted. Choosing the existing model with a changed level offers Apply thinking.

Close, Cancel, Escape and the active trigger cancel. Switching to More/Branch
also cancels pending model/thinking changes. Confirmation returns focus and saved
caret to the draft; cancellation returns focus to the invoking control. Draft DOM
and selected attachment files are retained across panel changes. File contents are
not read or uploaded. Drafts, file references and model choices are memory-only and
lost on reload; no persistence, authentication, integration or model calls exist.
All unrelated app actions and the copied Chats browser remain static.

## Verification

Run `node mockups/window-chrome/model-preview.check.mjs` with mockups served on
127.0.0.1:4791. The check exercises both conversation and empty samples at 1680px
and 1024px, including search/zero results, candidate vs current, confirmation,
Escape/Cancel/close/toggle, shared thinking rollback, More/Branch switching,
draft and local-file retention, native list scrolling, overflow, full panel width,
fixed bottom-row coordinates and keyboard focus. Captures use model-*.png names.

Verification passed at both preview widths for both samples (4/4 flows).
Candidate, scrolled-list and returned-composer screenshots were visually inspected:
no horizontal overflow or control collisions; full composer-width panels and fixed
bottom anchors. Additional open-state captures show provider headings and Current.
The automated check also asserts restored caret position after confirmation.
No production tests apply: all changes and verification artifacts are in mockups.

Thinking-palette verification: both 1680px and 1024px pass all seven levels,
radio keyboard navigation, selection/confirmation/cancellation, composer cycling,
shared state/color/fill/border parity and the existing draft/anchor regressions.
Measured normal/selected label contrast is at least 4.65:1. Selected borders and
separate focus outlines pass 3:1 against their tested surfaces. Selected High,
focused Medium/Ultra/Off and composer-focus rendered screenshots were inspected
across both sizes; labels remain readable, focus distinct, and no overflow occurs.
The colored radio row replaces the native dropdown only in this mockup; its
confirmation and rollback semantics and label order are unchanged.

Refinement verification: 1680px and 1024px pass the existing interaction/draft/
anchor checks, all seven color/keyboard states, sampled hover-transition frames
with fixed dimensions and no transform/shadow, and reduced-motion interaction
with zero active thinking transitions. Composer text remains unfilled and without
a visible border or shadow even on hover; keyboard focus remains visible. Hover,
selected-hover, composer-focus and reduced-motion screenshots were inspected at
both sizes. Normal/selected label contrast remains at least 4.65:1; the tested
hover and text-only composer labels also exceed 4.5:1. The earlier fill/border
parity result is historical: only font color is now shared with the composer.
