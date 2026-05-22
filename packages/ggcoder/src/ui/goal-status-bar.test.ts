import { describe, expect, it } from "vitest";
import {
  formatGoalElapsed,
  formatGoalStatusActiveText,
  reconcileGoalStatusEntriesWithRuns,
  removeGoalStatusEntry,
  syncGoalStatusEntries,
  type GoalStatusEntry,
} from "./components/GoalStatusBar.js";
import type { GoalRun } from "../core/goal-store.js";

function goalRun(overrides: Partial<GoalRun> = {}): GoalRun {
  return {
    id: "run-1",
    title: "Goal title",
    goal: "Goal body",
    status: "ready",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    projectPath: "/tmp/project",
    successCriteria: [],
    prerequisites: [],
    harness: [],
    evidencePlan: [],
    tasks: [],
    evidence: [],
    blockers: [],
    ...overrides,
  };
}

describe("GoalStatusBar helpers", () => {
  it("formats elapsed goal runtime as minutes and seconds", () => {
    expect(formatGoalElapsed(-100)).toBe("0:00");
    expect(formatGoalElapsed(999)).toBe("0:00");
    expect(formatGoalElapsed(1_000)).toBe("0:01");
    expect(formatGoalElapsed(65_400)).toBe("1:05");
  });

  it("formats active worker text with concise task-aware copy and no ids", () => {
    expect(
      formatGoalStatusActiveText({
        runId: "run-1",
        label: "Verify footer behavior",
        phase: "worker",
        startedAt: 0,
        workerId: "worker-secret",
        goalNumber: 1,
      }),
    ).toBe("Goal working · Verify footer behavior");
  });

  it("formats verifier text with concise task-aware copy", () => {
    expect(
      formatGoalStatusActiveText({
        runId: "run-2",
        label: "Long verification title",
        phase: "verifier",
        startedAt: 0,
        detail: "pnpm test",
        goalNumber: 2,
      }),
    ).toBe("Goal verifying · Long verification title");
  });

  it("mirrors upsert and clear changes through a sessionStore-shaped snapshot", () => {
    const sessionStore: { goalStatusEntries?: GoalStatusEntry[] } = { goalStatusEntries: [] };
    const first: GoalStatusEntry = {
      runId: "run-1",
      label: "Implement goal lifecycle persistence",
      phase: "worker",
      startedAt: Date.now(),
    };

    sessionStore.goalStatusEntries = syncGoalStatusEntries(
      sessionStore.goalStatusEntries ?? [],
      first,
    );
    expect(sessionStore.goalStatusEntries).toHaveLength(1);
    expect(sessionStore.goalStatusEntries[0]?.goalNumber).toBe(1);

    const remountedEntries = sessionStore.goalStatusEntries ?? [];
    const updated = syncGoalStatusEntries(remountedEntries, { ...first, phase: "verifier" });
    sessionStore.goalStatusEntries = updated;
    expect(sessionStore.goalStatusEntries).toHaveLength(1);
    expect(sessionStore.goalStatusEntries[0]).toMatchObject({
      runId: "run-1",
      phase: "verifier",
      goalNumber: 1,
    });

    sessionStore.goalStatusEntries = removeGoalStatusEntry(sessionStore.goalStatusEntries, "run-1");
    expect(sessionStore.goalStatusEntries).toEqual([]);
  });

  it("cleans stale persisted entries when durable run state is inactive after remount", () => {
    const entries: GoalStatusEntry[] = [
      {
        runId: "run-ready",
        label: "Stale ready goal",
        phase: "reviewing",
        startedAt: Date.now() - 10 * 60_000,
      },
      {
        runId: "run-failed",
        label: "Stale failed goal",
        phase: "worker",
        startedAt: Date.now() - 10 * 60_000,
      },
    ];

    expect(
      reconcileGoalStatusEntriesWithRuns(entries, [
        goalRun({ id: "run-ready", status: "ready" }),
        goalRun({ id: "run-failed", status: "failed" }),
      ]),
    ).toEqual([]);
  });

  it("keeps the same entry array when active reconciliation is a no-op", () => {
    const entries: GoalStatusEntry[] = [
      {
        runId: "run-worker",
        label: "Active worker goal",
        phase: "worker",
        workerId: "worker-1",
        startedAt: Date.now(),
      },
    ];

    const reconciled = reconcileGoalStatusEntriesWithRuns(
      entries,
      [
        goalRun({
          id: "run-worker",
          status: "running",
          activeWorkerId: "worker-1",
          tasks: [
            {
              id: "task-1",
              title: "Task",
              prompt: "Do it",
              status: "running",
              attempts: 1,
              workerId: "worker-1",
            },
          ],
        }),
      ],
      { isWorkerActive: (workerId) => workerId === "worker-1" },
    );

    expect(reconciled).toBe(entries);
  });

  it("preserves legitimate active worker and verifier entries", () => {
    const entries: GoalStatusEntry[] = [
      {
        runId: "run-worker",
        label: "Active worker goal",
        phase: "worker",
        workerId: "worker-1",
        startedAt: Date.now(),
      },
      {
        runId: "run-verifier",
        label: "Active verifier goal",
        phase: "verifier",
        startedAt: Date.now(),
      },
    ];

    expect(
      reconcileGoalStatusEntriesWithRuns(
        entries,
        [
          goalRun({
            id: "run-worker",
            status: "running",
            activeWorkerId: "worker-1",
            tasks: [
              {
                id: "task-1",
                title: "Task",
                prompt: "Do it",
                status: "running",
                attempts: 1,
                workerId: "worker-1",
              },
            ],
          }),
          goalRun({ id: "run-verifier", status: "verifying" }),
        ],
        {
          isWorkerActive: (workerId) => workerId === "worker-1",
          isVerifierActive: (run) => run.id === "run-verifier",
        },
      ).map((entry) => entry.runId),
    ).toEqual(["run-worker", "run-verifier"]);
  });

  it("restores non-empty entries from a sessionStore remount snapshot", () => {
    const sessionStore: { goalStatusEntries?: GoalStatusEntry[] } = { goalStatusEntries: [] };
    sessionStore.goalStatusEntries = syncGoalStatusEntries(sessionStore.goalStatusEntries ?? [], {
      runId: "run-1",
      label: "Implement status persistence",
      phase: "worker",
      startedAt: Date.now(),
    });

    const remountedEntries = sessionStore.goalStatusEntries ?? [];
    expect(remountedEntries).toHaveLength(1);
    expect(remountedEntries.map(formatGoalStatusActiveText)).toContain(
      "Goal working · Implement status persistence",
    );
  });
});
