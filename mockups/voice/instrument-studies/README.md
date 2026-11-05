# Instrument orb studies — rejected, preserved for reference

Workspace /Users/wmckie/gg-framework-ui, branch design/desktop-ui. Three independent studies inside the faithful source baseline, not a redesigned voice screen. Ruby, Eclipse and Filament are rejected and preserved unchanged in ../orb-studies/. Conversation Table is also rejected and remains separate. Earlier approval notes do not apply to these directions.

Open http://127.0.0.1:4794/voice/instrument-studies/ for the direct animated previews and individual state links. The existing loopback-only static server remains running. No app startup is required. The baseline remains at ../before/.

## Isolation

Only files under this new directory were written. The build reads the approved ../before/source snapshot, its existing fixtures, and installed dependencies. It replaces only VoiceOrb through an esbuild resolution plugin; there is no hidden original orb renderer. Layout, controls, type, background, captions, shown content and the hands-free state model come from the unchanged baseline. The existing small simulation notice identifies the concept. No extra product controls, panels, workflows or capabilities were added.

No live microphone, audio, speech APIs, persistence, external runtime requests, dependency installation, production source access or app startup. gg-app source and /Users/wmckie/gg-framework were not read or modified. Existing source assets, approved previews and previous experiments are read-only.

## Rendering and limitations

Reference and motion rationale: reference-notes.md. Three.js 0.186.1 custom geometry/shaders and local procedural studio lighting; no CSS substitute shapes or external rendering services. Field distortion is screen-space refraction, not path tracing. WebGL2 is required; failure explicitly reports renderer unavailability rather than silently substituting a different visual. OS reduced-motion preferences produce static state-specific orb poses. Existing baseline background behavior is unchanged, including its mount-time reduced-motion preference.

?demo=1 runs one deterministic fixture sequence then rests in listening. Any pointer/keyboard interaction cancels the sequence so existing controls retain authority. ?state= selects any existing fixture. ?frame= freezes the orb's mathematical simulation time for repeatable inspection. window.instrument.seek(t) is the local inspection hook, not a product control.

## Verification

- Motion tests: 4/4 pass.
- Chromium browser comparison: 132/132 pass (22 existing fixture states × three studies × two requested sizes: 1680×1000 and 1024×1000).
- Exact baseline bounds, typography, text and accessible labels outside the orb match; no horizontal overflow.
- 18 live/multi-frame motion sequences pass; bounded listening parallax, thinking holds, speaking response, static reduced-motion poses, live preference change, hidden-page pause and field texture resizing checked.
- Mute/unmute, keyboard activation, Hang up, Talk again, guide/Escape, call Escape/Close and demo cancellation pass.
- No browser errors, invalid WebGL operations or forbidden integration calls; all requests local.
- SHA-256 comparison confirms all 1,471 pre-existing mockup files unchanged, including approved previews, the faithful baseline and rejected studies.
- Screenshots at both sizes, ordered motion sheets, resting states, resize captures and sampled frames from six live recordings were visually inspected. Videos are 25fps recording outputs, not a hardware performance benchmark.

Evidence: verification-2/evidence.json; visual links: verification.html. In git: source, checks, bundle-v3/ and screenshots/. verification-*/, inspection/, references/, recordings and the superseded bundle/ and bundle-v2/ are git-ignored local files. Initial development captures and the failed test-harness attempt remain separate in inspection/ and verification-1/. The first full comparison attempt exposed a test race when switching media preferences before checking hidden-page pause; the test now waits for the preference to apply, without relaxing its assertion. The final run is verification-2. Browser engines other than Chromium and real voice integration are not validated.

Run the existing isolated checks with:

    node --test mockups/voice/instrument-studies/motion.test.mjs
    node mockups/voice/instrument-studies/compare.check.mjs verification-new-name

The comparison uses a fresh evidence directory and never replaces previous captures. Active previews reference bundle-v3/. A future build must choose a fresh output name with build.mjs and deliberately update the three HTML links; earlier render builds are retained, not active.

Rejected by the user on 5 November 2026; kept only as reference directions. No production implementation is approved.
