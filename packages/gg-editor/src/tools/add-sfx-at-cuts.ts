import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { bundledSfxDescriptionList, listBundledSfxNames, resolveSfx } from "../core/bundled-sfx.js";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";
import { buildSfxOnCutsFilter } from "../core/sfx-on-cuts.js";

const AddSfxAtCutsParams = z.object({
  input: z.string().describe("Source video / audio (relative resolves to cwd)."),
  sfx: z
    .string()
    .describe(
      `SFX. Pass a bundled name (synthesised on demand, cached at ~/.gg/sfx-cache/) OR a file path. ` +
        `Bundled names: ${listBundledSfxNames().join(", ")}. ` +
        `For a custom file: stereo wav / mp3, 200 ms–1 s long is typical.`,
    ),
  output: z.string().describe("Output file. Re-encoded; uses input video codec passthrough."),
  cutPoints: z
    .array(z.number().min(0))
    .min(1)
    .describe(
      "Timestamps (seconds) where the SFX should fire — RELATIVE TO THE INPUT FILE. ⚠️ If the " +
        "input is a rendered cut (post-`cut_filler_words` / `text_based_cut`), pass the " +
        "`timelineCutPoints` from that tool's result — NOT source-video transcript timestamps. " +
        "Source-space points drift further out of sync after every cut (fine for the first " +
        "~30 s, off by 20+ s by the end of a typical podcast). Closer-than-minSpacingSec hits " +
        "are deduped automatically.",
    ),
  sfxGainDb: z
    .number()
    .min(-30)
    .max(6)
    .optional()
    .describe(
      "SFX gain offset in dB. Default -8 (subtle, sits below voice). -4 = prominent, " +
        "-12 = barely-there texture.",
    ),
  duckDb: z
    .number()
    .max(0)
    .optional()
    .describe(
      "Optional voice ducking depth (dB) under each SFX hit. 0 = off (default), -3 to -6 = " +
        "polished. Negative values only.",
    ),
  minSpacingSec: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Minimum spacing between SFX hits. Closer cuts get collapsed (avoids 8 stacked whooshes " +
        "on machine-gun edits). Default 0.25s.",
    ),
  videoCodec: z
    .string()
    .optional()
    .describe(
      "Default 'copy' — no video re-encode. Set to libx264 if input has no compatible video stream.",
    ),
});

/**
 * add_sfx_at_cuts — drop a whoosh / pop / swoosh on every cut point
 * and mix it into the existing audio. The standard sound-design polish
 * on every retention-tuned vlog. One ffmpeg pass; video is copied
 * through untouched by default.
 *
 * Pair with `cut_filler_words` or `detect_silence` to feed cut points
 * automatically.
 */
export function createAddSfxAtCutsTool(cwd: string): AgentTool<typeof AddSfxAtCutsParams> {
  return {
    name: "add_sfx_at_cuts",
    description:
      `BAKE SFX into a rendered mp4 — file-only, final-delivery tool. ` +
      `⚠️ When a host (Resolve / Premiere) is connected, prefer ` +
      `\`add_sfx_to_timeline\` instead — it places real audio clips on track A3 so ` +
      `the user hears them on playback and can tune levels in Fairlight. Use this tool ONLY ` +
      `when host=none OR the user has explicitly asked for a final flat mp4. ` +
      `Bundled SFX (synthesised on demand): ${bundledSfxDescriptionList()}. ` +
      `Default gain -8 dB sits below voice; optional -3 to -6 dB voice ducking. Video is ` +
      `copied through untouched.`,
    parameters: AddSfxAtCutsParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const outAbs = safeOutputPath(cwd, args.output);
        if (inAbs === outAbs) {
          return err("output and input are identical", "use a different output path");
        }

        // Resolve bundled name OR file path. Synthesises on first cache miss.
        let sfxAbs: string;
        let sfxInfo: { bundled: boolean; name?: string };
        try {
          const r = await resolveSfx(args.sfx, cwd, ctx.signal);
          sfxAbs = r.path;
          sfxInfo = { bundled: r.bundled, name: r.name };
        } catch (e) {
          return err((e as Error).message, "use a bundled SFX name or supply a real file path");
        }

        const probe = probeMedia(inAbs);
        if (!probe) return err(`probe failed for ${inAbs}`, "verify file exists and is media");
        if (!probe.audioCodec) {
          return err("input has no audio stream", "add audio first or use a different input");
        }

        const { filterComplex, hits } = buildSfxOnCutsFilter({
          cutPoints: args.cutPoints,
          totalSec: probe.durationSec,
          sfxGainDb: args.sfxGainDb,
          duckDb: args.duckDb,
          minSpacingSec: args.minSpacingSec,
        });

        if (hits === 0) {
          return err(
            "no usable cut points after filtering",
            "all cuts were outside [0, duration) or collapsed by minSpacingSec",
          );
        }

        const videoCodec = args.videoCodec ?? "copy";
        const ffArgs = [
          "-i",
          inAbs,
          "-i",
          sfxAbs,
          "-filter_complex",
          filterComplex,
          "-map",
          "0:v?",
          "-map",
          "[mix]",
          "-c:v",
          videoCodec,
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outAbs,
        ];
        const r = await runFfmpeg(ffArgs, { signal: ctx.signal });
        if (r.code !== 0) {
          return err(`ffmpeg failed: ${tail(r.stderr)}`);
        }
        return compact({
          path: outAbs,
          hits,
          sfx: sfxInfo.bundled ? `bundled:${sfxInfo.name}` : sfxAbs,
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
