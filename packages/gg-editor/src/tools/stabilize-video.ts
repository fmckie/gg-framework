import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";
import { stabilize } from "../core/stabilize.js";

const StabilizeVideoParams = z.object({
  input: z.string().describe("Source video file."),
  output: z.string().describe("Where to write the stabilized file."),
  shakiness: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("How shaky the input is. 1=tripod-shake, 10=dropped-on-skateboard. Default 5."),
  smoothing: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Camera-path smoothing window in frames. Higher = more aggressive. Default 15."),
  zoom: z
    .number()
    .min(-10)
    .max(10)
    .optional()
    .describe("Output zoom percent (-10..10). Use ~5 to hide stabilization borders."),
});

export function createStabilizeVideoTool(cwd: string): AgentTool<typeof StabilizeVideoParams> {
  return {
    name: "stabilize_video",
    description:
      "Two-pass ffmpeg vidstab stabilization. Pass 1 analyses motion; pass 2 applies the inverse. " +
      "Requires ffmpeg compiled with libvidstab (most modern builds). For handheld / gimbal-less " +
      "footage. Stabilization always shrinks the visible frame slightly — pass zoom=5 to crop " +
      "the borders out. Audio is copied unchanged.",
    parameters: StabilizeVideoParams,
    async execute({ input, output, shakiness, smoothing, zoom }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, input);
        const outAbs = safeOutputPath(cwd, output);
        if (inAbs === outAbs) {
          return err("input and output paths are identical", "use a different output path");
        }
        mkdirSync(dirname(outAbs), { recursive: true });
        const r = await stabilize(inAbs, outAbs, {
          shakiness,
          smoothing,
          zoom,
          signal: ctx.signal,
        });
        return compact({ ok: true, path: r.output, transforms: r.transformsPath });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
