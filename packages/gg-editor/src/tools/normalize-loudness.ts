import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import {
  applyLoudnorm,
  measureLoudness,
  PLATFORM_TARGETS,
  type LoudnessTarget,
} from "../core/loudness.js";
import { checkFfmpeg, probeMedia } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const PlatformEnum = z.enum([
  "youtube",
  "spotify",
  "apple-podcasts",
  "podcast",
  "broadcast-r128",
  "tiktok",
  "instagram",
]);

const NormalizeLoudnessParams = z.object({
  input: z.string().describe("Source media file (audio or video)."),
  output: z.string().describe("Where to write the normalized file."),
  platform: PlatformEnum.optional().describe(
    "Preset target. youtube/spotify/tiktok/instagram=-14 LUFS; podcast/apple=-16; broadcast-r128=-23.",
  ),
  integratedLufs: z
    .number()
    .negative()
    .optional()
    .describe("Custom integrated loudness target. Overrides platform."),
  truePeakDb: z.number().negative().optional().describe("True peak ceiling. Default -1 dBTP."),
  loudnessRange: z.number().positive().optional().describe("LRA target. Default 11 LU."),
});

export function createNormalizeLoudnessTool(
  cwd: string,
): AgentTool<typeof NormalizeLoudnessParams> {
  return {
    name: "normalize_loudness",
    description:
      "Two-pass EBU R128 loudness normalization (ffmpeg loudnorm). " +
      "Writes a new file at the platform target. Default targets: youtube=-14, " +
      "podcast=-16, broadcast-r128=-23 LUFS. Use BEFORE rendering to ensure your " +
      "output meets the platform spec — loudness violations are the #1 reason " +
      "uploads sound 'quiet' or 'too hot' to listeners.",
    parameters: NormalizeLoudnessParams,
    async execute({ input, output, platform, integratedLufs, truePeakDb, loudnessRange }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, input);
        const outAbs = safeOutputPath(cwd, output);
        if (inAbs === outAbs) {
          return err("input and output paths are identical", "use a different output path");
        }
        let target: LoudnessTarget;
        if (integratedLufs !== undefined) {
          target = { integratedLufs, truePeakDb, loudnessRange };
        } else if (platform) {
          target = { ...PLATFORM_TARGETS[platform] };
          if (truePeakDb !== undefined) target.truePeakDb = truePeakDb;
          if (loudnessRange !== undefined) target.loudnessRange = loudnessRange;
        } else {
          return err(
            "neither platform nor integratedLufs supplied",
            "pass platform=youtube|podcast|... OR integratedLufs=-14",
          );
        }
        mkdirSync(dirname(outAbs), { recursive: true });
        // Auto-detect mono → enable dual_mono so loudnorm measures correctly.
        const probe = probeMedia(inAbs);
        const dualMono = probe?.audioChannels === 1;
        const measurement = await measureLoudness(inAbs, {
          signal: ctx.signal,
          dualMono,
        });
        await applyLoudnorm(inAbs, outAbs, measurement, target, {
          signal: ctx.signal,
          dualMono,
        });
        return compact({
          ok: true,
          path: outAbs,
          ...(dualMono ? { dualMono: true } : {}),
          source: {
            i: +measurement.inputI.toFixed(2),
            tp: +measurement.inputTp.toFixed(2),
            lra: +measurement.inputLra.toFixed(2),
          },
          target: {
            i: target.integratedLufs,
            tp: target.truePeakDb ?? -1,
            lra: target.loudnessRange ?? 11,
          },
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
