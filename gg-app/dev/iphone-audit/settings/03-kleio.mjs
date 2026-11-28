// The Kleio tab: voice ready / not ready, memories present / absent, Brain, the voice guide, the key forms.
import { both, closeBrowser } from "../lib.mjs";
import { healthy, noMemories, noJiwa } from "./data.mjs";
import { openSettings, goTab, header, fields } from "./_common.mjs";

const voiceOff = { ready: false, voice: "marin", model: "gpt-realtime", voices: ["marin", "cedar", "alloy"], speed: 1 };

// 1. Voice ready, six memories (long ones), dictation ready, no Typesafe key.
await both(healthy(), async (app) => {
  const { page } = app;
  await openSettings(app);
  await goTab(app, "Kleio", 1800);
  await header(app, "kleio-ready");
  await fields(app, "kleio-ready");
  await app.capture("kleio-ready");

  // Group chats: the Typesafe key form behind its disclosure.
  const summary = page.locator(".kl-disclose > summary");
  await summary.scrollIntoViewIfNeeded();
  await app.tap(summary, { settle: 600 });
  await fields(app, "kleio-typesafe-form");
  await app.capture("kleio-typesafe-form", { scroll: false });
  await app.tap(summary, { settle: 300 });

  // Remove: the OpenAI key's first step, then its confirm.
  const remove = page.getByRole("button", { name: "Remove OpenAI key" }).first();
  await remove.scrollIntoViewIfNeeded();
  await app.capture("kleio-remove", { scroll: false });
  await app.tap(remove, { settle: 600 });
  await app.capture("kleio-remove-confirm", { scroll: false });
  await app.tap(page.getByRole("button", { name: "Cancel" }).first(), { settle: 300 }).catch(() => {});

  // What Kleio Voice can do.
  const guide = page.locator(".kl-guide");
  await guide.scrollIntoViewIfNeeded();
  await app.tap(guide, { settle: 900 });
  await app.capture("kleio-voice-guide");
  await page.keyboard.press("Escape");
  await app.settle(500);
  if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
    await app.tap(page.locator('[role="dialog"] button').first(), { settle: 500 }).catch(() => {});
  }

  // Brain: the list, then the add form.
  const brain = page.getByRole("button", { name: "Open Brain" });
  await brain.scrollIntoViewIfNeeded();
  await app.tap(brain, { settle: 1500 });
  await fields(app, "kleio-brain");
  await app.capture("kleio-brain");
  const add = page.locator(".memory-modal").getByRole("button", { name: /add/i }).first();
  if (await add.isVisible().catch(() => false)) {
    await app.tap(add, { settle: 700 });
    await fields(app, "kleio-brain-add");
    await app.capture("kleio-brain-add");
  } else console.log("!! no Add button in Brain");
});

// 2. Voice not ready (the key field shows), nothing kept, dictation not downloaded, Typesafe saved.
await both(
  healthy({
    responses: { agent_memories: noMemories, agent_jiwa: noJiwa },
    data: { voice: voiceOff, setup: { admin: true, keys: { openai: "missing", composio: "saved", typesafe: "saved" } } },
    api: (req) =>
      req.method === "GET" && req.path === "/kleio/setup/dictation"
        ? { status: 200, body: { dictation: { state: "absent", bytes: 138_853_314 } } }
        : undefined,
  }),
  async (app) => {
    await openSettings(app);
    await goTab(app, "Kleio", 1800);
    await fields(app, "kleio-not-ready");
    await app.capture("kleio-not-ready");
    // Type a key so Save is live.
    const key = app.page.locator(".kl-voice-key input").first();
    if (await key.isVisible().catch(() => false)) {
      await key.fill("sk-proj-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
      await app.settle(300);
      await app.capture("kleio-not-ready-key-typed", { scroll: false });
    }
  },
);

// 3. Not the admin device: nothing can be changed here.
await both(
  healthy({ data: { voice: voiceOff, setup: { admin: false, keys: { openai: "missing", composio: "saved", typesafe: "missing" } } } }),
  async (app) => {
    await openSettings(app);
    await goTab(app, "Kleio", 1800);
    await app.capture("kleio-not-admin");
  },
);
await closeBrowser();
