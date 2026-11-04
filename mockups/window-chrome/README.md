# Window chrome — selected baseline

Variant **A** in `index.html` is the locked, selected window-chrome baseline:
every control visible, quieted. The terminal control stays in the toolbar;
no removal was requested.

Variants B and C are preserved as comparisons only, not selected designs.
B folds Notes, Tasks, radio and terminal into its open overflow menu.
C merges the toolbar into the title bar.

## Selected composer and bottom controls

Composer variant **1 (inline)** and its refinements in `composer-refined.html`
are locked as selected. Preserve the docked tray, all controls, terminal,
gilt @help, rectangular background-task border, bounded Enhance button,
and slim context bar. The bottom layout and appearance are selected as shown.

`composer-variants.html` preserves all three composer arrangements as comparisons.
The original `index.html` and its B/C comparisons remain historical chrome studies;
their earlier “composer alternatives have not been explored” caption predates
this selection. Do not regenerate them to apply the refined selection.

## Thinking-label palette exceptions

Only the complete “Thinking <mode>” label uses these explicit exceptions:

| Level | Color | Hex |
| --- | --- | --- |
| low | grey | `#a69c9d` |
| medium | red | `#f07880` |
| high | flat yellow, not gilt | `#e8df70` |
| xhigh | blue | `#8eb8f0` |
| max | purple | `#c4a0ed` |

Gold/gilt remains exclusive to @help. Outside these thinking-label exceptions,
crimson remains restricted to Stop/send; locked palette semantics still apply.
The five levels are supported by the local Opus 5.5 registry and thinking-level
tests. Initial display is low. Intended production click sequence is
low → medium → high → xhigh → max → low, updating the whole label color.
This wraparound is a design decision, **not implemented behavior**: the page
is static HTML/CSS, and the state samples are not extra interactive controls.

## Selected top-control interaction treatment

Title-bar and toolbar actions use lapis `#94a2c4` on pointer hover and keyboard
focus, with a clear 2px lapis focus outline. SVG icons inherit the control color;
the specialist count follows the same state. Native traffic lights and gilt
@help are unchanged. No idle animation, glow, blur, gloss, or pills.

The thinking orb is a frozen frame of the supplied Libraries.dev “Thinking…”
reference, embedded as a CSS mask. `orb-reference.png` records the source page;
`thinking-orb-frame.png` preserves the captured frame. No runtime library or
model behavior is implemented.

## Verification evidence

Reused unchanged-render verification at 1680px and 1024px: state screenshots
were inspected and layouts fit. Actual pointer hover and keyboard Tab focus
were verified on Specialists, title collapse, Back, Architect, Autopilot, New,
Notes, Tasks, Radio, Terminal, /commit, and Help, including SVG stroke colors.
`selected-hover-*.png` and `selected-focus-*.png` record the selected treatment.
`composer-*.png` record the earlier arrangement comparisons.

Thinking-label contrast is at least 5.69:1; lapis state contrast is at least
6.08:1 against the tested surfaces, including bloom peak `#431419`.
Existing text and gilt-stop checks remain at least 4.74:1.

## Approved whole-body More and Branch preview

Approved selection: full-width composer replacement panels; More contains only
Checklist and Project Health; Branch retains Changes, Pull requests, Issues,
Open on GitHub and scrollable changes; the trigger row stays inside the bottom
of the container; no tool-call tray appears in any of the three samples.
This approval covers the static design, not implemented runtime behavior.

Earlier arrangements are superseded: panels above the dock, footer triggers,
and panels wedged into the text column between input controls are rejected.
The `panels-*`, `replacement-*`, and `polished-*` screenshots record those
historical iterations, not the approved layout.

`panels-preview.html` and scoped `panels-preview.css` follow the whole-composer
structure of the supplied 17:51 More/Branch references without adopting their
branding, colors or effects. Three labeled static samples show default, More
open and Branch open. The default text-entry body is copied unchanged from
`composer-refined.html`, including attach, gilt @help, Enhance, mic and send.
Those controls and text entry are absent only from the open-panel bodies.

Each open view spans the full composer width: compact header with close and
Escape affordances, panel content, and a persistent bottom trigger row inside
the same container. More has exactly two equal actions, Checklist and Project
Health. Branch has a branch heading and illustrative uncommitted count, three
left-aligned tabs, GitHub at right, and 18 representative files in a bounded
216px-tall native scrolling region. No invented metrics or live status claims.

More and Branch triggers share the same bottom position in all three samples;
none are duplicated in the external footer. Equal-height desktop windows and
a flexible transcript let the dock grow upward, leaving the bottom row fixed.
Header, content and triggers use consistent 16px side padding. The selected
upper chrome, transcript, activity and external status markup remain unchanged.
The docked tool-call tray is now removed from all three samples in this preview
only, explicitly overriding the earlier tray-preservation requirement here.
The shared activity/composer container remains; its activity line begins at
the top with no empty tray space. Window height is reduced by the removed
132px tray height (920px → 788px), preserving the aligned bottom trigger rows
without converting the removed tray into additional blank transcript space.
Terminal and all default composer controls remain unchanged. Locked styles
and prior comparison pages are untouched.

`no-tray-1680.png` and `no-tray-1024.png` were inspected after removal. Checks
passed for no tray remnants, no gap above activity, no clipping and equal
bottom-row anchors. Transcript, chrome, activity, composer/panel and status
markup were verified unchanged. The user has approved this no-tray design.

Intended behavior only: selecting a trigger replaces the whole composer body;
close, Escape or the active trigger returns to text entry with its draft
preserved. Selecting the other trigger switches views. None of those actions,
tabs, navigation or return behaviors is implemented. Only native file-list
scrolling works. Usage and Model remain out of scope.

`whole-body-{1680,1024}.png`, `whole-body-{more,branch}-states-{1680,1024}.png`
and `whole-body-scroll-{1680,1024}.png` were inspected. At both widths, full
composer-width panels, equal bottom anchors, no clipping and real pointer-wheel
list scrolling without trigger-row movement passed. All 14 panel/trigger
controls passed actual pointer hover and keyboard Tab focus, including both
close controls and inherited SVG strokes. New text contrast is at least
5.81:1 on tested surfaces including `#431419`; unchanged content retains prior
contrast verification. Existing verification is reused for these unchanged visuals.
Approval is recorded here; preview captions and captured screenshots retain
their pre-approval wording rather than changing the verified visuals.

The page reuses `../code-transcript/final.css`. All existing locked styles
remain unchanged. This is a static HTML/CSS mockup, not app implementation.

Run `python3 mockups/window-chrome/build.py` from the repository root to
regenerate the HTML. `comparison.png` shows the selected baseline and comparisons.
