# Hairline instrument — orb study (awaiting verdict)

Final exploratory pass, 5 November 2026. One orb-only study inside the unchanged faithful baseline (`../before/`). Only the orb is replaced; layout, captions, typography, controls, background and the hands-free state model come from the baseline. Ruby, Eclipse, Filament, the three instrument studies, Conversation Table and the approved previews are untouched (SHA-256 checked: 1,732 pre-existing mockup files).

- Animated preview: http://127.0.0.1:4794/voice/hud-study/hud.html?demo=1 — loops connecting → listening → thinking → speaking. Any click or key hands control to the existing fixtures and controls.
- States, screenshots, recordings: http://127.0.0.1:4794/voice/hud-study/

## References (direction only)

Motion was confirmed before design: each iStock preview played in Chrome (A 14.4 s, B 15.0 s, C 10.0 s). Frames of the watermarked previews were sampled every 0.1 s into a temporary folder for analysis and deleted afterwards. None is stored here or used by the study.

- A — https://www.istockphoto.com/video/gm1226288940-361265146 — layered cyan rings build on, then a flash and smoke-ring transition into a white version.
- B — https://www.istockphoto.com/en/video/gm2262589531-675371419 — dark teal targeting display; assembles in about 4 s, then nearly still while small accents step.
- C — https://www.istockphoto.com/en/video/gm1290717184-386044787 — white hairline circle on black; arcs grow in, then segmented outer arcs move slowly around a still core with cardinal indices.

Adapted: monochrome hairlines with a strict weight hierarchy (C); staggered clockwise build-on with a brief write-head highlight (A, C); long stillness with small stepped accents (B); counter-indexed layers (C).
Not adopted: cyan/teal palette, flash, smoke ring, lens streaks, crosshairs or targeting, side widgets, data readouts, labels, continuous spinning.

## Design

Warm-white hairlines (crimson-tinted bloom, grey when muted) at four depths: 2.5°/30° bezel graduations, bold and fine segmented arcs, a dotted track, the primary ring with cardinal indices, and an inner track. A smoked-glass core reflects the primary ring near its rim and shows a fine reticle through refraction. Rendered by one WebGL2 fragment shader: per-layer perspective planes give real parallax; strokes are box-filtered analytically in CSS pixels, so weights hold at 1× and 2×.

## Motion by existing state

- Connecting: layers draw on clockwise from 12 o'clock in a staggered 2 s build, then an index cursor steps between the cardinals (dimmed, as the baseline dims this state).
- Listening: quiet. Shallow parallax only (≤1.6°); a fine trace on the inner track appears only while the simulated person speaks (one utterance per 6.5 s), then clears.
- Thinking: rings index by detents in counter-directions and hold (3.2 s cycle, moves ≤1.5 s); the cursor steps by eighths, smeared only in transit. Indexed positions persist into the next state.
- Speaking: the primary ring becomes an oscilloscope trace following a fixed 6.8 s phrase envelope with rests; a delayed echo trace sits just inside; bold arcs lengthen slightly.
- Muted: grey and still. Ended/failed: outer structure retracts to a dim ghost; still.
- Reduced motion: a static, state-specific pose for every state (no build, indexing, trace motion or parallax); state changes apply instantly. Live preference changes stop the orb. The page pauses when hidden.

## Isolation

Files live only in this directory. `build.mjs` bundles the read-only `../before/source` snapshot and fixtures with installed esbuild, swapping only `VoiceOrb` for `Orb.tsx`; it refuses gg-app or gg-framework inputs and writes a new bundle directory each time. The active bundle is `bundle-v4/`; earlier bundles and `verification-1/` (failed settle check) and `verification-2/` (superseded build) are kept, not active. No dependency installs, microphone, audio, network services, storage, production edits or app startup.

In git: source, checks, `bundle-v4/` and three screenshots in `screenshots/`. The superseded bundles, `verification-*/`, `inspection/` and recordings are git-ignored local evidence.

## Verification (final run: verification-3/)

- `node --test mockups/voice/hud-study/motion.test.mjs` — 6/6 pass.
- `node mockups/voice/hud-study/hud.check.mjs verification-<new-name>` — pass in Chromium at 1680×1000 and 1024×1000:
  - all 22 baseline fixture states: surrounding UI boxes, typography, text, labels and orb box identical to the baseline; no horizontal overflow;
  - reduced motion static in every state; muted/ended settle and stop with motion on;
  - connecting, listening, thinking and speaking advance a live clock, redraw, and render distinct ordered frames;
  - Mute/Unmute (click and Space), guide + Escape, Hang up, Talk again, Escape to close; a control cancels the preview loop;
  - rotation continuity from thinking to speaking; hidden-page pause; canvas follows device pixel ratio;
  - no page errors, WebGL validation errors or non-local requests; all 1,732 earlier files unchanged.
- Inspected: full-page screenshots at both sizes, ordered motion sheets, reduced-motion sheets, 2× detail crops, and frames from 25 fps real-time recordings of the looping preview.

## Limitations

WebGL2 is required; without it the orb box says "WebGL2 unavailable" rather than substituting another visual. Hairlines are crisper on 2× displays than 1×. Listening input and speech are deterministic simulations; a real build would drive them from the existing call levels. Chromium only; recordings are not a performance benchmark.

Awaiting the user's verdict; no further development.
