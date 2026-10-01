// One agent (or group) as a list row, laid out like a Chats/Code picker row:
// its picture, name and a short state on the first line, the job (or last
// message) on the second. Lists render it inside a button; the forms render
// it as a live preview.

import { Badge } from "../Badge";
import { theme } from "../theme";
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

export function AgentRowContent({
  name,
  avatar,
  sub,
  state,
}: {
  name: string;
  /** The agent's blob, or a group's cluster of member blobs. */
  avatar: React.ReactNode;
  /** Second line: the job, or a group's last message. */
  sub: string;
  state: RowState;
}): React.ReactElement {
  return (
    <>
      <span className="kleio-row-avatar">{avatar}</span>
      <span className="kleio-row-text">
        <span className="picker-row">
          <span className="picker-name kleio-row-name" style={{ color: theme.text }}>
            {name}
          </span>
          <Badge className={`kleio-state is-${state.tone}`}>{state.text}</Badge>
        </span>
        <span className="picker-meta kleio-row-sub" style={{ color: theme.textMuted }}>
          {sub}
        </span>
      </span>
    </>
  );
}
