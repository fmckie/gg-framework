import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { buildLoopMatchFilter } from "../core/loop-match.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const LoopMatchShortParams = z.object({
  input: z.string().describe("Source Short (.mp4). Relative resolves to cwd."),
  output: z.string().describe("Output .mp4 path. Re-encoded; must differ from input."),
  crossfadeSec: z
    .number()
    .positive()
    .max(2)
    .optional()
    .describe(
      "Crossfade duration. Default 0.3s — small enough to preserve content, large enough to " +
        "smooth the loop boundary. Capped at clip duration / 2.",
    ),
  copyMethod: z
    .enum(["crossfade", "jumpcut"])
    .optional()
    .describe(
      "'crossfade' (default) blends the last N ms into the first N ms; 'jumpcut' simply " +
        "trims the last N ms so the loop hard-cuts to the head. Use jumpcut on very short " +
        "clips where any crossfade would eat too much of the visible content.",
    ),
});

/**
 * loop_match_short — make a Short re-loop seamlessly.
 *
 * YouTube Shorts auto-replay is a confirmed ranking signal — the more
 * loops a clip racks up, the more it gets pushed. A 0.3s crossfade
 * between the tail and the head erases the visible "snap" at the
 * loop boundary.
 */
export function createLoopMatchShortTool(cwd: string): AgentTool<typeof LoopMatchShortParams> {
  return {
    name: "loop_match_short",
    description:
      "Crossfade the last N ms of a Short into the first N ms so YouTube's auto-replay " +
      "re-loop feels seamless. Loop rate is a confirmed Shorts ranking signal (per " +
      "`youtube-algorithm-primer` skill). Default 0.3s crossfade. Pair as the LAST step in " +
      "the short-form pipeline before delivery: `find_viral_moments → face_reframe → " +
      "write_keyword_captions → burn_subtitles → punch_in → add_sfx_at_cuts → " +
      "normalize_loudness(platform=tiktok) → loop_match_short`. File-only ffmpeg pass — no " +
      "LLM, no API key.",
    parameters: LoopMatchShortParams,
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
        if (probe.durationSec <= 0) return err("source has zero duration");

        const cf = args.crossfadeSec ?? 0.3;
        const method = args.copyMethod ?? "crossfade";

        let plan;
        try {
          plan = buildLoopMatchFilter(probe.durationSec, cf, method);
        } catch (e) {
          return err((e as Error).message);
        }

        mkdirSync(dirname(outAbs), { recursive: true });
        const r = await runFfmpeg(
          [
            "-i",
            inAbs,
            "-filter_complex",
            plan.filter,
            "-map",
            plan.maps[0],
            "-map",
            plan.maps[1],
            "-c:v",
            "libx264",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            outAbs,
          ],
          { signal: ctx.signal },
        );
        if (r.code !== 0) return err(`ffmpeg exited ${r.code}: ${tail(r.stderr)}`);

        return compact({
          ok: true,
          path: outAbs,
          crossfadeSec: +plan.crossfadeSec.toFixed(3),
          outDurationSec: +plan.outDurationSec.toFixed(3),
          method: plan.method,
          inDurationSec: +probe.durationSec.toFixed(3),
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
