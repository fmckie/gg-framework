// Shared by the settings scenes (my own folder; the harness files are untouched).
export const AREA = "settings";

/** Home → the gear → Settings. */
export async function openSettings(app) {
  await app.tap(app.page.getByRole("button", { name: "Settings", exact: true }).first(), { settle: 900 });
  await app.page.locator(".settings-screen").waitFor({ timeout: 5000 });
}

/** Tap a tab by its accessible name ("Overview", "Kleio", "General", "AI Providers", "Connection", "Apps", "Tools", "Steroids", "About"). */
export async function goTab(app, name, settle = 900) {
  await app.tap(app.page.locator(`.settings-tabs [role="tab"][aria-label="${name}"]`), { settle });
}

/** Computed font-size and box of every visible field, for the 16px promise. */
export async function fields(app, label) {
  const rows = await app.page.evaluate(() =>
    [...document.querySelectorAll("input:not([type=hidden]), textarea, select")]
      .filter((el) => !el.closest("[inert]") && el.getBoundingClientRect().width > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          el: el.tagName.toLowerCase() + "." + String(el.className).split(/\s+/).join("."),
          type: el.type,
          name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || "",
          fontSize: cs.fontSize,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        };
      }),
  );
  console.log(`\n-- fields ${label} (${app.device})`);
  for (const r of rows) console.log(`  ${r.el} [${r.type}] "${r.name}" font ${r.fontSize} ${r.w}x${r.h}`);
  return rows;
}

/** The header's own boxes, for each tab. */
export async function header(app, label) {
  const row = await app.page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, text: (el.innerText || "").trim().slice(0, 60) };
    };
    const head = document.querySelector(".settings-screen > .picker-head");
    const title = head?.querySelector(".picker-title");
    return {
      head: box(head),
      back: box(head?.querySelector("button")),
      title: box(title),
      titleCut: title ? title.scrollWidth > title.clientWidth + 1 : null,
      titleFont: title ? getComputedStyle(title).fontSize : null,
      status: box(head?.querySelector(".settings-head-status")),
      actions: box(head?.querySelector(".settings-head-actions")),
      actionButtons: [...(head?.querySelectorAll(".settings-head-actions button, .settings-head-actions a") ?? [])].map(box),
    };
  });
  console.log(`\n-- header ${label} (${app.device}) ${JSON.stringify(row)}`);
  return row;
}
