import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err, summarizeList } from "../core/format.js";
import { detectSpeakerChanges } from "../core/speaker-changes.js";
import { parseTranscript } from "../core/whisper.js";

const DetectSpeakerChangesParams = z.object({
  path: z.string().describe("Transcript JSON file (output of `transcribe`)."),
  minGapSec: z
    .number()
    .positive()
    .optional()
    .describe("Minimum silence gap to flag as a candidate speaker change. Default 1.5s."),
});

export function createDetectSpeakerChangesTool(
  cwd: string,
): AgentTool<typeof DetectSpeakerChangesParams> {
  return {
    name: "detect_speaker_changes",
    description:
      "Heuristic v1: silence-gap candidates for speaker boundaries. Returns inter-segment " +
      "gaps > minGapSec as CANDIDATES — not assignments. Reasonable for fast-cut interview " +
      "audio with clear handoffs; UNRELIABLE for natural overlap, rapid back-and-forth, or " +
      "single-speaker monologues with dramatic pauses. For real diarization, run the audio " +
      "through whisperx/AssemblyAI first and import that transcript instead — read_transcript " +
      "supports a `speaker` filter when the JSON includes labels.",
    parameters: DetectSpeakerChangesParams,
    async execute({ path, minGapSec }) {
      try {
        const abs = resolvePath(cwd, path);
        const t = parseTranscript(readFileSync(abs, "utf8"));
        const candidates = detectSpeakerChanges(t, { minGapSec });
        const s = summarizeList(candidates, 30);
        return compact({
          total: s.total,
          minGapSec: minGapSec ?? 1.5,
          ...(s.omitted > 0 ? { head: s.head, tail: s.tail, omitted: s.omitted } : { candidates }),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
