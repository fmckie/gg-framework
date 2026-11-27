// Apps: Composio not set up (admin and not), nothing connected (catalogue, search, a connect
// that fails), seven connections with long names, and Disconnect's confirm.
import { both, closeBrowser } from "../lib.mjs";
import { healthy, connections } from "./data.mjs";
import { openSettings, goTab, fields, header } from "./_common.mjs";
import { reveal, step, why, boxes, FIT } from "./b-util.mjs";

const setup = (composio, admin = true) => ({ admin, keys: { openai: "saved", composio, typesafe: "missing" } });
async function open(app, name, wait = 2300) {
  await openSettings(app);
  await goTab(app, "Apps", wait);
  await header(app, name);
  await fields(app, name);
}

// 1. Composio has no key yet, on the admin device: the key's form.
await both(healthy({ data: { connections: { configured: false, connections: [] }, setup: setup("missing") } }), async (app) => {
  await open(app, "apps-not-configured");
  if (app.isPhone) {
    await why(app, "apps-not-configured", [".ap-setup .modal-input", ".ap-setup .btn", ".ap-setup a", ".ap-setup button"]);
    await boxes(app, "apps-not-configured", [".ap-page", ".ap-shelf", ".ap-slot", ".ap-setup", ".key-field", ".ap-setup .modal-input", ".ap-setup .btn", ".ap-caption"]);
  }
  await app.capture("apps-not-configured", { scroll: false });
});

// 1b. The same, on a device that is not the admin.
await both(healthy({ data: { connections: { configured: false, connections: [] }, setup: setup("missing", false) } }), async (app) => {
  await open(app, "apps-not-configured-not-admin");
  await app.capture("apps-not-configured-not-admin", { scroll: false });
});

// 2. Set up, nothing connected: the catalogue, its search, and a connect Composio refuses.
await both(
  healthy({
    data: { connections: { configured: true, connections: [] }, setup: setup("saved") },
    api: (req) => {
      if (req.method === "POST" && req.path.split("?")[0] === "/kleio/connections")
        return { status: 400, body: { error: "composio", code: "needs_setup", detail: "Toolkit stripe does not manage auth; add an auth config with your own developer keys" } };
      return undefined;
    },
  }),
  async (app) => {
    await open(app, "apps-none-connected");
    await app.capture("apps-none-connected");
    if (app.isPhone) {
      await why(app, "apps-none-connected", [".ap-search-input", ".ap-add-row", ".ap-more .st-text-btn", ".st-danger .btn"]);
      await boxes(app, "apps-none-connected", [".ap-search", ".ap-search-input", ".ap-add-list", ".ap-add-row", ".ap-add-text", ".ap-add-name", ".ap-add-cat", ".ap-add-how", ".ap-more", ".st-danger-item", ".st-danger-what"]);
      await why(app, "apps-none-connected fit", [".ap-add-name", ".ap-add-row", ".ap-add-list"], FIT);
    }
    const search = app.page.locator('input[aria-label="Search apps"]');
    await step("search", async () => {
      await search.fill("s");
      await app.settle(1200);
      await reveal(app, search);
      await fields(app, "apps-search-results");
      await app.capture("apps-search-results", { scroll: false });
      await search.fill("zzzz-nothing-like-this");
      await app.settle(1200);
      await reveal(app, search);
      if (app.isPhone) await boxes(app, "apps-search-none", [".ap-search-input", ".ap-add-empty"]);
      await app.capture("apps-search-none", { scroll: false });
      await search.fill("");
      await app.settle(1200);
    });
    await step("connect error", async () => {
      await app.tap(app.page.getByRole("button", { name: "Connect Stripe" }), { settle: 1000 });
      await reveal(app, ".ap-error");
      if (app.isPhone) {
        await boxes(app, "apps-connect-error", [".ap-error", ".ap-error span", ".ap-error .btn"]);
        await why(app, "apps-connect-error", [".ap-error .btn"]);
      }
      await app.capture("apps-connect-error", { scroll: false });
    });
  },
);

// 3. Seven connections: connected, expired, failed, waiting, and a very long name.
await both(healthy({ data: { connections: { configured: true, connections }, setup: setup("saved") } }), async (app) => {
  await open(app, "apps-connected");
  await app.capture("apps-connected");
  if (app.isPhone) {
    await why(app, "apps-connected", [".ap-inline-btn", ".ap-notice .st-text-btn", ".st-danger .btn"]);
    await boxes(app, "apps-connected", [".ap-shelf-wrap", ".ap-shelf", ".ap-shelf-row", ".ap-item", ".ap-icon", ".ap-name", ".ap-line", ".ap-inline-btn", ".ap-caption", ".st-danger-item", ".st-danger-what", ".st-danger-actions"]);
    await why(app, "apps-connected fit", [".ap-shelf-row", ".ap-item", ".ap-name", ".st-danger-what", ".st-danger-item"], FIT);
  }
  await step("disconnect", async () => {
    const d = app.page.getByRole("button", { name: "Disconnect Microsoft Dynamics 365 Business Central" });
    await reveal(app, d);
    await app.capture("apps-remove-group", { scroll: false });
    await app.tap(d, { settle: 600 });
    await reveal(app, ".st-danger-item:has(.is-confirm)");
    if (app.isPhone) {
      await boxes(app, "apps-disconnect-confirm", [".st-danger-item:has(.is-confirm)", ".st-danger-item:has(.is-confirm) .st-danger-what", ".st-danger-actions .btn", ".st-danger-hint"]);
      await why(app, "apps-disconnect-confirm", [".st-danger .btn.is-confirm", ".st-danger .btn-ghost"]);
    }
    await app.capture("apps-disconnect-confirm", { scroll: false });
  });
});
await closeBrowser();
