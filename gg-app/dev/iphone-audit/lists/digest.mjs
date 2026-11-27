// Compact digest of one or more captured screens: node dev/iphone-audit/lists/digest.mjs <screen> [...]
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { SHOTS } from "../lib.mjs";

const dir = path.join(SHOTS, "lists");
const full = process.argv.includes("--full");
for (const screen of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  for (const device of ["phone", "desktop"]) {
    const f = path.join(dir, `${screen}--${device}.json`);
    if (!existsSync(f)) {
      console.log(`-- ${screen} ${device}: no record`);
      continue;
    }
    const r = JSON.parse(readFileSync(f, "utf8"));
    console.log(`\n== ${screen} ${device} html=${r.html} sideways=${r.page.sideways} (${r.page.scrollWidth}/${r.page.clientWidth})`);
    const seen = new Map();
    for (const c of r.controls) {
      const key = full ? `${c.name}|${c.x}|${c.y}` : `${c.el}|${c.w}x${c.h}|${c.variant}`;
      const row = seen.get(key) ?? { ...c, n: 0 };
      row.n++;
      seen.set(key, row);
    }
    for (const c of seen.values()) {
      const flags = [c.small && "SMALL", c.disabled && "disabled", c.covered && `covered:${c.covered}`, c.clipped && `clipped:${c.clipped.by}(${c.clipped.px})`, c.lines && `lines:${c.lines}`, c.spill && `spill:${c.spill}`, !c.inView && "offscreen"].filter(Boolean).join(" ");
      console.log(`  ${c.n > 1 ? `x${c.n} ` : ""}"${c.name.slice(0, 44)}" <${c.el}> [${c.variant}] @${c.x},${c.y} ${c.w}x${c.h}${c.hit ? ` hit ${c.hit.w}x${c.hit.h}` : ""} ${flags}${c.group ? ` in ${c.group}` : ""}`);
    }
    const list = (label, arr, fmt, max = 8) => {
      if (!arr?.length) return;
      console.log(` ${label} (${arr.length}):`);
      for (const x of arr.slice(0, max)) console.log(`   ${fmt(x)}`);
    };
    list("pastEdge", r.pastEdge, (x) => `${x.el} "${x.text}" ${x.left}..${x.right}`);
    list("clippedX", r.clippedX, (x) => `${x.el} "${x.text}" ${x.left}..${x.right} by ${x.by}`);
    list("hScrollers", r.hScrollers, (x) => `${x.el} ${x.scrollWidth}/${x.clientWidth}`);
    list("overlaps", r.overlaps, (o) => `${o.a} × ${o.b} ${o.px}`);
    list("unreachable", r.unreachable, (x) => `${x.name} <${x.el}> ${x.top}..${x.bottom}`);
    list("coveredAtEnd", r.coveredAtEnd, (x) => `${x.name} by ${x.by} y=${x.y}`);
    list("truncated", r.truncated, (x) => `${x.how} ${x.el} "${x.text.slice(0, 50)}" ${x.clientWidth ?? x.clientHeight}/${x.scrollWidth ?? x.scrollHeight}`);
    list("hints", r.hints, (x) => `${x.kind} "${x.text}" <${x.el}>`);
    const ho = new Map();
    for (const h of r.hoverOnly ?? []) {
      const k = `${h.el}|${h.rule}|${h.ruleApplies}`;
      ho.set(k, { ...h, n: (ho.get(k)?.n ?? 0) + 1 });
    }
    list("hoverOnly", [...ho.values()], (x) => `x${x.n} ${x.el} "${x.name.slice(0, 30)}" ruleApplies=${x.ruleApplies} :: ${x.rule} [${x.hiddenBy}]`);
    list("pointerRows", r.pointerRows, (x) => `${x.el} "${x.name}" ${x.w}x${x.h}`);
    list("scrollers", r.scrollers, (x) => `${x.el} ${x.scrollHeight}/${x.clientHeight}`);
    list("errors", r.errors, (x) => x);
    list("unknownCommands", r.unknownCommands, (x) => x, 30);
    list("unknownRoutes", r.unknownRoutes, (x) => x, 30);
  }
  const cmp = path.join(dir, `${screen}--compare.txt`);
  if (existsSync(cmp)) {
    const t = readFileSync(cmp, "utf8").split("\n").filter((l) => !/^\s+(desktop|phone):\s/.test(l));
    console.log(t.join("\n"));
  }
}
