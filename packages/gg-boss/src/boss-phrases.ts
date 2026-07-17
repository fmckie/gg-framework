import type { ActivityPhase } from "@kleio/coder/ui";

/**
 * Manager-themed phrase library for the activity indicator. It replaces Kleio
 * Coder's implementation language with orchestration vocabulary—managing,
 * dispatching, and reviewing—so the spinner reads as Manager work.
 */
export const BOSS_PHRASES: Record<ActivityPhase, string[]> = {
  // Generic between-states fallback. Probably never shown but keep for safety.
  idle: ["Standing by", "Waiting for orders", "On call"],

  // Manager issued a request and is waiting for the model to begin streaming.
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
