# Hairline instrument — implementation handoff

Selected on 5 November 2026 as Kleio's voice orb. This describes the mockup in this folder so it can be built in the app; nothing has been implemented yet. Where this text and the code disagree, the code wins:

- `motion.mjs`: every timing, envelope and per-state pose.
- `shader.glsl.js`: geometry, depths, stroke weights, colours and the glass core.
- `hud.js`: the renderer (WebGL2 setup, cross-fades, rotation continuity, resizing, page visibility, context loss).
- `Orb.tsx`: React wrapper. It takes the existing orb's `mood`, `reducedMotion` and `className` props but ignores `levels`, which the real component must read (see Not verified).

Preview: `hud.html?demo=1` loops connecting → listening → thinking → speaking; `hud.html?state=<name>` shows one state. `?demo`, `?frame`, `window.hud` and `window.baseline` are mockup-only inspection hooks; don't port them.

## The instrument

It uses the existing orb's 380 × 380 px box. Warm-white hairlines (#F7F0E8), 0.6–2.2 px wide, sit around a smoked-glass core. Each layer is at its own depth, so the slow drift gives real parallax. From the outside in:

| Layer | Radius | Detail |
|---|---|---|
| Bezel (furthest back) | 167–177 px | Ticks every 2.5°, longer majors every 30°, outer hairline |
| Segmented arcs | 160 px | Seven fixed arcs, bold (2.2 px) and fine (1 px) |
| Dotted track (nearest) | 146 px | 90 dots (1.7 px), every 15th larger (2.6 px) |
| Primary ring | 129 px | 1.3 px ring; cardinal indices and brackets just outside |
| Echo trace | 124 px | Follows the speaking trace 0.16 s late |
| Inner track | 117 px | Carries the cursor (connecting, thinking) and the listening trace |
| Glass core | 81 px | Near-black smoked glass with a Fresnel rim, a soft reflected light strip, the primary ring reflected near its rim, and a fine reticle seen through refraction |

Lit strokes carry a faint crimson-tinted glow (#FFA39E), never a fill.

## States

The orb takes the voice screen's existing `mood` and `reducedMotion`, like the existing orb; there are no new states. In the baseline fixtures, these reach the orb as other moods:

- Every failure (failed, denied, no key, bad key, no credit, unreachable, forbidden, offline, outdated) arrives as `ended`.
- Shown content arrives as `listening`.
- A long caption arrives as `speaking`.

Brightness figures are relative to the fully lit instrument.

**Connecting** (62%, no drift)
- The instrument builds on over 2 s. Each layer draws clockwise from 12 o'clock, staggered from the outside in (bezel, arcs, dots, primary ring); the bezel and primary ring lead with a brief bright write-head. The core fades in last.
- From 1.6 s the inner-track cursor fades in. From 2.1 s it steps clockwise between the cardinals: a 0.45 s move every 1.2 s, smeared only while moving. It repeats until the state changes.

**Listening** (92%)
- The instrument is still apart from the drift: yaw up to 1.6° over about 17 s and pitch up to 1.15° over about 22 s, so the layers slide slightly against each other.
- The person's voice shows as a fine trace on the inner track (up to about 1.7 px deflection) and clears when they stop. The preview fakes a short utterance of about 2.5 s every 6.5 s.

**Thinking** (80%, half drift)
- Every 3.2 s the three ring layers index counterclockwise by fixed detents, staggered:
  - arcs 24° (0–0.9 s)
  - dots 12° (0.3–1.15 s)
  - bezel 17.8° (0.55–1.5 s)
- They then hold until the next cycle.
- The cursor goes the other way: one eighth-turn clockwise per cycle, moving for 0.75 s.
- Nothing spins continuously. The rings stay where thinking leaves them when the next state starts.

**Speaking** (100%, 0.6 drift)
- The primary ring becomes an oscilloscope trace following the voice, with up to about 4.4 px deflection. The echo trace just inside repeats it 0.16 s later, up to about 3.3 px. The preview uses a fixed 6.8 s phrase of eight syllables with rests.
- Bold arcs lengthen by up to 32%, and the ring's glow rises with the voice.

**Muted**: hairlines turn grey (#B3B5BD), the glow turns grey (#9EA1AB) and loses 60%, and the instrument drops to about a third of full brightness. It is completely still and keeps its ring positions.

**Ended**: the outer structure retracts to a dim ghost at about half brightness. On top of that, each layer drops to a share of its normal level: the bezel to 18%, the arcs and dots to 10%, the primary ring to 55% and the indices to 30%. The glass core stays. It is still.

**Failed**: identical to ended, because every failure reaches the orb as `ended`. Both show the CALL ENDED status and Talk again; only the existing error message, announced as an alert, tells them apart. A distinct failed look would need a new mood from the voice screen; none is designed.

**Idle** (in the orb's moods but produced by no baseline fixture): behaves like listening at 75% brightness.

Between states, brightness, build-on, mute colour and retraction cross-fade over about 0.4 s; the voice traces follow within about 0.1 s. Muted and ended stop redrawing once settled. The clock pauses while the page is hidden.

## Reduced motion

When `reducedMotion` is true, each state is one still pose, drawn once:

- Connecting: fully built, cursor at 12 o'clock.
- Listening: no drift and no voice trace.
- Thinking: rings at their first detent, cursor at 45°.
- Speaking: a frozen trace at 55% of full deflection (echo 45%), arcs lengthened about 18%.
- Muted, ended, failed: unchanged, since they're already still.

State changes switch instantly instead of cross-fading, and the orb responds at once if the preference changes during a call. The existing captions and controls still state each mood in text. The existing background reads the preference only when it mounts; that is unchanged.

## Rendering

- One WebGL2 canvas sits over the existing background. It is transparent and sized to the orb box at the device pixel ratio, capped at 2: 380 × 380 at 1×, 760 × 760 at 2×.
- One fragment shader (GLSL ES 3.00) draws everything analytically per pixel over a single triangle. A perspective camera ray meets each layer at its own depth, which gives true parallax. There are no textures, meshes or post-processing passes.
- The shader anti-aliases lines itself: they are box-filtered with screen-space derivatives and their widths are set in CSS pixels, so weights hold at 1× and 2×. The context's own antialiasing is off.
- Each frame, JavaScript computes the pose (`motion.mjs`), sets 20 uniforms and skips the draw when nothing changed. It handles resizing, page visibility, and WebGL context loss and restore.
- The shader needs WebGL2 because it uses GLSL ES 3.00 features: built-in `fwidth`, a constant array initialiser and `transpose`. A WebGL1 port would need `OES_standard_derivatives` and rewrites of the other two.
- WebGL2 isn't a new requirement. The existing orb and the voice background render with three.js 0.186 through @react-three/fiber, and that three.js only creates WebGL2 contexts; both drew through WebGL2 in the Chromium preview. The "WebGL2 unavailable" text the mockup puts in the orb box is a placeholder, not product behaviour.

## Proposed fallback (not built)

Switch to it when WebGL2 can't start, the shader fails to compile, or a lost context isn't restored within about a second. Don't keep retrying WebGL.

VoiceMode already wraps the orb in an error boundary (`OrbBoundary`) that swaps in a plain CSS disc (`voice-orb-fallback`) if the orb throws. Keep that as the last resort, but catch WebGL failures inside the new orb and draw the version below, so the instrument stays recognisable.

- Draw the same instrument flat in Canvas 2D or SVG, in the same box so nothing moves. Include the bezel ticks, segmented arcs, dotted track, primary ring with indices and inner track. Draw the core as a dark disc with a soft radial gradient and a thin rim. Leave out the parallax, refraction and reflections.
- Show the reduced-motion pose for every state, with the same colour rules: warm white, grey when muted, retracted ghost for ended and failed. These poses are already a designed, legible version of every state.
- Optional motion, only when reduced motion is off: the thinking detents and the connecting build-on translate well to SVG. Rotate whole layer groups with the same easing and holds, and draw on with `stroke-dashoffset`. The voice traces don't translate; keep them static.
- Log the failure; don't show users a message.

## Performance observed

Measured in headless Chromium with a software GPU (SwiftShader) on this Mac. Absolute rates reflect software rendering, and GPU timing wasn't available. This is not a benchmark.

- The page ran at the same frame rate with either orb: about 14 frames/s at 1680 × 1000. With the HUD orb it ran at 22 frames/s at 1024 × 1000. The background dominated: it renders 1.68 million pixels at 1680 × 1000 and draws twice per frame.
- The orb redraws every frame while listening, thinking or speaking, because the drift never settles. Connecting redraws about 60% of frames. Muted and ended draw nothing once settled.
- The orb canvas is 0.14 million pixels at 1× and 0.58 million at 2×, about a third of the background's pixels on a 2× display. Its shader is fairly heavy per pixel: refraction, plus every layer evaluated for every pixel.
- The animation loop keeps running when nothing changes; it recomputes the pose and then skips drawing. In the app, stop the loop when settled or in reduced motion, and restart it on a state or level change.
- `preserveDrawingBuffer` is on only so the mockup checks can read pixels; turn it off.
- If it's heavy on real hardware, try these: limit the orb to 30 frames/s while listening (the drift is slow), drop the drift when the window isn't focused, or cap the pixel ratio at 1.5.

## Not verified

- Only Chromium was tested. The app runs in Tauri, so it will render in WebKit on macOS, WebView2 on Windows and WebKitGTK on Linux. Playwright's WebKit isn't installed here. Check WebGL2, shader compilation and hairline weights in those webviews first; WebKitGTK is the most likely to need the fallback.
- There is no real audio. VoiceMode already passes `levels={callLevels}` to the orb: a function read every frame that returns `{ in, out }` from 0 to 1, or null where it isn't measured (`OrbLevels` in the baseline's VoiceOrb.tsx). The mockup's wrapper ignores it, and the fixtures return nulls. Drive the inner-track trace from `in` and the speaking trace from `out`, smoothed. If `in` is null, keep the inner track quiet rather than imitating input; if `out` is null, the fixed phrase envelope is an acceptable stand-in, as the existing orb also imitates.
- Real GPU cost and battery use haven't been measured.
- Screen readers weren't tested. The orb is decorative (`aria-hidden`); the existing status line announces state changes (`aria-live="polite"`) and the error text is an alert (`role="alert"`), both unchanged.
