import { describe, expect, it } from "vitest";
import type { GoalRun, GoalTask } from "../core/goal-store.js";
import { canCompleteGoalRun, decideGoalNextAction } from "../core/goal-controller.js";
import {
  completedItemsWithDurableGoalTerminalProgress,
  formatGoalTerminalProgress,
  type CompletedItem,
} from "./App.js";

function goalRun(overrides: Partial<GoalRun> = {}): GoalRun {
  return {
    id: "goal-ui",
    title: "UI Goal lifecycle",
    goal: "Exercise the /goal UI orchestration lifecycle",
    status: "ready",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    projectPath: "/tmp/project",
    successCriteria: ["Verifier passes"],
    prerequisites: [],
    harness: [],
    evidencePlan: [],
    tasks: [],
    evidence: [],
    blockers: [],
    ...overrides,
  };
}

function task(overrides: Partial<GoalTask> = {}): GoalTask {
  return {
    id: "task-a",
    title: "Implement UI path",
    prompt: "Do focused work",
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

function applyStartWorker(run: GoalRun, workerId = "worker-ui"): GoalRun {
  const decision = decideGoalNextAction(run);
  expect(decision).toMatchObject({ kind: "start_worker" });
  if (decision.kind !== "start_worker") throw new Error("expected worker start");
  return {
    ...run,
    status: "running",
    activeWorkerId: workerId,
    tasks: run.tasks.map((item) =>
      item.id === decision.task.id
        ? { ...item, status: "running", workerId, attempts: decision.attempts }
        : item,
    ),
  };
}

function applyWorkerDone(run: GoalRun): GoalRun {
  return {
    ...run,
    status: "ready",
    activeWorkerId: undefined,
    tasks: run.tasks.map((item) =>
      item.workerId ? { ...item, status: "done", workerId: undefined } : item,
    ),
  };
}

function applyVerifierResult(
  run: GoalRun,
  status: "pass" | "fail",
  summary = `${status} summary`,
): GoalRun {
  const completion =
    status === "pass"
      ? canCompleteGoalRun({
          ...run,
          verifier: {
            description: "Full check",
            command: "pnpm test",
            ...run.verifier,
            lastResult: {
              status,
              summary,
              command: "pnpm test",
              checkedAt: "2024-01-01T00:00:00.000Z",
              exitCode: 0,
            },
          },
        })
      : { ok: false };
  return {
    ...run,
    status: status === "pass" && completion.ok ? "passed" : "ready",
    continueRequestedAt: status === "pass" && completion.ok ? undefined : run.continueRequestedAt,
    verifier: {
      description: "Full check",
      command: "pnpm test",
      ...run.verifier,
      lastResult: {
        status,
        summary,
        command: "pnpm test",
        checkedAt: "2024-01-01T00:00:00.000Z",
        exitCode: status === "pass" ? 0 : 1,
        outputPath: ".goal-evidence/verifier.log",
      },
    },
    evidence: [
      ...run.evidence,
      {
        id: `evidence-${run.evidence.length + 1}`,
        createdAt: "2024-01-01T00:00:00.000Z",
        kind: "command",
        label: `Verifier ${status}`,
        content: summary,
        path: ".goal-evidence/verifier.log",
      },
    ],
  };
}

describe("/goal UI orchestration lifecycle", () => {
  it("reconstructs a visible blocker/verification terminal message from durable Goal state", () => {
    const blocked = goalRun({
      status: "blocked",
      title: "Investigate disappearing blocker",
      tasks: [task({ status: "blocked", attempts: 2, lastSummary: "Paused after verifier loop." })],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "fail",
          summary: "GOAL BLOCKER verification failed after pane switch",
          checkedAt: "2024-01-01T00:00:00.000Z",
          exitCode: 1,
          outputPath: ".goal-evidence/blocker.log",
        },
      },
      evidence: [
        {
          id: "ev-blocker",
          createdAt: "2024-01-01T00:00:01.000Z",
          kind: "command",
          label: "GOAL BLOCKER verification",
          content: "GOAL BLOCKER verification failed after pane switch",
          path: ".goal-evidence/blocker.log",
        },
      ],
      blockers: ["GOAL BLOCKER verification failed after pane switch"],
    });

    const initiallyVisible = formatGoalTerminalProgress(blocked);
    expect(initiallyVisible).toMatchObject({
      kind: "goal_progress",
      phase: "terminal",
      title: "Goal blocked: Investigate disappearing blocker",
      detail: "GOAL BLOCKER verification failed after pane switch",
      status: "blocked",
    });

    // Model the sensory regression: pane switches/remounts can lose ephemeral
    // liveItems, so the blocker must be reconstructable from durable GoalRun.
    const sessionStoreAfterGoalPaneSwitch = { liveItems: [] as unknown[] };
    expect(sessionStoreAfterGoalPaneSwitch.liveItems).toHaveLength(0);

    const reconstructedAfterRestore = formatGoalTerminalProgress(blocked);
    expect(reconstructedAfterRestore).toEqual(initiallyVisible);
    expect(reconstructedAfterRestore?.summaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Verifier",
          value: "fail",
          detail: ".goal-evidence/blocker.log",
        }),
        expect.objectContaining({
          label: "Evidence",
          value: "1 recorded",
          detail: ".goal-evidence/blocker.log",
        }),
        expect.objectContaining({
          label: "Blocked on",
          value: "GOAL BLOCKER verification failed after pane switch",
        }),
      ]),
    );
  });

  it("does not synthesize old terminal Goal messages into fresh UI state", () => {
    const blocked = goalRun({
      id: "goal-blocked",
      status: "blocked",
      title: "Pane restore blocker",
      blockers: ["GOAL BLOCKER survived remount"],
      verifier: {
        description: "Full check",
        lastResult: { status: "fail", summary: "failed", checkedAt: "2024-01-01T00:00:00.000Z" },
      },
    });
    const freshHistory: CompletedItem[] = [];

    const afterPoll = completedItemsWithDurableGoalTerminalProgress(freshHistory, [blocked]);

    expect(afterPoll).toBe(freshHistory);
    expect(afterPoll).toHaveLength(0);
  });

  it("reconciles terminal Goal messages that were already visible in this UI session", () => {
    const blocked = goalRun({
      id: "goal-scroll",
      status: "blocked",
      title: "Scroll-safe blocker",
      blockers: ["GOAL BLOCKER should not pin scroll"],
    });
    const terminalProgress = formatGoalTerminalProgress(blocked);
    if (!terminalProgress) throw new Error("expected terminal progress");
    const withBlocker: CompletedItem[] = [{ ...terminalProgress, id: "goal-terminal-goal-scroll" }];

    const repeatedPoll = completedItemsWithDurableGoalTerminalProgress(withBlocker, [blocked]);
    expect(repeatedPoll).toBe(withBlocker);

    const passed = { ...blocked, status: "passed" as const, blockers: [] };
    const passedProgress = formatGoalTerminalProgress(passed);
    if (!passedProgress) throw new Error("expected passed progress");
    const afterEventAppend = [
      ...repeatedPoll,
      { ...passedProgress, id: "goal-terminal-goal-scroll" },
    ];
    const afterPassed = completedItemsWithDurableGoalTerminalProgress(afterEventAppend, [passed]);
    expect(afterPassed).not.toBe(afterEventAppend);
    expect(afterPassed).toHaveLength(2);
    expect(afterPassed[0]).toMatchObject({ kind: "tombstone" });
    expect(afterPassed[1]).toMatchObject({ title: "Goal passed: Scroll-safe blocker" });

    const repeatedPassedPoll = completedItemsWithDurableGoalTerminalProgress(afterPassed, [passed]);
    expect(repeatedPassedPoll).toBe(afterPassed);
  });

  it("starts a pending task and persists running task worker identity", () => {
    const staleSnapshot = goalRun({ tasks: [task()] });
    const started = applyStartWorker(staleSnapshot, "worker-123");

    expect(started).toMatchObject({ status: "running", activeWorkerId: "worker-123" });
    expect(started.tasks).toEqual([
      expect.objectContaining({
        id: "task-a",
        status: "running",
        workerId: "worker-123",
        attempts: 1,
      }),
    ]);
    expect(decideGoalNextAction(started)).toEqual({
      kind: "wait",
      reason: "Goal already has an active worker.",
      workerId: "worker-123",
    });

    const staleOverwrite = {
      ...staleSnapshot,
      status: "running" as const,
      activeWorkerId: "worker-123",
    };
    expect(staleOverwrite.tasks[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("worker completion drives verifier and verifier pass gates passed status", () => {
    const done = applyWorkerDone(
      applyStartWorker(
        goalRun({ tasks: [task()], verifier: { description: "Full check", command: "pnpm test" } }),
      ),
    );

    expect(decideGoalNextAction(done)).toEqual({
      kind: "run_verifier",
      command: "pnpm test",
      reason: "All Goal tasks are done; running configured verifier for real completion evidence.",
    });

    const passed = applyVerifierResult(done, "pass", "mock verifier passed");
    expect(passed.status).toBe("passed");
    expect(canCompleteGoalRun(passed)).toEqual({
      ok: true,
      reason: "All tasks are done and verifier evidence passed.",
    });
    expect(decideGoalNextAction(passed)).toEqual({
      kind: "complete",
      reason: "All tasks are done and verifier evidence passed.",
    });
  });

  it("verifier failure creates exactly one bounded fix task and queued continuation starts it", () => {
    const done = applyWorkerDone(
      applyStartWorker(
        goalRun({ tasks: [task()], verifier: { description: "Full check", command: "pnpm test" } }),
      ),
    );
    const failed = applyVerifierResult(
      { ...done, continueRequestedAt: "2024-01-01T00:00:00.000Z" },
      "fail",
      "assertion failed",
    );

    expect(failed.status).toBe("ready");
    expect(failed.status).not.toBe("failed");
    expect(failed.continueRequestedAt).toBe("2024-01-01T00:00:00.000Z");
    const createFix = decideGoalNextAction(failed, { verifierFixLimit: 1 });
    expect(createFix).toMatchObject({
      kind: "create_task",
      title: "Fix verifier failure",
      reason: "Verifier failed; creating bounded fix task 1/1.",
    });
    const withFix =
      createFix.kind === "create_task"
        ? {
            ...failed,
            tasks: [
              ...failed.tasks,
              task({ id: "fix-1", title: createFix.title, prompt: createFix.prompt }),
            ],
          }
        : failed;

    expect(withFix.tasks.filter((item) => item.title === "Fix verifier failure")).toHaveLength(1);
    expect(decideGoalNextAction(withFix)).toMatchObject({
      kind: "start_worker",
      task: expect.objectContaining({ id: "fix-1", title: "Fix verifier failure" }),
      attempts: 1,
    });

    const fixing = applyStartWorker(withFix, "worker-fix");
    expect(fixing.tasks.find((item) => item.id === "fix-1")).toMatchObject({
      status: "running",
      workerId: "worker-fix",
    });
  });

  it("prevents duplicate verifier fix ownership once controller-created fix exists", () => {
    const run = goalRun({
      status: "ready",
      tasks: [
        task({ status: "done", attempts: 1 }),
        task({ id: "fix-1", title: "Fix verifier failure", status: "pending" }),
      ],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "fail",
          summary: "assertion failed",
          checkedAt: "2024-01-01T00:00:00.000Z",
          exitCode: 1,
        },
      },
    });

    expect(decideGoalNextAction(run, { verifierFixLimit: 2 })).toMatchObject({
      kind: "start_worker",
      task: expect.objectContaining({ id: "fix-1", title: "Fix verifier failure" }),
    });
    expect(run.tasks.filter((item) => item.title === "Fix verifier failure")).toHaveLength(1);
  });

  it("attempt-limit repeated verifier failure persists paused/blocked evidence instead of unreachable terminal failed", () => {
    const run = goalRun({
      status: "ready",
      tasks: [task({ status: "done", attempts: 1 })],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "fail",
          summary: "same failure",
          checkedAt: "2024-01-01T00:00:00.000Z",
          exitCode: 1,
        },
      },
      evidence: [
        {
          id: "e1",
          createdAt: "2024-01-01T00:00:00.000Z",
          kind: "command",
          label: "Verifier fail",
          content: "same failure",
        },
        {
          id: "e2",
          createdAt: "2024-01-01T00:00:01.000Z",
          kind: "command",
          label: "Verifier fail",
          content: "same failure",
        },
      ],
    });

    const decision = decideGoalNextAction(run, { verifierFixLimit: 1 });
    expect(decision).toEqual({
      kind: "blocked",
      reason:
        "Verifier produced the same failure repeatedly; pause for diagnosis before creating more fix tasks.",
    });
    const taskUpdatedRun = {
      ...run,
      tasks: run.tasks.map((item) =>
        item.id === "task-a"
          ? {
              ...item,
              status: "blocked" as const,
              attempts: 2,
              lastSummary: "Paused after verifier loop.",
            }
          : item,
      ),
    };
    const persisted = {
      ...taskUpdatedRun,
      status: "blocked" as const,
      continueRequestedAt: undefined,
      blockers: [decision.reason],
      evidence: [
        ...taskUpdatedRun.evidence,
        {
          id: "pause",
          createdAt: "2024-01-01T00:00:02.000Z",
          kind: "summary" as const,
          label: "Goal paused",
          content: decision.reason,
        },
      ],
    };
    expect(persisted.status).toBe("blocked");
    expect(persisted.status).not.toBe("failed");
    expect(persisted.tasks[0]).toMatchObject({
      status: "blocked",
      attempts: 2,
      lastSummary: "Paused after verifier loop.",
    });
    expect(persisted.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Goal paused", content: decision.reason }),
      ]),
    );
  });

  it("attempt-limit pauses after bounded verifier fix tasks without terminal failed", () => {
    const run = goalRun({
      status: "ready",
      tasks: [
        task({ status: "done", attempts: 1 }),
        task({ id: "fix-1", title: "Fix verifier failure", status: "done", attempts: 1 }),
      ],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "fail",
          summary: "new failure",
          checkedAt: "2024-01-01T00:00:00.000Z",
          exitCode: 1,
        },
      },
      evidence: [
        {
          id: "e1",
          createdAt: "2024-01-01T00:00:00.000Z",
          kind: "command",
          label: "Verifier fail",
          content: "first failure",
        },
        {
          id: "e2",
          createdAt: "2024-01-01T00:00:01.000Z",
          kind: "command",
          label: "Verifier fail",
          content: "new failure",
        },
      ],
    });

    const decision = decideGoalNextAction(run, { verifierFixLimit: 1 });
    expect(decision).toMatchObject({
      kind: "pause",
      task: expect.objectContaining({
        id: "verifier-fix-limit",
        title: "Fix verifier failure",
        status: "blocked",
      }),
      attempts: 1,
      reason: "Verifier fix task limit reached (1).",
    });
    const persisted = {
      ...run,
      status: "paused" as const,
      continueRequestedAt: undefined,
      blockers: [decision.reason],
    };
    expect(persisted.status).toBe("paused");
    expect(persisted.status).not.toBe("failed");
  });
});
