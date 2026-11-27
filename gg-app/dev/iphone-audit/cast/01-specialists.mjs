// 1. Specialists list / shelf: empty, 3, 7, 26; the failed one picked; search.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, reportInputs } from "./common.mjs";

const api = makeApi();
const only = process.argv[2];
const run = async (screen, blobs, extra) => {
  if (only && !screen.startsWith(only)) return;
  await both({ area: AREA, now: NOW, api, data: { blobs, groups: [] } }, async (app) => {
    await openCast(app);
    await app.settle(800);
    await app.capture(screen);
    await reportInputs(app, screen);
    if (extra) await extra(app);
  });
};

await run("specialists-empty", []);
await run("specialists-3", cast.castRoster(7).slice(0, 3));
await run("specialists-7", cast.castRoster(7), async (app) => {
  // The failed one (Ledger): on the phone it stands past the right edge.
  const ledger = app.page.locator("button.cast-actor.is-failed").first();
  await ledger.scrollIntoViewIfNeeded();
  await app.settle(300);
  await app.tap(ledger);
  await app.settle(700);
  await app.capture("specialists-7-failed");
  // The paused one (Gardener): "Turn schedule on".
  const paused = app.page.locator("button.cast-actor.is-paused").first();
  await paused.scrollIntoViewIfNeeded();
  await app.tap(paused);
  await app.settle(700);
  await app.capture("specialists-7-paused");
  // Search in the header.
  await app.tap(app.page.getByRole("button", { name: "Search specialists" }).first());
  await app.settle(500);
  await app.page.locator("input.picker-search").fill("le");
  await app.settle(500);
  await app.capture("specialists-search");
  await reportInputs(app, "specialists-search");
});
await run("specialists-26", cast.castRoster(26), async (app) => {
  const failed = app.page.locator("button.cast-actor.is-failed").first();
  await failed.scrollIntoViewIfNeeded();
  await app.settle(300);
  await app.tap(failed);
  await app.settle(700);
  await app.capture("specialists-26-failed");
});
await closeBrowser();
