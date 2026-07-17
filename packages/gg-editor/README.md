# @kenkaiiii/gg-editor

<p align="center">
  <strong>The video editing agent. Drives DaVinci Resolve and Premiere Pro through a single laser-focused tool surface.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/gg-editor"><img src="https://img.shields.io/npm/v/@kenkaiiii/gg-editor?style=for-the-badge" alt="npm version"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

Built on the [Kleio Framework](../../README.md). It uses the same agent loop ([`@kleio/agent`](../gg-agent/README.md)) as Kleio Coder with a completely different tool surface—no `bash`, no `read/write/edit`, and no general-purpose coding behavior. Just video.

---

## Install

```bash
npm i -g @kenkaiiii/gg-editor
ggeditor login    # If you are not already signed in with Kleio Coder
ggeditor
```

Auth lives in `~/.gg/auth.json`—the **same file Kleio Coder uses**. If you have already logged in with Kleio Coder, `ggeditor` uses those credentials automatically. No environment variables or API key flags are required.

It auto-detects whether you have DaVinci Resolve or Premiere Pro open. If neither, it runs in file-only mode (ffmpeg + transcribe + score). All three modes use the same tools and the same agent.

---

## The "AI editor" problem

Every "AI video editor" SaaS does the same thing: paste a transcript, watch it produce something generic in a foreign timeline you can't trust. You re-edit it anyway.

The actual problem isn't AI editing. It's **AI editing inside the tool you already use**.

GG Editor doesn't replace Resolve or Premiere. It drives them. The agent reads your timeline, makes decisions, leaves markers explaining each cut, and hands the project back to you for finishing. Every editorial decision is auditable — the markers ARE the explanation.

---

## What it can actually do

```bash
ggeditor "cut all silences from podcast.mp4"
```

Real workflow that runs autonomously:

1. Probes the file (`probe_media`)
2. Detects silence ranges via ffmpeg (`detect_silence`)
3. Writes a CMX 3600 EDL of the keep-ranges (`write_edl`)
4. Imports the EDL into Resolve/Premiere (`import_edl`)
5. Adds a marker explaining the cleanup (`add_marker`)

Total LLM context cost for a 1-hour podcast cleanup: **~600 tokens**. Total wall time: as fast as ffmpeg can read the audio plus one timeline import.

```bash
ggeditor "from this 2-hour interview, keep only the strongest takes about authentication"
```

Goes deeper:

1. Extracts audio (`extract_audio`)
2. Transcribes (`transcribe`) — full transcript saved to disk, summary in context
3. Clusters re-takes (`cluster_takes`) — finds where the speaker said the same thing 2-3 times
4. Reads only relevant transcript slices (`read_transcript` with filters)
5. For borderline takes, scores frames at midpoints (`score_shot`) using a vision model
6. Writes EDL with winners + non-clustered keepers
7. Imports + adds markers ("kept: 3rd take, clearest delivery", "cut: tangent on tooling")

The full transcript stays on disk. The agent only ever pulls slices it actually needs. **A 2-hour transcript that would be ~80K tokens to dump inline becomes ~3K tokens of intelligently-queried context.**

---

## How it works

```
┌─────────────────────────────────────────────────────────┐
│  ggeditor (Ink TUI)                                     │
│       │                                                 │
│       ├─ Auto-detect: Resolve / Premiere / none         │
│       │                                                 │
│       ├─ VideoHost adapter (one interface, three impls) │
│       │     │                                           │
│       │     ├─ Resolve     Python sidecar bridge        │
│       │     ├─ Premiere    osascript + ExtendScript     │
│       │     └─ None        File-only (ffmpeg/whisper)   │
│       │                                                 │
│       └─ Agent loop (gg-agent)                          │
│             │                                           │
│             └─ 59 video-only tools                      │
│                   ├─ Timeline:  host_info, get_timeline,│
│                   │             get_markers, cut_at,    │
│                   │             ripple_delete,          │
│                   │             add_marker, append_clip,│
│                   │             set_clip_speed,         │
│                   │             replace_clip,           │
│                   │             insert_broll            │
│                   ├─ Project:   create_timeline,        │
│                   │             import_to_media_pool,   │
│                   │             open_page (Resolve)     │
│                   ├─ Bulk:      write_edl, write_fcpxml,│
│                   │             import_edl,             │
│                   │             reformat_timeline,      │
│                   │             render,                 │
│                   │             list_render_presets,    │
│                   │             smart_reframe (Resolve) │
│                   ├─ Captions:  write_srt (sentence +    │
│                   │             word-level),            │
│                   │             import_subtitles        │
│                   ├─ Color:     apply_lut,              │
│                   │             set_primary_correction, │
│                   │             copy_grade,             │
│                   │             color_match (Resolve)   │
│                   ├─ Motion gx: fusion_comp (Resolve)  │
│                   ├─ Audio:     measure_loudness,       │
│                   │             normalize_loudness,     │
│                   │             clean_audio             │
│                   ├─ File:      probe_media, extract_   │
│                   │             audio, extract_frame,   │
│                   │             detect_silence,         │
│                   │             transcribe, read_       │
│                   │             transcript, cluster_    │
│                   │             takes, score_shot,      │
│                   │             pick_best_takes,        │
│                   │             multicam_sync           │
│                   ├─ Review:    review_edit             │
│                   └─ Skills:    read_skill              │
└─────────────────────────────────────────────────────────┘
```

The agent only sees the `VideoHost` interface. Each adapter reports its capabilities (`canMoveClips`, `canScriptColor`, `canScriptAudio`, `canTriggerAI`, `preferredImportFormat`) and the agent adapts its strategy automatically.

When a host can't do something via the live API (Resolve has no scriptable razor, for example), the adapter throws `HostUnsupportedError` and the agent falls back to the bulk path: `write_edl` → `import_edl`. This is the canonical workaround for every per-clip mutation either NLE rejects.

---

## Tool output is for LLMs, not humans

This is the design rule that keeps the whole thing fast:

| Concern                       | What we do                                                |
| ----------------------------- | --------------------------------------------------------- |
| **Successful void op**        | returns `"ok"` — 1 token                                  |
| **Successful state op**       | compact JSON, no labels: `{"id":"x","start":0,"end":600}` |
| **Errors**                    | one line: `error: <cause>; fix: <next-step>`              |
| **Long lists**                | summarized: `{total, omitted, head[], tail[]}`            |
| **Big payloads (transcript)** | written to disk; tool returns summary + path              |

Token economics for a 50-tool-call edit session: **~3K tokens of tool output**, vs the ~30K-50K typical of "AI video editor" wrappers that dump prose. Means the agent stays sharp for hundreds of decisions in one window.

---

## Setup notes

### Required

- **Node 18+** and **ffmpeg/ffprobe** on PATH

### For Resolve

- **DaVinci Resolve Studio** (free version doesn't expose the API externally)
- **Python 3** on PATH (`python3` / `python` / `py -3` — auto-detected)
- Resolve must be running with a project + timeline open
- **Preferences → System → General → External scripting using → Local**

### For Premiere (macOS)

- **Adobe Premiere Pro** running with an active sequence
- That's it — uses the built-in `osascript` + ExtendScript

### For Premiere (Windows or macOS)

- Install the companion panel package: `npm i -g @kenkaiiii/gg-editor-premiere-panel && gg-editor-premiere-panel install`
- Restart Premiere; open `Window → Extensions → GG Editor`
- The bridge auto-probes the panel — once it's running, gg-editor uses HTTP transport (faster than osascript)
- macOS without the panel still works via the built-in osascript fallback

### For transcription

- **Local** (recommended, free, private): install [whisper.cpp](https://github.com/ggerganov/whisper.cpp), download a `ggml-*.bin` model, pass `modelPath` to the `transcribe` tool
- **API**: set `OPENAI_API_KEY` — auto-detected fallback

### For vision shot scoring

- **OpenAI API key** — `score_shot` uses GPT-4o-mini by default (~$0.15 per 1M input tokens)

---

## What it's for (and what it isn't)

GG Editor is built around two video-content workflows:

- **Long-form** — podcasts, interviews, vlogs, courses, talking-head. The work is silence cuts, take selection, filler removal, chapter markers, captions.
- **Short-form** — TikTok / Reels / Shorts. The work is finding the moment, reformatting to 9:16, hooking the first 2 seconds, burning captions, rendering.

The agent ships with three bundled **skills** (recipes) for these, fetched on demand via `read_skill`: `long-form-content-edit`, `short-form-content-edit`, and `chapter-markers`.

### Persistent style presets

For things that should apply to _every_ response (your editing voice, default formats, naming conventions): drop a markdown file in either:

- `<cwd>/.gg/editor-styles/<name>.md` — project-scoped (checked into the repo)
- `~/.gg/editor-styles/<name>.md` — user-scoped (your personal default)

Unlike skills (which are read on-demand), styles fold directly into the system prompt as an "Active style presets" section. Project overrides user (opposite of skills) — the reasoning: a project's checked-in style is the one the team agreed on; a user's home preset defers to project conventions.

### Custom skills

Drop your own recipes as `.md` files in either:

- `<cwd>/.gg/editor-skills/<name>.md` — project-scoped
- `~/.gg/editor-skills/<name>.md` — user-scoped

They get listed in the system prompt with the bundled ones (tagged `(project)` / `(user)`) and load via `read_skill(name="<filename-without-md>")`. The first non-heading line of each file is used as the description. User skills override project; project overrides bundled (silent override — the badge in the prompt makes it explicit).

**Motion graphics:** simple text + lower-thirds via `fusion_comp` (Resolve only — Studio drives the Fusion node graph from the bridge). For cross-host pixel-baked chyrons, `write_lower_third` + `burn_subtitles` works on every host.

Still out of scope: generative video, VFX, animation, 3D, particles, complex compositing. If you ask for those, the agent will say so and propose what we CAN do.

---

## Tool catalog

| Tool                     | Tier   | What it does                                                                                           |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------ |
| `host_info`              | API    | Capabilities snapshot. Call first.                                                                     |
| `get_timeline`           | API    | Timeline state, head/tail summarized for long lists                                                    |
| `get_markers`            | API    | Read existing markers — prior decisions / session resume                                               |
| `cut_at`                 | API    | Razor (Premiere only — falls back to EDL on Resolve)                                                   |
| `ripple_delete`          | API    | Delete + close gap (EDL fallback on both NLEs)                                                         |
| `add_marker`             | API    | Drop a marker with a note (your audit trail)                                                           |
| `append_clip`            | API    | Most reliable mutation; works on both NLEs                                                             |
| `set_clip_speed`         | API    | Retime (slow-mo / speed-up). FCPXML rebuild fallback                                                   |
| `create_timeline`        | API    | New empty timeline / sequence with name + fps + resolution                                             |
| `import_to_media_pool`   | API    | Bring files into project bins without appending                                                        |
| `open_page`              | API    | Switch Resolve workspace (media/edit/color/deliver/...) — Resolve only                                 |
| `write_edl`              | Bulk   | CMX 3600 EDL writer — lowest-common-denominator                                                        |
| `write_fcpxml`           | Bulk   | FCPXML 1.10 — preserves clip names + rational time (preferred for Premiere)                            |
| `import_edl`             | Bulk   | Bulk-import EDL/FCPXML/AAF                                                                             |
| `reformat_timeline`      | Bulk   | Generate 9:16 / 1:1 / 4:5 / 16:9 / 4:3 FCPXML preset for short-form reformat                           |
| `render`                 | API    | Resolve only; Premiere uses File → Export manually                                                     |
| `write_srt`              | File   | SubRip caption writer (1-indexed, `HH:MM:SS,mmm`)                                                      |
| `import_subtitles`       | API    | Attach SRT to active timeline (Resolve auto; Premiere drag-onto-track)                                 |
| `clone_timeline`         | API    | Duplicate the active timeline (safety net before destructive ops)                                      |
| `save_project`           | API    | Save the host project (Resolve `pm.SaveProject()`, Premiere `app.project.save()`)                      |
| `apply_lut`              | API    | Apply a .cube/.dat LUT to a clip's grading node (Resolve only)                                         |
| `set_primary_correction` | API    | Slope/offset/power/saturation CDL on a node (Resolve only)                                             |
| `copy_grade`             | API    | Copy grade from one clip to many (Resolve only — Color page must be open)                              |
| `color_match`            | File   | Vision-derived CDL: compare reference/target frames → emit slope/offset/power/sat                      |
| `replace_clip`           | API    | Swap a clip's media reference without changing in/out or grade                                         |
| `insert_broll`           | API    | Place a cutaway on a higher track at a specific frame, A-roll undisturbed                              |
| `smart_reframe`          | API    | Trigger Resolve Studio's Smart Reframe AI on a clip (Studio only)                                      |
| `list_render_presets`    | API    | List the host's render presets (call BEFORE render)                                                    |
| `measure_loudness`       | File   | EBU R128 read: integrated LUFS, true peak, LRA                                                         |
| `normalize_loudness`     | File   | Two-pass loudnorm: hits platform target (-14/-16/-23 LUFS)                                             |
| `clean_audio`            | File   | Audio cleanup: denoise / denoise-strong / rnnoise / dehum / deess                                      |
| `duck_audio`             | File   | Sidechain compress music under voice (podcast / YouTube ducking)                                       |
| `stabilize_video`        | File   | Two-pass vidstab stabilization (handheld / gimbal-less footage)                                        |
| `burn_subtitles`         | File   | Hardcode .srt/.ass into a video (final-delivery captions)                                              |
| `concat_videos`          | File   | Stitch videos end-to-end (lossless concat or re-encode)                                                |
| `add_fades`              | File   | Fade-in / fade-out on video + audio                                                                    |
| `crossfade_videos`       | File   | xfade transition between two videos (16 styles)                                                        |
| `generate_gif`           | File   | Two-pass palettegen GIF for social previews                                                            |
| `overlay_watermark`      | File   | PNG watermark with corner positioning, opacity, scale                                                  |
| `compose_thumbnail`      | File   | Frame extract + drawtext headline = YouTube/TikTok thumbnail                                           |
| `fusion_comp`            | API    | Drive a Fusion comp — lower-thirds, title cards via Background + TextPlus + Merge nodes (Resolve only) |
| `add_track`              | API    | Append video / audio / subtitle track on the active timeline (Resolve)                                 |
| `set_clip_volume`        | API    | Per-clip audio gain in dB (Resolve)                                                                    |
| `pre_render_check`       | API    | Composite QA: empty timeline, PAUSE markers, loudness, captions                                        |
| `write_ass`              | File   | Advanced SubStation Alpha subtitle file (font/color/position for burned-in vertical captions)          |
| `extract_frame`          | File   | Pull a single frame as JPEG/PNG (thumbnails, hero stills)                                              |
| `probe_media`            | File   | ffprobe wrapper — duration, fps, codecs                                                                |
| `extract_audio`          | File   | mono 16kHz WAV via ffmpeg                                                                              |
| `detect_silence`         | File   | ffmpeg `silencedetect`, returns frame-aligned KEEP ranges                                              |
| `transcribe`             | File   | whisper.cpp local + OpenAI API fallback                                                                |
| `read_transcript`        | File   | Query saved transcript by time range or substring                                                      |
| `cluster_takes`          | File   | Token-similarity grouping of re-takes                                                                  |
| `score_shot`             | File   | Vision model rates frames 0-10                                                                         |
| `pick_best_takes`        | File   | Composite: cluster + score + winner per cluster (`last`, `first`, or `vision` strategy)                |
| `multicam_sync`          | File   | Two methods: transient (clap) or envelope (cross-correlation for dialogue)                             |
| `detect_speaker_changes` | File   | Silence-gap heuristic boundary candidates (v1; not real diarization)                                   |
| `review_edit`            | Review | Spawns a read-only critique agent; returns critique + flags (registered when auth available)           |
| `read_skill`             | Skill  | Fetch a skill (bundled + project + user recipes)                                                       |

---

## Capability matrix

| Capability       | Resolve              | Premiere   | None (ffmpeg) |
| ---------------- | -------------------- | ---------- | ------------- |
| `canMoveClips`   | ✗                    | ✓          | ✗             |
| `canScriptColor` | ✓                    | ✗          | ✗             |
| `canScriptAudio` | ✗                    | partial    | ✗             |
| `canTriggerAI`   | partial (Magic Mask) | ✗          | ✗             |
| Preferred import | EDL                  | XML/FCPXML | EDL           |

The genuine gaps are documented honestly in [ROADMAP.md](./ROADMAP.md). Resolve's Fairlight is closed; Premiere's QE DOM is unstable; Magic Mask config can't be triggered from a script. We don't pretend otherwise — we surface clear errors with EDL workarounds.

---

## Workflows

### Silence cut

```
ggeditor "cut all silences from /path/to/podcast.mp4"
```

The agent will: probe → detect_silence → write_edl → import_edl → add_marker.

### Take selection (the "extra mile")

```
ggeditor "from /path/to/interview.mp4, find every place I retook a line and pick the best version"
```

The agent will: extract_audio → transcribe → cluster_takes → for each cluster, score_shot at midpoints → pick winners → write_edl → import_edl → add_marker per decision.

### Hero frame finder

```
ggeditor "find me the 5 best frames in /path/to/video.mp4 for thumbnails"
```

The agent will: probe → score_shot at coarse interval → refine on top region → return timestamps + scores.

### Filter markers

```
ggeditor "show me only the red 'PAUSE' markers between 02:00 and 04:00"
```

`get_markers(color="red", contains="PAUSE", startFrame=..., endFrame=...)` — filters server-side so the agent doesn't load every marker into context.

### Real speaker diarization

```
ggeditor "transcribe interview.mp4 with speaker labels"
```

With [whisperx](https://github.com/m-bain/whisperx) installed (`pip install whisperx`) and an `HF_TOKEN` env var (free Hugging Face account, accept the pyannote license), `transcribe(diarize=true)` produces real speaker labels. `read_transcript(speaker="SPEAKER_00")` filters by them. Without whisperx, `detect_speaker_changes` provides a silence-gap fallback (clearly-marked candidates, not assignments).

### Music ducking

```
ggeditor "mix podcast.wav with intro_music.mp3 ducked under the voice"
```

`duck_audio` runs ffmpeg sidechaincompress (defaults tuned for spoken voice). Standard podcast/YouTube technique.

### Captions (long-form or short-form)

```
ggeditor "caption this podcast and attach the SRT to the timeline"
```

Long-form: probe → extract_audio → transcribe → write_srt(cues=...) → import_subtitles. Sidecar SRT.

Short-form / TikTok-style burned captions: `transcribe(wordTimestamps=true)` → `read_transcript(includeWords=true)` → `write_srt(words=[...], groupSize=2, gapSec=0.2)` → import_subtitles. One word (or pair) per cue, popping as the speaker says it.

Styled burned captions (font / color / outline / position): use `write_ass` instead of `write_srt`. ffmpeg hardcodes them: `ffmpeg -i in.mp4 -vf subtitles=cap.ass -c:a copy out.mp4`.

### Loudness normalization (every long-form deliverable)

```
ggeditor "normalize this podcast for Spotify"
```

The agent will: measure_loudness → (optionally) clean_audio → normalize_loudness(platform=spotify). Two-pass loudnorm hits -14 LUFS / -1 dBTP exactly. Skip this and Spotify / YouTube / Apple Podcasts will compress your audio in their own way — you lose dynamic range you didn't choose to give up.

### Chapter markers from a transcript

```
ggeditor "add YouTube chapters to this 45-min interview"
```

The agent reads the `chapter-markers` skill and: transcribes → reads transcript in 90s windows looking for topic shifts → places purple markers → emits a YouTube-formatted description block. 5–15 chapters, first at 00:00, ≥30s apart.

### B-roll over filler

```
ggeditor "cover up the worst three 'um's with cutaways from broll/"
```

The agent finds the moments with `read_transcript(contains="um", includeWords=true)`, picks the worst 3, and `insert_broll`s them on V2 over the main A-roll.

### Hero thumbnail (with text)

```
ggeditor "find the best frame in this podcast and make a thumbnail with the headline 'Why most edits fail'"
```

score_shot at coarse intervals → pick top → compose_thumbnail at that timestamp with the headline. White text + black outline at the bottom by default — readable at thumbnail scale.

### File-only deliverable from a directory of clips

```
ggeditor "stitch intro.mp4 + main.mp4 + outro.mp4, normalize for YouTube, burn captions.srt, fade in/out 1s, output final.mp4"
```

concat_videos → normalize_loudness → burn_subtitles → add_fades. Pure ffmpeg pipeline, no NLE needed.

### Reformat for shorts (9:16 / 1:1 / 4:5)

```
ggeditor "make a 9:16 vertical version of this 5-minute talk"
```

The agent will: probe → reformat_timeline (9:16 FCPXML) → import_edl → (Resolve) open_page("color") → add_marker prompting Smart Reframe / Auto Reframe per clip → captions. Default short-form aspect is 9:16; ask for 1:1 or 4:5 explicitly.

### Rough cut from a script

```
ggeditor "build a rough cut from script.txt using these 8 source files"
```

The agent will: probe each source → transcribe → fuzzy-match each script line against transcripts → create_timeline → import_to_media_pool → write_edl → import_edl → add_marker per segment with the script line.

### File-only batch (no NLE)

```
ggeditor "transcribe these 12 mp4s in this folder and emit one EDL per file with silences removed"
```

---

## Subcommands

```
ggeditor login                   Authenticate (OAuth for Anthropic / OpenAI; API key for GLM / Moonshot)
ggeditor login --provider <p>    Skip the picker and login to a specific provider
ggeditor logout [provider]       Clear stored credentials (one provider or all)
ggeditor auth                    Show stored credentials + expiry
```

## Slash commands (in TUI)

| Command              | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `/quit` `/exit` `/q` | Exit cleanly (kills bridges)                        |
| `/clear`             | Clear visible history (doesn't reset agent context) |
| `/help` `/?`         | Show available commands                             |

---

## Status

**v0.1 — alpha.** Functional end-to-end on macOS with Resolve and Premiere. Resolve is verified via integration tests against a fake `DaVinciResolveScript` module (the wire protocol is identical to the real one). Premiere bridge has parser tests; live runs need a real Premiere installation.

Cross-platform: macOS ✓, Linux ✓ (Resolve only — Premiere has no Linux build), Windows ✓ for Resolve / deferred for Premiere (CEP panel needed).

See [ROADMAP.md](./ROADMAP.md) for everything that's done, partial, stubbed, or planned. The roadmap doesn't lie — Resolve API limits, Premiere Windows path, vision cost rules, all tracked honestly.

---

## Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) — tutorials and demos
- [Skool community](https://skool.com/kenkai) — come hang out

---

## License

MIT
