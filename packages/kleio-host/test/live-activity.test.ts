import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApnsPusher, LiveActivityPush, LiveActivityTarget } from "../src/apns.js";
import {
  createLiveActivityTracker,
  reduceFrame,
  type LiveContentState,
  type SidecarFrame,
} from "../src/live-activity.js";

const T0 = 1_790_000_000_000; // ms

function run(frames: SidecarFrame[], at = T0): (ReturnType<typeof reduceFrame> | null)[] {
  let s: LiveContentState | undefined;
  return frames.map((f, i) => {
    const r = reduceFrame(s, f, at + i * 1_000);
    if (r) s = r.event === "end" ? undefined : r.state;
    return r;
  });
}

describe("reduceFrame", () => {
  it("walks a normal run the way the phone labels it", () => {
    const out = run([
      { type: "run_start", data: { text: "go" } },
      { type: "tool_call_start", data: { toolCallId: "c1", name: "bash" } },
      { type: "tool_call_end", data: { toolCallId: "c1", isError: false } },
      { type: "turn_end", data: { turn: 1, usage: { inputTokens: 100, outputTokens: 20 } } },
      { type: "tool_call_start", data: { toolCallId: "c2", name: "read" } },
      { type: "tool_call_end", data: { toolCallId: "c2", isError: true } },
      { type: "turn_end", data: { turn: 2, usage: { inputTokens: 50, outputTokens: 5 } } },
      {
        type: "agent_done",
        data: { totalTurns: 2, totalUsage: { inputTokens: 150, outputTokens: 25 } },
      },
    ]);
    const steps = out.map((r) => r && `${r.event}:${r.state.step}:${r.state.statusText}`);
    expect(steps).toEqual([
      "update:Starting:Working…",
      "update:Tool:Running bash",
      "update:Thinking:Thinking…",
      "update:Step 1:Thinking…",
      "update:Tool:Running read",
      "update:Tool failed:Tool read failed",
      "update:Step 2:Thinking…",
      "end:Done:Done",
    ]);
    const end = out.at(-1)!.state;
    expect(end).toMatchObject({ done: true, isWorking: false, turn: 2, totalTokens: 175 });
    expect(end.toolName).toBeNull();
    // Tokens accumulate across turns before the final total.
    expect(out[6]!.state.totalTokens).toBe(175);
    // The clock runs from run_start.
    expect(out[3]!.state.elapsedSeconds).toBe(3);
    expect(end.startedAt).toBe(Math.floor(T0 / 1000));
  });

  it("ends a cancelled run as Stopped, an error as Error, a short run_end as Done", () => {
    expect(
      run([{ type: "run_start" }, { type: "run_end", data: { cancelled: true } }])[1],
    ).toMatchObject({
      event: "end",
      state: { step: "Stopped", done: true },
    });
    expect(
      run([{ type: "run_start" }, { type: "error", data: { message: "x" } }])[1],
    ).toMatchObject({
      event: "end",
      state: { step: "Error", statusText: "Run failed" },
    });
    expect(
      run([{ type: "run_start" }, { type: "run_end", data: { runState: "idle" } }])[1],
    ).toMatchObject({
      event: "end",
      state: { step: "Done" },
    });
  });

  it("ignores everything after the end, and frames that do not change the lock screen", () => {
    const done = reduceFrame(undefined, { type: "agent_done" }, T0)!.state;
    expect(reduceFrame(done, { type: "run_end", data: { runState: "idle" } }, T0)).toBeNull();
    expect(reduceFrame(done, { type: "tool_call_start", data: { name: "bash" } }, T0)).toBeNull();
    expect(reduceFrame(undefined, { type: "text_delta", data: { text: "hi" } }, T0)).toBeNull();
    // …but a new run starts clean.
    expect(reduceFrame(done, { type: "run_start" }, T0)!.state.done).toBe(false);
  });

  it("picks up mid-run when the registration lands after run_start", () => {
    const r = reduceFrame(undefined, { type: "tool_call_start", data: { name: "edit" } }, T0);
    expect(r).toMatchObject({ event: "update", state: { statusText: "Running edit", turn: 1 } });
  });

  it("does not trust frame fields: long names are cut, junk numbers ignored", () => {
    const r = reduceFrame(
      undefined,
      { type: "tool_call_start", data: { name: "x".repeat(500) } },
      T0,
    )!;
    expect(r.state.toolName!.length).toBe(80);
    const t = reduceFrame(undefined, { type: "turn_end", data: { turn: "7", usage: "lots" } }, T0)!;
    expect(t.state).toMatchObject({ turn: 1, totalTokens: 0 });
  });
});

describe("createLiveActivityTracker", () => {
  let clock: number;
  let sent: { target: LiveActivityTarget; push: LiveActivityPush }[];
  let answer: "ok" | "gone" | "failed";
  const apns: ApnsPusher = {
    configured: true,
    notify: async () => 0,
    liveActivity: async (target, push) => {
      sent.push({ target, push });
      return answer;
    },
  };
  const reg = {
    token: "ab".repeat(32),
    env: "sandbox" as const,
    deviceId: "phone",
    registeredAt: "t",
  };
  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    clock = T0;
    sent = [];
    answer = "ok";
  });
  afterEach(() => vi.useRealTimers());

  function tracker() {
    return createLiveActivityTracker({ apns, now: () => clock, minIntervalMs: 2_000 });
  }

  it("pushes only while nobody is attached, and only for a registered session", () => {
    const t = tracker();
    t.onFrame("s1", { type: "run_start" }, false);
    expect(sent).toHaveLength(0); // not registered yet
    t.register("s1", reg);
    t.onFrame("s1", { type: "tool_call_start", data: { name: "bash" } }, true);
    expect(sent).toHaveLength(0); // the open app draws it itself
    t.onFrame("s1", { type: "tool_call_end", data: {} }, false);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.push).toMatchObject({ event: "update", priority: 5 });
    expect(sent[0]!.push.contentState).toMatchObject({ statusText: "Thinking…" });
    expect(sent[0]!.target.token).toBe(reg.token);
  });

  it("paces progress: a burst becomes one push now and one trailing push with the latest state", () => {
    const t = tracker();
    t.register("s1", reg);
    t.onFrame("s1", { type: "run_start" }, false);
    for (const name of ["a", "b", "c"])
      t.onFrame("s1", { type: "tool_call_start", data: { name } }, false);
    expect(sent.map((s) => s.push.contentState.statusText)).toEqual(["Working…"]);
    clock += 2_000;
    vi.advanceTimersByTime(2_000);
    expect(sent.map((s) => s.push.contentState.statusText)).toEqual(["Working…", "Running c"]);
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(2);
  });

  it("sends the end at once, cancels a pending trailing update, and forgets the spent token", () => {
    const t = tracker();
    t.register("s1", reg);
    t.onFrame("s1", { type: "run_start" }, false);
    t.onFrame("s1", { type: "tool_call_start", data: { name: "bash" } }, false); // pending
    t.onFrame("s1", { type: "agent_done", data: { totalTurns: 1 } }, false);
    expect(sent.map((s) => s.push.event)).toEqual(["update", "end"]);
    const end = sent[1]!.push;
    expect(end.priority).toBe(10);
    expect(end.dismissalDate).toBe(Math.floor(clock / 1000) + 8);
    expect(end.contentState).toMatchObject({ done: true, step: "Done" });
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(2); // the trailing update never fires after the end
    expect(t.registration("s1")).toBeUndefined();
  });

  it("forgets the token when an attached app ended the activity itself", () => {
    const t = tracker();
    t.register("s1", reg);
    t.onFrame("s1", { type: "run_start" }, true);
    t.onFrame("s1", { type: "agent_done" }, true);
    expect(sent).toHaveLength(0);
    expect(t.registration("s1")).toBeUndefined();
  });

  it("drops a registration Apple calls gone (410)", async () => {
    const t = tracker();
    t.register("s1", reg);
    answer = "gone";
    t.onFrame("s1", { type: "run_start" }, false);
    await flush();
    expect(t.registration("s1")).toBeUndefined();
  });

  it("only the registering device may unregister; a revoked device loses its sessions", () => {
    const t = tracker();
    t.register("s1", reg);
    t.register("s2", { ...reg, deviceId: "other" });
    expect(t.unregister("s1", "other")).toBe(false);
    expect(t.registration("s1")).toBeDefined();
    t.dropDevice("phone");
    expect(t.registration("s1")).toBeUndefined();
    expect(t.registration("s2")).toBeDefined();
  });

  it("does nothing when APNs is not configured", () => {
    const t = createLiveActivityTracker({ apns: { ...apns, configured: false }, now: () => clock });
    t.register("s1", reg);
    t.onFrame("s1", { type: "run_start" }, false);
    expect(sent).toHaveLength(0);
  });
});
