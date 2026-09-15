import { afterEach, describe, expect, it, vi } from "vitest";
import { NoneAdapter } from "../core/hosts/none/adapter.js";
import * as ffmpeg from "../core/media/ffmpeg.js";
import { createApplyLutTool } from "./apply-lut.js";
import { createCopyGradeTool } from "./copy-grade.js";
import { createInsertBrollTool } from "./insert-broll.js";
import { createListRenderPresetsTool } from "./list-render-presets.js";
import { createMulticamSyncTool } from "./multicam-sync.js";
import { createAddTrackTool } from "./add-track.js";
import { createCloneTimelineTool } from "./clone-timeline.js";
import { createPreRenderCheckTool } from "./pre-render-check.js";
import { createSetClipVolumeTool } from "./set-clip-volume.js";
import { createStabilizeVideoTool } from "./stabilize-video.js";
import { createReplaceClipTool } from "./replace-clip.js";
import { createReviewEditTool } from "./review-edit.js";
import { createSaveProjectTool } from "./save-project.js";
import { createWriteAssTool } from "./write-ass.js";
import { createSetPrimaryCorrectionTool } from "./set-primary-correction.js";
import { createSmartReframeTool } from "./smart-reframe.js";
import { createReorderTimelineTool } from "./reorder-timeline.js";
import { createComposeLayeredTool } from "./compose-layered.js";
import { createMixAudioTool } from "./mix-audio.js";
import { createWriteLowerThirdTool } from "./write-lower-third.js";
import { createWriteTitleCardTool } from "./write-title-card.js";
import { createSpeedRampTool } from "./speed-ramp.js";
import { createKenBurnsTool } from "./ken-burns.js";
import { createTransitionVideosTool } from "./transition-videos.js";
import { createGradeSkinTonesTool } from "./grade-skin-tones.js";
import { createMatchClipColorTool } from "./match-clip-color.js";
import { createCutFillerWordsTool } from "./cut-filler-words.js";
import { createPunchInTool } from "./punch-in.js";
import { createAnalyzeHookTool } from "./analyze-hook.js";
import { createWriteKeywordCaptionsTool } from "./write-keyword-captions.js";
import { createAddSfxAtCutsTool } from "./add-sfx-at-cuts.js";

/**
 * Tool-wrapper tests — exercise the zod validation + error formatting layer
 * for the new tools. NoneAdapter is used so any host call surfaces as an
 * "error: ..." string we can assert on.
 */

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createApplyLutTool>["execute"]>[1];

describe("apply_lut tool", () => {
  it("formats host errors as 'error: ...'", async () => {
    const tool = createApplyLutTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute(
      { clipId: "x", lutPath: "lut.cube" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    expect(r).toMatch(/^error:/);
  });
});

describe("set_primary_correction tool", () => {
  it("rejects when no CDL component supplied", async () => {
    const tool = createSetPrimaryCorrectionTool(new NoneAdapter());
    const r = await tool.execute({ clipId: "x" }, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/at least one of slope.*saturation/);
  });
});

describe("copy_grade tool", () => {
  it("surfaces unreachable host as a clean error", async () => {
    const tool = createCopyGradeTool(new NoneAdapter());
    const r = await tool.execute(
      { sourceClipId: "a", targetClipIds: ["b"] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("insert_broll tool", () => {
  it("formats host errors", async () => {
    const tool = createInsertBrollTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute(
      { mediaPath: "broll.mov", recordFrame: 0 },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
  });
});

describe("replace_clip tool", () => {
  it("formats host errors", async () => {
    const tool = createReplaceClipTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute(
      { clipId: "x", mediaPath: "new.mov" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
  });
});

describe("smart_reframe tool", () => {
  it("returns a clear error when the host doesn't support it", async () => {
    // NoneAdapter has smartReframe defined; force-strip it for this test.
    const host = new NoneAdapter();
    Object.defineProperty(host, "smartReframe", { value: undefined });
    const tool = createSmartReframeTool(host);
    const r = await tool.execute(
      { clipId: "x", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/does not support smart_reframe/);
  });
});

describe("list_render_presets tool", () => {
  it("returns the empty list cleanly when host has none", async () => {
    const tool = createListRenderPresetsTool(new NoneAdapter());
    const r = await tool.execute({}, ctx as Parameters<typeof tool.execute>[1]);
    const parsed = JSON.parse(r as string);
    expect(parsed.host).toBe("none");
    expect(parsed.total).toBe(0);
  });
});

describe("multicam_sync tool", () => {
  it("rejects when ffmpeg is unavailable (env-dependent — guarded)", async () => {
    const tool = createMulticamSyncTool("/tmp");
    // Either ffmpeg is missing → 'error: ffmpeg not on PATH', or ffmpeg is
    // present and we get an error from missing input files. Both are valid
    // negative paths — we just want to confirm the tool returns a string.
    const r = await tool.execute(
      { inputs: ["/no/such/a.wav", "/no/such/b.wav"] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    // It should be either the JSON success shape or an error.
    expect((r as string).startsWith("{") || (r as string).startsWith("error:")).toBe(true);
  });
});

describe("add_track tool", () => {
  it("surfaces unreachable host as an error", async () => {
    const tool = createAddTrackTool(new NoneAdapter());
    const r = await tool.execute({ kind: "video" }, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("set_clip_volume tool", () => {
  it("returns unsupported error when host doesn't expose setClipVolume", async () => {
    const host = new NoneAdapter();
    Object.defineProperty(host, "setClipVolume", { value: undefined });
    const tool = createSetClipVolumeTool(host);
    const r = await tool.execute(
      { clipId: "x", volumeDb: -3 },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/does not support set_clip_volume/);
  });
});

describe("stabilize_video tool", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([true, false])(
    "rejects identical paths with ffmpeg available (%s)",
    async (available) => {
      const check = vi.spyOn(ffmpeg, "checkFfmpeg").mockReturnValue(available);
      const tool = createStabilizeVideoTool("/tmp");
      const r = await tool.execute(
        { input: "x.mp4", output: "./x.mp4" },
        ctx as Parameters<typeof tool.execute>[1],
      );
      expect(r).toMatch(/identical/);
      expect(check).not.toHaveBeenCalled();
    },
  );

  it("reports missing ffmpeg without creating the output directory", async () => {
    const { existsSync, mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-stabilize-"));
    const check = vi.spyOn(ffmpeg, "checkFfmpeg").mockReturnValue(false);
    try {
      const tool = createStabilizeVideoTool(dir);
      const r = await tool.execute({ input: "x.mp4", output: "output/y.mp4" }, ctx);
      expect(r).toBe("error: ffmpeg not on PATH; fix: install ffmpeg");
      expect(check).toHaveBeenCalledOnce();
      expect(existsSync(join(dir, "output"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pre_render_check tool", () => {
  it("reports block status when timeline is unreachable", async () => {
    const tool = createPreRenderCheckTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute({}, ctx as Parameters<typeof tool.execute>[1]);
    const parsed = JSON.parse(r as string);
    expect(["warn", "block"]).toContain(parsed.status);
    expect(Array.isArray(parsed.issues)).toBe(true);
  });
});

describe("clone_timeline tool", () => {
  it("surfaces unreachable host as an error", async () => {
    const tool = createCloneTimelineTool(new NoneAdapter());
    const r = await tool.execute({ newName: "v2" }, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("save_project tool", () => {
  it("surfaces unreachable host as an error", async () => {
    const tool = createSaveProjectTool(new NoneAdapter());
    const r = await tool.execute({}, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("write_ass tool", () => {
  it("writes a styled ASS file when given cues", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-ass-"));
    const tool = createWriteAssTool(dir);
    const r = await tool.execute(
      {
        output: "t.ass",
        cues: [{ start: 1, end: 2, text: "hello" }],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    const parsed = JSON.parse(r as string);
    expect(parsed.path).toBe(join(dir, "t.ass"));
    expect(parsed.cues).toBe(1);
    const content = readFileSync(parsed.path, "utf8");
    expect(content).toContain("[V4+ Styles]");
    expect(content).toContain("hello");
  });
});

describe("review_edit tool", () => {
  it("registers with the right name and description shape", () => {
    const tool = createReviewEditTool(new NoneAdapter(), "/tmp", {
      provider: "anthropic",
      model: "claude",
      apiKey: "test",
    });
    expect(tool.name).toBe("review_edit");
    expect(tool.description).toMatch(/critique/i);
  });
});

describe("reorder_timeline tool", () => {
  it("surfaces unreachable host as an error", async () => {
    const tool = createReorderTimelineTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute({ newOrder: ["x"] }, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/^error:/);
  });
});

describe("compose_layered tool", () => {
  it("writes an FCPXML in dryRun mode without touching the host", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-compose-"));
    const tool = createComposeLayeredTool(new NoneAdapter(), dir);
    const r = await tool.execute(
      {
        title: "t",
        frameRate: 30,
        layers: [
          {
            reel: "a",
            sourcePath: "/a.mov",
            sourceInFrame: 0,
            sourceOutFrame: 30,
            lane: 0,
            recordOffsetFrame: 0,
          },
          {
            reel: "b",
            sourcePath: "/b.mov",
            sourceInFrame: 0,
            sourceOutFrame: 15,
            lane: 1,
            recordOffsetFrame: 5,
          },
        ],
        fcpxmlOutput: "composed.fcpxml",
        dryRun: true,
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.layers).toBe(2);
    const xml = readFileSync(join(dir, "composed.fcpxml"), "utf8");
    expect(xml).toContain('lane="1"');
  });
});

describe("mix_audio tool", () => {
  it("rejects when no effects supplied", async () => {
    const tool = createMixAudioTool("/tmp");
    const r = await tool.execute(
      { input: "a.wav", output: "b.wav" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    // Either ffmpeg-missing error OR our 'no effects supplied' error.
    expect(r as string).toMatch(/^error:/);
  });
});

describe("write_lower_third tool", () => {
  it("writes an .ass file with \\move and \\fad overrides", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-lt-"));
    const tool = createWriteLowerThirdTool(dir);
    const r = await tool.execute(
      {
        output: "lt.ass",
        width: 1920,
        height: 1080,
        items: [
          {
            primaryText: "Jane",
            secondaryText: "Director",
            startSec: 0,
            durationSec: 3,
          },
        ],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.path).toBe(join(dir, "lt.ass"));
    const content = readFileSync(parsed.path, "utf8");
    expect(content).toContain("\\move");
    expect(content).toContain("\\fad");
    expect(content).toContain("Jane");
  });
});

describe("write_title_card tool", () => {
  it("writes an .ass file with fade-in-out by default", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-tc-"));
    const tool = createWriteTitleCardTool(dir);
    const r = await tool.execute(
      {
        output: "tc.ass",
        width: 1920,
        height: 1080,
        items: [{ text: "Chapter 1", startSec: 0, durationSec: 4 }],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(r as string);
    const content = readFileSync(parsed.path, "utf8");
    expect(content).toContain("Chapter 1");
    expect(content).toContain("\\fad(400,400)");
  });
});

describe("speed_ramp tool", () => {
  it("rejects when input == output", async () => {
    const tool = createSpeedRampTool("/tmp");
    const r = await tool.execute(
      {
        input: "x.mp4",
        output: "x.mp4",
        points: [
          { atSec: 0, speed: 1 },
          { atSec: 5, speed: 0.5 },
        ],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/identical|ffmpeg/);
  });
});

describe("ken_burns tool", () => {
  it("rejects when input == output", async () => {
    const tool = createKenBurnsTool("/tmp");
    const r = await tool.execute(
      { input: "x.jpg", output: "x.jpg", durationSec: 4 },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/identical|ffmpeg/);
  });
});

describe("grade_skin_tones tool", () => {
  it("rejects when OPENAI_API_KEY is missing", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const tool = createGradeSkinTonesTool("/tmp");
      const r = await tool.execute(
        {
          referenceVideo: "ref.mp4",
          referenceAtSec: 0,
          targetVideo: "tgt.mp4",
          targetAtSec: 0,
          output: "graded.mp4",
        },
        ctx as Parameters<typeof tool.execute>[1],
      );
      expect(r as string).toMatch(/^error:.*(OPENAI_API_KEY|ffmpeg)/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe("match_clip_color tool", () => {
  it("rejects when OPENAI_API_KEY is missing", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const tool = createMatchClipColorTool(new NoneAdapter(), "/tmp");
      const r = await tool.execute(
        {
          referenceVideo: "ref.mp4",
          referenceAtSec: 0,
          targetClipId: "x",
          targetAtSec: 0,
        },
        ctx as Parameters<typeof tool.execute>[1],
      );
      expect(r as string).toMatch(/^error:.*(OPENAI_API_KEY|ffmpeg)/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("surfaces NoneAdapter error when API key is set but no host is attached", async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-fake-key";
    try {
      const tool = createMatchClipColorTool(new NoneAdapter(), "/tmp");
      const r = await tool.execute(
        {
          referenceVideo: "ref.mp4",
          referenceAtSec: 0,
          targetClipId: "x",
          targetAtSec: 0,
        },
        ctx as Parameters<typeof tool.execute>[1],
      );
      // Either ffmpeg-missing OR NoneAdapter timeline error — both are clean errors.
      expect(r as string).toMatch(/^error:/);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe("transition_videos tool", () => {
  it("surfaces error when input file is missing", async () => {
    const tool = createTransitionVideosTool("/tmp");
    const r = await tool.execute(
      {
        inputA: "/no/a.mp4",
        inputB: "/no/b.mp4",
        output: "/tmp/out.mp4",
        preset: "smash-cut",
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r as string).toMatch(/^error:/);
  });
});

describe("cut_filler_words tool", () => {
  it("errors cleanly when transcript is missing", async () => {
    const tool = createCutFillerWordsTool("/tmp");
    const r = await tool.execute(
      {
        transcript: "/no/such/transcript.json",
        sourceVideo: "/no/such/video.mp4",
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r as string).toMatch(/^error:/);
  });

  it("rejects transcripts without word timings", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-fillercut-"));
    const path = join(dir, "transcript.json");
    writeFileSync(
      path,
      JSON.stringify({
        language: "en",
        durationSec: 5,
        segments: [{ start: 0, end: 5, text: "um hello uh world" }],
      }),
    );
    const tool = createCutFillerWordsTool(dir);
    const r = await tool.execute(
      { transcript: "transcript.json", sourceVideo: "video.mp4" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r as string).toMatch(/no word-level timings/);
  });
});

describe("punch_in tool", () => {
  it("rejects when neither ranges nor cutPoints supplied", async () => {
    const tool = createPunchInTool("/tmp");
    const r = await tool.execute(
      { input: "in.mp4", output: "out.mp4" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    // Either ffmpeg-missing OR our 'neither ranges nor cutPoints' error
    // OR probe failure on a missing file. All are clean errors.
    expect(r as string).toMatch(/^error:/);
  });

  it("rejects when input == output", async () => {
    const tool = createPunchInTool("/tmp");
    const r = await tool.execute(
      {
        input: "a.mp4",
        output: "a.mp4",
        ranges: [{ startSec: 1, endSec: 2 }],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r as string).toMatch(/identical|ffmpeg/);
  });
});

describe("analyze_hook tool", () => {
  it("rejects when OPENAI_API_KEY is missing", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const tool = createAnalyzeHookTool("/tmp");
      const r = await tool.execute(
        { input: "video.mp4" },
        ctx as Parameters<typeof tool.execute>[1],
      );
      expect(r as string).toMatch(/^error:.*(OPENAI_API_KEY|ffmpeg)/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe("write_keyword_captions tool", () => {
  it("emits an .ass file with two styles for a word-timestamped transcript", async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-kw-"));
    const transcriptPath = join(dir, "t.json");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        language: "en",
        durationSec: 2,
        segments: [
          {
            start: 0,
            end: 2,
            text: "the retention graph spikes",
            words: [
              { start: 0, end: 0.3, text: "the" },
              { start: 0.35, end: 0.85, text: "retention" },
              { start: 0.9, end: 1.3, text: "graph" },
              { start: 1.35, end: 1.9, text: "spikes" },
            ],
          },
        ],
      }),
    );
    const tool = createWriteKeywordCaptionsTool(dir);
    const r = await tool.execute(
      { transcript: "t.json", output: "caps.ass" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.path).toBe(join(dir, "caps.ass"));
    const ass = readFileSync(parsed.path, "utf8");
    expect(ass).toContain("Style: Default");
    expect(ass).toContain("Style: Keyword");
    expect(ass).toContain("retention");
  });

  it("errors when the transcript has no word timings", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-kw-"));
    const path = join(dir, "t.json");
    writeFileSync(
      path,
      JSON.stringify({
        language: "en",
        durationSec: 1,
        segments: [{ start: 0, end: 1, text: "no word timings here" }],
      }),
    );
    const tool = createWriteKeywordCaptionsTool(dir);
    const r = await tool.execute(
      { transcript: "t.json", output: "caps.ass" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r as string).toMatch(/no word timings/);
  });
});

describe("add_sfx_at_cuts tool", () => {
  it("surfaces a clean error when input file is missing", async () => {
    const tool = createAddSfxAtCutsTool("/tmp");
    const r = await tool.execute(
      {
        input: "/no/such/in.mp4",
        sfx: "/no/such/whoosh.wav",
        output: "/tmp/out.mp4",
        cutPoints: [1, 2, 3],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r as string).toMatch(/^error:/);
  });

  it("rejects when input == output", async () => {
    const tool = createAddSfxAtCutsTool("/tmp");
    const r = await tool.execute(
      {
        input: "a.mp4",
        sfx: "sfx.wav",
        output: "a.mp4",
        cutPoints: [1],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r as string).toMatch(/identical|ffmpeg/);
  });
});
