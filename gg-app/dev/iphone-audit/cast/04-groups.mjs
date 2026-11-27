// 4. The Groups list: none, 1, 3, 12 (long names, a group whose members are all gone).
import { both, closeBrowser } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, switchTab } from "./common.mjs";

const api = makeApi();
const only = process.argv[2];
const blobs = cast.castRoster(26);
// Made-up long names over the fixture's twelve (the form allows 40 characters).
const twelve = cast.castGroups(12).groups.map((g) =>
  g.name === "Money desk"
    ? { ...g, name: "Household money desk and tax paperwork 1" }
    : g.name === "Study hall"
      ? { ...g, name: "Thursday seminar reading and revision" }
      : g,
);
const run = async (screen, groups, extra) => {
  if (only && !screen.startsWith(only)) return;
  await both({ area: AREA, now: NOW, api, data: { blobs, groups } }, async (app) => {
    await openCast(app);
    await switchTab(app, "Groups");
    await app.settle(800);
    await app.capture(screen, { scroll: app.isPhone });
    if (extra) await extra(app);
  });
};
const pick = async (app, name, screen) => {
  const t = app.page.locator("button.cast-troupe", { hasText: name }).first();
  await t.scrollIntoViewIfNeeded();
  await app.settle(300);
  await app.tap(t);
  await app.settle(600);
  if (app.isPhone) await app.page.locator(".cast-profile").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await app.settle(300);
  await app.capture(screen, { scroll: false });
};

await run("groups-3", cast.castGroups(3).groups);
await run("groups-12", twelve, async (app) => {
  await pick(app, "Household money desk", "groups-12-long");
  await pick(app, "Old project", "groups-12-gone");
  await pick(app, "Thursday seminar", "groups-12-eight");
});
await closeBrowser();
