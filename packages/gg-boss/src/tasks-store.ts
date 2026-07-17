import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { useSyncExternalStore } from "react";
import { getManagerPaths } from "./manager-paths.js";

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "skipped";

export interface BossTask {
  id: string;
  /** Project name (matches a linked worker). */
  project: string;
  /** Short one-line summary shown in the overlay. */
  title: string;
  /** Full instruction sent to the worker when this task is dispatched. */
  description: string;
  status: TaskStatus;
  /** Pre-decided when adding — passed through to prompt_worker on dispatch. */
  fresh?: boolean;
  /** Boss's running notes / blocker reason. */
  notes?: string;
  /** When dispatched, holds the worker_turn_complete summary text. */
  resultSummary?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight task store — Kleio Manager's plan of record. One JSON file at
 * ~/.gg/boss/plan.json; per-project grouping happens in the read layer rather
 * than on disk.
 */

function getPlanPath(): string {
  return getManagerPaths().planFile;
}

interface PlanFile {
  tasks: BossTask[];
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(getPlanPath()), { recursive: true, mode: 0o700 });
}

async function loadPlan(): Promise<BossTask[]> {
  try {
    const content = await fs.readFile(getPlanPath(), "utf-8");
    const parsed = JSON.parse(content) as Partial<PlanFile>;
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}

/**
 * Serialize concurrent persist() calls. With N workers in parallel, multiple
 * task updates can fire in the same tick — writeFile is NOT atomic and racing
 * writes leave the file half-overwritten (old bytes past the new content's
 * end), which then fails JSON.parse and silently returns []. We chain every
 * persist on this promise so writes happen one at a time.
 */
let persistChain: Promise<void> = Promise.resolve();

async function persist(tasks: BossTask[]): Promise<void> {
  // Capture the current state at call time so each queued write persists the
  // snapshot it was asked to, even if state mutates further before this
  // write's turn in the chain.
  const snapshot = JSON.stringify({ tasks }, null, 2) + "\n";
  const next = persistChain.then(async () => {
    await ensureDir();
    // Atomic write: write to a sibling .tmp then rename. POSIX rename(2) is
    // atomic on the same filesystem — the destination either has the old
    // content or the new content, never a half-written mix. Suffix includes
    // pid so two ggboss processes don't clobber each other's tmp files.
    const finalPath = getPlanPath();
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, snapshot, "utf-8");
    await fs.rename(tmpPath, finalPath);
  });
  persistChain = next.catch(() => undefined); // keep chain alive on errors
  await next;
}

// ── Reactive state ─────────────────────────────────────────

interface TasksUiState {
  tasks: BossTask[];
  /** Bumped on every mutation so overlay-side useEffects can react. */
  version: number;
}

let state: TasksUiState = { tasks: [], version: 0 };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSnapshot(): TasksUiState {
  return state;
}

export function useTasksState(): TasksUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Helpers ────────────────────────────────────────────────

function newId(): string {
  return crypto.randomBytes(6).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

// ── Public API (used by tools, overlay, orchestrator) ──────

export const tasksStore = {
  /**
   * Hydrate state from disk on startup. Also prunes terminal tasks (done +
   * skipped) so the overlay doesn't pile up months of completed history, and
   * resets stale `in_progress` rows back to `pending` — those represent tasks
   * that were running when ggboss exited, so the worker never finished them
   * and we don't have a result. Re-runs them next time `r` (or auto-chain)
   * fires. Persists the cleaned list back to disk if anything changed.
   */
  async load(): Promise<void> {
    const raw = await loadPlan();
    const before = raw.length;
    // Backfill missing status — older bug let update_task wipe status to
    // undefined. Treat any task with no status (or an unrecognised one) as
    // pending so the user can still run them. Then prune terminals + reset
    // stale in_progress.
    const VALID_STATUSES: TaskStatus[] = ["pending", "in_progress", "done", "blocked", "skipped"];
    const normalized = raw.map((t) => {
      const status = VALID_STATUSES.includes(t.status as TaskStatus)
        ? (t.status as TaskStatus)
        : ("pending" as TaskStatus);
      return status === t.status ? t : { ...t, status, updatedAt: now() };
    });
    const cleaned = normalized
      .filter((t) => t.status !== "done" && t.status !== "skipped")
      .map((t) =>
        t.status === "in_progress"
          ? { ...t, status: "pending" as TaskStatus, updatedAt: now() }
          : t,
      );
    state = { tasks: cleaned, version: state.version + 1 };
    notify();
    // Only write back if we actually changed anything to avoid pointless
    // touches to the file on every startup.
    const changed =
      cleaned.length !== before || cleaned.some((t, i) => t.status !== raw[i]?.status);
    if (changed) await persist(cleaned);
  },

  /** Synchronous read. Used by boss tools that need to inspect/list. */
  list(filter?: { project?: string; status?: TaskStatus }): BossTask[] {
    let xs = state.tasks;
    if (filter?.project) xs = xs.filter((t) => t.project === filter.project);
    if (filter?.status) xs = xs.filter((t) => t.status === filter.status);
    return xs;
  },

  byId(id: string): BossTask | undefined {
    return state.tasks.find((t) => t.id === id);
  },

  async add(input: {
    project: string;
    title: string;
    description: string;
    fresh?: boolean;
  }): Promise<BossTask> {
    const task: BossTask = {
      id: newId(),
      project: input.project,
      title: input.title,
      description: input.description,
      status: "pending",
      fresh: input.fresh,
      createdAt: now(),
      updatedAt: now(),
    };
    state = { tasks: [...state.tasks, task], version: state.version + 1 };
    await persist(state.tasks);
    notify();
    return task;
  },

  async update(
    id: string,
    fields: Partial<Pick<BossTask, "status" | "notes" | "resultSummary" | "title" | "description">>,
  ): Promise<BossTask | null> {
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const next = { ...state.tasks[idx]!, ...fields, updatedAt: now() };
    const tasks = state.tasks.slice();
    tasks[idx] = next;
    state = { tasks, version: state.version + 1 };
    await persist(state.tasks);
    notify();
    return next;
  },

  async remove(id: string): Promise<boolean> {
    const before = state.tasks.length;
    const tasks = state.tasks.filter((t) => t.id !== id);
    if (tasks.length === before) return false;
    state = { tasks, version: state.version + 1 };
    await persist(state.tasks);
    notify();
    return true;
  },

  /**
   * Find the next pending task for a project (FIFO by createdAt). Used by
   * dispatch_pending to pick what to send next.
   */
  nextPending(project: string): BossTask | undefined {
    return state.tasks
      .filter((t) => t.project === project && t.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  },

  /**
   * Find the next dispatchable task — pending OR blocked — for a project.
   * Used by overlay's "r" (run all) so blocked tasks get retried alongside
   * pending ones. Pending is preferred (lower priority value); blocked falls
   * through if there are no pending ones.
   */
  nextDispatchable(project: string): BossTask | undefined {
    const candidates = state.tasks
      .filter((t) => t.project === project && (t.status === "pending" || t.status === "blocked"))
      .sort((a, b) => {
        // Pending before blocked — fresh work first, then retry attempts.
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
    return candidates[0];
  },

  /** Test/dev reset — wipes in-memory + disk. */
  async reset(): Promise<void> {
    state = { tasks: [], version: state.version + 1 };
    await persist([]);
    notify();
  },
};
