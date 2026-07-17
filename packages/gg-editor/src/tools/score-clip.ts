import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { scoreClipInternal } from "../core/clip-scoring.js";
import { compact, err } from "../core/format.js";
import { parseTranscript } from "../core/whisper.js";
import type { Transcript } from "../core/whisper.js";

const ScoreClipParams = z.object({
  transcript: z
    .string()
    .describe(
      "Path to a transcript JSON written by `transcribe`. Segments are required; word-level " +
        "timings are not.",
    ),
  startSec: z.number().min(0).describe("Window start in seconds (inclusive)."),
  endSec: z.number().min(0).describe("Window end in seconds (exclusive)."),
  framePaths: z
    .array(z.string())
    .optional()
    .describe(
      "Optional sampled frame paths (.jpg/.png). Use 1-3 for visual signal. Omit for " +
        "transcript-only scoring (cheap path).",
    ),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
  detail: z
    .enum(["low", "high"])
    .optional()
    .describe("Vision detail. Default low (cheap, ~85 tok/img)."),
});

/**
 * score_clip — virality rubric for an arbitrary transcript window.
 *
 * Generalises `analyze_hook` past the t<3s checkpoint. Used as the
 * ranking primitive for `find_viral_moments` and as a gate before
 * rendering Shorts.
 */
export function createScoreClipTool(cwd: string): AgentTool<typeof ScoreClipParams> {
  return {
    name: "score_clip",
    description:
      "Score a clip's virality potential 0-100 across hook, flow, engagement, and trend " +
      "dimensions. Generalises `analyze_hook` (which only covers t<3s) to arbitrary windows. " +
      "ONE LLM call per clip. Use as the ranking primitive for `find_viral_moments` and as a " +
      "gate before rendering Shorts. Surface the `why` to the user — it tells them what to fix.",
    parameters: ScoreClipParams,
    async execute(args, ctx) {
      try {
        if (!process.env.OPENAI_API_KEY) {
          return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
        }
        if (args.endSec <= args.startSec) {
          return err("endSec must be > startSec");
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

        const text = sliceTranscriptText(t, args.startSec, args.endSec);
        if (!text) {
          return err(
            "no transcript text in window",
            "verify [startSec, endSec) overlaps real segments",
          );
        }

        const framePaths = (args.framePaths ?? []).map((p) => resolvePath(cwd, p));

        const score = await scoreClipInternal(text, args.startSec, args.endSec, framePaths, {
          model: args.model,
          detail: args.detail,
          signal: ctx.signal,
        });

        return compact({
          score: score.score,
          hook: round2(score.hook),
          flow: round2(score.flow),
          engagement: round2(score.engagement),
          trend: round2(score.trend),
          why: score.why,
          durationSec: +score.durationSec.toFixed(2),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Extract the transcript text inside [startSec, endSec). Joins matching
 * segments with single spaces — punctuation already lives inside the
 * segment text. Exported for tests.
 */
export function sliceTranscriptText(t: Transcript, startSec: number, endSec: number): string {
  const parts: string[] = [];
  for (const seg of t.segments) {
    if (seg.end <= startSec || seg.start >= endSec) continue;
    parts.push(seg.text.trim());
  }
  return parts.join(" ").trim();
}

function round2(n: number): number {
  return +n.toFixed(2);
}
