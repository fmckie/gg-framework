// Reads a captured screen's two records and prints what the findings cite.
//   node dev/iphone-audit/settings/report.mjs <screen> [--all]   (--all: covered controls too)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SHOTS } from "../lib.mjs";

const [screen, ...flags] = process.argv.slice(2);
const all = flags.includes("--all");
const read = async (device) => {
  try {
    return JSON.parse(await readFile(path.join(SHOTS, "settings", `${screen}--${device}.json`), "utf8"));
  } catch {
    return null;
  }
};
const TABS = /^settings-tab /;
const [p, d] = await Promise.all([read("phone"), read("desktop")]);
const line = (c) =>
  `${(c.name || "(no name)").slice(0, 44).padEnd(44)} ${c.el.slice(0, 46).padEnd(46)} [${c.variant}] ${c.w}x${c.h}${c.hit ? ` hit ${c.hit.w}x${c.hit.h}` : ""} @${c.x},${c.y}${c.small ? " SMALL" : ""}${c.disabled ? " disabled" : ""}${c.lines ? ` lines:${c.lines}` : ""}${c.spill ? ` spill:${c.spill}` : ""}${c.clipped ? ` CLIPPED by ${c.clipped.by} ${c.clipped.px}px` : ""}${c.covered ? ` covered:${c.covered}` : ""}${c.inView ? "" : " offscreen"}`;
for (const [name, r] of [["PHONE", p], ["DESKTOP", d]]) {
  if (!r) continue;
  console.log(`\n=== ${name} ${screen}  page ${r.page.scrollWidth}/${r.page.clientWidth} sideways:${r.page.sideways}`);
  const dialog = r.controls.some((c) => /dialog|modal/.test(c.group) && !c.covered);
  for (const c of r.controls) {
    if (/settings-tab/.test(c.el) && !flags.includes("--tabs")) continue;
    if (!all && dialog && c.covered) continue;
    console.log("  " + line(c));
  }
  const sec = (label, list, fmt) => {
    if (list?.length) {
      console.log(` ${label}:`);
      for (const x of list) console.log("   " + fmt(x));
    }
  };
  sec("pastEdge", r.pastEdge, (x) => `${x.el} "${x.text}" ${x.left}..${x.right} w${x.w}`);
  sec("clippedX", r.clippedX, (x) => `${x.el} "${x.text}" right ${x.right} by ${x.by}`);
  sec("hScrollers", r.hScrollers, (x) => `${x.el} ${x.scrollWidth}/${x.clientWidth}`);
  sec("unreachable", r.unreachable, (x) => `${x.name} <${x.el}> ${x.top}..${x.bottom}`);
  sec("coveredAtEnd", dialog ? [] : r.coveredAtEnd, (x) => `${x.name} by ${x.by} y${x.y}`);
  sec("overlaps", dialog ? [] : r.overlaps?.filter((o) => !/settings-tab/.test(o.a + o.b)), (o) => `${o.a} × ${o.b} ${o.px}`);
  sec("truncated", r.truncated?.filter((t) => !/sr-only/.test(t.el)), (x) => `${x.how} ${x.el} "${x.text}" ${x.clientWidth ?? x.clientHeight}/${x.scrollWidth ?? x.scrollHeight}`);
  sec("hints", r.hints, (x) => `${x.kind}: "${x.text}" <${x.el}>`);
  const ho = new Map();
  for (const h of r.hoverOnly ?? []) {
    const k = `${h.el} | ${h.rule} | applies:${h.ruleApplies} | controls:${h.controls}`;
    ho.set(k, (ho.get(k) ?? 0) + 1);
  }
  sec("hoverOnly", [...ho], ([k, n]) => `${n}× ${k}`);
  sec("pointerRows", r.pointerRows, (x) => `${x.el} "${x.name}" ${x.w}x${x.h}`);
  sec("errors", r.errors, (x) => x);
  sec("unknown", [...(r.unknownCommands ?? []), ...(r.unknownRoutes ?? [])], (x) => x);
  sec("scrollers", r.scrollers, (x) => `${x.el} ${x.scrollHeight}/${x.clientHeight}`);
}
try {
  console.log(await readFile(path.join(SHOTS, "settings", `${screen}--compare.txt`), "utf8"));
} catch {
  console.log("\n(no compare)");
}
