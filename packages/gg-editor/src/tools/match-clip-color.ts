import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { extractAtTimes } from "../core/frames.js";
import type { VideoHost } from "../core/hosts/types.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { deriveSkinGrade } from "../core/skin-grade.js";

const MatchClipColorParams = z.object({
  referenceVideo: z.string().describe("Reference video file (skin look you want)."),
  referenceAtSec: z.number().min(0).describe("Time in the reference to sample."),
  targetClipId: z.string().min(1).describe("Target clip id (from get_timeline)."),
  targetAtSec: z
    .number()
    .min(0)
    .describe("Time within the target clip's source media to sample (face-forward)."),
  nodeIndex: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based node index for set_primary_correction. Default 1."),
  detail: z.enum(["low", "high"]).optional().describe("Vision detail. Default low."),
  model: z.string().optional().describe("OpenAI model id. Default gpt-4o-mini."),
  applyAutomatically: z
    .boolean()
    .optional()
    .describe(
      "If true and confidence ≥ 0.4, apply the CDL via set_primary_correction. Default false.",
    ),
});

/**
 * match_clip_color — non-baked skin-tone match (Resolve only). Derives the
 * same vision-tuned grade as `grade_skin_tones` but pipes the CDL portion
 * through `host.setPrimaryCorrection`. The grade is non-destructive (lives
 * in the clip's grading node, not in the file).
 *
 * `applyAutomatically` defaults to false: the tool returns the grade and
 * lets the agent decide. When true and confidence ≥ 0.4 the CDL is
 * applied; below 0.4 it's still returned but skipped with a warning.
 */
export function createMatchClipColorTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof MatchClipColorParams> {
  return {
    name: "match_clip_color",
    description:
      "Vision-derived skin-tone match piped to set_primary_correction (Resolve only — " +
      "non-baked, lives in the grade node). Returns {grade, applied}. Below confidence 0.4 " +
      "the grade is unreliable — surfaced but never auto-applied. For a baked-file path " +
      "that works in every host, use grade_skin_tones instead.",
    parameters: MatchClipColorParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      if (!process.env.OPENAI_API_KEY) {
        return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
      }
      try {
        const refAbs = resolvePath(cwd, args.referenceVideo);

        const timeline = await host.getTimeline();
        const targetClip = timeline.clips.find((c) => c.id === args.targetClipId);
        if (!targetClip) {
          return err(`clip ${args.targetClipId} not found in active timeline`);
        }
        if (!targetClip.sourcePath) {
          return err(`clip ${args.targetClipId} has no sourcePath; cannot sample target frame`);
        }

        const [refFrame] = await extractAtTimes(refAbs, [args.referenceAtSec], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        const [tgtFrame] = await extractAtTimes(targetClip.sourcePath, [args.targetAtSec], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        const grade = await deriveSkinGrade(refFrame.path, tgtFrame.path, {
          detail: args.detail,
          model: args.model,
          signal: ctx.signal,
        });

        let applied = false;
        if (args.applyAutomatically && grade.confidence >= 0.4) {
          await host.setPrimaryCorrection(args.targetClipId, {
            slope: grade.cdl.slope,
            offset: grade.cdl.offset,
            power: grade.cdl.power,
            saturation: grade.cdl.saturation,
            nodeIndex: args.nodeIndex,
          });
          applied = true;
        }

        return compact({
          applied,
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
