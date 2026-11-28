import { lazy, Suspense, useMemo, type ComponentType } from "react";
import type { Item } from "../transcript-item";
import type { LaneGroup } from "./OlympusLane";

type Lane = ComponentType<{ groups: readonly LaneGroup[] }>;

// The lane is decoration: if its chunk won't load, there is none.
const OlympusLane = lazy((): Promise<{ default: Lane }> =>
  import("./OlympusLane").then(
    (m) => ({ default: m.OlympusLane }),
    () => ({ default: () => null }),
  ),
);

type Group = Extract<Item, { kind: "subagent_group" }>;

/**
 * The groups with an agent this window saw at work. A resumed chat's rows are
 * rebuilt from history with no start time, so they never ask for the lane.
 */
export function liveGroups(items: readonly Item[]): Group[] {
  return items.filter(
    (item): item is Group =>
      item.kind === "subagent_group" && item.agents.some((agent) => agent.startedAt !== undefined),
  );
}

/**
 * Where the lane goes in a session, over the activity line. Nothing, the
 * lane's chunk included, until an agent is at work.
 */
export function LaneMount({ items }: { items: readonly Item[] }): React.ReactElement | null {
  const groups = useMemo(() => liveGroups(items), [items]);
  if (groups.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <OlympusLane groups={groups} />
    </Suspense>
  );
}
