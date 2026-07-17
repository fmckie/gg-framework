/**
 * Post-turn tool-result truncation for the LLM message array.
 *
 * gg-boss runs long. Each turn, the boss and every worker accumulate full
 * tool results in their `messages` array — `read` of a 50KB file, `bash`
 * with verbose output, `prompt_worker` returning a multi-paragraph summary.
 * Auto-compaction kicks at 80% of context window, but heap pressure builds
 * long before token-context pressure does: we crashed at 23% context with
 * 4GB heap exhausted (mark-compacts ineffective).
 *
 * `boss-store.ts` already trims displayed history (1000-item ring with
 * field truncation) but that only affects the UI. The Agent's `messages`
 * array — which is sent to the LLM and persisted to disk — keeps full
 * tool result bodies forever. Those are the bytes that fill the heap.
 *
 * Approach mirrors LobeHub (truncate to a char cap with an explicit notice
 * so the model knows content was cut) and Vellum's post-turn truncation
 * (walk every message, skip already-truncated). We mutate in place because
 * `Agent.getMessages()` returns a shallow copy whose inner Message objects
 * are shared by reference — assigning `block.content = ...` propagates back
 * to the agent's private `messages`.
 *
 * We DO NOT touch:
 *  - The most recent N messages (the model needs the latest tool result
 *    intact to reason about it on the next turn — truncating it mid-turn
 *    would defeat the purpose of running the tool).
 *  - Error results (usually short and load-bearing for debugging).
 *  - Already-truncated results (idempotent — detected via marker).
 */

import type { Message, ToolResultContent } from "@kleio/ai";

/**
 * Per-result character cap. Matches LobeHub's default. Long enough to keep
 * a meaningful prefix (a screen-or-two of source for a `read`, the head of
 * a `bash` log) but short enough that 1000 historical results sum to ~25MB
 * not 25GB.
 */
export const DEFAULT_MAX_CHARS = 25_000;

/**
 * How many messages at the tail to leave untouched. The boss often reasons
 * across the previous 1–2 turns of tool calls, so preserving the last few
 * messages avoids confusing the model. 6 ≈ 1 user turn + 1 assistant turn
 * + their tool_result block + 1 follow-up turn.
 */
export const TAIL_PROTECTED_MESSAGES = 6;

/**
 * Marker appended to truncated content. Detection of this marker makes
 * truncation idempotent — calling the function multiple times across turns
 * doesn't re-truncate or stack notices.
 */
const TRUNCATION_MARKER = "[[gg-boss:truncated]]";

function buildNotice(originalLen: number, keptLen: number): string {
  const omitted = originalLen - keptLen;
  return (
    `\n\n${TRUNCATION_MARKER} ${omitted.toLocaleString()} of ` +
    `${originalLen.toLocaleString()} characters omitted to control heap ` +
    `pressure. Re-run the tool if you need the full output.`
  );
}

function truncateString(s: string, maxChars: number): string | null {
  if (s.length <= maxChars) return null;
  if (s.includes(TRUNCATION_MARKER)) return null;
  return s.slice(0, maxChars) + buildNotice(s.length, maxChars);
}

/**
 * Truncate tool_result content in-place. Returns the new content (or the
 * original reference if nothing changed). Handles both string content and
 * the (TextContent | ImageContent)[] form — text blocks get truncated,
 * images pass through.
 */
function truncateToolResultContent(
  content: ToolResultContent,
  maxChars: number,
): { content: ToolResultContent; changed: boolean } {
  if (typeof content === "string") {
    const next = truncateString(content, maxChars);
    return next === null ? { content, changed: false } : { content: next, changed: true };
  }

  let changed = false;
  const nextBlocks = content.map((block) => {
    if (block.type !== "text") return block;
    const next = truncateString(block.text, maxChars);
    if (next === null) return block;
    changed = true;
    return { ...block, text: next };
  });
  return { content: changed ? nextBlocks : content, changed };
}

/**
 * Walk `messages` (in place) and truncate any tool_result content blocks
 * whose payload exceeds `maxChars`. Skips the last `TAIL_PROTECTED_MESSAGES`
 * messages so the model can still reason over the most recent tool output.
 *
 * Returns the number of tool_result blocks that were truncated. Caller can
 * log this for observability.
 */
export function truncateOversizedToolResults(
  messages: Message[],
  opts: { maxChars?: number; tailProtected?: number } = {},
): number {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const tailProtected = opts.tailProtected ?? TAIL_PROTECTED_MESSAGES;
  const cutoff = Math.max(0, messages.length - tailProtected);

  let truncated = 0;
  for (let i = 0; i < cutoff; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;
    for (const block of msg.content) {
      if (block.isError) continue;
      const { content, changed } = truncateToolResultContent(block.content, maxChars);
      if (changed) {
        block.content = content;
        truncated += 1;
      }
    }
  }
  return truncated;
}
