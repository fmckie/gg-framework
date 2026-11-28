import { both, closeBrowser } from "../lib.mjs";
import { ROOT, hostFolders, projects, sessions, sessionsFor } from "./data.mjs";
import { chain, rects } from "./extra.mjs";

const open = async (app) => {
  await app.tap(app.page.getByRole("button", { name: "Code", exact: true }));
  await app.settle(900);
};
const only = process.argv[2];
const want = (k) => !only || only === k;
const HEAD = [".picker-head", ".picker-head > .btn", ".picker-title", ".picker-head > .badge, .picker-head > [class*=badge]", ".picker-search", ".picker-head-actions", ".picker-head-actions > *"];
const ROW = [".picker-item-wrap", ".picker-item", ".picker-row", ".picker-name", ".picker-row > *:last-child", ".picker-sources", ".source-tag", ".picker-meta", ".picker-hide"];

if (want("empty"))
  await both({ area: "lists", responses: { agent_projects: { projects: [] } } }, async (app) => {
    await open(app);
    await app.capture("projects-empty");
    await rects(app, "projects-empty", [...HEAD, ".picker-empty", ".picker-empty .btn"], 4);
  });

if (want("few"))
  await both(
    {
      area: "lists",
      responses: { agent_projects: { projects: projects(4) }, agent_set_project_hidden: null },
      invoke: sessionsFor({
        project: (cwd) => (cwd.endsWith("aurora-store") ? sessions(3, cwd) : cwd.endsWith("rusty-parser") ? sessions(32, cwd) : []),
      }),
    },
    async (app) => {
      await open(app);
      await app.capture("projects-few");
      await rects(app, "projects-few", [...HEAD, ...ROW], 4);
      const rows = app.page.locator(".picker-item");
      const back = app.page.getByRole("button", { name: "All projects" });
      await app.tap(rows.nth(0), { settle: 700 });
      await app.capture("project-sessions");
      await rects(app, "project-sessions", [...HEAD, ...ROW], 4);
      await app.tap(back, { settle: 500 });
      await app.tap(rows.nth(1), { settle: 700 });
      await app.capture("project-sessions-empty");
      await rects(app, "project-sessions-empty", [...HEAD, ".picker-empty .btn"], 4);
      await app.tap(back, { settle: 500 });
      await app.tap(rows.nth(2), { settle: 700 });
      await app.capture("project-sessions-long");
      await rects(app, "project-sessions-long", ROW, 6);
      await app.tap(back, { settle: 500 });
      // Hide: one tap, no confirm.
      if (!app.isPhone) await app.page.locator(".picker-item-wrap").nth(3).hover();
      await app.tap(app.page.locator(".picker-item-wrap .picker-hide").nth(3), { settle: 500, force: true });
      await app.capture("projects-hide-after", { scroll: false });
      console.log(`[${app.device}] hide calls:`, JSON.stringify(app.calls().filter((c) => c.cmd === "agent_set_project_hidden")));
    },
  );

if (want("long"))
  await both({ area: "lists", responses: { agent_projects: { projects: projects(32) } } }, async (app) => {
    await open(app);
    await app.capture("projects-long");
    await rects(app, "projects-long", [...HEAD, ...ROW], 8);
    const search = app.page.locator(".picker-search");
    if (await search.isVisible().catch(() => false)) {
      await app.tap(search);
      await search.fill("api");
      await app.settle(300);
      await app.capture("projects-search", { scroll: false });
      await search.fill("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
      await app.settle(300);
      await app.capture("projects-search-none", { scroll: false });
    } else console.log(`[${app.device}] no .picker-search visible`);
  });

const MODAL = [".modal", ".modal-head", ".modal-title", ".modal-close", ".modal-input", ".modal-hint", ".modal-error", ".modal-actions", ".modal-actions > button"];

if (want("new"))
  await both(
    {
      area: "lists",
      responses: { agent_projects: { projects: projects(4) } },
      invoke: (cmd) => {
        if (cmd === "app_create_project") throw new Error("exists:A folder with that name is already in your projects folder.");
        return undefined;
      },
    },
    async (app) => {
      await open(app);
      await app.tap(app.page.getByRole("button", { name: "+ New project" }).first(), { settle: 600 });
      await app.capture("project-new", { scroll: false });
      await rects(app, "project-new", MODAL, 3);
      const input = app.page.locator(".modal .modal-input");
      await input.fill("Enterprise Customer Data Platform Ingestion Service v2 Rewrite");
      await app.settle(300);
      await app.capture("project-new-filled", { scroll: false });
      await rects(app, "project-new-filled", MODAL, 3);
      await app.tap(app.page.locator(".modal .modal-btn.primary"), { settle: 600 });
      await app.capture("project-new-taken", { scroll: false });
      await rects(app, "project-new-taken", MODAL, 3);
    },
  );

const FOLDERS = [".modal.host-folders-modal", ".modal-head", ".modal-close", ".host-folders-search", ".host-folders-body", ".host-folders-heading", ".host-folder", ".host-folder-name", ".host-folder-place", ".host-folder-chevron", ".host-folders-note"];

if (want("folders"))
  await both(
    { area: "lists", responses: { agent_projects: { projects: projects(4) }, agent_project_folders: { folders: hostFolders(14) } } },
    async (app) => {
      await open(app);
      await app.tap(app.page.getByRole("button", { name: "Open existing" }).first(), { settle: 700 });
      await app.capture("project-folders");
      await rects(app, "project-folders", FOLDERS, 8);
      const search = app.page.locator(".host-folders-search");
      if (await search.isVisible().catch(() => false)) {
        await app.tap(search);
        await search.fill("site");
        await app.settle(300);
        await app.capture("project-folders-search", { scroll: false });
      }
      console.log(`[${app.device}] dialog/folder calls:`, JSON.stringify(app.calls().filter((c) => /folder|dialog/.test(c.cmd)).map((c) => c.cmd)));
    },
  );

if (want("folders-states")) {
  await both(
    { area: "lists", responses: { agent_projects: { projects: projects(4) }, agent_project_folders: { folders: [] } } },
    async (app) => {
      await open(app);
      await app.tap(app.page.getByRole("button", { name: "Open existing" }).first(), { settle: 700 });
      await app.capture("project-folders-empty", { scroll: false });
    },
  );
  await both(
    {
      area: "lists",
      responses: { agent_projects: { projects: projects(4) } },
      invoke: (cmd) => {
        if (cmd === "agent_project_folders") throw new Error("Couldn't reach mac-mini-1 to list its project folders. Check that it is awake and on the same network, then try again.");
        return undefined;
      },
    },
    async (app) => {
      await open(app);
      await app.tap(app.page.getByRole("button", { name: "Open existing" }).first(), { settle: 700 });
      await app.capture("project-folders-error", { scroll: false });
      await rects(app, "project-folders-error", [".host-folders-state", ".host-folders-state .modal-error", ".host-folders-state .modal-btn"], 3);
    },
  );
}

await closeBrowser();
