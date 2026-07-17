import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { measureLoudness } from "../core/loudness.js";
import { checkFfmpeg, probeMedia } from "../core/media/ffmpeg.js";

const MeasureLoudnessParams = z.object({
  input: z.string().describe("Media file (audio or video)."),
});

export function createMeasureLoudnessTool(cwd: string): AgentTool<typeof MeasureLoudnessParams> {
  return {
    name: "measure_loudness",
    description:
      "Measure the source's integrated loudness (I), true peak (TP), and loudness range (LRA). " +
      "Read-only — does not produce a file. Use BEFORE deciding to normalize: if I is already " +
      "within ±1 LU of the platform target and TP < -1 dBTP, you can skip normalize_loudness.",
    parameters: MeasureLoudnessParams,
    async execute({ input }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const abs = resolvePath(cwd, input);
        const probe = probeMedia(abs);
        const dualMono = probe?.audioChannels === 1;
        const m = await measureLoudness(abs, { signal: ctx.signal, dualMono });
        return compact({
          path: abs,
          channels: probe?.audioChannels,
          ...(dualMono ? { dualMono: true } : {}),
          i: +m.inputI.toFixed(2),
          tp: +m.inputTp.toFixed(2),
          lra: +m.inputLra.toFixed(2),
          thresh: +m.inputThresh.toFixed(2),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
