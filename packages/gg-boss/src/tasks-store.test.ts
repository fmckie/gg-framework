import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { tasksStore } from "./tasks-store.js";

// The tasks-store reads getAppPaths().agentDir at runtime, which uses
// os.homedir(). os.homedir() reads HOME on POSIX but USERPROFILE on Windows
// (with HOMEDRIVE+HOMEPATH as a fallback). Override every variable Node may
// consult so each test gets an isolated tmp directory regardless of platform —
// without this, Windows runners scribble on the real C:\Users\<admin>\.gg
// and tests race on the same shared file.
const HOME_VARS = ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"] as const;
let tmpHome: string;
const originalEnv: Partial<Record<(typeof HOME_VARS)[number], string | undefined>> = {};

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "kleio-manager-test-"));
  for (const k of HOME_VARS) originalEnv[k] = process.env[k];
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // os.homedir() on Windows falls back to HOMEDRIVE+HOMEPATH if USERPROFILE
  // is unset. Set HOMEDRIVE empty so HOMEPATH alone resolves to tmpHome.
  process.env.HOMEDRIVE = "";
  process.env.HOMEPATH = tmpHome;
  // Reset in-memory state AND ensure plan.json is wiped at the new location
  // so leftover state from a previous test (different tmpHome) can't leak.
  await tasksStore.reset();
});

afterEach(async () => {
  for (const k of HOME_VARS) {
    if (originalEnv[k] !== undefined) process.env[k] = originalEnv[k];
    else delete process.env[k];
  }
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("tasksStore — round-trip", () => {
  it("add → list returns the same task", async () => {
    const t = await tasksStore.add({
      project: "alpha",
      title: "do thing",
      description: "do the thing",
    });
    const list = tasksStore.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(t.id);
    expect(list[0]!.status).toBe("pending");
  });

  it("update changes only the supplied fields", async () => {
    const t = await tasksStore.add({
      project: "alpha",
      title: "do thing",
      description: "do the thing",
    });
    const updated = await tasksStore.update(t.id, { status: "done" });
    expect(updated?.status).toBe("done");
    expect(updated?.title).toBe("do thing"); // untouched
  });

  it("update with no status preserves status (regression: was wiping to undefined)", async () => {
    const t = await tasksStore.add({
      project: "alpha",
      title: "do thing",
      description: "do the thing",
    });
    // Simulate the boss calling update_task with only `notes` — the bug was
    // spreading {status: undefined, notes: ...} which clobbered status.
    // tasksStore.update receives only `notes` here so status must survive.
    const updated = await tasksStore.update(t.id, { notes: "hmm" });
    expect(updated?.status).toBe("pending");
    expect(updated?.notes).toBe("hmm");
  });

  it("remove drops the task", async () => {
    const t = await tasksStore.add({
      project: "alpha",
      title: "do thing",
      description: "x",
    });
    expect(await tasksStore.remove(t.id)).toBe(true);
    expect(tasksStore.list()).toHaveLength(0);
  });
});

describe("tasksStore — nextDispatchable", () => {
  it("prefers pending over blocked", async () => {
    const blocked = await tasksStore.add({ project: "a", title: "b", description: "x" });
    await tasksStore.update(blocked.id, { status: "blocked" });
    const pending = await tasksStore.add({ project: "a", title: "p", description: "x" });
    const next = tasksStore.nextDispatchable("a");
    expect(next?.id).toBe(pending.id);
  });

  it("falls through to blocked when nothing is pending", async () => {
    const blocked = await tasksStore.add({ project: "a", title: "b", description: "x" });
    await tasksStore.update(blocked.id, { status: "blocked" });
    const next = tasksStore.nextDispatchable("a");
    expect(next?.id).toBe(blocked.id);
  });

  it("ignores done/in_progress/skipped tasks", async () => {
    const t1 = await tasksStore.add({ project: "a", title: "t1", description: "x" });
    const t2 = await tasksStore.add({ project: "a", title: "t2", description: "x" });
    const t3 = await tasksStore.add({ project: "a", title: "t3", description: "x" });
    await tasksStore.update(t1.id, { status: "done" });
    await tasksStore.update(t2.id, { status: "in_progress" });
    await tasksStore.update(t3.id, { status: "skipped" });
    expect(tasksStore.nextDispatchable("a")).toBeUndefined();
  });

  it("scopes to the requested project", async () => {
    await tasksStore.add({ project: "a", title: "x", description: "x" });
    const b1 = await tasksStore.add({ project: "b", title: "y", description: "y" });
    expect(tasksStore.nextDispatchable("b")?.id).toBe(b1.id);
  });
});

describe("tasksStore — load() pruning + self-heal", () => {
  it("reset wipes in-memory + on-disk state", async () => {
    await tasksStore.add({ project: "a", title: "x", description: "x" });
    await tasksStore.reset();
    expect(tasksStore.list()).toHaveLength(0);
    await tasksStore.load();
    expect(tasksStore.list()).toHaveLength(0);
  });

  it("load drops done + skipped tasks", async () => {
    const a = await tasksStore.add({ project: "p", title: "a", description: "x" });
    const b = await tasksStore.add({ project: "p", title: "b", description: "x" });
    const c = await tasksStore.add({ project: "p", title: "c", description: "x" });
    await tasksStore.update(a.id, { status: "done" });
    await tasksStore.update(b.id, { status: "skipped" });
    await tasksStore.load();
    const list = tasksStore.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(c.id);
  });

  it("load resets stale in_progress to pending", async () => {
    const t = await tasksStore.add({ project: "p", title: "x", description: "x" });
    await tasksStore.update(t.id, { status: "in_progress" });
    await tasksStore.load();
    expect(tasksStore.byId(t.id)?.status).toBe("pending");
  });
});
