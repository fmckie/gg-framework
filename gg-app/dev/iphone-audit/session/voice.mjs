// Talk to Kleio from the home screen: whatever opens without a microphone, then its guide.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, probe } from "./common.mjs";

await both({ area: AREA }, async (app) => {
  const { page } = app;
  const talk = page.locator(".home-brief").first();
  console.log(`\n-- ${app.device} home-brief: "${await talk.innerText().catch(() => "(none)")}"`);
  await app.tap(talk);
  await app.settle(3500);
  await app.capture("voice-orb", { scroll: false });
  await probe(app, "voice-orb", [".voice-mode", ".voice-corner", ".voice-corner .icon-circle", ".voice-stage", ".voice-orb", ".voice-orb-fallback", ".voice-words", ".voice-status", ".voice-error", ".voice-controls", ".voice-button", ".voice-button-label"]);
  await app.tap(page.getByRole("button", { name: "What Kleio Voice can do" }));
  await app.settle(900);
  await app.capture("voice-guide", { scroll: false });
  await probe(app, "voice-guide", [".modal", ".modal-head", ".modal-close", ".voice-guide-intro", ".session-help-body", ".session-help-grid", ".session-help-row", "kbd"]);
});
await closeBrowser();
