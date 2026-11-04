# Plan mode — approved refinements

Approved by the user on 5 November 2026. This decision supersedes the historical
color descriptions in `final.css` without changing the original layout.

- Retain the original `final.html` / `final.css` design, content, inline review
  bar, tool tray, pending/approved samples and static mockup behavior.
- Rename “Your plan” to “Plan review”: 28px, weight 600, existing antique-gold
  `--help` token. Keep the original carved face, tracking and shadow.
- “Plan mode” uses the same gold; its original 24px size and weight 400 remain.
- Approve has gold text and outline on a transparent background. Hover alone
  fills it gold with dark text.
- Reject has red text and outline on a transparent background. The outline red
  mixes the existing crimson and ink tokens for readable text. Hover alone
  fills it crimson with light text.
- No new glow, animation, controls or application workflows are approved.

The separate inline-plan enhancement and document redesign were rejected, not
approved. Their preview files and generated captures were removed separately;
they are not part of this decision or commit. Application implementation remains
parked. Approved Session `2c8f426e`, Model `2f2bd5ce` and Usage `8539e11c` are
unchanged.

## Verification and captures

Reuse the passing Chromium checks from this conversation; no code changed after
those checks. Both 1680px and 1024px were checked for title styling, outlined idle
states, hover-only fills, stable button dimensions and feedback → Reject →
Approve keyboard order. Gold titles have 6.74:1 contrast on the base background
and 5.63:1 on the brightest bloom. Both button labels pass 4.5:1 in idle and hover
states. Screenshots were inspected at both widths.

Committed final-state evidence in `title-checks/`:

- `final-1680.png` and `final-1024.png`: full pending window with gold titles and
  outlined actions, captured from the unchanged verified mockup.
- `outlined-idle-{1680,1024}.png`: idle action row.
- `outlined-reject-hover-{1680,1024}.png`: red Reject fill on hover.
- `outlined-approve-hover-{1680,1024}.png`: gold Approve fill on hover.

Earlier title-only and always-filled-button captures are superseded and excluded
from this commit, as are all unrelated window-chrome captures.

Preview: http://127.0.0.1:4791/plan-mode/final.html
