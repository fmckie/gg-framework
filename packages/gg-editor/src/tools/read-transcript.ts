import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err, summarizeList } from "../core/format.js";
import { parseTranscript } from "../core/whisper.js";

const ReadTranscriptParams = z.object({
  path: z.string().describe("Path to a transcript JSON file written by `transcribe`."),
  startSec: z.number().min(0).optional().describe("Lower bound (inclusive)."),
  endSec: z.number().min(0).optional().describe("Upper bound (exclusive)."),
  /** Optional substring filter (case-insensitive). */
  contains: z.string().optional(),
  speaker: z
    .string()
    .optional()
    .describe(
      "Filter to one speaker label (case-insensitive). Only meaningful for transcripts that " +
        "include speaker labels (whisperx / AssemblyAI / manual). gg-editor's bundled transcribe does not.",
    ),
  /** Maximum segments to return inline. Default 50. */
  limit: z.number().int().min(1).optional(),
  /** When true, include each segment's word-level timings if present. */
  includeWords: z
    .boolean()
    .optional()
    .describe(
      "Include word-level timings (when transcribe was run with wordTimestamps=true). " +
        "Required for building word-by-word burned captions via write_srt(words=...).",
    ),
});

export function createReadTranscriptTool(cwd: string): AgentTool<typeof ReadTranscriptParams> {
  return {
    name: "read_transcript",
    description:
      "Query a saved transcript by time range and/or text substring. " +
      "Use this to pull only the segments you need for a decision instead of dumping the whole transcript. " +
      "Returns matching segments with timestamps. Long results are truncated (head + tail summary).",
    parameters: ReadTranscriptParams,
    async execute({ path, startSec, endSec, contains, speaker, limit = 50, includeWords }) {
      try {
        const abs = resolvePath(cwd, path);
        const t = parseTranscript(readFileSync(abs, "utf8"));
        const needle = contains?.toLowerCase();

        const wantSpeaker = speaker?.toLowerCase();
        const matched = t.segments.filter((s) => {
          if (startSec !== undefined && s.end <= startSec) return false;
          if (endSec !== undefined && s.start >= endSec) return false;
          if (needle && !s.text.toLowerCase().includes(needle)) return false;
          if (wantSpeaker && (s.speaker ?? "").toLowerCase() !== wantSpeaker) return false;
          return true;
        });

        const trimmed = matched.slice(0, limit);
        const summary = summarizeList(trimmed, 30);
        const compactSegs = (segs: typeof matched) =>
          segs.map((s) => ({
            start: +s.start.toFixed(2),
            end: +s.end.toFixed(2),
            text: s.text,
            ...(s.speaker ? { speaker: s.speaker } : {}),
            ...(includeWords && s.words
              ? {
                  words: s.words.map((w) => ({
                    start: +w.start.toFixed(2),
                    end: +w.end.toFixed(2),
                    text: w.text,
                  })),
                }
              : {}),
          }));

        return compact({
          totalMatched: matched.length,
          returned: trimmed.length,
          truncated: matched.length > limit,
          ...(summary.omitted > 0
            ? {
                head: compactSegs(summary.head),
                tail: compactSegs(summary.tail),
                omitted: summary.omitted,
              }
            : { segments: compactSegs(trimmed) }),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
