// What this device has seen of Overview, so each of its moments plays once:
// the welcome on a new device, one line the first time a needed step it saw
// "not set up" is seen done, and the finish. Kept in localStorage; where that
// can't be read or written, in memory until the app restarts.

import { SETUP_SEEN_KEY } from "../app-entry-view";

export const WELCOMED_KEY = "kleio.overview.welcomed";
export const STEPS_KEY = "kleio.overview.steps";
export const FINISHED_KEY = "kleio.overview.finished";

export const STEP_IDS = ["host", "models", "voice", "apps"] as const;
export type StepId = (typeof STEP_IDS)[number];
/** What a read shows of a step: done, not set up, or nothing it can go by. */
export type Sight = "done" | "todo" | null;
export type Sights = Record<StepId, Sight>;

type Seen = "todo" | "done" | "said";
type Store = Pick<Storage, "getItem" | "setItem"> | null;

// What the store wouldn't take.
const memory = new Map<string, string>();

function read(storage: Store, key: string): string | null {
  const kept = memory.get(key);
  if (kept !== undefined) return kept;
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Store, key: string, value: string): void {
  try {
    if (!storage) throw new Error("no store");
    storage.setItem(key, value);
    // A store that can't be read back keeps nothing.
    if (storage.getItem(key) !== value) throw new Error("not kept");
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
}

/** Forget what was kept in memory, as a restart does. */
export function forgetSeen(): void {
  memory.clear();
}

/**
 * Whether this visit opens on the welcome: a device that has never seen Setup
 * or Overview. Ask before Overview marks itself seen. A store that can't be
 * read welcomes nobody, as it never reopens Setup (shouldOpenSetup).
 */
export function welcomeOwed(storage: Store): boolean {
  if (!storage || memory.has(WELCOMED_KEY)) return false;
  try {
    return storage.getItem(SETUP_SEEN_KEY) !== "1" && storage.getItem(WELCOMED_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markWelcomed(storage: Store): void {
  write(storage, WELCOMED_KEY, "1");
}

/**
 * What a row's mark shows of its step. The host is never "not set up": it
 * counts as waiting only when a new device's first visit finds it not answering.
 */
export function sightOf(step: StepId, mark: string, newDevice: boolean): Sight {
  if (mark === "ok") return "done";
  if (mark === "unset") return "todo";
  if (step === "host" && mark === "fault" && newDevice) return "todo";
  return null;
}

function parse(raw: string | null): Partial<Record<StepId, Seen>> {
  const record: Partial<Record<StepId, Seen>> = {};
  if (!raw) return record;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return record;
  }
  if (typeof value !== "object" || value === null) return record;
  for (const step of STEP_IDS) {
    const seen = (value as Record<string, unknown>)[step];
    if (seen === "todo" || seen === "done" || seen === "said") record[step] = seen;
  }
  return record;
}

/**
 * Record a complete read. Returns the steps whose line plays now (seen waiting
 * before, done now; in setup order) and whether the finish does. Both are
 * spent by this call. `fault` is something leading the headline: the finish
 * waits for a read without one.
 */
export function noteSteps(
  storage: Store,
  sights: Sights,
  fault: boolean,
): { said: StepId[]; finish: boolean } {
  const record = parse(read(storage, STEPS_KEY));
  const said: StepId[] = [];
  let changed = false;
  for (const step of STEP_IDS) {
    const was = record[step];
    const now = sights[step];
    if (was === undefined && now) {
      record[step] = now;
      changed = true;
    } else if (was === "todo" && now === "done") {
      record[step] = "said";
      said.push(step);
      changed = true;
    }
  }
  if (changed) write(storage, STEPS_KEY, JSON.stringify(record));

  let finish = false;
  if (STEP_IDS.every((s) => sights[s] === "done") && read(storage, FINISHED_KEY) !== "1") {
    const earned = STEP_IDS.some((s) => record[s] === "said");
    // Someone first seen all set up earned nothing: spent without a word.
    if (!earned) write(storage, FINISHED_KEY, "1");
    else if (!fault) {
      write(storage, FINISHED_KEY, "1");
      finish = true;
    }
  }
  return { said, finish };
}
