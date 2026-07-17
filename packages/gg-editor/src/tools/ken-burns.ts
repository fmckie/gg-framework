import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const KenBurnsParams = z.object({
  input: z.string().describe("Source still image (.jpg / .png). Animated input also works."),
  output: z.string(),
  durationSec: z.number().positive().describe("How long the resulting clip is."),
  fps: z.number().positive().optional().describe("Output frame rate. Default 30."),
  width: z.number().int().positive().optional().describe("Output width. Default 1920."),
  height: z.number().int().positive().optional().describe("Output height. Default 1080."),
  startZoom: z.number().min(1).optional().describe("Initial zoom multiplier (1=fit). Default 1."),
  endZoom: z.number().min(1).optional().describe("Final zoom multiplier. Default 1.4."),
  /** Pan direction. Center = pure zoom. */
  direction: z
    .enum(["center", "left", "right", "up", "down", "ne", "nw", "se", "sw"])
    .optional()
    .describe("Where the zoom 'pulls' toward. Default center."),
});

export function createKenBurnsTool(cwd: string): AgentTool<typeof KenBurnsParams> {
  return {
    name: "ken_burns",
    description:
      "File-only Ken-Burns zoom/pan animation on a still image (or video frame). " +
      "Renders a video clip with continuous zoom from startZoom → endZoom over durationSec, " +
      "panning in the chosen direction. Backed by ffmpeg's zoompan filter; works without " +
      "any NLE. Output is libx264 + silent track.",
    parameters: KenBurnsParams,
    async execute(p, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, p.input);
        const outAbs = safeOutputPath(cwd, p.output);
        if (inAbs === outAbs) return err("input and output paths are identical");
        const fps = p.fps ?? 30;
        const w = p.width ?? 1920;
        const h = p.height ?? 1080;
        const startZ = p.startZoom ?? 1;
        const endZ = p.endZoom ?? 1.4;
        const totalFrames = Math.max(2, Math.round(p.durationSec * fps));
        const direction = p.direction ?? "center";
        // zoompan z expression — linear ramp from startZ to endZ over the run.
        const zExpr = `${startZ}+(${endZ}-${startZ})*on/${totalFrames}`;
        // Pan expressions per direction. zoompan x/y are the TOP-LEFT of the
        // crop window; iw/ih = input frame size, iw/zoom = visible width.
        const { xExpr, yExpr } = panExpressions(direction);
        const filter =
          `scale=${w * 4}x-2,zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':` +
          `d=${totalFrames}:fps=${fps}:s=${w}x${h}`;
        mkdirSync(dirname(outAbs), { recursive: true });
        const args = [
          "-loop",
          "1",
          "-framerate",
          String(fps),
          "-t",
          String(p.durationSec),
          "-i",
          inAbs,
          "-vf",
          filter,
          "-c:v",
          "libx264",
          "-crf",
          "20",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-an",
          outAbs,
        ];
        const r = await runFfmpeg(args, { signal: ctx.signal });
        if (r.code !== 0) return err(`ffmpeg exited ${r.code}`);
        return compact({ ok: true, path: outAbs, durationSec: p.durationSec });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function panExpressions(dir: string): { xExpr: string; yExpr: string } {
  // Center: keep crop window centred. Each direction biases by adding a
  // linear factor of `on` (frame index) divided by total.
  const cx = `(iw-iw/zoom)/2`;
  const cy = `(ih-ih/zoom)/2`;
  switch (dir) {
    case "center":
      return { xExpr: cx, yExpr: cy };
    case "left":
      return { xExpr: `(iw-iw/zoom)*(1-on/in_total)`, yExpr: cy };
    case "right":
      return { xExpr: `(iw-iw/zoom)*on/in_total`, yExpr: cy };
    case "up":
      return { xExpr: cx, yExpr: `(ih-ih/zoom)*(1-on/in_total)` };
    case "down":
      return { xExpr: cx, yExpr: `(ih-ih/zoom)*on/in_total` };
    case "ne":
      return {
        xExpr: `(iw-iw/zoom)*on/in_total`,
        yExpr: `(ih-ih/zoom)*(1-on/in_total)`,
      };
    case "nw":
      return {
        xExpr: `(iw-iw/zoom)*(1-on/in_total)`,
        yExpr: `(ih-ih/zoom)*(1-on/in_total)`,
      };
    case "se":
      return {
        xExpr: `(iw-iw/zoom)*on/in_total`,
        yExpr: `(ih-ih/zoom)*on/in_total`,
      };
    case "sw":
      return {
        xExpr: `(iw-iw/zoom)*(1-on/in_total)`,
        yExpr: `(ih-ih/zoom)*on/in_total`,
      };
    default:
      return { xExpr: cx, yExpr: cy };
  }
}
