// groups-1 on the desktop (the first run was interrupted after the phone).
import { closeBrowser, compare, withApp } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, switchTab } from "./common.mjs";
await withApp("desktop", { area: AREA, now: NOW, api: makeApi(), data: { blobs: cast.castRoster(26), groups: cast.castGroups(1).groups } }, async (app) => {
  await openCast(app);
  await switchTab(app, "Groups");
  await app.settle(800);
  await app.capture("groups-1", { scroll: false });
});
await compare(AREA, "groups-1");
await closeBrowser();
