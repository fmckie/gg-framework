import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { buildSrt, buildWordLevelSrt } from "../core/srt.js";
import { safeOutputPath } from "../core/safe-paths.js";

const CueSchema = z.object({
  start: z.number().min(0).describe("Cue start in seconds."),
  end: z.number().positive().describe("Cue end in seconds (must be > start)."),
  text: z.string().describe("Caption text. Multi-line OK."),
});

const WordSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  text: z.string(),
});

const WriteSrtParams = z
  .object({
    output: z.string().describe("Output .srt path (relative resolves to cwd)."),
    cues: z
      .array(CueSchema)
      .optional()
      .describe("Sentence-level cues. Use for long-form sidecar captions."),
    words: z
      .array(WordSchema)
      .optional()
      .describe("Word-level cues. Use for burned-in vertical captions (TikTok / Reels style)."),
    groupSize: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("When using words[], cluster N consecutive words per cue. Default 1."),
    gapSec: z
      .number()
      .min(0)
      .optional()
      .describe(
        "When using words[], extend each cue's end up to the next cue's start (closed-caption look). Max gap.",
      ),
  })
  .refine((v) => (v.cues && v.cues.length > 0) || (v.words && v.words.length > 0), {
    message: "either `cues` or `words` must be provided",
  });

export function createWriteSrtTool(cwd: string): AgentTool<typeof WriteSrtParams> {
  return {
    name: "write_srt",
    description:
      "Write a SubRip (.srt) caption file from a list of cues. Pair with transcribe → " +
      "import_subtitles to caption a video end-to-end. Captions are non-negotiable for " +
      "short-form (most viewers watch muted).",
    parameters: WriteSrtParams,
    async execute({ output, cues, words, groupSize, gapSec }) {
      try {
        const text = words ? buildWordLevelSrt(words, { groupSize, gapSec }) : buildSrt(cues!);
        if (!text) {
          return err(
            "no usable cues (all empty / invalid)",
            "ensure at least one cue has non-empty text and end > start",
          );
        }
        const abs = safeOutputPath(cwd, output);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text, "utf8");
        return compact({
          ok: true,
          path: abs,
          cues: words ? Math.ceil(words.length / (groupSize ?? 1)) : cues!.length,
          ...(words ? { mode: "word-level" } : {}),
        });
      } catch (e) {
        return err((e as Error).message, "verify cue end > start and text not empty");
      }
    },
  };
}
