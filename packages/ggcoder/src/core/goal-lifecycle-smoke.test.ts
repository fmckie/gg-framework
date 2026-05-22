import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolExecuteResult } from "@kenkaiiii/gg-agent";
import { decideGoalNextAction, canCompleteGoalRun } from "./goal-controller.js";
import { getGoalRun, loadGoalRuns } from "./goal-store.js";
import { createGoalsTool } from "../tools/goals.js";

let tmpBase: string;
let tmpProject: string;

async function goals(
  args: Parameters<ReturnType<typeof createGoalsTool>["execute"]>[0],
): Promise<ToolExecuteResult> {
  return createGoalsTool(tmpProject).execute(args, {
    signal: new AbortController().signal,
    toolCallId: "goal-lifecycle-smoke",
  });
}

async function run() {
  const current = await getGoalRun(tmpProject, "smoke-goal");
  expect(current, "smoke goal should be persisted before inspection").toBeTruthy();
  return current!;
}

beforeEach(async () => {
  tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "goal-lifecycle-smoke-base-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "goal-lifecycle-smoke-project-"));
  process.env.GG_GOALS_BASE = tmpBase;
});

afterEach(async () => {
  delete process.env.GG_GOALS_BASE;
  await fs.rm(tmpBase, { recursive: true, force: true });
  await fs.rm(tmpProject, { recursive: true, force: true });
});

describe("goal lifecycle smoke", () => {
  it("persists and drives a mini Goal lifecycle from planned proof through corrective verification to completion", async () => {
    await goals({
      action: "create",
      run_id: "smoke-goal",
      title: "Lifecycle smoke",
      goal: "Prove deterministic Goal lifecycle behavior in local temp storage",
      success_criteria: [
        "pending task completes",
        "verifier failure produces repair",
        "verifier pass gates completion",
      ],
      prerequisites: [
        { id: "local", label: "Local temp project", status: "met", evidence: tmpProject },
      ],
      harness: [
        {
          id: "local-harness",
          label: "Local smoke harness",
          command: "node ./scripts/goal-smoke.js",
          path: "scripts/goal-smoke.js",
          description: "Temp-only deterministic smoke harness metadata",
        },
      ],
      evidence_plan: [
        {
          id: "state-proof",
          label: "Persisted state proof",
          mechanism: "test",
          description: "Vitest asserts transitions and JSON persistence",
          status: "ready",
          command: "pnpm --filter @kenkaiiii/ggcoder test -- goal-lifecycle-smoke",
          path: "packages/ggcoder/src/core/goal-lifecycle-smoke.test.ts",
          evidence: "This test inspects persisted Goal state after each tool call.",
        },
      ],
      verifier_command: "pnpm --filter @kenkaiiii/ggcoder test -- goal-lifecycle-smoke",
      verifier_description: "Focused local Vitest lifecycle smoke",
    });
    await goals({
      action: "task",
      run_id: "smoke-goal",
      task_id: "implement-smoke",
      task_title: "Implement smoke target",
      task_prompt: "Create the local smoke target and persist evidence.",
      task_status: "pending",
    });

    let persisted = await run();
    expect(decideGoalNextAction(persisted)).toMatchObject({ kind: "start_worker", attempts: 1 });
    expect(persisted.harness).toEqual([
      expect.objectContaining({ id: "local-harness", command: expect.any(String) }),
    ]);
    expect(persisted.evidencePlan).toEqual([
      expect.objectContaining({ id: "state-proof", status: "ready" }),
    ]);
    expect((await loadGoalRuns(tmpProject)).map((item) => item.id)).toContain("smoke-goal");

    await goals({
      action: "task",
      run_id: "smoke-goal",
      task_id: "implement-smoke",
      task_title: "Implement smoke target",
      task_prompt: "Create the local smoke target and persist evidence.",
      task_status: "done",
      attempts: 1,
      summary: "Initial task done with local fixture evidence.",
    });
    await goals({
      action: "evidence",
      run_id: "smoke-goal",
      evidence_kind: "file",
      evidence_label: "Local fixture artifact",
      evidence_path: "tmp/goal-smoke-fixture.json",
      evidence_content: "fixture persisted in temp-only smoke flow",
    });

    persisted = await run();
    expect(decideGoalNextAction(persisted)).toEqual({
      kind: "run_verifier",
      command: "pnpm --filter @kenkaiiii/ggcoder test -- goal-lifecycle-smoke",
      reason: "All Goal tasks are done; running configured verifier for real completion evidence.",
    });
    expect(persisted.tasks).toEqual([
      expect.objectContaining({
        id: "implement-smoke",
        status: "done",
        lastSummary: "Initial task done with local fixture evidence.",
      }),
    ]);
    expect(persisted.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Local fixture artifact",
          path: "tmp/goal-smoke-fixture.json",
        }),
      ]),
    );

    await goals({
      action: "verify",
      run_id: "smoke-goal",
      verification_status: "fail",
      summary: "intentional first verifier failure",
      exit_code: 1,
      output_path: "artifacts/goal-lifecycle-smoke-fail.log",
    });
    await goals({
      action: "task",
      run_id: "smoke-goal",
      task_id: "repair-verifier",
      task_title: "Fix verifier failure",
      task_prompt: "Use persisted verifier evidence to repair the smoke flow.",
      task_status: "pending",
    });

    persisted = await run();
    expect(persisted.status).toBe("ready");
    expect(persisted.verifier?.lastResult).toMatchObject({
      status: "fail",
      exitCode: 1,
      outputPath: "artifacts/goal-lifecycle-smoke-fail.log",
    });
    expect(persisted.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "command",
          label: "Verifier result",
          content: "intentional first verifier failure",
        }),
      ]),
    );
    expect(decideGoalNextAction(persisted)).toMatchObject({
      kind: "start_worker",
      task: expect.objectContaining({ id: "repair-verifier" }),
      attempts: 1,
    });

    await goals({
      action: "task",
      run_id: "smoke-goal",
      task_id: "repair-verifier",
      task_title: "Fix verifier failure",
      task_prompt: "Use persisted verifier evidence to repair the smoke flow.",
      task_status: "done",
      attempts: 1,
      summary: "Corrective task completed.",
    });
    await goals({
      action: "verify",
      run_id: "smoke-goal",
      verification_status: "pass",
      summary: "focused lifecycle smoke passed",
      exit_code: 0,
      output_path: "artifacts/goal-lifecycle-smoke-pass.log",
    });

    persisted = await run();
    expect(canCompleteGoalRun(persisted)).toEqual({
      ok: true,
      reason: "All tasks are done and verifier evidence passed.",
    });
    expect(decideGoalNextAction({ ...persisted, status: "ready" })).toEqual({
      kind: "complete",
      reason: "All tasks are done and verifier evidence passed.",
    });
    expect(await goals({ action: "complete", run_id: "smoke-goal" })).toBe(
      'Goal "Lifecycle smoke" is now passed.',
    );

    persisted = await run();
    expect(persisted.status).toBe("passed");
    expect(decideGoalNextAction(persisted)).toEqual({
      kind: "complete",
      reason: "All tasks are done and verifier evidence passed.",
    });
    expect(persisted.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Local fixture artifact" }),
        expect.objectContaining({
          label: "Verifier result",
          content: "intentional first verifier failure",
        }),
        expect.objectContaining({
          label: "Verifier result",
          content: "focused lifecycle smoke passed",
        }),
      ]),
    );
  });
});
