// Checks one direction's three screens: static rules, then WebKit screenshots
// (page size, broken images, load errors, overflow, network URLs).
// Usage: node mockups/_tools/check.mjs <folder>   (needs the server on :4791)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir) {
  console.error("usage: node mockups/_tools/check.mjs <folder>");
  process.exit(64);
}
const pages = ["home", "chat", "code"];
const problems = [];
for (const p of [...pages.map((p) => `${p}.html`), "style.css", "assets/kleio-mark.png"]) {
  if (!existsSync(join(root, dir, p))) problems.push(`missing ${dir}/${p}`);
}
for (const f of readdirSync(join(root, dir)).filter((f) => /\.(html|css)$/.test(f))) {
  const src = readFileSync(join(root, dir, f), "utf8");
  if (/<script/i.test(src)) problems.push(`${f}: has a <script>`);
  if (/@import/i.test(src)) problems.push(`${f}: has @import`);
  if (/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(src)) problems.push(`${f}: links to a network URL`);
  if (/url\(\s*["']?(https?:)?\/\//i.test(src)) problems.push(`${f}: url() to the network`);
  if (/@font-face/i.test(src)) problems.push(`${f}: @font-face (system fonts only)`);
  if (/backdrop-filter/i.test(src)) problems.push(`${f}: backdrop-filter (no glass)`);
  if (f.endsWith(".html") && !/<meta charset="utf-8">/i.test(src)) problems.push(`${f}: missing <meta charset="utf-8">`);
}
if (problems.length === 0) {
  const args = pages.flatMap((p) => [`http://127.0.0.1:4791/${dir}/${p}.html#still`, join(root, "_review", dir, `${p}.png`)]);
  const out = execFileSync(join(root, "_tools", "snap"), args, { encoding: "utf8", timeout: 180000 });
  for (const line of out.trim().split("\n")) {
    const r = JSON.parse(line);
    const name = String(r.src ?? "?").split("/").pop();
    if (r.error) {
      problems.push(`${name}: ${r.error}`);
      continue;
    }
    const p = r.page;
    if (!r.saved) problems.push(`${name}: screenshot not saved`);
    if (p.scroll?.[0] !== 1024 || p.scroll?.[1] !== 720) problems.push(`${name}: page is ${p.scroll?.join("x")}, not 1024x720`);
    for (const k of ["broken", "errors", "outside", "external"]) {
      if (p[k]?.length) problems.push(`${name}: ${k}: ${JSON.stringify(p[k])}`);
    }
    if (p.cutX?.length) console.log(`${name}: note: text cut off horizontally (fine only if deliberate): ${JSON.stringify(p.cutX)}`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${dir}: 3 screens pass (screenshots in mockups/_review/${dir}/)`);
