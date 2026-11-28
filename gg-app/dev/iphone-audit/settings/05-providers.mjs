// AI Providers: signed-in and signed-out, the sign-in dialog (API key, the method chooser, OAuth's code), manage, local models, Hugging Face.
import { both, closeBrowser } from "../lib.mjs";
import { healthy, providersMixed, providersNone, localMany, localNone } from "./data.mjs";
import { openSettings, goTab, header, fields } from "./_common.mjs";
import { step, captureModal, closeModal } from "./_step2.mjs";

const xaiGuide = [
  { method: "oauth", label: "Sign in with Grok", billing: "Uses your SuperGrok or X Premium+ plan.", when: "Choose this if you already pay for Grok.", requires: "A SuperGrok or X Premium+ subscription" },
  { method: "apikey", label: "xAI API key", billing: "Pay per token, billed on console.x.ai.", when: "Choose this for metered use, or as a fallback when the plan runs out." },
];
const claudeGuide = [
  { method: "oauth", label: "Sign in with Claude", billing: "Uses your Claude Pro or Max plan.", when: "Choose this if you already pay for Claude." },
  { method: "apikey", label: "Anthropic API key", billing: "Pay per token, billed on console.anthropic.com.", when: "Covers you when the plan's window runs out." },
];
const note = "With both connected, your subscription is used first; the API key takes over while its usage window is spent.";
const mixed = providersMixed.map((p) =>
  p.value === "xai" ? { ...p, methodGuidance: xaiGuide, priorityNote: note } : p.value === "anthropic" ? { ...p, activeMethod: "oauth", methodGuidance: claudeGuide, priorityNote: note } : p,
);
const common = { agent_hf_pull_status: { active: null }, agent_hf_search: { models: [] }, agent_auth_oauth_start: null, app_auth_apikey: null };

await both(healthy({ responses: { ...common, app_auth_status: { providers: mixed }, agent_local: localMany, agent_local_scan: localMany } }), async (app) => {
  const { page } = app;
  await openSettings(app);
  await goTab(app, "AI Providers", 1800);
  await header(app, "providers");
  await app.capture("providers");
  await step(app, "apikey", async () => {
    await app.tap(page.locator('.pv-add-row[aria-label^="Add Google Gemini"]'), { settle: 900 });
    await page.locator(".modal input.modal-input").first().fill("AIzaSy-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFG");
    await fields(app, "providers-login-apikey");
    await captureModal(app, "providers-login-apikey");
  });
  await closeModal(app);
  await step(app, "choose", async () => {
    await app.tap(page.locator('.pv-add-row[aria-label^="Add xAI"]'), { settle: 900 });
    await captureModal(app, "providers-login-choose");
  });
  await step(app, "oauth", async () => {
    await app.tap(page.locator(".login-method-card").first().locator("button").first(), { settle: 500 });
    await app.tap(page.locator(".modal .modal-actions .modal-btn.primary"), { settle: 500 });
    await app.emit("auth_url", { provider: "xai", url: "https://accounts.x.ai/oauth2/auth?client_id=kleio" });
    await app.emit("auth_need_code", { provider: "xai", message: "Paste the code from the browser:" });
    await app.settle(500);
    await fields(app, "providers-login-oauth");
    await captureModal(app, "providers-login-oauth");
  });
  await closeModal(app);
  await step(app, "manage", async () => {
    await app.tap(page.locator('.pv-node.pv-out[aria-label^="Anthropic"]'), { settle: 900 });
    await captureModal(app, "providers-login-manage");
  });
  await closeModal(app);
  await step(app, "local", async () => {
    await app.tap(page.locator('.pv-node.pv-in[aria-label^="Ollama"]'), { settle: 1300 });
    await captureModal(app, "providers-local");
    await app.tap(page.locator(".modal .modal-actions .modal-btn").first(), { settle: 500 }); // Add endpoint
    await fields(app, "providers-local-add");
    await captureModal(app, "providers-local-add");
  });
  await closeModal(app);
  await step(app, "hf", async () => {
    await app.tap(page.locator('.pv-node.pv-in[aria-label^="Hugging Face"]'), { settle: 1300 });
    await fields(app, "providers-hf");
    await captureModal(app, "providers-hf");
  });
  await closeModal(app);
});

// Nothing signed in, no private server answering.
await both(healthy({ responses: { ...common, app_auth_status: { providers: providersNone }, agent_local: localNone, agent_local_scan: localNone } }), async (app) => {
  await openSettings(app);
  await goTab(app, "AI Providers", 1800);
  await header(app, "providers-none");
  await app.capture("providers-none");
});
await closeBrowser();
