# /goal Quality Audit

Date: 2026-05-23  
Scope: deep quality audit of the current `/goal` implementation using `packages/ggcoder/docs/goal-system-map.md` plus direct source inspection. This audit preserves existing user changes and updates only this documentation artifact.

## Evidence and commands used

- Source map: `packages/ggcoder/docs/goal-system-map.md`.
- Source inspected: `packages/ggcoder/src/system-prompt.ts`, `src/tools/goals.ts`, `src/core/goal-store.ts`, `src/core/goal-controller.ts`, `src/core/goal-worker.ts`, `src/core/goal-verifier.ts`, `src/ui/goal-events.ts`, `src/ui/App.tsx`.
- Working tree preservation check: `git status --short` showed many pre-existing modified/untracked files; this audit did not edit implementation files.
- Test command attempted: `npm --prefix packages/ggcoder test -- --runInBand src/core/goal-controller.test.ts src/tools/goals.test.ts src/core/goal-store.test.ts src/ui/goal-events.test.ts src/ui/goal-lifecycle-orchestration.test.ts` failed because Vitest does not support `--runInBand`.
- Test command passed: `npm --prefix packages/ggcoder test -- src/core/goal-controller.test.ts src/tools/goals.test.ts src/core/goal-store.test.ts src/ui/goal-events.test.ts src/ui/goal-lifecycle-orchestration.test.ts` — 5 files, 81 tests passed.

## Current source re-audit update

Re-audited on 2026-05-23 against the current working tree and refreshed docs. Current source shows multiple findings from the original audit have been remediated in implementation and/or test harnesses: setup-quality gating, stronger evidence-plan matching, final audit pass-contract validation, prerequisite command safety, worker timeout handling, verifier process-tree cleanup, active-run overwrite protection, pause/resume hardening, fallback event parsing, and canonical verifier scripts are now present. The durable artifacts to keep current are:

- A-Z source map: `packages/ggcoder/docs/goal-system-map.md`.
- Gap audit: this file.
- Remediation plan: `packages/ggcoder/docs/goal-remediation-plan.md`.
- Remediation report: `packages/ggcoder/docs/goal-remediation-report.md`.
- Local proof scripts: `pnpm --filter @kleio/coder verify:goal:tests`, `pnpm --filter @kleio/coder verify:goal:e2e`, and `pnpm dlx tsx packages/ggcoder/scripts/verify-goal-system-audit.ts`.

Remaining blockers/residual risks after the re-audit:

1. **GQA-002 remains residual:** there is still no hard first-tool-call enforcer requiring `goals status` before every coordinator action; current mitigation is prompt/event instructions plus fresh durable-state orchestration tests.
2. **Interactive/provider-backed proof remains residual:** automated local harnesses exercise durable state/controller/verifier/event behavior, but a real terminal session with a live provider, typed `/goal`, `Ctrl+G`, worker execution, and visual TUI observation is not part of the free deterministic verifier.
3. **Documentation/source line drift risk:** this map is source-backed to current files, but line numbers can drift with ongoing implementation changes; rerun `scripts/verify-goal-system-audit.ts` after future `/goal` edits.

## Findings

### GQA-001 — Setup mode is prompt-governed, but setup completeness is not schema-enforced

- Severity: Medium
- Confidence: High
- Area: setup mode, goals tool API, final completion gating
- Evidence: `system-prompt.ts:65-70` instructs setup to define success criteria, evidence/harness/verifier plans, and stop. `tools/goals.ts:306-374` requires only `title` and `goal` for `create`; `success_criteria`, `evidence_plan`, `harness`, tasks, and verifier are optional. `canCompleteGoalRun` later blocks missing verifier but treats an empty evidence plan as satisfied (`goal-controller.ts:166-178`, `:318-349`).
- Repro/proof: A setup agent can call `goals create` with only `title` and `goal`; the tool returns a ready run. The controller will eventually create a verifier task, but there is no durable indication that setup failed to capture original criteria or proof paths.
- Recommendation: Add a setup-quality gate or warning in `goals create`: either require non-empty `success_criteria` and at least one planned evidence path/verifier/harness for new runs, or record a blocker/status field such as `draft` until those are present. Add tests for minimal create producing draft/blocked-or-warning state.
- Action status: Fixed in the current working tree; covered by `verify:goal:tests` and documented in `goal-remediation-report.md`.

### GQA-002 — Coordinator mode depends on model compliance for `goals status` first

- Severity: Low
- Confidence: Medium
- Area: coordinator mode, synthetic events, UI orchestration
- Evidence: `system-prompt.ts:74-79` and `goal-events.ts:120-125` instruct the coordinator to call `goals status` first. `runGoalSyntheticEvent` in `App.tsx:4062-4102` sets coordinator mode and runs the event through the agent loop, but there is no code-level preflight status call or enforcement.
- Repro/proof: Synthetic events include `current_goal_state` snapshots and instructions; an agent could skip `goals status` and act on stale snapshot text. Tests cover formatting/parsing but not mandatory first tool call enforcement.
- Recommendation: Consider an orchestration wrapper that automatically loads current durable state before feeding synthetic events to the model, or a goal-mode guard that rejects non-status `goals` actions as the first coordinator tool call for a run. At minimum add a test/harness proving stale snapshots cannot drive completion.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-003 — Evidence-plan satisfaction can be too fuzzy and may allow false positives

- Severity: High
- Confidence: High
- Area: verifier, evidence plan, final completion gating
- Evidence: `evidencePlanItemSatisfiedByDurableEvidence` marks an item satisfied if its label, description, command, or path appears as a substring in passing verifier command/output/summary or any durable evidence label/path/content (`goal-controller.ts:112-138`). `hasRequiredGoalEvidence` trusts that matching (`goal-controller.ts:166-178`).
- Repro/proof: An evidence item labeled `UI` or with a generic description can be satisfied by unrelated evidence containing that word. This can make `canCompleteGoalRun` pass once tasks, verifier, and audit pass, even if the specific intended proof artifact was never generated.
- Recommendation: Require stronger matching: exact path equality for path-backed items; exact command equality or explicit `evidence_plan` ready status with evidence for command-backed items; and minimum label/description token thresholds for text-only items. Prefer requiring workers/auditors to update evidence-plan items explicitly when reconciling.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-004 — Final audit freshness catches many stale paths but trusts summary semantics

- Severity: Medium
- Confidence: High
- Area: final completion gating, verifier
- Evidence: `hasFreshGoalCompletionAudit` requires pass status, matching `verifierCheckedAt`, audit not older than verifier, no later non-audit worker evidence, and no later completion-relevant evidence (`goal-controller.ts:239-282`). The audit action only validates that a passing verifier exists and records whatever summary/status the tool supplies (`tools/goals.ts:603-651`). The prompt asks summaries to start with `FINAL_AUDIT_PASS` (`goal-controller.ts:376-399`), but the tool does not enforce this.
- Repro/proof: A worker or coordinator can call `goals audit` with `verification_status=pass` and a vague summary; if timestamps line up and other gates pass, the audit freshness check can accept it.
- Recommendation: Enforce minimum audit contract in `tools/goals.ts`: passing audits must include `FINAL_AUDIT_PASS`, `verifier_checked_at=<latest>`, and either an output path or concrete artifact references. Add negative tests for vague pass audits.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-005 — Worker lifecycle has no runtime timeout despite a `timeout` completion reason type

- Severity: Medium
- Confidence: High
- Area: worker lifecycle, pause/resume/recovery
- Evidence: `GoalWorkerCompletion.reason` includes `timeout` (`goal-worker.ts:42-49`), but `startGoalWorker` has no timeout option/timer and only handles close/error/stop (`goal-worker.ts:179-383`, `:390-426`). Workers are bounded by CLI `--max-turns` (`goal-worker.ts:194-210`), not wall-clock time.
- Repro/proof: A worker can hang in a long-running foreground command or blocked provider call. Recovery only occurs on process exit or startup reconciliation; a live hung child remains active and causes controller `wait` (`goal-controller.ts:469-484`).
- Recommendation: Add configurable worker wall-clock timeout with process-tree kill, task failure/blocking evidence, and synthetic completion reason `timeout`. Test with a hanging worker stub.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-006 — Verifier timeout kills only the shell process, not necessarily its process tree

- Severity: Medium
- Confidence: Medium
- Area: verifier, worker lifecycle, store recovery
- Evidence: verifier execution uses `spawn(command, { shell: true })` (`goal-verifier.ts:46-52`). On timeout it calls `child.kill("SIGTERM")`, then `child.kill("SIGKILL")` (`goal-verifier.ts:86-97`). Worker stop uses `killProcessTree` (`goal-worker.ts:390-415`), but verifier timeout does not.
- Repro/proof: Shell commands that spawn child processes can leave grandchildren running after the shell is killed, especially dev servers or watchers. The verifier will record timeout, but external child processes may survive and contaminate later verifier runs.
- Recommendation: Use `killProcessTree` for verifier timeout cleanup, mirroring worker stop. Add an integration test with a shell command that starts a child and sleeps.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-007 — `goals verify` manual/tool-side path records different evidence label than UI verifier

- Severity: Low
- Confidence: High
- Area: goals tool API, verifier, synthetic events
- Evidence: Tool-side `verify` appends evidence labeled `Verifier result` (`tools/goals.ts:538-600`), while UI verifier appends `Verifier pass` or `Verifier fail` and then a decision (`App.tsx:4547-4597`). Repeated failure detection accepts both `Verifier fail` and `Verifier result` (`goal-controller.ts:366-374`).
- Repro/proof: Evidence streams differ depending on whether verification was recorded by the tool or UI. Some UI/history surfaces may show different labels for equivalent verifier events.
- Recommendation: Normalize labels or explicitly document the two paths. Prefer always appending `Verifier result` with status in content plus optional status-specific decision.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-008 — Store durability is strong for single process, but cross-process write races remain possible

- Severity: Medium
- Confidence: Medium
- Area: store durability, worker lifecycle
- Evidence: writes are serialized by module-level `writeQueue` and atomic temp-file rename (`goal-store.ts:194`, `:533-583`), but Goal workers are separate CLI processes (`goal-worker.ts:216-220`) and each process has its own in-memory queue. `upsertGoalRun` performs read/merge/write (`goal-store.ts:800-832`) without file locking.
- Repro/proof: Concurrent worker/tool processes can both read the same `goals.json`, append different evidence/tasks, and race on rename. `mergeGoalEvidence` helps only within one `upsert` against the current in-process read; it does not prevent last-writer-wins between processes.
- Recommendation: Add an inter-process lock file or optimistic concurrency retry based on mtime/content hash. Add a stress test spawning multiple node processes appending evidence to the same run and assert no evidence loss.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-009 — Active-run empty overwrite guard is narrow

- Severity: Low
- Confidence: High
- Area: store durability, recovery
- Evidence: `wouldEraseActiveGoalRuns` rejects only an empty `nextRuns` list while active work exists (`goal-store.ts:510-568`). It does not reject overwrites that keep a non-empty list but omit an active run.
- Repro/proof: A faulty overlay/save path or future call could write `[someOtherRun]` and drop an active run; the guard would not trigger because `nextRuns.length > 0`.
- Recommendation: Broaden the guard to reject any write that removes active run ids unless explicitly archiving/stopping them. Test omission of one active run from a multi-run file.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-010 — Pause via tool does not stop active worker; pause via UI does

- Severity: Medium
- Confidence: High
- Area: pause/resume/recovery, worker lifecycle, goals tool API
- Evidence: UI pause stops active worker with `stopGoalWorker` before marking paused (`App.tsx:4649-4675`). Tool `pause` only sets status to `paused` through `upsertGoalRun` (`tools/goals.ts:653-659`, `:725-726`). If `activeWorkerId` remains, `setRunWorker` on worker close may later set status back to ready (`goal-worker.ts:162-177`, `:311-322`).
- Repro/proof: Calling `goals({action:"pause"})` during an active worker does not kill or block the child. The worker may continue mutating files and updating Goal state after the pause request.
- Recommendation: For tool pause, either refuse when `activeWorkerId` exists with instructions to use UI stop, or integrate worker-stop capability into the tool path. Ensure pause clears/blocks continuation consistently.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-011 — Resume can return “blocked” without persisting blocked status for non-prerequisite controller blocks

- Severity: Low
- Confidence: Medium
- Area: pause/resume/recovery, goals tool API
- Evidence: `goals resume` persists the resumed run, appends a resume decision, and returns messages based on `decideGoalNextAction` (`tools/goals.ts:680-719`). If the decision is `blocked` for reasons such as blocked evidence plan, it returns `resume blocked` but does not persist status `blocked` or add the reason to `blockers` in that path.
- Repro/proof: A paused/ready run with a blocked evidence-plan item can produce a blocked decision, while durable status remains ready with `continueRequestedAt` set until UI continuation later handles it.
- Recommendation: When resume decision is `blocked`, persist `status:"blocked"`, add the reason to blockers, and clear `continueRequestedAt` immediately.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-012 — Synthetic event fallback parsing is lossy and unescape-free

- Severity: Low
- Confidence: Medium
- Area: synthetic events, recovery
- Evidence: payload JSON parsing is robust when present (`goal-events.ts:384-390`). Fallback header parsing uses regex for quoted fields and does not unescape values encoded by `headerValue` (`goal-events.ts:395-461`).
- Repro/proof: If payload is absent/corrupt and a goal/task contains quotes or backslashes, fallback parsed fields may be escaped or truncated. This is not expected in normal events because the JSON payload line exists.
- Recommendation: Either remove fallback reliance from critical paths or implement proper quoted-string unescaping and tests for quotes/backslashes with corrupt payload.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-013 — UI orchestration can double-drive continuation after verifier events

- Severity: Low
- Confidence: Medium
- Area: UI orchestration, synthetic events, verifier
- Evidence: verifier completion both calls `runGoalSyntheticEvent(eventText)` and schedules `continueGoalRun(run.id)` after every pass/fail (`App.tsx:4614-4627`). `runGoalSyntheticEvent` may queue/run a coordinator turn concurrently depending on agent state (`App.tsx:4062-4102`). `continueGoalRun` also calls controller directly (`App.tsx:4105-4197`).
- Repro/proof: On verifier completion, model-driven coordinator and direct controller continuation can both attempt next actions, relying on store/controller state to avoid duplicates. Existing tests cover lifecycle transitions, but not race timing between synthetic event agent turn and direct continuation.
- Recommendation: Add a single-flight lock per run around verifier/worker completion continuation. Add a UI orchestration test proving one and only one follow-up task/verifier/audit is created for a pass/fail event.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-014 — Setup/coordinator goal-mode restrictions are broad but not fully audited end-to-end

- Severity: Medium
- Confidence: Medium
- Area: setup mode, coordinator mode, tool restrictions
- Evidence: prompts forbid edit/write/bash/subagent in coordinator and restrict setup (`system-prompt.ts:65-79`). Tool-specific restrictions are covered in `goal-mode.test.ts` per the map, and runtime mode helpers exist, but this audit did not run the full goal-mode restriction suite. The passed subset covered controller/tool/store/events/UI orchestration only.
- Repro/proof: The command that passed was limited to 5 test files / 81 tests. It did not include `system-prompt.test.ts`, `tools/goal-mode.test.ts`, `goal-worker.test.ts`, `goal-verifier.test.ts`, or overlay/status tests.
- Recommendation: Add a canonical `/goal` quality CI command that runs all goal-related tests, including prompt restrictions, worker/verifier, overlay/status, and lifecycle smoke. Consider a single script such as `npm --prefix packages/ggcoder test -- src/**/*goal*.test.ts src/tools/goal-mode.test.ts src/system-prompt.test.ts`.
- Action status: Fixed in the current working tree by canonical local verifier scripts; see `goal-remediation-report.md`.

### GQA-015 — No true local end-to-end UI `/goal` smoke was executed in this audit

- Severity: Medium
- Confidence: High
- Area: setup mode, UI orchestration, worker lifecycle, verifier, final completion gating
- Evidence: The passed command executed unit/integration-style tests for controller/tool/store/events/orchestration. It did not launch the CLI/TUI, invoke `/goal`, press Goal pane controls, spawn a real worker, run a verifier, and observe final completion.
- Repro/proof: `packages/ggcoder/scripts/verify-goal-e2e.ts` exists, but this audit did not run it. Therefore the full user-facing `/goal -> setup -> run -> worker -> verifier -> audit -> pass` path remains unproven here.
- Recommendation: Make `scripts/verify-goal-e2e.ts` the primary quality gate if it is current, or update it to run against a temporary project and `GG_GOALS_BASE`. It should assert durable store contents, worker/verifier logs, synthetic event handling, and final gate behavior.
- Action status: Fixed in the current working tree by canonical local verifier scripts; see `goal-remediation-report.md`.

### GQA-016 — Prerequisite checks are cheap and bounded, but command safety is prompt-only

- Severity: Low
- Confidence: High
- Area: setup mode, goals tool API, prerequisites
- Evidence: setup prompt allows only cheap foreground non-mutating bash checks (`system-prompt.ts:65-70`). `normalizePrerequisiteInput` runs any `check_command` when needed (`tools/goals.ts:167-197`), and the check runner executes shell commands with timeout per the map. The tool schema does not distinguish mutating from non-mutating commands.
- Repro/proof: A setup agent could provide a mutating `check_command`; the tool will execute it because there is no command allowlist or dry-run classifier.
- Recommendation: Add guardrails for `check_command`: visible warning for suspicious mutators, a strict timeout already exists, and perhaps require explicit `status:missing` instead of executing commands containing destructive tokens. Add tests for rejected dangerous prerequisite commands.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-017 — Worker completion marks task done based on process exit, not durable task/evidence correctness

- Severity: Medium
- Confidence: High
- Area: worker lifecycle, final completion gating
- Evidence: On child close, `startGoalWorker` marks the task `done` for exit code 0 and records log evidence (`goal-worker.ts:293-322`). The worker prompt tells workers to update durable evidence/task status (`goal-worker.ts:85-95`), but process exit remains the authoritative status update.
- Repro/proof: A worker can exit 0 after doing little or failing to record proof; the controller may continue. Later verifier/evidence/audit gates should catch true completion, but task-level quality can look done even when its assignment was not satisfied.
- Recommendation: Consider requiring worker-created evidence or an explicit `goals task ... status=done` with summary before the parent marks done, or mark parent exit as `finished` while a coordinator/auditor validates task completion. Add tests for zero-evidence successful worker completion.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

### GQA-018 — Blocker deduplication is inconsistent

- Severity: Low
- Confidence: High
- Area: UI orchestration, store durability, pause/resume
- Evidence: Some paths deduplicate blockers with `Array.from(new Set(...))` (`App.tsx:4293-4297`, `:4411-4416`, `tools/goals.ts:360-363`), while `decision.kind === "blocked"` appends raw `[..., decision.reason]` (`App.tsx:4379-4384`) and missing verifier does the same (`App.tsx:4506-4510`).
- Repro/proof: Repeated run/verify attempts can accumulate duplicate blocker strings, making overlay/status less clear.
- Recommendation: Centralize blocker append/dedupe helper and use it everywhere.
- Action status: Fixed or explicitly accepted in the current working tree; covered by `verify:goal:tests`, `verify:goal:e2e`, and/or `verify-goal-system-audit.ts`; see `goal-remediation-report.md` for the source-backed status.

## Quality summary by required area

- Setup mode: strong prompt, weak schema enforcement; prerequisite command safety is prompt-only.
- Coordinator mode: strong prompt and event instructions, but no code-enforced status-first or single-flight continuation.
- Goals tool API: comprehensive actions, but minimal create/audit/pause/resume contracts have gaps.
- Store durability: normalization, atomic rename, journals, and single-process queue are good; cross-process locking and active-run omission guard need improvement.
- UI orchestration: broad handling for start/continue/verifier/pause exists; race/double-drive tests are missing.
- Worker lifecycle: good logging and synthetic completions; lacks wall-clock timeout and exit-0 quality validation.
- Verifier: bounded and durable logs; should kill process trees and normalize evidence paths/labels.
- Synthetic events: payload design is strong; fallback parsing and stale-snapshot enforcement are gaps.
- Pause/resume/recovery: startup reconciliation is useful; tool pause/resume persistence semantics need tightening.
- Final completion gating: significantly improved with verifier + evidence plan + fresh final audit; fuzzy evidence matching and audit-summary trust remain the highest-risk completion false-positive paths.
