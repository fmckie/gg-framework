import { both, closeBrowser } from "../lib.mjs";
import { goals } from "./data.mjs";
import { chain, rects, workspace } from "./extra.mjs";

const open = async (app) => {
  await app.tap(app.page.getByRole("button", { name: "Goals", exact: true }));
  await app.settle(900);
};
const only = process.argv[2];
const want = (k) => !only || only === k;
const ROW = [".chat-browser-item", ".chat-browser-item-title", ".chat-browser-item-date", ".goal-browser-item-goal", ".chat-browser-item-meta", ".goal-browser-status", ".picker-hide"];

if (want("empty"))
  await both({ area: "lists", responses: { agent_goals: { goals: [] } } }, async (app) => {
    await open(app);
    await app.capture("goals-empty");
    await rects(app, "goals-empty", [".goal-browser-empty", ".goal-browser-empty > span", ".chat-browser-new"]);
  });

if (want("few"))
  await both(
    { area: "lists", responses: { agent_goals: { goals: goals(5) }, agent_delete_goal: null } },
    async (app) => {
      await open(app);
      await app.capture("goals-few");
      await rects(app, "goals-few", ROW, 5);
      const search = app.page.locator(".chat-browser-search input");
      await app.tap(search);
      await search.fill("billing");
      await app.settle(300);
      await app.capture("goals-search", { scroll: false });
      await search.fill("zzzz");
      await app.settle(300);
      await app.capture("goals-search-none", { scroll: false });
      await search.fill("");
      await app.settle(300);
      // Delete: the X, then the confirm on its own line under the row.
      if (!app.isPhone) await app.page.locator(".goal-browser-row").first().hover();
      await app.tap(app.page.locator(".goal-browser-row .picker-delete").first(), { settle: 300, force: true });
      await app.capture("goals-delete-confirm", { scroll: false });
      await rects(app, "goals-delete-confirm", [".goal-browser-confirm", ".goal-browser-confirm > p", ".goal-browser-confirm-actions", ".goal-browser-confirm-actions > button"]);
    },
  );

if (want("long"))
  await both({ area: "lists", responses: { agent_goals: { goals: goals(24) } } }, async (app) => {
    await open(app);
    await app.capture("goals-long");
  });

if (want("form"))
  await both(
    {
      area: "lists",
      responses: { agent_goals: { goals: goals(5) } },
      // The native picker (plugin:dialog|open), answered with made-up paths.
      invoke: (cmd, args) => {
        if (cmd !== "plugin:dialog|open") return undefined;
        return args?.options?.directory
          ? ["/Users/demo/projects/enterprise-customer-data-platform-ingestion-service-v2-rewrite", "/Users/demo/projects/api"]
          : ["/Users/demo/projects/specs/checkout-latency-budget-and-measurement-plan-2026-q4-final.md"];
      },
    },
    async (app) => {
      await open(app);
      await app.tap(app.page.locator(".chat-browser-heading .chat-browser-new"), { settle: 700 });
      await app.capture("goal-form-empty");
      const FORM = [".modal.goal-form-modal", ".modal-close", ".goal-form input", ".goal-form textarea", ".goal-form-aside > button", ".goal-form-actions", ".goal-form-actions > button", ".goal-form-context", ".goal-form-context > li", ".goal-form-context-name", ".goal-form-context > li > .placeholder-muted", ".goal-form-context > li > button"];
      await rects(app, "goal-form-empty", FORM, 4);
      const form = app.page.locator("form.goal-form");
      await form.locator("input").first().fill("WWWWWWWWWWWWWWW");
      await form.locator("textarea").first().fill(
        "Get checkout loading under one second on mobile at the 95th percentile across the three slowest regions, without removing the fraud checks, and prove it with a before-and-after report that finance and support can both read. ".repeat(3).trim(),
      );
      await form.locator("textarea").nth(1).fill(
        "Keep the current design. Ask before adding dependencies. Never touch the payments service without a migration plan reviewed by Sam. Write every decision into docs/decisions with the date and the reason.",
      );
      await app.settle(300);
      await app.capture("goal-form-filled");
      await rects(app, "goal-form-filled", FORM, 4);
      for (const name of ["Add folders", "Add files"]) {
        await app.tap(form.getByRole("button", { name }), { settle: 400 }).catch((e) => console.log(`[${app.device}] ${name}: ${String(e.message).split("\n")[0]}`));
      }
      await app.capture("goal-form-context");
      await rects(app, "goal-form-context", FORM, 4);
      console.log(`[${app.device}] dialog calls:`, JSON.stringify(app.calls().filter((c) => /dialog/.test(c.cmd))));
    },
  );

if (want("open")) {
  const list = goals(5);
  const g = list[0];
  const goalState = (over) => ({
    cwd: g.path,
    state: { id: g.id, name: g.name, needsKickoff: false, phase: "active", paused: false, needsResume: false, instructions: "Keep the current design. Ask before adding dependencies.", context: g.context, critterModel: null, ...over },
  });
  await both(
    {
      area: "lists",
      responses: { agent_goals: { goals: list }, agent_goal_kickoff: { started: false }, agent_goal_resume: { resumed: false } },
      invoke: chain(workspace({ goal: goalState() })),
    },
    async (app) => {
      await open(app);
      await app.tap(app.page.locator(".chat-browser-item").first(), { settle: 2000 });
      await app.capture("goal-open");
      await rects(app, "goal-open", [".placeholder-bar", ".placeholder-bar > strong", ".placeholder-bar button", ".placeholder-bar select", ".placeholder-bar label"], 8);
      const settings = app.page.getByRole("button", { name: "Goal settings" });
      if (await settings.isVisible().catch(() => false)) {
        await app.tap(settings, { settle: 500 });
        await app.capture("goal-open-settings");
        await rects(app, "goal-open-settings", [".placeholder-form", ".placeholder-form button", ".placeholder-form textarea"], 8);
      } else console.log(`[${app.device}] no Goal settings button`);
    },
  );
}

await closeBrowser();
