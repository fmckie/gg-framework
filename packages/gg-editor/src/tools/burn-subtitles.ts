import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const BurnSubtitlesParams = z.object({
  input: z.string().describe("Source video file."),
  subtitles: z.string().describe("Path to .srt or .ass subtitle file."),
  output: z.string().describe("Where to write the captioned video."),
  videoCodec: z
    .string()
    .optional()
    .describe("Output video codec. Default 'libx264'. Use 'libx265' for HEVC."),
  crf: z
    .number()
    .int()
    .min(0)
    .max(51)
    .optional()
    .describe("Quality (lower=better). 18=visually lossless, 23=default, 28=acceptable web."),
});

export function createBurnSubtitlesTool(cwd: string): AgentTool<typeof BurnSubtitlesParams> {
  return {
    name: "burn_subtitles",
    description:
      "BAKE captions into a video as pixels — file-only, final-delivery tool. " +
      "⚠️ When a host (Resolve / Premiere) is connected and the user is still editing, " +
      "prefer `write_srt` + `import_subtitles` to attach the captions as a sidecar / subtitle " +
      "track instead. The user can then tweak timing, scrub, undo. Use this pixel-burn tool " +
      "ONLY when (a) the user has explicitly asked for a final flat mp4, OR (b) host=none, OR " +
      "(c) the deliverable is a vertical Short with stylised burned captions (in which case " +
      "pass an .ass produced by `write_ass` / `write_keyword_captions`). End-of-pipeline: " +
      "run AFTER loudness normalisation and any cleanup.",
    parameters: BurnSubtitlesParams,
    async execute({ input, subtitles, output, videoCodec, crf }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, input);
        const subAbs = resolvePath(cwd, subtitles);
        const outAbs = safeOutputPath(cwd, output);
        if (inAbs === outAbs) {
          return err("input and output paths are identical", "use a different output path");
        }
        // ffmpeg's `subtitles` filter parses .srt and .ass. We escape the
        // path because the filter arg uses : and \ as separators.
        const filter = `subtitles=${escapeFilterPath(subAbs)}`;
        mkdirSync(dirname(outAbs), { recursive: true });
        const args = [
          "-i",
          inAbs,
          "-vf",
          filter,
          "-c:v",
          videoCodec ?? "libx264",
          "-crf",
          String(crf ?? 18),
          "-c:a",
          "copy",
          outAbs,
        ];
        const r = await runFfmpeg(args, { signal: ctx.signal });
        if (r.code !== 0) {
          return err(`ffmpeg exited ${r.code}`, "verify subtitle file is valid .srt or .ass");
        }
        return compact({ ok: true, path: outAbs });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Escape a path for ffmpeg's `subtitles=` filter argument.
 *
 * Cross-platform rules (verified against RightNow-AI/openfang's clip skill
 * + ffmpeg's filter manual):
 *   - Forward slashes, never backslashes — ffmpeg's filtergraph parser
 *     treats `\` as an escape; on Windows paths come in as `C:\foo` and
 *     must become `C:/foo` first.
 *   - The drive-letter colon (`C:`) MUST be escaped as `C\:` because the
 *     filtergraph uses bare colons as arg separators.
 *   - Single quotes inside the path get backslash-escaped.
 *
 * Result for a typical Windows abs path:
 *   `C:\Users\me\subs.ass`  →  `C\:/Users/me/subs.ass`
 */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
