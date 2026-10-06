import { afterEach, describe, expect, it, vi } from "vitest";
import type { Nudge } from "../src/apns.js";
import { askNudgeText, createAskNotifier, parseAskFrame } from "../src/ask-push.js";

const askFrame = (id: string, questions: unknown[]): string =>
  `id: 3\ndata: ${JSON.stringify({ type: "ask_user", data: { id, questions } })}`;
const doneFrame = (id: string): string =>
  `data: ${JSON.stringify({ type: "ask_user_done", data: { id } })}`;
const Q = {
  id: "store",
  question: "Where should login sessions be stored?",
  kind: "choice",
  options: [{ label: "Keep it simple (one file)" }, { label: "Use a real database", hint: "h" }],
};

afterEach(() => vi.useRealTimers());

describe("askNudgeText / parseAskFrame", () => {
  it("titles the first question and lists its options", () => {
    expect(parseAskFrame(askFrame("ask-1", [Q]))).toEqual({
      type: "ask",
      id: "ask-1",
      title: "Where should login sessions be stored?",
      body: "Keep it simple (one file) · Use a real database",
    });
  });
  it("counts extra questions, defaults confirm to Yes/No, and clips", () => {
    const t = askNudgeText([
      { question: "x".repeat(500), kind: "confirm" },
      { question: "b" },
      { question: "c" },
    ]);
    expect(t.title.endsWith("… (+2 more)")).toBe(true);
    expect(t.title.length).toBeLessThanOrEqual(120);
    expect(t.body).toBe("Yes · No");
    expect(askNudgeText([{ question: "Name?", kind: "text" }]).body).toBe("Tap to answer.");
  });
  it("ignores other frames", () => {
    expect(parseAskFrame(`data: {"type":"run_end","data":{}}`)).toBeNull();
    expect(parseAskFrame(doneFrame("ask-2"))).toEqual({ type: "done", id: "ask-2" });
  });
});

describe("createAskNotifier", () => {
  function setup(attached: boolean) {
    const state = { attached };
    const pushes: Nudge[] = [];
    const n = createAskNotifier({
      attached: () => state.attached,
      push: (x) => pushes.push(x),
      recheckMs: 20_000,
    });
    return { state, pushes, n };
  }

  it("pushes at once when nobody is attached, once per ask", () => {
    const { pushes, n } = setup(false);
    n.onFrame("s1", askFrame("ask-1", [Q]), true);
    n.onFrame("s1", askFrame("ask-1", [Q]), true); // replayed
    expect(pushes).toEqual([
      {
        sessionId: "s1",
        ask: true,
        title: "Where should login sessions be stored?",
        body: "Keep it simple (one file) · Use a real database",
      },
    ]);
  });

  it("never pushes for a group member session", () => {
    const { pushes, n } = setup(false);
    n.onFrame("s1", askFrame("ask-1", [Q]), false);
    expect(pushes).toHaveLength(0);
  });

  it("re-checks a watched ask and pushes only if still open and unwatched", () => {
    vi.useFakeTimers();
    const { state, pushes, n } = setup(true);
    n.onFrame("s1", askFrame("ask-1", [Q]), true);
    n.onFrame("s1", askFrame("ask-2", [Q]), true);
    n.onFrame("s1", askFrame("ask-3", [Q]), true);
    expect(pushes).toHaveLength(0);
    n.onFrame("s1", doneFrame("ask-1"), true); // answered in time
    state.attached = false;
    vi.advanceTimersByTime(20_000);
    expect(pushes.map((p) => p.sessionId)).toEqual(["s1", "s1"]);
    n.stop();
  });

  it("does not push a watched ask whose watcher stayed", () => {
    vi.useFakeTimers();
    const { pushes, n } = setup(true);
    n.onFrame("s1", askFrame("ask-1", [Q]), true);
    vi.advanceTimersByTime(20_000);
    expect(pushes).toHaveLength(0);
  });
});
