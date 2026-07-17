import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const OverlayWatermarkParams = z.object({
  input: z.string().describe("Source video."),
  watermark: z.string().describe("Image file (.png with transparency recommended)."),
  output: z.string().describe("Output path."),
  position: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"])
    .optional()
    .describe("Default 'bottom-right'."),
  marginPx: z.number().int().min(0).optional().describe("Pixels from each edge. Default 20."),
  opacity: z.number().min(0).max(1).optional().describe("0-1. Default 0.85 (subtle but readable)."),
  scale: z
    .number()
    .min(0.01)
    .max(1)
    .optional()
    .describe("Watermark scale relative to input width. Default 0.15."),
});

export function createOverlayWatermarkTool(cwd: string): AgentTool<typeof OverlayWatermarkParams> {
  return {
    name: "overlay_watermark",
    description:
      "Composite a logo / watermark image over a video. PNG with transparency works best. " +
      "Position presets cover the four corners + center. Default scale 15% of input width — " +
      "big enough to read, small enough not to dominate.",
    parameters: OverlayWatermarkParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const wmAbs = resolvePath(cwd, args.watermark);
        const outAbs = safeOutputPath(cwd, args.output);
        if (inAbs === outAbs || wmAbs === outAbs) {
          return err("output collides with an input");
        }
        const pos = args.position ?? "bottom-right";
        const m = args.marginPx ?? 20;
        const opacity = args.opacity ?? 0.85;
        const scale = args.scale ?? 0.15;
        const xy = positionFormula(pos, m);
        // Scale watermark relative to MAIN width (W in overlay coordinate
        // system; we use the [in] [wm] complex filter so scale=W*x:-1).
        const filter =
          `[1:v]format=rgba,colorchannelmixer=aa=${opacity}[wm0];` +
          `[wm0][0:v]scale2ref=w=iw*${scale}:h=ow/mdar[wm][bg];` +
          `[bg][wm]overlay=${xy.x}:${xy.y}[v]`;
        mkdirSync(dirname(outAbs), { recursive: true });
        const r = await runFfmpeg(
          [
            "-i",
            inAbs,
            "-i",
            wmAbs,
            "-filter_complex",
            filter,
            "-map",
            "[v]",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-crf",
            "20",
            "-c:a",
            "copy",
            outAbs,
          ],
          { signal: ctx.signal },
        );
        if (r.code !== 0) return err(`ffmpeg exited ${r.code}`);
        return compact({ ok: true, path: outAbs, position: pos });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Build overlay x/y formulas from a named position. ffmpeg's overlay filter
 * supports `W`/`H` (main video) and `w`/`h` (overlay dimensions).
 */
export function positionFormula(
  pos: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center",
  margin: number,
): { x: string; y: string } {
  switch (pos) {
    case "top-left":
      return { x: `${margin}`, y: `${margin}` };
    case "top-right":
      return { x: `W-w-${margin}`, y: `${margin}` };
    case "bottom-left":
      return { x: `${margin}`, y: `H-h-${margin}` };
    case "bottom-right":
      return { x: `W-w-${margin}`, y: `H-h-${margin}` };
    case "center":
      return { x: "(W-w)/2", y: "(H-h)/2" };
  }
}
