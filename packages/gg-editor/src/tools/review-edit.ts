import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";
import { runReview } from "../core/review.js";

const FocusEnum = z.enum(["pacing", "takes", "audio", "captions", "hook", "color"]);

const ReviewEditParams = z.object({
  intent: z
    .string()
    .min(10)
    .describe(
      "What the edit is FOR. The reviewer measures against this. " +
        "Examples: 'tight 90s podcast clip about decision fatigue, captioned for IG'.",
    ),
  focus: z
    .array(FocusEnum)
    .optional()
    .describe("Optional aspects to focus on: pacing/takes/audio/captions/hook/color."),
});

export interface ReviewEditConfig {
  provider: "anthropic" | "openai" | "glm" | "moonshot";
  model: string;
  apiKey: string;
  maxTurns?: number;
}

export function createReviewEditTool(
  host: VideoHost,
  cwd: string,
  config: ReviewEditConfig,
): AgentTool<typeof ReviewEditParams> {
  return {
    name: "review_edit",
    description:
      "Self-critique pass over the current edit. Spawns a fresh READ-ONLY reviewer " +
      "agent that inspects the timeline, markers, and transcripts against the stated intent " +
      "and returns a one-paragraph critique + a flags array (severity: ok/warn/block). " +
      "Use BEFORE rendering on important edits. Token-expensive (~10 reviewer turns) — call sparingly.",
    parameters: ReviewEditParams,
    async execute({ intent, focus }, ctx) {
      try {
        const r = await runReview({
          intent,
          focus,
          host,
          cwd,
          config,
          signal: ctx.signal,
        });
        return compact({
          critique: r.critique,
          flags: r.flags,
          turns: r.turns,
          tokens: { in: r.usage.inputTokens ?? 0, out: r.usage.outputTokens ?? 0 },
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
