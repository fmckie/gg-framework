// Contact sheet of several screenshots, for reading many at once.  node sheet.mjs out.jpg a.png b.png …
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
const [out, ...all] = process.argv.slice(2);
const files = all.filter((f) => existsSync(f));
for (const f of all) if (!existsSync(f)) console.log(`sheet: missing ${path.basename(f)}`);
const W = Number(process.env.SHEET_W ?? 393);
const PER = Number(process.env.SHEET_PER ?? 4);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
const page = await b.newPage({ viewport: { width: PER * (W + 8) + 8, height: 600 } });
const cells = [];
for (const f of files) cells.push(`<figure><figcaption>${path.basename(f).replace(/\.png$/, "")}</figcaption><img width="${W}" src="data:image/png;base64,${(await readFile(f)).toString("base64")}"></figure>`);
await page.setContent(`<style>body{margin:8px;background:#555;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;font:11px sans-serif;color:#fff}figure{margin:0;width:${W}px}figcaption{height:14px;overflow:hidden;white-space:nowrap}img{display:block}</style>${cells.join("")}`);
await page.waitForTimeout(500);
await page.screenshot({ path: out, fullPage: true, type: "jpeg", quality: 78 });
await b.close();
console.log(`sheet: ${out} (${files.length})`);
