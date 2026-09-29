// Blobs: small named helpers, each a pinned chat conversation of its own with
// a persona (name + job) and a model, plus schedules that prompt it on a clock.
//
// State: `blobs.json` next to home.json (atomic write, one at a time), and one
// `runs-<blobId>.jsonl` per Blob. Run lines are appended; a run is written
// when it starts and again when it closes, and a reader keeps the last line
// per id. The file is compacted to the newest 100 runs once it holds 200 lines.
//
// Each Blob's conversation follows the home thread's rules (pinned-thread.ts):
// cwd `<homeCwd>/blobs/<id>`, and every create/resume sends `persona` and
// `model`, since the engine does not persist them. A change to name, job or
// model retires the live session, so the next open resumes the same
// transcript under the new persona/model.
//
// Scheduler: a host ticker (5 s) fires at most one due schedule per tick.
// Missed occurrences are skipped, never replayed. A fire while the Blob's
// conversation is running is logged as a skipped run. A fired run is closed on
// the session's next run_end with the last assistant message as its summary.

import { randomBytes } from "node:crypto";
import { appendFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Nudge } from "./apns.js";
import { nextOccurrence, validTimeZone, type ScheduleKind } from "./blob-schedule.js";
import { atomicWrite } from "./device-registry.js";
import {
  createPinnedThread,
  field,
  type PinnedSession,
  type PinnedSessionError,
  type PinnedThread,
  type SidecarCall,
} from "./pinned-thread.js";
import type { Result } from "./result.js";

export const BLOB_COLORS = ["sky", "mint", "peach", "lilac", "lemon", "rose"] as const;
export type BlobColor = (typeof BLOB_COLORS)[number];
export const DEFAULT_BLOB_MODEL = "local/custom-127-0-0-1-3301/kimi-k3";
export const MAX_BLOBS = 12;
export const MAX_SCHEDULES = 10;
const KEEP_RUNS = 100;
const LIST_RUNS = 50;
const SUMMARY_CHARS = 280;
/** A fired run with no run_end after this long is closed as an error. */
const OPEN_RUN_TIMEOUT_MS = 2 * 3_600_000;

export interface ScheduleLastRun {
  readonly at: string;
  readonly outcome: "ran" | "skipped" | "error";
  readonly error?: string;
}

export interface Schedule {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly kind: ScheduleKind;
  readonly everyMinutes?: number;
  readonly time?: string;
  readonly days?: number[];
  readonly at?: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly notify: boolean;
  readonly nextRunAt: string | null;
  readonly lastRun?: ScheduleLastRun;
}

export interface Blob {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly color: BlobColor;
  readonly job: string;
  readonly model: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sessionId?: string;
  readonly sessionPath?: string | null;
  readonly schedules: Schedule[];
}

export interface Run {
  readonly id: string;
  readonly blobId: string;
  readonly scheduleId: string | null;
  readonly label: string;
  readonly startedAt: string;
  /** Absent while the run is in progress. */
  readonly endedAt?: string;
  readonly outcome: "ok" | "error" | "skipped";
  readonly summary?: string;
  readonly error?: string;
}

export type BlobView = Omit<Blob, "sessionPath"> & { running: boolean; lastRun?: Run };

/** A route's answer: status + JSON body. */
export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

export interface BlobsOptions {
  /** blobs.json; runs-<id>.jsonl go next to it. */
  readonly statePath: string;
  /** Parent of each Blob's cwd (`<homeCwd>/blobs`). */
  readonly cwdRoot: string;
  readonly defaultModel: string;
  readonly call: SidecarCall;
  readonly track: (sessionId: string) => Promise<void>;
  readonly untrack: (sessionId: string) => Promise<void>;
  /** The home thread, whose session answers GET /kleio/models. */
  readonly homeSession: () => Promise<Result<PinnedSession, PinnedSessionError>>;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
}

export interface Blobs {
  /** Load blobs.json, skip past-due schedules forward. Returns the session ids to track. */
  load(): Promise<string[]>;
  /** A /kleio/blobs or /kleio/models request, or null when the path is not one. */
  route(method: string, path: string, body: () => Promise<unknown>): Promise<Reply | null>;
  /**
   * Every upstream frame of every tracked session. Returns the nudge to send
   * when it closed a scheduled run whose schedule notifies, else null.
   */
  onFrame(sessionId: string, raw: string): Nudge | null;
  /** Fire at most one due schedule. */
  tick(): Promise<void>;
  /** Settles once every write started so far has landed. */
  flush(): Promise<void>;
}

class Invalid extends Error {}

const hex = (): string => randomBytes(4).toString("hex");
const chars = (s: string): number => [...s].length;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function text(v: unknown, name: string, max: number): string {
  if (typeof v !== "string" || !v.trim()) throw new Invalid(`${name} is required`);
  const s = v.trim();
  if (chars(s) > max) throw new Invalid(`${name} must be at most ${max} characters`);
  return s;
}

function emoji(v: unknown): string {
  if (typeof v !== "string" || [...segmenter.segment(v.trim())].length !== 1)
    throw new Invalid("emoji must be a single emoji");
  return v.trim();
}

function color(v: unknown): BlobColor {
  if (!BLOB_COLORS.includes(v as BlobColor))
    throw new Invalid(`color must be one of ${BLOB_COLORS.join(", ")}`);
  return v as BlobColor;
}

function model(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || !v.trim() || v.length > 200)
    throw new Invalid("model must be a model id or null");
  return v.trim();
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== "boolean") throw new Invalid(`${name} must be true or false`);
  return v;
}

function object(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new Invalid("body must be a JSON object");
  return v as Record<string, unknown>;
}

const TIMING_KEYS = ["kind", "everyMinutes", "time", "days", "at", "timezone", "enabled"];

/** Validate a whole schedule (input merged over the stored one); timing fields per kind only. */
function scheduleFields(
  o: Record<string, unknown>,
): Omit<Schedule, "id" | "nextRunAt" | "lastRun"> {
  const kind = o.kind;
  if (kind !== "interval" && kind !== "daily" && kind !== "weekly" && kind !== "once")
    throw new Invalid("kind must be interval, daily, weekly or once");
  const timezone = o.timezone === undefined ? "Europe/London" : o.timezone;
  if (typeof timezone !== "string" || !validTimeZone(timezone))
    throw new Invalid("timezone must be an IANA time zone, e.g. Europe/London");
  const base = {
    label: text(o.label, "label", 60),
    prompt: text(o.prompt, "prompt", 4000),
    kind,
    timezone,
    enabled: o.enabled === undefined ? true : bool(o.enabled, "enabled"),
    notify: o.notify === undefined ? true : bool(o.notify, "notify"),
  } as const;
  if (kind === "interval") {
    const n = o.everyMinutes;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 15 || n > 525_600)
      throw new Invalid("everyMinutes must be a whole number of minutes, at least 15");
    return { ...base, everyMinutes: n };
  }
  if (kind === "once") {
    if (typeof o.at !== "string" || !Number.isFinite(Date.parse(o.at)))
      throw new Invalid("at must be an ISO date-time");
    return { ...base, at: new Date(Date.parse(o.at)).toISOString() };
  }
  if (typeof o.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(o.time))
    throw new Invalid("time must be HH:MM (24-hour)");
  if (kind === "daily") return { ...base, time: o.time };
  const days = o.days;
  if (
    !Array.isArray(days) ||
    days.length === 0 ||
    !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  )
    throw new Invalid("days must be a non-empty list of weekdays, 0 = Sunday … 6 = Saturday");
  return { ...base, time: o.time, days: [...new Set(days as number[])].sort() };
}

function parseRun(line: string): Run | null {
  try {
    const r = JSON.parse(line) as Run;
    return typeof r?.id === "string" && typeof r.blobId === "string" ? r : null;
  } catch {
    return null;
  }
}

interface OpenRun {
  run: Run;
  sessionId: string;
  notify: boolean;
  text: string;
  /** A tool call or turn end came after the text: the next text is a new message. */
  stale: boolean;
  error?: string;
}

export function createBlobs(options: BlobsOptions): Blobs {
  const log = options.log ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  const dir = join(options.statePath, "..");
  let blobs: Blob[] = [];
  let loading: Promise<void> | null = null;
  const threads = new Map<string, PinnedThread>();
  /** Blob sessions with a run in progress, from run_start/run_end frames. */
  const running = new Set<string>();
  /** A fired schedule (or run-now) waiting for its run_end, by Blob id. */
  const open = new Map<string, OpenRun>();
  let ticking = false;

  // ---------------------------------------------------------------- blobs.json

  let writes: Promise<void> = Promise.resolve();
  function save(): Promise<void> {
    const p = writes
      .catch(() => {})
      .then(() => atomicWrite(options.statePath, `${JSON.stringify({ blobs }, null, 2)}\n`, 0o600));
    writes = p;
    return p.catch((e) => log(`[blobs] writing ${options.statePath} failed: ${String(e)}`));
  }

  function loaded(): Promise<void> {
    loading ??= readFile(options.statePath, "utf8").then(
      (raw) => {
        try {
          const parsed = JSON.parse(raw) as { blobs?: unknown };
          if (Array.isArray(parsed.blobs)) blobs = parsed.blobs as Blob[];
        } catch (e) {
          log(`[blobs] ignoring unreadable ${options.statePath}: ${String(e)}`);
        }
      },
      () => {
        /* first start */
      },
    );
    return loading;
  }

  const find = (id: string): Blob | undefined => blobs.find((b) => b.id === id);
  function replace(next: Blob): Blob {
    blobs = blobs.map((b) => (b.id === next.id ? next : b));
    return next;
  }
  function replaceSchedule(blobId: string, next: Schedule): void {
    const b = find(blobId);
    if (b) replace({ ...b, schedules: b.schedules.map((s) => (s.id === next.id ? next : s)) });
  }

  // ---------------------------------------------------------------- runs

  const runCache = new Map<string, { runs: Run[]; lines: number }>();
  const runWrites = new Map<string, Promise<void>>();
  const runsPath = (blobId: string): string => join(dir, `runs-${blobId}.jsonl`);

  async function runLog(blobId: string): Promise<{ runs: Run[]; lines: number }> {
    let c = runCache.get(blobId);
    if (c) return c;
    const raw = await readFile(runsPath(blobId), "utf8").catch(() => "");
    const byId = new Map<string, Run>();
    let lines = 0;
    for (const line of raw.split("\n")) {
      const r = line.trim() ? parseRun(line) : null;
      if (!r) continue;
      lines += 1;
      byId.set(r.id, { ...byId.get(r.id), ...r });
    }
    // A concurrent caller may have filled the cache while we read.
    c = runCache.get(blobId) ?? { runs: [...byId.values()].slice(-KEEP_RUNS), lines };
    runCache.set(blobId, c);
    return c;
  }

  /** Write a new or updated run: append its line, compacting when the file grows. */
  function putRun(run: Run): Promise<void> {
    const prev = runWrites.get(run.blobId) ?? Promise.resolve();
    const p = prev
      .catch(() => {})
      .then(async () => {
        const c = await runLog(run.blobId);
        const i = c.runs.findIndex((r) => r.id === run.id);
        if (i >= 0) c.runs[i] = run;
        else c.runs.push(run);
        if (c.runs.length > KEEP_RUNS) c.runs.splice(0, c.runs.length - KEEP_RUNS);
        if (!find(run.blobId)) return; // deleted meanwhile
        if (c.lines + 1 >= 2 * KEEP_RUNS) {
          await atomicWrite(
            runsPath(run.blobId),
            c.runs.map((r) => JSON.stringify(r) + "\n").join(""),
            0o600,
          );
          c.lines = c.runs.length;
        } else {
          await appendFile(runsPath(run.blobId), JSON.stringify(run) + "\n", { mode: 0o600 });
          c.lines += 1;
        }
      });
    runWrites.set(run.blobId, p);
    return p.catch((e) => log(`[blobs] writing runs for ${run.blobId} failed: ${String(e)}`));
  }

  async function lastRun(blobId: string): Promise<Run | undefined> {
    const { runs } = await runLog(blobId);
    return runs[runs.length - 1];
  }

  // ---------------------------------------------------------------- sessions

  function effectiveModel(b: Blob): string {
    return b.model ?? options.defaultModel;
  }

  function thread(blobId: string): PinnedThread {
    let t = threads.get(blobId);
    if (t) return t;
    t = createPinnedThread({
      name: `blob ${blobId}`,
      cwd: join(options.cwdRoot, blobId),
      store: {
        get: async () => {
          const b = find(blobId);
          if (!b) return null;
          return {
            ...(b.sessionId ? { sessionId: b.sessionId } : {}),
            sessionPath: b.sessionPath ?? null,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
          };
        },
        put: async (rec) => {
          const b = find(blobId);
          if (!b) return;
          const { sessionId: _old, ...rest } = b;
          replace({
            ...rest,
            ...(rec.sessionId ? { sessionId: rec.sessionId } : {}),
            sessionPath: rec.sessionPath,
          });
          await save();
        },
      },
      sessionFields: () => {
        const b = find(blobId);
        return b
          ? { persona: { name: b.name, instructions: b.job }, model: effectiveModel(b) }
          : {};
      },
      call: options.call,
      track: options.track,
      untrack: options.untrack,
      log,
      now,
    });
    threads.set(blobId, t);
    return t;
  }

  function isBusy(b: Blob): boolean {
    return open.has(b.id) || (b.sessionId !== undefined && running.has(b.sessionId));
  }

  async function view(b: Blob): Promise<BlobView> {
    const { sessionPath: _p, ...rest } = b;
    const last = await lastRun(b.id);
    return { ...rest, running: isBusy(b), ...(last ? { lastRun: last } : {}) };
  }

  // ---------------------------------------------------------------- scheduling

  /** Initial nextRunAt for a (re)timed schedule. */
  function firstRun(s: Omit<Schedule, "id" | "nextRunAt" | "lastRun">, t: number): string | null {
    if (!s.enabled) return null;
    const next = nextOccurrence(s, t);
    return next === null ? null : new Date(next).toISOString();
  }

  /** The schedule after an occurrence at `due` was handled (fired or skipped) at `t`. */
  function advanced(s: Schedule, due: number, t: number): Schedule {
    if (s.kind === "once") return { ...s, enabled: false, nextRunAt: null };
    const next = nextOccurrence(s, t, due);
    return { ...s, nextRunAt: next === null ? null : new Date(next).toISOString() };
  }

  function closeRun(blobId: string, patch: Partial<Run>): OpenRun | null {
    const o = open.get(blobId);
    if (!o) return null;
    open.delete(blobId);
    o.run = { ...o.run, ...patch, endedAt: now().toISOString() };
    void putRun(o.run);
    if (o.run.outcome === "error" && o.run.scheduleId) {
      const s = find(blobId)?.schedules.find((x) => x.id === o.run.scheduleId);
      if (s) {
        replaceSchedule(blobId, {
          ...s,
          lastRun: { at: o.run.startedAt, outcome: "error", error: o.run.error ?? "failed" },
        });
        void save();
      }
    }
    return o;
  }

  /** Prompt a Blob with a schedule now. Records and returns the run. */
  async function fire(blobId: string, s: Schedule): Promise<Run> {
    const startedAt = now().toISOString();
    const base = { id: `r_${hex()}`, blobId, scheduleId: s.id, label: s.label, startedAt };
    const finish = async (run: Run, lastRun: ScheduleLastRun): Promise<Run> => {
      const cur = find(blobId)?.schedules.find((x) => x.id === s.id);
      if (cur) replaceSchedule(blobId, { ...cur, lastRun });
      await Promise.all([putRun(run), save()]);
      return run;
    };
    const failed = (error: string): Promise<Run> => {
      log(`[blobs] ${blobId} "${s.label}" failed: ${error}`);
      return finish(
        { ...base, endedAt: now().toISOString(), outcome: "error", error },
        { at: startedAt, outcome: "error", error },
      );
    };
    const skipped = (): Promise<Run> => {
      log(`[blobs] ${blobId} "${s.label}" skipped: the conversation is running`);
      return finish(
        { ...base, endedAt: startedAt, outcome: "skipped", error: "conversation was busy" },
        { at: startedAt, outcome: "skipped" },
      );
    };

    const b = find(blobId);
    if (!b) return failed("blob deleted");
    if (isBusy(b)) return skipped();
    const session = await thread(blobId).resolve();
    if (!session.ok)
      return failed(
        session.error.detail
          ? `${session.error.error}: ${session.error.detail}`
          : session.error.error,
      );
    const sessionId = session.value.sessionId;
    // The frames may have missed a run started before the host did.
    const st = await options.call("GET", "/state", { session: sessionId });
    const state = st?.status === 200 ? field(st.body, "runState") : null;
    if (state && state !== "idle") return skipped();
    if (open.has(blobId)) return skipped();

    const run: Run = { ...base, outcome: "ok" };
    open.set(blobId, { run, sessionId, notify: s.notify, text: "", stale: false });
    const done = finish(run, { at: startedAt, outcome: "ran" });
    const r = await options.call("POST", "/prompt", {
      session: sessionId,
      body: { text: `⏰ Scheduled task "${s.label}":\n${s.prompt}` },
      timeoutMs: 30_000,
    });
    await done;
    // The sidecar answers 202 (accepted, or queued behind a run the checks
    // above didn't see); either way the run's frames will close it.
    if (r && r.status >= 200 && r.status < 300) {
      log(`[blobs] ${blobId} "${s.label}" fired in ${sessionId}`);
      return open.get(blobId)?.run ?? run;
    }
    const error = r ? `POST /prompt -> ${r.status}` : "sidecar unavailable";
    return (
      closeRun(blobId, { outcome: "error", error })?.run ?? { ...run, outcome: "error", error }
    );
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      await loaded();
      const t = now().getTime();
      for (const [blobId, o] of open)
        if (t - Date.parse(o.run.startedAt) > OPEN_RUN_TIMEOUT_MS)
          closeRun(blobId, { outcome: "error", error: "no end of run seen" });
      let due: { blobId: string; s: Schedule; at: number } | null = null;
      for (const b of blobs)
        for (const s of b.schedules) {
          const at = s.enabled && s.nextRunAt ? Date.parse(s.nextRunAt) : NaN;
          if (at <= t && (!due || at < due.at)) due = { blobId: b.id, s, at };
        }
      if (!due) return;
      // Advance first, so a slow fire can never fire the same occurrence twice.
      replaceSchedule(due.blobId, advanced(due.s, due.at, t));
      await save();
      await fire(due.blobId, due.s);
    } catch (e) {
      log(`[blobs] tick failed: ${String(e)}`);
    } finally {
      ticking = false;
    }
  }

  // ---------------------------------------------------------------- routes

  async function createBlob(input: unknown): Promise<Reply> {
    const o = object(input);
    if (blobs.length >= MAX_BLOBS)
      throw new Invalid(`You can have at most ${MAX_BLOBS} blobs; delete one first`);
    const at = now().toISOString();
    const blob: Blob = {
      id: `b_${hex()}`,
      name: text(o.name, "name", 40),
      emoji: o.emoji === undefined ? "🫧" : emoji(o.emoji),
      color: o.color === undefined ? "sky" : color(o.color),
      job: text(o.job, "job", 8000),
      model: o.model === undefined ? null : model(o.model),
      createdAt: at,
      updatedAt: at,
      schedules: [],
    };
    blobs = [...blobs, blob];
    await save();
    log(`[blobs] created ${blob.id} "${blob.name}"`);
    return { status: 200, body: { blob: await view(blob) } };
  }

  async function patchBlob(b: Blob, input: unknown): Promise<Reply> {
    const o = object(input);
    const next: Blob = {
      ...b,
      ...(o.name !== undefined ? { name: text(o.name, "name", 40) } : {}),
      ...(o.emoji !== undefined ? { emoji: emoji(o.emoji) } : {}),
      ...(o.color !== undefined ? { color: color(o.color) } : {}),
      ...(o.job !== undefined ? { job: text(o.job, "job", 8000) } : {}),
      ...(o.model !== undefined ? { model: model(o.model) } : {}),
      updatedAt: now().toISOString(),
    };
    replace(next);
    await save();
    // The engine takes persona and model at create only: retire the live
    // session so the next open resumes the transcript with the new ones.
    if (next.name !== b.name || next.job !== b.job || next.model !== b.model) {
      await thread(b.id).retire();
      closeRun(b.id, { outcome: "error", error: "blob changed during the run" });
    }
    return { status: 200, body: { blob: await view(find(b.id) ?? next) } };
  }

  async function deleteBlob(b: Blob): Promise<Reply> {
    await thread(b.id).retire();
    open.delete(b.id);
    threads.delete(b.id);
    blobs = blobs.filter((x) => x.id !== b.id);
    await save();
    await runWrites.get(b.id)?.catch(() => {});
    runCache.delete(b.id);
    runWrites.delete(b.id);
    await rm(runsPath(b.id), { force: true });
    log(`[blobs] deleted ${b.id} "${b.name}"`);
    return { status: 200, body: { ok: true } };
  }

  function session(r: Result<PinnedSession, PinnedSessionError>): Reply {
    if (!r.ok) return { status: 502, body: r.error };
    const { sessionId, sessionPath, created } = r.value;
    return { status: 200, body: { sessionId, sessionPath, created } };
  }

  async function addSchedule(b: Blob, input: unknown): Promise<Reply> {
    if (b.schedules.length >= MAX_SCHEDULES)
      throw new Invalid(`A blob can have at most ${MAX_SCHEDULES} schedules`);
    const fields = scheduleFields(object(input));
    const t = now().getTime();
    if (fields.kind === "once" && Date.parse(fields.at!) <= t)
      throw new Invalid("at must be in the future");
    const s: Schedule = { id: `s_${hex()}`, ...fields, nextRunAt: firstRun(fields, t) };
    replace({ ...b, schedules: [...b.schedules, s] });
    await save();
    return { status: 200, body: { schedule: s } };
  }

  async function patchSchedule(b: Blob, s: Schedule, input: unknown): Promise<Reply> {
    const o = object(input);
    const { id, nextRunAt, lastRun: last, ...stored } = s;
    const fields = scheduleFields({ ...stored, ...o });
    const retimed = TIMING_KEYS.some((k) => o[k] !== undefined);
    const t = now().getTime();
    if (retimed && fields.kind === "once" && fields.enabled && Date.parse(fields.at!) <= t)
      throw new Invalid("at must be in the future");
    const next: Schedule = {
      id,
      ...fields,
      nextRunAt: retimed ? firstRun(fields, t) : fields.enabled ? nextRunAt : null,
      ...(last ? { lastRun: last } : {}),
    };
    replaceSchedule(b.id, next);
    await save();
    return { status: 200, body: { schedule: next } };
  }

  async function handle(
    method: string,
    path: string,
    body: () => Promise<unknown>,
  ): Promise<Reply | null> {
    if (method === "GET" && path === "/kleio/models") {
      const home = await options.homeSession();
      if (!home.ok) return { status: 502, body: home.error };
      const r = await options.call("GET", "/models", { session: home.value.sessionId });
      if (!r) return { status: 502, body: { error: "sidecar unavailable" } };
      if (r.status !== 200)
        return {
          status: 502,
          body: { error: "sidecar error", detail: `GET /models -> ${r.status}` },
        };
      let list: { id?: unknown; name?: unknown; provider?: unknown }[] = [];
      try {
        const parsed = (JSON.parse(r.body) as { models?: unknown }).models;
        if (Array.isArray(parsed)) list = parsed as typeof list;
      } catch {
        /* an empty list */
      }
      const models = list
        .filter((m) => typeof m.id === "string")
        .map((m) => ({
          id: m.id as string,
          label: typeof m.name === "string" && m.name ? m.name : (m.id as string),
          private: m.provider === "local",
        }))
        .sort((a, c) => Number(c.private) - Number(a.private));
      return { status: 200, body: { models, defaultBlobModel: options.defaultModel } };
    }

    if (path !== "/kleio/blobs" && !path.startsWith("/kleio/blobs/")) return null;
    await loaded();
    if (path === "/kleio/blobs") {
      if (method === "GET")
        return { status: 200, body: { blobs: await Promise.all(blobs.map(view)) } };
      if (method === "POST") return createBlob(await body());
      return { status: 405, body: { error: "method not allowed" } };
    }
    const m = path.match(/^\/kleio\/blobs\/(b_[0-9a-f]{8})(\/.*)?$/);
    const b = m ? find(m[1]!) : undefined;
    if (!b) return { status: 404, body: { error: "no such blob" } };
    const rest = m![2] ?? "";
    if (rest === "") {
      if (method === "PATCH") return patchBlob(b, await body());
      if (method === "DELETE") return deleteBlob(b);
      if (method === "GET") return { status: 200, body: { blob: await view(b) } };
    }
    if (rest === "/session" && method === "GET") return session(await thread(b.id).resolve());
    if (rest === "/new" && method === "POST") return session(await thread(b.id).startNew());
    if (rest === "/runs" && method === "GET") {
      const { runs } = await runLog(b.id);
      return { status: 200, body: { runs: runs.slice(-LIST_RUNS).reverse() } };
    }
    if (rest === "/schedules" && method === "POST") return addSchedule(b, await body());
    const sm = rest.match(/^\/schedules\/(s_[0-9a-f]{8})(\/run)?$/);
    const s = sm ? b.schedules.find((x) => x.id === sm[1]) : undefined;
    if (sm && !s) return { status: 404, body: { error: "no such schedule" } };
    if (s && !sm![2]) {
      if (method === "PATCH") return patchSchedule(b, s, await body());
      if (method === "DELETE") {
        replace({ ...b, schedules: b.schedules.filter((x) => x.id !== s.id) });
        await save();
        return { status: 200, body: { ok: true } };
      }
    }
    if (s && sm![2] && method === "POST")
      return { status: 200, body: { run: await fire(b.id, s) } };
    return { status: 404, body: { error: "not found" } };
  }

  // ---------------------------------------------------------------- frames

  function onFrame(sessionId: string, raw: string): Nudge | null {
    const b = blobs.find((x) => x.sessionId === sessionId);
    if (!b) return null;
    const o = open.get(b.id);
    const data = raw.match(/^data: (.*)$/m)?.[1];
    if (!data) return null;
    let f: { type?: unknown; data?: unknown };
    try {
      f = JSON.parse(data) as typeof f;
    } catch {
      return null;
    }
    const d =
      typeof f.data === "object" && f.data !== null ? (f.data as Record<string, unknown>) : {};
    const mine = o && o.sessionId === sessionId ? o : undefined;
    switch (f.type) {
      case "run_start":
        running.add(sessionId);
        if (mine) {
          mine.text = "";
          mine.stale = false;
        }
        return null;
      case "text_delta":
        if (mine && typeof d.text === "string") {
          if (mine.stale) mine.text = "";
          mine.stale = false;
          mine.text += d.text;
        }
        return null;
      case "error":
        if (mine) {
          const msg = d.message ?? d.headline;
          if (typeof msg === "string" && msg) mine.error = msg;
        }
        return null;
      case "run_end": {
        running.delete(sessionId);
        // The transcript path appears at the first run end and moves on
        // compaction; re-learn it for every run, scheduled or not.
        void thread(b.id)
          .onRunEnd(sessionId)
          .catch((e) => log(`[blobs] ${b.id} path: ${String(e)}`));
        if (!mine) return null;
        const failed = d.failed === true || d.cancelled === true;
        const summary = [...mine.text.trim()].slice(0, SUMMARY_CHARS).join("");
        const closed = closeRun(b.id, {
          outcome: failed ? "error" : "ok",
          ...(summary ? { summary } : {}),
          ...(failed ? { error: mine.error ?? (d.cancelled ? "cancelled" : "run failed") } : {}),
        });
        log(`[blobs] ${b.id} "${mine.run.label}" ended ${failed ? "with an error" : "ok"}`);
        if (!closed?.notify) return null;
        return {
          sessionId,
          title: `${b.emoji} ${b.name}`,
          body: summary || mine.run.label,
        };
      }
      default:
        if (
          mine &&
          typeof f.type === "string" &&
          (f.type === "turn_end" || f.type.startsWith("tool_"))
        )
          mine.stale = true;
        return null;
    }
  }

  return {
    async load() {
      await loaded();
      const t = now().getTime();
      let changed = false;
      for (const b of blobs)
        for (const s of b.schedules) {
          const at = s.enabled && s.nextRunAt ? Date.parse(s.nextRunAt) : NaN;
          if (!(at <= t)) continue;
          // Missed while the host was down: skip forward, never replay.
          const next = advanced(s, at, t);
          replaceSchedule(
            b.id,
            s.kind === "once"
              ? { ...next, lastRun: { at: s.nextRunAt!, outcome: "skipped", error: "missed" } }
              : next,
          );
          changed = true;
        }
      if (changed) await save();
      return blobs.flatMap((b) => (b.sessionId ? [b.sessionId] : []));
    },
    async route(method, path, body) {
      try {
        return await handle(method, path, body);
      } catch (e) {
        if (e instanceof Invalid) return { status: 400, body: { error: e.message } };
        throw e;
      }
    },
    onFrame,
    tick,
    flush: async () => {
      await writes.catch(() => {});
      await Promise.allSettled(runWrites.values());
    },
  };
}
