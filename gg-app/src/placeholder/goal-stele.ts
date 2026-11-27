// The stele: a finished stretch's account, one line a worker, and who gets the
// laurel. Pure, so the panel, its picture and the courtyard share one reading.

import { formatElapsed, formatTokenCount } from "../ActivityBar";
import { godOf, type God } from "../olympus/gods";
import type { FinishOutcome, GoalFinish } from "./goal-finish";
import { workerPhase } from "./goal-progress";
import {
  collectWorkers,
  goalAgentStateLabel,
  workerGoalAgent,
  type GoalAgentStatus,
  type WorkerAgent,
  type WorkerGroup,
} from "./worker-status";

export interface SteleLine {
  /** The worker's row key, as the courtyard and the rows know it. */
  readonly key: string;
  readonly god: God;
  readonly name: string;
  /** Its state as its row says it, and the row's own status behind that. */
  readonly ending: string;
  readonly status: GoalAgentStatus;
  readonly time: string;
  readonly tools: string;
  readonly tokens: string;
  readonly laurel: boolean;
}

export interface SteleTotal {
  readonly label: string;
  readonly value: string;
}

export interface Stele {
  /** The finish's own id. */
  readonly id: number;
  readonly outcome: FinishOutcome;
  readonly title: string;
  readonly lines: readonly SteleLine[];
  /** The crowned worker's key, or null when nobody is crowned. */
  readonly laurel: string | null;
  readonly totals: readonly SteleTotal[];
}

/** What the crowned worker's line says under its name. */
export const LAUREL_WORDS = "Laurels: most tools used";
/** A cell with nothing to say. */
export const STELE_BLANK = "–";

// The finish card's own titles.
const TITLE: Readonly<Record<FinishOutcome, string>> = {
  done: "Job done",
  unverified: "Done, not all checked",
  failed: "Couldn't finish",
};

/**
 * The worker that did most, by its key: among those that finished, the most
 * tools used, then the longer time, then whoever was brought in first. Null
 * when nobody finished, or the stretch itself failed.
 */
export function laurelOf(workers: readonly WorkerAgent[], outcome: FinishOutcome): string | null {
  if (outcome === "failed") return null;
  let best: WorkerAgent | null = null;
  for (const worker of workers) {
    // Finished as the tally counts it: done, or idle and waiting for more.
    if (workerPhase(worker.status) !== "done") continue;
    if (
      !best ||
      worker.toolUseCount > best.toolUseCount ||
      (worker.toolUseCount === best.toolUseCount &&
        (worker.durationMs ?? 0) > (best.durationMs ?? 0))
    )
      best = worker;
  }
  return best?.key ?? null;
}

/** The workers brought in during the finish's stretch: the ones its card counts. */
export function stretchWorkers(finish: GoalFinish, groups: readonly WorkerGroup[]): WorkerAgent[] {
  return collectWorkers(groups.filter((group) => group.id > finish.fromItemId));
}

/** The stele for a finish: its workers' lines, the laurel and the card's totals. */
export function steleOf(
  finish: GoalFinish,
  groups: readonly WorkerGroup[],
  gods: ReadonlyMap<string, God>,
): Stele {
  const workers = stretchWorkers(finish, groups);
  const laurel = laurelOf(workers, finish.outcome);
  return {
    id: finish.id,
    outcome: finish.outcome,
    title: TITLE[finish.outcome],
    laurel,
    lines: workers.map((worker) => {
      // The Workers rows' own reading of it, so a line never says other than its row.
      const row = workerGoalAgent(worker);
      return {
        key: worker.key,
        god: gods.get(worker.key) ?? godOf(undefined),
        name: worker.label,
        ending: goalAgentStateLabel(row),
        status: row.status,
        time: worker.durationMs === undefined ? STELE_BLANK : formatElapsed(worker.durationMs),
        tools: String(worker.toolUseCount),
        tokens: worker.tokens ?? STELE_BLANK,
        laurel: worker.key === laurel,
      };
    }),
    totals: [
      { label: "Time", value: formatElapsed(finish.elapsedMs) },
      {
        label: "Workers",
        value:
          finish.failedWorkers > 0
            ? `${finish.workers} (${finish.failedWorkers} failed)`
            : String(finish.workers),
      },
      { label: "Turns", value: String(finish.turns) },
      { label: "Tokens written", value: formatTokenCount(finish.outputTokens) },
    ],
  };
}

// The laurel's mark on the crowned line, in a 16 by 16 box: a wreath open at
// the top, five leaves a side. The panel draws it as SVG, the picture on a canvas.
export const LAUREL_LEAF = { rx: 2.2, ry: 1 } as const;
export const LAUREL_LEAVES: readonly {
  readonly x: number;
  readonly y: number;
  readonly deg: number;
}[] = [-1, 1].flatMap((side) =>
  [18, 50, 82, 114, 146].map((up) => {
    const a = (up * Math.PI) / 180;
    const tip = (25 * Math.PI) / 180;
    // Along the wreath, each leaf tipped a little outward.
    const dx = Math.cos(tip) * side * Math.cos(a) + Math.sin(tip) * side * Math.sin(a);
    const dy = -Math.cos(tip) * Math.sin(a) + Math.sin(tip) * Math.cos(a);
    const round = (v: number): number => Math.round(v * 100) / 100;
    return {
      x: round(8 + side * 5.6 * Math.sin(a)),
      y: round(8.4 + 5.6 * Math.cos(a)),
      deg: round((Math.atan2(dy, dx) * 180) / Math.PI),
    };
  }),
);
