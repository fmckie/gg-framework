import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Build the body for ffmpeg's concat-demuxer list file. Single-quotes the path
 * and shell-escapes any embedded single quotes (`'` → `'\''`). Match the
 * convention seen in real-world bash test fixtures (e.g. Xinrea/bili-shadowreplay).
 */
export function buildConcatListBody(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
}
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

const ConcatVideosParams = z.object({
  inputs: z.array(z.string().min(1)).min(2).describe("Videos to join in order."),
  output: z.string().describe("Concatenated output path."),
  lossless: z
    .boolean()
    .optional()
    .describe(
      "If true, use the ffmpeg concat demuxer (no re-encode — fast, lossless). " +
        "ALL sources must share codec, resolution, fps, sample rate. If you're not certain, " +
        "leave false (default) — the filter-based concat re-encodes uniformly.",
    ),
  videoCodec: z.string().optional().describe("When re-encoding: video codec. Default libx264."),
  crf: z.number().int().min(0).max(51).optional().describe("When re-encoding: CRF. Default 20."),
});

export function createConcatVideosTool(cwd: string): AgentTool<typeof ConcatVideosParams> {
  return {
    name: "concat_videos",
    description:
      "Join videos end-to-end. Two modes: lossless (concat demuxer, requires uniform codec/" +
      "resolution/fps/sample-rate) and re-encode (filter-based, always works). Common uses: " +
      "intro + main + outro stitching, multi-take assembly, batch concat for upload.",
    parameters: ConcatVideosParams,
    async execute({ inputs, output, lossless, videoCodec, crf }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const absInputs = inputs.map((p) => resolvePath(cwd, p));
        const outAbs = safeOutputPath(cwd, output);
        for (const a of absInputs) {
          if (a === outAbs)
            return err("output path collides with an input", "pick a different output");
        }
        mkdirSync(dirname(outAbs), { recursive: true });

        if (lossless) {
          // concat demuxer: build a list file `file 'path'\n` and feed it.
          // The list file is a temp scratch artifact — clean it up no matter
          // how this branch exits (success, ffmpeg non-zero, or thrown error).
          const listPath = join(tmpdir(), `gg-concat-${Date.now()}.txt`);
          const body = buildConcatListBody(absInputs);
          writeFileSync(listPath, body, "utf8");
          try {
            const r = await runFfmpeg(
              ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outAbs],
              { signal: ctx.signal },
            );
            if (r.code !== 0) {
              return err(
                `ffmpeg concat-demuxer exited ${r.code}`,
                "sources may differ in codec/res/fps; retry with lossless=false",
              );
            }
            return compact({ ok: true, path: outAbs, mode: "lossless" });
          } finally {
            rmSync(listPath, { force: true });
          }
        }

        // Filter-based concat (re-encode).
        const args: string[] = [];
        for (const p of absInputs) args.push("-i", p);
        const n = absInputs.length;
        const filterParts: string[] = [];
        for (let i = 0; i < n; i++) filterParts.push(`[${i}:v:0][${i}:a:0]`);
        const filter = `${filterParts.join("")}concat=n=${n}:v=1:a=1[outv][outa]`;
        args.push(
          "-filter_complex",
          filter,
          "-map",
          "[outv]",
          "-map",
          "[outa]",
          "-c:v",
          videoCodec ?? "libx264",
          "-crf",
          String(crf ?? 20),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outAbs,
        );
        const r = await runFfmpeg(args, { signal: ctx.signal });
        if (r.code !== 0) {
          return err(`ffmpeg concat exited ${r.code}`);
        }
        return compact({ ok: true, path: outAbs, mode: "re-encode" });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
