// Session header (expanded + collapsed) and the wake screen of a fresh code session.
import { both, closeBrowser, enterSession } from "../lib.mjs";

await both({ area: "session" }, async (app) => {
  await enterSession(app);
  // Let the wake screen's animation finish.
  await app.settle(4500);
  await app.capture("header", { element: ".chat-head", scroll: false });
  await app.capture("wake", { scroll: false });
  await app.tap(app.page.locator(".nav-toggle"));
  await app.settle(600);
  await app.capture("header-collapsed", { element: ".chat-head", scroll: false });
});
await closeBrowser();
