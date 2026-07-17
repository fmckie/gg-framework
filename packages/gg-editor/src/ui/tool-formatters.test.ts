import { describe, expect, it } from "vitest";
import { formatGgEditorDetail, formatGgEditorInline } from "./tool-formatters.js";

describe("formatGgEditorDetail", () => {
  it("returns undefined for tools that don't carry useful arg context", () => {
    expect(formatGgEditorDetail("host_info", {})).toBeUndefined();
    expect(formatGgEditorDetail("get_timeline", {})).toBeUndefined();
    expect(formatGgEditorDetail("list_render_presets", {})).toBeUndefined();
  });

  it("shortens file paths to basename for read-style tools", () => {
    expect(formatGgEditorDetail("transcribe", { input: "/abs/path/podcast.mp4" })).toBe(
      "podcast.mp4",
    );
    // probe_media uses `filePath`, not `input` — was the original bug.
    expect(formatGgEditorDetail("probe_media", { filePath: "clip.mov" })).toBe("clip.mov");
  });

  it("falls back across the default file-key list (so transcript-based tools still work)", () => {
    expect(
      formatGgEditorDetail("score_clip", {
        transcript: "/x/y/transcript.json",
        startSec: 0,
        endSec: 30,
      }),
    ).toContain("0.0s");
    // pick_best_takes uses transcriptPath
    expect(
      formatGgEditorDetail("pick_best_takes", {
        transcriptPath: "/x/y/t.json",
        videoPath: "/x/y/v.mp4",
      }),
    ).toBe("t.json");
    // multicam_sync uses inputs[]
    expect(
      formatGgEditorDetail("multicam_sync", {
        inputs: ["a.wav", "b.wav", "c.wav"],
        method: "transient",
      }),
    ).toBe("3 sources, transient");
  });

  it("shows clip + speed for set_clip_speed", () => {
    expect(formatGgEditorDetail("set_clip_speed", { clipId: "v1c3", speed: 0.5 })).toBe(
      "v1c3 → 0.5×",
    );
  });

  it("formats add_marker with color + truncated note", () => {
    expect(
      formatGgEditorDetail("add_marker", {
        color: "red",
        note: "PAUSE: weak hook needs review before render",
      }),
    ).toContain('red "PAUSE: weak hook needs review');
  });

  it("renders multi-format render with format list", () => {
    expect(
      formatGgEditorDetail("render_multi_format", {
        formats: ["youtube-1080p", "shorts-9x16"],
      }),
    ).toBe("youtube-1080p, shorts-9x16");
  });

  it("formats verify_thumbnail_promise as 'thumb vs video'", () => {
    expect(
      formatGgEditorDetail("verify_thumbnail_promise", {
        thumbnail: "/x/y/thumb.jpg",
        video: "/x/y/video.mp4",
      }),
    ).toBe("thumb.jpg vs video.mp4");
  });

  it("shows the action enum on fusion_comp", () => {
    expect(formatGgEditorDetail("fusion_comp", { action: "add_node" })).toBe("add_node");
  });

  it("formats search_tools with quoted query", () => {
    expect(formatGgEditorDetail("search_tools", { query: "youtube metadata" })).toBe(
      '"youtube metadata"',
    );
  });

  it("formats text_based_cut by cut count", () => {
    expect(
      formatGgEditorDetail("text_based_cut", {
        cuts: [
          { startSec: 1, endSec: 2 },
          { startSec: 3, endSec: 4 },
        ],
      }),
    ).toBe("2 cuts");
  });

  it("formats read_transcript with time window when given", () => {
    expect(
      formatGgEditorDetail("read_transcript", {
        startSec: 60,
        endSec: 120,
      }),
    ).toBe("1:00–2:00");
  });

  it("returns first line of host_eval code", () => {
    expect(
      formatGgEditorDetail("host_eval", { code: 'set_result(project.GetSetting("framerate"))' }),
    ).toContain("set_result");
  });

  it("returns undefined for unknown tools so Kleio Coder's default applies", () => {
    expect(formatGgEditorDetail("totally_unknown_tool", { foo: "bar" })).toBeUndefined();
  });
});

describe("formatGgEditorInline", () => {
  it("strips 'error:' prefix on errors and truncates", () => {
    expect(
      formatGgEditorInline("transcribe", "error: ffmpeg not on PATH; fix: install", true),
    ).toBe("ffmpeg not on PATH");
  });

  it("returns undefined for bare 'ok'", () => {
    expect(formatGgEditorInline("save_project", "ok", false)).toBeUndefined();
  });

  it("surfaces basename of ok:<path>", () => {
    expect(formatGgEditorInline("write_edl", "ok:/tmp/abc/cuts.edl", false)).toBe("cuts.edl");
  });

  it("formats cut_filler_words stats", () => {
    const result = JSON.stringify({
      stats: { total: 47, durationSec: 8.3 },
    });
    expect(formatGgEditorInline("cut_filler_words", result, false)).toBe(
      "removed 47 fillers (8.3s)",
    );
  });

  it("formats analyze_hook score", () => {
    const result = JSON.stringify({ score: 82, passes: true });
    expect(formatGgEditorInline("analyze_hook", result, false)).toBe("score 82/100");
  });

  it("flags a failing hook score", () => {
    const result = JSON.stringify({ score: 54, passes: false });
    expect(formatGgEditorInline("analyze_hook", result, false)).toBe("score 54/100 (FAIL)");
  });

  it("formats audit_retention_structure with weakest checkpoint", () => {
    const result = JSON.stringify({
      checkpoints: [{ atSec: 180 }, { atSec: 360 }],
      weakestCheckpoint: { atSec: 180, score: 0.42 },
    });
    expect(formatGgEditorInline("audit_retention_structure", result, false)).toBe(
      "weakest @ 3:00 (0.42)",
    );
  });

  it("formats verify_thumbnail_promise as percentage", () => {
    expect(formatGgEditorInline("verify_thumbnail_promise", '{"matches":0.78}', false)).toBe(
      "match 78%",
    );
  });

  it("formats render_multi_format with count", () => {
    expect(formatGgEditorInline("render_multi_format", '{"count":3}', false)).toBe("3 renders");
  });

  it("formats find_viral_moments candidate count", () => {
    expect(
      formatGgEditorInline(
        "find_viral_moments",
        JSON.stringify({ candidates: [{}, {}, {}, {}] }),
        false,
      ),
    ).toBe("4 candidates");
  });

  it("formats snap_cuts_to_beats with snapped count + tempo", () => {
    expect(
      formatGgEditorInline(
        "snap_cuts_to_beats",
        JSON.stringify({ snapped: [{}, {}, {}], tempo: 128.4 }),
        false,
      ),
    ).toBe("3 snapped @ 128 BPM");
  });

  it("formats probe_media duration + fps", () => {
    expect(
      formatGgEditorInline(
        "probe_media",
        JSON.stringify({ durationSec: 372, frameRate: 30 }),
        false,
      ),
    ).toBe("6:12 @ 30fps");
  });

  it("formats get_timeline as clip count + duration + fps", () => {
    expect(
      formatGgEditorInline(
        "get_timeline",
        JSON.stringify({ total: 94, fps: 30, durationFrames: 17665 }),
        false,
      ),
    ).toBe("94 clips, 9:49, 30fps");
  });

  it("formats get_markers count", () => {
    expect(formatGgEditorInline("get_markers", JSON.stringify({ total: 0 }), false)).toBe(
      "0 markers",
    );
    expect(formatGgEditorInline("get_markers", JSON.stringify({ total: 5 }), false)).toBe(
      "5 markers",
    );
  });

  it("surfaces host_eval result inline", () => {
    expect(formatGgEditorInline("host_eval", JSON.stringify({ result: 30 }), false)).toBe("30");
    expect(
      formatGgEditorInline(
        "host_eval",
        JSON.stringify({ result: { fps: 30, name: "timeline_v1" } }),
        false,
      ),
    ).toContain("fps");
    expect(
      formatGgEditorInline("host_eval", JSON.stringify({ stdout: "hello\nworld" }), false),
    ).toBe("hello");
  });

  it("falls back to path basename for generic compact() tools", () => {
    expect(formatGgEditorInline("loop_match_short", '{"path":"/x/y/short.mp4"}', false)).toBe(
      "short.mp4",
    );
  });

  it("returns undefined when JSON has no recognised fields", () => {
    expect(formatGgEditorInline("totally_unknown", '{"random":"stuff"}', false)).toBeUndefined();
  });
});
