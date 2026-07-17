import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { getAppPaths } from "@kleio/coder";

export type ProjectSource = "ggcoder" | "claude-code" | "codex";

export interface DiscoveredProject {
  name: string;
  path: string;
  lastActiveMs: number;
  lastActiveDisplay: string;
  /** Sorted, deduped list of stores this project showed up in. */
  sources: ProjectSource[];
}

/**
 * Scan ggcoder + Claude Code + Codex session stores and return one row per
 * project, sorted most-recent first. Duplicates (same cwd) are collapsed; the
 * `sources` field lists every store the project appeared in so the picker can
 * show a combined badge.
 */
export async function discoverProjects(): Promise<DiscoveredProject[]> {
  const [gg, cc, cx] = await Promise.all([
    discoverGgcoderProjects(),
    discoverClaudeProjects(),
    discoverCodexProjects(),
  ]);

  const byPath = new Map<string, DiscoveredProject>();
  for (const p of [...gg, ...cc, ...cx]) {
    const existing = byPath.get(p.path);
    if (!existing) {
      byPath.set(p.path, p);
      continue;
    }
    byPath.set(p.path, {
      name: existing.name,
      path: existing.path,
      lastActiveMs: Math.max(existing.lastActiveMs, p.lastActiveMs),
      lastActiveDisplay: "", // recomputed below
      sources: mergeSources(existing.sources, p.sources),
    });
  }

  const merged = Array.from(byPath.values()).map((p) => ({
    ...p,
    lastActiveDisplay: formatRelativeTime(p.lastActiveMs),
  }));
  merged.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
  return merged;
}

const SOURCE_ORDER: Record<ProjectSource, number> = {
  ggcoder: 0,
  "claude-code": 1,
  codex: 2,
};

function mergeSources(a: ProjectSource[], b: ProjectSource[]): ProjectSource[] {
  const set = new Set<ProjectSource>([...a, ...b]);
  return Array.from(set).sort((x, y) => SOURCE_ORDER[x] - SOURCE_ORDER[y]);
}

/**
 * Scan ~/.gg/sessions/. Each session directory's name is the encoded cwd
 * (slashes → underscores); we decode it back and verify the directory still
 * exists on disk.
 */
async function discoverGgcoderProjects(): Promise<DiscoveredProject[]> {
  const sessionsDir = getAppPaths().sessionsDir;
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsDir);
  } catch {
    return [];
  }

  const results: DiscoveredProject[] = [];
  for (const entry of entries) {
    const dir = path.join(sessionsDir, entry);
    const mtime = await maxJsonlMtime(dir);
    if (mtime === null) continue;

    const decoded = "/" + entry.replace(/_/g, "/");
    if (!(await isDirectory(decoded))) continue;

    results.push({
      name: path.basename(decoded),
      path: decoded,
      lastActiveMs: mtime,
      lastActiveDisplay: formatRelativeTime(mtime),
      sources: ["ggcoder"],
    });
  }
  return results;
}

/**
 * Scan ~/.claude/projects/. Claude Code's directory encoding replaces every
 * "/" with "-", which is genuinely ambiguous — a real dash in a path component
 * (e.g. "gg-coder") collides with the separator. So we extract the cwd from
 * the JSONL events themselves; Claude writes it into user/assistant records.
 * Falls back to a best-effort dash decode only if no event carries a cwd.
 */
async function discoverClaudeProjects(): Promise<DiscoveredProject[]> {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  let entries: string[];
  try {
    entries = await fs.readdir(projectsDir);
  } catch {
    return [];
  }

  const results = await Promise.all(
    entries.map(async (entry): Promise<DiscoveredProject | null> => {
      const dir = path.join(projectsDir, entry);
      const mtime = await maxJsonlMtime(dir);
      if (mtime === null) return null;

      const cwd =
        (await readFirstFromJsonlDir(dir, claudeCwdExtractor)) ?? fallbackDashDecode(entry);
      if (!cwd) return null;
      if (!(await isDirectory(cwd))) return null;

      return {
        name: path.basename(cwd),
        path: cwd,
        lastActiveMs: mtime,
        lastActiveDisplay: formatRelativeTime(mtime),
        sources: ["claude-code"],
      };
    }),
  );
  return results.filter((p): p is DiscoveredProject => p !== null);
}

/**
 * Scan ~/.codex/sessions/. Codex stores sessions flat by date
 * (`YYYY/MM/DD/rollout-*.jsonl`) with the cwd embedded in the first user
 * message as `<environment_context><cwd>/abs/path</cwd>...</environment_context>`.
 * We group sessions by extracted cwd and take max mtime per group.
 */
async function discoverCodexProjects(): Promise<DiscoveredProject[]> {
  const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
  if (!(await isDirectory(sessionsDir))) return [];

  // Layout is YYYY/MM/DD/*.jsonl — depth 4 covers it.
  const files = await collectJsonlFiles(sessionsDir, 4);
  if (files.length === 0) return [];

  // Process newest first so per-cwd we always start with the latest mtime.
  files.sort((a, b) => b.mtime - a.mtime);

  const byCwd = new Map<string, number>();
  for (const f of files) {
    const cwd = await readFirstFromFile(f.path, codexCwdExtractor);
    if (!cwd) continue;
    const prev = byCwd.get(cwd);
    if (prev === undefined || f.mtime > prev) byCwd.set(cwd, f.mtime);
  }

  const results: DiscoveredProject[] = [];
  for (const [cwd, mtime] of byCwd) {
    if (!(await isDirectory(cwd))) continue;
    results.push({
      name: path.basename(cwd),
      path: cwd,
      lastActiveMs: mtime,
      lastActiveDisplay: formatRelativeTime(mtime),
      sources: ["codex"],
    });
  }
  return results;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function maxJsonlMtime(dir: string): Promise<number | null> {
  if (!(await isDirectory(dir))) return null;
  const files = await collectJsonlFiles(dir, 2);
  if (files.length === 0) return null;
  let max = 0;
  for (const f of files) if (f.mtime > max) max = f.mtime;
  return max > 0 ? max : null;
}

/**
 * Walk `dir` up to `maxDepth` levels deep collecting every .jsonl file. Used
 * for both Claude Code (top-level + `<uuid>/subagents/`) and Codex
 * (`YYYY/MM/DD/`) layouts.
 */
async function collectJsonlFiles(
  dir: string,
  maxDepth: number,
): Promise<{ path: string; mtime: number }[]> {
  const out: { path: string; mtime: number }[] = [];
  await walk(dir, 0);
  return out;

  async function walk(current: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const s = await fs.stat(full);
          out.push({ path: full, mtime: s.mtimeMs });
        } catch {
          // skip unreadable
        }
      } else if (e.isDirectory() && depth < maxDepth) {
        await walk(full, depth + 1);
      }
    }
  }
}

type LineExtractor = (line: string) => string | null;

const claudeCwdExtractor: LineExtractor = (line) => {
  try {
    const parsed = JSON.parse(line) as { cwd?: unknown };
    if (typeof parsed.cwd === "string" && parsed.cwd.startsWith("/")) return parsed.cwd;
  } catch {
    // skip malformed
  }
  return null;
};

const CODEX_CWD_RE = /<cwd>([^<]+)<\/cwd>/;
const codexCwdExtractor: LineExtractor = (line) => {
  // Current format (openai/codex protocol.rs, late-2025+): RolloutLine wraps
  // SessionMeta / TurnContext items with `{ type, payload: { cwd, ... } }`.
  // First line is always SessionMeta, so this hits on read 1.
  try {
    const parsed = JSON.parse(line) as { payload?: { cwd?: unknown } };
    const cwd = parsed.payload?.cwd;
    if (typeof cwd === "string" && cwd.startsWith("/")) return cwd;
  } catch {
    // not JSON or unexpected shape; fall through to legacy regex
  }
  // Legacy format (pre-late-2025): cwd embedded as <cwd>...</cwd> inside an
  // <environment_context> user-message string.
  const m = CODEX_CWD_RE.exec(line);
  if (m && m[1] && m[1].startsWith("/")) return m[1];
  return null;
};

/**
 * Walk all .jsonl files under `dir` newest-first, returning the first non-null
 * extractor result. Walks two levels deep (matches Claude Code's nested
 * layout).
 */
async function readFirstFromJsonlDir(
  dir: string,
  extractor: LineExtractor,
): Promise<string | null> {
  const files = await collectJsonlFiles(dir, 2);
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files) {
    const v = await readFirstFromFile(f.path, extractor);
    if (v) return v;
  }
  return null;
}

/**
 * Stream `file` line-by-line and return the first non-null extractor result.
 * Caps lines so a giant transcript can't stall discovery.
 */
async function readFirstFromFile(file: string, extractor: LineExtractor): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(file, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lines = 0;
    let done = false;
    const MAX_LINES = 200;
    // Resolve before tearing down. rl.close() synchronously emits 'close',
    // and if the close handler resolves first our real value gets swallowed.
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      resolve(value);
      rl.close();
      stream.destroy();
    };
    rl.on("line", (line) => {
      if (done) return;
      lines++;
      if (lines > MAX_LINES) {
        finish(null);
        return;
      }
      const v = extractor(line);
      if (v) finish(v);
    });
    rl.on("close", () => finish(null));
    rl.on("error", () => finish(null));
    stream.on("error", () => finish(null));
  });
}

function fallbackDashDecode(entry: string): string | null {
  // Strip leading "-" then turn remaining "-" into "/". Lossy by design — only
  // used when the JSONLs have no cwd events; the caller still verifies the
  // result is an existing directory.
  if (!entry.startsWith("-")) return null;
  return "/" + entry.slice(1).replace(/-/g, "/");
}

function formatRelativeTime(ms: number): string {
  if (ms === 0) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < week) return `${Math.floor(diff / day)}d ago`;
  if (diff < month) return `${Math.floor(diff / week)}w ago`;
  return `${Math.floor(diff / month)}mo ago`;
}
