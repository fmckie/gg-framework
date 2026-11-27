import { describe, expect, it } from "vitest";
import { GODS, type God } from "../olympus/gods";
import type { SubAgentLine } from "../SubAgentFeed";
import type { GoalFinish } from "./goal-finish";
import { LAUREL_WORDS, STELE_BLANK, laurelOf, steleOf, stretchWorkers } from "./goal-stele";
import {
  collectGoalAgents,
  collectWorkers,
  goalAgentStateLabel,
  type WorkerAgent,
  type WorkerGroup,
} from "./worker-status";

const finish = (over: Partial<GoalFinish> = {}): GoalFinish => ({
  id: 8000,
  goalId: "g",
  outcome: "done",
  fromItemId: 10,
  elapsedMs: 7000,
  turns: 5,
  workers: 3,
  failedWorkers: 1,
  outputTokens: 1500,
  line: "All finished. The full write-up is in the chat.",
  ...over,
});

const line = (over: Partial<SubAgentLine> = {}): SubAgentLine => ({
  toolCallId: "a",
  status: "done",
  activities: [],
  toolUseCount: 1,
  ...over,
});

const worker = (over: Partial<WorkerAgent> = {}): WorkerAgent => ({
  key: "12:a",
  agentName: "builder",
  label: "builder",
  status: "done",
  activity: undefined,
  tokens: null,
  durationMs: 1000,
  toolUseCount: 1,
  ...over,
});

const groups: WorkerGroup[] = [
  { id: 5, agents: [line({ toolCallId: "old", toolUseCount: 99 })] },
  {
    id: 12,
    agents: [
      line({
        toolCallId: "a",
        agentName: "survey",
        agentType: "owl",
        toolUseCount: 4,
        durationMs: 65_000,
        tokenUsage: { input: 900, output: 1200, cacheRead: 3000 },
      }),
      line({ toolCallId: "b", status: "error", toolUseCount: 9 }),
    ],
  },
  { id: 20, aborted: true, agents: [line({ toolCallId: "c", status: "running" })] },
];

const gods = new Map<string, God>([
  ["12:a", GODS.athena],
  ["12:b", GODS.hermes],
]);

describe("the stele", () => {
  it("lists the stretch's workers, the ones the finish card counts", () => {
    expect(stretchWorkers(finish(), groups).map((w) => w.key)).toEqual(["12:a", "12:b", "20:c"]);
    expect(stretchWorkers(finish({ fromItemId: 12 }), groups).map((w) => w.key)).toEqual(["20:c"]);
  });

  it("gives each worker a line: its god, its name, how it ended, time, tools and tokens", () => {
    const stele = steleOf(finish(), groups, gods);
    expect(stele).toMatchObject({ id: 8000, outcome: "done", title: "Job done", laurel: "12:a" });
    expect(stele.lines).toEqual([
      {
        key: "12:a",
        god: GODS.athena,
        name: "survey",
        ending: "Done",
        status: "done",
        time: "1m 5s",
        tools: "4",
        tokens: "↑ 900 · ↻ 3k cached · ↓ 1.2k",
        laurel: true,
      },
      {
        key: "12:b",
        god: GODS.hermes,
        name: "Agent 2",
        // As its row says it: a worker that errored is "Stopped" there too.
        ending: "Stopped",
        status: "error",
        time: STELE_BLANK,
        tools: "9",
        tokens: STELE_BLANK,
        laurel: false,
      },
      {
        key: "20:c",
        // A worker the cast doesn't know is Nike.
        god: GODS.nike,
        name: "Agent 1",
        ending: "Stopped",
        status: "error",
        time: STELE_BLANK,
        tools: "1",
        tokens: STELE_BLANK,
        laurel: false,
      },
    ]);
  });

  it("says a stopped worker is Stopped, as its row in the Workers list does", () => {
    // Cancelled outright, and still at work when its run was aborted: neither errored.
    const stopped: WorkerGroup[] = [
      {
        id: 30,
        agents: [
          line({ toolCallId: "cancelled", status: "interrupted", toolUseCount: 40 }),
          line({ toolCallId: "kept", status: "done", toolUseCount: 2 }),
        ],
      },
      {
        id: 31,
        aborted: true,
        agents: [line({ toolCallId: "aborted", status: "running", toolUseCount: 50 })],
      },
    ];
    const stele = steleOf(finish(), stopped, gods);
    expect(stele.lines.map((l) => [l.key, l.ending, l.status])).toEqual([
      ["30:cancelled", "Stopped", "error"],
      ["30:kept", "Done", "done"],
      ["31:aborted", "Stopped", "error"],
    ]);
    // What WorkerList shows in each one's row: the same words, from the same code.
    const rows = collectGoalAgents({
      running: false,
      liveTools: [],
      waitingOnUser: false,
      workers: collectWorkers(stopped),
    }).slice(1);
    expect(rows.map((row) => row.key)).toEqual(stele.lines.map((l) => l.key));
    expect(stele.lines.map((l) => l.ending)).toEqual(rows.map(goalAgentStateLabel));
    expect(stele.lines.map((l) => l.status)).toEqual(rows.map((row) => row.status));
    // Stopped is not finished: the laurel passes over both, whatever they did.
    expect(stele.laurel).toBe("30:kept");
    expect(stele.lines.filter((l) => l.laurel).map((l) => l.key)).toEqual(["30:kept"]);
  });

  it("says each other state as its row does too: errored, idle, and still at work", () => {
    const mixed: WorkerGroup[] = [
      {
        id: 40,
        agents: [
          line({ toolCallId: "errored", status: "error" }),
          line({ toolCallId: "idle", status: "idle" }),
          line({ toolCallId: "busy", status: "running" }),
          line({ toolCallId: "done", status: "done" }),
        ],
      },
    ];
    const rows = collectGoalAgents({
      running: false,
      liveTools: [],
      waitingOnUser: false,
      workers: collectWorkers(mixed),
    }).slice(1);
    const stele = steleOf(finish(), mixed, gods);
    expect(stele.lines.map((l) => l.ending)).toEqual(["Stopped", "Idle", "Working", "Done"]);
    expect(stele.lines.map((l) => l.ending)).toEqual(rows.map(goalAgentStateLabel));
  });

  it("repeats the finish card's totals", () => {
    expect(steleOf(finish(), groups, gods).totals).toEqual([
      { label: "Time", value: "7s" },
      { label: "Workers", value: "3 (1 failed)" },
      { label: "Turns", value: "5" },
      { label: "Tokens written", value: "1.5k" },
    ]);
    expect(steleOf(finish({ failedWorkers: 0 }), groups, gods).totals[1]?.value).toBe("3");
  });

  it("titles each outcome as the finish card does, and crowns nobody on a failure", () => {
    expect(steleOf(finish({ outcome: "unverified" }), groups, gods)).toMatchObject({
      title: "Done, not all checked",
      laurel: "12:a",
    });
    const failed = steleOf(finish({ outcome: "failed" }), groups, gods);
    expect(failed).toMatchObject({ title: "Couldn't finish", laurel: null });
    expect(failed.lines.some((l) => l.laurel)).toBe(false);
  });

  it("stands with no lines when the stretch brought nobody in", () => {
    expect(steleOf(finish({ fromItemId: 50 }), groups, gods)).toMatchObject({
      lines: [],
      laurel: null,
    });
  });

  it("says what the laurel is for", () => {
    expect(LAUREL_WORDS).toBe("Laurels: most tools used");
  });
});

describe("the laurel", () => {
  it("goes to the finished worker that used most tools", () => {
    const workers = [
      worker({ key: "a", toolUseCount: 3 }),
      worker({ key: "b", toolUseCount: 7 }),
      worker({ key: "c", toolUseCount: 5 }),
    ];
    expect(laurelOf(workers, "done")).toBe("b");
    expect(laurelOf(workers, "unverified")).toBe("b");
  });

  it("passes over a worker that failed or was stopped, however much it did", () => {
    const workers = [
      worker({ key: "a", toolUseCount: 2 }),
      worker({ key: "b", toolUseCount: 40, status: "error" }),
      worker({ key: "c", toolUseCount: 30, status: "interrupted" }),
      // Idle is finished and waiting for more.
      worker({ key: "d", toolUseCount: 3, status: "idle" }),
    ];
    expect(laurelOf(workers, "done")).toBe("d");
  });

  it("breaks a tie by the longer time, then by who was brought in first", () => {
    expect(
      laurelOf(
        [
          worker({ key: "a", toolUseCount: 5, durationMs: 1000 }),
          worker({ key: "b", toolUseCount: 5, durationMs: 9000 }),
          worker({ key: "c", toolUseCount: 5, durationMs: 9000 }),
        ],
        "done",
      ),
    ).toBe("b");
    expect(
      laurelOf(
        [
          worker({ key: "a", toolUseCount: 5, durationMs: undefined }),
          worker({ key: "b", toolUseCount: 5, durationMs: 0 }),
        ],
        "done",
      ),
    ).toBe("a");
  });

  it("counts only workers that finished: done, or idle and waiting for more", () => {
    const one = (status: WorkerAgent["status"]): string | null =>
      laurelOf([worker({ key: status, status, toolUseCount: 99 })], "done");
    expect((["done", "idle", "running", "error", "interrupted"] as const).map(one)).toEqual([
      "done",
      "idle",
      null,
      null,
      null,
    ]);
  });

  it("goes to nobody when nobody finished, or the stretch failed", () => {
    expect(laurelOf([], "done")).toBeNull();
    expect(
      laurelOf([worker({ status: "error" }), worker({ status: "running" })], "done"),
    ).toBeNull();
    expect(laurelOf([worker()], "failed")).toBeNull();
  });
});
