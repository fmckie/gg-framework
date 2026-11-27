// First pass: every tab with the harness's base data, to see what each page asks for.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, openSettings, goTab, header } from "./_common.mjs";

await both({ area: AREA }, async (app) => {
  await openSettings(app);
  for (const name of ["Overview", "Kleio", "General", "AI Providers", "Connection", "Apps", "Tools", "Steroids", "About"]) {
    await goTab(app, name, 1200);
    await header(app, name);
    await app.capture(`probe-${name}`, { scroll: false });
  }
  const cmds = [...new Set(app.calls().map((c) => (c.cmd === "kleio_api" ? `kleio_api ${c.args?.method ?? "GET"} ${c.args?.path}` : c.cmd)))];
  console.log(`\n-- all calls (${app.device}):\n  ${cmds.join("\n  ")}`);
});
await closeBrowser();
