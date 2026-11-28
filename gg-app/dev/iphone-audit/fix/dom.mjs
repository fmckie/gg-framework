// Phone only: print every control in the session's header and footer with its position, overflow and pseudo-elements.
import { withApp, closeBrowser, enterSession } from "../lib.mjs";
await withApp("phone", { area: "fix" }, async (app) => {
  await enterSession(app);
  await app.settle(600);
  const rows = await app.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".chat-head button, .chat-head [role=button], .chat-head label, .footer button, .footer select, .footer [role=button]")) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const chain = [];
      for (let a = el.parentElement; a && !a.matches(".chat-head, .footer"); a = a.parentElement) {
        const acs = getComputedStyle(a);
        chain.push(`${a.tagName.toLowerCase()}.${[...a.classList].join(".")}[${acs.overflowX}/${acs.overflowY} ${acs.position}]`);
      }
      out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} pos=${cs.position} ov=${cs.overflowX}/${cs.overflowY} before=${getComputedStyle(el, "::before").content} after=${getComputedStyle(el, "::after").content} bg=${cs.backgroundColor} border=${cs.borderTopWidth} <- ${chain.join(" < ")}`);
    }
    return out;
  });
  console.log(rows.join("\n"));
});
await closeBrowser();
