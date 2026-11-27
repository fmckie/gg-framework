// Extra geometry the shared measure does not hold: the boxes of named parts.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { SHOTS, base } from "../lib.mjs";

/** Boxes (and a few computed styles) of the first `max` matches of each selector. */
export async function rects(app, screen, selectors, max = 3) {
  const out = await app.page.evaluate(
    ([sels, n]) => {
      const r1 = (v) => Math.round(v * 10) / 10;
      const res = {};
      for (const sel of sels) {
        res[sel] = [...document.querySelectorAll(sel)].slice(0, n).map((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            text: (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 48),
            x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height), right: r1(r.right),
            font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
            pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
            minH: cs.minHeight, opacity: cs.opacity, display: cs.display,
            cols: cs.display.includes("grid") ? cs.gridTemplateColumns : undefined,
            scrollW: el.scrollWidth > el.clientWidth + 1 ? `${el.scrollWidth}/${el.clientWidth}` : undefined,
            scrollH: el.scrollHeight > el.clientHeight + 1 ? `${el.scrollHeight}/${el.clientHeight}` : undefined,
            bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, color: cs.color,
          };
        });
      }
      return res;
    },
    [selectors, max],
  );
  const dir = path.join(SHOTS, "lists");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${screen}--${app.device}-extra.json`), JSON.stringify(out, null, 1));
  console.log(`\n-- extra ${screen} (${app.device})`);
  for (const [sel, list] of Object.entries(out)) {
    for (const b of list) {
      console.log(`  ${sel} "${b.text}" @${b.x},${b.y} ${b.w}x${b.h} font ${b.font} pad ${b.pad}${b.cols ? ` cols ${b.cols}` : ""}${b.scrollW ? ` scrollW ${b.scrollW}` : ""}${b.scrollH ? ` scrollH ${b.scrollH}` : ""} bg ${b.bg} border ${b.border}`);
    }
  }
  return out;
}

/** A scene's `invoke`: follows select_project so agent_state answers for the opened workspace. */
export function workspace({ goal } = {}) {
  let opened = null;
  return (cmd, args) => {
    if (cmd === "select_project") {
      opened = args;
      return null;
    }
    if (cmd === "agent_state" && opened) {
      return {
        ...base.state,
        cwd: opened.cwd,
        mode: opened.mode ?? "code",
        ...(opened.mode === "chat" ? { chatAgent: opened.chatAgent ?? "general" } : {}),
        ...(goal && opened.cwd === goal.cwd ? { goal: goal.state } : {}),
      };
    }
    return undefined;
  };
}

/** Chain invoke handlers: the first to answer wins. */
export const chain = (...fns) => (cmd, args, ctx) => {
  for (const fn of fns) {
    const r = fn?.(cmd, args, ctx);
    if (r !== undefined) return r;
  }
  return undefined;
};
