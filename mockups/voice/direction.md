# Direction proposal — The Conversation Table

Status: proposed, awaiting explicit direction approval. 5 November 2026.

## One compositional thesis

Make the conversation—not the orb—the centre of gravity. Within the unchanged approved oxblood/bone window shell, place a calm, left-aligned conversation column beside a narrow voice-status rail. Use matte dark surfaces, bone text, precise rules and deliberate empty space instead of glass, gradients, dotted scenery or decorative waveforms. Premium character comes from proportion and material restraint, not enlarged type.

The rail names Kleio, the current state and the next available action. A small ruled progress indicator represents finite simulated response segments, never microphone amplitude. The main column retains speaker-labelled turns, with the newest response prominent through placement rather than oversized text. Shown content uses a clearly bounded adjacent reading area when present; at 1024px it becomes an inline transcript section rather than squeezing prose. No new sidebar navigation.

Bottom voice controls remain pinned: Mute/Unmute, contextual Interrupt, End conversation. Preserve the baseline's labelled controls and useful shown-content separation, while removing its dominant orb and context-losing rolling caption. A quiet visible notice always says “Simulated conversation · no microphone or services”. Simulation controls are clearly separate from product controls.

## Evidence and before references

- Source provenance, substitutions and limitations: `before/baseline-notes.md` and `before/source-hashes.json`.
- Live baseline: http://127.0.0.1:4792/
- State gallery: http://127.0.0.1:4792/states.html
- Speaking: http://127.0.0.1:4792/speaking-1680.png and http://127.0.0.1:4792/speaking-1024.png
- Settled connecting: http://127.0.0.1:4792/connecting-settled-1680.png

The source establishes two-way conversation, not just dictation. Rendered scenarios use synthetic call data; they do not establish working production microphone or service behavior. The proposed persistent transcript and explicit interruption/silence states are additions, not discoveries about the existing UI.

## Locked shell and type

Reuse approved unified/window-chrome assets read-only. Preserve title bar, control order, geometry, wrapping, toolbar hierarchy and approved families. Voice occupies the app body; do not redesign window chrome or retain an inactive composer under the voice controls. Returning to the local chat sample restores the approved composer geometry. Do not change Home.

Mukta Malar response prose stays 15px/400/23.25px; response h3 stays 17.55px/700/27.2025px. Composer input on return stays 15.5px/400/23.25px. User bubbles, chrome, controls, Home and monospace retain their approved families. No global font overrides. Confirm computed styles against the approved shell during implementation.

## State mapping

“Observed” below means source-rendered using fixtures, not a live call. All proposed behavior is deterministic local simulation.

| State | Evidence classification | Direction treatment and action |
| --- | --- | --- |
| Connecting | Observed existing visual state | “Connecting — simulated”; static preparation marker; End available. |
| Listening | Observed existing visual state | “Listening — simulated”; current user turn and a short invitation; a finite capture-onset cue, no endless pulse. |
| Processing | Observed as thinking | Keep the submitted user turn; “Preparing a response”; no invented completion percentage; Interrupt available. |
| Speaking | Observed existing visual state | Retained response text and finite segment progress; Interrupt available throughout. |
| Muted | Observed existing visual state | Explicit “Microphone muted — simulated”; stop pending simulated capture; retain turns; Unmute available. |
| Interruption | Proposed explicit state | Cancel pending callbacks immediately; mark partial response “Interrupted”; Resume listening available. |
| Ending | Proposed explicit transition | Cancel work synchronously; announce ending once, then show ended state without an artificial wait. |
| Ended | Observed existing visual state | Retained transcript; Talk again or Return to chat. |
| No speech | Proposed addition | “No speech received — simulated”; Retry or Return to chat, no blame and no fabricated transcript. |
| Microphone denied | Observed error visual using fixture | “Microphone permission denied — simulated”; explanatory recovery copy, Retry simulation or Return to chat; never request permission. |
| Microphone unavailable | Proposed distinct state; no distinct source copy observed | “Microphone unavailable — simulated”; explain fixture condition without claiming a hardware check; Retry simulation or Return to chat. |
| Connection/service failure | Observed error visuals using fixtures | Preserve turns, show specific simulated failure and retry action; never claim a network/account check occurred. |
| Shown content/loading/failure | Observed visual states | Preserve separate content identity, readable local Markdown/image fixtures and explicit simulated loading/error text. No external viewer actions. |
| Guide | Observed visual state | Native accessible local dialog, clear stacking and focus return; describe simulation limits rather than claim live capabilities. |

No additional production behavior is claimed as documented but not rendered. The baseline notes enumerate unrendered integration/fallback limits; the proposal does not silently promote those to verified states.

## Cancellation, retry, retention and safe return

Each run receives a generation token; all callbacks check it. Cancel timers and invalidate the token on interrupt, retry, ending, exit and restart. Retry retains completed turns, labels incomplete turns and starts only one new simulation. Restart never silently clears the transcript. Transcript retention is in memory only; the notice explains that reload loses the sample. No storage APIs or production data changes.

Return to chat stays inside the new mockup, restores an isolated approved-shell chat sample and focuses its Talk to Kleio entry. Do not navigate to or alter the original preview, pretend to persist a real conversation, or run real app actions. Escape closes an open guide first; otherwise it ends the simulated conversation and returns to the local chat sample. This voice Escape behavior is proposed and will be labelled in help. Native Enter/Space activation, logical focus order and visible focus are required.

## Motion and accessibility

Capture onset gets one short transition; speaking progress advances only with finite simulated response segments. No indefinite audio animation. Interruption removes progress immediately. Reduced motion uses complete static text, explicit state labels and discrete progress markers: no looping, flashing, typing animation or spatial transitions. Status announcements are concise and polite; do not repeatedly announce the entire transcript or steal focus during state changes.

Target text contrast at least 4.5:1; large text and functional boundaries/glyphs at least 3:1. State is never color-only. Transcript scroll is intentional and keyboard reachable; preserve the reading position when reviewing older turns. At both 1680×1000 and 1024×1000, controls remain visible, long content wraps, and no horizontal page overflow is allowed. These are verification targets, not passed results.

## Reference principles

- Nielsen Norman Group, [10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): visible status, user control, consistency and minimalist hierarchy support explicit state labels, an immediate exit and conversation-first composition. These principles guide the proposal, not an endorsement or copied visual design.
- W3C, [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages): expose state changes to assistive technology without moving focus unnecessarily.
- W3C, [Animation from Interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html): respect motion preferences and remove nonessential animation.
- Local authoritative visual references: `mockups/unified/README.md`, `mockups/unified/mukta-malar.css`, `mockups/window-chrome/session-preview-notes.md`. Existing approval, not external inspiration, governs shell and type.

## Approval record

Baseline rendering approved previously. This single direction is not yet approved. No direction HTML/CSS/JS or after captures have been created. Implementation and step-7 verification require explicit direction approval first. Chromium is available; baseline verification found no installed WebKit executable, and no installation is authorized.

Explicit direction approval received in chat: “Approve this direction and implement the isolated mockup”. Step 6 authorized.
