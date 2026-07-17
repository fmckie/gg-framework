import { Agent, type AgentTool } from "@kleio/agent";
import type { Usage } from "@kleio/ai";
import type { VideoHost } from "./hosts/types.js";
import {
  createGetMarkersTool,
  createGetTimelineTool,
  createHostInfoTool,
  createProbeMediaTool,
  createReadSkillTool,
  createReadTranscriptTool,
  createScoreShotTool,
} from "../tools/index.js";
import { discoverSkills, type SkillSource } from "./skills-loader.js";
import { SKILLS } from "../skills.js";

/**
 * Self-critique pass over the timeline + transcripts.
 *
 * Runs a fresh Agent with a READ-ONLY subset of editor tools and a critique
 * prompt. The reviewer inspects the current state against the user's stated
 * intent and returns a one-paragraph critique + a structured flags array.
 *
 * Token cost: a sub-agent over many turns can burn context; we cap at
 * maxTurns=10 by default.
 */

export interface ReviewFlag {
  severity: "ok" | "warn" | "block";
  note: string;
}

export interface ReviewOptions {
  /** What the edit is FOR. The reviewer measures against this. */
  intent: string;
  /** Optional aspects to focus on. */
  focus?: Array<"pacing" | "takes" | "audio" | "captions" | "hook" | "color">;
  host: VideoHost;
  cwd: string;
  config: {
    provider: "anthropic" | "openai" | "glm" | "moonshot";
    model: string;
    apiKey: string;
    maxTurns?: number;
  };
  signal?: AbortSignal;
}

export interface ReviewResult {
  critique: string;
  flags: ReviewFlag[];
  turns: number;
  usage: Usage;
}

const REVIEW_SYSTEM = `You are the GG Editor REVIEWER — a read-only critic of an edit-in-progress.

Your job: read the timeline + relevant transcripts/media, measure them against the stated INTENT, and write a tight critique.

You have READ-ONLY tools (host_info, get_timeline, get_markers, read_transcript, score_shot, probe_media, read_skill). You CANNOT mutate the timeline or write files. Don't try.

Process:
1. Call host_info, get_timeline, get_markers to read state.
2. If there's a transcript, read targeted windows (NEVER full dumps).
3. Optionally score a few shots.
4. Form an opinion. Be concrete: timestamps, clip ids, specific issues.

OUTPUT FORMAT — your final assistant message must end with this EXACT structure:

<one paragraph of critique, ≤200 words, plain prose>

\`\`\`json
{"flags":[{"severity":"ok|warn|block","note":"..."}, ...]}
\`\`\`

severity:
- ok: nothing wrong; affirmation of a good editorial choice
- warn: needs attention but not blocking (filler still present, caption typo)
- block: ship-stopper (wrong take kept, missing captions on long-form, hook missing)

Be direct. Don't praise the work just to be nice. If it's good, say "ok". If it's not, say what's wrong.`;

/**
 * Build only the 6 read-only tools needed by the reviewer, without instantiating
 * the full ~100-tool set. Exported so callers can compose a reviewer independently.
 */
export function createReadOnlyEditorTools(
  host: VideoHost,
  cwd: string,
  skills?: SkillSource[],
): AgentTool[] {
  const resolvedSkills = skills ?? discoverSkills({ cwd, bundled: Object.values(SKILLS) });
  return [
    createHostInfoTool(host),
    createGetTimelineTool(host),
    createGetMarkersTool(host),
    createReadTranscriptTool(cwd),
    createScoreShotTool(cwd),
    createProbeMediaTool(cwd),
    createReadSkillTool(resolvedSkills),
  ];
}

export async function runReview(opts: ReviewOptions): Promise<ReviewResult> {
  const { intent, focus, host, cwd, config, signal } = opts;

  const tools = createReadOnlyEditorTools(host, cwd);

  const userPrompt = [
    `INTENT: ${intent}`,
    focus && focus.length > 0 ? `FOCUS: ${focus.join(", ")}` : null,
    "",
    "Inspect the current edit and produce a one-paragraph critique followed by the flags JSON block as instructed.",
  ]
    .filter(Boolean)
    .join("\n");

  const agent = new Agent({
    provider: config.provider,
    model: config.model,
    system: REVIEW_SYSTEM,
    tools,
    apiKey: config.apiKey,
    maxTurns: config.maxTurns ?? 10,
    signal,
  });

  let bufText = "";
  let lastAssistantText = "";
  let turns = 0;
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  for await (const ev of agent.prompt(userPrompt)) {
    switch (ev.type) {
      case "text_delta":
        bufText += ev.text;
        break;
      case "turn_end":
        turns += 1;
        if (bufText.trim().length > 0) lastAssistantText = bufText;
        bufText = "";
        usage.inputTokens = (usage.inputTokens ?? 0) + (ev.usage.inputTokens ?? 0);
        usage.outputTokens = (usage.outputTokens ?? 0) + (ev.usage.outputTokens ?? 0);
        break;
      case "agent_done":
        if (bufText.trim().length > 0) lastAssistantText = bufText;
        break;
    }
  }

  const parsed = parseReviewMessage(lastAssistantText);
  return { ...parsed, turns, usage };
}

/**
 * Parse the trailing ```json {...} ``` block out of the final assistant message.
 * The text BEFORE the JSON block becomes the critique. On parse failure, the
 * whole message is returned as critique with empty flags.
 */
export function parseReviewMessage(text: string): { critique: string; flags: ReviewFlag[] } {
  const trimmed = text.trim();
  // Match trailing ```json ... ``` block (allow trailing whitespace after fence).
  const fenceRe = /```json\s*([\s\S]*?)\s*```\s*$/;
  const m = fenceRe.exec(trimmed);
  if (!m) {
    return { critique: trimmed, flags: [] };
  }
  try {
    const parsed = JSON.parse(m[1]) as { flags?: unknown };
    const flags: ReviewFlag[] = Array.isArray(parsed.flags)
      ? parsed.flags
          .filter(
            (f): f is { severity: string; note: string } =>
              typeof f === "object" &&
              f !== null &&
              typeof (f as { severity?: unknown }).severity === "string" &&
              typeof (f as { note?: unknown }).note === "string",
          )
          .filter((f) => f.severity === "ok" || f.severity === "warn" || f.severity === "block")
          .map((f) => ({ severity: f.severity as ReviewFlag["severity"], note: f.note }))
      : [];
    const critique = trimmed.slice(0, m.index).trim();
    return { critique, flags };
  } catch {
    return { critique: trimmed, flags: [] };
  }
}
