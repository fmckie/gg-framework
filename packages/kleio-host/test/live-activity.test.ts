import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApnsPusher, LiveActivityPush, LiveActivityTarget } from "../src/apns.js";
import {
  createLiveActivityTracker,
  reduceFrame,
  type LiveState,
  type SidecarFrame,
  type StartToken,
} from "../src/live-activity.js";
import { clipText, stepDone, stepText, toolStep } from "../src/live-text.js";

const T0 = 1_790_000_000_000; // ms
const S0 = T0 / 1000;

function run(frames: SidecarFrame[], at = T0): ReturnType<typeof reduceFrame>[] {
  let s: LiveState | undefined;
  return frames.map((f, i) => {
    const r = reduceFrame(s, f, at + i * 1_000);
    if (r) s = r.kind === "end" ? undefined : r.state;
    return r;
  });
}

describe("stepText", () => {
  it("names the kind of work in plain words, with a short file name at most", () => {
    expect(stepText("bash", { command: "rm -rf /" })).toBe("Running a command");
    expect(stepText("read", { path: "/a/b/host.ts" })).toBe("Reading host.ts");
    expect(stepText("read", { path: "C:\\x\\notes.md" })).toBe("Reading notes.md");
    expect(stepText("read", { path: `/a/${"x".repeat(29)}` })).toBe("Reading a file");
    expect(stepText("write", {})).toBe("Writing a file");
    expect(stepText("edit", { file_path: "src/a.ts" })).toBe("Editing a.ts");
    for (const n of ["ls", "grep", "find"]) expect(stepText(n, {})).toBe("Searching files");
    expect(stepText("web_fetch", { url: "https://x" })).toBe("Reading a web page");
    expect(stepText("web_search", {})).toBe("Searching the web");
    expect(stepText("subagent", {})).toBe("Handing off a task");
    expect(stepText("mcp__thing", {})).toBe("Working");
  });

  it("clips by code points with an ellipsis", () => {
    expect(clipText("😀".repeat(70), 60)).toBe(`${"😀".repeat(59)}…`);
    expect(clipText("short", 60)).toBe("short");
  });
});

describe("toolStep and stepDone", () => {
  it("names each step's kind, and says it in the past once done", () => {
    expect(toolStep("read", { path: "/a/host.ts" })).toEqual({
      kind: "read",
      line: "Reading host.ts",
      done: "Read host.ts",
    });
    expect(toolStep("bash", { command: "rm -rf /" })).toEqual({
      kind: "command",
      line: "Running a command",
      done: "Ran a command",
    });
    expect(toolStep("edit", {}).done).toBe("Edited a file");
    // Every file search is one kind; two different unknown tools are two.
    expect(toolStep("grep", {}).kind).toBe(toolStep("find", {}).kind);
    expect(toolStep("mcp__a", {}).kind).not.toBe(toolStep("mcp__b", {}).kind);
  });

  it("counts a step of several calls; searches read the same however many", () => {
    expect(stepDone("read", 1, "Read host.ts")).toBe("Read host.ts");
    expect(stepDone("read", 3, "Read b.ts")).toBe("Read 3 files");
    expect(stepDone("command", 2, "Ran a command")).toBe("Ran 2 commands");
    expect(stepDone("search", 4, "Searched files")).toBe("Searched files");
    expect(stepDone("tool:mcp__a", 2, "Used a tool")).toBe("Used a tool 2 times");
  });
});

describe("reduceFrame", () => {
  it("counts steps: calls of one kind in a row are one, with the last finished one in the past tense", () => {
    const out = run([
      { type: "run_start" },
      { type: "tool_call_start", data: { name: "read", args: { path: "src/a.ts" } } },
      { type: "tool_call_end", data: {} },
      { type: "tool_call_start", data: { name: "read", args: { path: "src/b.ts" } } },
      { type: "tool_call_end", data: {} },
      { type: "tool_call_start", data: { name: "edit", args: { path: "src/b.ts" } } },
      {
        type: "ask_user",
        data: { id: "ask-1", questions: [{ id: "q", kind: "confirm", question: "Ship it?" }] },
      },
      { type: "ask_user_done", data: {} },
      { type: "tool_call_start", data: { name: "bash", args: { command: "pnpm test" } } },
      { type: "run_end", data: { failed: true } },
    ]);
    expect(out.map((r) => r && [r.state.step ?? 0, r.state.prevLine ?? "", r.state.line])).toEqual([
      [0, "", "Thinking…"],
      [1, "", "Reading a.ts"],
      [1, "Read a.ts", "Thinking…"],
      [1, "Read a.ts", "Reading b.ts"],
      [1, "Read 2 files", "Thinking…"],
      [2, "Read 2 files", "Editing b.ts"],
      // A question and its answer keep the trail.
      [2, "Read 2 files", "Needs your help"],
      [2, "Read 2 files", "Back to work"],
      [3, "Edited b.ts", "Running a command"],
      [3, "", "Something went wrong"],
    ]);
    // The end keeps how far it got, and none of the host's bookkeeping.
    expect(out[9]?.state).toMatchObject({ phase: "failed", step: 3 });
    expect(out[9]?.state).not.toHaveProperty("trail");
    // A new run counts from the start again.
    expect(reduceFrame(out[8]?.state, { type: "run_start" }, T0)?.state.step).toBeUndefined();
  });

  it("walks a run: thinking, steps, done only when the run ends", () => {
    const out = run([
      { type: "run_start", data: { text: "go" } },
      { type: "tool_call_start", data: { name: "bash" } },
      { type: "tool_call_end", data: {} },
      { type: "turn_end", data: {} },
      // The agent's loop is done, but the run goes on (checks, a review).
      { type: "agent_done", data: {} },
      { type: "tool_call_start", data: { name: "read", args: { path: "src/a.ts" } } },
      { type: "run_end", data: { failed: false } },
    ]);
    expect(out.map((r) => r && `${r.kind}:${r.state.phase}:${r.state.line}`)).toEqual([
      "phase:working:Thinking…",
      "routine:working:Running a command",
      "routine:working:Thinking…",
      null,
      null,
      "routine:working:Reading a.ts",
      "end:done:Done",
    ]);
    expect(out[6]!.state).toMatchObject({ startedAt: S0, endedAt: S0 + 6 });
  });

  it("asks for help with the first question, then goes back to work", () => {
    const out = run([
      { type: "run_start" },
      {
        type: "ask_user",
        data: { id: "q", questions: [{ question: "Which one?" }, { question: "And?" }] },
      },
      { type: "ask_user_done", data: { id: "q" } },
      { type: "ask_user_done", data: { id: "q" } },
    ]);
    expect(out[1]).toEqual({
      kind: "phase",
      state: {
        phase: "needsYou",
        line: "Needs your help",
        detail: "Which one? (+1 more)",
        startedAt: S0,
      },
    });
    expect(out[2]).toMatchObject({
      kind: "phase",
      state: { phase: "working", line: "Back to work" },
    });
    expect(out[3]).toBeNull(); // not waiting any more
    const long = reduceFrame(
      undefined,
      { type: "ask_user", data: { questions: [{ question: "q".repeat(300) }] } },
      T0,
    );
    expect([...(long?.state.detail ?? "")].length).toBe(140);
  });

  it("stays on 'Needs your help' while it waits: the question's own tool call doesn't move it", () => {
    // As on the Mac mini (5 Oct): the ask_user frame, then the tool call that
    // carries it. The activity flipped to "Working" 0.8 s after asking.
    const out = run([
      { type: "run_start" },
      { type: "ask_user", data: { id: "ask-1", questions: [{ id: "f", question: "Which?" }] } },
      { type: "tool_call_start", data: { name: "ask_user", args: {} } },
      { type: "tool_call_start", data: { name: "bash", args: {} } },
      { type: "ask_user_done", data: { id: "ask-1" } },
      { type: "tool_call_end", data: {} },
      { type: "tool_call_start", data: { name: "write", args: { path: "a.txt" } } },
    ]);
    expect(out.map((r) => r && r.state.line)).toEqual([
      "Thinking…",
      "Needs your help",
      null,
      null,
      "Back to work",
      "Thinking…", // the ask_user call ends once answered: thinking again
      "Writing a.txt",
    ]);
  });

  it("a web search the model runs shows as a step", () => {
    const out = run([
      { type: "run_start" },
      { type: "server_tool_call", data: { id: "srv1", name: "web_search", input: { query: "x" } } },
    ]);
    expect(out[1]).toMatchObject({ state: { line: "Searching the web" } });
  });

  it("a question with a few options carries them, and the one the agent recommends", () => {
    const ask = (questions: unknown[]): ReturnType<typeof reduceFrame> =>
      reduceFrame(undefined, { type: "ask_user", data: { id: "ask-2", questions } }, T0);
    expect(
      ask([
        {
          id: "f",
          question: "Which file?",
          kind: "choice",
          options: [{ label: "alpha.txt" }, { label: "beta.txt", recommended: true }],
        },
      ])?.state,
    ).toMatchObject({ askId: "ask-2", options: ["alpha.txt", "beta.txt"], recommended: 1 });
    // Yes/no needs no options listed.
    expect(ask([{ id: "c", question: "Go?", kind: "confirm" }])?.state.options).toEqual([
      "Yes",
      "No",
    ]);
    // Free text, several picks, too many options or several questions: answer in the app.
    const inApp = [
      [{ id: "t", question: "Why?", kind: "text" }],
      [{ id: "m", question: "Which?", kind: "multi", options: [{ label: "a" }] }],
      [
        {
          id: "f",
          question: "Pick",
          kind: "choice",
          options: [1, 2, 3, 4, 5].map((n) => ({ label: `o${n}` })),
        },
      ],
      [
        { id: "a", question: "One?", kind: "confirm" },
        { id: "b", question: "Two?", kind: "confirm" },
      ],
    ];
    for (const qs of inApp) expect(ask(qs)?.state.options).toBeUndefined();
  });

  it("ends a cancelled run as stopped, a failed one as failed, a bare run_end as done", () => {
    expect(
      run([{ type: "run_start" }, { type: "run_end", data: { cancelled: true } }])[1],
    ).toMatchObject({
      kind: "end",
      state: { phase: "stopped", line: "Stopped" },
    });
    // An error alone doesn't end it: the run can recover; run_end says how it ended.
    const failed = run([
      { type: "run_start" },
      { type: "error", data: { message: "x" } },
      { type: "run_end", data: { failed: true } },
    ]);
    expect(failed[1]).toBeNull();
    expect(failed[2]).toMatchObject({
      kind: "end",
      state: { phase: "failed", line: "Something went wrong" },
    });
    expect(run([{ type: "run_start" }, { type: "run_end", data: {} }])[1]).toMatchObject({
      kind: "end",
      state: { phase: "done" },
    });
  });
});

describe("createLiveActivityTracker", () => {
  let clock: number;
  let sent: { target: LiveActivityTarget; push: LiveActivityPush }[];
  let answer: "ok" | "gone" | "failed";
  let starts: StartToken[];
  const apns: ApnsPusher = {
    configured: true,
    env: "sandbox",
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
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    clock = T0;
    sent = [];
    answer = "ok";
    starts = [];
  });
  afterEach(() => vi.useRealTimers());

  function tracker(): ReturnType<typeof createLiveActivityTracker> {
    return createLiveActivityTracker({ apns, now: () => clock, startTokens: () => starts });
  }
  const lines = (): string[] =>
    sent.map((s) => `${s.push.event}:${String(s.push.contentState.line)}:${s.push.priority}`);

  it("the lock screen's buttons: a one-off key per question, used once, only for that question", async () => {
    const t = tracker();
    t.register("s:s1", reg);
    t.onFrame("s1", { type: "run_start" });
    t.onFrame("s1", {
      type: "ask_user",
      data: {
        id: "ask-1",
        questions: [
          {
            id: "f",
            question: "Which file?",
            kind: "choice",
            options: [{ label: "alpha.txt" }, { label: "beta", value: "beta.txt" }],
          },
        ],
      },
    });
    await flush();
    const state = sent.at(-1)!.push.contentState;
    expect(state).toMatchObject({
      phase: "needsYou",
      askId: "ask-1",
      options: ["alpha.txt", "beta"],
    });
    const key = String(state.askKey);
    expect(key).toMatch(/^[0-9a-f]{32}$/);

    // A wrong key, another question, a choice out of range: nothing.
    expect(t.claimAnswer("s:s1", "ask-1", "0".repeat(32), 1)).toBeNull();
    expect(t.claimAnswer("s:s1", "ask-9", key, 1)).toBeNull();
    expect(t.claimAnswer("s:s2", "ask-1", key, 1)).toBeNull();
    expect(t.claimAnswer("s:s1", "ask-1", key, 2)).toBeNull();
    // The right one answers with the option's value, once.
    expect(t.claimAnswer("s:s1", "ask-1", key, 1)).toEqual({ questionId: "f", value: "beta.txt" });
    expect(t.claimAnswer("s:s1", "ask-1", key, 1)).toBeNull();
  });

  it("a token reported twice registers once", async () => {
    const t = tracker();
    t.onFrame("s1", { type: "run_start" });
    t.register("s:s1", reg);
    t.register("s:s1", { ...reg, registeredAt: "later" });
    await flush();
    expect(lines()).toEqual(["update:Thinking…:10"]);
  });

  it("pushes only to a registered target, and catches a late registration up at once", async () => {
    const t = tracker();
    t.onFrame("s1", { type: "run_start" });
    await flush();
    expect(sent).toHaveLength(0);
    t.register("s:s1", reg);
    await flush();
    expect(lines()).toEqual(["update:Thinking…:10"]);
    expect(sent[0]!.target).toEqual({ token: reg.token, env: "sandbox" });
    expect(sent[0]!.push.contentState).toEqual({
      phase: "working",
      line: "Thinking…",
      startedAt: S0,
    });
    expect(sent[0]!.push.staleDate).toBe(S0 + 1800);
  });

  it("sends the step trail, never the host's bookkeeping behind it", async () => {
    const t = tracker();
    t.register("s:s1", reg);
    t.onFrame("s1", { type: "run_start" });
    await flush();
    clock += 5_000;
    t.onFrame("s1", { type: "tool_call_start", data: { name: "read", args: { path: "x/a.ts" } } });
    await flush();
    expect(sent.at(-1)!.push.contentState).toEqual({
      phase: "working",
      line: "Reading a.ts",
      startedAt: S0,
      step: 1,
    });
    expect(t.state("s:s1")?.trail).toEqual({ kind: "read", calls: 1, last: "Read a.ts" });
    t.onFrame("s1", { type: "run_end", data: {} });
    await flush();
    expect(sent.at(-1)!.push).toMatchObject({
      event: "end",
      contentState: { phase: "done", step: 1 },
    });
    expect(sent.at(-1)!.push.contentState).not.toHaveProperty("trail");
  });

  it("paces routine steps to one per 5 s, latest wins; phase changes go at once at priority 10", async () => {
    const t = tracker();
    t.register("s:s1", reg);
    t.onFrame("s1", { type: "run_start" });
    for (const name of ["bash", "read", "web_search"])
      t.onFrame("s1", { type: "tool_call_start", data: { name } });
    await flush();
    expect(lines()).toEqual(["update:Thinking…:10"]);
    clock += 5_000;
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(lines()).toEqual(["update:Thinking…:10", "update:Searching the web:5"]);
    t.onFrame("s1", { type: "ask_user", data: { questions: [{ question: "Q?" }] } });
    await flush();
    expect(sent.at(-1)!.push).toMatchObject({
      priority: 10,
      contentState: { phase: "needsYou", detail: "Q?" },
    });
    expect(sent.at(-1)!.push.alert).toBeUndefined();
    t.onFrame("s1", { type: "ask_user_done", data: {} });
    await flush();
    expect(lines().at(-1)).toBe("update:Back to work:10");
  });

  it("ends at once with dismissal dates, cancels a pending trailing update, forgets the token", async () => {
    const t = tracker();
    t.register("s:s1", reg);
    t.onFrame("s1", { type: "run_start" });
    t.onFrame("s1", { type: "tool_call_start", data: { name: "bash" } }); // pending
    t.onFrame("s1", { type: "run_end", data: {} });
    await flush();
    await flush();
    expect(sent.map((s) => s.push.event)).toEqual(["update", "end"]);
    const end = sent[1]!.push;
    expect(end).toMatchObject({ priority: 10, dismissalDate: S0 + 1800 });
    // With how far it got: one step.
    expect(end.contentState).toEqual({
      phase: "done",
      line: "Done",
      startedAt: S0,
      endedAt: S0,
      step: 1,
    });
    expect(end.staleDate).toBeUndefined();
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(sent).toHaveLength(2);
    expect(t.registration("s:s1")).toBeUndefined();
    expect(t.state("s:s1")).toBeUndefined();

    t.register("s:s2", reg);
    t.onFrame("s2", { type: "run_start" });
    t.onFrame("s2", { type: "run_end", data: { cancelled: true } });
    await t.flush();
    expect(sent.at(-1)!.push).toMatchObject({ event: "end", dismissalDate: S0 + 600 });
  });

  it("drops a registration Apple calls gone (410)", async () => {
    const t = tracker();
    t.register("s:s1", reg);
    answer = "gone";
    t.onFrame("s1", { type: "run_start" });
    await t.flush();
    expect(t.registration("s:s1")).toBeUndefined();
  });

  it("only the registering device may unregister; a revoked device loses its targets", () => {
    const t = tracker();
    t.register("s:s1", reg);
    t.register("g:g_00000000", { ...reg, deviceId: "other" });
    expect(t.unregister("s:s1", "other")).toBe(false);
    t.dropDevice("phone");
    expect(t.registration("s:s1")).toBeUndefined();
    expect(t.registration("g:g_00000000")).toBeDefined();
  });

  it("never lets an update land after the end: pushes to one activity go out one at a time", async () => {
    const calls: { event: string; release: () => void }[] = [];
    const slow: ApnsPusher = {
      configured: true,
      notify: async () => 0,
      liveActivity: (_t, push) =>
        new Promise((resolve) => calls.push({ event: push.event, release: () => resolve("ok") })),
    };
    const t = createLiveActivityTracker({ apns: slow, now: () => clock });
    t.register("s:s1", reg);
    t.onFrame("s1", { type: "run_start" });
    t.onFrame("s1", { type: "run_end", data: {} });
    await flush();
    expect(calls.map((c) => c.event)).toEqual(["update"]);
    calls[0]!.release();
    await flush();
    await flush();
    expect(calls.map((c) => c.event)).toEqual(["update", "end"]);
    calls[1]!.release();
  });

  it("alert: through the registration first (current state + alert, priority 10)", async () => {
    const t = tracker();
    t.onFrame("s1", { type: "run_start" });
    t.onFrame("s1", { type: "ask_user", data: { questions: [{ question: "Q?" }] } });
    t.register("s:s1", reg);
    await t.flush();
    sent = [];
    const ok = await t.alert("s:s1", { title: "Needs your help", body: "Q?" }, () => null);
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.push).toMatchObject({
      event: "update",
      priority: 10,
      alert: { title: "Needs your help", body: "Q?", sound: "default" },
      contentState: { phase: "needsYou" },
    });
  });

  it("alert: else push-to-start, one per token, only the host's env; false with no token", async () => {
    const t = tracker();
    const describe = (): { kind: "chat"; title: string; sessionId: string } => ({
      kind: "chat",
      title: "Chat",
      sessionId: "s1",
    });
    expect(await t.alert("s:s1", { title: "Needs your help", body: "Q?" }, describe)).toBe(false);
    expect(sent).toHaveLength(0);
    starts = [
      { token: "cd".repeat(32), env: "sandbox", deviceId: "a" },
      { token: "cd".repeat(32), env: "sandbox", deviceId: "b" },
      { token: "ef".repeat(32), env: "production", deviceId: "c" },
    ];
    expect(await t.alert("s:s1", { title: "Needs your help", body: "Q?" }, describe)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.target.token).toBe("cd".repeat(32));
    expect(sent[0]!.push).toEqual({
      event: "start",
      attributesType: "KleioActivityAttributes",
      attributes: { kind: "chat", title: "Chat", sessionId: "s1" },
      contentState: { phase: "needsYou", line: "Needs your help", detail: "Q?", startedAt: S0 },
      alert: { title: "Needs your help", body: "Q?", sound: "default" },
      staleDate: S0 + 1800,
      priority: 10,
    });
    answer = "failed";
    expect(await t.alert("s:s1", { title: "x", body: "y" }, describe)).toBe(false);
  });

  it("tells onEnd how every job ended, activity or not, and lists what's showing", async () => {
    const ends: string[] = [];
    const t = createLiveActivityTracker({
      apns,
      now: () => clock,
      onEnd: (target, state) => ends.push(`${target}:${state.phase}`),
    });
    t.onFrame("s2", { type: "run_start" });
    t.onFrame("s1", { type: "run_start" });
    expect(t.snapshot().map((s) => `${s.target}:${s.state.phase}`)).toEqual([
      "s:s1:working",
      "s:s2:working",
    ]);
    t.onFrame("s1", { type: "run_end", data: { failed: true } });
    await t.set("g:g_1", { phase: "working", line: "Starting…" }, { fresh: true });
    await t.set("g:g_1", { phase: "done", line: "Done" });
    expect(ends).toEqual(["s:s1:failed", "g:g_1:done"]);
    expect(t.snapshot().map((s) => s.target)).toEqual(["s:s2"]);
    expect(sent).toHaveLength(0); // nothing registered: no pushes
  });

  it("set: group words, a fresh timer, and an end only when something was showing", async () => {
    const t = tracker();
    expect(await t.set("g:g_1", { phase: "done", line: "Done" })).toBe(false);
    expect(t.state("g:g_1")).toBeUndefined();
    t.register("g:g_1", reg);
    await t.set("g:g_1", { phase: "working", line: "Starting…" }, { fresh: true });
    clock += 3_000;
    await t.set("g:g_1", { phase: "working", line: "Ada is on it" });
    await t.flush();
    expect(t.state("g:g_1")).toMatchObject({ line: "Ada is on it", startedAt: S0 });
    await t.set("g:g_1", { phase: "stopped", line: "Paused after 35 turns" });
    await t.flush();
    expect(sent.at(-1)!.push).toMatchObject({
      event: "end",
      dismissalDate: S0 + 3 + 600,
      contentState: { phase: "stopped", endedAt: S0 + 3 },
    });
  });
});
