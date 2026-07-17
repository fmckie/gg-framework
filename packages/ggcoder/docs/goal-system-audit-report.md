# /goal system audit report

Date: 2026-05-23

## A-Z outcome

The `/goal` system is now mapped, quality-audited, remediated, and covered by local verifier harnesses. The current local verifier chain passes. The implemented design supports a durable goal lifecycle from `/goal` setup through Ctrl+G/`/goals` orchestration, worker delegation, verifier execution, evidence recording, evidence-plan reconciliation, and final completion-audit gating.

Proof boundary: this report records automated local/source-backed proof only. It does not claim that a provider-backed interactive terminal session has been manually exercised end-to-end.

This report is source-backed by:

- System map: `packages/ggcoder/docs/goal-system-map.md`.
- Quality audit: `packages/ggcoder/docs/goal-quality-audit.md`.
- Verifier harness: `packages/ggcoder/scripts/verify-goal-system-audit.ts`.
- Verifier log: `packages/ggcoder/.goal-evidence/goal-system-audit-verifier.log`.

## What works

- `/goal` setup mode is intentionally setup-only. It is routed through the prompt command/UI path, creates durable Goal state, asks for success criteria, prerequisites, evidence/harness/verifier planning, worker tasks, and then stops instead of implementing.
- Coordinator mode is distinct from setup mode. It is designed to inspect durable state, persist decisions/evidence/task status/blockers/verifier metadata, and take the next orchestration step rather than directly implementing.
- Durable state is comprehensive. `GoalRun` tracks success criteria, prerequisites, harnesses, evidence plans, tasks, evidence, verifier state, blockers, active worker id, continuation timestamps, and completion audit data.
- The controller has explicit next-action and completion gates for setup instrumentation, prerequisite/evidence blockers, worker starts, verifier runs, evidence reconciliation, retry/fix limits, final audits, and completion.
- Worker and verifier activity is locally observable through logs/output files and durable Goal evidence.
- UI and synthetic-event paths cover worker start/completion, verifier pass/fail, pause/resume/continue, blockers, and completion decisions.
- The final local verifier now passes source-contract checks, targeted Goal tests, and package typecheck.

## Issues found

The quality audit documents the main residual issues and risk areas in `packages/ggcoder/docs/goal-quality-audit.md`:

- Setup completeness is still mostly prompt-governed rather than schema-enforced; a minimal `goals create` can omit criteria/evidence/harness details.
- Coordinator `goals status` first is prompt-governed; stale synthetic snapshots are mitigated but not fully code-enforced.
- Evidence-plan matching can be fuzzy because substring matches can satisfy plan items too easily.
- Final audit freshness is strong, but audit summary semantics are trusted more than strictly validated.
- Worker lifecycle lacks a wall-clock timeout, despite a timeout completion reason type.
- Verifier timeout should kill the whole process tree, not just the shell process.
- Tool-side and UI-side verifier evidence labels differ.
- Cross-process Goal store writes can still race because atomic rename and in-process queues do not provide inter-process locking.
- The active-run empty-overwrite guard does not cover all active-run omission cases.
- Tool `pause` does not stop an active worker, while UI pause does.
- `resume` can report blocked without always persisting blocked status for non-prerequisite controller blocks.
- Synthetic-event fallback parsing is lossy if the JSON payload is missing/corrupt.
- UI continuation after verifier events may be double-driven without a single-flight guard.
- Goal-mode restrictions, true TUI interaction, and real worker/verifier user flow remain less tested than source/unit orchestration.
- Prerequisite check-command safety is prompt-only.
- Worker process exit code can mark a task done before task-specific evidence quality is validated.
- Blocker deduplication is inconsistent.

## Improvements/refinements completed in this Goal

- Refreshed the end-to-end `/goal` source map in `packages/ggcoder/docs/goal-system-map.md`.
- Wrote a contradiction/gap quality audit in `packages/ggcoder/docs/goal-quality-audit.md`.
- Added/updated the local verifier harness at `packages/ggcoder/scripts/verify-goal-system-audit.ts`.
- Produced durable verifier output at `packages/ggcoder/.goal-evidence/goal-system-audit-verifier.log`.
- Reconciled earlier verifier/source-contract mismatches so the current audit verifier passes.
- Confirmed targeted Goal tests and package typecheck through the verifier harness.

## What is not tested properly or remains risky

- No provider-backed interactive TUI smoke was proven here: `/goal` typed by a user, Ctrl+G opened, a live provider-backed worker observed in the pane, verifier run from the pane, and final completion observed end-to-end in the terminal UI.
- External prerequisites for that interactive proof are intentionally blocked from this local report: configured provider credentials/session, network access, provider/model availability, and permission to capture redacted TUI screenshots or logs.
- `packages/ggcoder/scripts/verify-goal-e2e.ts` is now part of the remediation proof path, but it is a deterministic local harness rather than a live provider/TUI run.
- GQA-002 remains an accepted residual design risk: coordinator `goals status` first is instructed and tested via orchestration paths, but not enforced by a hard first-tool-call gate.

## Commands run

Final report worker command:

```sh
pnpm dlx tsx packages/ggcoder/scripts/verify-goal-system-audit.ts
```

The verifier internally runs the targeted Goal behavior tests and package check described by the harness, including controller/tool/prompt/system-prompt/lifecycle orchestration coverage and `pnpm --filter @kleio/coder check`.

## Verifier results

Latest verifier result: **PASS** with exit code 0.

Verifier log excerpt from `packages/ggcoder/.goal-evidence/goal-system-audit-verifier.log`:

```text
Goal system audit verifier
PASS end-to-end surface map exists
PASS audit artifact captures findings and recommendations
PASS /goal prompt is setup-only and evidence-oriented
PASS global instructions mention Goal proof semantics
PASS goals tool exposes complete lifecycle actions
PASS store persists durable goal state
PASS controller gates completion on proof
PASS UI wires goals overlay and lifecycle
PASS worker and verifier are locally observable
PASS targeted /goal behavior tests pass
PASS package typecheck passes

Signals checked: source map coverage, contradiction/gap audit artifact, setup-only /goal contract, durable goals tool/store/controller/UI/worker/verifier plumbing, prerequisite/evidence-plan/worker/verifier/synthetic-event/pause-resume/final-audit tests, and TypeScript check.
```

## Artifacts produced

- `packages/ggcoder/docs/goal-system-map.md` — source-backed lifecycle map.
- `packages/ggcoder/docs/goal-quality-audit.md` — detailed quality findings, recommendations, and not-tested-properly gaps.
- `packages/ggcoder/docs/goal-system-audit-report.md` — this final user-facing report.
- `packages/ggcoder/scripts/verify-goal-system-audit.ts` — local/free audit verifier harness.
- `packages/ggcoder/.goal-evidence/goal-system-audit-verifier.log` — durable verifier output.

## Remediation update

A subsequent remediation pass is documented in `packages/ggcoder/docs/goal-remediation-report.md`. The requested verifier chain passed and wrote `packages/ggcoder/.goal-evidence/goal-remediation-verifier.log`.

## Fix-diff summary: setup handoff and worker prompt simplification

This isolated fix pass addressed two domain-agnostic bottlenecks observed while running the current Goal system against [original-goal-prompt]:

- Reduced redundant planner→setup token handoff in `packages/ggcoder/src/ui/prompt-routing.ts` by stripping the generic slash-command preamble before setup and preserving mandatory references/original user instructions under a concise `## Original Goal Objective` section.
- Hardened GOAL_PLAN capture by accepting only anchored `GOAL_PLAN ... END_GOAL_PLAN` blocks and replacing unusable planner chatter with a bounded fallback block, instead of embedding arbitrary planner narrative into setup.
- Simplified `buildGoalWorkerSystemPrompt` in `packages/ggcoder/src/core/goal-worker.ts` while preserving proof, worktree isolation, candidate packet, task DAG, evidence, and no-complete contracts for worker-to-worker/coordinator handoff.
- Added/updated targeted Vitest coverage in `src/ui/prompt-routing.test.ts`, `src/ui/slash-command-images.test.ts`, and `src/core/goal-worker.test.ts`.

Verification run for this fix pass:

```sh
pnpm --dir packages/ggcoder exec vitest run src/ui/prompt-routing.test.ts src/ui/slash-command-images.test.ts src/core/goal-worker.test.ts src/system-prompt.test.ts
```

Result: **PASS** — 4 files, 42 tests passed. Note: an earlier `pnpm --filter @kleio/coder test -- ...` invocation unexpectedly ran broad suites and failed on missing workspace build outputs for `@kleio/ai`, `@kleio/agent`, and `@kenkaiiii/gg-pixel`; the focused verifier above avoids that unrelated package-entry failure and directly covers this fix diff.

## Residual risks

The system is materially stronger than a narrative-only `/goal` workflow because completion is gated by durable evidence, verifier results, evidence-plan reconciliation, and a final audit. The highest original risks around fuzzy evidence matching, final-audit contract enforcement, lifecycle cleanup, store preservation, setup completeness, and local E2E verification now have targeted automated coverage. Remaining risk is primarily that this proof path is automated/local rather than a fully interactive TUI session with a provider-backed worker.

Follow-up for operators: run the commands in `packages/ggcoder/docs/goal-remediation-report.md`, then perform the provider-backed interactive proof only in an already-authenticated environment. Record project-relative artifacts and redacted observations only; do not include secrets or environment dumps.
