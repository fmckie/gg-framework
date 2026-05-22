#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const checks: { label: string; ok: boolean; detail: string }[] = [];
function check(label: string, ok: boolean, detail: string) {
  checks.push({ label, ok, detail });
}
function read(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
function hasAll(text: string, needles: string[]) {
  return needles.every((needle) => text.includes(needle));
}

const audit = read("packages/ggcoder/docs/goal-quality-audit.md");
const compactorTest = read("packages/ggcoder/src/core/compaction/compactor.test.ts");
const queuedTest = read("packages/ggcoder/src/ui/queued-message.test.ts");
const systemPromptTest = read("packages/ggcoder/src/system-prompt.test.ts");
const compactorSource = read("packages/ggcoder/src/core/compaction/compactor.ts");

check(
  "required project checks are declared",
  hasAll(read("package.json"), ['"check"', '"lint"', '"format:check"', '"build"']),
  "root package.json must expose pnpm check && pnpm lint && pnpm format:check && pnpm build",
);
check(
  "source-backed comparison artifact exists",
  audit.includes("## Evidence sources") && audit.includes("Confidence:") && audit.includes("Action status"),
  "packages/ggcoder/docs/goal-quality-audit.md must cite sources, confidence, and action status for findings",
);
check(
  "compaction timeout implementation exists",
  /SUMMARY_ATTEMPT_TIMEOUT_MS|timeout/i.test(compactorSource) && /AbortSignal|abort/i.test(compactorSource),
  "compactor.ts must include bounded timeout/deadline logic while preserving abort behavior",
);
check(
  "targeted compaction timeout/abort tests exist",
  /timeout/i.test(compactorTest) && /fallback/i.test(compactorTest) && /abort/i.test(compactorTest),
  "compactor.test.ts must prove timeout fallback and abort behavior",
);
check(
  "queued-message UI regression tests exist",
  queuedTest.includes("queued") && /isActiveItem|onQueuedStart|placeholder|bullet|•/.test(queuedTest),
  "packages/ggcoder/src/ui/queued-message.test.ts must cover queued placeholder styling/lifecycle regression",
);
check(
  "system-prompt audit evidence harness exists",
  /promptAudit|contradict|bloat|obsolete|duplicate|flags/i.test(systemPromptTest),
  "system-prompt.test.ts must include deterministic audit evidence for contradiction/bloat fixes",
);

const targeted = spawnSync(
  "pnpm",
  [
    "--filter",
    "@kenkaiiii/ggcoder",
    "exec",
    "vitest",
    "run",
    "src/core/compaction/compactor.test.ts",
    "src/ui/queued-message.test.ts",
    "src/system-prompt.test.ts",
    "--reporter=dot",
  ],
  { encoding: "utf8", stdio: "pipe" },
);
check(
  "targeted harnesses pass",
  targeted.status === 0,
  `command: pnpm --filter @kenkaiiii/ggcoder exec vitest run src/core/compaction/compactor.test.ts src/ui/queued-message.test.ts src/system-prompt.test.ts --reporter=dot\nexit=${targeted.status}\n${(targeted.stdout + targeted.stderr).slice(-2000)}`,
);

console.log("Quality audit goal verifier");
for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.label}`);
  if (!item.ok) console.log(`  ${item.detail.replace(/\n/g, "\n  ")}`);
}
console.log("\nFinal full-project verifier command (orchestrator must run before completion):");
console.log("pnpm check && pnpm lint && pnpm format:check && pnpm build && pnpm --filter @kenkaiiii/ggcoder exec vitest run src/core/compaction/compactor.test.ts src/ui/queued-message.test.ts src/system-prompt.test.ts");

process.exit(checks.every((item) => item.ok) ? 0 : 1);
