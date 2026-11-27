// node dev/iphone-audit/fix/diff.mjs [area…] [--device=phone|desktop] [--small] : this run against the audit's own captures.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
const ROOT = "/Users/wmckie/gg-framework-iphone/.gg/screenshots";
const args = process.argv.slice(2);
const device = (args.find((a) => a.startsWith("--device=")) ?? "--device=phone").split("=")[1];
const showSmall = args.includes("--small");
const areas = args.filter((a) => !a.startsWith("--"));
const key = (c) => `${c.name}|${c.el}`;
const metrics = {
  small: (r) => r.controls.filter((c) => !c.disabled && c.small).map((c) => `${c.name} [${c.el}] ${c.w}x${c.h}${c.hit ? ` hit ${c.hit.w}x${c.hit.h}` : ""}`),
  sideways: (r) => (r.page.sideways ? [`${r.page.scrollWidth}>${r.page.clientWidth}`] : []),
  pastEdge: (r) => (r.pastEdge ?? []).map((x) => `${x.el} "${x.text}"`),
  clippedX: (r) => (r.clippedX ?? []).map((x) => `${x.el} "${x.text}"`),
  hScrollers: (r) => (r.hScrollers ?? []).map((x) => `${x.el}`),
  covered: (r) => r.controls.filter((c) => c.covered).map((c) => `${c.name} by ${c.covered}`),
  coveredAtEnd: (r) => (r.coveredAtEnd ?? []).map((c) => `${c.name} by ${c.by}`),
  clipped: (r) => r.controls.filter((c) => c.clipped).map((c) => `${c.name} by ${c.clipped.by}`),
  overlaps: (r) => (r.overlaps ?? []).map((o) => `${o.a} × ${o.b}`),
  lines: (r) => r.controls.filter((c) => c.lines).map((c) => `${c.name}: ${c.lines}`),
  spill: (r) => r.controls.filter((c) => c.spill).map((c) => `${c.name}: ${c.spill}`),
  unreachable: (r) => (r.unreachable ?? []).map((x) => x.name),
  truncated: (r) => (r.truncated ?? []).map((x) => `${x.how}: ${x.el} "${x.text}"`),
  hints: (r) => (r.hints ?? []).filter((x) => !/title/.test(x.kind)).map((x) => `${x.kind}: "${x.text}"`),
  hoverOnly: (r) => (r.hoverOnly ?? []).map((x) => `${x.el} "${x.name}"`),
  errors: (r) => r.errors ?? [],
};
const totals = {};
for (const area of areas.length ? areas : ["session", "lists", "settings", "cast"]) {
  const now = path.join(ROOT, "iphone-audit", area);
  const was = path.join(ROOT, "iphone-audit-before", area);
  for (const f of readdirSync(now).filter((f) => f.endsWith(`--${device}.json`)).sort()) {
    if (!existsSync(path.join(was, f))) continue;
    const a = JSON.parse(readFileSync(path.join(was, f), "utf8"));
    const b = JSON.parse(readFileSync(path.join(now, f), "utf8"));
    const lines = [];
    for (const [name, fn] of Object.entries(metrics)) {
      const A = fn(a), B = fn(b);
      totals[name] ??= [0, 0];
      totals[name][0] += A.length;
      totals[name][1] += B.length;
      const added = B.filter((x) => !A.includes(x));
      const gone = A.filter((x) => !B.includes(x));
      if (name === "small") {
        if (showSmall && B.length) lines.push(`  small now (${B.length}): ${B.slice(0, 14).join(" · ")}`);
        continue;
      }
      // Behind a dialog everything is covered: only a rise in the count is news there.
      const noisy = ["covered", "coveredAtEnd", "overlaps", "unreachable", "clipped"].includes(name);
      if (added.length && (!noisy || B.length > A.length)) lines.push(`  + ${name} (${A.length}→${B.length}): ${added.slice(0, 6).map((x) => x.slice(0, 110)).join(" · ")}${added.length > 6 ? ` … ${added.length - 6} more` : ""}`);
      if (gone.length && args.includes("--gone")) lines.push(`  - ${name}: ${gone.slice(0, 6).join(" · ")}`);
    }
    if (lines.length) console.log(`${area}/${f.replace(`--${device}.json`, "")}\n${lines.join("\n")}`);
  }
}
console.log("\ntotals (before → now):", Object.entries(totals).map(([k, [x, y]]) => `${k} ${x}→${y}`).join(", "));
