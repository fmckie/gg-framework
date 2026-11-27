// The tab bar: all nine tabs, at the first and at the last tab, and the alert dot.
import { both, closeBrowser } from "../lib.mjs";
import { healthy, steroids } from "./data.mjs";
import { openSettings, goTab, header } from "./_common.mjs";

async function tabs(app, label) {
  const rows = await app.page.evaluate(() => {
    const bar = document.querySelector(".settings-tabs");
    const dock = document.querySelector(".settings-tab-dock");
    const b = (el) => {
      const r = el.getBoundingClientRect();
      return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const pill = document.querySelector(".settings-tabs-pill");
    return {
      dock: b(dock),
      bar: { ...b(bar), scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, overflowX: getComputedStyle(bar).overflowX },
      pill: b(pill),
      tabs: [...bar.querySelectorAll("[role=tab]")].map((t) => {
        const label = t.querySelector(".settings-tab-label");
        const dot = t.querySelector(".settings-tab-alert");
        return {
          name: t.getAttribute("aria-label"),
          selected: t.getAttribute("aria-selected"),
          title: t.getAttribute("title"),
          ...b(t),
          label: label ? getComputedStyle(label).display : null,
          labelBox: label && getComputedStyle(label).display !== "none" ? b(label) : null,
          dot: dot ? { ...b(dot), bg: getComputedStyle(dot).backgroundColor } : null,
        };
      }),
    };
  });
  console.log(`\n-- tabs ${label} (${app.device})\n  dock ${JSON.stringify(rows.dock)}\n  bar ${JSON.stringify(rows.bar)}\n  pill ${JSON.stringify(rows.pill)}`);
  for (const t of rows.tabs) console.log(`  ${JSON.stringify(t)}`);
}

// Steroids installed and failing: the one state that lights the tab's dot (settingsLayout.tsx).
await both(healthy({ responses: { agent_steroids_status: steroids.failing } }), async (app) => {
  await openSettings(app);
  await goTab(app, "Overview");
  await tabs(app, "start");
  await header(app, "Overview");
  await app.capture("tabbar-start", { scroll: false, element: ".settings-tab-dock" });
  await goTab(app, "About", 1500);
  await tabs(app, "end");
  await header(app, "About");
  await app.capture("tabbar-end", { scroll: false, element: ".settings-tab-dock" });
  // A middle tab with the longest name.
  await goTab(app, "AI Providers", 1500);
  await tabs(app, "middle");
  await app.capture("tabbar-middle", { scroll: false, element: ".settings-tab-dock" });
});
await closeBrowser();
