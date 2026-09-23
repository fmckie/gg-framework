/**
 * Routines: prompts that run on a schedule, owned by the daemon.
 *
 * This is the `/schedule` command's runtime, moved out of the webview so a
 * routine fires while no window is open — on a headless host, that is the whole
 * point. The rules are exactly the ones the window-scoped `useSchedules` hook
 * established, and each one has a reason:
 *
 * - **One ticker, not a timer per routine.** A 1 s interval compares every
 *   routine's `nextRunAt` to the clock. Per-routine `setTimeout`s drift and die
 *   silently when the machine sleeps through a deadline; re-reading the clock
 *   recovers on its own.
 * - **Missed occurrences are skipped, never replayed.** After sleep, a restart
 *   or a long run, `nextRunAt` advances to the next FUTURE boundary. A
 *   monitoring prompt that fell four occurrences behind should check once,
 *   now — not launch four agents against a repo that has moved on.
 * - **Firing mid-run queues, it does not drop.** `prompt()` is the session's
 *   normal prompt path, which queues as steering when the agent is busy.
 * - **No duplicate in the queue.** A routine whose prompt is already waiting on
 *   its session skips the occurrence. Without this a 15-minute routine behind
 *   a two-hour run would stack eight identical copies.
 * - **At most one fire per tick.** Two prompts in the same tick can both clear
 *   the sidecar's run-claim guard and hit the session at once. A routine that
 *   loses the tick keeps its past-due `nextRunAt`, so it goes next tick —
 *   advancing it would starve one that always comes due beside another.
 * - **The first run is one full interval out.** "Every 15 m" reads as future
 *   tense; firing on submit would start an agent the moment Enter was pressed.
 *
 * Each routine runs in its own daemon-owned session, created lazily on first
 * fire and reused after, so the agent keeps context across runs and never
 * collides with a window's interactive conversation.
 *
 * Persisted to `~/.gg/routines.json` (atomic write). `nextRunAt` is wall-clock
 * epoch ms on purpose: it has to survive a restart, which a monotonic clock
 * cannot. A forward clock jump is harmless (skip-missed); a backward one just
 * delays.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const TICK_MS = 1_000;
/**
 * A routine measured in seconds would re-fire faster than a coding turn can
 * finish. `GG_ROUTINES_MIN_INTERVAL_MS` lowers the floor for the daemon's own
 * integration tests only — a real host never sets it.
 */
export const MIN_INTERVAL_MS = (() => {
  const raw = Number(process.env.GG_ROUTINES_MIN_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : 60_000;
})();
/** Every routine keeps an agent session alive on the host; cap the foot-gun. */
export const MAX_ROUTINES = 20;
export const MAX_PROMPT_CHARS = 20_000;

export type RoutineMode = "code" | "chat";

export interface Routine {
  id: string;
  prompt: string;
  /** > 0, ≥ MIN_INTERVAL_MS. */
  intervalMs: number;
  /** `null` = until stopped. */
  runCount: number | null;
  runsCompleted: number;
  /** Epoch ms of the next planned fire. */
  nextRunAt: number;
  createdAt: number;
  /** Project directory the routine's session runs in. */
  cwd: string;
  mode: RoutineMode;
  chatAgent?: string;
  lastRun?: { at: number; outcome: "sent" | "queued" | "skipped" | "error"; error?: string };
}

/** What a client may submit. Everything else is set here. */
export interface RoutineInput {
  prompt: string;
  intervalMs: number;
  runCount: number | null;
  cwd: string;
  mode: RoutineMode;
  chatAgent?: string;
}

export type RoutineError =
  | { kind: "invalid"; message: string }
  | { kind: "limit"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "io"; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: RoutineError };

interface FileShape {
  version: 1;
  routines: Routine[];
}

/** Next boundary strictly in the future, skipping any occurrences missed. */
export function advanceNextRun(nextRunAt: number, intervalMs: number, now: number): number {
  if (now < nextRunAt) return nextRunAt;
  const missed = Math.floor((now - nextRunAt) / intervalMs) + 1;
  return nextRunAt + missed * intervalMs;
}

export function validateInput(input: unknown): Result<RoutineInput> {
  const bad = (message: string): Result<RoutineInput> => ({
    ok: false,
    error: { kind: "invalid", message },
  });
  if (typeof input !== "object" || input === null) return bad("body must be an object");
  const b = input as Record<string, unknown>;
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt) return bad("prompt is required");
  if (prompt.length > MAX_PROMPT_CHARS) return bad(`prompt is over ${MAX_PROMPT_CHARS} chars`);
  const intervalMs = b.intervalMs;
  if (
    typeof intervalMs !== "number" ||
    !Number.isFinite(intervalMs) ||
    intervalMs < MIN_INTERVAL_MS
  )
    return bad(`intervalMs must be a number ≥ ${MIN_INTERVAL_MS}`);
  let runCount: number | null = null;
  if (b.runCount !== null && b.runCount !== undefined) {
    if (typeof b.runCount !== "number" || !Number.isInteger(b.runCount) || b.runCount < 1)
      return bad("runCount must be null or an integer ≥ 1");
    runCount = b.runCount;
  }
  const cwd = typeof b.cwd === "string" ? b.cwd.trim() : "";
  if (!cwd) return bad("cwd is required");
  const mode: RoutineMode = b.mode === "chat" ? "chat" : "code";
  const chatAgent = typeof b.chatAgent === "string" && b.chatAgent ? b.chatAgent : undefined;
  return {
    ok: true,
    value: {
      prompt,
      intervalMs: Math.floor(intervalMs),
      runCount,
      cwd,
      mode,
      ...(chatAgent ? { chatAgent } : {}),
    },
  };
}

function isRoutine(v: unknown): v is Routine {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.prompt === "string" &&
    typeof r.intervalMs === "number" &&
    r.intervalMs > 0 &&
    (r.runCount === null || (typeof r.runCount === "number" && r.runCount >= 1)) &&
    typeof r.runsCompleted === "number" &&
    typeof r.nextRunAt === "number" &&
    typeof r.createdAt === "number" &&
    typeof r.cwd === "string" &&
    (r.mode === "code" || r.mode === "chat")
  );
}

/**
 * Write-then-rename. Windows briefly refuses a rename over a just-renamed
 * target (EPERM/EBUSY); retry those two codes only, clean the temp file up on
 * any failure.
 */
async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tmp, path);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if ((code !== "EPERM" && code !== "EBUSY") || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
      }
    }
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// ── Store ──────────────────────────────────────────────────────────────────

export interface RoutineStore {
  load(): Promise<void>;
  list(): Routine[];
  get(id: string): Routine | undefined;
  add(input: RoutineInput): Promise<Result<Routine>>;
  remove(id: string): Promise<Result<Routine>>;
  /** Replace fields in place (runner bookkeeping) and persist. */
  update(id: string, patch: Partial<Routine>): Promise<Routine | undefined>;
  /** Drop a routine without a client asking (bounded count exhausted). */
  drop(id: string): Promise<void>;
}

export function createRoutineStore(opts: {
  file: string;
  now?: () => number;
  log?: (line: string) => void;
}): RoutineStore {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  let routines: Routine[] = [];
  // Serialise writes so two quick changes cannot race their renames.
  let pending: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, routines } satisfies FileShape, null, 2);
    pending = pending.catch(() => {}).then(() => atomicWrite(opts.file, `${snapshot}\n`));
    return pending;
  }

  return {
    async load() {
      let raw: string;
      try {
        raw = await readFile(opts.file, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        log(`[routines] ${opts.file} is not JSON; starting empty`);
        return;
      }
      const list = (parsed as Partial<FileShape> | null)?.routines;
      if (!Array.isArray(list)) {
        log(`[routines] ${opts.file} has no routines array; starting empty`);
        return;
      }
      const kept = list.filter(isRoutine);
      if (kept.length !== list.length)
        log(`[routines] dropped ${list.length - kept.length} malformed record(s)`);
      routines = kept;
    },
    list: () => routines.map((r) => ({ ...r })),
    get: (id) => routines.find((r) => r.id === id),
    async add(input) {
      if (routines.length >= MAX_ROUTINES)
        return {
          ok: false,
          error: { kind: "limit", message: `at most ${MAX_ROUTINES} routines; stop one first` },
        };
      const t = now();
      const routine: Routine = {
        id: `rtn-${randomBytes(4).toString("hex")}`,
        prompt: input.prompt,
        intervalMs: input.intervalMs,
        runCount: input.runCount,
        runsCompleted: 0,
        nextRunAt: t + input.intervalMs,
        createdAt: t,
        cwd: input.cwd,
        mode: input.mode,
        ...(input.chatAgent ? { chatAgent: input.chatAgent } : {}),
      };
      routines = [...routines, routine];
      try {
        await persist();
      } catch (e) {
        routines = routines.filter((r) => r.id !== routine.id);
        return { ok: false, error: { kind: "io", message: String(e) } };
      }
      return { ok: true, value: { ...routine } };
    },
    async remove(id) {
      const routine = routines.find((r) => r.id === id);
      if (!routine) return { ok: false, error: { kind: "not_found", message: `no routine ${id}` } };
      routines = routines.filter((r) => r.id !== id);
      try {
        await persist();
      } catch (e) {
        return { ok: false, error: { kind: "io", message: String(e) } };
      }
      return { ok: true, value: routine };
    },
    async update(id, patch) {
      const i = routines.findIndex((r) => r.id === id);
      if (i === -1) return undefined;
      const next = { ...routines[i]!, ...patch };
      routines = [...routines.slice(0, i), next, ...routines.slice(i + 1)];
      await persist().catch((e) => log(`[routines] persist failed: ${String(e)}`));
      return next;
    },
    async drop(id) {
      if (!routines.some((r) => r.id === id)) return;
      routines = routines.filter((r) => r.id !== id);
      await persist().catch((e) => log(`[routines] persist failed: ${String(e)}`));
    },
  };
}

// ── Runner ─────────────────────────────────────────────────────────────────

/** What the runner needs from a session it fires into. */
export interface RoutineTarget {
  sessionId: string;
  /** Prompts already waiting as steering on this session. */
  queuedPrompts(): readonly string[];
  /** The session's normal prompt path: runs now, or queues if busy. */
  prompt(text: string): Promise<"sent" | "queued">;
  dispose(): Promise<void>;
}

export interface RoutineRunner {
  start(): void;
  /** Stop ticking. Disposes routine sessions unless the caller owns them. */
  stop(opts?: { dispose?: boolean }): Promise<void>;
  /** Run one tick now. */
  tick(): Promise<void>;
  /** The session a routine is bound to, once it has fired. */
  sessionFor(id: string): string | undefined;
  /**
   * Every routine → session binding the runner holds, INCLUDING routines that
   * finished their count and left the store: their session (and transcript)
   * lives on until released. A host that mirrors these must see the finished
   * ones too, or a one-shot routine's run is invisible to it.
   */
  sessions(): Record<string, string>;
  /** Dispose a routine's session (after the store removed the routine). */
  release(id: string): Promise<void>;
}

export function createRoutineRunner(opts: {
  store: RoutineStore;
  /** Create (lazily) the daemon-owned session a routine runs in. */
  createTarget: (routine: Routine) => Promise<RoutineTarget>;
  /** Called after any change the runner made (fire, skip, drop, error). */
  onChange?: (routines: Routine[]) => void;
  now?: () => number;
  tickMs?: number;
  log?: (line: string) => void;
}): RoutineRunner {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const targets = new Map<string, RoutineTarget>();
  let timer: NodeJS.Timeout | null = null;
  let ticking: Promise<void> | null = null;

  async function targetFor(routine: Routine): Promise<RoutineTarget> {
    const existing = targets.get(routine.id);
    if (existing) return existing;
    const t = await opts.createTarget(routine);
    targets.set(routine.id, t);
    log(`[routines] ${routine.id} → session ${t.sessionId}`);
    return t;
  }

  async function tick(): Promise<void> {
    const t = now();
    let changed = false;
    let firedThisTick = false;
    for (const routine of opts.store.list()) {
      if (t < routine.nextRunAt) continue;
      // Lost the tick: keeps its past-due nextRunAt, so next tick is its turn.
      if (firedThisTick) continue;

      let target: RoutineTarget;
      try {
        target = await targetFor(routine);
      } catch (e) {
        // Could not build a session (bad cwd, provider down). Note it, aim at
        // the next boundary, keep the routine — the cause may be transient.
        log(`[routines] ${routine.id} session failed: ${String(e)}`);
        await opts.store.update(routine.id, {
          nextRunAt: advanceNextRun(routine.nextRunAt, routine.intervalMs, t),
          lastRun: { at: t, outcome: "error", error: String(e).slice(0, 200) },
        });
        changed = true;
        continue;
      }

      if (target.queuedPrompts().includes(routine.prompt)) {
        // A copy is already waiting on the agent. Skip this occurrence; nothing
        // was sent, so runsCompleted is untouched.
        await opts.store.update(routine.id, {
          nextRunAt: advanceNextRun(routine.nextRunAt, routine.intervalMs, t),
          lastRun: { at: t, outcome: "skipped" },
        });
        changed = true;
        continue;
      }

      firedThisTick = true;
      changed = true;
      let outcome: "sent" | "queued" | "error";
      let error: string | undefined;
      try {
        outcome = await target.prompt(routine.prompt);
      } catch (e) {
        outcome = "error";
        error = String(e).slice(0, 200);
        log(`[routines] ${routine.id} prompt failed: ${error}`);
      }
      const runsCompleted = routine.runsCompleted + (outcome === "error" ? 0 : 1);
      if (routine.runCount !== null && runsCompleted >= routine.runCount) {
        log(`[routines] ${routine.id} finished ${runsCompleted}/${routine.runCount}`);
        await opts.store.drop(routine.id);
        // The final run is still in flight on its session; keep the session so
        // the transcript completes and stays attachable. It goes with the
        // daemon, or when a client deletes it.
        continue;
      }
      await opts.store.update(routine.id, {
        runsCompleted,
        nextRunAt: advanceNextRun(routine.nextRunAt, routine.intervalMs, t),
        lastRun: { at: t, outcome, ...(error ? { error } : {}) },
      });
    }
    if (changed) opts.onChange?.(opts.store.list());
  }

  function guardedTick(): Promise<void> {
    // Never overlap ticks: a slow createTarget must not let the next tick fire
    // the same routine twice.
    if (ticking) return ticking;
    ticking = tick()
      .catch((e) => log(`[routines] tick failed: ${String(e)}`))
      .finally(() => {
        ticking = null;
      });
    return ticking;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void guardedTick(), opts.tickMs ?? TICK_MS);
      timer.unref();
    },
    async stop(opts = {}) {
      if (timer) clearInterval(timer);
      timer = null;
      if (ticking) await ticking;
      const all = [...targets.values()];
      targets.clear();
      if (opts.dispose !== false) await Promise.allSettled(all.map((t) => t.dispose()));
    },
    tick: guardedTick,
    sessions: () => Object.fromEntries([...targets.entries()].map(([id, t]) => [id, t.sessionId])),
    sessionFor: (id) => targets.get(id)?.sessionId,
    async release(id) {
      const t = targets.get(id);
      if (!t) return;
      targets.delete(id);
      await t.dispose().catch(() => {});
    },
  };
}
