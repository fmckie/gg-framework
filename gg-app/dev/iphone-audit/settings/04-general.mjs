// General: the project folder row (field, Browse, Save), Effects, the saved toast; then Open existing's dialog.
import { both, closeBrowser } from "../lib.mjs";
import { healthy } from "./data.mjs";
import { openSettings, goTab, header, fields } from "./_common.mjs";
import { step, captureModal, toastBox } from "./_step2.mjs";

const LONG = "/Users/demo/Library/Mobile Documents/com~apple~CloudDocs/Work/Clients/Aurora Store GmbH/2026/projects-and-experiments";
const folders = [
  { name: "aurora-store", path: "/Users/demo/projects/aurora-store", hidden: false },
  { name: "internal-observability-and-incident-response-toolkit-production-eu-central", path: "/Users/demo/projects/internal-observability-and-incident-response-toolkit-production-eu-central", hidden: false },
  { name: "pixel-pipeline", path: "/Users/demo/projects/pixel-pipeline", hidden: false },
  { name: "rusty-parser", path: "/Users/demo/work/clients/rusty-parser", hidden: false },
  { name: "landing-page", path: "/Users/demo/projects/landing-page", hidden: true },
  ...Array.from({ length: 9 }, (_, i) => ({ name: `experiment-${i + 1}`, path: `/Users/demo/projects/experiment-${i + 1}`, hidden: false })),
];

await both(healthy({ responses: { app_settings_save: null } }), async (app) => {
  const { page } = app;
  await openSettings(app);
  await goTab(app, "General", 1500);
  await header(app, "general");
  await fields(app, "general");
  await app.capture("general");
  await step(app, "dirty", async () => {
    await app.tap(page.locator(".gn-page .modal-row button").first(), { settle: 300 }); // Sound: off
    await page.locator(".gn-lead input.tl-input").fill(LONG);
    await app.settle(300);
    await fields(app, "general-dirty");
    await app.capture("general-dirty", { scroll: false });
  });
  await step(app, "save", async () => {
    await app.tap(page.locator(".gn-save"), { settle: 450 });
    await toastBox(app, "general-saved");
    await app.capture("general-saved", { scroll: false });
  });
});

// HostFoldersModal is not opened from Settings: it is the project list's "Open existing".
await both(healthy({ responses: { agent_project_folders: { folders } } }), async (app) => {
  const { page } = app;
  await app.tap(page.getByRole("button", { name: "Code", exact: true }), { settle: 900 });
  await app.tap(page.getByRole("button", { name: /open existing/i }).first(), { settle: 1200 });
  await fields(app, "general-host-folders");
  await captureModal(app, "general-host-folders");
});
await closeBrowser();
