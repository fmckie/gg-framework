// Prints every source line the findings cite, so each cite can be checked against what it claims.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
const root = path.resolve("gg-app");
const all = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else all.push(p);
  }
};
walk(path.join(root, "src"));
const resolve = (name) => {
  const clean = name.replace(/^gg-app\//, "");
  const hits = all.filter((p) => p.endsWith("/" + clean) || p.endsWith("/" + clean.replace(/^src\//, "")));
  return hits.length === 1 ? hits[0] : hits.find((p) => p === path.join(root, clean)) ?? hits[0];
};
const files = process.argv.slice(2);
const seen = new Set();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  let last = null;
  for (const m of text.matchAll(/`?((?:[\w./-]+\/)?[\w.-]+\.(?:css|tsx|ts))?:(\d+)(?:[-–](\d+))?`?/g)) {
    const name = m[1] ?? last;
    if (m[1]) last = m[1];
    if (!name) continue;
    const key = `${name}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const file = resolve(name);
    if (!file) {
      console.log(`?? ${key} (file not found)`);
      continue;
    }
    const lines = readFileSync(file, "utf8").split("\n");
    const from = Number(m[2]);
    const to = Math.min(Number(m[3] ?? from) , from + 3);
    const body = lines.slice(from - 1, to).map((l) => l.trim()).join(" ⏎ ").slice(0, 170);
    console.log(`${path.relative(root, file)}:${m[2]}${m[3] ? "-" + m[3] : ""} | ${body}`);
  }
}
