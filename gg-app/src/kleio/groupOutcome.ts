// How a group member's turn ended, in words and in tone. On its own, free of
// the app's chrome, so the room's layout rules (castLayout.ts) can read it.

import type { GroupTurnOutcomeKind } from "./kleioApi";

export const OUTCOME_LABEL: Record<GroupTurnOutcomeKind, string> = {
  replied: "Replied",
  passed: "Passed",
  timed_out: "Stopped",
  failed: "Failed",
  unavailable: "Couldn't start",
  budget_exhausted: "Not reached",
};

/** The colour an outcome shows in: a stop is an error, a skipped turn a warning. */
export function outcomeTone(kind: GroupTurnOutcomeKind): "" | " is-error" | " is-warning" {
  if (kind === "timed_out" || kind === "failed" || kind === "unavailable") return " is-error";
  return kind === "budget_exhausted" ? " is-warning" : "";
}
