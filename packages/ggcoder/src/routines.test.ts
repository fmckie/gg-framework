import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  advanceNextRun,
  createRoutineRunner,
  createRoutineStore,
  MAX_ROUTINES,
  validateInput,
  type Routine,
  type RoutineStore,
  type RoutineTarget,
} from "./routines.js";

const MIN = 60_000;

let dir: string;
let file: string;
let clock: number;
const now = (): number => clock;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gg-routines-"));
  file = join(dir, ".gg", "routines.json");
  clock = 1_000_000;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function input(over: Partial<Parameters<typeof validateInput>[0] & object> = {}) {
  const v = validateInput({
    prompt: "check the logs",
    intervalMs: 15 * MIN,
    runCount: null,
    cwd: "/tmp/proj",
    mode: "code",
    ...over,
  });
  if (!v.ok) throw new Error(v.error.message);
  return v.value;
}

/** Fake session: records prompts; `busy` makes prompt() queue instead of send. */
class FakeTarget implements RoutineTarget {
  static created: FakeTarget[] = [];
  sent: string[] = [];
  queued: string[] = [];
  busy = false;
  disposed = false;
  constructor(public sessionId: string) {
    FakeTarget.created.push(this);
  }
  queuedPrompts() {
    return this.queued;
  }
  async prompt(text: string) {
    if (this.busy) {
      this.queued.push(text);
      return "queued" as const;
    }
    this.sent.push(text);
    return "sent" as const;
  }
  async dispose() {
    this.disposed = true;
  }
  /** The agent finished the run and consumed its queue. */
  drain() {
    this.sent.push(...this.queued);
    this.queued = [];
    this.busy = false;
  }
}

async function harness(opts: { createTarget?: (r: Routine) => Promise<RoutineTarget> } = {}) {
  FakeTarget.created = [];
  const store = createRoutineStore({ file, now });
  await store.load();
  const changes: Routine[][] = [];
  let n = 0;
  const runner = createRoutineRunner({
    store,
    now,
    createTarget: opts.createTarget ?? (async () => new FakeTarget(`s-${++n}`)),
    onChange: (r) => changes.push(r),
  });
  return { store, runner, changes };
}

async function add(store: RoutineStore, over: Parameters<typeof input>[0] = {}) {
  const r = await store.add(input(over));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("advanceNextRun", () => {
  it("leaves a future boundary alone and skips to the next future one when behind", () => {
    expect(advanceNextRun(1000, 100, 900)).toBe(1000);
    expect(advanceNextRun(1000, 100, 1000)).toBe(1100);
    expect(advanceNextRun(1000, 100, 1450)).toBe(1500); // four missed, one next
  });
});

describe("validateInput", () => {
  it("rejects what the /schedule parser cannot produce and normalises the rest", () => {
    expect(validateInput(null).ok).toBe(false);
    expect(validateInput({ ...input(), prompt: "  " }).ok).toBe(false);
    expect(validateInput({ ...input(), intervalMs: MIN - 1 }).ok).toBe(false);
    expect(validateInput({ ...input(), runCount: 0 }).ok).toBe(false);
    expect(validateInput({ ...input(), runCount: 1.5 }).ok).toBe(false);
    expect(validateInput({ ...input(), cwd: "" }).ok).toBe(false);
    const v = validateInput({ ...input(), intervalMs: MIN + 0.9, mode: "weird", prompt: " p " });
    expect(v.ok && v.value).toEqual({
      prompt: "p",
      intervalMs: MIN,
      runCount: null,
      cwd: "/tmp/proj",
      mode: "code",
    });
  });
});

describe("firing", () => {
  it("does not fire before the first interval elapses", async () => {
    const { store, runner } = await harness();
    await add(store);
    clock += 15 * MIN - 1;
    await runner.tick();
    expect(FakeTarget.created).toHaveLength(0);
  });

  it("fires at the interval, into a session created on first fire", async () => {
    const { store, runner, changes } = await harness();
    const r = await add(store);
    clock += 15 * MIN;
    await runner.tick();
    expect(FakeTarget.created).toHaveLength(1);
    expect(FakeTarget.created[0]!.sent).toEqual(["check the logs"]);
    expect(runner.sessionFor(r.id)).toBe("s-1");
    expect(changes.at(-1)![0]).toMatchObject({
      runsCompleted: 1,
      nextRunAt: r.nextRunAt + 15 * MIN,
      lastRun: { outcome: "sent" },
    });
  });

  it("keeps firing on cadence when the count is null, reusing the session", async () => {
    const { store, runner } = await harness();
    await add(store);
    for (let i = 0; i < 3; i += 1) {
      clock += 15 * MIN;
      await runner.tick();
    }
    expect(FakeTarget.created).toHaveLength(1);
    expect(FakeTarget.created[0]!.sent).toHaveLength(3);
  });

  it("stops at runCount and drops off the list; the session stays for the final run", async () => {
    const { store, runner } = await harness();
    const r = await add(store, { runCount: 2 });
    clock += 15 * MIN;
    await runner.tick();
    expect(store.list()[0]!.runsCompleted).toBe(1);
    clock += 15 * MIN;
    await runner.tick();
    expect(store.list()).toEqual([]);
    expect(FakeTarget.created[0]!.sent).toHaveLength(2);
    expect(FakeTarget.created[0]!.disposed).toBe(false);
    expect(runner.sessionFor(r.id)).toBe("s-1");
    clock += 15 * MIN;
    await runner.tick();
    expect(FakeTarget.created[0]!.sent).toHaveLength(2);
  });

  it("keeps reporting a finished routine's session until released — a host mirrors it from here", async () => {
    const { store, runner } = await harness();
    const r = await add(store, { runCount: 1 });
    clock += 15 * MIN;
    await runner.tick();
    expect(store.list()).toEqual([]);
    expect(runner.sessions()).toEqual({ [r.id]: "s-1" });
    await runner.release(r.id);
    expect(runner.sessions()).toEqual({});
  });

  it("fires exactly once for a count of 1", async () => {
    const { store, runner } = await harness();
    await add(store, { runCount: 1 });
    clock += 15 * MIN;
    await runner.tick();
    clock += 15 * MIN;
    await runner.tick();
    expect(FakeTarget.created[0]!.sent).toEqual(["check the logs"]);
    expect(store.list()).toEqual([]);
  });

  it("skips missed occurrences instead of replaying them", async () => {
    const { store, runner } = await harness();
    const r = await add(store);
    clock += 4 * 15 * MIN + 5_000; // slept through four
    await runner.tick();
    expect(FakeTarget.created[0]!.sent).toHaveLength(1);
    expect(store.list()[0]!.nextRunAt).toBe(r.nextRunAt + 4 * 15 * MIN);
  });
});

describe("queueing rather than dropping", () => {
  it("still fires while the agent is working, so the session queues it", async () => {
    const { store, runner } = await harness();
    await add(store);
    clock += 15 * MIN;
    await runner.tick();
    const t = FakeTarget.created[0]!;
    t.busy = true;
    clock += 15 * MIN;
    await runner.tick();
    expect(t.queued).toEqual(["check the logs"]);
    expect(store.list()[0]!.lastRun?.outcome).toBe("queued");
    expect(store.list()[0]!.runsCompleted).toBe(2);
  });

  it("does not queue a duplicate while its own copy is still pending", async () => {
    const { store, runner } = await harness();
    await add(store);
    clock += 15 * MIN;
    await runner.tick();
    const t = FakeTarget.created[0]!;
    t.busy = true;
    clock += 15 * MIN;
    await runner.tick(); // queued
    clock += 15 * MIN;
    await runner.tick(); // skipped: copy still queued
    clock += 15 * MIN;
    await runner.tick(); // skipped again
    expect(t.queued).toEqual(["check the logs"]);
    const r = store.list()[0]!;
    expect(r.runsCompleted).toBe(2);
    expect(r.lastRun?.outcome).toBe("skipped");
  });

  it("fires again once the agent consumes the queued copy", async () => {
    const { store, runner } = await harness();
    await add(store);
    clock += 15 * MIN;
    await runner.tick();
    const t = FakeTarget.created[0]!;
    t.busy = true;
    clock += 15 * MIN;
    await runner.tick();
    t.drain();
    clock += 15 * MIN;
    await runner.tick();
    expect(t.sent).toHaveLength(3);
  });

  it("lets two different routines queue independently on their own sessions", async () => {
    const { store, runner } = await harness();
    await add(store, { prompt: "a" });
    await add(store, { prompt: "b" });
    clock += 15 * MIN;
    await runner.tick();
    await runner.tick();
    expect(FakeTarget.created).toHaveLength(2);
    expect(FakeTarget.created.map((t) => t.sent)).toEqual([["a"], ["b"]]);
  });
});

describe("stopping", () => {
  it("removes a routine so it never fires again, and release() disposes its session", async () => {
    const { store, runner } = await harness();
    const r = await add(store);
    clock += 15 * MIN;
    await runner.tick();
    await store.remove(r.id);
    await runner.release(r.id);
    expect(FakeTarget.created[0]!.disposed).toBe(true);
    clock += 15 * MIN;
    await runner.tick();
    expect(FakeTarget.created[0]!.sent).toHaveLength(1);
    expect(store.list()).toEqual([]);
  });

  it("leaves other routines running", async () => {
    const { store, runner } = await harness();
    const a = await add(store, { prompt: "a" });
    await add(store, { prompt: "b" });
    await store.remove(a.id);
    clock += 15 * MIN;
    await runner.tick();
    expect(FakeTarget.created.map((t) => t.sent)).toEqual([["b"]]);
  });

  it("stop() disposes every session", async () => {
    const { store, runner } = await harness();
    await add(store, { prompt: "a" });
    await add(store, { prompt: "b" });
    clock += 15 * MIN;
    await runner.tick();
    await runner.tick();
    await runner.stop();
    expect(FakeTarget.created.every((t) => t.disposed)).toBe(true);
  });
});

describe("concurrency", () => {
  it("sends at most one prompt per tick", async () => {
    const { store, runner } = await harness();
    await add(store, { prompt: "a" });
    await add(store, { prompt: "b" });
    clock += 15 * MIN;
    await runner.tick();
    expect(FakeTarget.created).toHaveLength(1);
  });

  it("gives the held routine the very next tick, not a whole interval later", async () => {
    const { store, runner } = await harness();
    await add(store, { prompt: "a" });
    await add(store, { prompt: "b" });
    clock += 15 * MIN;
    await runner.tick();
    clock += 1_000;
    await runner.tick();
    expect(FakeTarget.created.map((t) => t.sent)).toEqual([["a"], ["b"]]);
  });

  it("does not starve a routine that always comes due beside another", async () => {
    const { store, runner } = await harness();
    await add(store, { prompt: "a" });
    await add(store, { prompt: "b" });
    for (let i = 0; i < 3; i += 1) {
      clock += 15 * MIN;
      await runner.tick();
      clock += 1_000;
      await runner.tick();
    }
    expect(FakeTarget.created.map((t) => t.sent.length)).toEqual([3, 3]);
  });

  it("never overlaps ticks while a session is still being created", async () => {
    let resolveCreate!: (t: RoutineTarget) => void;
    const { store, runner } = await harness({
      createTarget: () => new Promise<RoutineTarget>((r) => (resolveCreate = r)),
    });
    await add(store);
    clock += 15 * MIN;
    const first = runner.tick();
    const second = runner.tick();
    expect(second).toBe(first);
    const t = new FakeTarget("slow");
    resolveCreate(t);
    await first;
    expect(t.sent).toEqual(["check the logs"]);
  });
});

describe("failures", () => {
  it("records a session-creation error, aims at the next boundary, keeps the routine", async () => {
    const { store, runner } = await harness({
      createTarget: async () => {
        throw new Error("no such cwd");
      },
    });
    const r = await add(store);
    clock += 15 * MIN;
    await runner.tick();
    const after = store.list()[0]!;
    expect(after.lastRun).toMatchObject({ outcome: "error", error: "Error: no such cwd" });
    expect(after.nextRunAt).toBe(r.nextRunAt + 15 * MIN);
    expect(after.runsCompleted).toBe(0);
  });

  it("a prompt error does not count as a run", async () => {
    const { store, runner } = await harness({
      createTarget: async () => {
        const t = new FakeTarget("s");
        t.prompt = async () => {
          throw new Error("409");
        };
        return t;
      },
    });
    await add(store, { runCount: 1 });
    clock += 15 * MIN;
    await runner.tick();
    expect(store.list()[0]!.runsCompleted).toBe(0);
    expect(store.list()[0]!.lastRun?.outcome).toBe("error");
  });
});

describe("persistence", () => {
  it("round-trips through the file, atomically, and a restart honours nextRunAt", async () => {
    const { store } = await harness();
    const r = await add(store);
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    expect(onDisk).toEqual({ version: 1, routines: [r] });
    expect((await readdir(join(dir, ".gg"))).filter((f) => f.includes(".tmp-"))).toEqual([]);

    // Daemon restarts 40 min later: the persisted boundary is behind; the
    // routine fires once (not twice) and re-aims at the next FUTURE one.
    clock += 40 * MIN;
    const { store: store2, runner: runner2 } = await harness();
    expect(store2.list()).toEqual([r]);
    await runner2.tick();
    expect(FakeTarget.created[0]!.sent).toHaveLength(1);
    expect(store2.list()[0]!.nextRunAt).toBe(r.nextRunAt + 2 * 15 * MIN);
  });

  it("starts empty on a missing, corrupt or wrong-shaped file, dropping bad records", async () => {
    const { store } = await harness();
    expect(store.list()).toEqual([]);
    await mkdir(join(dir, ".gg"), { recursive: true });
    await writeFile(file, "not json");
    await store.load();
    expect(store.list()).toEqual([]);
    await writeFile(file, JSON.stringify({ version: 1, routines: "nope" }));
    await store.load();
    expect(store.list()).toEqual([]);
    const good = (await add(store)) as Routine;
    await writeFile(file, JSON.stringify({ version: 1, routines: [good, { id: "x" }] }));
    await store.load();
    expect(store.list()).toEqual([good]);
  });

  it("caps at MAX_ROUTINES", async () => {
    const { store } = await harness();
    for (let i = 0; i < MAX_ROUTINES; i += 1) await add(store, { prompt: `p${i}` });
    const r = await store.add(input({ prompt: "one more" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe("limit");
  });

  it("remove() of an unknown id is not_found", async () => {
    const { store } = await harness();
    const r = await store.remove("rtn-nope");
    expect(!r.ok && r.error.kind).toBe("not_found");
  });
});
