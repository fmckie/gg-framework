import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

/**
 * Bundle every src/skills/<name>.md into a TS string constant + a SKILLS
 * registry. Auto-discovered from disk so adding a skill = drop a markdown
 * file. Description is read from YAML frontmatter `description:` (matching
 * the Anthropic skill spec), falling back to the first non-heading line.
 *
 * Why a generated TS file: skills must ship inside the npm package without
 * depending on disk layout. Embedding as TS strings is the simplest path —
 * tsc compiles them straight into dist.
 */

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const skillsDir = resolve(pkgRoot, "src/skills");

const files = readdirSync(skillsDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

const skills = files.map((f) => {
  const name = f.replace(/\.md$/, "");
  const content = readFileSync(resolve(skillsDir, f), "utf8");
  const fm = parseFrontmatter(content);
  const description = fm.description ?? extractDescription(stripFrontmatter(content));
  return { name: fm.name ?? name, content, description };
});

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = raw.slice(3, end).trim();
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "name" || key === "description") out[key] = value;
  }
  return out;
}

function stripFrontmatter(raw) {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return raw;
  return raw.slice(end + 4).replace(/^\r?\n/, "");
}

function extractDescription(content) {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("---") || line.startsWith("```")) continue;
    return line.length > 200 ? line.slice(0, 199) + "…" : line;
  }
  return "(no description)";
}

function jsString(s) {
  return JSON.stringify(s);
}

function constName(name) {
  return name.replace(/-/g, "_").toUpperCase();
}

const lines = [
  "/**",
  " * Bundled skill markdowns. Auto-generated from src/skills/*.md by",
  " * scripts/build-skills.mjs — DO NOT EDIT BY HAND. Add a new skill by",
  " * dropping a .md file in src/skills/ (with optional YAML frontmatter)",
  " * and re-running `node scripts/build-skills.mjs`.",
  " *",
  " * Skills are exposed through the read_skill tool; their descriptions live",
  " * in the system prompt. Pattern follows the Anthropic skill convention:",
  " * description in the prompt, full content on demand.",
  " */",
  "",
  "export interface BundledSkill {",
  "  name: string;",
  "  description: string;",
  "  content: string;",
  "}",
  "",
];

for (const s of skills) {
  lines.push(`const ${constName(s.name)} = \`${esc(s.content)}\`;`);
  lines.push("");
}

lines.push("export const SKILLS: Record<string, BundledSkill> = {");
for (const s of skills) {
  lines.push(`  ${jsString(s.name)}: {`);
  lines.push(`    name: ${jsString(s.name)},`);
  lines.push(`    description: ${jsString(s.description)},`);
  lines.push(`    content: ${constName(s.name)},`);
  lines.push("  },");
}
lines.push("};");
lines.push("");
lines.push("export const SKILL_NAMES = Object.keys(SKILLS);");
lines.push("");

const target = resolve(pkgRoot, "src/skills.ts");
const out = await format(lines.join("\n"), {
  ...(await resolveConfig(target)),
  filepath: target,
});
writeFileSync(target, out);
console.log(`wrote ${target} — ${out.length} bytes (${skills.length} skills)`);
