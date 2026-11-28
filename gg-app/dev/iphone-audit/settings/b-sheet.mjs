// Contact sheets of captures, for reading several at once. Written to /tmp/b-sheets (not the repo).
//   node b-sheet.mjs <name> <cols> <cellWidth> <file…> [-- <name> <cols> <cellWidth> <file…>]
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, "../../../../.gg/screenshots/iphone-audit/settings");
const OUT = "/tmp/b-sheets";
await mkdir(OUT, { recursive: true });
const specs = [];
let cur = [];
for (const a of process.argv.slice(2)) {
  if (a === "--") {
    specs.push(cur);
    cur = [];
  } else cur.push(a);
}
if (cur.length) specs.push(cur);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
for (const [name, cols, width, ...files] of specs) {
  const w = Number(width);
  const c = Number(cols);
  const cells = files
    .map((f) => {
      const p = path.join(DIR, path.basename(f));
      const ok = existsSync(p);
      return `<div><div class="cap">${path.basename(f)}${ok ? "" : " MISSING"}</div>${ok ? `<img src="file://${p}" style="width:${w}px;display:block">` : ""}</div>`;
    })
    .join("");
  const html = `<!doctype html><style>body{margin:0;background:#666;font:11px/14px monospace}.g{display:grid;grid-template-columns:repeat(${c},${w}px)}.cap{background:#ff0;color:#000;height:14px;overflow:hidden;white-space:nowrap}</style><div class="g">${cells}</div>`;
  const file = path.join(OUT, `${name}.html`);
  await writeFile(file, html);
  const page = await browser.newPage({ viewport: { width: c * w, height: 600 }, deviceScaleFactor: 1 });
  await page.goto(`file://${file}`, { waitUntil: "load" });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await page.close();
  console.log(`sheet ${path.join(OUT, `${name}.png`)} (${files.length} files)`);
}
await browser.close();
