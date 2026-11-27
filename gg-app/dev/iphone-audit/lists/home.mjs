import { both, closeBrowser } from "../lib.mjs";

await both({ area: "lists" }, async (app) => {
  await app.capture("home");
});
await closeBrowser();
