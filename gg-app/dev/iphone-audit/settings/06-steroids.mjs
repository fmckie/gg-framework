// Steroids: not installed (and installing), installed and connected, installed with an empty corpus, installed and failing.
import { both, closeBrowser } from "../lib.mjs";
import { healthy, steroids } from "./data.mjs";
import { openSettings, goTab, header } from "./_common.mjs";
import { step, toastBox } from "./_step2.mjs";

const open = async (app, name) => {
  await openSettings(app);
  await goTab(app, "Steroids", 1500);
  await header(app, name);
  await app.capture(name);
};
await both(
  healthy({
    responses: { agent_steroids_status: steroids.none },
    invoke: (cmd) => (cmd === "agent_steroids_install" ? new Promise((r) => setTimeout(() => r(steroids.ok), 1500)) : undefined),
  }),
  async (app) => {
    await open(app, "steroids-none");
    await step(app, "install", async () => {
      await app.tap(app.page.locator(".sr-install"), { settle: 350 });
      await app.capture("steroids-installing", { scroll: false });
      await app.settle(1600);
      await toastBox(app, "steroids-installed");
      await app.capture("steroids-installed", { scroll: false });
    });
  },
);
for (const [name, status] of [["steroids-ok", steroids.ok], ["steroids-empty", steroids.empty], ["steroids-failing", steroids.failing]]) {
  await both(healthy({ responses: { agent_steroids_status: status } }), (app) => open(app, name));
}
await closeBrowser();
