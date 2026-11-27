// A run in flight (text, tool rows, 4 sub-agents + the Olympus lane), a wide table, then finished.
import { both, closeBrowser, enterSession } from "../lib.mjs";
import { AREA, TABLE_REPLY, finishRun, probe, seedAgents, seedText, seedTools, startRun } from "./common.mjs";

await both({ area: AREA }, async (app) => {
  await enterSession(app);
  await startRun(app);
  await seedAgents(app, 4);
  await seedText(app);
  await seedTools(app);
  await app.settle(2500); // the lane raises itself
  await app.capture("transcript-run");
  await probe(app, "transcript-run", [".oly-lane", ".oly-gods > *", ".oly-names > *", ".subagent-row", ".tool-row", ".liveregion", ".liveregion .tools-toggle", ".live-tool-panel", ".user-msg", ".transcript", ".inputwrap", ".footer", ".footer-left", ".footer-right"]);
  await app.capture("gods-lane-4", { element: ".oly-lane", scroll: false });

  await app.emit("text_delta", { text: TABLE_REPLY });
  await app.settle(1500);
  await app.page.evaluate(() => document.querySelector(".transcript .markdown table")?.scrollIntoView({ block: "center" }));
  await app.settle(300);
  await app.capture("transcript-table", { scroll: false });
  await probe(app, "transcript-table", [".transcript .markdown table", ".transcript .markdown table th", ".transcript"]);

  await finishRun(app);
  await app.page.evaluate(() => {
    const t = document.querySelector(".transcript");
    if (t) t.scrollTop = 0;
  });
  await app.settle(300);
  await app.capture("transcript-done");
  await probe(app, "transcript-done", [".user-msg", ".user-msg button", ".msg-actions", ".msg-actions button", ".copy-btn", ".transcript button", ".oly-lane", ".liveregion", ".run-summary", ".footer"]);
});
await closeBrowser();
