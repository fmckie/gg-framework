// node dev/iphone-audit/digest.mjs <area> <regex> : one phone record per block, compactly.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SHOTS } from "./lib.mjs";
const [area, rx = "."] = process.argv.slice(2);
const dir = path.join(SHOTS, area);
const names = (await readdir(dir)).filter((f) => f.endsWith("--phone.json") && new RegExp(rx).test(f)).sort();
const read = async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")).catch?.(() => null);
for (const f of names) {
  const r = JSON.parse(await readFile(path.join(dir, f), "utf8"));
  let d = null;
  try {
    d = JSON.parse(await readFile(path.join(dir, f.replace("--phone", "--desktop")), "utf8"));
  } catch {}
  const out = [`\n=== ${r.screen}  (${r.controls.length} controls${d ? `, desktop ${d.controls.length}` : ", NO DESKTOP"})`];
  const dsize = new Map((d?.controls ?? []).map((c) => [c.name.toLowerCase(), `${c.w}x${c.h}`]));
  const small = r.controls.filter((c) => c.small && !c.disabled && !/settings-tab/.test(c.el));
  const seen = new Map();
  for (const c of small) {
    const k = `${c.name.replace(/\d+/g, "#").slice(0, 40)}|${c.w}x${c.h}`;
    if (!seen.has(k)) seen.set(k, { c, n: 0 });
    seen.get(k).n++;
  }
  out.push(`under 44 (not tabs): ${small.length}`);
  for (const { c, n } of seen.values()) {
    out.push(`  ${c.name.slice(0, 44) || "(no name)"} ${c.w}x${c.h}${c.hit ? ` hit ${c.hit.w}x${c.hit.h}` : ""} <${c.el.slice(0, 60)}>${n > 1 ? ` x${n}` : ""} desk ${dsize.get(c.name.toLowerCase()) ?? "-"}`);
  }
  const list = (label, arr, fmt) => {
    if (arr?.length) {
      out.push(`${label}: ${arr.length}`);
      for (const x of arr.slice(0, 8)) out.push(`  ${fmt(x)}`);
    }
  };
  if (r.page.sideways) out.push(`PAGE SIDEWAYS ${r.page.scrollWidth}>${r.page.clientWidth}`);
  list("pastEdge", r.pastEdge, (x) => `${x.el} "${x.text}" ${x.left}..${x.right}`);
  list("clippedX", r.clippedX, (x) => `${x.el.slice(0, 50)} "${x.text.slice(0, 30)}" right ${x.right} by ${x.by.slice(0, 40)}`);
  list("hScrollers", r.hScrollers, (x) => `${x.el.slice(0, 60)} ${x.scrollWidth} in ${x.clientWidth}`);
  list("covered", r.controls.filter((c) => c.covered), (c) => `${c.name.slice(0, 30)} by ${c.covered.slice(0, 50)}`);
  list("coveredAtEnd", r.coveredAtEnd, (c) => `${c.name.slice(0, 30)} by ${c.by.slice(0, 50)}`);
  list("clipped controls", r.controls.filter((c) => c.clipped), (c) => `${c.name.slice(0, 30)} ${c.w}x${c.h} by ${c.clipped.by.slice(0, 40)} ${c.clipped.px}px`);
  list("overlaps", r.overlaps, (o) => `${o.a.slice(0, 40)} × ${o.b.slice(0, 40)} ${o.px}`);
  list("2+ lines", r.controls.filter((c) => c.lines && !c.small), (c) => `${c.name.slice(0, 50)} ${c.w}x${c.h} ${c.lines} lines`);
  list("2+ lines (small)", r.controls.filter((c) => c.lines && c.small), (c) => `${c.name.slice(0, 50)} ${c.w}x${c.h} ${c.lines} lines`);
  list("spill", r.controls.filter((c) => c.spill), (c) => `${c.name.slice(0, 40)} ${c.spill}px`);
  list("unreachable", r.unreachable, (x) => `${x.name.slice(0, 40)} top ${x.top}`);
  const dt = new Set((d?.truncated ?? []).map((x) => x.text));
  list("truncated (phone only marked *)", r.truncated.filter((x) => !/sr-only/.test(x.el)), (x) => `${dt.has(x.text) ? " " : "*"}${x.how}: ${x.el.slice(0, 44)} "${x.text.slice(0, 60)}" ${x.clientWidth ?? x.clientHeight}/${x.scrollWidth ?? x.scrollHeight}`);
  list("hints shown", r.hints.filter((x) => !/title|aria-label/.test(x.kind)), (x) => `${x.kind}: "${x.text.slice(0, 90)}" <${x.el.slice(0, 40)}>`);
  list("hoverOnly", r.hoverOnly, (x) => `${x.el.slice(0, 50)} "${x.name.slice(0, 24)}" ctl ${x.controls} applies ${x.ruleApplies} :: ${x.rule.slice(0, 80)}`);
  list("scrollers", r.scrollers, (x) => `${x.el.slice(0, 60)} ${x.scrollHeight} in ${x.clientHeight}`);
  list("errors", r.errors, (x) => x.slice(0, 160));
  list("unknownCommands", r.unknownCommands, (x) => x);
  list("unknownRoutes", r.unknownRoutes, (x) => x);
  try {
    const cmp = await readFile(path.join(dir, f.replace("--phone.json", "--compare.txt")), "utf8");
    const lines = cmp.split("\n").filter((l) => l.trim() && !/^## compare/.test(l));
    out.push("compare: " + lines.filter((l) => !/settings-tab|order of shared controls: same|\(0\):/.test(l)).map((l) => l.slice(0, 150)).join("\n  "));
  } catch {}
  console.log(out.join("\n"));
}
