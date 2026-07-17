import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const AddFadesParams = z.object({
  input: z.string().describe("Source video file."),
  output: z.string().describe("Output path."),
  fadeInSec: z
    .number()
    .min(0)
    .optional()
    .describe("Video + audio fade-in duration. 0 disables. Default 0."),
  fadeOutSec: z
    .number()
    .min(0)
    .optional()
    .describe("Video + audio fade-out duration. 0 disables. Default 0."),
  videoCodec: z.string().optional().describe("Default libx264."),
  crf: z.number().int().min(0).max(51).optional().describe("Default 20."),
});

export function createAddFadesTool(cwd: string): AgentTool<typeof AddFadesParams> {
  return {
    name: "add_fades",
    description:
      "Add fade-in / fade-out to both video and audio. Standard polish on outputs that don't " +
      "live inside a longer timeline. Defaults to 0/0 (no-op) unless you specify durations. " +
      "Re-encodes (fades can't be applied losslessly).",
    parameters: AddFadesParams,
    async execute({ input, output, fadeInSec = 0, fadeOutSec = 0, videoCodec, crf }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      if (fadeInSec === 0 && fadeOutSec === 0) {
        return err("both fadeInSec and fadeOutSec are 0", "specify at least one duration > 0");
      }
      try {
        const inAbs = resolvePath(cwd, input);
        const outAbs = safeOutputPath(cwd, output);
        if (inAbs === outAbs) {
          return err("input and output paths are identical", "pick a different output");
        }
        const probe = probeMedia(inAbs);
        if (!probe) return err(`probe failed for ${inAbs}`);
        const dur = probe.durationSec;
        if (fadeOutSec > 0 && fadeOutSec >= dur) {
          return err(
            `fadeOutSec (${fadeOutSec}) >= duration (${dur.toFixed(2)})`,
            "fade-out must fit inside the clip",
          );
        }

        const vfilters: string[] = [];
        const afilters: string[] = [];
        if (fadeInSec > 0) {
          vfilters.push(`fade=in:st=0:d=${fadeInSec}`);
          afilters.push(`afade=in:st=0:d=${fadeInSec}`);
        }
        if (fadeOutSec > 0) {
          const start = +(dur - fadeOutSec).toFixed(3);
          vfilters.push(`fade=out:st=${start}:d=${fadeOutSec}`);
          afilters.push(`afade=out:st=${start}:d=${fadeOutSec}`);
        }
        mkdirSync(dirname(outAbs), { recursive: true });
        const args = [
          "-i",
          inAbs,
          "-vf",
          vfilters.join(","),
          "-af",
          afilters.join(","),
          "-c:v",
          videoCodec ?? "libx264",
          "-crf",
          String(crf ?? 20),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outAbs,
        ];
        const r = await runFfmpeg(args, { signal: ctx.signal });
        if (r.code !== 0) return err(`ffmpeg exited ${r.code}`);
        return compact({ ok: true, path: outAbs, fadeInSec, fadeOutSec });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
