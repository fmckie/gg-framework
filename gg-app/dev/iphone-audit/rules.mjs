// node dev/iphone-audit/rules.mjs '<regex on selector>' ['<regex on declarations>'] : every rule whose selector matches, with file:line.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "/Users/wmckie/gg-framework-iphone/node_modules/.pnpm/postcss@8.5.28/node_modules/postcss/lib/postcss.mjs";
const [selRe, declRe] = process.argv.slice(2);
const sre = new RegExp(selRe);
const dre = declRe ? new RegExp(declRe) : null;
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".css")) files.push(p);
  }
})("src");
for (const file of files) {
  postcss.parse(readFileSync(file, "utf8")).walkRules((rule) => {
    if (!sre.test(rule.selector)) return;
    const decls = rule.nodes.filter((n) => n.type === "decl").map((d) => `${d.prop}: ${d.value}${d.important ? " !important" : ""}`);
    if (dre && !decls.some((d) => dre.test(d))) return;
    let media = "";
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) media = `@${p.name} ${p.params} ` + media;
    console.log(`${file.replace("src/", "")}:${rule.source.start.line} ${media}${rule.selector.replace(/\s+/g, " ")} { ${decls.join("; ")} }`);
  });
}
