# @help — approved 03 Fine frame

Approved by the user on 5 November 2026, for mockup design only.

- Use a subtle one-pixel antique-gold frame (`rgb(184 151 90 / 0.26)`),
  six-pixel corners and the existing warm `--help-plate` surface for the
  helper's prompt handoff, replacing the full-height vertical gold rule.
- Match “Sent to KLEIO” to that frame, surface and corner treatment, with
  antique-gold text and a gold sent tick (`--help`, `#b8975a`).
- Other completion ticks remain green (`--done`, `#66b48c`).
- Preserve the existing helper identity, copy, controls and static behavior.
  The selected preview keeps helper gilt text still and retains a visible
  keyboard-focus outline on Send to KLEIO.

This approves the helper treatment only, NOT the older whole-window chrome
or tool tray shown in its contextual preview. Those surroundings are reference
context, not a new or renewed baseline approval. No new helper capability,
application integration or behavior is authorized.

Selected files: `help-frame-window.html` and `help-frame-window.css`.
The preview imports the unchanged `final.css`; `final.html` is also unchanged.
Unused `help-variations.html` / `.css` are not part of this approval commit.

Preserve approved Session `2c8f426e`, Model picker `2f2bd5ce`, Usage popover
`8539e11c`, and original plan-mode layout with gold titles and outlined
gold/red actions `fb3bd946`. The rejected plan-review redesign remains rejected.
Historical studies, internal identifiers and the separate Help button are unchanged.

## Verification reused

No preview code changed during approval recording. Reuse this session's
passing Chromium checks:

- Whole-window preview at 1680px and 1024px: original window markup preserved,
  fine frame applied, keyboard focus visible, no horizontal overflow or page errors.
- Matching sent treatment at both widths: prompt and sent confirmation share
  border, radius and surface; sent copy unchanged; no overflow or page errors.
- Final tick change: computed sent tick is `rgb(184, 151, 90)`; tool completion
  tick remains `rgb(102, 180, 140)`.

Earlier temporary screenshots predate the final sent treatment, so none are
retained as final approval evidence in this commit. No browser checks were rerun
solely for these notes. Playwright WebKit was unavailable during this session;
these checks used Chromium.

Preview: http://127.0.0.1:4791/code-transcript/help-frame-window.html
