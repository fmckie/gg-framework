// Print one record compactly: node dev/iphone-audit/session/show.mjs <screen> [phone|desktop] [section…]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SHOTS } from "../lib.mjs";

const [screen, device = "phone", ...sections] = process.argv.slice(2);
const r = JSON.parse(await readFile(path.join(SHOTS, "session", `${screen}--${device}.json`), "utf8"));
const want = (s) => sections.length === 0 || sections.includes(s);
if (want("controls")) {
  console.log(`# controls ${screen} ${device}`);
  for (const c of r.controls) {
    const flags = [
      c.small ? "SMALL" : "",
      c.hit ? `hit ${c.hit.w}x${c.hit.h}` : "",
      c.disabled ? "disabled" : "",
      c.covered ? `covered:${c.covered}` : "",
      c.clipped ? `clipped:${c.clipped.by}(${c.clipped.px})` : "",
      c.lines ? `lines:${c.lines}` : "",
      c.spill ? `spill:${c.spill}` : "",
      c.inView ? "" : "offscreen",
    ].filter(Boolean).join(" ");
    console.log(`${String(c.x).padStart(6)},${String(c.y).padStart(6)} ${String(c.w).padStart(6)}x${String(c.h).padEnd(5)} "${c.name}" <${c.el}> [${c.variant}] in ${c.group} ${flags}`);
  }
}
for (const k of ["overlaps", "pastEdge", "clippedX", "hScrollers", "unreachable", "coveredAtEnd", "truncated", "hints", "hoverOnly", "pointerRows", "scrollers", "errors", "unknownCommands", "unknownRoutes"]) {
  if (!want(k) || !r[k]?.length) continue;
  console.log(`# ${k}`);
  for (const x of r[k]) console.log("  " + JSON.stringify(x));
}
if (want("page")) console.log("# page", JSON.stringify(r.page), "parked", r.parked);
