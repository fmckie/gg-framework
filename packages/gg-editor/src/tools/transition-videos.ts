import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

/**
 * Transition presets that wrap ffmpeg's `xfade` filter with content-creator
 * friendly names + sensible default durations. Two new presets vs the
 * underlying xfade list:
 *   - smash-cut : 1-frame xfade (≈ a hard cut with imperceptible blend)
 *   - whip-left/right : very-fast wipe simulating a whip-pan transition
 *
 * The remaining presets are 1:1 aliases of xfade names that creators tend
 * to call by friendlier labels (dip-to-black, dip-to-white).
 */

const PresetSchema = z.enum([
  "crossfade",
  "dip-to-black",
  "dip-to-white",
  "smash-cut",
  "whip-left",
  "whip-right",
  "slide-left",
  "slide-right",
  "wipe-left",
  "wipe-right",
  "circle-open",
  "circle-close",
  "zoom-in",
  "dissolve",
  "pixelize",
  "radial",
]);

interface PresetSpec {
  xfade: string;
  defaultDurationSec: number;
}

const PRESETS: Record<z.infer<typeof PresetSchema>, PresetSpec> = {
  crossfade: { xfade: "fade", defaultDurationSec: 0.5 },
  "dip-to-black": { xfade: "fadeblack", defaultDurationSec: 0.5 },
  "dip-to-white": { xfade: "fadewhite", defaultDurationSec: 0.5 },
  // 1-frame xfade is the cleanest way to do a smash cut while still letting
  // the audio acrossfade ride underneath.
  "smash-cut": { xfade: "fade", defaultDurationSec: 0.04 },
  "whip-left": { xfade: "wipeleft", defaultDurationSec: 0.15 },
  "whip-right": { xfade: "wiperight", defaultDurationSec: 0.15 },
  "slide-left": { xfade: "slideleft", defaultDurationSec: 0.5 },
  "slide-right": { xfade: "slideright", defaultDurationSec: 0.5 },
  "wipe-left": { xfade: "wipeleft", defaultDurationSec: 0.4 },
  "wipe-right": { xfade: "wiperight", defaultDurationSec: 0.4 },
  "circle-open": { xfade: "circleopen", defaultDurationSec: 0.6 },
  "circle-close": { xfade: "circleclose", defaultDurationSec: 0.6 },
  "zoom-in": { xfade: "zoomin", defaultDurationSec: 0.5 },
  dissolve: { xfade: "dissolve", defaultDurationSec: 0.5 },
  pixelize: { xfade: "pixelize", defaultDurationSec: 0.4 },
  radial: { xfade: "radial", defaultDurationSec: 0.5 },
};

const TransitionVideosParams = z.object({
  inputA: z.string(),
  inputB: z.string(),
  output: z.string(),
  preset: PresetSchema.describe(
    "Transition style. crossfade/dip-to-black/dip-to-white = soft cuts. " +
      "whip-left/right = fast wipe (energetic). smash-cut = 1-frame blend " +
      "for jump-cuts. zoom-in / circle-open = stylised reveal.",
  ),
  durationSec: z
    .number()
    .positive()
    .optional()
    .describe(
      "Override duration. Defaults: 0.5s for crossfade, 0.04s for smash-cut, " +
        "0.15s for whip presets.",
    ),
});

export function createTransitionVideosTool(cwd: string): AgentTool<typeof TransitionVideosParams> {
  return {
    name: "transition_videos",
    description:
      "Transition between two videos using a named preset (smash-cut, whip-left/right, " +
      "dip-to-black/white, crossfade, …). Wraps ffmpeg xfade with creator-friendly " +
      "presets + sensible default durations. For raw xfade names use crossfade_videos.",
    parameters: TransitionVideosParams,
    async execute({ inputA, inputB, output, preset, durationSec }, ctx) {
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
        const spec = PRESETS[preset];
        const dur = durationSec ?? spec.defaultDurationSec;
        if (dur >= probeA.durationSec) {
          return err(
            `durationSec (${dur}) >= duration of inputA (${probeA.durationSec.toFixed(2)})`,
            "transition must fit inside the first clip",
          );
        }
        const offset = +(probeA.durationSec - dur).toFixed(3);
        const filter =
          `[0:v][1:v]xfade=transition=${spec.xfade}:duration=${dur}:offset=${offset}[v];` +
          `[0:a][1:a]acrossfade=d=${dur}[a]`;
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
        return compact({ ok: true, path: outAbs, preset, durationSec: dur });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
