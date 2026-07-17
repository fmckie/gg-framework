import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { applyMix, type AudioChain } from "../core/audio-mix.js";
import { compact, err } from "../core/format.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const EqBandSchema = z.object({
  type: z.enum(["low", "high", "peak", "shelf-low", "shelf-high"]),
  freqHz: z.number().positive(),
  gainDb: z.number().optional(),
  q: z.number().positive().optional(),
});

const MixAudioParams = z.object({
  input: z.string(),
  output: z.string(),
  eq: z
    .array(EqBandSchema)
    .optional()
    .describe(
      "Equalizer bands. Order: high-pass to remove rumble, peak boosts at " +
        "presence (3-5kHz for voice), low-pass to tame harshness.",
    ),
  compressor: z
    .object({
      thresholdDb: z.number(),
      ratio: z.number().positive(),
      attackMs: z.number().positive().optional(),
      releaseMs: z.number().positive().optional(),
      makeupDb: z.number().optional(),
    })
    .optional(),
  gate: z
    .object({
      thresholdDb: z.number(),
      ratio: z.number().positive().optional(),
      attackMs: z.number().positive().optional(),
      releaseMs: z.number().positive().optional(),
    })
    .optional(),
  reverb: z
    .object({
      roomSize: z.number().min(0).max(1),
      wetDryMix: z.number().min(0).max(1),
    })
    .optional(),
  deess: z
    .object({
      freqHz: z.number().positive().optional(),
      thresholdDb: z.number().optional(),
    })
    .optional(),
  limiter: z
    .object({
      ceilingDb: z.number(),
      releaseMs: z.number().positive().optional(),
    })
    .optional(),
});

export function createMixAudioTool(cwd: string): AgentTool<typeof MixAudioParams> {
  return {
    name: "mix_audio",
    description:
      "File-only audio mixer: EQ bands + compressor + gate + reverb + de-esser + limiter " +
      "in one ffmpeg pass. Order applied: gate → eq → de-ess → comp → reverb → limiter " +
      "(canonical mix-bus ordering). Run AFTER clean_audio and BEFORE normalize_loudness. " +
      "Use small moves: 2-3 dB at a time. For voice: highpass=80Hz, peak +3dB at 4kHz, " +
      "compressor threshold=-18dB ratio=4, limiter ceiling=-1dB.",
    parameters: MixAudioParams,
    async execute({ input, output, ...chain }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, input);
        const outAbs = safeOutputPath(cwd, output);
        if (inAbs === outAbs) {
          return err("input and output paths are identical", "use a different output path");
        }
        const audioChain: AudioChain = {
          eq: chain.eq,
          compressor: chain.compressor,
          gate: chain.gate,
          reverb: chain.reverb,
          deess: chain.deess,
          limiter: chain.limiter,
        };
        if (
          !audioChain.eq?.length &&
          !audioChain.compressor &&
          !audioChain.gate &&
          !audioChain.reverb &&
          !audioChain.deess &&
          !audioChain.limiter
        ) {
          return err(
            "no effects supplied",
            "pass at least one of eq/comp/gate/reverb/deess/limiter",
          );
        }
        mkdirSync(dirname(outAbs), { recursive: true });
        await applyMix(inAbs, outAbs, audioChain, { signal: ctx.signal });
        return compact({ ok: true, path: outAbs });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
