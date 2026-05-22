# /goal system end-to-end map

Audit date: 2026-05-22. No implementation changes were made; this file maps existing behavior by source line.

## A-to-Z flow

1. **User invocation**
   - `/goal` is a prompt-template command registered in `packages/ggcoder/src/core/prompt-commands.ts:13-18` with alias `/g`.
   - The prompt requires setup-only behavior: understand objective, create/update durable Goal run/tasks/evidence plan, then stop; it explicitly forbids implementation, subagents, resume, verifier execution, and worker startup during the initial turn (`prompt-commands.ts:26-35`, `prompt-commands.ts:74-84`).
   - The prompt defines the goal-specific sensory-proof model and required planning fields (`prompt-commands.ts:36-49`, `prompt-commands.ts:50-72`).
   - App routing opens the Goal pane for `/goals` (`packages/ggcoder/src/ui/App.tsx:2952-2967`) and routes `/goal` through prompt-command expansion (`App.tsx:2988-2996`).
   - `Ctrl+G` toggles the Goal overlay from normal input mode (`packages/ggcoder/src/ui/components/InputArea.tsx:837-846`) via `App.tsx:4943-4945`.

2. **System prompt support**
   - The global system prompt includes Goal-specific research/verification guidance: model intended experience, imagine failures, choose required senses/signals, plan proportional local/free instruments, and let workers build missing instruments (`packages/ggcoder/src/system-prompt.ts:69-76`).
   - The goals tool prompt hint describes durable Goal runs, Ctrl+G workflow, prerequisites, evidence, worker tasks, and completion gated by verifier evidence (`packages/ggcoder/src/tools/goals.ts:228-233`).

3. **Goals tool actions**
   - Tool schema exposes `create`, `prerequisite`, `task`, `evidence`, `verify`, `status`, `pause`, `resume`, and `complete` plus run metadata, evidence-plan, harness, verifier, task, evidence, and blocker fields (`packages/ggcoder/src/tools/goals.ts:71-137`).
   - `create` validates title/goal, maps prerequisites/harness/evidence_plan/verifier metadata, marks the run `blocked` when user prerequisites are missing/unknown, persists via `upsertGoalRun`, and appends a Goal decision evidence row (`tools/goals.ts:237-307`).
   - `status` formats one or all runs (`tools/goals.ts:310-318`).
   - `prerequisite` updates/adds prerequisites and flips status to `ready` when blocking prerequisites are clear (`tools/goals.ts:320-363`).
   - `task` adds/updates Goal tasks while preserving existing title/prompt and recovering failed runs when a pending/failed task is added (`tools/goals.ts:365-401`).
   - `evidence` appends durable evidence (`tools/goals.ts:403-418`).
   - `verify` records verifier result, appends command evidence, and only marks `passed` when `canCompleteGoalRun` says all tasks/evidence/verifier conditions are satisfied (`tools/goals.ts:420-465`).
   - `resume` checks blockers, records a continuation request, runs `decideGoalNextAction` for queued next action metadata, and appends a resume decision (`tools/goals.ts:468-541`).
   - `complete` calls `canCompleteGoalRun`; it refuses completion without all required proof (`tools/goals.ts:535-539`).

4. **Goal-store persistence**
   - Goal state model includes run status, prerequisites, harness, evidence plan, tasks, evidence, verifier, blockers, activeWorkerId, and continueRequestedAt (`packages/ggcoder/src/core/goal-store.ts:7-121`).
   - Storage base defaults to `~/.gg/goals/projects` with `GG_GOALS_BASE` override; project paths are normalized and hashed (`goal-store.ts:181-191`, `goal-store.ts:539-545`).
   - Runs are normalized on read to tolerate missing/invalid fields (`goal-store.ts:275-433`).
   - Writes are queued and atomic JSON writes update `goals.json`, `meta.json`, and per-run markdown journals; an empty overwrite is rejected if active runs exist (`goal-store.ts:471-520`, `goal-store.ts:945-1000`).
   - Reconciliation clears stale active workers/tasks/verifiers and records repair evidence (`goal-store.ts:641-735`).
   - `upsertGoalRun`, `appendGoalDecision`, `appendGoalEvidence`, and `updateGoalTask` are the core persistence operations (`goal-store.ts:737-884`).
   - Blocking prerequisites are `missing` or `unknown` without evidence (`goal-store.ts:887-915`).

5. **Controller decisions**
   - `canCompleteGoalRun` blocks completion if prerequisites block, tasks remain, evidence plan is unsatisfied, verifier evidence is absent, or verifier did not pass (`packages/ggcoder/src/core/goal-controller.ts:171-196`).
   - Evidence-plan satisfaction accepts ready items, item evidence, matching durable evidence, or matching passing verifier output (`goal-controller.ts:91-133`).
   - `decideGoalNextAction` terminally stops blocked/failed/passed/paused runs, blocks on prerequisites, waits for active workers/tasks, starts next pending/failed task within attempt limit, completes only when completion check passes, creates evidence/harness/verifier tasks when needed, handles verifier failures with bounded fix tasks/repeated-failure guard, runs verifier when configured, or creates a verifier-definition task (`goal-controller.ts:268-403`).
   - Controller decisions are formatted/persisted for auditability (`goal-controller.ts:247-265`, `goal-store.ts:789-813`).

6. **UI and Goal pane integration**
   - App periodically reconciles active Goal runs and updates active count/status bar entries (`packages/ggcoder/src/ui/App.tsx:1340-1368`).
   - Goal overlay loads/saves runs, protects against accidental empty persistence, and displays summaries/readiness/detail sections (`packages/ggcoder/src/ui/components/GoalOverlay.tsx:857-900`, `GoalOverlay.tsx:50-108`, `GoalOverlay.tsx:145-173`).
   - Overlay keybindings: Enter/d expands detail, `r` runs selected Goal, `v` verifies, `p` pauses, `x` archives, Esc closes (`GoalOverlay.tsx:939-1028`).
   - App wires overlay callbacks to `startGoalRun`, `verifyGoalRun`, and `pauseGoalRun` (`App.tsx:4630-4648`).
   - Chat/progress rows and status bar entries are appended for worker/verifier/terminal phases (`App.tsx:3990-4005`, `App.tsx:4021-4040`, `App.tsx:4296-4312`, `App.tsx:4371-4394`).

7. **Worker semantics**
   - `buildGoalWorkerSystemPrompt` gives disposable workers cwd/run/task context, asks for local/free sensory proof, durable `goals` evidence/task updates, cleanup of worker-owned background processes, and forbids whole-goal completion (`packages/ggcoder/src/core/goal-worker.ts:85-95`).
   - `startGoalWorker` prevents duplicate workers per run, spawns the same CLI with JSON mode/model/provider/max turns/system prompt, writes worker NDJSON logs under the Goal project dir, marks the task running, and sets `activeWorkerId` (`goal-worker.ts:179-243`).
   - Worker stdout JSON is logged; tool starts become Goal log evidence; on close, the task becomes done/failed, evidence points to the worker log, `activeWorkerId` is cleared, and completion is emitted (`goal-worker.ts:249-332`).
   - Stopping a worker kills its process tree, marks task blocked, records evidence, and clears active worker state (`goal-worker.ts:390-415`).

8. **Resume and synthetic-event semantics**
   - Worker/verifier completion text is formatted as hidden synthetic events carrying payload, current Goal state snapshot, and orchestrator instructions to call `goals(status)` and take exactly one next control-loop action (`packages/ggcoder/src/ui/goal-events.ts:120-125`, `goal-events.ts:222-264`, `goal-events.ts:267-315`).
   - `continueGoalRun` reconciles latest state, calls `decideGoalNextAction`, handles terminal/blocked/pause states, consumes `continueRequestedAt`, records continuation decisions, and delegates to `startGoalRun` for the next action (`packages/ggcoder/src/ui/App.tsx:3927-4006`).
   - After worker completion, App emits a synthetic event into the main agent loop and auto-continues queued resumed Goals when no worker/verifier is active (`App.tsx:4016-4050`, `App.tsx:4063-4080`).
   - After verifier completion, App emits a verifier synthetic event and may continue if `continueRequestedAt` remains and verifier passed (`App.tsx:4387-4400`).

9. **Verification and completion**
   - `runGoalVerifierCommand` executes the configured command in the project cwd with shell, captures bounded output, times out after 10 minutes by default, writes a verifier log under the Goal project dir, and returns pass/fail plus failure class/duration (`packages/ggcoder/src/core/goal-verifier.ts:36-109`).
   - `verifyGoalRun` marks run `verifying`, runs the command, persists verifier result/evidence/decision, creates a bounded `Fix verifier failure` task on failure, and marks status `passed` only if `canCompleteGoalRun` succeeds (`packages/ggcoder/src/ui/App.tsx:4265-4407`).
   - `startGoalRun` handles controller decisions: terminal/wait/complete/run_verifier/create_task/blocked/pause/start_worker (`App.tsx:4083-4253`).

10. **Tests covering the system**
   - `/goal` prompt contract and sensory-proof/stop-after-setup rules: `packages/ggcoder/src/core/prompt-commands.test.ts:20-114`.
   - Controller decisions and completion gates: `packages/ggcoder/src/core/goal-controller.test.ts:30-220` and later cases in the same file.
   - Goals tool persistence, explicit run lookup, evidence-plan preservation, and completion guard: `packages/ggcoder/src/tools/goals.test.ts:34-220` and later cases.
   - End-to-end local lifecycle smoke from create -> task -> evidence -> verifier fail -> repair -> verifier pass -> complete: `packages/ggcoder/src/core/goal-lifecycle-smoke.test.ts:40-220`.
   - Additional focused tests exist for goal store, verifier, worker, worker dev-server lifecycle, synthetic events, overlay, and status bar: `packages/ggcoder/src/core/goal-store.test.ts`, `goal-verifier.test.ts`, `goal-worker.test.ts`, `goal-worker-dev-server-lifecycle.test.ts`, `packages/ggcoder/src/ui/goal-events.test.ts`, `goal-overlay.test.ts`, `goal-status-bar.test.ts`.

## Operator understanding summary

A developer/operator can trace `/goal` A-to-Z as: `/goal` expands to a strict setup-only orchestration prompt; the agent calls `goals(create/task/...)` to persist a durable run in `~/.gg/goals/projects/<hash>`; Ctrl+G or `/goals` opens a pane where `r` starts the run; `startGoalRun` asks `decideGoalNextAction`; workers/verifiers update durable state and emit synthetic events back to the orchestrator; continuation consumes queued resume requests and repeats one controller action at a time; completion is guarded by prerequisites, done tasks, satisfied evidence plan, and passing verifier evidence.