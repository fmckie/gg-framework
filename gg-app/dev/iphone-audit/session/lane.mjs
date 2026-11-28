// The Olympus lane with 4 running sub-agents, then 8.
import { both, closeBrowser, enterSession } from "../lib.mjs";
import { AREA, probe, startRun } from "./common.mjs";

// [task, agent type (→ god), tools, activity], shaped like olympus/fixtures.ts MOCK_CROWD.
const CROWD = [
  ["survey_routes", "owl", 8, "Reading src/http/routes.ts"],
  ["build_limiter", "bee", 10, "Editing src/http/limits.ts"],
  ["audit_login", "auditor", 7, "Running node scripts/time-login.js"],
  ["checkout_native_retry", "worker", 21, "Read src/checkout/RetryPage.tsx"],
  ["compare_caches", "researcher", 5, "Fetching example.com/benchmarks/lru"],
  ["doubt_the_plan", "skeptic", 4, "Reading docs/checkout-retry.md"],
  ["run_auth_suite", undefined, 3, "Running pnpm test auth"],
  ["second_survey", "owl", 6, 'Searching for "idempotencyKey("'],
];
const send = async (app, list) => {
  for (const [name, type, tools, activity] of list) {
    await app.emit("subagent_state", {
      agent_id: `sa-${name}`, task_name: name, agent_name: type, state: "running", current_activity: activity,
      started_at: 0, updated_at: 9000, elapsed_ms: 9000, turn_count: 2, tool_use_count: tools,
      token_usage: { input: 12000 + tools * 900, output: 2100, cacheRead: 900 },
    });
  }
};
const LANE = [".oly-lane", ".oly-gods", ".oly-gods > *", ".oly-names", ".oly-names > *", ".oly-card", ".liveregion", ".transcript", ".inputwrap"];

await both({ area: AREA }, async (app) => {
  await enterSession(app);
  await startRun(app);
  await send(app, CROWD.slice(0, 4));
  await app.settle(6000);
  await app.capture("gods-lane-4", { element: ".oly-lane", scroll: false });
  await probe(app, "gods-lane-4", LANE);
  await send(app, CROWD.slice(4));
  await app.settle(7000);
  await app.capture("gods-lane-7", { element: ".oly-lane", scroll: false });
  await probe(app, "gods-lane-7", LANE);
});
await closeBrowser();
