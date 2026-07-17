import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err, summarizeList } from "../core/format.js";
import { extractAtInterval, extractAtTimes, type ExtractedFrame } from "../core/frames.js";
import { checkFfmpeg, probeMedia } from "../core/media/ffmpeg.js";
import { scoreFrames, type ShotScore } from "../core/vision.js";

const ScoreShotParams = z.object({
  input: z.string().describe("Video file path (relative resolves to cwd)."),
  /**
   * Either provide explicit timestamps (precise, one ffmpeg call per frame)
   * or an interval (fast, single ffmpeg pass). One is required.
   */
  times: z
    .array(z.number().min(0))
    .optional()
    .describe("Specific seconds to sample. Use for targeted inspection."),
  intervalSec: z
    .number()
    .positive()
    .optional()
    .describe("Sample every N seconds. Use for whole-video coverage."),
  startSec: z.number().min(0).optional(),
  endSec: z.number().min(0).optional(),
  detail: z
    .enum(["low", "high"])
    .optional()
    .describe("Vision detail. low ≈ 85 tok/img (cheap), high ≈ 700 tok/img (more accurate)."),
  model: z.string().optional().describe("OpenAI model id (default gpt-4o-mini)."),
  maxFrames: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Hard cap on frames sent (default 30). Agent should respect cost."),
});

export function createScoreShotTool(cwd: string): AgentTool<typeof ScoreShotParams> {
  return {
    name: "score_shot",
    description:
      "AI vision: rate frames 0-10 on composition, focus, subject clarity, energy. " +
      "Use to find best/worst shots, identify blurry takes, or pick hero frames. " +
      "Either pass `times` for targeted inspection OR `intervalSec` for whole-video coverage. " +
      "Default returns top/worst 5 + per-frame compact list. Requires OPENAI_API_KEY.",
    parameters: ScoreShotParams,
    async execute(args, ctx) {
      try {
        if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
        if (!process.env.OPENAI_API_KEY) {
          return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
        }
        const { input, times, intervalSec, detail, model, maxFrames = 30 } = args;
        if (!times && !intervalSec) {
          return err(
            "provide either `times` or `intervalSec`",
            "e.g. intervalSec=30 or times=[10,45,90]",
          );
        }

        const abs = resolvePath(cwd, input);
        const probe = probeMedia(abs);
        if (!probe) return err(`probe failed for ${abs}`);

        const startSec = args.startSec ?? 0;
        const endSec = args.endSec ?? probe.durationSec;
        const window = Math.max(0, endSec - startSec);
        if (window <= 0) return err("endSec must be > startSec");

        // Frame extraction
        let frames: ExtractedFrame[];
        if (times && times.length > 0) {
          const filtered = times.filter((t) => t >= startSec && t < endSec).slice(0, maxFrames);
          if (filtered.length === 0) return err("no times fall within [startSec, endSec)");
          frames = await extractAtTimes(abs, filtered, {
            maxWidth: 1280,
            signal: ctx.signal,
          });
        } else {
          // Auto-cap interval if it would produce > maxFrames
          let effectiveInterval = intervalSec!;
          const wouldProduce = Math.floor(window / effectiveInterval);
          if (wouldProduce > maxFrames) {
            effectiveInterval = window / maxFrames;
          }
          // extractAtInterval samples relative to file 0; we need to slice the
          // window by adjusting input. For simplicity, sample whole file then
          // filter to [startSec, endSec). For long videos with small windows,
          // ffmpeg input -ss/-t would be faster — defer optimisation.
          const all = await extractAtInterval(abs, effectiveInterval, probe.durationSec, {
            maxWidth: 1280,
            signal: ctx.signal,
          });
          frames = all.filter((f) => f.atSec >= startSec && f.atSec < endSec);
          if (frames.length > maxFrames) frames = frames.slice(0, maxFrames);
        }

        if (frames.length === 0) return err("no frames extracted");

        // Score
        const scores = await scoreFrames(frames, {
          model,
          detail,
          signal: ctx.signal,
        });

        // Sort + summarize
        const sorted = [...scores].sort((a, b) => b.score - a.score);
        const top = sorted.slice(0, 5).map(roundShot);
        const worst = sorted.slice(-5).reverse().map(roundShot); // worst first
        const all = scores.map(roundShot);
        const allSummary = summarizeList(all, 30);

        return compact({
          frames: scores.length,
          window: { startSec, endSec },
          top,
          worst,
          ...(allSummary.omitted > 0
            ? { omitted: allSummary.omitted, head: allSummary.head, tail: allSummary.tail }
            : { all }),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function roundShot(s: ShotScore): { at: number; score: number; why: string } {
  return { at: +s.atSec.toFixed(2), score: s.score, why: s.why };
}
