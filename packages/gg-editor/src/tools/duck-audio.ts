import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { duckAudio } from "../core/ducking.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";

const DuckAudioParams = z.object({
  voice: z.string().describe("Voice / dialogue track (audio or video file)."),
  background: z.string().describe("Music or ambient track to duck."),
  output: z.string().describe("Mixed output path."),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Sidechain threshold (linear amplitude, 0-1). Voice ABOVE this triggers ducking. " +
        "Default 0.02 matches typical dialogue average energy. Try 0.012 for very quiet voices, " +
        "0.05 if music keeps ducking on background noise.",
    ),
  ratio: z
    .number()
    .min(1)
    .optional()
    .describe("Compression ratio. Default 8 (heavy duck — typical podcast)."),
  attackMs: z.number().min(0).optional().describe("Attack in ms. Default 5."),
  releaseMs: z
    .number()
    .min(0)
    .optional()
    .describe("Release in ms. Default 250 — music breathes back gradually."),
  voiceGain: z.number().min(0).optional().describe("Voice level multiplier. Default 1."),
  bgGain: z
    .number()
    .min(0)
    .optional()
    .describe("Background level multiplier (pre-duck). Default 1."),
});

export function createDuckAudioTool(cwd: string): AgentTool<typeof DuckAudioParams> {
  return {
    name: "duck_audio",
    description:
      "Sidechain ducking: lower a music/ambient track when voice is present (then bring it " +
      "back when silent). Standard podcast/YouTube technique. Defaults are tuned for spoken " +
      "voice over music. Output is a single mixed audio file. Run AFTER take selection / " +
      "filler removal but BEFORE normalize_loudness.",
    parameters: DuckAudioParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const voiceAbs = resolvePath(cwd, args.voice);
        const bgAbs = resolvePath(cwd, args.background);
        const outAbs = resolvePath(cwd, args.output);
        if (voiceAbs === outAbs || bgAbs === outAbs) {
          return err("output path collides with an input", "use a different output path");
        }
        mkdirSync(dirname(outAbs), { recursive: true });
        const r = await duckAudio(voiceAbs, bgAbs, outAbs, {
          threshold: args.threshold,
          ratio: args.ratio,
          attackMs: args.attackMs,
          releaseMs: args.releaseMs,
          voiceGain: args.voiceGain,
          bgGain: args.bgGain,
          signal: ctx.signal,
        });
        return compact({ ok: true, path: r.output });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
