import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { extractAtTimes } from "../core/frames.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { applySkinGrade, deriveSkinGrade } from "../core/skin-grade.js";

const GradeSkinTonesParams = z.object({
  referenceVideo: z.string().describe("Reference video file (skin look you want)."),
  referenceAtSec: z.number().min(0).describe("Time in the reference to sample."),
  targetVideo: z.string().describe("Target video file (clip you want to match)."),
  targetAtSec: z.number().min(0).describe("Time in the target to sample (face-forward)."),
  output: z
    .string()
    .min(1)
    .describe("Output graded file (relative resolves to cwd). Re-encoded; audio is copied."),
  detail: z.enum(["low", "high"]).optional().describe("Vision detail. Default low."),
  model: z.string().optional().describe("OpenAI model id. Default gpt-4o-mini."),
  videoCodec: z.string().optional().describe("ffmpeg video codec. Default libx264."),
  crf: z
    .number()
    .int()
    .min(0)
    .max(51)
    .optional()
    .describe("x264 CRF. Default 18 (visually lossless)."),
});

/**
 * grade_skin_tones — file-only skin-tone match across clips. Derives a
 * vision-tuned grade from REFERENCE vs TARGET frames and bakes it into a
 * graded output via ffmpeg (colorbalance + selectivecolor + eq). Works on
 * every host (no NLE required); the agent can then `replace_clip` the
 * graded file onto the timeline.
 *
 * NOT a deterministic match (no ColorChecker). Use when "shots feel off"
 * (different camera, location, white balance drift). Below confidence 0.4
 * the grade is unreliable — surface the result and let the user grade
 * manually.
 */
export function createGradeSkinTonesTool(cwd: string): AgentTool<typeof GradeSkinTonesParams> {
  return {
    name: "grade_skin_tones",
    description:
      "File-only skin-tone match: bakes a vision-derived grade (colorbalance + selectivecolor " +
      "+ eq, tuned for reds/yellows where skin lives) into a new video file. Works in every " +
      "host. Returns {path, confidence, why, grade}. ALWAYS check `confidence`; below 0.4 " +
      "means the model is guessing — show the user, don't apply blindly. Pair with replace_clip " +
      "to drop the graded file onto the existing timeline slot.",
    parameters: GradeSkinTonesParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      if (!process.env.OPENAI_API_KEY) {
        return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
      }
      try {
        const refAbs = resolvePath(cwd, args.referenceVideo);
        const tgtAbs = resolvePath(cwd, args.targetVideo);
        const outAbs = resolvePath(cwd, args.output);
        if (outAbs === tgtAbs) {
          return err("output and target are identical", "use a different output path");
        }
        const [refFrame] = await extractAtTimes(refAbs, [args.referenceAtSec], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        const [tgtFrame] = await extractAtTimes(tgtAbs, [args.targetAtSec], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        const grade = await deriveSkinGrade(refFrame.path, tgtFrame.path, {
          detail: args.detail,
          model: args.model,
          signal: ctx.signal,
        });
        await applySkinGrade(tgtAbs, outAbs, grade, {
          videoCodec: args.videoCodec,
          crf: args.crf,
          signal: ctx.signal,
        });
        return compact({
          path: outAbs,
          confidence: grade.confidence,
          why: grade.why,
          grade,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
