import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { buildAtempo, buildSetpts } from "../core/speed-ramp.js";
import { safeOutputPath } from "../core/safe-paths.js";

const SpeedPointSchema = z.object({
  atSec: z.number().min(0).describe("Time in the input where this segment begins."),
  speed: z
    .number()
    .positive()
    .describe("Speed multiplier from this point. 1=normal, 0.5=slow-mo, 2=fast."),
});

const SpeedRampParams = z.object({
  input: z.string(),
  output: z.string(),
  points: z
    .array(SpeedPointSchema)
    .min(2)
    .describe(
      "Speed-ramp control points. Min 2 (start + end). Strictly-increasing atSec. " +
        "Three-point ramp 1→0.5→1 = classic slow-down-then-resume.",
    ),
  /** When true, drop the audio entirely. */
  muteAudio: z.boolean().optional(),
});

export function createSpeedRampTool(cwd: string): AgentTool<typeof SpeedRampParams> {
  return {
    name: "speed_ramp",
    description:
      "File-only piecewise speed ramp via setpts. Slow-mo and fast-forward in one pass. " +
      "Audio is time-stretched via atempo (chained for >2× ranges). Use 3 points for " +
      "smooth-feeling ramps (1→0.5→1). For complex curves, do separate ramps and concat. " +
      "Re-encodes the video — output is libx264.",
    parameters: SpeedRampParams,
    async execute({ input, output, points, muteAudio }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, input);
        const outAbs = safeOutputPath(cwd, output);
        if (inAbs === outAbs) {
          return err("input and output paths are identical");
        }
        const setpts = buildSetpts(points);
        const tempo = buildAtempo(points);
        const videoFilter = setpts;
        const audioFilter = tempo.filter;
        mkdirSync(dirname(outAbs), { recursive: true });
        const args: string[] = ["-i", inAbs, "-vf", videoFilter];
        if (muteAudio) {
          args.push("-an");
        } else if (audioFilter) {
          args.push("-af", audioFilter);
        }
        args.push(
          "-c:v",
          "libx264",
          "-crf",
          "20",
          "-preset",
          "veryfast",
          ...(muteAudio ? [] : ["-c:a", "aac", "-b:a", "192k"]),
          outAbs,
        );
        const r = await runFfmpeg(args, { signal: ctx.signal });
        if (r.code !== 0) return err(`ffmpeg exited ${r.code}`);
        return compact({
          ok: true,
          path: outAbs,
          segments: points.length - 1,
          avgSpeed: tempo.avgSpeed,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
