import type { ActivityPhase } from "@kleio/coder/ui";

/**
 * Boss-themed phrase library for the activity indicator. Replaces ggcoder's
 * coder-flavored phrases ("Cogitating", "Sleuthing", etc.) with vocabulary
 * that fits an orchestrator role — managing, dispatching, reviewing — so the
 * spinner reads as "the boss is at work" not "the boss is writing code".
 */
export const BOSS_PHRASES: Record<ActivityPhase, string[]> = {
  // Generic between-states fallback. Probably never shown but keep for safety.
  idle: ["Standing by", "Waiting for orders", "On call"],

  // Boss has issued a request, waiting for the LLM to begin streaming.
  waiting: [
    "Briefing",
    "Reviewing the room",
    "Triaging",
    "Lining up the brief",
    "Surveying projects",
    "Reading the room",
    "Picking the right hand",
    "Marshalling thoughts",
    "Checking the board",
    "Sizing up the work",
  ],

  // LLM is mid-thinking-block (extended reasoning).
  thinking: [
    "Strategising",
    "Plotting next move",
    "Weighing options",
    "Reasoning",
    "Deliberating",
    "Thinking it through",
    "Mapping the play",
    "Considering angles",
    "Calculating odds",
    "Drafting the call",
  ],

  // LLM is streaming text — boss is forming its dispatch / response.
  generating: [
    "Drafting",
    "Composing dispatch",
    "Writing the brief",
    "Penning instructions",
    "Wording it up",
    "Putting it on paper",
    "Phrasing the ask",
    "Forming the directive",
    "Scripting the plan",
  ],

  // Boss is invoking a tool — most often prompt_worker.
  tools: [
    "Coordinating",
    "Dispatching",
    "Routing",
    "Delegating",
    "Issuing orders",
    "Handing off",
    "Aligning workers",
    "Conducting",
    "Calling the team",
    "Steering",
    "Pulling levers",
  ],

  // Provider retry (overloaded / rate-limited / etc.).
  retrying: [
    "Reattempting",
    "Course correcting",
    "Trying again",
    "Pushing through",
    "Holding the line",
  ],
};
