// An agent's (or a group's) short state, in plain words: what the shelf, a
// chat's header and the room say about it.

import { formatWhen, nextRun } from "./blobFormat";
import type { Blob, Schedule } from "./kleioApi";

export type RowTone = "live" | "failed" | "plain";

export interface RowState {
  text: string;
  tone: RowTone;
}

/** The state for an agent with these schedules and nothing running. */
export function scheduleState(schedules: readonly Schedule[], now: Date = new Date()): RowState {
  const next = nextRun(schedules);
  if (next) return { text: `Next ${formatWhen(next, now)}`, tone: "plain" };
  return { text: schedules.length > 0 ? "Paused" : "On call", tone: "plain" };
}

/** The short state at the right of an agent's row. */
export function agentRowState(blob: Blob, now: Date = new Date()): RowState {
  if (blob.running) return { text: "Working now", tone: "live" };
  if (blob.lastRun?.endedAt && blob.lastRun.outcome === "error")
    return { text: "Last run failed", tone: "failed" };
  return scheduleState(blob.schedules, now);
}
