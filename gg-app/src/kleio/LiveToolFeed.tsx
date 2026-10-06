/**
 * The tool calls an agent is making right now, pinned above a Kleio chat's
 * composer: the same rows the Code and Chat windows show live (verb, command or
 * path, how long), so you can see it is working rather than stalled. The host
 * reports one clipped line of each call's args, never the output.
 */
import { formatDuration } from "../SubAgentFeed";
import { buildSummaryLineParts } from "../tool-format";
import { ToolRow, type ToolRowState } from "../ToolRow";
import type { ToolActivityEntry } from "./kleioApi";

/** Rows shown at once, as in the Code and Chat windows; older ones roll off the top. */
export const LIVE_TOOL_ROWS = 3;

/** A call's time so far, or in all once it ended (host clock both ends). */
export function callMs(e: ToolActivityEntry, nowMs: number): number {
  const start = Date.parse(e.startedAt);
  const end = e.endedAt ? Date.parse(e.endedAt) : nowMs;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export function toolRowState(e: ToolActivityEntry): ToolRowState {
  return e.status === "running" ? "running" : e.status === "failed" ? "failed" : "done";
}

/** One tool call: the status dot, what it did, and how long it took or has run. */
export function ToolCallRow({
  entry,
  nowMs,
  who,
  as,
}: {
  entry: ToolActivityEntry;
  nowMs: number;
  /** The agent's name, when several agents share one feed. */
  who?: string | undefined;
  as?: "li" | undefined;
}): React.ReactElement {
  const state = toolRowState(entry);
  const took = formatDuration(callMs(entry, nowMs));
  return (
    <ToolRow
      as={as}
      state={state}
      title={entry.summary || undefined}
      parts={buildSummaryLineParts(entry.name, entry.summary, state !== "running")}
    >
      {who && <span className="kleio-livetools-who">{who}</span>}
      <span
        className={`kleio-activity-time${
          state === "failed" ? " is-error" : state === "running" ? " is-live" : ""
        }`}
      >
        {state === "failed" ? `failed · ${took}` : state === "running" ? `live · ${took}` : took}
      </span>
    </ToolRow>
  );
}

/** One agent's calls, ready for the feed. */
export interface LiveToolCalls {
  /** The agent's name, shown on each row when several agents share the feed. */
  who?: string | undefined;
  entries: readonly ToolActivityEntry[];
}

/**
 * The newest calls across the given agents, oldest first, with the newest at
 * the bottom by the composer. Renders nothing while there are none.
 */
export function LiveToolFeed({
  calls,
  nowMs,
  label,
}: {
  calls: readonly LiveToolCalls[];
  nowMs: number;
  /** Names the list for screen readers, e.g. "Gardener's tool calls". */
  label: string;
}): React.ReactElement | null {
  const rows = calls
    .flatMap(({ who, entries }) => entries.map((entry) => ({ who, entry })))
    .sort((a, b) => Date.parse(a.entry.startedAt) - Date.parse(b.entry.startedAt))
    .slice(-LIVE_TOOL_ROWS);
  if (rows.length === 0) return null;
  return (
    <ol className="livetoolpanel kleio-livetools" aria-label={label}>
      {rows.map(({ who, entry }) => (
        <ToolCallRow
          key={`${who ?? ""}/${entry.id}`}
          as="li"
          entry={entry}
          nowMs={nowMs}
          who={who}
        />
      ))}
    </ol>
  );
}
