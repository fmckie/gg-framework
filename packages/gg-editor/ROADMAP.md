# gg-editor — Roadmap & Outstanding Work

Living tracking doc. Updated each time something ships.

Legend: `[x]` done · `[~]` partial / stubbed honestly · `[ ]` not started

---

## Status snapshot

- **59 tools live** (60 with `review_edit` when auth is configured), all LLM-shaped output
- **315/315 tests passing**
- **Mental model**: long-form (podcasts/interviews/vlogs/courses) + short-form (TikTok/Reels/Shorts) content. Generative video / motion graphics / VFX explicitly out of scope.
- **Bundled skills** (recipes): `long-form-content-edit`, `short-form-content-edit` — fetched on demand via `read_skill`
- **TUI footer** with running token + tool counts
- **Slash command autocomplete** with menu and Tab completion
- **OAuth login** (`ggeditor login`) — PKCE flow for Anthropic + OpenAI, shared `~/.gg/auth.json` with Kleio Coder
- **Ink TUI** with header, streaming text, animated spinner, tool-call lines, slash commands
- **3 host adapters**: Resolve (live bridge), Premiere (live bridge on macOS), None (file-only)
- **Cross-platform**: macOS ✓, Linux ✓ (Resolve only), Windows ✓ (Resolve only)
- **v0.1.0 alpha** — publish-ready (npm pack: 98.4 kB, 234 files, clean build + tests)
- **README** — comprehensive, recipe-focused
- **CHANGELOG.md** — 0.1.0 release notes

---

## Done

### Foundation

- [x] Package skeleton, pnpm workspace integration, build/check/test scripts
- [x] `VideoHost` interface — NLE-agnostic contract
- [x] `HostUnsupportedError` / `HostUnreachableError` — clean fallback signal
- [x] Cross-platform host detection via process scan (`detectHost()`)
- [x] CLI: `ggeditor`, interactive TUI, SIGINT cleanup
- [x] System prompt: capability-aware, embeds host caps + workflows
- [x] Output format contract (`compact`, `err`, `summarizeList`, `framesToTimecode`)
- [x] CMX 3600 EDL writer + tests
- [x] silencedetect parser + keep-range computation + tests
- [x] ffmpeg/ffprobe wrappers + abort-signal support

### Resolve adapter (live)

- [x] Cross-platform Python interpreter detection (python3 / python / py -3)
- [x] Long-lived sidecar bridge with JSON-line wire protocol
- [x] Embedded Python source (no .py shipping issues)
- [x] Methods: ping, get_timeline, add_marker, append_clip, import_timeline, render
- [x] Integration tests with fake DaVinciResolveScript module (verifies wire end-to-end)
- [~] cut_at / ripple_delete: throw HostUnsupportedError pointing to write_edl + import_edl

### Premiere adapter (live, macOS)

- [x] osascript/ExtendScript transport
- [x] Self-contained per-call JSX generation
- [x] Methods: ping, get_timeline, add_marker, append_clip, import_timeline
- [~] cut_at / ripple_delete / render: throw HostUnsupportedError (QE DOM unstable; AME deferred)
- [ ] Windows path — needs CEP panel (see "Premiere on Windows" below)

### None adapter (file-only)

- [x] Bypass mode for ffmpeg-only workflows

### Tools (27)

- [x] `host_info` — capabilities snapshot
- [x] `get_timeline` — head/tail summarized JSON
- [x] `get_markers` — read prior decisions for session resume
- [x] `cut_at` — with EDL fallback hint
- [x] `ripple_delete` — with EDL fallback hint
- [x] `add_marker` — audit-trail tool
- [x] `append_clip` — most reliable mutation
- [x] `set_clip_speed` — retime (slow-mo / speed-up)
- [x] `create_timeline` — new timeline with name + fps + resolution
- [x] `import_to_media_pool` — bring files into the project without appending
- [x] `open_page` — switch Resolve workspace (Resolve only)
- [x] `write_edl` — bulk-import escape hatch
- [x] `write_fcpxml` — high-fidelity interchange
- [x] `import_edl` — Resolve/Premiere universal
- [x] `reformat_timeline` — 9:16 / 1:1 / 4:5 / 16:9 / 4:3 FCPXML preset for short-form
- [x] `render` — Resolve only
- [x] `write_srt` — SubRip captions writer
- [x] `import_subtitles` — attach SRT to active timeline
- [x] `probe_media` — ffprobe wrapper
- [x] `extract_audio` — ffmpeg wrapper
- [x] `detect_silence` — frame-aligned keep-ranges, EDL-ready
- [x] `transcribe` — local whisper.cpp + OpenAI fallback, file-write + summary
- [x] `read_transcript` — query by time range or substring
- [x] `cluster_takes` / `pick_best_takes` / `score_shot`
- [x] `read_skill` — fetch skill recipes (bundled + project + user)
- [x] `apply_lut` — LUT on a grading node (Resolve)
- [x] `set_primary_correction` — CDL slope/offset/power/saturation (Resolve)
- [x] `copy_grade` — replicate grade across clips (Resolve)
- [x] `color_match` — vision-derived CDL with confidence gating
- [x] `multicam_sync` — first-transient (clap) alignment of 2+ recordings
- [x] `review_edit` — read-only self-critique sub-agent (registered when auth is supplied)
- [x] `measure_loudness` — EBU R128 measurement
- [x] `normalize_loudness` — two-pass loudnorm to platform target
- [x] `clean_audio` — denoise / rnnoise / dehum / deess
- [x] `extract_frame` — single-frame thumbnail extraction
- [x] `insert_broll` — cutaway on a higher track without disturbing A-roll
- [x] `replace_clip` — swap media reference, preserve timing + grade
- [x] `smart_reframe` — Resolve Studio AI subject tracking for vertical reformat
- [x] `list_render_presets` — enumerate before render
- [x] Word-level captions — `transcribe(wordTimestamps=true)`, `read_transcript(includeWords=true)`, `write_srt(words=[...])`

### Content-creator additions (Tier 1)

- [x] Mental model: long-form vs short-form video content
- [x] Captions / subtitles workflow (probe → extract → transcribe → write_srt → import_subtitles)
- [x] Rough-cut-from-script workflow
- [x] Reformat-for-shorts workflow (9:16 / 1:1 / 4:5)
- [x] Page-aware guidance (Resolve)
- [x] Session-resume discipline (`get_markers` first)
- [x] Human-in-the-loop pause via red markers
- [x] Bundled skills: long-form-content-edit, short-form-content-edit

### Content-creator additions (Tier 2 — closed)

- [x] Color tools: `apply_lut`, `set_primary_correction`, `copy_grade` (Resolve only; LUT + CDL is what's actually scriptable; wheels/curves/qualifiers/windows remain manual)
- [x] Multicam audio sync — v1 first-transient / clap-sync via ffmpeg silencedetect
- [x] Self-review tool (`review_edit`) — critique edit against stated intent
- [x] User-extensible skills — `.gg/editor-skills/*.md` (project) + `~/.gg/editor-skills/*.md` (user) layered on top of bundled

### Content-creator additions (Tier 3 — closed)

- [x] `color_match` — vision-derived CDL with confidence gate
- [x] B-roll insertion over transcript range — `insert_broll` on V2
- [x] Loudness pipeline — `measure_loudness` + `normalize_loudness` (EBU R128)
- [x] Audio cleanup — `clean_audio` (denoise / rnnoise / dehum / deess)
- [x] `extract_frame` — thumbnail / hero-frame export
- [x] `replace_clip` — swap media reference
- [x] Smart Reframe trigger (Resolve Studio AI)
- [x] `list_render_presets` for agent to pick from
- [x] Word-level captions for short-form burned-in style
- [x] Chapter-markers skill recipe

### Content-creator additions (Tier 4 — closed)

- [x] Marker query enhancements — `get_markers(color, contains, startFrame, endFrame)`
- [x] Style presets — `<cwd>/.gg/editor-styles/*.md` + `~/.gg/editor-styles/*.md` (project overrides user); fold into system prompt as Active style presets
- [x] Speaker handling — `Transcript.segments[].speaker?: string` schema, `read_transcript(speaker=...)` filter, `detect_speaker_changes` heuristic v1 (silence-gap based; honest about its limits)
- [x] Round-trip golden tests — EDL + FCPXML structural verification via targeted regex (event count, contiguous record cursor, frame-rate fractions for 23.976/29.97, asset/clip ref integrity)

### Content-creator additions (Tier 5 — closed)

- [x] **Speaker diarization v2** — `transcribe(diarize=true)` shells out to whisperx (which uses pyannote). Requires HF_TOKEN. Real speaker labels per segment + word.
- [x] **ASS subtitle writer** (`write_ass`) — styled burned captions: font, color, outline, position, per-cue style overrides. Vertical-canvas defaults baked in. ffmpeg hardcodes via `subtitles=` filter.
- [x] **Music ducking** (`duck_audio`) — sidechain compression (voice key, music chain). Defaults tuned for spoken voice over music.
- [x] **Safety nets** — `clone_timeline(newName)` duplicates the active timeline before destructive ops; `save_project` checkpoints. System prompt rule #11 reminds the agent to use them before bulk import_edl / replace_clip / first render.
- [x] **Per-call bridge cancellation** — Resolve and Premiere bridges accept `opts.signal`; aborted calls stop waiting on the JS side and discard the eventual response. Resolve render still can't be cancelled mid-flight (host-side limitation).

### Content-creator additions (Tier 6 — closed)

- [x] **Multicam sync v2** — envelope cross-correlation for dialogue/applause/music; no slate needed. Pure JS, no FFT lib (energy envelope at 100ms blocks is sufficient for editorial alignment). `multicam_sync(method="envelope")`.
- [x] **`stabilize_video`** — two-pass ffmpeg vidstab (detect → transform). Audio preserved, zoom available to hide stabilization borders.
- [x] **`add_track`** — append a track to the active Resolve timeline (V2/A3/ST1...).
- [x] **`set_clip_volume`** — per-clip audio gain in dB (Resolve only). Tries dB and linear setters across versions.
- [x] **`pre_render_check`** — composite QA before render. Verifies timeline non-empty, no unresolved PAUSE markers, loudness vs platform target (when supplied), captions presence (when expected). Severity-tagged issues; blocks at severity="block".

### Content-creator additions (Tier 7 — closed)

- [x] **`burn_subtitles`** — hardcode .srt or .ass into a video. End-of-pipeline captioning.
- [x] **`concat_videos`** — lossless concat-demuxer mode + filter-based re-encode mode. Intro/main/outro stitching.
- [x] **`add_fades`** — fade-in/out on video + audio.
- [x] **`crossfade_videos`** — xfade between two clips with 16 transition styles.
- [x] **`generate_gif`** — two-pass palettegen → paletteuse for social previews.
- [x] **`overlay_watermark`** — PNG logo positioning + opacity + scale.
- [x] **`compose_thumbnail`** — frame extract + drawtext headline. YouTube/TikTok thumbnails.

### Content-creator backlog (Tier 8 — open)

- [ ] Cumulative cost telemetry surface in TUI footer (token → dollar). Pricing table maintenance burden.
- [ ] Render mid-flight cancellation — host-side limit (Resolve render queue can be cancelled only via UI).
- [ ] Frame-accurate FFT cross-correlation for multicam (envelope is editorial-grade, sub-block lag undefined). Needed only if someone asks for it.

---

## Up next (priority order)

### ~~1. Vision shot scoring — `score_shot`~~ ✅ DONE

- [x] `core/vision.ts` — OpenAI vision API client (chat completions w/ image_url)
- [x] `core/frames.ts` — frame extraction (per-time + interval modes)
- [x] `tools/score-shot.ts` — sample frames at interval or specific times, batch-score
- [x] Tests for response parser (handles array, wrapped object, prose-wrapped, padding/truncation)
- [x] System prompt: vision-pass workflow + cost-awareness rules

### ~~1. Premiere on Windows~~ ✅ DONE

- [x] New package: `@kenkaiiii/gg-editor-premiere-panel`
- [x] CEP manifest (PPRO, NodeJS enabled, mixed-context)
- [x] Panel HTML + JS with localhost HTTP server (default port 7437)
- [x] JSX runtime mirroring the macOS bridge methods
- [x] Cross-platform installer CLI (install/uninstall/status/debug-on/debug-off)
- [x] Auto-toggles PlayerDebugMode for CSXS 9-12
- [x] Dual-transport bridge in gg-editor: HTTP (preferred) + osascript (mac fallback)
- [x] HTTP bridge end-to-end tested with stub server
- [ ] (v1) ZXP signing for production unsigned-panel-free install

### ~~2. Take-selection helper — `cluster_takes`~~ ✅ DONE

- [x] `core/clustering.ts` — Jaccard similarity over normalized token sets, union-find
- [x] Tunable threshold + window + minTokens
- [x] `tools/cluster-takes.ts` — reads transcript, returns multi-member clusters in temporal order
- [x] 12 tests covering tokenization, jaccard math, window filtering, singletons, sort order
- [x] System prompt: take-selection workflow now uses cluster_takes -> score_shot -> EDL
- [ ] (v1) Embedding-similarity backend for paraphrased re-takes (currently token-based only)
- [ ] (v1) Per-cluster ranking (vision score + audio quality + position) auto-pick winner

### ~~3. Ink TUI port~~ ✅ DONE (focused rebuild rather than full port)

- [x] `ui/theme.ts` — standalone palette (no Kleio Coder dependency)
- [x] `ui/spinner-frames.ts` — sparkle character set, OS-aware
- [x] `ui/components/Header.tsx` — host status banner
- [x] `ui/components/Spinner.tsx` — animated tick
- [x] `ui/components/InputBox.tsx` — dependency-free single-line input
- [x] `ui/components/Message.tsx` — user / assistant / tool / info / error views
- [x] `ui/components/ToolCallLine.tsx` — compact tool-call rendering
- [x] `ui/App.tsx` — <Static> history + live streaming area
- [x] `ui/render.ts` — mount entry
- [x] CLI requires an interactive TTY — Ink TUI is the only mode
- [x] Slash commands: /quit /exit /q /clear /help /?
- [x] Multi-line input (Shift-Enter, trailing-backslash continuation)
- [x] Input history (up/down arrows, 100-entry rolling)
- [x] Ctrl-U clear input
- [x] Slash command menu / autocomplete (Tab to fill, Up/Down to cycle)
- [x] TUI footer with token + tool + turn counts
- [ ] (v1) Theme picker (currently dark-only)

### Output format expansion ✅ PARTIAL DONE

- [x] FCPXML 1.10 emitter + `write_fcpxml` tool
- [x] Frame-rational time encoding (no 23.976/29.97 rounding loss)
- [x] Multi-source asset support (one asset per unique reel)
- [x] 15 tests covering rates, rationals, contiguity, escaping, Windows paths
- [ ] (v1) AAF emitter for Avid interop
- [ ] (v1) Resolve `.drt` native timeline format

### Composite take selection ✅ DONE

- [x] `pick_best_takes` tool combines cluster_takes + score_shot + winner-picking
- [x] Three strategies: `last` (default), `first`, `vision`
- [x] Returns picks + dropped indexes + reasoning per cluster
- [x] Vision mode: extracts frames at midpoints, batched scoring, picks max

---

## Stubbed but reachable (honest gaps)

### Resolve API limits (genuine)

- [~] `cut_at` — Resolve API has no scriptable razor. Fallback: `write_edl + import_edl`. Documented in adapter.
- [~] `ripple_delete` — same. Same fallback.
- [~] AI features (Magic Mask config, Voice Isolation params, Speed Warp) — not in API. No workaround until Blackmagic exposes them.
- [~] Fairlight (mixer, EQ, fades, audio automation) — closed. Not on Blackmagic's roadmap.
- [~] OFX plugin parameters — invisible to scripts on any page.
- [~] Smart Bins — read but not creatable via script.

### Premiere API limits (genuine)

- [~] `cut_at` — QE DOM razor exists but undocumented and version-fragile. Avoid; use EDL.
- [~] `ripple_delete` — same.
- [~] `render` — requires Adobe Media Encoder integration. Punt to manual export for now.
- [~] Lumetri color via script — limited to preset application. Manual otherwise.
- [~] Speech-to-Text features — not exposed.

### Whisper backend limits

- [~] Local whisper.cpp word-level timestamps — disabled (whisper.cpp `-oj` doesn't include them by default).
- [~] OpenAI 25MB upload limit — guarded with clear error directing to extract_audio compression.

---

## Missing entirely (post-v1 ideas)

### Higher-tier intelligence

- [ ] **Multi-take auto-selection** — extract every "did the user re-take this line" and auto-pick best
- [ ] **B-roll suggestion** — for talking-head, propose cutaways based on transcript content
- [ ] **Pacing analysis** — detect over/under-paced sections via prosody + visual change rate
- [ ] **Auto-color match** — score current shot's grade vs. reference shot, propose CDL adjustments
- [ ] **Style transfer from reference edit** — feed agent a reference cut, learn its cut rhythm

### Supporting tools

- [ ] `extract_frames` — exposed standalone (currently internal to score_shot)
- [ ] `compare_audio` — A/B audio quality (SNR, clipping, tonality)
- [ ] `detect_speakers` — diarization for multi-person recordings (pyannote / similar)
- [ ] `detect_scene_cuts` — PySceneDetect wrapper for archival footage
- [ ] `apply_lut` / `apply_grade` — Resolve only, color-only ops via API
- [ ] `set_render_preset` — preview render queue before committing
- [ ] `safe_render` — render to scratch first, agent verifies output, then commits to final path

### Output formats

- [ ] FCPXML emitter (alternative to EDL; richer, supports color/effects metadata)
- [ ] AAF emitter (Avid interop)
- [ ] Resolve `.drt` timeline format (lossless Resolve-native)

### Integrations

- [ ] Remotion bridge — generate compositions from agent decisions, render outside any NLE
- [ ] Frame.io upload after render
- [ ] Cloudinary / S3 upload + URL return for rendered files
- [ ] Telegram / Slack notification on render complete (Kleio Coder already has reusable Telegram support)

### Infrastructure

- [ ] Session persistence (current state, decisions journal) like Kleio Coder has
- [ ] `--resume <session-id>`
- [x] OAuth for Anthropic + OpenAI (PKCE flow, shared `auth.json` with Kleio Coder; currently API key only)
- [ ] Cost tracking per session (tokens used, frames analyzed, transcribe minutes)
- [ ] Undo journal (every host op records inverse operation when possible)

### Cross-platform polish

- [ ] Linux Premiere — N/A (Premiere is Mac/Windows only). Document explicitly.
- [ ] Windows Resolve — should work today via the existing Python bridge; needs verification.
- [ ] AppImage / standalone binary distribution

### Testing

- [ ] End-to-end test against a real Resolve installation (requires CI with Resolve Studio license — hard)
- [ ] End-to-end test against a real Premiere installation (similar)
- [ ] Snapshot tests for EDL output across realistic decision lists
- [ ] Property-based tests for silence parser (random ffmpeg output shapes)

### Documentation

- [ ] Architecture diagram
- [ ] Tool reference page (each tool's contract, examples)
- [ ] Recipe book: silence cut, take selection, color batch, B-roll insertion
- [ ] Comparison matrix: Resolve API vs Premiere API vs gg-editor abstraction

---

## Known sharp edges (must fix before stable release)

- [ ] Premiere bridge: per-call JSX file leaks if osascript is killed mid-call (cleanup is best-effort)
- [ ] Resolve bridge: bridge process is shared globally; concurrent agent loops would race (single-instance assumption documented but not enforced)
- [ ] No retry logic on transient ffmpeg failures
- [ ] No rate limiting on OpenAI API calls (transcribe + future score_shot)
- [ ] write_edl truncates reel to 8 chars — long source filenames lose information; should support free-form reel column
- [ ] add_marker on Resolve fails silently if a marker already exists at that frame (Resolve's AddMarker returns false; we surface as error but message could be friendlier)
- [ ] The CLI uses readline; multi-line prompts require explicit \n. TUI port (#4) fixes this.

---

## Decisions to revisit

- **Anthropic vs OpenAI as default vision model** — currently we're going OpenAI for `score_shot` (gpt-4o-mini) for cost. Anthropic Claude Sonnet has better instruction following on structured output. Re-evaluate after `score_shot` lands.
- **Transcript storage format** — currently raw whisper-shape JSON. Consider .vtt for direct re-import as subtitles into NLE. Both, perhaps.
- **EDL vs FCPXML as default bulk format** — FCPXML preserves more metadata (color, audio levels, effects). EDL is the lowest common denominator but lossy. May want FCPXML as default for Premiere, EDL as default for Resolve.
