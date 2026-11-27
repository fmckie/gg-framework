// 3. The specialist form: new (empty, filled, the Brain select open), edit with
// its schedules (the week, the editor), the discard and delete confirms.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, reportInputs } from "./common.mjs";

const api = makeApi();
const only = process.argv[2];
const want = (name) => !only || name.startsWith(only);
const scene = { area: AREA, now: NOW, api, data: { blobs: cast.castRoster(7), groups: [] } };
const LONG_JOB =
  "Every weekday at 7:30, read the overnight email from the venue, the caterer and the travel agent for the Lisbon offsite, " +
  "check each one against the budget spreadsheet and the agenda, and send me one short summary: what changed, what it costs, " +
  "who needs a reply today, and anything over €200 that I have not approved yet. If nothing changed, say so in one line. " +
  "On Fridays add the week's total by category and a list of the invoices still unpaid, oldest first.";

/** Sizes of the form's switches and look options, which the record leaves out
 *  (a switch's input is transparent; its label is the target). */
async function extras(app, screen) {
  const rows = await app.page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}@${Math.round(r.left)},${Math.round(r.top)}`;
    };
    const out = [];
    for (const sel of [".cast-switch", ".cl-switch", ".kleio-look-option", ".cast-mark", ".cast-days button", ".cast-seg button", ".cast-check", ".cast-shuffle", ".kleio-example", ".dropdown-trigger", ".dropdown-option, .dropdown-item, [role=option]", ".cast-week > li", ".kleio-member-pick", ".kleio-check"]) {
      const els = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
      if (els.length) out.push(`${sel} (${els.length}): ${els.slice(0, 9).map(box).join(" ")}`);
    }
    return out;
  });
  console.log(`\n-- ${screen} (${app.device}) sizes:\n   ${rows.join("\n   ")}`);
}

if (want("specialist-form-new") || want("specialist-form-filled"))
  await both(scene, async (app) => {
    await openCast(app);
    await app.tap(app.page.locator(".picker-head-actions button", { hasText: "New specialist" }).first());
    await app.settle(800);
    await app.capture("specialist-form-new");
    await reportInputs(app, "specialist-form-new");
    await extras(app, "specialist-form-new");
    // Filled: the longest name the field takes, a long job.
    await app.page.locator("input.cast-name-input").fill("Offsite Coordinator and Budget Watchdog 9");
    await app.page.locator("textarea.cast-job-text").fill(LONG_JOB);
    await app.settle(500);
    await app.capture("specialist-form-filled");
    await reportInputs(app, "specialist-form-filled");
    // The look picker: pick another shape, face and colour.
    const opts = app.page.locator(".kleio-look-option");
    await opts.nth(3).scrollIntoViewIfNeeded();
    await app.tap(opts.nth(3));
    await app.settle(300);
    await app.capture("specialist-form-look", { scroll: false, element: ".cast-pickers" });
    // The Brain select, open.
    const brain = app.page.locator(".cast-brain .dropdown-trigger").first();
    await brain.scrollIntoViewIfNeeded();
    await app.tap(brain);
    await app.settle(500);
    await app.capture("specialist-form-model", { scroll: false });
    await extras(app, "specialist-form-model");
  });

if (want("specialist-form-edit") || want("specialist-form-schedule"))
  await both(scene, async (app) => {
    await openCast(app);
    const actor = app.page.locator("button.cast-actor", { hasText: "Chef" }).first();
    await app.tap(actor);
    const edit = app.page.locator(".cast-p-actions button", { hasText: "Edit" }).first();
    await edit.scrollIntoViewIfNeeded();
    await app.tap(edit);
    await app.settle(900);
    await app.capture("specialist-form-edit");
    await reportInputs(app, "specialist-form-edit");
    await extras(app, "specialist-form-edit");
    // The schedule editor, in view.
    const se = app.page.locator(".cast-se").first();
    await se.scrollIntoViewIfNeeded();
    await app.settle(400);
    await app.capture("specialist-form-schedule", { scroll: false, element: ".cast-sched-card" });
    // Change it: Cancel and Save schedule replace Run now.
    await app.tap(app.page.locator(".cast-seg button", { hasText: "Repeat" }).first());
    await app.settle(400);
    await se.scrollIntoViewIfNeeded();
    await app.capture("specialist-form-schedule-dirty", { scroll: false, element: ".cast-sched-card" });
    await app.tap(app.page.locator(".cast-seg button", { hasText: "Once" }).first());
    await app.settle(400);
    await app.page.locator(".cast-se-foot").first().scrollIntoViewIfNeeded();
    await app.capture("specialist-form-schedule-once", { scroll: false, element: ".cast-sched-card" });
    await reportInputs(app, "specialist-form-schedule-once");
    // Leave with it unsaved: the discard confirm.
    await app.tap(app.page.locator(".picker-head-actions button", { hasText: "Cancel" }).first());
    await app.settle(500);
    await app.capture("specialist-form-discard", { scroll: false });
    await app.tap(app.page.locator(".modal button", { hasText: "Keep editing" }).first());
    await app.settle(300);
    // Put it back, then delete it: the confirm.
    await app.tap(app.page.locator(".cast-se-foot button", { hasText: "Cancel" }).first());
    await app.settle(400);
    const bin = app.page.locator(".cast-se-foot button.is-danger").first();
    await bin.scrollIntoViewIfNeeded();
    await app.tap(bin);
    await app.settle(500);
    await app.capture("specialist-form-schedule-delete", { scroll: false });
    await app.tap(app.page.locator(".modal button", { hasText: "Cancel" }).first());
    // Add a new one.
    const add = app.page.locator(".cast-card-head button", { hasText: "Add" }).first();
    await add.scrollIntoViewIfNeeded();
    await app.tap(add);
    await app.settle(500);
    await app.page.locator(".cast-se").first().scrollIntoViewIfNeeded();
    await app.capture("specialist-form-schedule-new", { scroll: false, element: ".cast-sched-card" });
    await reportInputs(app, "specialist-form-schedule-new");
  });

await closeBrowser();
