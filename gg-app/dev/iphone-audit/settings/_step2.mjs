// Helpers for the General / AI Providers / Steroids / About scenes (my own file).
export async function step(app, name, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`!! step "${name}" (${app.device}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
/** A dialog as it opens, then (phone only) scrolled to its end when it scrolls. */
export async function captureModal(app, name) {
  const box = await app.page.evaluate(() => {
    const m = [...document.querySelectorAll(".modal")].pop();
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const fs = (sel) => [...m.querySelectorAll(sel)].map((el) => `${el.className.split(" ")[0]} ${getComputedStyle(el).fontSize} ${Math.round(el.getBoundingClientRect().height)}h`).slice(0, 6);
    return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), scrollW: m.scrollWidth, clientW: m.clientWidth, scrollH: m.scrollHeight, clientH: m.clientHeight, title: m.querySelector(".modal-title")?.innerText, fields: fs("input, textarea, select") };
  });
  console.log(`-- modal ${name} (${app.device}) ${JSON.stringify(box)}`);
  await app.capture(name, { scroll: false });
  if (!app.isPhone) return;
  const scrolled = await app.page.evaluate(() => {
    const modal = [...document.querySelectorAll(".modal")].pop();
    if (!modal) return null;
    const all = [modal, ...modal.querySelectorAll("*")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 24);
    for (const el of all) el.scrollTop = el.scrollHeight;
    return all.length ? all.map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 2).join(".")} ${el.scrollHeight}/${el.clientHeight}`) : null;
  });
  if (scrolled) {
    console.log(`-- modal scrollers ${name}: ${scrolled.join(" | ")}`);
    await app.settle(250);
    await app.capture(`${name}-end`, { scroll: false });
  }
}
export async function closeModal(app) {
  const close = app.page.locator(".modal-close").last();
  if (await close.isVisible().catch(() => false)) await app.tap(close, { settle: 500 });
}
export async function toastBox(app, label) {
  const box = await app.page.evaluate(() =>
    [...document.querySelectorAll(".toast")].map((t) => {
      const r = t.getBoundingClientRect();
      return { text: t.innerText.trim().slice(0, 60), x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
    }),
  );
  console.log(`-- toast ${label} (${app.device}) ${JSON.stringify(box)}`);
}
