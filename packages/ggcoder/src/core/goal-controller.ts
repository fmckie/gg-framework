import {
  formatGoalBlockingPrerequisites,
  goalHasBlockingPrerequisites,
  type GoalRun,
  type GoalTask,
} from "./goal-store.js";

export const DEFAULT_GOAL_TASK_ATTEMPT_LIMIT = 5;
export const DEFAULT_GOAL_VERIFIER_FIX_LIMIT = 5;

export type GoalControllerDecision =
  | {
      kind: "blocked";
      reason: string;
    }
  | {
      kind: "create_task";
      title: string;
      prompt: string;
      reason: string;
    }
  | {
      kind: "terminal";
      reason: string;
      status: "blocked" | "failed" | "passed" | "paused";
    }
  | {
      kind: "wait";
      reason: string;
      workerId?: string;
    }
  | {
      kind: "start_worker";
      task: GoalTask;
      attempts: number;
      reason: string;
    }
  | {
      kind: "pause";
      task: GoalTask;
      attempts: number;
      reason: string;
    }
  | {
      kind: "run_verifier";
      command: string;
      reason: string;
    }
  | {
      kind: "complete";
      reason: string;
    };

export interface GoalCompletionCheck {
  ok: boolean;
  reason: string;
}

export interface GoalControllerOptions {
  taskAttemptLimit?: number;
  verifierFixLimit?: number;
}

function needsHarnessInstrumentation(run: GoalRun): boolean {
  return run.harness.some((item) => !item.command && !item.path);
}

function buildHarnessTaskPrompt(run: GoalRun): string {
  const harnessItems = run.harness
    .filter((item) => !item.command && !item.path)
    .map((item) => `- ${item.label}: ${item.description ?? "Create local instrumentation."}`)
    .join("\n");
  return (
    `Goal: ${run.goal}\n\n` +
    `Build only the missing local/free harness instrumentation needed before verification. Start by restating the intended experience, the relevant failure modes, and the senses/signals this harness must observe; do not default to generic tests, scripts, screenshots, benchmarks, or simulations unless that signal is required for this specific goal.\n` +
    `${harnessItems}\n\n` +
    `Inventory available local capabilities just deeply enough to choose a proportional instrument, then build it. Update the Goal harness/verifier metadata with the goals tool and record durable evidence showing the instrument exists and works. Do not require paid services or signups; block only with exact user instructions if a true external prerequisite is missing.`
  );
}

function blockedEvidencePlanReason(run: GoalRun): string | undefined {
  const blocked = run.evidencePlan.find((item) => item.status === "blocked");
  if (!blocked) return undefined;
  return `${blocked.label}: ${blocked.instructions?.trim() || "User must provide this evidence prerequisite."}`;
}

function needsEvidenceInstrumentation(run: GoalRun): boolean {
  return run.evidencePlan.some((item) => item.status === "planned");
}

function evidencePlanItemSatisfiedByDurableEvidence(
  run: GoalRun,
  item: GoalRun["evidencePlan"][number],
): boolean {
  if (item.status === "ready") return true;
  if (item.evidence?.trim()) return true;

  const verifier = run.verifier?.lastResult;
  if (verifier?.status === "pass") {
    if (item.command && verifier.command === item.command) return true;
    if (item.path && verifier.outputPath === item.path) return true;
    const haystack =
      `${verifier.command ?? ""}\n${verifier.outputPath ?? ""}\n${verifier.summary}`.toLowerCase();
    const needles = [item.label, item.description, item.command, item.path]
      .filter((value): value is string => !!value?.trim())
      .map((value) => value.toLowerCase());
    if (needles.some((needle) => haystack.includes(needle))) return true;
  }
  return run.evidence.some((evidence) => {
    if (item.path && evidence.path === item.path) return true;
    const haystack =
      `${evidence.label}\n${evidence.path ?? ""}\n${evidence.content ?? ""}`.toLowerCase();
    return [item.label, item.description, item.command, item.path]
      .filter((value): value is string => !!value?.trim())
      .map((value) => value.toLowerCase())
      .some((needle) => haystack.includes(needle));
  });
}

export function hasRequiredGoalEvidence(run: GoalRun): GoalCompletionCheck {
  const missing = run.evidencePlan.filter(
    (item) => !evidencePlanItemSatisfiedByDurableEvidence(run, item),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Goal evidence plan is not satisfied: ${missing.map((item) => item.label).join(", ")}.`,
    };
  }
  return {
    ok: true,
    reason: "All required evidence-plan items are ready or proven by durable evidence.",
  };
}

function buildEvidencePlanTaskPrompt(run: GoalRun): string {
  const plannedItems = run.evidencePlan
    .filter((item) => item.status === "planned")
    .map(
      (item) =>
        `- ${item.label} (${item.mechanism}): ${item.description}${item.command ? `; candidate command: ${item.command}` : ""}${item.path ? `; artifact: ${item.path}` : ""}`,
    )
    .join("\n");
  return (
    `Goal: ${run.goal}\n\n` +
    `Turn the planned proof paths below into real local/free verification capability before the Goal verifier runs. For each path, preserve the orchestrator's goal-specific sensory intent: what experience is being observed, what failure it catches, and what signal proves it.\n` +
    `${plannedItems}\n\n` +
    `Inventory available local capabilities without anchoring on any fixed tool category. Build only the proportional instrument needed for this proof path, update the Goal evidence_plan/harness/verifier metadata with the goals tool, and persist concrete command/file/artifact/log evidence that the instrument works. Do not use narrative-only verification or human visual inspection as completion evidence. Only block with exact user instructions for inputs that cannot be generated or checked locally.`
  );
}

function buildVerifierTaskPrompt(run: GoalRun): string {
  return (
    `Goal: ${run.goal}\n\n` +
    `Define and build a real end-to-end verifier for this Goal. Begin from the intended experience and required senses/signals already implied by the success criteria and evidence plan. Choose a proportional local/free verifier that observes those signals and catches the important goal-specific failures; do not add generic simulations, screenshots, benchmarks, or scripts unless they directly support that proof. Update the Goal with a verifier_command and verifier_description using the goals tool. The verifier must be runnable locally/free and produce durable command or file evidence, not narrative or human visual inspection. If an external prerequisite is missing, mark it missing with exact user instructions.`
  );
}

function incompleteTasks(run: GoalRun): GoalTask[] {
  return run.tasks.filter((task) => task.status !== "done");
}

function activeTask(run: GoalRun): GoalTask | undefined {
  return run.tasks.find((task) => task.status === "running" || task.status === "verifying");
}

function nextRunnableTask(run: GoalRun): GoalTask | undefined {
  return run.tasks.find((task) => task.status === "pending" || task.status === "failed");
}

export function canCompleteGoalRun(run: GoalRun): GoalCompletionCheck {
  if (goalHasBlockingPrerequisites(run)) {
    return { ok: false, reason: formatGoalBlockingPrerequisites(run) };
  }

  const remainingTasks = incompleteTasks(run);
  if (remainingTasks.length > 0) {
    return {
      ok: false,
      reason: `${remainingTasks.length} Goal task${remainingTasks.length === 1 ? " is" : "s are"} not done.`,
    };
  }

  const requiredEvidence = hasRequiredGoalEvidence(run);
  if (!requiredEvidence.ok) return requiredEvidence;

  const verifierResult = run.verifier?.lastResult;
  if (!verifierResult) {
    return { ok: false, reason: "Goal has no verifier evidence." };
  }
  if (verifierResult.status !== "pass") {
    return { ok: false, reason: `Verifier status is ${verifierResult.status}.` };
  }

  return { ok: true, reason: "All tasks are done and verifier evidence passed." };
}

export function shouldClearGoalContinuation(decision: GoalControllerDecision): boolean {
  return decision.kind !== "wait";
}

export function shouldCreateVerifierFixTask(
  run: GoalRun,
  limit = DEFAULT_GOAL_VERIFIER_FIX_LIMIT,
): boolean {
  return run.tasks.filter((task) => task.title === "Fix verifier failure").length < limit;
}

export function verifierFixTaskCount(run: GoalRun): number {
  return run.tasks.filter((task) => task.title === "Fix verifier failure").length;
}

export function hasRepeatedVerifierFailure(run: GoalRun, repeatLimit = 2): boolean {
  const failures = run.evidence
    .filter((item) => item.label === "Verifier fail" || item.label === "Verifier result")
    .map((item) => (item.content ?? "").trim())
    .filter(Boolean);
  if (failures.length < repeatLimit) return false;
  const last = failures[failures.length - 1];
  return failures.slice(-repeatLimit).every((item) => item === last);
}

function buildVerifierFailureTaskPrompt(run: GoalRun): string {
  const result = run.verifier?.lastResult;
  const priorSummaries =
    run.evidence
      .filter((item) => item.label.startsWith("Verifier"))
      .slice(-3)
      .map(
        (item) =>
          `- ${item.label}${item.path ? ` (${item.path})` : ""}: ${(item.content ?? "").slice(0, 500)}`,
      )
      .join("\n") || "- none";
  const attempt = verifierFixTaskCount(run) + 1;
  return (
    `Original objective: ${run.goal}\n\n` +
    `Success criteria:\n${run.successCriteria.map((item) => `- ${item}`).join("\n") || "- none recorded"}\n\n` +
    `Verifier command: ${run.verifier?.command ?? "(missing)"}\n` +
    `Exit code: ${result?.exitCode ?? "unknown"}\n` +
    `Output path: ${result?.outputPath ?? "not recorded"}\n` +
    `Fix attempt ${attempt}/${DEFAULT_GOAL_VERIFIER_FIX_LIMIT}.\n\n` +
    `Prior verifier summaries:\n${priorSummaries}\n\n` +
    `Run targeted diagnostics, fix the root cause, update durable Goal evidence with the goals tool, and rerun the exact verifier command. Do not mark the Goal complete.`
  );
}

export function formatGoalControllerDecision(decision: GoalControllerDecision): {
  label: string;
  content: string;
} {
  const parts = [`kind=${decision.kind}`];
  if ("reason" in decision) parts.push(`reason=${decision.reason}`);
  if (decision.kind === "start_worker" || decision.kind === "pause") {
    parts.push(
      `task=${decision.task.id}`,
      `title=${decision.task.title}`,
      `attempts=${decision.attempts}`,
    );
    if (decision.task.workerId) parts.push(`worker=${decision.task.workerId}`);
  }
  if (decision.kind === "wait" && decision.workerId) parts.push(`worker=${decision.workerId}`);
  if (decision.kind === "run_verifier") parts.push(`verifier=${decision.command}`);
  if (decision.kind === "terminal") parts.push(`status=${decision.status}`);
  if (decision.kind === "create_task") parts.push(`title=${decision.title}`);
  return { label: `Goal decision: ${decision.kind}`, content: parts.join("; ") };
}

export function decideGoalNextAction(
  run: GoalRun,
  options: GoalControllerOptions = {},
): GoalControllerDecision {
  const completion = canCompleteGoalRun(run);
  if (completion.ok) {
    return { kind: "complete", reason: completion.reason };
  }

  if (
    run.status === "blocked" ||
    run.status === "failed" ||
    run.status === "passed" ||
    (run.status === "paused" && !run.continueRequestedAt)
  ) {
    return { kind: "terminal", status: run.status, reason: `Goal is ${run.status}.` };
  }

  if (goalHasBlockingPrerequisites(run)) {
    return { kind: "blocked", reason: formatGoalBlockingPrerequisites(run) };
  }

  if (run.activeWorkerId) {
    return {
      kind: "wait",
      reason: "Goal already has an active worker.",
      workerId: run.activeWorkerId,
    };
  }

  const runningTask = activeTask(run);
  if (runningTask) {
    return {
      kind: "wait",
      reason: `Goal task "${runningTask.title}" is already ${runningTask.status}.`,
      ...(runningTask.workerId ? { workerId: runningTask.workerId } : {}),
    };
  }

  const task = nextRunnableTask(run);
  if (task) {
    const attempts = task.attempts + 1;
    const limit = options.taskAttemptLimit ?? DEFAULT_GOAL_TASK_ATTEMPT_LIMIT;
    if (attempts > limit) {
      return {
        kind: "pause",
        task,
        attempts,
        reason: `Attempt limit reached for task ${task.title}.`,
      };
    }
    return {
      kind: "start_worker",
      task,
      attempts,
      reason: `Goal task "${task.title}" is ready for worker attempt ${attempts}.`,
    };
  }

  const blockedEvidence = blockedEvidencePlanReason(run);
  if (blockedEvidence) {
    return { kind: "blocked", reason: blockedEvidence };
  }

  if (needsEvidenceInstrumentation(run)) {
    if (run.verifier?.lastResult?.status === "pass") {
      return {
        kind: "blocked",
        reason:
          "Verifier passed, but the Goal evidence plan is still not satisfied; blocking instead of creating repeated evidence-path workers.",
      };
    }
    return {
      kind: "create_task",
      title: "Build Goal evidence path",
      prompt: buildEvidencePlanTaskPrompt(run),
      reason:
        "Goal evidence plan requires local instrumentation or exact prerequisite handling before verification.",
    };
  }

  if (needsHarnessInstrumentation(run)) {
    return {
      kind: "create_task",
      title: "Build Goal verification harness",
      prompt: buildHarnessTaskPrompt(run),
      reason: "Goal harness requires local instrumentation before verification.",
    };
  }

  if (run.verifier?.lastResult?.status === "fail") {
    if (hasRepeatedVerifierFailure(run)) {
      return {
        kind: "blocked",
        reason:
          "Verifier produced the same failure repeatedly; pause for diagnosis before creating more fix tasks.",
      };
    }
    const limit = options.verifierFixLimit ?? DEFAULT_GOAL_VERIFIER_FIX_LIMIT;
    if (shouldCreateVerifierFixTask(run, limit)) {
      return {
        kind: "create_task",
        title: "Fix verifier failure",
        prompt: buildVerifierFailureTaskPrompt(run),
        reason: `Verifier failed; creating bounded fix task ${verifierFixTaskCount(run) + 1}/${limit}.`,
      };
    }
    return {
      kind: "pause",
      task: {
        id: "verifier-fix-limit",
        title: "Fix verifier failure",
        prompt: "Verifier fix attempt limit reached.",
        status: "blocked",
        attempts: limit,
      },
      attempts: limit,
      reason: `Verifier fix task limit reached (${limit}).`,
    };
  }

  if (run.verifier?.command) {
    return {
      kind: "run_verifier",
      command: run.verifier.command,
      reason: "All Goal tasks are done; running configured verifier for real completion evidence.",
    };
  }

  return {
    kind: "create_task",
    title: "Define Goal verifier",
    prompt: buildVerifierTaskPrompt(run),
    reason: "No pending Goal task or verifier command is configured.",
  };
}
