# iPhone screen audit harness (throwaway, git-ignored)

Audits how the app's screens look and fit on an iPhone, against the desktop. It
drives the REAL app from this worktree's Vite dev server, in headless Chromium,
behind a fake Tauri shell with made-up data.

- Dev server (already running, leave it alone): `http://127.0.0.1:54708/`
- Run a script from `gg-app/`: `node dev/iphone-audit/<area>/<file>.mjs`
- Phone: 393x852, 3x, touch, iPhone user agent. The app then tags `<html>` with
  `platform-ios` itself (`src/platform.ts`). Never add that class by hand.
- Desktop reference: 1440x900 (`platform-macos`).
- Output: `<repo>/.gg/screenshots/iphone-audit/<area>/<screen>--phone.png`,
  `--desktop.png`, `--phone.json`, `--desktop.json`, `--compare.txt`
  (a scrolling screen also gets `--phone-2.png`, `-3.png` … of its main scroller).

## Files

- `lib.mjs`      `both`, `withApp`, `compare`, `enterSession`, `closeBrowser`, `base`
- `base.mjs`     made-up command replies (`responses`), the made-up host (`hostData`,
                 `defaultApi`), and `cast` = `src/kleio/castFixtures.ts`
- `measure.mjs`  what is measured in the page
- `smoke.mjs`    a working example (home, then a fresh code session)

Do NOT edit these four: four audits share them at once. Put your scenes and any
extra made-up data in your own folder, `dev/iphone-audit/<area>/`. If the
harness is wrong for your screen, work around it in your own file and say so.

## Writing a scene

```js
import { both, closeBrowser, enterSession, base } from "../lib.mjs";

await both(
  {
    area: "lists",                       // output folder
    responses: { agent_goals: { goals: [/* made-up */] } },   // Tauri command → reply
    // invoke: (cmd, args) => reply | undefined,              // computed replies
    // api: ({ method, path, body, session }) => ({ status: 200, body }) | undefined,  // host routes (the kleio_api command)
    // data: { blobs: base.cast.castRoster(26) },             // replaces parts of base.hostData()
    // storage: { key: "value" },                             // localStorage before the app loads
    // now: base.cast.CAST_NOW,                               // freeze Date.now()
  },
  async (app) => {
    // Runs twice: as the phone, then as the desktop. Branch on app.isPhone.
    await app.tap(app.page.getByRole("button", { name: "Goals", exact: true }));
    await app.settle(600);
    await app.capture("goals-empty");    // screenshot(s) + measurements + printed summary
  },
);
await closeBrowser();
```

`app`: `page` (Playwright), `device`, `isPhone`, `tap(locatorOrSelector)` (tap on
the phone, click on the desktop), `emit(type, data)` (an agent event, as the
shell forwards it from the sidecar: `run_start`, `text_delta`, `tool_call_start`,
`subagent_state` …), `emitEvent(name, payload)` (any other Tauri event),
`calls()` (every command the app invoked), `settle(ms)`,
`capture(screen, { scroll, note, element })`.

`both` compares each screen captured on both devices and prints
"desktop controls not on the phone", order and variant differences.
Use `withApp("phone", scene, fn)` for a phone-only state.

A command with no made-up reply resolves to `null`; a host route with none
answers 404. Both are listed in the summary ("no made-up reply"): if a screen
is empty or broken because of one, add the reply. The data shapes are in
`src/agent.ts`, `src/kleio/kleioApi.ts`, and in each page's `*.test.tsx`
(their `mockIPC` handlers show exactly what a page reads).
Scripts under `gg-app/scripts/` (`check-phone-composer.mjs`,
`capture-screenshots.mjs`) show working event sequences for a run.

## What each record holds (`--phone.json`)

- `controls[]`: every visible control in visual order: `name`, `el` (tag.classes),
  `variant` (btn-primary, btn-ghost, icon-only …), `x y w h`, `hit` (its tap area
  when a pseudo-element or label widens it), `small` (tap area under 44x44),
  `covered` (what sits on top of its centre), `clipped`, `lines` (label wrapped),
  `spill` (label outside its box), `group`, `disabled`.
- `overlaps[]`, `unreachable[]` (below the screen with no scroller to reach it),
  `coveredAtEnd[]` (still covered when the main scroller is at its end).
- `page.sideways`, `pastEdge[]`, `clippedX[]`, `hScrollers[]`.
- `truncated[]`: text ellipsised, clamped or cut.
- `hints[]`: `kbd`, shortcut symbols and desktop words ("click", "drag", "Browse" …)
  in text, placeholders, titles.
- `hoverOnly[]`: elements hidden until `:hover`. `ruleApplies: false` means the
  reveal rule is switched off here (it is under `html:not(.platform-ios)`), so
  nothing ever shows it on the phone.
- `pointerRows[]`, `scrollers[]`, `errors[]`, `unknownCommands[]`, `unknownRoutes[]`.

Measurements are leads, not verdicts. A title's `⌘` hint is never shown on
touch; a deliberately clamped preview is not a defect. Look at the screenshot.

## Background you need

The phone is meant to be "the same app as the desktop, just smaller". Rules the
redesign shares are under `html:root`; a rule with `:hover` stays under
`html:not(.platform-ios)` (a tap leaves iOS's hover stuck on); what the phone's
width, touch and keyboard force is in `src/kleio/kleio-phone.css` under
`html.platform-ios` (loaded last). That file's own header promises: safe areas,
no hover, 44px targets, inputs at 16px+, wide rows wrap, columns stack, panels
fill the width. `src/kleio/kleio-phone.test.tsx` and
`src/kleio/kleio-phone.scope.test.tsx` state more of the intent.

## Rules for this audit

1. AUDIT ONLY. Change no tracked file. Fix nothing. Write only inside
   `gg-app/dev/iphone-audit/<your area>/` and `.gg/screenshots/iphone-audit/<your area>/`.
   At the end run, from the repo root,
   `git status --short | diff - /tmp/iphone-audit-status-before.txt` and report
   that it printed nothing.
2. Do not start, stop or restart any server; do not kill processes by name; do
   not install, build, test, lint, commit or stash anything.
3. Made-up data only. Never read `~/.gg`, `~/.kleio` or any real host.
4. Keep your screenshots under about 40 MB (`du -sh` your folder).
5. Chromium is not the phone's WebKit: do not judge safe areas, the on-screen
   keyboard, fonts or scrolling feel. List them under "Needs device check".
6. A state you could not reach is listed as not audited, with why. Never guess.

## What to hand back: `.gg/screenshots/iphone-audit/<area>/FINDINGS.md`

```
# <Area>: iPhone audit findings

## <screen> — <state>
Shots: <phone png>, <desktop png>
- [Buttons] <defect in one line>. Measured: <number from the JSON>. Cause: `path/file.css:LINE` `<selector> { <declaration> }`. Fix: <one line>.
- [Fit] …
- [Desktop-only] …
- [Missing] …
(or: No defects found.)

## Shared causes
- `path/file.css:LINE` <rule> → <screens it breaks>

## Needs device check
- <screen>: <what only the real phone can confirm>

## Not audited
- <screen or state>: <why>
```

The five kinds, buttons first:
- **Buttons**: wrong order against the desktop, wrong variant, clipped or
  overlapping boxes, wrapped or spilling labels, every control under 44x44.
- **Fit**: page wider than 393, elements past an edge, fixed widths, text cut
  off or ellipsised where it matters.
- **Desktop-only**: `⌘`/Ctrl hints that are SHOWN, Browse-style pickers, "click"
  wording, controls that only appear on `:hover`.
- **Missing**: controls the desktop shows that the phone does not, or that
  cannot be reached there. Say whether it looks deliberate (cite the rule).
- **Device**: listed, not judged.

Every defect needs (a) a number from the JSON or something you saw in a
screenshot you opened, and (b) the rule or component responsible as
`file:line`, confirmed by reading that line. Drop any defect you cannot show.
Where one rule causes the same defect on many screens, say so once under
"Shared causes" instead of repeating it.
