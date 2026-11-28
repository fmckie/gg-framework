// 5. The group form: new (empty, 8 members and a long name), edit, its delete confirm.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, reportInputs, switchTab } from "./common.mjs";

const api = makeApi();
const only = process.argv[2];
const want = (name) => !only || name.startsWith(only);
const blobs = cast.castRoster(26);
const groups = cast.castGroups(12).groups;
const scene = { area: AREA, now: NOW, api, data: { blobs, groups } };

async function sizes(app, screen) {
  const rows = await app.page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}@${Math.round(r.left)},${Math.round(r.top)}`;
    };
    const out = [];
    for (const sel of [".kleio-member-pick", ".kleio-check", ".cast-gstage", ".cast-gstage .cast-slot", ".cast-name-input", ".cast-gform-who", ".kleio-member-sub", ".kleio-member-name"]) {
      const els = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
      if (els.length) out.push(`${sel} (${els.length}): ${els.slice(0, 9).map(box).join(" ")}`);
    }
    const input = document.querySelector(".cast-name-input");
    if (input) out.push(`name input scrollWidth ${input.scrollWidth} clientWidth ${input.clientWidth} font ${getComputedStyle(input).fontSize}`);
    const who = document.querySelector(".cast-gform-who");
    if (who) out.push(`who scrollWidth ${who.scrollWidth} clientWidth ${who.clientWidth} scrollHeight ${who.scrollHeight} clientHeight ${who.clientHeight}`);
    return out;
  });
  console.log(`\n-- ${screen} (${app.device}) sizes:\n   ${rows.join("\n   ")}`);
}

if (want("group-form-new") || want("group-form-filled"))
  await both(scene, async (app) => {
    await openCast(app);
    await switchTab(app, "Groups");
    await app.tap(app.page.locator(".picker-head-actions button", { hasText: "New group" }).first());
    await app.settle(800);
    await app.capture("group-form-new", { scroll: false });
    if (app.isPhone) {
      await app.page.locator(".cast-what .cast-card").last().evaluate((el) => el.scrollIntoView({ block: "end" }));
      await app.settle(300);
      await app.capture("group-form-new-end", { scroll: false });
    }
    await reportInputs(app, "group-form-new");
    await sizes(app, "group-form-new");
    await app.page.locator("input.cast-name-input").fill("Lisbon offsite planning and budget crew");
    const picks = app.page.locator("button.kleio-member-pick");
    for (let i = 0; i < 8; i++) {
      await picks.nth(i).scrollIntoViewIfNeeded();
      await app.tap(picks.nth(i), { settle: 120 });
    }
    await app.settle(400);
    await app.page.locator(".cast-creator").first().evaluate((el) => (el.scrollTop = 0)).catch(() => {});
    await app.page.evaluate(() => {
      for (const el of document.querySelectorAll("*")) if (el.scrollTop > 0) el.scrollTop = 0;
    });
    await app.settle(300);
    await app.capture("group-form-filled", { scroll: false });
    if (app.isPhone) {
      await app.page.locator(".kleio-member-picks").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await app.settle(300);
      await app.capture("group-form-filled-members", { scroll: false });
    }
    await sizes(app, "group-form-filled");
  });

if (want("group-form-edit") || want("group-remove"))
  await both(scene, async (app) => {
    await openCast(app);
    await switchTab(app, "Groups");
    // Travel desk: one of its three members has been deleted.
    const t = app.page.locator("button.cast-troupe", { hasText: "Travel desk" }).first();
    await t.scrollIntoViewIfNeeded();
    await app.tap(t);
    const edit = app.page.locator(".cast-p-actions button", { hasText: "Edit" }).first();
    await edit.scrollIntoViewIfNeeded();
    await app.tap(edit);
    await app.settle(900);
    await app.capture("group-form-edit", { scroll: false });
    await sizes(app, "group-form-edit");
    const del = app.page.locator("button.kleio-danger-btn").first();
    await del.scrollIntoViewIfNeeded();
    await app.settle(300);
    await app.capture("group-form-edit-end", { scroll: false });
    await app.tap(del);
    await app.settle(500);
    await app.capture("group-remove-confirm", { scroll: false });
  });

await closeBrowser();
