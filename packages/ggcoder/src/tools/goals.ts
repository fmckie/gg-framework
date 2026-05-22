import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { log } from "../core/logger.js";
import { canCompleteGoalRun, decideGoalNextAction } from "../core/goal-controller.js";
import {
  appendGoalDecision,
  appendGoalEvidence,
  createGoalEvidence,
  formatGoalBlockingPrerequisiteList,
  formatGoalBlockingPrerequisites,
  getActiveGoalRun,
  getGoalRun,
  goalHasBlockingPrerequisites,
  loadGoalRuns,
  upsertGoalRun,
  updateGoalTask,
  type GoalEvidenceKind,
  type GoalEvidenceMechanism,
  type GoalPrerequisiteStatus,
  type GoalRun,
  type GoalRunStatus,
  type GoalTaskStatus,
  type GoalVerificationStatus,
} from "../core/goal-store.js";

const PrerequisiteInput = z.object({
  id: z.string().optional().describe("Stable prerequisite id"),
  label: z.string().describe("Human-readable prerequisite label"),
  status: z.enum(["unknown", "met", "missing"]).optional(),
  check_command: z.string().optional().describe("Optional command used to check this prerequisite"),
  instructions: z.string().optional().describe("What the user must provide when missing"),
  evidence: z.string().optional().describe("Short evidence, never secret values"),
});

const HarnessInput = z.object({
  id: z.string().optional().describe("Stable harness item id"),
  label: z.string().describe("Harness/diagnostic label"),
  command: z.string().optional().describe("Command that runs this harness item"),
  path: z.string().optional().describe("File path for a harness artifact"),
  description: z.string().optional().describe("What this harness observes or verifies"),
});

const EvidencePlanInput = z.object({
  id: z.string().optional().describe("Stable evidence-plan item id"),
  label: z.string().describe("Short evidence path label"),
  mechanism: z
    .enum([
      "command",
      "test",
      "script",
      "fixture",
      "log",
      "screenshot",
      "video",
      "browser",
      "device",
      "source",
      "file",
      "manual",
    ])
    .describe("How this proof will be gathered"),
  description: z.string().describe("What this evidence proves"),
  status: z.enum(["planned", "ready", "blocked"]).optional(),
  command: z.string().optional().describe("Runnable command when available"),
  path: z.string().optional().describe("Artifact path when available"),
  instructions: z.string().optional().describe("Exact user instructions when blocked"),
  evidence: z.string().optional().describe("Observed evidence summary when ready"),
});

const GoalsParams = z.object({
  action: z
    .enum([
      "create",
      "prerequisite",
      "task",
      "evidence",
      "verify",
      "status",
      "pause",
      "resume",
      "complete",
    ])
    .describe("Goal action to perform"),
  run_id: z.string().optional().describe("Goal run id; omitted actions use the active/latest run"),
  title: z.string().optional().describe("Goal or task title"),
  goal: z.string().optional().describe("Original user objective for create"),
  success_criteria: z
    .array(z.string())
    .optional()
    .describe("Concrete criteria that must be proven before completion"),
  prerequisites: z
    .array(PrerequisiteInput)
    .optional()
    .describe("Prerequisites that must be met before launching workers"),
  prerequisite_id: z.string().optional().describe("Prerequisite id to update"),
  prerequisite_status: z
    .enum(["unknown", "met", "missing"])
    .optional()
    .describe("Updated prerequisite status"),
  prerequisite_label: z.string().optional().describe("Label for an added/updated prerequisite"),
  instructions: z.string().optional().describe("User-facing instructions for missing prerequisite"),
  harness: z.array(HarnessInput).optional().describe("Harness/diagnostic commands and files"),
  evidence_plan: z
    .array(EvidencePlanInput)
    .optional()
    .describe("Planned proof paths for end-to-end verification"),
  verifier_command: z.string().optional().describe("Command that verifies the goal end-to-end"),
  verifier_description: z.string().optional().describe("Natural-language verifier description"),
  task_id: z.string().optional().describe("Goal task id to update"),
  task_title: z.string().optional().describe("Short worker task title"),
  task_prompt: z
    .string()
    .optional()
    .describe("Standalone prompt for a disposable Goal worker in this same project"),
  task_status: z
    .enum(["pending", "running", "verifying", "done", "failed", "blocked"])
    .optional()
    .describe("Goal task status"),
  worker_id: z.string().optional().describe("Worker id associated with a task"),
  attempts: z.number().int().min(0).optional().describe("Task attempt count"),
  summary: z.string().optional().describe("Short summary or verification note"),
  evidence_kind: z
    .enum(["log", "command", "screenshot", "file", "summary"])
    .optional()
    .describe("Evidence kind"),
  evidence_label: z.string().optional().describe("Evidence label"),
  evidence_path: z.string().optional().describe("Evidence file/log/screenshot path"),
  evidence_content: z.string().optional().describe("Short evidence content"),
  verification_status: z
    .enum(["pass", "fail", "unknown"])
    .optional()
    .describe("Verifier result status"),
  exit_code: z.number().int().optional().describe("Verifier command exit code"),
  output_path: z.string().optional().describe("Path to verifier output/log"),
  blockers: z.array(z.string()).optional().describe("Current blockers"),
});

function asPrerequisiteStatus(value: string | undefined): GoalPrerequisiteStatus {
  if (value === "met" || value === "missing" || value === "unknown") return value;
  return "unknown";
}

function asTaskStatus(value: string | undefined): GoalTaskStatus {
  if (
    value === "pending" ||
    value === "running" ||
    value === "verifying" ||
    value === "done" ||
    value === "failed" ||
    value === "blocked"
  ) {
    return value;
  }
  return "pending";
}

function asEvidenceKind(value: string | undefined): GoalEvidenceKind {
  if (
    value === "log" ||
    value === "command" ||
    value === "screenshot" ||
    value === "file" ||
    value === "summary"
  ) {
    return value;
  }
  return "summary";
}

function asEvidenceMechanism(value: string | undefined): GoalEvidenceMechanism {
  if (
    value === "command" ||
    value === "test" ||
    value === "script" ||
    value === "fixture" ||
    value === "log" ||
    value === "screenshot" ||
    value === "video" ||
    value === "browser" ||
    value === "device" ||
    value === "source" ||
    value === "file" ||
    value === "manual"
  ) {
    return value;
  }
  return "command";
}

function asVerificationStatus(value: string | undefined): GoalVerificationStatus {
  if (value === "pass" || value === "fail" || value === "unknown") return value;
  return "unknown";
}

function formatRun(run: GoalRun): string {
  const prereqs = run.prerequisites.length
    ? `${run.prerequisites.filter((item) => item.status === "met").length}/${run.prerequisites.length} prereqs met`
    : "no prereqs";
  const tasks = run.tasks.length
    ? `${run.tasks.filter((item) => item.status === "done").length}/${run.tasks.length} tasks done`
    : "no tasks";
  const verifier = run.verifier?.lastResult
    ? `verifier ${run.verifier.lastResult.status}`
    : run.verifier?.command
      ? "verifier configured"
      : "no verifier";
  const blocker = goalHasBlockingPrerequisites(run)
    ? `\nUser prerequisites: ${formatGoalBlockingPrerequisites(run)}`
    : "";
  return `[${run.status}] ${run.title} (id: ${run.id.slice(0, 8)}) — ${prereqs}, ${tasks}, ${verifier}${blocker}`;
}

function recoverableTaskStatus(status: GoalTaskStatus): boolean {
  return status === "pending" || status === "failed";
}

function statusAfterTaskPatch(run: GoalRun, status: GoalTaskStatus): GoalRunStatus {
  if (run.status !== "failed" || !recoverableTaskStatus(status)) return run.status;
  return goalHasBlockingPrerequisites(run) ? "blocked" : "ready";
}

async function resolveRun(cwd: string, id?: string): Promise<GoalRun | null> {
  if (id) return getGoalRun(cwd, id);
  return getActiveGoalRun(cwd);
}

export function createGoalsTool(cwd: string): AgentTool<typeof GoalsParams> {
  return {
    name: "goals",
    description:
      "Manage durable Goal runs for /goal and Ctrl+G workflows. Use this instead of tasks when the user wants a programmatic goal loop: define success criteria first, check prerequisites before launching workers, persist harness/diagnostics/evidence, add standalone worker tasks, and only mark the goal complete when verifier evidence proves the original objective. Do not require paid services or signups without recording a blocker and asking the user for the missing prerequisite.",
    parameters: GoalsParams,
    executionMode: "sequential",
    async execute(args) {
      switch (args.action) {
        case "create": {
          if (!args.title) return "Error: title is required for create.";
          if (!args.goal) return "Error: goal is required for create.";
          const existing = args.run_id ? await getGoalRun(cwd, args.run_id) : null;
          const prerequisites = args.prerequisites?.map((item) => ({
            id: item.id ?? randomUUID(),
            label: item.label,
            status: asPrerequisiteStatus(item.status),
            ...(item.check_command ? { checkCommand: item.check_command } : {}),
            ...(item.instructions ? { instructions: item.instructions } : {}),
            ...(item.evidence ? { evidence: item.evidence } : {}),
          }));
          const harness = args.harness?.map((item) => ({
            id: item.id ?? randomUUID(),
            label: item.label,
            ...(item.command ? { command: item.command } : {}),
            ...(item.path ? { path: item.path } : {}),
            ...(item.description ? { description: item.description } : {}),
          }));
          const evidencePlan = args.evidence_plan?.map((item) => ({
            id: item.id ?? randomUUID(),
            label: item.label,
            mechanism: asEvidenceMechanism(item.mechanism),
            description: item.description,
            status: item.status ?? "planned",
            ...(item.command ? { command: item.command } : {}),
            ...(item.path ? { path: item.path } : {}),
            ...(item.instructions ? { instructions: item.instructions } : {}),
            ...(item.evidence ? { evidence: item.evidence } : {}),
          }));
          const verifier =
            args.verifier_command || args.verifier_description
              ? {
                  description:
                    args.verifier_description ?? existing?.verifier?.description ?? "Goal verifier",
                  ...((args.verifier_command ?? existing?.verifier?.command)
                    ? { command: args.verifier_command ?? existing?.verifier?.command }
                    : {}),
                  ...(existing?.verifier?.lastResult
                    ? { lastResult: existing.verifier.lastResult }
                    : {}),
                }
              : existing?.verifier;
          const nextPrerequisites = prerequisites ?? existing?.prerequisites ?? [];
          const missingPrerequisites = formatGoalBlockingPrerequisiteList(nextPrerequisites);
          const hasBlockingPrerequisites =
            missingPrerequisites !== "Goal has no missing user prerequisites.";
          const run = await upsertGoalRun(cwd, {
            ...(args.run_id ? { id: args.run_id } : {}),
            title: args.title,
            goal: args.goal,
            status: hasBlockingPrerequisites ? "blocked" : (existing?.status ?? "ready"),
            successCriteria: args.success_criteria ?? existing?.successCriteria ?? [],
            prerequisites: nextPrerequisites,
            harness: harness ?? existing?.harness ?? [],
            evidencePlan: evidencePlan ?? existing?.evidencePlan ?? [],
            ...(verifier ? { verifier } : {}),
            blockers: hasBlockingPrerequisites
              ? Array.from(
                  new Set([...(args.blockers ?? existing?.blockers ?? []), missingPrerequisites]),
                )
              : (args.blockers ?? []),
          });
          await appendGoalDecision(cwd, run.id, {
            kind: args.run_id ? "update" : "create",
            reason: `criteria=${run.successCriteria.length}; prerequisites=${run.prerequisites.length}; harness=${run.harness.length}; evidence_plan=${run.evidencePlan.length}; verifier=${run.verifier?.command ? "configured" : "missing"}`,
          });
          log("INFO", "goals", `Goal created: ${run.title}`, { id: run.id, status: run.status });
          return goalHasBlockingPrerequisites(run)
            ? `Goal ${args.run_id ? "updated" : "created"}: "${run.title}" (id: ${run.id.slice(0, 8)}, ${run.status}). User prerequisites: ${formatGoalBlockingPrerequisites(run)}`
            : `Goal ${args.run_id ? "updated" : "created"}: "${run.title}" (id: ${run.id.slice(0, 8)}, ${run.status})`;
        }

        case "status": {
          if (args.run_id) {
            const run = await getGoalRun(cwd, args.run_id);
            return run ? formatRun(run) : `Error: no goal found matching id "${args.run_id}".`;
          }
          const runs = await loadGoalRuns(cwd);
          if (runs.length === 0) return "No goals.";
          return runs.map(formatRun).join("\n");
        }

        case "prerequisite": {
          const run = await resolveRun(cwd, args.run_id);
          if (!run) return "Error: no active goal run found.";
          const prereqId = args.prerequisite_id;
          if (!prereqId && !args.prerequisite_label) {
            return "Error: prerequisite_id or prerequisite_label is required.";
          }
          const prerequisites = [...run.prerequisites];
          const index = prereqId
            ? prerequisites.findIndex(
                (item) => item.id === prereqId || item.id.startsWith(prereqId),
              )
            : -1;
          const patch = {
            id: prereqId ?? randomUUID(),
            label: args.prerequisite_label ?? prereqId ?? "Prerequisite",
            status: asPrerequisiteStatus(args.prerequisite_status),
            ...(args.instructions ? { instructions: args.instructions } : {}),
            ...(args.summary ? { evidence: args.summary } : {}),
          };
          if (index >= 0) {
            prerequisites[index] = {
              ...prerequisites[index],
              ...patch,
              id: prerequisites[index].id,
            };
          } else {
            prerequisites.push(patch);
          }
          const stillBlocked = goalHasBlockingPrerequisites({ ...run, prerequisites });
          const updated = await upsertGoalRun(cwd, {
            ...run,
            prerequisites,
            status: stillBlocked ? "blocked" : "ready",
            blockers: stillBlocked ? run.blockers : [],
          });
          await appendGoalDecision(cwd, updated.id, {
            kind: "prerequisites",
            reason: `Prerequisite ${patch.label} is ${patch.status}; run is ${updated.status}.`,
          });
          return goalHasBlockingPrerequisites(updated)
            ? `Prerequisite updated for "${updated.title}" (${updated.status}). User prerequisites: ${formatGoalBlockingPrerequisites(updated)}`
            : `User prerequisites complete for "${updated.title}". Goal is ready to run.`;
        }

        case "task": {
          const run = await resolveRun(cwd, args.run_id);
          if (!run) return "Error: no active goal run found.";
          if (!args.task_id && (!args.task_title || !args.task_prompt)) {
            return "Error: task_title and task_prompt are required when adding a task.";
          }
          const taskId = args.task_id ?? randomUUID();
          const existingTask = run.tasks.find(
            (task) => task.id === taskId || task.id.startsWith(taskId),
          );
          const taskExisted = existingTask !== undefined;
          if (!taskExisted && (!args.task_title || !args.task_prompt)) {
            return "Error: task_title and task_prompt are required when adding a task.";
          }
          const taskStatus = asTaskStatus(args.task_status);
          const updated = await updateGoalTask(cwd, run.id, taskId, {
            id: taskId,
            ...(args.task_title ? { title: args.task_title } : {}),
            ...(args.task_prompt ? { prompt: args.task_prompt } : {}),
            status: taskStatus,
            ...(args.worker_id ? { workerId: args.worker_id } : {}),
            ...(args.attempts !== undefined ? { attempts: args.attempts } : {}),
            ...(args.summary ? { lastSummary: args.summary } : {}),
          });
          const recovered = updated
            ? await upsertGoalRun(updated.projectPath, {
                ...updated,
                status: statusAfterTaskPatch(updated, taskStatus),
              })
            : null;
          if (!recovered) return `Error: no task found matching id "${taskId}".`;
          const updatedTask = recovered.tasks.find(
            (task) =>
              task.id === existingTask?.id || task.id === taskId || task.id.startsWith(taskId),
          );
          return `Goal task ${taskExisted ? "updated" : "added"}: "${updatedTask?.title ?? args.task_title ?? taskId}".`;
        }

        case "evidence": {
          const run = await resolveRun(cwd, args.run_id);
          if (!run) return "Error: no active goal run found.";
          if (!args.evidence_label && !args.summary)
            return "Error: evidence_label or summary is required.";
          const updated = await appendGoalEvidence(cwd, run.id, {
            kind: asEvidenceKind(args.evidence_kind),
            label: args.evidence_label ?? "Evidence",
            ...(args.evidence_path ? { path: args.evidence_path } : {}),
            ...(args.evidence_content || args.summary
              ? { content: args.evidence_content ?? args.summary }
              : {}),
          });
          if (!updated) return "Error: failed to append evidence.";
          return `Evidence added to "${updated.title}".`;
        }

        case "verify": {
          const run = await resolveRun(cwd, args.run_id);
          if (!run) return "Error: no active goal run found.";
          const result = {
            status: asVerificationStatus(args.verification_status),
            summary: args.summary ?? "Verifier recorded.",
            ...((args.verifier_command ?? run.verifier?.command)
              ? { command: args.verifier_command ?? run.verifier?.command }
              : {}),
            ...(args.exit_code !== undefined ? { exitCode: args.exit_code } : {}),
            ...(args.output_path ? { outputPath: args.output_path } : {}),
            checkedAt: new Date().toISOString(),
          };
          const runWithVerifier: GoalRun = {
            ...run,
            verifier: {
              description:
                args.verifier_description ?? run.verifier?.description ?? "Goal verifier",
              ...((args.verifier_command ?? run.verifier?.command)
                ? { command: args.verifier_command ?? run.verifier?.command }
                : {}),
              lastResult: result,
            },
            evidence: [
              ...run.evidence,
              createGoalEvidence({
                kind: "command",
                label: "Verifier result",
                content: result.summary,
                ...(result.outputPath ? { path: result.outputPath } : {}),
              }),
            ],
          };
          const completion = canCompleteGoalRun(runWithVerifier);
          const updated = await upsertGoalRun(cwd, {
            ...runWithVerifier,
            status:
              result.status === "pass" && completion.ok
                ? "passed"
                : result.status === "pass"
                  ? goalHasBlockingPrerequisites(runWithVerifier)
                    ? "blocked"
                    : "ready"
                  : result.status === "fail"
                    ? goalHasBlockingPrerequisites(runWithVerifier)
                      ? "blocked"
                      : "ready"
                    : "verifying",
            blockers: result.status === "pass" ? [] : run.blockers,
            activeWorkerId: undefined,
          });
          return `Verifier recorded for "${updated.title}": ${result.status}.`;
        }

        case "pause":
        case "resume":
        case "complete": {
          const run = await resolveRun(cwd, args.run_id);
          if (!run) return "Error: no active goal run found.";
          let status: GoalRunStatus;
          if (args.action === "pause") status = "paused";
          else if (args.action === "resume") {
            const missing = goalHasBlockingPrerequisites(run)
              ? formatGoalBlockingPrerequisites(run)
              : "";
            if (missing) {
              const updated = await upsertGoalRun(cwd, {
                ...run,
                status: "blocked",
                blockers: Array.from(new Set([...run.blockers, missing])),
                evidence: [
                  ...run.evidence,
                  createGoalEvidence({
                    kind: "summary",
                    label: "Goal resume blocked",
                    content: missing,
                  }),
                ],
              });
              return `Goal "${updated.title}" resume blocked: ${missing}`;
            }
            const requestedAt = new Date().toISOString();
            const resumed: GoalRun = {
              ...run,
              status: run.status === "running" || run.status === "verifying" ? run.status : "ready",
              continueRequestedAt: requestedAt,
              evidence: [
                ...run.evidence,
                createGoalEvidence({
                  kind: "summary",
                  label: "Goal resume requested",
                  content:
                    "Continuation requested; the next eligible Goal action will run automatically when no worker/verifier is active.",
                  createdAt: requestedAt,
                }),
              ],
            };
            const decision = decideGoalNextAction(resumed);
            const updated = await upsertGoalRun(cwd, resumed);
            await appendGoalDecision(cwd, updated.id, {
              kind: "resume",
              reason:
                decision.kind === "wait" ||
                decision.kind === "blocked" ||
                decision.kind === "terminal" ||
                decision.kind === "complete" ||
                decision.kind === "create_task" ||
                decision.kind === "pause" ||
                decision.kind === "start_worker" ||
                decision.kind === "run_verifier"
                  ? decision.reason
                  : "Resume decision queued.",
              content: `next=${decision.kind}`,
            });
            if (decision.kind === "wait") {
              return `Goal "${updated.title}" resume queued: ${decision.reason}`;
            }
            if (decision.kind === "blocked") {
              return `Goal "${updated.title}" resume blocked: ${decision.reason}`;
            }
            return `Goal "${updated.title}" resume requested; next action: ${decision.kind}.`;
          } else {
            const completion = canCompleteGoalRun(run);
            if (!completion.ok) return `Error: cannot complete goal: ${completion.reason}`;
            status = "passed";
          }
          const updated = await upsertGoalRun(cwd, { ...run, status });
          return `Goal "${updated.title}" is now ${updated.status}.`;
        }
      }
    },
  };
}
