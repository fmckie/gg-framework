import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { buildAss } from "../core/ass.js";
import { injectEmojis } from "../core/emoji-captions.js";
import { compact, err } from "../core/format.js";
import { buildKeywordCaptions } from "../core/keyword-captions.js";
import { safeOutputPath } from "../core/safe-paths.js";
import { parseTranscript } from "../core/whisper.js";
import type { Transcript } from "../core/whisper.js";

const WriteKeywordCaptionsParams = z.object({
  transcript: z
    .string()
    .describe(
      "Transcript JSON with word-level timings. Run transcribe(wordTimestamps=true) first.",
    ),
  output: z.string().describe("Output .ass path (relative resolves to cwd)."),
  startSec: z.number().min(0).optional().describe("Optional start of the window. Default 0."),
  endSec: z
    .number()
    .min(0)
    .optional()
    .describe("Optional end of the window. Default = transcript end."),
  groupSize: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe("Words per cue. Default 3 — readable at fast speech rates."),
  maxKeywordsPerCue: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe("Max highlighted words per cue. Default 1. 0 disables highlighting."),
  minKeywordLen: z
    .number()
    .int()
    .min(2)
    .max(12)
    .optional()
    .describe("Minimum letter count to qualify a word as a keyword. Default 5."),
  gapSec: z
    .number()
    .min(0)
    .optional()
    .describe("Min word gap that forces a new cue. Default 0.4s."),
  /** Aesthetic knobs. Defaults are tuned for vertical / 9:16 burns. */
  fontName: z.string().optional().describe("Font family. Default Arial."),
  fontSize: z.number().int().positive().optional().describe("Default style font size. Default 84."),
  primaryColor: z
    .string()
    .optional()
    .describe("Default style fill (RRGGBB). Default FFFFFF (white)."),
  outlineColor: z.string().optional().describe("Default + Keyword outline. Default 000000."),
  keywordColor: z
    .string()
    .optional()
    .describe("Highlighted word fill (RRGGBB). Default FFEA00 (CapCut yellow)."),
  keywordFontSize: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Highlighted word size. Default 96 — slightly larger pop."),
  marginV: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Vertical margin in pixels (alignment 1-3 = bottom). Default 220. For 1080x1920 this " +
        "puts captions in the lower-third sweet spot.",
    ),
  playResX: z.number().int().positive().optional().describe("Canvas width. Default 1080."),
  playResY: z.number().int().positive().optional().describe("Canvas height. Default 1920."),
  autoEmoji: z
    .boolean()
    .optional()
    .describe(
      "If true, the tool calls the LLM ONCE over all cues to suggest a fitting emoji per cue " +
        "(or empty string). Submagic / CapCut signature look. Default false.",
    ),
  emojiDensity: z
    .enum(["low", "med", "high"])
    .optional()
    .describe("low ≈ 1 in 4 cues, med ≈ 1 in 2, high = every cue. Default 'med'."),
  emojiModel: z.string().optional().describe("LLM model. Default gpt-4o-mini."),
});

/**
 * write_keyword_captions — CapCut-style "active word" caption track.
 *
 * Runs the keyword heuristic over a word-timestamped transcript and
 * emits an .ass file where the most content-bearing word per cue is
 * rendered in a punchier color/scale. Pair with burn_subtitles to
 * bake into a finished short.
 *
 * Defaults are tuned for vertical (1080x1920) bottom-third placement
 * with white text + yellow keyword pops — the most-used short-form
 * caption look in 2025-2026.
 */
export function createWriteKeywordCaptionsTool(
  cwd: string,
): AgentTool<typeof WriteKeywordCaptionsParams> {
  return {
    name: "write_keyword_captions",
    description:
      "Emit a CapCut-style word-by-word .ass file where the most content-bearing word per " +
      "cue is highlighted (color + size pop). The signature look of viral short-form captions. " +
      "REQUIRES transcribe(wordTimestamps=true). Pair with burn_subtitles to bake in. Defaults " +
      "tuned for 9:16 vertical burns (white default + yellow keywords, lower-third).",
    parameters: WriteKeywordCaptionsParams,
    async execute(args) {
      try {
        const transcriptAbs = resolvePath(cwd, args.transcript);
        let raw: string;
        try {
          raw = readFileSync(transcriptAbs, "utf8");
        } catch (e) {
          return err(
            `cannot read transcript ${transcriptAbs}: ${(e as Error).message}`,
            "verify the transcript JSON exists",
          );
        }
        let t: Transcript;
        try {
          t = parseTranscript(raw);
        } catch (e) {
          return err((e as Error).message);
        }

        const lo = args.startSec ?? 0;
        const hi = args.endSec ?? t.durationSec;
        if (hi <= lo) return err("endSec must be > startSec");

        // Flatten all words within the window. Word-by-word captions
        // don't care about segment boundaries.
        const allWords: Array<{ start: number; end: number; text: string }> = [];
        for (const seg of t.segments) {
          if (!seg.words) continue;
          for (const w of seg.words) {
            if (w.end <= lo || w.start >= hi) continue;
            allWords.push({
              start: Math.max(lo, w.start) - lo,
              end: Math.min(hi, w.end) - lo,
              text: w.text,
            });
          }
        }
        if (allWords.length === 0) {
          return err(
            "no word timings in window",
            "rerun transcribe(wordTimestamps=true) or widen startSec/endSec",
          );
        }

        const built = buildKeywordCaptions(allWords, {
          groupSize: args.groupSize,
          gapSec: args.gapSec,
          maxKeywordsPerCue: args.maxKeywordsPerCue,
          minKeywordLen: args.minKeywordLen,
        });
        let cues = built.cues;
        const styles = built.styles;

        // Apply aesthetic overrides onto the returned styles.
        for (const s of styles) {
          if (s.name === "Default") {
            if (args.fontName) s.fontName = args.fontName;
            if (args.fontSize) s.fontSize = args.fontSize;
            if (args.primaryColor) s.primaryColor = args.primaryColor;
            if (args.outlineColor) s.outlineColor = args.outlineColor;
            if (args.marginV !== undefined) s.marginV = args.marginV;
          } else if (s.name === "Keyword") {
            if (args.fontName) s.fontName = args.fontName;
            if (args.keywordFontSize) s.fontSize = args.keywordFontSize;
            if (args.keywordColor) s.primaryColor = args.keywordColor;
            if (args.outlineColor) s.outlineColor = args.outlineColor;
            if (args.marginV !== undefined) s.marginV = args.marginV;
          }
        }

        // Optional emoji-injection pass (Submagic / CapCut look).
        let emojiInjected = 0;
        let emojiError: string | undefined;
        if (args.autoEmoji) {
          const r = await injectEmojis(cues, {
            density: args.emojiDensity,
            model: args.emojiModel,
          });
          cues = r.cues;
          emojiInjected = r.injected;
          emojiError = r.error;
        }

        const ass = buildAss({
          styles,
          cues,
          playResX: args.playResX ?? 1080,
          playResY: args.playResY ?? 1920,
          title: "GG Editor — keyword captions",
        });

        const outAbs = safeOutputPath(cwd, args.output);
        mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, ass, "utf8");

        return compact({
          path: outAbs,
          cues: cues.length,
          ...(args.autoEmoji ? { emojiInjected } : {}),
          ...(emojiError ? { emojiError } : {}),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
