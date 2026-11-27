// 7. The Apps page reached from "Connect apps" on the Specialists list.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, reportInputs } from "./common.mjs";

const toolkits = [
  ["gmail", "Gmail", "Read, search and send email.", "signin"],
  ["notion", "Notion", "Pages and databases in your workspace.", "signin"],
  ["googlecalendar", "Google Calendar", "Events, invitations and free time.", "signin"],
  ["dropbox", "Dropbox", "Files and folders.", "signin"],
  ["reddit", "Reddit", "Posts and comments from communities you follow.", "setup"],
  ["hackernews", "Hacker News", "Front page stories and comments.", "none"],
].map(([slug, name, description, auth]) => ({ slug, name, logo: null, description, categories: ["productivity"], auth }));
const api = makeApi({ toolkits });
await both({ area: AREA, now: NOW, api, data: { blobs: cast.castRoster(7), groups: [] } }, async (app) => {
  await openCast(app);
  await app.tap(app.page.locator("button.kleio-apps-btn").first());
  await app.settle(1500);
  await app.capture("cast-apps", { scroll: false });
  await reportInputs(app, "cast-apps");
});
await closeBrowser();
