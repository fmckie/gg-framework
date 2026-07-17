import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { extractAtTimes } from "../core/frames.js";
import { checkFfmpeg, probeMedia } from "../core/media/ffmpeg.js";
import { runThumbnailPromise } from "../core/thumbnail-promise.js";

const VerifyThumbnailPromiseParams = z.object({
  thumbnail: z.string().describe("Path to the thumbnail .jpg/.png (relative resolves to cwd)."),
  video: z.string().describe("Path to the source video the thumbnail accompanies."),
  windowSec: z
    .number()
    .positive()
    .max(120)
    .optional()
    .describe(
      "How much of the opening to sample. Default 60s — short-form delivery's danger zone is " +
        "the first minute.",
    ),
  sampleCount: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe("Frames sampled within the window. Default 3 (taken at 0%, 50%, 100% of windowSec)."),
  detail: z.enum(["low", "high"]).optional().describe("Vision detail. Default low."),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
});

/**
 * verify_thumbnail_promise — does the opening deliver on the thumbnail?
 *
 * Per MrBeast's manual: "match the clickbait expectations and
 * front-load." Thumbnails that promise X but show X at minute 8 tank
 * retention. ONE vision LLM call against thumbnail + N sampled frames.
 */
export function createVerifyThumbnailPromiseTool(
  cwd: string,
): AgentTool<typeof VerifyThumbnailPromiseParams> {
  return {
    name: "verify_thumbnail_promise",
    description:
      "Verify a thumbnail's visual promise is delivered in the first N seconds of the video " +
      "(default 60s). Per MrBeast's manual: 'match clickbait expectations, front-load' — " +
      "thumbnails that promise X but show X at minute 8 tank retention. ONE vision LLM " +
      "call. Returns matches (0-1), what the thumbnail promises, what the opening actually " +
      "shows, missing elements, and a one-line suggestion. ALWAYS run before declaring done " +
      "on any short-form delivery. Pair with `audit_first_frame` and `analyze_hook` as the " +
      "three short-form pre-render checks.",
    parameters: VerifyThumbnailPromiseParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      if (!process.env.OPENAI_API_KEY) {
        return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
      }
      try {
        const thumbAbs = resolvePath(cwd, args.thumbnail);
        const videoAbs = resolvePath(cwd, args.video);
        const probe = probeMedia(videoAbs);
        if (!probe) {
          return err(`probe failed for ${videoAbs}`, "verify file exists and is media");
        }
        const windowSec = Math.min(args.windowSec ?? 60, probe.durationSec);
        if (windowSec < 1) {
          return err("video shorter than 1s — nothing to verify against");
        }

        const sampleCount = Math.min(8, Math.max(1, args.sampleCount ?? 3));
        const times = sampleTimes(windowSec, sampleCount);
        const frames = await extractAtTimes(videoAbs, times, {
          maxWidth: 768,
          signal: ctx.signal,
        });
        if (frames.length === 0) {
          return err("could not extract opening frames");
        }

        const result = await runThumbnailPromise(
          thumbAbs,
          frames.map((f) => f.path),
          {
            model: args.model,
            detail: args.detail,
            windowSec,
            signal: ctx.signal,
          },
        );

        return compact({
          matches: +result.matches.toFixed(2),
          thumbnailPromise: result.thumbnailPromise,
          openingShows: result.openingShows,
          missing: result.missing,
          suggestion: result.suggestion,
          windowSec: +windowSec.toFixed(2),
          sampleCount: frames.length,
          sampledAt: times.map((t) => +t.toFixed(2)),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Compute N sample timestamps evenly distributed across [0, windowSec].
 *  - 1 sample → [0]
 *  - 2 samples → [0, windowSec]
 *  - 3 samples → [0, windowSec/2, windowSec]
 *  - 4+ → endpoints + interior at equal stride
 *
 * Pure — exported for testing.
 */
export function sampleTimes(windowSec: number, n: number): number[] {
  if (n <= 1 || windowSec <= 0) return [0];
  const out: number[] = [];
  const step = windowSec / (n - 1);
  for (let i = 0; i < n; i++) out.push(+(i * step).toFixed(3));
  return out;
}
