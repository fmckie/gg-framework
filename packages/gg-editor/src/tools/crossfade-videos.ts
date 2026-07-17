import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

// xfade transitions verified against ffmpeg's filter manual + the wubloader
// fixture list. ALL of these are accepted by mainline ffmpeg.
const TransitionSchema = z.enum([
  // Plain fades
  "fade",
  "fadeblack",
  "fadewhite",
  "fadegrays",
  // Wipes (full-edge sweeps)
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  // Slides
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  // Geometric
  "circleopen",
  "circleclose",
  "circlecrop",
  "rectcrop",
  // Stylised
  "dissolve",
  "pixelize",
  "radial",
  "distance",
  "hblur",
  // Soft directional
  "smoothleft",
  "smoothright",
  "smoothup",
  "smoothdown",
  // Cover/reveal pairs
  "coverleft",
  "coverright",
  "coverup",
  "coverdown",
  "revealleft",
  "revealright",
  "revealup",
  "revealdown",
  // Squeeze + zoom
  "squeezeh",
  "squeezev",
  "zoomin",
]);

const CrossfadeVideosParams = z.object({
  inputA: z.string().describe("First video (the one that fades OUT)."),
  inputB: z.string().describe("Second video (the one that fades IN)."),
  output: z.string().describe("Output path."),
  durationSec: z.number().positive().describe("Crossfade duration. Typical 0.5–2s."),
  transition: TransitionSchema.optional().describe("ffmpeg xfade transition. Default 'fade'."),
});

export function createCrossfadeVideosTool(cwd: string): AgentTool<typeof CrossfadeVideosParams> {
  return {
    name: "crossfade_videos",
    description:
      "Crossfade between two videos using ffmpeg's xfade. 16+ transition styles available; " +
      "default 'fade' is the safe choice. Re-encodes both inputs into one output. " +
      "Use sparingly — most pro edits use straight cuts. Crossfades signal 'time has passed'.",
    parameters: CrossfadeVideosParams,
    async execute({ inputA, inputB, output, durationSec, transition }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const aAbs = resolvePath(cwd, inputA);
        const bAbs = resolvePath(cwd, inputB);
        const outAbs = safeOutputPath(cwd, output);
        if (aAbs === outAbs || bAbs === outAbs) {
          return err("output collides with an input");
        }
        const probeA = probeMedia(aAbs);
        if (!probeA) return err(`probe failed for ${aAbs}`);
        if (durationSec >= probeA.durationSec) {
          return err(
            `durationSec (${durationSec}) >= duration of inputA (${probeA.durationSec.toFixed(2)})`,
            "crossfade must fit inside the first clip",
          );
        }
        const offset = +(probeA.durationSec - durationSec).toFixed(3);
        const t = transition ?? "fade";
        const filter =
          `[0:v][1:v]xfade=transition=${t}:duration=${durationSec}:offset=${offset}[v];` +
          `[0:a][1:a]acrossfade=d=${durationSec}[a]`;
        mkdirSync(dirname(outAbs), { recursive: true });
        const args = [
          "-i",
          aAbs,
          "-i",
          bAbs,
          "-filter_complex",
          filter,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:v",
          "libx264",
          "-crf",
          "20",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outAbs,
        ];
        const r = await runFfmpeg(args, { signal: ctx.signal });
        if (r.code !== 0) return err(`ffmpeg exited ${r.code}`);
        return compact({ ok: true, path: outAbs, transition: t, durationSec });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
