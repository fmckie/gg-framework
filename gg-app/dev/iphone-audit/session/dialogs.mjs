// Plan review, Notes, Tasks, Checklist, Help, and the New-session confirm.
import { both, closeBrowser, enterSession } from "../lib.mjs";
import { AREA, probe, startRun } from "./common.mjs";
import { CWD } from "../base.mjs";

const PLAN = `# Checkout retry with idempotency keys

A made-up plan, long enough to scroll on the phone.

## Steps

1. Add \`idempotencyKey\` to \`createOrder()\` in \`src/checkout/retry.ts\`
2. Store the key beside the order in \`orders.idempotency_key\` (unique index)
3. Retry on 502/503/504 with backoff: 250 ms, 1 s, 4 s
4. Keep the old flow behind \`CHECKOUT_RETRY=off\`
5. Rerun \`pnpm test cart\` and the integration suite

## Files

| File | Change | Risk |
| --- | --- | --- |
| \`src/checkout/retry.ts\` | new retry loop with idempotency keys | medium |
| \`src/checkout/components/OrderSummaryWithAVeryLongComponentName.tsx\` | show "retrying…" | low |
| \`migrations/20261127_add_idempotency_key.sql\` | new column and index | high |

\`\`\`ts
export async function createOrderWithRetry(cart: Cart, idempotencyKey: string): Promise<Order> {
  return retry(() => api.post("/orders", { cart, idempotencyKey }), { retries: 3, backoff: [250, 1000, 4000] });
}
\`\`\`

## Verification

- unit tests for the backoff table
- an integration test that kills the gateway mid-request
- a manual pass on staging with the flag on and off
`;

const TASKS = [
  ["t-1", "Add idempotency keys to createOrder() and thread them through the retry loop", "pending"],
  ["t-2", "Rerun the cart integration suite", "in-progress"],
  ["t-3", "Write the migration for orders.idempotency_key", "pending"],
  ["t-4", "Update docs/checkout-retry.md", "done"],
].map(([id, title, status]) => ({ id, title, prompt: `Made-up prompt for: ${title}`, status, createdAt: "2026-11-20T09:00:00.000Z" }));

const item = (id, title, group, over = {}) => ({
  id,
  title,
  group,
  description: `A made-up check: ${title}`,
  check: "Inspect the project",
  skill: null,
  setupCommand: null,
  status: "not-run",
  checkedAt: null,
  commit: null,
  uncommittedChanges: false,
  result: null,
  summary: null,
  findings: [],
  evidence: [],
  runPrompt: `Check ${id} without editing files`,
  ...over,
});
const CHECKLIST = {
  staleAfterDays: 30,
  detectionWarnings: [],
  items: [
    item("git-github", "Git & GitHub", "Foundations", { status: "passed", result: "pass", checkedAt: "2026-11-20T09:00:00.000Z" }),
    item("agent-setup", "Agent setup", "Foundations", { detection: { summary: "CLAUDE.md found, AGENTS.md missing", facts: [] } }),
    item("tests", "Tests", "Quality", { status: "needs-work", result: "issues", checkedAt: "2026-11-18T09:00:00.000Z", findings: ["cart.integration.test.ts is flaky", "no test for refunds"], changedSinceCheck: true }),
    item("ci", "Continuous integration", "Quality", { status: "due", result: "pass", checkedAt: "2026-09-01T09:00:00.000Z" }),
    item("security", "Security and dependency review", "Quality"),
    item("design", "Design and accessibility", "Experience", { status: "not-applicable", result: "not-applicable" }),
  ],
};

await both(
  {
    area: AREA,
    responses: { agent_tasks: { tasks: TASKS }, agent_checklist: CHECKLIST },
    storage: {
      [`gg-notes:${CWD}`]:
        "Made-up notes for the audit.\n\n- retry: 250 ms, 1 s, 4 s\n- ask about the refund flow\n- https://example.com/a/very/long/link/that/should/wrap/in/the/notes/box/on/a/phone\n\n" +
        Array.from({ length: 30 }, (_, i) => `line ${i + 1}: something to scroll through`).join("\n"),
    },
  },
  async (app) => {
    const { page } = app;
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        console.log(`\n!! ${app.device} step ${name}: ${String(e?.message ?? e).split("\n")[0]}`);
      }
    };
    const nav = (text) => page.locator(".chat-head-nav button", { hasText: text }).first();
    const MODAL = [".modal-backdrop", ".modal", ".modal-head", ".modal-title", ".modal-close", ".modal-body"];
    await enterSession(app);
    await app.settle(1500);

    await step("notes", async () => {
      await app.tap(nav("Notes"));
      await app.settle(700);
      await app.capture("notes", { scroll: false });
      await probe(app, "notes", [...MODAL, ".notes-input"]);
      await app.tap(".modal-close");
    });

    await step("tasks", async () => {
      await app.tap(nav("Tasks"));
      await app.settle(700);
      await app.capture("tasks", { scroll: false });
      await probe(app, "tasks", [...MODAL, ".tasks-list", ".tasks-item", ".tasks-title", ".tasks-status", ".tasks-run-one", ".tasks-delete", ".tasks-actions", ".tasks-actions .btn"]);
      await app.tap(".modal-close");
    });

    await step("help", async () => {
      await app.tap(page.getByRole("button", { name: "Help", exact: true }));
      await app.settle(700);
      await app.capture("help");
      await probe(app, "help", [...MODAL, ".session-help-body", ".session-help-grid", ".session-help-row", ".session-help-text"]);
      await app.tap(".modal-close");
    });

    await step("new-confirm", async () => {
      await app.tap(nav("New"));
      await app.settle(700);
      await app.capture("new-session-confirm", { scroll: false });
      await probe(app, "new-session-confirm", [...MODAL, ".modal .btn", ".confirm-actions", ".modal-actions"]);
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      if (await cancel.isVisible().catch(() => false)) await app.tap(cancel);
      else await page.keyboard.press("Escape");
      await app.settle(300);
    });

    await step("checklist", async () => {
      await app.tap(nav("Checklist"));
      await app.settle(1200);
      await app.capture("checklist");
      await probe(app, "checklist", [".placeholder-checklist", ".placeholder-checklist h1", ".placeholder-checklist [role=tablist]", ".placeholder-checklist [role=tab]", ".placeholder-scroll", ".placeholder-row", ".placeholder-row > div", ".placeholder-row .btn", ".chat-head", ".inputwrap", ".footer"]);
      // Back closes the checklist.
      await app.tap(page.getByTitle(/Back to/).first());
      await app.settle(500);
    });

    await step("plan-review", async () => {
      await startRun(app, "Plan the checkout retry");
      await app.emit("text_delta", { text: "Here is the plan." });
      await app.emit("plan_exit", { planPath: "/tmp/made-up-plan.md", content: PLAN });
      await app.emit("turn_end", {});
      await app.emit("agent_done", {});
      await app.emit("run_end", {});
      await app.settle(300);
      await app.emit("plan_review", { planPath: "/tmp/made-up-plan.md", content: PLAN });
      await app.settle(1500);
      await app.capture("plan-review");
      await probe(app, "plan-review", [".plan-review", ".plan-review-banner", ".plan-review-banner *", ".plan-review-body", ".plan-review-body table", ".plan-review-body pre", ".plan-review-actions", ".plan-review-actions .btn", ".plan-review-status", ".chat-head", ".inputwrap", ".footer"]);
      await app.tap(page.getByRole("button", { name: "Feedback", exact: true }));
      await app.settle(600);
      await app.capture("plan-review-feedback", { scroll: false });
      await probe(app, "plan-review-feedback", [".plan-feedback", ".plan-feedback-input", ".plan-feedback-row", ".plan-feedback-hint", ".plan-feedback-buttons", ".plan-feedback-buttons .btn", ".plan-review-body"]);
    });
  },
);
await closeBrowser();
