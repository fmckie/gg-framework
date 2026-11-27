// Tools: no servers (and the add form, typed into; Project scope), then six servers:
// a very long name and command, one failing (Fix), one needing sign-in, Remove's confirm.
import { both, closeBrowser } from "../lib.mjs";
import { healthy, mcpServers } from "./data.mjs";
import { openSettings, goTab, fields, header } from "./_common.mjs";
import { reveal, step, why, boxes, FIT } from "./b-util.mjs";

const LONG_CMD =
  'claude mcp add --transport http internal-observability https://mcp.internal.example.com/v1/observability/mcp --header "Authorization: Bearer demo-token"';
async function open(app, name, wait = 2300) {
  await openSettings(app);
  await goTab(app, "Tools", wait);
  await header(app, name);
  await fields(app, name);
}

// 1. No servers; then the add form with a long command; then Project scope.
await both(healthy({ responses: { agent_mcp_list: { servers: [] } } }), async (app) => {
  await open(app, "tools-empty");
  await app.capture("tools-empty", { scroll: false });
  if (app.isPhone) {
    await why(app, "tools-empty", [".tl-head-tools .st-text-btn", ".tl-scope-btn", ".tl-input", ".tl-add-btn"]);
    await boxes(app, "tools-empty", [".tl-page", ".tl-head", ".tl-head-tools", ".tl-scope", ".tl-scope-btn", ".tl-bench", ".tl-ruler", ".tl-empty", ".tl-add-row", ".tl-input", ".tl-add-btn", ".tl-note"]);
  }
  await step("add", async () => {
    const line = app.page.locator('input[aria-label^="Server"]');
    await line.fill(LONG_CMD);
    await app.settle(400);
    await reveal(app, line);
    await fields(app, "tools-add");
    if (app.isPhone) await boxes(app, "tools-add", [".tl-add", ".tl-add-row", ".tl-input", ".tl-add-btn"]);
    await app.capture("tools-add", { scroll: false });
  });
  await step("project scope", async () => {
    await reveal(app, ".tl-head");
    await app.tap(app.page.locator(".tl-scope-btn").nth(1), { settle: 1000 });
    await fields(app, "tools-add-project");
    if (app.isPhone) {
      await boxes(app, "tools-add-project", [".tl-project", ".tl-page .picker-item", ".tl-page select", ".tl-projects", ".tl-page li button"]);
      await why(app, "tools-add-project", [".tl-project", ".tl-page li button", ".tl-page select"]);
    }
    await app.capture("tools-add-project", { scroll: false });
  });
});

// 2. Six servers.
await both(healthy({ responses: { agent_mcp_list: { servers: mcpServers } } }), async (app) => {
  await open(app, "tools-several");
  await app.capture("tools-several");
  if (app.isPhone) {
    await why(app, "tools-several", [".tl-action .btn", ".st-danger .btn", ".tl-head-tools .st-text-btn", ".tl-scope-btn"]);
    await boxes(app, "tools-several", [".tl-bench", ".tl-ruler", ".tl-row", ".tl-name", ".tl-track", ".tl-ticks", ".tl-count", ".tl-action", ".tl-where", ".tl-held", ".tl-notes", ".tl-caption", ".st-danger-item", ".st-danger-what", ".st-danger-actions"]);
    await why(app, "tools-several fit", [".tl-row", ".tl-name", ".tl-where", ".st-danger-what"], FIT);
  }
  await step("fix", async () => {
    await app.tap(app.page.getByRole("button", { name: "Fix postgres" }), { settle: 700 });
    await reveal(app, '.tl-row[data-server="postgres"]');
    if (app.isPhone) {
      await boxes(app, "tools-fix-open", [".tl-fix:not([hidden])", ".tl-steps li", ".tl-fix:not([hidden]) code", ".tl-fix:not([hidden]) .btn", ".tl-fix:not([hidden]) button"]);
      await why(app, "tools-fix-open", [".tl-fix:not([hidden]) button"]);
    }
    await app.capture("tools-fix-open", { scroll: false });
  });
  await step("sign in row", async () => {
    await reveal(app, '.tl-row[data-server="linear"]');
    await app.capture("tools-row-actions", { scroll: false });
  });
  await step("remove", async () => {
    const rm = app.page.getByRole("button", { name: /^Remove internal-observability/ });
    await reveal(app, rm);
    await app.tap(rm, { settle: 600 });
    await reveal(app, ".st-danger-item:has(.is-confirm)");
    if (app.isPhone) await boxes(app, "tools-remove-confirm", [".st-danger-item:has(.is-confirm)", ".st-danger-item:has(.is-confirm) .st-danger-what", ".st-danger-actions .btn", ".st-danger-hint"]);
    await app.capture("tools-remove-confirm", { scroll: false });
  });
  await step("project scope", async () => {
    await reveal(app, ".tl-head");
    await app.tap(app.page.locator(".tl-scope-btn").nth(1), { settle: 1000 });
    await app.capture("tools-project-scope", { scroll: false });
  });
});
await closeBrowser();
