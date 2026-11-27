// About: the maker's page; its one link.
import { both, closeBrowser } from "../lib.mjs";
import { healthy } from "./data.mjs";
import { openSettings, goTab, header } from "./_common.mjs";

await both(healthy(), async (app) => {
  await openSettings(app);
  await goTab(app, "About", 1800);
  await header(app, "about");
  const boxes = await app.page.evaluate(() =>
    [".ab-device", ".ab-sign", ".ab-wordmark", ".ab-tagline", ".ab-name", ".ab-statement", ".ab-link", ".ab-colophon", ".ab-version"].map((s) => {
      const el = document.querySelector(s);
      if (!el) return `${s} (none)`;
      const r = el.getBoundingClientRect();
      return `${s} ${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)} font ${getComputedStyle(el).fontSize}`;
    }),
  );
  console.log(`-- about boxes (${app.device})\n  ${boxes.join("\n  ")}`);
  await app.capture("about");
});
await closeBrowser();
