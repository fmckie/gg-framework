// In-viewport controls and the lists that matter: node dev/iphone-audit/cast/view.mjs <screen> [device]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SHOTS } from "../lib.mjs";
const [screen, device = "phone"] = process.argv.slice(2);
const r = JSON.parse(await readFile(path.join(SHOTS, "cast", `${screen}--${device}.json`), "utf8"));
console.log(`## ${screen} ${device} sideways=${r.page.sideways} ${r.page.scrollWidth}/${r.page.clientWidth}`);
for (const c of r.controls.filter((c) => c.y > -5 && c.y < r.viewport.h)) {
  console.log(` ${c.x},${c.y} ${c.w}x${c.h}${c.hit ? ` hit ${c.hit.w}x${c.hit.h}` : ""}${c.small ? " SMALL" : ""}${c.disabled ? " DISABLED" : ""} [${c.variant}] <${c.el.slice(0, 44)}> "${c.name.slice(0, 34)}"${c.covered ? ` COVERED:${c.covered.slice(0, 30)}` : ""}${c.clipped ? ` CLIPPED:${c.clipped.by.slice(0, 26)} ${c.clipped.px}` : ""}${c.lines ? ` lines${c.lines}` : ""}${c.spill ? ` spill${c.spill}` : ""}`);
}
const j = (k, n = 500) => { const v = r[k]; if (v?.length) console.log(`-- ${k}: ${JSON.stringify(v).slice(0, n)}`); };
for (const k of ["truncated", "hints", "hoverOnly", "pastEdge", "clippedX", "hScrollers", "overlaps", "unreachable", "unknownCommands", "unknownRoutes", "errors"]) j(k, k === "truncated" ? 900 : 500);
