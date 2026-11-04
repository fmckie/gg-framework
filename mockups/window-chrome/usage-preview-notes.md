# Usage popover — approved interactive mockup

## Approval — 5 November 2026

Approved for mockup design only, including percentage-based context meter colors.
Baseline: approved Session `2c8f426e` and Model picker `2f2bd5ce`.
Their source files remain unchanged; this study reuses their styles and scripts.
No application integration, live measurements, pricing or billing is implemented.

Open `usage-preview.html#conversation` or `#empty`, then click the existing
Context button. A small anchored popover opens above it without replacing the
composer or moving either bottom control row. It contains only Usage, current
conversation context percentage, a slim meter, close, and the illustrative-data
label. Weekly usage, spending, Project Health, gamification and duplicate controls
are excluded from the popover. Existing selected window chrome is unchanged.

Context means occupied model context for the current conversation, not cumulative
usage or a billing period. Defaults are illustrative 19% for the conversation and
0% for the empty sample. Both the popover and Context mini meter use the same
solid fill color: hue varies continuously from green through yellow to red with
the percentage. There is no full-spectrum gradient. Numeric percentages remain
visible; this palette exception is limited to the two context meter fills.

Escape, close and Context toggle dismiss and return focus to Context. Outside
pointer dismissal does not redirect focus away from the clicked control. The
non-modal dialog has an accessible name, description and meter; opening focuses
close, and keyboard navigation can leave without a focus trap. Escape dismisses
Usage before an underlying Model/More/Branch view. Drafts, attachment references
and Model/thinking behavior are preserved locally, not across reloads. More
still contains only Checklist and Project Health; the tool-call tray stays removed.

## Verification reused for approval

The latest passing `node mockups/window-chrome/usage-preview.check.mjs` run is
reused; no code changed during approval preparation. Only these notes were added.
The check runs the approved Model regression suite against the Usage page,
including thinking colors/transitions and reduced motion, then tests Usage at
1680px and 1024px in conversation and empty states (4/4 flows).

Passed: all dismissal paths, keyboard focus, outside-click focus retention,
draft/files, Model coexistence, fixed bottom anchors, overflow and browser errors.
Illustrative 10%, 50% and 95% checks passed at both widths (6/6 color samples),
with matching solid meter fills and visible numbers. Defaults were restored.
Screenshots were inspected at both widths for progression, clipping, anchoring
and focus states. Relevant `usage-checks/usage-*.png` captures accompany approval;
regenerated Model regression captures remain separate, uncommitted artifacts.
