// Helpers for the Connection / Apps / Tools scenes (second settings audit).
// The harness files and the other audit's files are untouched.
export const SIZE = ["height", "min-height", "min-width", "font-size", "padding-top", "padding-bottom"];
export const FIT = ["width", "max-width", "white-space", "text-overflow", "overflow-x", "flex-wrap", "flex-direction", "grid-template-columns", "overflow-wrap", "word-break"];

/** One step of a scene: a failure is logged and the scene goes on. */
export async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`\n!! step "${label}" failed: ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

/** Bring an element into the middle of its scroller. */
export async function reveal(app, target, block = "center") {
  const l = typeof target === "string" ? app.page.locator(target).first() : target.first();
  await l.evaluate((el, b) => el.scrollIntoView({ block: b, inline: "nearest" }), block, { timeout: 4000 });
  await app.settle(350);
}

/** Every style rule that sets one of `props` on the first visible match of each selector, with its file. */
export async function why(app, label, selectors, props = SIZE) {
  const rows = await app.page.evaluate(
    ([sels, wanted]) => {
      const out = [];
      const split = (text) => {
        const parts = [];
        let depth = 0;
        let cur = "";
        for (const ch of text) {
          if (ch === "(" || ch === "[") depth++;
          if (ch === ")" || ch === "]") depth--;
          if (ch === "," && depth === 0) {
            parts.push(cur.trim());
            cur = "";
          } else cur += ch;
        }
        if (cur.trim()) parts.push(cur.trim());
        return parts;
      };
      const visit = (rules, file, el, hits) => {
        for (const rule of rules) {
          if (rule.selectorText !== undefined) {
            let m = false;
            try {
              m = el.matches(rule.selectorText);
            } catch {
              m = false;
            }
            if (!m) continue;
            const decl = wanted
              .filter((p) => rule.style.getPropertyValue(p) !== "")
              .map((p) => `${p}: ${rule.style.getPropertyValue(p)}${rule.style.getPropertyPriority(p) ? " !important" : ""}`);
            if (!decl.length) continue;
            const parts = split(rule.selectorText);
            const mine = parts.filter((p) => {
              try {
                return el.matches(p);
              } catch {
                return false;
              }
            });
            const shown = (mine.length ? mine.join(" , ") : rule.selectorText).replace(/\s+/g, " ").slice(0, 190);
            hits.push(`    [${file}] ${shown}${parts.length > mine.length ? ` (+${parts.length - mine.length} in list)` : ""} { ${decl.join("; ")} }`);
          } else if (rule.cssRules) {
            if (rule.media && !matchMedia(rule.media.mediaText).matches) continue;
            visit(rule.cssRules, file, el, hits);
          }
        }
      };
      for (const sel of sels) {
        const el = [...document.querySelectorAll(sel)].find((e) => !e.closest("[inert]") && e.getBoundingClientRect().width > 0);
        if (!el) {
          out.push(`  ${sel}: (not on screen)`);
          continue;
        }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out.push(
          `  ${sel}: ${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10} font ${cs.fontSize} min-height ${cs.minHeight} <${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).join(".")}> "${(el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 36)}"`,
        );
        const hits = [];
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          const file = String(sheet.ownerNode?.dataset?.viteDevId ?? sheet.href ?? "inline").split("/").slice(-1)[0];
          visit(rules, file, el, hits);
        }
        out.push(...hits);
      }
      return out;
    },
    [selectors, props],
  );
  console.log(`\n-- why ${label} (${app.device})`);
  for (const r of rows) console.log(r);
}

/** Boxes of what matches each selector, the most overflowing first. */
export async function boxes(app, label, selectors, max = 4) {
  const rows = await app.page.evaluate(
    ([sels, most]) => {
      const out = [];
      const r1 = (n) => Math.round(n * 10) / 10;
      for (const sel of sels) {
        const els = [...document.querySelectorAll(sel)].filter((e) => !e.closest("[inert]") && e.getBoundingClientRect().width > 0);
        if (!els.length) {
          out.push(`  ${sel}: (none)`);
          continue;
        }
        const over = (e) => e.scrollWidth - e.clientWidth;
        els.sort((a, b) => over(b) - over(a) || b.getBoundingClientRect().right - a.getBoundingClientRect().right);
        for (const el of els.slice(0, most)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          out.push(
            `  ${sel}: x ${r1(r.left)}..${r1(r.right)} w ${r1(r.width)} h ${r1(r.height)} scrollW ${el.scrollWidth}/${el.clientWidth} font ${cs.fontSize} ws ${cs.whiteSpace} to ${cs.textOverflow} ov ${cs.overflowX} disp ${cs.display} "${(el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 44)}"`,
          );
        }
        if (els.length > most) out.push(`  ${sel}: … ${els.length - most} more`);
      }
      return out;
    },
    [selectors, max],
  );
  console.log(`\n-- boxes ${label} (${app.device})`);
  for (const r of rows) console.log(r);
}
