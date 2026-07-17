import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { buildPunchInFilter, punchInsAfterCuts, type PunchInRange } from "../core/punch-in.js";
import { safeOutputPath } from "../core/safe-paths.js";

const PunchRangeSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  zoom: z
    .number()
    .min(1)
    .max(2)
    .optional()
    .describe("1.0 = no zoom, 1.10 = 10% punch (default), 1.20 = obvious push-in. Capped at 2.0."),
});

const PunchInParams = z.object({
  input: z.string().describe("Source video (relative resolves to cwd)."),
  output: z.string().describe("Output video. Re-encoded; audio is copied through."),
  ranges: z
    .array(PunchRangeSchema)
    .optional()
    .describe(
      "Explicit punch ranges. If omitted you must supply `cutPoints` so the tool can " +
        "auto-derive a brief punch after each cut.",
    ),
  cutPoints: z
    .array(z.number().min(0))
    .optional()
    .describe(
      "Auto mode: timestamps of cuts (e.g. from cut_filler_words.keeps boundaries or " +
        "detect_silence). One short punch is dropped after each cut to disguise the jump. " +
        "Mutually exclusive with `ranges` — if both supplied, `ranges` wins.",
    ),
  defaultZoom: z
    .number()
    .min(1)
    .max(2)
    .optional()
    .describe("Default zoom when ranges omit it, or for cutPoints mode. Default 1.10."),
  holdSec: z
    .number()
    .positive()
    .optional()
    .describe("In cutPoints mode, how long each punch lasts after the cut. Default 1.5s."),
  rampSec: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Smooth-in/out window in seconds. 0 = instant snap (default). 0.08-0.15s for a " +
        "subtle push-in animation rather than a pop.",
    ),
  videoCodec: z.string().optional().describe("Default libx264."),
  crf: z.number().int().min(0).max(51).optional().describe("Default 18."),
});

/**
 * punch_in — digital zoom on a list of ranges. The single best
 * disguise for jump cuts on a single-camera talking head: cut the
 * filler / silence, then punch in slightly on the kept side, and the
 * head-jerk vanishes.
 *
 * Also takes `cutPoints` to auto-generate punches after every cut —
 * pair with `cut_filler_words` or `detect_silence` for a one-shot
 * "clean up the talking head" pipeline.
 */
export function createPunchInTool(cwd: string): AgentTool<typeof PunchInParams> {
  return {
    name: "punch_in",
    description:
      "Apply digital zoom (punch-in) to one or more ranges of a video. Used to disguise " +
      "jump cuts on single-camera talking heads — the universal YouTuber trick. Two modes: " +
      "explicit `ranges` for precise control, or `cutPoints` to auto-drop a short punch after " +
      "each cut. File-only — works in every host. Re-encodes video; audio is copied through.",
    parameters: PunchInParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const outAbs = safeOutputPath(cwd, args.output);
        if (inAbs === outAbs) {
          return err("output and input are identical", "use a different output path");
        }
        const probe = probeMedia(inAbs);
        if (!probe) return err(`probe failed for ${inAbs}`, "verify file exists and is media");
        if (!probe.width || !probe.height) {
          return err(
            "probe returned no width/height",
            "input must be a video file with a video stream",
          );
        }

        const defaultZoom = args.defaultZoom ?? 1.1;

        let ranges: PunchInRange[] = [];
        if (args.ranges && args.ranges.length > 0) {
          ranges = args.ranges.map((r) => ({
            startSec: r.startSec,
            endSec: r.endSec,
            zoom: r.zoom ?? defaultZoom,
          }));
        } else if (args.cutPoints && args.cutPoints.length > 0) {
          ranges = punchInsAfterCuts(
            args.cutPoints,
            probe.durationSec,
            args.holdSec ?? 1.5,
            defaultZoom,
          );
        } else {
          return err(
            "neither `ranges` nor `cutPoints` supplied",
            "pass one — `ranges` for explicit control, `cutPoints` for auto-derive",
          );
        }

        if (ranges.length === 0) {
          return err(
            "no usable punch ranges produced",
            "check cutPoints / ranges — every range may have collapsed (zoom<=1 or invalid timing)",
          );
        }

        const vf = buildPunchInFilter(ranges, probe.width, probe.height, {
          defaultZoom,
          rampSec: args.rampSec,
        });
        if (!vf) {
          return err("filter expression empty", "all supplied ranges were no-ops");
        }

        const codec = args.videoCodec ?? "libx264";
        const crf = String(args.crf ?? 18);
        const r = await runFfmpeg(
          ["-i", inAbs, "-vf", vf, "-c:v", codec, "-crf", crf, "-c:a", "copy", outAbs],
          { signal: ctx.signal },
        );
        if (r.code !== 0) {
          return err(`ffmpeg failed: ${tail(r.stderr)}`);
        }

        return compact({
          path: outAbs,
          ranges: ranges.length,
          defaultZoom,
          rampSec: args.rampSec ?? 0,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
