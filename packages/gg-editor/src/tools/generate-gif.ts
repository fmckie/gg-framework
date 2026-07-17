import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeResolveOutputPath } from "../core/safe-paths.js";

const GenerateGifParams = z.object({
  input: z.string().describe("Source video file."),
  output: z.string().describe("Output .gif path."),
  startSec: z.number().min(0).optional().describe("Source-in seconds. Default 0."),
  durationSec: z
    .number()
    .positive()
    .optional()
    .describe("Length to capture. Default 5s. Cap at 15s — GIFs balloon fast."),
  fps: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Output GIF fps. Default 12 (good quality:size ratio for social previews)."),
  width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Output width in pixels (height auto). Default 480."),
});

export function createGenerateGifTool(cwd: string): AgentTool<typeof GenerateGifParams> {
  return {
    name: "generate_gif",
    description:
      "Two-pass GIF generation (palettegen → paletteuse) for high-quality output at small file " +
      "sizes. Use for social previews, README embeds, Twitter posts. Default 480px @ 12fps for " +
      "5 seconds. Cap at 15s — GIFs >5MB stop autoplaying on most platforms.",
    parameters: GenerateGifParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const resolved = safeResolveOutputPath(cwd, args.output);
        const outAbs = resolved.path;
        if (!/\.gif$/i.test(outAbs)) {
          return err("output must end in .gif", `got: ${outAbs}`);
        }
        const start = args.startSec ?? 0;
        const dur = args.durationSec ?? 5;
        const fps = args.fps ?? 12;
        const width = args.width ?? 480;
        if (dur > 15) {
          return err(
            `durationSec ${dur} > 15s`,
            "GIFs over 15s rarely autoplay; use a smaller window",
          );
        }
        mkdirSync(dirname(outAbs), { recursive: true });
        const palettePath = join(tmpdir(), `gg-gif-palette-${Date.now()}.png`);
        const filterChain = `fps=${fps},scale=${width}:-1:flags=lanczos`;

        // The palette PNG is a temp scratch artifact between the two ffmpeg
        // passes — always clean it up, including on early-return / thrown errors.
        try {
          // Pass 1: palettegen
          const p1 = await runFfmpeg(
            [
              "-ss",
              String(start),
              "-t",
              String(dur),
              "-i",
              inAbs,
              "-vf",
              `${filterChain},palettegen=stats_mode=diff`,
              palettePath,
            ],
            { signal: ctx.signal },
          );
          if (p1.code !== 0) return err(`palettegen exited ${p1.code}`);

          // Pass 2: paletteuse
          const p2 = await runFfmpeg(
            [
              "-ss",
              String(start),
              "-t",
              String(dur),
              "-i",
              inAbs,
              "-i",
              palettePath,
              "-lavfi",
              `${filterChain} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
              outAbs,
            ],
            { signal: ctx.signal },
          );
          if (p2.code !== 0) return err(`paletteuse exited ${p2.code}`);
          return compact({
            ok: true,
            path: outAbs,
            startSec: start,
            durationSec: dur,
            fps,
            width,
            ...(resolved.redirected ? { redirected: true, reason: resolved.reason } : {}),
          });
        } finally {
          rmSync(palettePath, { force: true });
        }
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
