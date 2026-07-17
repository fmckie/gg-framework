import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";
import { parseTranscript } from "../core/whisper.js";
import type { Transcript } from "../core/whisper.js";

/**
 * bleep_words — compliance / brand-safety tool. Scan a word-timestamped
 * transcript for any occurrence of `wordList`, then either mute (silence)
 * or bleep-overlay each range in the source audio. Outputs a re-encoded
 * mp4 with the same video stream copied through.
 *
 * Two modes:
 *   - "mute" — `volume=enable='between(t,a,b)':volume=0` per range. Cleanest;
 *      lands as silence under the speaker's mouth movements.
 *   - "bleep" — same mute applied AND a bleep tone (sine wave at 1kHz by
 *     default) amix'd over the muted region. The classic broadcast censor.
 */

const BleepWordsParams = z.object({
  transcript: z
    .string()
    .describe(
      "Path to a transcript JSON written by transcribe(wordTimestamps=true). " +
        "REQUIRES word-level timings — without them this tool can't locate the words.",
    ),
  input: z.string().describe("Source video/audio file the transcript was made from."),
  output: z.string().describe("Output file (relative resolves to cwd). Re-encoded."),
  wordList: z
    .array(z.string())
    .min(1)
    .describe(
      "Words / phrases to censor (case-insensitive, multi-word phrases supported). Each match " +
        "becomes a muted (or bleeped) range in the audio.",
    ),
  mode: z
    .enum(["mute", "bleep"])
    .optional()
    .describe(
      "mute = silence the range. bleep = silence and amix a tone over it. Default 'bleep'.",
    ),
  toneFreqHz: z.number().positive().optional().describe("Bleep tone frequency. Default 1000."),
  paddingMs: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Pad each match outward by this much (ms) so the censor catches the full syllable. Default 50.",
    ),
});

interface MatchRange {
  startSec: number;
  endSec: number;
  text: string;
}

export function createBleepWordsTool(cwd: string): AgentTool<typeof BleepWordsParams> {
  return {
    name: "bleep_words",
    description:
      "Censor specific words / phrases in a recording. REQUIRES transcribe(wordTimestamps=true). " +
      "mode='bleep' overlays a 1kHz tone (broadcast-style); mode='mute' just silences. Multi-word " +
      "phrases supported. Pair with read_transcript to verify what got matched. Returns {path, " +
      "matched, ranges}.",
    parameters: BleepWordsParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const transcriptAbs = resolvePath(cwd, args.transcript);
        const inAbs = resolvePath(cwd, args.input);
        const outAbs = safeOutputPath(cwd, args.output);

        let transcript: Transcript;
        try {
          transcript = parseTranscript(readFileSync(transcriptAbs, "utf8"));
        } catch (e) {
          return err(
            `cannot read/parse transcript: ${(e as Error).message}`,
            "verify the JSON exists and was written by transcribe()",
          );
        }
        const hasWords = transcript.segments.some(
          (s) => Array.isArray(s.words) && s.words.length > 0,
        );
        if (!hasWords) {
          return err(
            "transcript has no word-level timings",
            "rerun transcribe(wordTimestamps=true) — without word timings we can't locate words",
          );
        }

        const padSec = (args.paddingMs ?? 50) / 1000;
        const ranges = findRanges(transcript, args.wordList, padSec);
        if (ranges.length === 0) {
          return err("no matches found", "verify wordList — match is case-insensitive");
        }
        const merged = mergeRanges(ranges);

        const mode = args.mode ?? "bleep";
        const toneHz = args.toneFreqHz ?? 1000;
        mkdirSync(dirname(outAbs), { recursive: true });
        const filter = buildBleepFilter(merged, mode, toneHz);
        const ffArgs = [
          "-i",
          inAbs,
          "-filter_complex",
          filter,
          "-map",
          "0:v",
          "-map",
          "[aout]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outAbs,
        ];
        const r = await runFfmpeg(ffArgs, { signal: ctx.signal });
        if (r.code !== 0) return err(`ffmpeg exited ${r.code}`, "verify input has audio");

        return compact({
          ok: true,
          path: outAbs,
          mode,
          matched: ranges.length,
          ranges: merged.map((m) => ({
            startSec: +m.startSec.toFixed(3),
            endSec: +m.endSec.toFixed(3),
          })),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Find every word-list match in the transcript. Multi-word phrases are
 * matched against contiguous word sequences. Case-insensitive, ignores
 * surrounding punctuation.
 */
export function findRanges(
  transcript: Transcript,
  wordList: string[],
  paddingSec: number,
): MatchRange[] {
  const phrases = wordList
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0)
    .map((w) => w.split(/\s+/));
  if (phrases.length === 0) return [];

  const matches: MatchRange[] = [];
  for (const seg of transcript.segments) {
    const words = seg.words ?? [];
    if (words.length === 0) continue;
    const norm = words.map((w) => w.text.toLowerCase().replace(/[^a-z0-9']/g, ""));
    for (const phrase of phrases) {
      for (let i = 0; i + phrase.length <= words.length; i++) {
        let hit = true;
        for (let k = 0; k < phrase.length; k++) {
          if (norm[i + k] !== phrase[k]) {
            hit = false;
            break;
          }
        }
        if (hit) {
          const s = Math.max(0, words[i].start - paddingSec);
          const e = words[i + phrase.length - 1].end + paddingSec;
          matches.push({ startSec: s, endSec: e, text: phrase.join(" ") });
        }
      }
    }
  }
  return matches.sort((a, b) => a.startSec - b.startSec);
}

/** Merge overlapping or touching ranges. */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0) return [];
  const out: MatchRange[] = [{ ...ranges[0] }];
  for (let i = 1; i < ranges.length; i++) {
    const prev = out[out.length - 1];
    const cur = ranges[i];
    if (cur.startSec <= prev.endSec) {
      prev.endSec = Math.max(prev.endSec, cur.endSec);
      prev.text = `${prev.text}/${cur.text}`;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Build a filter_complex that mutes (and optionally beeps over) the audio
 * in every range. Output label: `[aout]`.
 *
 * mute mode:
 *   [0:a]volume=enable='between(t,a1,b1)':volume=0,volume=enable='between(t,a2,b2)':volume=0[aout]
 * bleep mode:
 *   muted = same as mute
 *   tones = sine sources, one per range, gated by adelay + atrim
 *   [muted][tones...]amix=inputs=N+1:duration=first:dropout_transition=0[aout]
 *   then sidechained back through volume…
 *
 * Simpler bleep: chain a sine source per range, mix all in. Below is the
 * implementation:
 */
export function buildBleepFilter(
  ranges: MatchRange[],
  mode: "mute" | "bleep",
  toneHz: number,
): string {
  if (ranges.length === 0) throw new Error("buildBleepFilter: no ranges");
  // Step 1: mute every range on the original audio.
  const muteOps = ranges.map(
    (r) => `volume=enable='between(t,${r.startSec},${r.endSec})':volume=0`,
  );
  const mutedExpr = `[0:a]${muteOps.join(",")}[muted]`;

  if (mode === "mute") {
    return `${mutedExpr};[muted]anull[aout]`;
  }

  // bleep: generate one sine tone clip per range, time-shift each, amix.
  const toneExprs: string[] = [];
  const toneLabels: string[] = [];
  ranges.forEach((r, i) => {
    const dur = +(r.endSec - r.startSec).toFixed(6);
    // sine source: sine=frequency=F:duration=D, then adelay to startSec*1000ms.
    toneExprs.push(
      `sine=frequency=${toneHz}:duration=${dur},` +
        `adelay=${Math.round(r.startSec * 1000)}|${Math.round(r.startSec * 1000)},` +
        `volume=0.5[tone${i}]`,
    );
    toneLabels.push(`[tone${i}]`);
  });
  const inputs = ranges.length + 1;
  // amix duration=longest so the original tail isn't truncated.
  const mixExpr = `[muted]${toneLabels.join("")}amix=inputs=${inputs}:duration=longest:dropout_transition=0,volume=${inputs}[aout]`;
  return [mutedExpr, ...toneExprs, mixExpr].join(";");
}
