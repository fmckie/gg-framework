import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolExecuteResult } from "@kenkaiiii/gg-agent";
import { createGoalsTool } from "./goals.js";
import { decideGoalNextAction } from "../core/goal-controller.js";
import { getGoalRun, upsertGoalRun } from "../core/goal-store.js";

let tmpBase: string;
let tmpProject: string;

async function executeGoals(
  args: Parameters<ReturnType<typeof createGoalsTool>["execute"]>[0],
): Promise<ToolExecuteResult> {
  return createGoalsTool(tmpProject).execute(args, {
    signal: new AbortController().signal,
    toolCallId: "test-call",
  });
}

beforeEach(async () => {
  tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "goals-tool-test-base-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "goals-tool-test-project-"));
  process.env.GG_GOALS_BASE = tmpBase;
});

afterEach(async () => {
  delete process.env.GG_GOALS_BASE;
  await fs.rm(tmpBase, { recursive: true, force: true });
  await fs.rm(tmpProject, { recursive: true, force: true });
});

describe("goals tool state guards", () => {
  it("updates an explicit run_id task and evidence when no active goal exists in the caller cwd", async () => {
    const runProject = await fs.mkdtemp(path.join(os.tmpdir(), "goals-tool-explicit-run-project-"));
    try {
      await upsertGoalRun(runProject, {
        id: "099c9f7f-bce7-475c-93b8-d9b3f88a0569",
        title: "Explicit run",
        goal: "Update from worker cwd",
        status: "passed",
      });

      const tool = createGoalsTool(tmpProject);
      const taskResult = await tool.execute(
        {
          action: "task",
          run_id: "099c9f7f-bce7-475c-93b8-d9b3f88a0569",
          task_id: "worker-task",
          task_title: "Worker callback",
          task_prompt: "Persist callback",
          task_status: "done",
          summary: "callback complete",
        },
        { signal: new AbortController().signal, toolCallId: "test-call" },
      );
      const evidenceResult = await tool.execute(
        {
          action: "evidence",
          run_id: "099c9f7f",
          evidence_kind: "summary",
          evidence_label: "Worker evidence",
          evidence_content: "same discovered run",
        },
        { signal: new AbortController().signal, toolCallId: "test-call" },
      );

      const run = await getGoalRun(runProject, "099c9f7f");
      expect(taskResult).toBe('Goal task added: "Worker callback".');
      expect(evidenceResult).toBe('Evidence added to "Explicit run".');
      expect(run?.tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "worker-task",
            status: "done",
            lastSummary: "callback complete",
          }),
        ]),
      );
      expect(run?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Worker evidence", content: "same discovered run" }),
        ]),
      );
    } finally {
      await fs.rm(runProject, { recursive: true, force: true });
    }
  });

  it("preserves task title and prompt when updating task status by id", async () => {
    const run = await upsertGoalRun(tmpProject, {
      title: "Research run",
      goal: "Design the Goal worker metadata fix",
      status: "ready",
      tasks: [
        {
          id: "research-task",
          title: "Research and design metadata preservation",
          prompt: "Inspect goal task updates and propose a durable fix.",
          status: "pending",
          attempts: 0,
        },
      ],
    });

    const result = await executeGoals({
      action: "task",
      run_id: run.id,
      task_id: "research-task",
      task_status: "done",
      summary: "Design completed",
    });

    const updated = await getGoalRun(tmpProject, run.id);
    expect(result).toBe('Goal task updated: "Research and design metadata preservation".');
    expect(updated?.tasks[0]).toEqual(
      expect.objectContaining({
        id: "research-task",
        title: "Research and design metadata preservation",
        prompt: "Inspect goal task updates and propose a durable fix.",
        status: "done",
        lastSummary: "Design completed",
      }),
    );
  });

  it("status resolves full UUID, short ID, and completed latest fallback", async () => {
    await executeGoals({
      action: "create",
      run_id: "099c9f7f-bce7-475c-93b8-d9b3f88a0569",
      title: "Status target",
      goal: "Status lookup",
      prerequisites: [],
    });
    await executeGoals({
      action: "verify",
      run_id: "099c9f7f",
      verification_status: "fail",
      summary: "failed",
    });

    await expect(
      executeGoals({ action: "status", run_id: "099c9f7f-bce7-475c-93b8-d9b3f88a0569" }),
    ).resolves.toContain("Status target");
    await expect(executeGoals({ action: "status", run_id: "099c9f7f" })).resolves.toContain(
      "[ready] Status target",
    );
    await expect(
      executeGoals({
        action: "evidence",
        evidence_label: "Latest failed",
        evidence_content: "fallback",
      }),
    ).resolves.toBe('Evidence added to "Status target".');
  });

  it("persists evidence plans on create and preserves them on metadata updates", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-evidence-plan",
      title: "Proof plan",
      goal: "Verify real browser behavior",
      success_criteria: ["Browser flow passes"],
      prerequisites: [],
      evidence_plan: [
        {
          id: "browser-proof",
          label: "Browser smoke proof",
          mechanism: "browser",
          description: "Run Playwright locally and capture screenshot/log evidence.",
          status: "planned",
        },
        {
          id: "file-proof",
          label: "File artifact proof",
          mechanism: "file",
          description: "Inspect a durable generated artifact file.",
          status: "ready",
          path: "artifacts/proof.json",
          evidence: "artifact schema captured",
        },
      ],
    });
    await executeGoals({
      action: "create",
      run_id: "goal-evidence-plan",
      title: "Proof plan updated",
      goal: "Verify real browser behavior",
      success_criteria: ["Browser flow passes"],
      prerequisites: [],
      verifier_command: "pnpm test:e2e",
    });

    const run = await getGoalRun(tmpProject, "goal-evidence-plan");

    expect(run?.evidencePlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-proof",
          mechanism: "browser",
          status: "planned",
        }),
        expect.objectContaining({
          id: "file-proof",
          mechanism: "file",
          status: "ready",
          path: "artifacts/proof.json",
        }),
      ]),
    );
    expect(run?.verifier?.command).toBe("pnpm test:e2e");
  });

  it("does not complete without passing verifier evidence", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-a",
      title: "Guard completion",
      goal: "Only complete after proof",
      success_criteria: ["Verifier passes"],
      prerequisites: [],
      verifier_command: "pnpm test",
    });

    const result = await executeGoals({ action: "complete", run_id: "goal-a" });
    const run = await getGoalRun(tmpProject, "goal-a");

    expect(result).toBe("Error: cannot complete goal: Goal has no verifier evidence.");
    expect(run?.status).toBe("ready");
  });

  it("records verifier pass as ready when tasks remain incomplete", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-a",
      title: "Guard verifier",
      goal: "Verifier pass alone is not enough",
      success_criteria: ["Task and verifier pass"],
      prerequisites: [],
      verifier_command: "pnpm test",
    });
    await executeGoals({
      action: "task",
      run_id: "goal-a",
      task_id: "task-a",
      task_title: "Pending work",
      task_prompt: "Do the work",
    });

    await executeGoals({
      action: "verify",
      run_id: "goal-a",
      verification_status: "pass",
      summary: "Verifier passed",
      exit_code: 0,
    });
    const run = await getGoalRun(tmpProject, "goal-a");

    expect(run?.status).toBe("ready");
    expect(run?.verifier?.lastResult?.status).toBe("pass");
  });

  it("clears stale transient blockers and marks passed when verifier pass satisfies planned evidence", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-blocked-after-pass",
      title: "Blocked after pass",
      goal: "Recover from stale verifier interruption",
      success_criteria: ["Verifier pass with durable evidence completes"],
      prerequisites: [],
      evidence_plan: [
        {
          id: "planned-command-proof",
          label: "Targeted regression tests",
          mechanism: "test",
          description: "Run the focused local regression command.",
          status: "planned",
          command: "pnpm vitest run src/core/goal-controller.test.ts",
        },
        {
          id: "planned-log-proof",
          label: "Verifier log artifact",
          mechanism: "log",
          description: "Persist the verifier output log.",
          status: "planned",
          path: ".goal-evidence/blocked-after-pass.log",
        },
      ],
      verifier_command: "pnpm vitest run src/core/goal-controller.test.ts",
    });
    await executeGoals({
      action: "task",
      run_id: "goal-blocked-after-pass",
      task_id: "task-a",
      task_title: "Done work",
      task_prompt: "Do the work",
      task_status: "done",
    });
    await upsertGoalRun(tmpProject, {
      id: "goal-blocked-after-pass",
      title: "Blocked after pass",
      goal: "Recover from stale verifier interruption",
      status: "blocked",
      blockers: ["Verifier was interrupted; rerun or continue the Goal to verify again."],
    });
    await executeGoals({
      action: "evidence",
      run_id: "goal-blocked-after-pass",
      evidence_kind: "log",
      evidence_label: "Verifier log artifact",
      evidence_path: ".goal-evidence/blocked-after-pass.log",
      evidence_content: "Verifier passed after interruption.",
    });

    const result = await executeGoals({
      action: "verify",
      run_id: "goal-blocked-after-pass",
      verification_status: "pass",
      summary: "Targeted regression tests passed and wrote Verifier log artifact.",
      verifier_command: "pnpm vitest run src/core/goal-controller.test.ts",
      exit_code: 0,
      output_path: ".goal-evidence/blocked-after-pass.log",
    });
    const run = await getGoalRun(tmpProject, "goal-blocked-after-pass");

    expect(result).toBe('Verifier recorded for "Blocked after pass": pass.');
    expect(run?.status).toBe("passed");
    expect(run?.blockers).toEqual([]);
    expect(run?.evidencePlan.map((item) => item.status)).toEqual(["planned", "planned"]);
    expect(run ? decideGoalNextAction(run) : null).toEqual({
      kind: "complete",
      reason: "All tasks are done and verifier evidence passed.",
    });
  });

  it("records verifier failure as persisted command evidence and keeps the run recoverable", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-a",
      title: "Verifier fails",
      goal: "Persist failure evidence",
      success_criteria: ["Verifier passes"],
      prerequisites: [],
      verifier_command: "pnpm test",
    });
    await executeGoals({
      action: "task",
      run_id: "goal-a",
      task_id: "task-a",
      task_title: "Done work",
      task_prompt: "Do the work",
      task_status: "done",
    });

    const result = await executeGoals({
      action: "verify",
      run_id: "goal-a",
      verification_status: "fail",
      summary: "expected failure output",
      exit_code: 1,
      output_path: "artifacts/verifier.log",
    });
    const run = await getGoalRun(tmpProject, "goal-a");

    expect(result).toBe('Verifier recorded for "Verifier fails": fail.');
    expect(run?.status).toBe("ready");
    expect(run?.verifier?.lastResult).toMatchObject({
      status: "fail",
      summary: "expected failure output",
      exitCode: 1,
      outputPath: "artifacts/verifier.log",
    });
    expect(run?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "command",
          label: "Verifier result",
          content: "expected failure output",
          path: "artifacts/verifier.log",
        }),
      ]),
    );
  });

  it("allows corrective next task to be added after verifier failure evidence", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-a",
      title: "Correct verifier failure",
      goal: "Create corrective task",
      success_criteria: ["Verifier passes"],
      prerequisites: [],
      verifier_command: "pnpm test",
    });
    await executeGoals({
      action: "verify",
      run_id: "goal-a",
      verification_status: "fail",
      summary: "failing assertion",
      exit_code: 1,
    });

    const result = await executeGoals({
      action: "task",
      run_id: "goal-a",
      task_id: "repair-a",
      task_title: "Repair verifier failure",
      task_prompt: "Use Verifier result evidence to fix failing assertion",
      task_status: "pending",
    });
    const run = await getGoalRun(tmpProject, "goal-a");

    expect(result).toBe('Goal task added: "Repair verifier failure".');
    expect(run?.status).toBe("ready");
    expect(run?.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repair-a",
          status: "pending",
          prompt: "Use Verifier result evidence to fix failing assertion",
        }),
      ]),
    );
    expect(run ? decideGoalNextAction(run) : null).toMatchObject({
      kind: "start_worker",
      task: expect.objectContaining({ id: "repair-a" }),
    });
  });

  it("records pause evidence after repeated non-progress", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-a",
      title: "Pause loop",
      goal: "Stop repeated non-progress",
      success_criteria: ["No infinite loop"],
      prerequisites: [],
    });
    await executeGoals({
      action: "task",
      run_id: "goal-a",
      task_id: "task-a",
      task_title: "Flaky work",
      task_prompt: "Try again",
      task_status: "failed",
      attempts: 6,
      summary: "same failure repeated",
    });
    await executeGoals({
      action: "evidence",
      run_id: "goal-a",
      evidence_kind: "summary",
      evidence_label: "Paused after repeated non-progress",
      evidence_content: "Attempt limit reached for Flaky work.",
    });

    const result = await executeGoals({ action: "pause", run_id: "goal-a" });
    const run = await getGoalRun(tmpProject, "goal-a");

    expect(result).toBe('Goal "Pause loop" is now paused.');
    expect(run?.status).toBe("paused");
    expect(run?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "summary",
          label: "Paused after repeated non-progress",
          content: "Attempt limit reached for Flaky work.",
        }),
      ]),
    );
  });

  it("resume-immediate records continuation intent and next action", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-resume",
      title: "Resume now",
      goal: "Continue",
      prerequisites: [],
    });
    await executeGoals({
      action: "task",
      run_id: "goal-resume",
      task_id: "task-a",
      task_title: "Work",
      task_prompt: "Do it",
    });

    const result = await executeGoals({ action: "resume", run_id: "goal-resume" });
    const run = await getGoalRun(tmpProject, "goal-resume");

    expect(result).toBe('Goal "Resume now" resume requested; next action: start_worker.');
    expect(run?.status).toBe("ready");
    expect(run?.continueRequestedAt).toBeTruthy();
    expect(run?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Goal resume requested" }),
        expect.objectContaining({ label: "Goal decision: resume" }),
      ]),
    );
  });

  it("resume-queued-behind-active-worker persists continuation intent", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-queued",
      title: "Queued resume",
      goal: "Continue later",
      prerequisites: [],
    });
    await executeGoals({
      action: "task",
      run_id: "goal-queued",
      task_id: "task-a",
      task_title: "Work",
      task_prompt: "Do it",
      task_status: "running",
      worker_id: "worker-a",
    });

    const result = await executeGoals({ action: "resume", run_id: "goal-queued" });
    const run = await getGoalRun(tmpProject, "goal-queued");

    expect(result).toBe('Goal "Queued resume" resume queued: Goal task "Work" is already running.');
    expect(run?.continueRequestedAt).toBeTruthy();
    expect(run?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Goal resume requested" }),
        expect.objectContaining({ label: "Goal decision: resume" }),
      ]),
    );
  });

  it("resume-blocked-prerequisite keeps exact missing instructions", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-blocked",
      title: "Blocked resume",
      goal: "Needs input",
      prerequisites: [
        { id: "key", label: "API key", status: "missing", instructions: "Set API_KEY locally." },
      ],
    });

    const result = await executeGoals({ action: "resume", run_id: "goal-blocked" });
    const run = await getGoalRun(tmpProject, "goal-blocked");

    expect(result).toBe('Goal "Blocked resume" resume blocked: API key: Set API_KEY locally.');
    expect(run?.status).toBe("blocked");
    expect(run?.blockers).toContain("API key: Set API_KEY locally.");
    expect(run?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Goal resume blocked",
          content: "API key: Set API_KEY locally.",
        }),
      ]),
    );
  });

  it("allows completion after all tasks are done and verifier passes", async () => {
    await executeGoals({
      action: "create",
      run_id: "goal-a",
      title: "Complete safely",
      goal: "Complete after proof",
      success_criteria: ["Task and verifier pass"],
      prerequisites: [],
      verifier_command: "pnpm test",
    });
    await executeGoals({
      action: "task",
      run_id: "goal-a",
      task_id: "task-a",
      task_title: "Done work",
      task_prompt: "Do the work",
      task_status: "done",
    });
    await executeGoals({
      action: "verify",
      run_id: "goal-a",
      verification_status: "pass",
      summary: "Verifier passed",
      exit_code: 0,
    });

    const result = await executeGoals({ action: "complete", run_id: "goal-a" });
    const run = await getGoalRun(tmpProject, "goal-a");

    expect(result).toBe('Goal "Complete safely" is now passed.');
    expect(run?.status).toBe("passed");
  });
});
