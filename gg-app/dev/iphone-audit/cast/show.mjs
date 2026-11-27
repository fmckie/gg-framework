// Print a compact view of a record: node dev/iphone-audit/cast/show.mjs <screen> [phone|desktop]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SHOTS } from "../lib.mjs";
const [screen, device = "phone", what = "controls"] = process.argv.slice(2);
const r = JSON.parse(await readFile(path.join(SHOTS, "cast", `${screen}--${device}.json`), "utf8"));
if (what === "controls") {
  for (const c of r.controls) {
    console.log(
      `${String(c.x).padStart(6)} ${String(c.y).padStart(6)} ${String(c.w).padStart(6)}x${String(c.h).padEnd(5)} ${c.hit ? `hit ${c.hit.w}x${c.hit.h} ` : ""}${c.small ? "SMALL " : ""}${c.disabled ? "DISABLED " : ""}[${c.variant}] <${c.el}> "${c.name.slice(0, 50)}"${c.covered ? ` COVERED by ${c.covered}` : ""}${c.clipped ? ` CLIPPED ${JSON.stringify(c.clipped)}` : ""}${c.lines ? ` lines ${c.lines}` : ""}${c.spill ? ` spill ${c.spill}` : ""} grp=${c.group}`,
    );
  }
} else console.log(JSON.stringify(r[what], null, 1));
