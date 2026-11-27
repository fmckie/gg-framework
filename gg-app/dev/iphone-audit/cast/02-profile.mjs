// 2. A specialist opened: its chat (ThreadChat), the sidebar of cards (a drawer
// on the phone), its schedules card and the schedule dialog, the confirms.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, NOW, cast, makeApi, openCast, reportInputs } from "./common.mjs";

const history = {
  "blob-courier": [
    { role: "user", text: "[Scheduled: Flight watch] Watch the flights for the Lisbon offsite. Every 2 hours, check them and tell me only if a time or gate changes." },
    { role: "assistant", text: "No changes. All 12 flights are on time.\n\n| Flight | From | Lands |\n| --- | --- | --- |\n| TP1351 | London Heathrow | 21:40 |\n| EZY8521 | Manchester | 22:15 |\n| FR1884 | Dublin | 23:05 |" },
    { role: "user", text: "Which two land after 22:00, and is there still a metro at that hour?" },
    { role: "assistant", text: "EZY8521 (22:15) and FR1884 (23:05). The red line runs until 01:00; the last train to **Baixa-Chiado** leaves the airport at 00:38.\n\n```\ncurl https://api.flightaware.example/v1/flights/EZY8521?fields=gate,estimated_in,status\n```" },
    { role: "user", text: "Check again now please, and tell me the gate for TP1351." },
  ],
  "blob-ledger": [
    { role: "user", text: "[Scheduled: Friday receipts] Every Friday at 4pm, total the week’s receipts from Gmail by category and flag anything over €200." },
    { role: "assistant", text: "I couldn't read Gmail: it needs signing in again. Open **Connect apps** and reconnect Gmail, then run me again." },
  ],
};
const api = makeApi({ history, running: new Set(["blob-courier"]) });
const only = process.argv[2];
const want = (name) => !only || name.startsWith(only);

/** From the shelf: pick `name`, open its chat. */
async function openChat(app, name) {
  const actor = app.page.locator("button.cast-actor", { hasText: name }).first();
  await actor.scrollIntoViewIfNeeded();
  await app.tap(actor);
  await app.settle(400);
  const open = app.page.locator(".cast-p-actions button", { hasText: "Open chat" }).first();
  await open.scrollIntoViewIfNeeded();
  await app.tap(open);
  await app.settle(1500);
}
/** The sidebar of cards: a drawer on the phone (closed at first), beside the chat on the desktop. */
async function openSide(app) {
  const show = app.page.getByRole("button", { name: "Show sidebar" }).first();
  if (await show.isVisible().catch(() => false)) await app.tap(show);
  await app.settle(600);
}
const scene = { area: AREA, now: NOW, api, data: { blobs: cast.castRoster(7), groups: [] } };

if (want("profile-plain") || want("profile-sidebar") || want("specialist-delete"))
  await both(scene, async (app) => {
    await openCast(app);
    await openChat(app, "Scout");
    await app.capture("profile-plain");
    await reportInputs(app, "profile-plain");
    // A draft in the message box.
    await app.page.locator("textarea.input").fill("Research the best neighbourhoods in Lisbon for a team offsite of twelve, and give me the sources you used for each one please.");
    await app.settle(400);
    await app.capture("profile-draft");
    await app.page.locator("textarea.input").fill("");
    await openSide(app);
    await app.capture("profile-sidebar");
    // Delete specialist, from the sidebar's last card.
    const del = app.page.getByRole("button", { name: "Delete Scout" }).first();
    await del.scrollIntoViewIfNeeded();
    await app.tap(del);
    await app.settle(500);
    await app.capture("specialist-delete-confirm", { scroll: false });
    await app.tap(app.page.locator(".modal-actions button, .modal button", { hasText: "Cancel" }).first());
    // New conversation, from the header.
    const scrim = app.page.locator(".kleio-side-scrim").first();
    if (await scrim.isVisible().catch(() => false)) await scrim.tap({ position: { x: 380, y: 400 } }).catch(() => {});
    await app.settle(400);
    await app.tap(app.page.getByRole("button", { name: "New conversation" }).first());
    await app.settle(500);
    await app.capture("profile-new-confirm", { scroll: false });
  });

if (want("profile-working"))
  await both(scene, async (app) => {
    await openCast(app);
    await openChat(app, "Courier");
    await app.settle(1800); // the activity poll
    await app.capture("profile-working");
    await reportInputs(app, "profile-working");
    await openSide(app);
    await app.capture("profile-working-sidebar");
  });

if (want("profile-failed"))
  await both(scene, async (app) => {
    await openCast(app);
    await openChat(app, "Ledger");
    await app.capture("profile-failed");
    await openSide(app);
    await app.capture("profile-failed-sidebar");
  });

if (want("profile-schedules") || want("schedule"))
  await both(scene, async (app) => {
    await openCast(app);
    await openChat(app, "Chef");
    await openSide(app);
    const card = app.page.locator(".kleio-sched-list").first();
    await card.scrollIntoViewIfNeeded();
    await app.settle(300);
    await app.capture("profile-schedules");
    // Add.
    await app.tap(app.page.locator(".kleio-panel-action button", { hasText: "Add" }).first());
    await app.settle(500);
    await app.capture("schedule-form", { scroll: false });
    await reportInputs(app, "schedule-form");
    await app.tap(app.page.locator(".kleio-seg button", { hasText: "Weekly" }).first());
    await app.page.locator("#kleio-s-label").fill("Thursday top-up for the weekend dinners and the Sunday roast");
    await app.page.locator("#kleio-s-prompt").fill("Check what’s left from Sunday’s list and suggest a top-up shop.");
    await app.settle(400);
    await app.capture("schedule-form-weekly", { scroll: false });
    await reportInputs(app, "schedule-form-weekly");
    await app.tap(app.page.locator(".kleio-seg button", { hasText: "Repeat" }).first());
    await app.settle(300);
    await app.capture("schedule-form-repeat", { scroll: false });
    await app.tap(app.page.locator(".kleio-seg button", { hasText: "Once" }).first());
    await app.settle(300);
    await app.capture("schedule-form-once", { scroll: false });
    await reportInputs(app, "schedule-form-once");
    await app.tap(app.page.locator(".kleio-sched-form .modal-actions button", { hasText: "Cancel" }).first());
    await app.settle(400);
    // Edit the first schedule.
    const edit = app.page.locator(".kleio-sched-actions button", { hasText: "Edit" }).first();
    await edit.scrollIntoViewIfNeeded();
    await app.tap(edit);
    await app.settle(500);
    await app.capture("schedule-form-edit", { scroll: false });
    await app.tap(app.page.locator(".kleio-sched-form .modal-actions button", { hasText: "Cancel" }).first());
    await app.settle(400);
    // Run now: the flash line.
    const run = app.page.locator(".kleio-sched-actions button", { hasText: "Run now" }).first();
    await app.tap(run);
    await app.settle(500);
    await app.capture("profile-schedules-run", { scroll: false });
    // Delete a schedule.
    const bin = app.page.locator(".kleio-sched-actions button.is-danger").first();
    await app.tap(bin);
    await app.settle(500);
    await app.capture("schedule-delete-confirm", { scroll: false });
  });

await closeBrowser();
