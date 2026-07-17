import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { applyCleanup } from "../core/audio-cleanup.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const CleanAudioParams = z.object({
  input: z.string().describe("Source media file."),
  output: z.string().describe("Where to write the cleaned file."),
  mode: z
    .enum(["denoise", "denoise-strong", "rnnoise", "dehum", "deess"])
    .describe(
      "Cleanup type: denoise (mild afftdn) / denoise-strong / rnnoise " +
        "(needs rnnoiseModel) / dehum / deess.",
    ),
  rnnoiseModel: z
    .string()
    .optional()
    .describe("Path to an arnndn .rnnn model. Required for mode=rnnoise."),
  mainsHz: z
    .union([z.literal(50), z.literal(60)])
    .optional()
    .describe("Mains frequency for dehum. 50=most of world, 60=North America."),
});

export function createCleanAudioTool(cwd: string): AgentTool<typeof CleanAudioParams> {
  return {
    name: "clean_audio",
    description:
      "Audio cleanup pass. Modes: denoise (afftdn mild — most podcasts), denoise-strong (loud HVAC/fan), " +
      "rnnoise (RNN denoiser, needs model), dehum (50/60Hz mains buzz), deess (harsh sibilance). " +
      "Run BEFORE normalize_loudness. Don't stack denoise modes — pick one.",
    parameters: CleanAudioParams,
    async execute({ input, output, mode, rnnoiseModel, mainsHz }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, input);
        const outAbs = safeOutputPath(cwd, output);
        if (inAbs === outAbs) {
          return err("input and output paths are identical", "use a different output path");
        }
        const modelAbs = rnnoiseModel ? resolvePath(cwd, rnnoiseModel) : undefined;
        mkdirSync(dirname(outAbs), { recursive: true });
        await applyCleanup(inAbs, outAbs, mode, {
          rnnoiseModel: modelAbs,
          mainsHz,
          signal: ctx.signal,
        });
        return compact({ ok: true, path: outAbs, mode });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
