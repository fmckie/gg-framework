import { both, closeBrowser } from "../lib.mjs";
import { motions, sessionsFor } from "./data.mjs";
import { chain, rects, workspace } from "./extra.mjs";

const open = async (app) => {
  await app.tap(app.page.getByRole("button", { name: "Motion", exact: true }));
  await app.settle(900);
};
const only = process.argv[2];
const want = (k) => !only || only === k;

if (want("empty"))
  await both({ area: "lists", invoke: chain(sessionsFor({ motion: [] }), workspace()) }, async (app) => {
    await open(app);
    await app.capture("motion-empty");
    // "+ New video" opens a fresh Motion session: the starters sit above the composer.
    await app.tap(app.page.locator(".chat-browser-new").first(), { settle: 1800 });
    await app.capture("motion-starters");
    await rects(app, "motion-starters", [".motion-starters", ".motion-starter"], 8);
  });

if (want("few"))
  await both({ area: "lists", invoke: sessionsFor({ motion: motions(3) }) }, async (app) => {
    await open(app);
    await app.capture("motion-few");
    await rects(app, "motion-few", [".chat-browser-item", ".chat-browser-item-title", ".chat-browser-item-date", ".chat-browser-item-meta", ".picker-hide"]);
    const search = app.page.locator(".chat-browser-search input");
    await app.tap(search);
    await search.fill("logo");
    await app.settle(300);
    await app.capture("motion-search", { scroll: false });
  });

if (want("long"))
  await both({ area: "lists", invoke: sessionsFor({ motion: motions(32) }) }, async (app) => {
    await open(app);
    await app.capture("motion-long");
  });

await closeBrowser();
