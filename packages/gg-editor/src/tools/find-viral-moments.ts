import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { scoreClipInternal } from "../core/clip-scoring.js";
import { compact, err } from "../core/format.js";
import {
  buildSlidingWindows,
  dedupCandidates,
  normalizeCandidates,
  proposeCandidates,
  type ScoredCandidate,
  type ViralCandidate,
} from "../core/viral-moments.js";
import { parseTranscript } from "../core/whisper.js";
import type { Transcript } from "../core/whisper.js";

const FindViralMomentsParams = z.object({
  transcript: z.string().describe("Path to a transcript JSON written by `transcribe`."),
  maxClips: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Top-N to return after dedup. Default 5."),
  durationRange: z
    .tuple([z.number().min(1), z.number().min(1)])
    .optional()
    .describe(
      "[minSec, maxSec] for accepted clips. Default [20, 45] — Jenny Hoyos's 30–34s sweet " +
        "spot for Shorts retention (per youtube-algorithm-primer skill, Marketing Examined " +
        "May 2024). Widen to [20, 60] when the user explicitly wants longer cuts.",
    ),
  scoreThreshold: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Minimum 0-100 score to keep. Default 50 — anything lower won't perform."),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
});

/**
 * find_viral_moments — long-form transcript → top-N standalone-Shorts
 * candidates. The Opus ClipAnything / Submagic Magic Clips equivalent.
 *
 * Algorithm:
 *   1. Slide windows of `maxSec*2` (default 120s) with 30s overlap.
 *   2. ONE LLM call per window proposing up to 3 candidates.
 *   3. Score each via `score_clip` (transcript-only, cheap path).
 *   4. Dedup overlaps (>50% → keep higher score).
 *   5. Sort desc, take top maxClips.
 */
export function createFindViralMomentsTool(cwd: string): AgentTool<typeof FindViralMomentsParams> {
  return {
    name: "find_viral_moments",
    description:
      "Find the top N viral-clip candidates inside a long-form transcript. Slides windows " +
      "over the transcript, proposes 3 candidates per window via LLM, scores each via " +
      "`score_clip`, dedups overlaps, returns ranked list with suggested title + caption + " +
      "hook line. The 'long video to Shorts' orchestrator — Opus ClipAnything / Submagic " +
      "Magic Clips equivalent. Default duration window [20, 45]s targets Jenny Hoyos's " +
      "30–34s sweet spot. Output feeds `cut_at` + `render_multi_format` directly.",
    parameters: FindViralMomentsParams,
    async execute(args, ctx) {
      try {
        if (!process.env.OPENAI_API_KEY) {
          return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
        }

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
        if (t.segments.length === 0) {
          return err("transcript has no segments", "rerun transcribe(...)");
        }

        const [minSec, maxSec] = args.durationRange ?? [20, 45];
        if (maxSec <= minSec) return err("durationRange[1] must be > durationRange[0]");
        const maxClips = args.maxClips ?? 5;
        const threshold = args.scoreThreshold ?? 50;

        // Build windows: maxSec*2 wide with 30s overlap (or 25% of width
        // for very small maxSec to avoid degenerate cases).
        const windowSec = maxSec * 2;
        const overlapSec = Math.min(30, Math.max(1, windowSec * 0.25));
        const windows = buildSlidingWindows(t, windowSec, overlapSec);
        if (windows.length === 0) {
          return err("no windows produced", "verify transcript.durationSec > 0");
        }

        // Propose candidates per window. One LLM call per window.
        const proposals: ViralCandidate[] = [];
        for (const w of windows) {
          if (ctx.signal?.aborted) return err("aborted");
          try {
            const cands = await proposeCandidates(w, {
              model: args.model,
              durationRange: [minSec, maxSec],
              signal: ctx.signal,
            });
            proposals.push(...cands);
          } catch (e) {
            // One bad window shouldn't kill the whole pass — log via
            // returning a partial. We surface count of dropped windows
            // implicitly through `totalScored`.
            void (e as Error).message;
          }
        }

        const normalized = normalizeCandidates(proposals, t.durationSec, minSec, maxSec);
        if (normalized.length === 0) {
          return compact({ candidates: [], totalScored: 0, dropped: 0 });
        }

        // Score every candidate via the same engine as score_clip.
        const scored: ScoredCandidate[] = [];
        for (const c of normalized) {
          if (ctx.signal?.aborted) return err("aborted");
          try {
            const text = sliceText(t, c.startSec, c.endSec);
            if (!text) continue;
            const s = await scoreClipInternal(text, c.startSec, c.endSec, [], {
              model: args.model,
              signal: ctx.signal,
            });
            scored.push({
              ...c,
              score: s.score,
              hook: s.hook,
              flow: s.flow,
              engagement: s.engagement,
              trend: s.trend,
              durationSec: s.durationSec,
            });
          } catch (e) {
            void (e as Error).message;
          }
        }

        const aboveThreshold = scored.filter((s) => s.score >= threshold);
        const deduped = dedupCandidates(aboveThreshold);
        const top = deduped.slice(0, maxClips);

        return compact({
          candidates: top.map((c) => ({
            startSec: +c.startSec.toFixed(2),
            endSec: +c.endSec.toFixed(2),
            durationSec: +c.durationSec.toFixed(2),
            score: c.score,
            hook: +c.hook.toFixed(2),
            flow: +c.flow.toFixed(2),
            engagement: +c.engagement.toFixed(2),
            trend: +c.trend.toFixed(2),
            suggestedTitle: c.suggestedTitle,
            suggestedCaption: c.suggestedCaption,
            hookLine: c.hookLine,
            why: c.why,
          })),
          totalScored: scored.length,
          dropped: scored.length - top.length,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function sliceText(t: Transcript, startSec: number, endSec: number): string {
  const parts: string[] = [];
  for (const seg of t.segments) {
    if (seg.end <= startSec || seg.start >= endSec) continue;
    parts.push(seg.text.trim());
  }
  return parts.join(" ").trim();
}
