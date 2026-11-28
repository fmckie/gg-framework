// A chat session: home → Kleio → open or start a chat.
import { both, closeBrowser } from "../lib.mjs";
import { AREA, probe } from "./common.mjs";

await both({ area: AREA }, async (app) => {
  const { page } = app;
  const textarea = page.locator("textarea.input");
  const names = () => page.evaluate(() => [...document.querySelectorAll("button, [role=button], a[href]")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => `${(b.innerText || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 30)}<${b.className.toString().split(" ").slice(0, 2).join(".")}>`).slice(0, 40));
  console.log(`\n-- ${app.device} home buttons:`, JSON.stringify(await names()));
  await app.tap(page.getByRole("button", { name: "Kleio", exact: true }), { settle: 900 }).catch((e) => console.log("!! no Kleio button", String(e.message).split("\n")[0]));
  console.log(`-- ${app.device} after Kleio:`, JSON.stringify(await names()));
  await app.capture("chat-list", { scroll: false });
  for (const target of [
    page.locator(".chat-browser-item, .picker-item").first(),
    page.getByRole("button", { name: /new chat/i }).first(),
    page.getByText(/^\+? ?New( chat)?$/i).first(),
  ]) {
    if (await textarea.isVisible().catch(() => false)) break;
    await app.tap(target, { settle: 900 }).catch(() => {});
  }
  if (!(await textarea.isVisible().catch(() => false))) {
    console.log(`!! ${app.device}: never reached a chat composer:`, JSON.stringify(await names()));
    return;
  }
  await app.settle(2500);
  await app.capture("chat-session", { scroll: false });
  await probe(app, "chat-session", [".chat-head", ".chat-head-strip > *", ".chat-head-identity > *", ".chat-head-nav", ".chat-head-nav button", ".footer", ".footer-left", ".footer-right > *", ".inputwrap", ".inputwrap button", ".panel-entry-bar", "textarea.input"]);
  console.log(`-- ${app.device} calls:`, JSON.stringify([...new Set(app.calls().map((c) => c.cmd))]));
});
await closeBrowser();
