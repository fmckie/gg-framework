import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { HOOK_PATTERNS, runHookRewrite } from "../core/hook-rewrite.js";

const RewriteHookParams = z.object({
  currentHook: z
    .string()
    .describe("The failing hook line. Pass an empty string when no hook exists yet."),
  videoTopic: z.string().min(1).describe("One-line description of the video."),
  transcriptExcerpt: z
    .string()
    .optional()
    .describe(
      "200-500 char excerpt from the transcript for tone context. Helps the LLM match the " +
        "creator's voice when picking power words.",
    ),
  pattern: z
    .enum(HOOK_PATTERNS)
    .optional()
    .describe(
      "Target pattern from the `viral-hook-patterns` skill. 'auto' (default) lets the LLM " +
        "pick the closest fit. Force a specific pattern when the user asked for it by name.",
    ),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
});

/**
 * rewrite_hook — propose 3 hook rewrites using a viral pattern.
 *
 * The agent surfaces the candidates to the user — does NOT auto-apply
 * (we don't generate footage). Use when `analyze_hook` returns score
 * < 60 or when the user says "the opener feels weak."
 */
export function createRewriteHookTool(_cwd: string): AgentTool<typeof RewriteHookParams> {
  return {
    name: "rewrite_hook",
    description:
      "Rewrite a hook using one of the 12 viral hook patterns from the `viral-hook-patterns` " +
      "skill. Pass `pattern='auto'` to let the LLM pick the closest fit; pass a specific " +
      "pattern name to force it. Returns 3 candidate rewrites with rationale. Use when " +
      "`analyze_hook` returns score < 60, or when the user says 'the opener feels weak'. " +
      "The agent should surface the candidates to the user — does NOT auto-apply (we don't " +
      "generate footage). Pair with `read_skill('viral-hook-patterns')` for the full pattern " +
      "library.",
    parameters: RewriteHookParams,
    async execute(args, ctx) {
      try {
        if (!process.env.OPENAI_API_KEY) {
          return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
        }

        const result = await runHookRewrite(
          {
            currentHook: args.currentHook,
            videoTopic: args.videoTopic,
            transcriptExcerpt: args.transcriptExcerpt,
            pattern: args.pattern ?? "auto",
          },
          { model: args.model, signal: ctx.signal },
        );

        if (result.candidates.length === 0) {
          return err("model returned no usable candidates", "retry or pass a more specific topic");
        }

        return compact({
          candidates: result.candidates,
          chosenPattern: result.chosenPattern,
          why: result.why,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
