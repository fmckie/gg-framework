// 6. A group's room: four and eight members mid-turn, a draft, a mention, the
// assets panel, the new-conversation confirm.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, reportInputs, switchTab } from "./common.mjs";

const only = process.argv[2];
const want = (name) => !only || name.startsWith(only);

async function openRoom(app) {
  await openCast(app);
  await switchTab(app, "Groups");
  const open = app.page.locator(".cast-p-actions button", { hasText: "Open chat" }).first();
  await open.scrollIntoViewIfNeeded();
  await app.tap(open);
  await app.settle(2200);
}
async function sizes(app, screen) {
  const rows = await app.page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}@${Math.round(r.left)},${Math.round(r.top)}`;
    };
    const out = [];
    for (const sel of [".cast-room-stage", ".cast-room-members", ".cast-member", ".cast-mentions", ".cast-mentions button", ".cast-input", ".cast-input textarea", ".cast-send", ".cast-input .dictate-btn", ".cast-thread", ".cast-room-side", ".cast-tiles button", ".cast-bub", ".kleio-file, .file-card"]) {
      const els = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
      if (els.length) out.push(`${sel} (${els.length}): ${els.slice(0, 9).map(box).join(" ")}`);
    }
    for (const sel of [".cast-room-members", ".cast-mentions", ".cast-room-stage", ".cast-thread"]) {
      const el = document.querySelector(sel);
      if (el) out.push(`${sel} scrollWidth ${el.scrollWidth} clientWidth ${el.clientWidth} overflow-x ${getComputedStyle(el).overflowX}`);
    }
    const ta = document.querySelector(".cast-input textarea");
    if (ta) out.push(`textarea font ${getComputedStyle(ta).fontSize} scrollHeight ${ta.scrollHeight} clientHeight ${ta.clientHeight}`);
    return out;
  });
  console.log(`\n-- ${screen} (${app.device}) sizes:\n   ${rows.join("\n   ")}`);
}

for (const size of [4, 8]) {
  if (!want(`room-${size}`) && !(size === 4 && (want("room-draft") || want("room-mention") || want("room-sidebar") || want("room-new")))) continue;
  const room = cast.castGroup(size);
  const scene = {
    area: AREA,
    now: NOW,
    api: makeApi({ room }),
    data: { blobs: cast.castRoster(26), groups: [room.group] },
  };
  await both(scene, async (app) => {
    await openRoom(app);
    await app.capture(`room-${size}`, { scroll: false });
    await reportInputs(app, `room-${size}`);
    await sizes(app, `room-${size}`);
    // The top of the thread (the first messages, the file cards).
    await app.page.locator(".cast-thread").evaluate((el) => (el.scrollTop = 0));
    await app.settle(400);
    if (size === 4) await app.capture("room-4-top", { scroll: false });
    await app.page.locator(".cast-thread").evaluate((el) => (el.scrollTop = el.scrollHeight));
    if (size !== 4) {
      // The strip of eight mention chips, and a mention from the shelf.
      await app.tap(app.page.locator(".cast-mentions button").nth(1));
      await app.settle(400);
      await app.capture("room-8-mention", { scroll: false });
      await sizes(app, "room-8-mention");
      return;
    }
    // A draft of several lines.
    const box = app.page.locator(".cast-input textarea");
    await box.fill("Thanks both. Before the invite goes out, can someone confirm the deposit is refundable if we drop below ten, and whether the set menu has a vegetarian option for Priya and Joel?");
    await app.settle(500);
    await app.capture("room-draft", { scroll: false });
    await sizes(app, "room-draft");
    await box.fill("");
    // A mention: there is no menu, the chips above the box add "@Name ".
    await app.tap(app.page.locator(".cast-mentions button").first());
    await app.settle(400);
    await box.pressSequentially("@");
    await app.settle(500);
    await app.capture("room-mention", { scroll: false });
    await box.fill("");
    // The assets panel (a drawer on the phone).
    await app.tap(app.page.getByRole("button", { name: "Assets" }).first());
    await app.settle(700);
    await app.capture("room-sidebar", { scroll: false });
    await sizes(app, "room-sidebar");
    const scrim = app.page.locator(".cast-room-scrim").first();
    if (await scrim.isVisible().catch(() => false)) await scrim.tap({ position: { x: 20, y: 400 } }).catch(() => {});
    await app.settle(400);
  });
}
await closeBrowser();
