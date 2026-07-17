import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";
import { parseSilenceDetect } from "../core/silence.js";

/**
 * trim_dead_air — single-call wrapper that detects head/tail (or all) silence
 * via `silencedetect` and produces a trimmed mp4. The agent normally chains
 * `detect_silence` + `write_edl` + `import_edl` for full silence cleanup;
 * this tool collapses the most-common case (chop the dead air at the start
 * and end of a recording) into one call.
 *
 * Modes:
 *   - "head-tail" (default): trim only leading and trailing silence
 *   - "all": cut every silence run >= minSilenceSec, re-encode the keeps
 *     concatenated. Same end-state as the EDL pipeline but produces a flat
 *     file the user can drop into any NLE.
 */

const TrimDeadAirParams = z.object({
  input: z.string().describe("Source audio/video file (relative resolves to cwd)."),
  output: z.string().describe("Output file path. Re-encoded; sets sensible H.264/AAC defaults."),
  mode: z
    .enum(["head-tail", "all"])
    .optional()
    .describe(
      "head-tail (default) trims only leading and trailing silence — the universal 'before " +
        "I started talking' / 'after I finished' cleanup. all removes every silence run >= " +
        "minSilenceSec via concat-keep ranges (same end-state as detect_silence → write_edl → " +
        "import_edl, but produces a flat file).",
    ),
  minSilenceSec: z
    .number()
    .min(0.1)
    .optional()
    .describe("Min silence duration to count. Default 0.5s."),
  thresholdDb: z
    .number()
    .max(0)
    .optional()
    .describe(
      "Silence threshold in dB. Default -30. Lower (e.g. -40) = stricter, only true silence " +
        "counts; higher (-20) catches mumble.",
    ),
  paddingSec: z
    .number()
    .min(0)
    .optional()
    .describe("Pad each kept segment outward by this much. Default 0.05 (50ms)."),
  videoCodec: z.string().optional().describe("ffmpeg video codec. Default libx264."),
  crf: z.number().int().min(0).max(51).optional().describe("x264 CRF. Default 20."),
  audioBitrate: z.string().optional().describe("Audio bitrate. Default '192k'."),
});

export function createTrimDeadAirTool(cwd: string): AgentTool<typeof TrimDeadAirParams> {
  return {
    name: "trim_dead_air",
    description:
      "Trim silence from a recording in one call. mode='head-tail' (default) chops only the " +
      "leading/trailing dead air — the universal 'recording started early' fix. mode='all' " +
      "removes every silence run >= minSilenceSec and concats the keeps into a flat file. For " +
      "fine-grained per-cut control, use detect_silence → write_edl → import_edl instead. " +
      "Returns {path, removedSec, kept}.",
    parameters: TrimDeadAirParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const outAbs = safeOutputPath(cwd, args.output);
        const probe = probeMedia(inAbs);
        if (!probe) return err(`probe failed for ${inAbs}`, "verify file exists and is readable");
        const totalSec = probe.durationSec;

        const mode = args.mode ?? "head-tail";
        const minSil = args.minSilenceSec ?? 0.5;
        const threshDb = args.thresholdDb ?? -30;
        const padSec = args.paddingSec ?? 0.05;

        // Run silencedetect on the input.
        const detect = await runFfmpeg(
          ["-i", inAbs, "-af", `silencedetect=noise=${threshDb}dB:d=${minSil}`, "-f", "null", "-"],
          { signal: ctx.signal },
        );
        // silencedetect writes to stderr; non-zero exit on a normal run is unusual but tolerated.
        const ranges = parseSilenceDetect(detect.stderr, totalSec);

        // Compute keep ranges per mode.
        const keeps = computeKeeps(ranges, totalSec, mode, padSec);
        if (keeps.length === 0) {
          return err(
            "no audible content remains after trim",
            "loosen thresholdDb (e.g. -40) or shorten minSilenceSec",
          );
        }
        const removedSec = +(
          totalSec - keeps.reduce((a, k) => a + (k.endSec - k.startSec), 0)
        ).toFixed(3);

        mkdirSync(dirname(outAbs), { recursive: true });

        // Build trim+concat filter graph. For head-tail with one keep range, this is
        // a single trim. For 'all' with N keeps it's N trim/atrim pairs concatted.
        const videoCodec = args.videoCodec ?? "libx264";
        const crf = args.crf ?? 20;
        const audioBitrate = args.audioBitrate ?? "192k";
        const filter = buildTrimConcatFilter(keeps);

        const ffArgs = [
          "-i",
          inAbs,
          "-filter_complex",
          filter,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:v",
          videoCodec,
          "-crf",
          String(crf),
          "-c:a",
          "aac",
          "-b:a",
          audioBitrate,
          outAbs,
        ];
        const r = await runFfmpeg(ffArgs, { signal: ctx.signal });
        if (r.code !== 0) {
          return err(
            `ffmpeg exited ${r.code}`,
            "check that the input has both video and audio streams",
          );
        }
        return compact({
          ok: true,
          path: outAbs,
          mode,
          totalSec,
          removedSec,
          kept: keeps.length,
          keeps: keeps.map((k) => ({
            startSec: +k.startSec.toFixed(3),
            endSec: +k.endSec.toFixed(3),
          })),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Compute keep ranges from detected silences.
 *
 * mode='head-tail': only the leading silence (if any starts at ~0) and the
 *   trailing silence (if any ends at totalSec) are removed; everything in
 *   between is one big keep range.
 * mode='all': inverse of all detected silences — every gap between silences
 *   becomes a keep range.
 *
 * Padding extends each keep outward; clamped to [0, totalSec] and to its
 * neighbours so adjacent keeps never overlap.
 */
export function computeKeeps(
  silences: Array<{ startSec: number; endSec: number }>,
  totalSec: number,
  mode: "head-tail" | "all",
  paddingSec: number,
): Array<{ startSec: number; endSec: number }> {
  if (totalSec <= 0) return [];
  const sorted = [...silences].sort((a, b) => a.startSec - b.startSec);

  if (mode === "head-tail") {
    let start = 0;
    let end = totalSec;
    const head = sorted[0];
    if (head && head.startSec <= 0.05) start = head.endSec;
    const tail = sorted[sorted.length - 1];
    if (tail && tail.endSec >= totalSec - 0.05) end = tail.startSec;
    start = Math.max(0, start - paddingSec);
    end = Math.min(totalSec, end + paddingSec);
    if (end <= start) return [];
    return [{ startSec: start, endSec: end }];
  }

  // mode === "all"
  const keeps: Array<{ startSec: number; endSec: number }> = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.startSec > cursor) {
      const start = Math.max(0, cursor - paddingSec);
      const end = Math.min(totalSec, s.startSec + paddingSec);
      if (end > start) keeps.push({ startSec: start, endSec: end });
    }
    cursor = Math.max(cursor, s.endSec);
  }
  if (cursor < totalSec) {
    const start = Math.max(0, cursor - paddingSec);
    keeps.push({ startSec: start, endSec: totalSec });
  }
  // Stitch overlaps caused by padding.
  const merged: Array<{ startSec: number; endSec: number }> = [];
  for (const k of keeps) {
    const prev = merged[merged.length - 1];
    if (prev && k.startSec <= prev.endSec) {
      prev.endSec = Math.max(prev.endSec, k.endSec);
    } else {
      merged.push({ ...k });
    }
  }
  return merged;
}

/**
 * Build an ffmpeg filter_complex that trims to N keep ranges and concats
 * them into a single video+audio output labelled [v][a].
 */
export function buildTrimConcatFilter(keeps: Array<{ startSec: number; endSec: number }>): string {
  if (keeps.length === 0)
    throw new Error("buildTrimConcatFilter: at least one keep range required");
  if (keeps.length === 1) {
    const k = keeps[0];
    return (
      `[0:v]trim=start=${k.startSec}:end=${k.endSec},setpts=PTS-STARTPTS[v];` +
      `[0:a]atrim=start=${k.startSec}:end=${k.endSec},asetpts=PTS-STARTPTS[a]`
    );
  }
  const segs: string[] = [];
  const labels: string[] = [];
  keeps.forEach((k, i) => {
    segs.push(
      `[0:v]trim=start=${k.startSec}:end=${k.endSec},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${k.startSec}:end=${k.endSec},asetpts=PTS-STARTPTS[a${i}]`,
    );
    labels.push(`[v${i}][a${i}]`);
  });
  segs.push(`${labels.join("")}concat=n=${keeps.length}:v=1:a=1[v][a]`);
  return segs.join(";");
}
