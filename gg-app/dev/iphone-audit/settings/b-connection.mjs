// Connection: connected (admin, 5 devices), Pair a device (QR, allow/deny, code only),
// the Remove group's confirms, host not reachable, and a device that is not the admin.
import { both, closeBrowser, base } from "../lib.mjs";
import { healthy, linkDown, offer, LONG_DEVICE } from "./data.mjs";
import { openSettings, goTab, fields, header } from "./_common.mjs";
import { reveal, step, why, boxes, FIT } from "./b-util.mjs";

const MIN = 60_000;
let stage = "idle";
const pairing = (cmd) => {
  if (cmd === "kleio_pair_state")
    return {
      active: stage !== "idle",
      expiresAt: stage === "idle" ? null : Date.now() + 5 * MIN,
      redeemed: false,
      admin: false,
      claim: stage === "claim" ? { label: LONG_DEVICE, deviceCode: "3F9 AC2", at: Date.now() - 4000, contested: true, allowed: false } : null,
    };
  if (cmd === "kleio_pair_cancel") {
    stage = "idle";
    return null;
  }
  return undefined;
};

async function open(app, name, wait = 2600) {
  await openSettings(app);
  await goTab(app, "Connection", wait);
  const show = app.page.getByRole("button", { name: "Show devices" });
  if (await show.isVisible().catch(() => false)) await app.tap(show, { settle: 900 });
  await header(app, name);
}

// 1. Connected, as the admin: the whole page, then Pair a device, then Remove.
await both(healthy({ responses: { kleio_offer: offer() }, invoke: pairing }), async (app) => {
  stage = "idle";
  await open(app, "connection-connected");
  await fields(app, "connection-connected");
  await app.capture("connection-connected");
  if (app.isPhone) {
    await why(app, "connection-connected", [
      ".settings-screen > .picker-head button",
      ".settings-tabs [role=tab]",
      ".cx-fix",
      ".cx-verdict-actions .st-text-btn",
      ".cx-page .settings-card .btn-sm",
      ".conn-disclosure-summary",
      ".kleio-switch",
      ".conn-relay-actions .btn",
      ".conn-relay-add .modal-input",
      ".conn-relay-add .btn",
      ".conn-pair-start .btn",
      ".st-danger .btn",
    ]);
    await boxes(app, "connection-connected", [".cx-route", ".cx-node-name", ".cx-node-detail", ".conn-fact", ".conn-code", ".conn-link-events-box", ".settings-cols", ".settings-col", ".conn-device", ".conn-device-name", ".conn-device-sub", ".conn-inline-badge", ".st-danger-item", ".st-danger-what", ".st-danger-actions"]);
    await why(app, "connection-connected fit", [".conn-device-name", ".st-danger-what", ".settings-cols", ".cx-node-detail"], FIT);
  }
  await step("devices", async () => {
    await reveal(app, "ul.conn-devices");
    await app.capture("connection-devices", { scroll: false });
  });
  await step("pair", async () => {
    const btn = app.page.getByRole("button", { name: "Show pairing QR" });
    await reveal(app, btn);
    stage = "offer";
    await app.tap(btn, { settle: 1300 });
    await reveal(app, ".conn-pair");
    await fields(app, "connection-pair-qr");
    if (app.isPhone) {
      await boxes(app, "connection-pair-qr", [".conn-pair", ".conn-qr", ".conn-pair-text", ".conn-pair-how", ".conn-pair-codeline", ".conn-pair-code", ".conn-pair-ticket", ".kleio-ticket", ".conn-expiry"]);
      await why(app, "connection-pair-qr", [".conn-pair .btn", ".conn-pair-ticket .modal-input", ".conn-pair-ticket .btn"]);
      await why(app, "connection-pair-qr fit", [".conn-pair", ".conn-qr"], [...FIT, "height", "display"]);
    }
    await app.capture("connection-pair-qr", { scroll: false });
    stage = "claim";
    await app.page.locator(".conn-pair-ask").waitFor({ timeout: 15000 });
    await reveal(app, ".conn-pair-ask");
    if (app.isPhone) {
      await boxes(app, "connection-pair-ask", [".conn-pair-ask", ".conn-pair-ask-title", ".conn-pair-code", ".conn-inline-confirm", ".conn-pair-ask .btn"]);
      await why(app, "connection-pair-ask", [".conn-pair-ask .btn"]);
    }
    await app.capture("connection-pair-ask", { scroll: false });
  });
  await step("forget", async () => {
    const forget = app.page.locator(".st-danger").getByRole("button", { name: "Forget host", exact: true });
    await reveal(app, forget);
    await app.tap(forget, { settle: 500 });
    await app.tap(app.page.getByRole("button", { name: `Revoke this device: ${LONG_DEVICE}` }), { settle: 500 });
    await reveal(app, ".st-danger-item:has(.is-confirm)");
    if (app.isPhone) {
      await boxes(app, "connection-forget-confirm", [".st-danger-item", ".st-danger-what", ".st-danger-actions", ".st-danger-actions .btn", ".st-danger-hint"]);
      await why(app, "connection-forget-confirm", [".st-danger .btn.is-confirm", ".st-danger .btn-ghost"]);
    }
    await app.capture("connection-forget-confirm", { scroll: false });
  });
});

// 2. A host with no link ticket: the pair code and the host's address, no QR.
await both(healthy({ responses: { kleio_offer: offer(null) }, invoke: pairing }), async (app) => {
  stage = "idle";
  await open(app, "connection-pair-code");
  await step("pair code", async () => {
    const btn = app.page.getByRole("button", { name: "Show pairing QR" });
    stage = "offer";
    await app.tap(btn, { settle: 1300 });
    await reveal(app, ".conn-pair");
    if (app.isPhone) await boxes(app, "connection-pair-code", [".conn-pair", ".conn-pair-text", ".conn-steps", ".conn-steps li", ".conn-code", ".conn-pair-code", ".conn-pair-note"]);
    await app.capture("connection-pair-code", { scroll: false });
  });
});

// 3. The host stops answering once Settings is open: the verdict, with Fix open.
let down = false;
await both(
  healthy({
    responses: { kleio_link_status: linkDown },
    invoke: (cmd, args) => {
      if (down && cmd === "kleio_api" && String(args?.path ?? "").startsWith("/kleio/health")) throw new Error("timed out");
      return undefined;
    },
  }),
  async (app) => {
    down = false;
    await openSettings(app);
    down = true;
    await goTab(app, "Connection", 3800);
    await header(app, "connection-down");
    await step("fix", async () => {
      const fix = app.page.locator(".cx-fix").first();
      if (await fix.isVisible().catch(() => false)) await app.tap(fix, { settle: 600 });
    });
    if (app.isPhone) {
      await boxes(app, "connection-down", [".cx-path", ".cx-route", ".cx-node", ".cx-node-name", ".cx-node-detail", ".cx-gap", ".cx-verdict", ".cx-verdict-line", ".cx-verdict-detail", ".cx-verdict-actions", ".cx-fix", ".cx-fix-steps", ".conn-steps li", ".conn-command", ".conn-bad"]);
      await why(app, "connection-down", [".cx-fix", ".cx-verdict-actions .st-text-btn", ".cx-fix-steps .btn", ".conn-command .btn", ".cx-page .settings-card .btn"]);
    }
    await app.capture("connection-down");
  },
);

// 4. A device that is not the admin.
const remote = base.responses.kleio_remote_status;
await both(
  healthy({
    responses: {
      kleio_remote_status: { active: { ...remote.active, admin: false }, paired: { ...remote.paired, admin: false } },
      kleio_admin_state: { unlocked: false, expiresAt: null, available: false },
      kleio_devices: [],
    },
    data: { setup: { admin: false, keys: { openai: "saved", composio: "saved", typesafe: "missing" } } },
  }),
  async (app) => {
    await open(app, "connection-not-admin");
    await app.capture("connection-not-admin", { scroll: false });
    await step("pair card", async () => {
      await reveal(app, app.page.getByText("Only an admin device can pair another device"));
      await app.capture("connection-not-admin-pair", { scroll: false });
    });
  },
);
await closeBrowser();
