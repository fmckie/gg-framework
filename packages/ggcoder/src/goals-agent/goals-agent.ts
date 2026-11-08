import type { AgentTool } from "@kleio/agent";
import { AgentSession, type AgentSessionOptions } from "../core/agent-session.js";
import { renderGoalPrompt, type GoalRecord } from "../core/goals-store.js";
import { getModel } from "../core/model-registry.js";
import type { ChildModelPick } from "../core/subagent-manager.js";

/**
 * Kleio Goals: the orchestrator a Goal window talks to. It is its own agent, not
 * Kleio Coder with a note attached: its identity and the goal brief form its
 * system prompt, it has no plan mode (it plans in the conversation), and its
 * prompt cache is keyed apart from coding sessions.
 */
export const GOALS_SYSTEM_PROMPT = `You are Kleio Goals, the orchestrator inside Kleio Coder. The user hands you a goal that is bigger than one session, and you own it end to end: you understand it, agree the approach with the user, split it into well-scoped pieces of work, coordinate them, and keep the user informed until the goal is met.

## How you work

- One goal, one ongoing conversation. Treat earlier messages as shared history, not as a fresh request.
- You orchestrate; your team does the work. You never edit files, write files or run commands yourself: those tools are closed to you. Before the goal starts you read and ask; once it has started, every piece of real work goes to a worker you start with spawn_agent.
- Split the work into small, independent tasks with clear outcomes and start their workers together in one spawn_agent call, so they run in parallel. Brief each worker fully, as it sees nothing of this conversation: the goal, the exact files or area, constraints, and what to report back. Set each worker's cwd to the attached folder it works in.
- While they work, use wait_agent rather than polling, steer with send_message, and give a finished worker its next task with followup_task. Check what a worker reports before you rely on it; send another worker to verify anything important.
- You still read, search and browse yourself to plan and to check results. Ask the user only for what you cannot look up.
- Be exact about status. Never say something is done, fixed or verified unless you checked it, and say plainly when something could not be checked.
- Keep the user in the loop without flooding them: short updates when something finishes, needs a decision, or is blocked.

## Talking to the user

Plain words, short paragraphs, no jargon the user did not use. Lead with the answer or the outcome. Use ask_user for real decisions, with your recommendation marked; never ask in prose what a clickable choice can answer.`;

/** Agent tools Kleio Goals always has, instead of finding them via tool_search. */
export const GOALS_CORE_TOOLS: readonly string[] = [
  "spawn_agent",
  "wait_agent",
  "send_message",
  "followup_task",
  "list_agents",
  "interrupt_agent",
  "web_search",
  "web_fetch",
  // Reading the attached context without a shell.
  "find",
  "ls",
];

export type GoalsAgentOptions = Omit<
  AgentSessionOptions,
  | "agentPrompt"
  | "agentRole"
  | "agentContext"
  | "systemPrompt"
  | "promptCacheKeyPrefix"
  | "getSystemPromptTail"
  | "onEnterPlan"
  | "onExitPlan"
  | "planSubmissionGate"
  | "coreTools"
  | "wrapTool"
> & {
  /** The goal this session coordinates; its folder is the session's cwd. */
  goal: { dir: string; record: GoalRecord };
  /** True once the user has started the goal. Read live: the phase changes mid-session. */
  isActive?: () => boolean;
  /** The workers' model. Read at each spawn: the user can change it any time. */
  getChildModel?: () => ChildModelPick | undefined;
};

/**
 * The model Kleio Goals' workers run on, from the goal's pick. A
 * pick whose model is gone from the registry, or now belongs to a different
 * provider, is ignored, so workers fall back to Kleio Goals' own model.
 */
export function goalCritterPick(record: GoalRecord | undefined): ChildModelPick | undefined {
  const pick = record?.critterModel;
  if (!pick) return undefined;
  const model = getModel(pick.model);
  if (!model || model.provider !== pick.provider) return undefined;
  return { provider: model.provider, model: model.id };
}

/** Kleio Goals' full prompt body: identity first, then this goal's brief. */
export function buildGoalsAgentPrompt(goal: { dir: string; record: GoalRecord }): string {
  return `${GOALS_SYSTEM_PROMPT}\n\n${renderGoalPrompt(goal.dir, goal.record)}`;
}

/** Tools Kleio Goals never uses itself: its workers edit, write and run. */
export const GOALS_DELEGATED_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "bash",
  "ui_adopt",
  "generate_image",
]);

/** Tools that start work, held until the user starts the goal. */
export const GOALS_START_TOOLS: ReadonlySet<string> = new Set([
  "spawn_agent",
  "followup_task",
  "subagent",
]);

/** What a delegated tool returns once the goal is underway. */
export const DELEGATE_ERROR =
  "Not you: the team does the work. Hand this to a worker with spawn_agent (brief it fully and set its cwd to the attached folder), then wait_agent for its report.";

/** What editing or starting work returns during the briefing. */
export const BRIEFING_ERROR =
  "Not yet: the goal hasn't started. During the briefing you only read and ask. Once the user starts the goal, workers you start with spawn_agent do the work.";

/** Error text ask_user returns while Kleio Goals has not spoken yet. */
export const GREET_FIRST_ERROR =
  "Not yet: write to the user first. Greet them and say the goal back in your own words as a normal message, then ask.";

function hasAssistantText(messages: readonly { role: string; content: unknown }[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      (typeof m.content === "string"
        ? m.content.trim().length > 0
        : Array.isArray(m.content) &&
          m.content.some(
            (part: unknown) =>
              typeof part === "object" &&
              part !== null &&
              (part as { type?: unknown }).type === "text" &&
              typeof (part as { text?: unknown }).text === "string" &&
              (part as { text: string }).text.trim().length > 0,
          )),
  );
}

/**
 * Hold ask_user until Kleio Goals has written something to the user. A question
 * card as the very first thing in a new goal reads as an interrogation, and a
 * card shown before the turn's text would sit above the greeting. Once there
 * is any assistant text (this run or an earlier one), the tool is untouched.
 */
function greetBeforeAsking(tools: readonly AgentTool[], hasSpoken: () => boolean): AgentTool[] {
  return tools.map((tool) =>
    tool.name !== "ask_user"
      ? tool
      : {
          ...tool,
          execute: async (args, context) => {
            if (!hasSpoken()) throw new Error(GREET_FIRST_ERROR);
            return tool.execute(args, context);
          },
        },
  );
}

/**
 * Create a Kleio Goals session. Sessions are stored like coding sessions, keyed by
 * the goal folder, so the goal list and goal deletion find them there.
 */
export function createGoalsAgentSession(options: GoalsAgentOptions): AgentSession {
  const { goal, additionalTools = [], isActive = () => false, ...sessionOptions } = options;
  let spokeThisSession = false;
  // `getMessages()` is the conversation as of the last finished run, so text
  // streamed in the current run is tracked live alongside it.
  const hasSpoken = (): boolean => spokeThisSession || hasAssistantText(session.getMessages());
  const session: AgentSession = new AgentSession({
    ...sessionOptions,
    additionalTools: greetBeforeAsking(additionalTools, hasSpoken),
    // The goal is static for a session, so its brief belongs in the cached
    // prefix rather than a per-run tail.
    agentPrompt: buildGoalsAgentPrompt(goal),
    // Talks to the user directly, so no sub-agent return contract.
    agentRole: "primary",
    // The goal folder holds notes, not a codebase; attached folders are added
    // as workspace roots and read on demand.
    agentContext: "none",
    promptCacheKeyPrefix: "gggoals",
    // Orchestrating is the job: bringing in workers, steering them and
    // waiting on them must not need a tool_search first.
    coreTools: GOALS_CORE_TOOLS,
    // Editing and running always belong to the team, and the team only
    // starts once the user starts the goal. Same tool schemas either way, so
    // the cached tool block never changes.
    wrapTool: (tool) => {
      const delegated = GOALS_DELEGATED_TOOLS.has(tool.name);
      const startsWork = GOALS_START_TOOLS.has(tool.name);
      if (!delegated && !startsWork) return tool;
      return {
        ...tool,
        execute: async (args, context) => {
          if (delegated) throw new Error(isActive() ? DELEGATE_ERROR : BRIEFING_ERROR);
          if (!isActive()) throw new Error(BRIEFING_ERROR);
          return tool.execute(args, context);
        },
      };
    },
  });
  session.eventBus.on("text_delta", ({ text }) => {
    if (text.trim()) spokeThisSession = true;
  });
  // Fork-only until 223830dc removes Ideal self-review: upstream's coordinator
  // never ran it, so autopilot toggles must not switch it back on either.
  const suppressIdealReview = session.setIdealReviewSuppressed.bind(session);
  session.setIdealReviewSuppressed = () => suppressIdealReview(true);
  suppressIdealReview(true);
  return session;
}
