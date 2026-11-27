import { both, closeBrowser, enterSession } from "./lib.mjs";

await both({ area: "smoke" }, async (app) => {
  await app.capture("home");
  await enterSession(app);
  await app.capture("session-empty");
});
await closeBrowser();
