import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";
import type { BundledSkill } from "../skills.js";

/**
 * User-extensible skill discovery.
 *
 * Priority (last wins on name collisions):
 *   bundled (compiled into the package)
 *   → project (<cwd>/.gg/editor-skills/ OR <cwd>/.gg/skills/)
 *   → user    (~/.gg/editor-skills/ OR ~/.gg/skills/)
 *
 * Silent override is the intended behaviour. The system prompt's skill list
 * tags overridden entries so the agent (and the user) can see the layering.
 *
 * Two on-disk layouts are supported, identical to the Anthropic skill spec:
 *
 *   - Flat:     <dir>/<name>.md
 *   - Bundle:   <dir>/<name>/SKILL.md  (+ optional support files / scripts)
 *
 * Both forms accept optional YAML frontmatter (3-dash delimited):
 *
 *   ---
 *   name: my-skill
 *   description: One-line description for the agent.
 *   ---
 *
 * When frontmatter is absent, the skill name falls back to the basename and
 * the description is heuristically extracted from the first non-heading line.
 *
 * Two project / user dirs are searched in order — `.gg/editor-skills/` (the
 * legacy gg-editor location) then `.gg/skills/` (the broader ecosystem
 * convention used by Kleio Coder + skills.sh installs). Same for ~/.gg/. This
 * means a creator who has done `npx skills add kenkaiiii/agent-skills` into
 * `~/.gg/skills/` automatically gets the editor skills too.
 */

export interface SkillSource {
  name: string;
  description: string;
  content: string;
  origin: "bundled" | "project" | "user";
  /** Absolute path on disk (project / user only). */
  path?: string;
}

export interface DiscoverSkillsOptions {
  cwd: string;
  homeDir?: string;
  bundled: BundledSkill[];
}

export function discoverSkills(opts: DiscoverSkillsOptions): SkillSource[] {
  const home = opts.homeDir ?? homedir();
  const projectDirs = [
    resolvePath(opts.cwd, ".gg/editor-skills"),
    resolvePath(opts.cwd, ".gg/skills"),
  ];
  const userDirs = [resolvePath(home, ".gg/editor-skills"), resolvePath(home, ".gg/skills")];

  const bundled: SkillSource[] = opts.bundled.map((s) => ({
    name: s.name,
    description: s.description,
    content: s.content,
    origin: "bundled" as const,
  }));

  const project = projectDirs.flatMap((d) => readSkillDir(d, "project"));
  const user = userDirs.flatMap((d) => readSkillDir(d, "user"));

  // last-wins by name across [bundled, project, user]
  const byName = new Map<string, SkillSource>();
  for (const s of [...bundled, ...project, ...user]) {
    byName.set(s.name, s);
  }
  return [...byName.values()];
}

function readSkillDir(dir: string, origin: "project" | "user"): SkillSource[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SkillSource[] = [];
  for (const e of entries) {
    const path = join(dir, e);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(path);
    } catch {
      continue;
    }

    // Flat layout: <name>.md
    if (st.isFile() && e.endsWith(".md")) {
      try {
        const content = readFileSync(path, "utf8");
        out.push(parseSkill(content, origin, path, basename(e, ".md")));
      } catch {
        /* skip unreadable */
      }
      continue;
    }

    // Bundle layout: <name>/SKILL.md (Anthropic skill spec / skills.sh).
    if (st.isDirectory()) {
      const skillFile = join(path, "SKILL.md");
      try {
        const fst = statSync(skillFile);
        if (!fst.isFile()) continue;
        const content = readFileSync(skillFile, "utf8");
        out.push(parseSkill(content, origin, skillFile, e));
      } catch {
        /* no SKILL.md — skip */
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parse a skill markdown into a SkillSource. Supports optional
 * 3-dash-delimited YAML frontmatter (only `name:` and `description:` are
 * inspected — additional keys are tolerated and ignored).
 *
 * The parsed `content` retains the frontmatter when present, so consumers
 * (read_skill / agent prompts) see the full file as authored. This matches
 * how Kleio Coder and the skills.sh ecosystem treat skill files.
 */
export function parseSkill(
  raw: string,
  origin: "bundled" | "project" | "user",
  path: string,
  fallbackName: string,
): SkillSource {
  const fm = parseFrontmatter(raw);
  return {
    name: fm.name ?? fallbackName,
    description: fm.description ?? extractDescription(stripFrontmatter(raw)),
    content: raw,
    origin,
    path,
  };
}

interface Frontmatter {
  name?: string;
  description?: string;
}

/**
 * Read a YAML-ish frontmatter block at the start of a file. Only supports the
 * tiny subset we care about — `key: value` lines, no nesting, no lists. That
 * matches the Anthropic skill spec exactly. Multi-line `description: |` is
 * NOT supported by design (skill descriptions should fit on one line so the
 * system-prompt index reads cleanly).
 */
export function parseFrontmatter(raw: string): Frontmatter {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = raw.slice(3, end).trim();
  const out: Frontmatter = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    let value = line.slice(colon + 1).trim();
    // Strip surrounding quotes (YAML allows either) — single OR double — so
    // descriptions that contain colons can be quoted defensively.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "name") out.name = value;
    else if (key === "description") out.description = value;
  }
  return out;
}

/** Drop the frontmatter block (if any), return body only. */
export function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return raw;
  return raw.slice(end + 4).replace(/^\r?\n/, "");
}

/**
 * Extract a one-line description from a skill markdown.
 *
 * Strategy: the first non-empty, non-heading line of plain text. Truncated at
 * 200 chars. Falls back to "(no description)" if absent.
 */
export function extractDescription(content: string): string {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("---")) continue;
    if (line.startsWith("```")) continue;
    const out = line.length > 200 ? line.slice(0, 199) + "…" : line;
    return out;
  }
  return "(no description)";
}
