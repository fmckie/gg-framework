// A running goal's Workers view: the goal bar and the Olympus courtyard, then its settings dialog.
import { both, closeBrowser } from "../lib.mjs";
import { goals } from "../lists/data.mjs";
import { chain, rects, workspace } from "../lists/extra.mjs";

const CROWD = [
  ["survey_routes", "owl", 8, "Reading src/http/routes.ts"],
  ["build_limiter", "bee", 10, "Editing src/http/limits.ts"],
  ["audit_login", "auditor", 7, "Running node scripts/time-login.js"],
  ["compare_caches", "researcher", 5, "Fetching example.com/benchmarks/lru"],
  ["doubt_the_plan", "skeptic", 4, "Reading docs/checkout-retry.md"],
];
const list = goals(5);
const g = list[0];
const goal = {
  cwd: g.path,
  state: { id: g.id, name: g.name, needsKickoff: false, phase: "active", paused: false, needsResume: false, instructions: "Keep the current design.", context: g.context, critterModel: null },
};
const BAR = [".goal-panel", ".goal-bar", ".goal-bar-title", ".goal-bar-views", ".goal-bar-views > button", ".goal-bar-tools", ".goal-bar-actions > button", ".goal-bar-model > label", ".goal-bar-select > select", ".goal-status", ".oly-court", ".oly-cell", ".goal-workers .placeholder-row"];

await both(
  {
    area: "goal-fix",
    responses: { agent_goals: { goals: list }, agent_goal_kickoff: { started: false }, agent_goal_resume: { resumed: false } },
    invoke: chain(workspace({ goal })),
  },
  async (app) => {
    await app.tap(app.page.getByRole("button", { name: "Goals", exact: true }));
    await app.settle(900);
    await app.tap(app.page.locator(".chat-browser-item").first(), { settle: 2000 });
    await app.emit("run_start");
    for (const [name, type, tools, activity] of CROWD)
      await app.emit("subagent_state", {
        agent_id: `sa-${name}`, task_name: name, agent_name: type, state: "running", current_activity: activity,
        started_at: 0, updated_at: 9000, elapsed_ms: 9000, turn_count: 2, tool_use_count: tools,
        token_usage: { input: 12000, output: 2100, cacheRead: 900 },
      });
    await app.settle(6000);
    console.log(`[${app.device}] html: ${await app.page.evaluate(() => document.documentElement.className)}; art: ${await app.page.evaluate(() => [...document.querySelectorAll(".oly-court image, .oly-court img")].slice(0, 3).map((i) => (i.getAttribute("href") || i.src || "").slice(0, 60)).join(" | "))}`);
    await app.capture("goal-workers", { scroll: false });
    await rects(app, "goal-workers", BAR, 8);
    await app.tap(app.page.getByRole("button", { name: "Goal settings" }), { settle: 600 });
    await app.capture("goal-settings", { scroll: false });
    await rects(app, "goal-settings", [".modal.goal-form-modal", ".modal-close", ".goal-form textarea", ".goal-form button"], 8);
  },
);
await closeBrowser();
