# Existing voice UI — isolated baseline

2026-11-05. Plan steps 1–3; source discovery and isolated rendering explicitly approved in chat. All new files remain under `mockups/voice/before`. No app startup or source edits.

## Provenance and scope

`source-hashes.json` records SHA-256 hashes of every copied visual source and selected original preview/state references. `source/` contains byte-for-byte snapshots. `bundle-inputs.json` records actual build inputs. Installed esbuild and React dependencies compile only this isolated entry, not the app. VoiceMode, VoiceOrb, HomeDither/Dither, ShowPanel/ShowViews, Markdown, VoiceGuide/Modal, focus/FLIP helpers and relevant styles remain unchanged. Source attribution comments are retained.

Global CSS order is App.css → glass.css → kleio-theme.css, with the guide's session-help.css and Markdown highlighting bundled as imported. Desktop platform class is macOS, zoom 1. The real baseline uses system sans, not the later unified preview's response font. Caption computed size/line height: 19px/27.55px at both widths. Do not apply proposed typography to the before reference.

Substitutions in `fixtures.ts`: voiceCall is an in-memory store; partial captions empty; audio levels null (source orb's mood-driven fallback); home-background returns its default enabled value without storage; voice readiness returns true; briefing, agent, external browser and viewer actions are inert. Viewer buttons stay rendered, but Full size intentionally opens nothing. getShowPart supplies synthetic local Markdown or canvas-generated PNG bytes, never host content. Fake errors reproduce source callError strings; they do not report actual permissions, account or network tests. The notice and states index are harness-only, not application chrome.

No microphone, Web Speech, audio, WebRTC, host API, backend, persistence, new external runtime resource or app launch. CSP prohibits connections and media. Capture tests additionally reject unexpected requests and throw if fetch, WebSocket, RTCPeerConnection, microphone or storage APIs run. This is a visual baseline, not verification of production voice behavior.

## Links

- Live local source baseline: http://127.0.0.1:4792/
- State links and both-width captures: http://127.0.0.1:4792/states.html
- Speaking: http://127.0.0.1:4792/speaking-1680.png and http://127.0.0.1:4792/speaking-1024.png
- Settled connecting: http://127.0.0.1:4792/connecting-settled-1680.png and http://127.0.0.1:4792/connecting-settled-1024.png
- Guide bottom: http://127.0.0.1:4792/guide-bottom-1680.png and http://127.0.0.1:4792/guide-bottom-1024.png

The earlier unified Home button, composer microphone and decorative wake state are entry-point references only, not this conversation baseline.

## Rendered evidence

46 captures: 23 scenarios × 1680×1000 and 1024×1000 CSS pixels in installed Chromium, device scale 1, reduced motion. Six supplementary captures show settled connecting, guide scrolled to bottom, and speaking with motion preference enabled at both widths. All 46 primary captures inspected in 12 contact sheets; all six supplementary captures inspected individually. Files are immutable: capture scripts refuse existing paths. The initial connecting-1680 capture caught the canvas before its first painted frame; use connecting-settled-1680 for the settled baseline. Preserve both.

Source-rendered with synthetic state: connecting, listening, thinking with user caption, speaking with response caption, muted, ended, long rolling caption; microphone denied, missing/rejected key, no credit, upstream unreachable, forbidden device, host offline/outdated and generic failure; shown Markdown/image/PDF/web, shown loading/failure; guide top/bottom. Idle removes the voice surface and was asserted rather than represented as a fabricated Home screen.

Not independently rendered: full-size file viewer (inert by approval), every possible host-supplied error string, WebGL failure fallback, every shown-content error subtype, native window decorations, actual app return/chat persistence, measured audio responsiveness. No separate interruption, ending-in-progress or no-speech visual phase exists in the inspected VoiceMode phase mapping. A new explicit treatment for these would be proposed behavior, not an existing screen. Microphone unavailable has no separate specific callError copy; it falls into a generic error unless another recognized error applies. Production interruption and silence handling are not validated by this harness.

## Assessment from the rendered baseline

Strengths: instantly recognizable voice-call composition; stable bottom controls with text labels; clear mute/unmute change; readable short captions on a dark panel; a natural two-column arrangement for shown content; useful recovery text and Talk again after failures. The real guide covers capabilities and limits rather than only decoration.

Weaknesses: the large orb and dotted red background dominate while useful conversational content occupies a small low strip. Listening leaves much of the window empty. Long captions discard their beginning and visibly fade the top line, so context cannot be reviewed in this screen. Error recovery uses the same visually dominant orb despite different user tasks. In this isolated Chromium render the guide has substantial visual interference from the underlying voice surface; this is an observed rendering issue here, not a claim about every production engine. Small upper-right icons compete with the dense background. Muted retains the red scene despite the grey orb.

## Verification and limitations

PASS: 46 primary captures without page errors, unexpected requests, horizontal page overflow or forbidden integration calls; mute, hang-up, Talk again and Escape checks at both widths; source hashes unchanged. PASS: six supplementary captures and computed caption typography at both widths. Installed WebKit executable is absent; none installed. Screenshot capture with a motion preference does not prove audio-reactive motion. Contrast, exhaustive keyboard/focus and future mockup cancellation checks belong to step 7; not claimed here.

Re-running capture/build scripts intentionally refuses existing immutable outputs. Use a newly named capture script/output for additional evidence, never overwrite before captures. Server is bound to 127.0.0.1 and serves only this baseline folder.
