import { both, closeBrowser } from "../lib.mjs";
import { chats, sessionsFor } from "./data.mjs";

const open = async (app) => {
  await app.tap(app.page.getByRole("button", { name: "Kleio", exact: true }));
  await app.settle(900);
};
const only = process.argv[2];
const want = (k) => !only || only === k;

if (want("empty"))
  await both({ area: "lists", invoke: sessionsFor({ chat: [] }) }, async (app) => {
    await open(app);
    await app.capture("chats-empty");
  });

if (want("few"))
  await both(
    {
      area: "lists",
      invoke: sessionsFor({ chat: chats(3) }),
      responses: { agent_delete_chat: null },
    },
    async (app) => {
      await open(app);
      await app.capture("chats-few");
      // Search, active with a match, then with none.
      const search = app.page.locator(".chat-browser-search input");
      await app.tap(search);
      await search.fill("budget");
      await app.settle(300);
      await app.capture("chats-search", { scroll: false });
      await search.fill("zzzz");
      await app.settle(300);
      await app.capture("chats-search-none", { scroll: false });
      await search.fill("");
      await app.settle(300);
      // The row's delete: X, then the inline "Delete" confirm (reverts after 4s).
      const x = app.page.locator(".picker-delete").first();
      const box = await x.boundingBox().catch(() => null);
      console.log(`[${app.device}] delete X box:`, JSON.stringify(box), "visible:", await x.isVisible().catch(() => false));
      if (!app.isPhone) await app.page.locator(".picker-item-wrap").first().hover();
      await app.tap(x, { settle: 250, force: true }).catch((e) => console.log(`[${app.device}] delete tap failed: ${String(e.message).split("\n")[0]}`));
      await app.capture("chats-delete-confirm", { scroll: false });
    },
  );

if (want("long"))
  await both({ area: "lists", invoke: sessionsFor({ chat: chats(34) }) }, async (app) => {
    await open(app);
    await app.capture("chats-long");
  });

await closeBrowser();
