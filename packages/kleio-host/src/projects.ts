// Kleio's projects, for her voice (list_projects, read_project, create_project,
// and coding work sent to a project): the folders directly inside Kleio's
// projects folders, where Code sessions run. A device only ever sees a
// project's name; the host finds the folder again by that name among the
// folders it lists, so a name can't reach anywhere a listing couldn't.
//
// Folders are found by lstat: a symlinked folder, a hidden one, tooling and
// build folders, and Kleio's own folder are not projects. On a Mac, the
// folders behind a privacy consent (Desktop, Documents, Downloads) are never
// touched: unattended, touching one parks the call until someone answers a
// dialog nobody sees (the sidecar's own project scan skips them too).

import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileKind, listFolder, type FileKind, type FoundFile } from "./agent-files.js";
import { err, ok, type Result } from "./result.js";
import type { SavedRow } from "./saved-sessions.js";
import { checkPrompt, jsonObject } from "./started-chats.js";

/** Projects answered to a device at most. */
export const PROJECTS_MAX = 40;
/** A project's newest coding sessions answered with its status. */
export const RECENT_MAX = 5;
/** A project's newest documents answered with its status. */
export const STATUS_DOCS_MAX = 10;
/** The longest project name a device may send to find one. */
const PROJECT_NAME_MAX = 255;
/** The longest name for a new project. */
const NEW_PROJECT_NAME_MAX = 64;
/** A new project's name: lowercase letters, digits and dashes (the app's own rule). */
const NEW_PROJECT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Folders in a projects folder that are never projects (as the sidecar's scan). */
const NOT_PROJECTS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "tmp",
  "temp",
  "Library",
  "Applications",
  "GG Motion",
]);

/** Build output and vendored code inside a project: never its documentation. */
const BUILD_FOLDERS: ReadonlySet<string> = new Set([
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
]);

/** A Mac's folders behind a per-app privacy consent. */
const CONSENT_FOLDERS = ["Desktop", "Documents", "Downloads"];

/** What a project's documentation can be: words to read, not code, data or media. */
const DOC_KINDS: ReadonlySet<FileKind> = new Set([
  "pdf",
  "document",
  "spreadsheet",
  "slides",
  "web_page",
  "text",
]);

/** The one hidden folder whose files a project lists: its coding agents' plans. */
export const PLANS_PATH = ".gg/plans";

/** A name a device sent to find a project by: one plain, visible folder name. */
export function isProjectName(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > PROJECT_NAME_MAX) return false;
  // Covers ".", ".." and every hidden name.
  if (v.startsWith(".")) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    // control characters (incl. NUL), DEL, "/" and "\"
    if (c < 0x20 || c === 0x7f || c === 0x2f || c === 0x5c) return false;
  }
  return true;
}

/** A name a new project may have: one the listing would show, in the app's form. */
export function isNewProjectName(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= NEW_PROJECT_NAME_MAX &&
    NEW_PROJECT_NAME.test(v) &&
    !NOT_PROJECTS.has(v)
  );
}

/** POST /kleio/projects's body: `{ name }`, a new project's name. err = the 400's detail. */
export function parseNewProject(raw: string): Result<string, string> {
  const o = jsonObject(raw);
  if (!o.ok) return o;
  const { name } = o.value;
  if (!isNewProjectName(name))
    return err(
      `name must be 1 to ${NEW_PROJECT_NAME_MAX} lowercase letters, digits and single dashes`,
    );
  return ok(name);
}

/** POST /kleio/projects/code's body: `{ name, prompt }`. err = the 400's detail. */
export function parseStartCode(
  raw: string,
): Result<{ readonly name: string; readonly prompt: string }, string> {
  const o = jsonObject(raw);
  if (!o.ok) return o;
  const { name, prompt } = o.value;
  if (!isProjectName(name)) return err("name must be a project's name");
  const text = checkPrompt(prompt);
  if (!text.ok) return text;
  return ok({ name, prompt: text.value });
}

/**
 * Whether `p` is, or is inside, a Mac folder behind a privacy consent. It is
 * compared as spelled, never resolved: resolving a path below one of them is
 * itself a gated call.
 */
export function consentGated(
  p: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "darwin") return false;
  const at = resolve(p);
  return CONSENT_FOLDERS.some((name) => {
    const folder = join(home, name);
    return at === folder || at.startsWith(folder + sep);
  });
}

/**
 * Whether a projects folder may hold projects: an absolute path that is not
 * the home folder, a filesystem root or behind a privacy consent. Listing the
 * children of the first two would call mail, music and system folders
 * projects (the sidecar's own scan refuses them too).
 */
export function usableRoot(
  root: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!isAbsolute(root)) return false;
  const at = resolve(root);
  return at !== resolve(home) && at !== parse(at).root && !consentGated(at, home, platform);
}

export interface ProjectFolder {
  readonly name: string;
  /** Its folder as Code sessions are given it: the projects folder as configured, then the name. */
  readonly dir: string;
  /** The same folder's real path. */
  readonly real: string;
  /** When the folder itself last changed (an entry added or removed), in ms. */
  readonly mtimeMs: number;
}

export interface ProjectScan {
  /** The user's home folder, for the consent check. */
  readonly home: string;
  /** Leaves out a folder by its real path (Kleio's own). */
  readonly skip?: (real: string) => boolean;
  readonly platform?: NodeJS.Platform;
}

/**
 * The project folders directly inside `roots`, in root order then by name. A
 * name is listed once, the first root's winning, compared without case as a
 * Mac's disks compare names.
 */
export async function projectFolders(
  roots: readonly string[],
  scan: ProjectScan,
): Promise<ProjectFolder[]> {
  const out: ProjectFolder[] = [];
  const names = new Set<string>();
  const seenRoots = new Set<string>();
  for (const root of roots) {
    if (!usableRoot(root, scan.home, scan.platform)) continue;
    let realRoot: string;
    let entries: string[];
    try {
      realRoot = await realpath(root);
      // A link to the home folder is the home folder.
      if (seenRoots.has(realRoot) || !usableRoot(realRoot, scan.home, scan.platform)) continue;
      seenRoots.add(realRoot);
      entries = (await readdir(realRoot)).sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".") || NOT_PROJECTS.has(name) || names.has(name.toLowerCase())) continue;
      const real = join(realRoot, name);
      let st;
      try {
        st = await lstat(real);
      } catch {
        continue;
      }
      if (!st.isDirectory() || scan.skip?.(real)) continue;
      names.add(name.toLowerCase());
      out.push({ name, dir: join(root, name), real, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

/** The project called `name` (exactly, else without case), or null. */
export async function findProject(
  roots: readonly string[],
  name: string,
  scan: ProjectScan,
): Promise<ProjectFolder | null> {
  const all = await projectFolders(roots, scan);
  const lower = name.toLowerCase();
  return (
    all.find((p) => p.name === name) ?? all.find((p) => p.name.toLowerCase() === lower) ?? null
  );
}

/** Whether a session that ran in `cwd` worked in `project` (its folder or one inside it). */
export function worksIn(cwd: string, project: ProjectFolder): boolean {
  const at = resolve(cwd);
  // Both sides resolved, so they compare alike (on Windows, "/p/app" is "D:\p\app").
  return [project.dir, project.real].some((d) => {
    const base = resolve(d);
    return at === base || at.startsWith(base + sep);
  });
}

export type CreateProjectError = "exists" | "no_folder";

/**
 * Makes a new project's folder in the first projects folder. `name` must pass
 * isNewProjectName. A name any projects folder already has (without case) is
 * "exists", as is a folder made meanwhile: mkdir never reuses one.
 */
export async function createProject(
  roots: readonly string[],
  name: string,
  scan: ProjectScan,
): Promise<Result<ProjectFolder, CreateProjectError>> {
  const root = roots[0];
  if (root === undefined || !usableRoot(root, scan.home, scan.platform)) return err("no_folder");
  if (await findProject(roots, name, scan)) return err("exists");
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  if (!usableRoot(realRoot, scan.home, scan.platform)) return err("no_folder");
  const real = join(realRoot, name);
  try {
    await mkdir(real);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return err("exists");
    throw e;
  }
  return ok({ name, dir: join(root, name), real, mtimeMs: (await lstat(real)).mtimeMs });
}

// ---------------------------------------------------------------- documents

/**
 * Whether the file at `path` ("/"-joined, relative to a project or its plans
 * folder) is a document: words to read, outside build output, with no empty,
 * dot or hidden segment on the way.
 */
export function isProjectDoc(path: string): boolean {
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? "";
  return (
    segments.every((s) => s !== "" && !s.startsWith(".")) &&
    DOC_KINDS.has(fileKind(name)) &&
    !segments.slice(0, -1).some((s) => BUILD_FOLDERS.has(s))
  );
}

/** A project's plans folder's real path, or null when it is missing or reached through a symlink. */
async function plansFolder(base: string): Promise<string | null> {
  try {
    const want = join(await realpath(base), ...PLANS_PATH.split("/"));
    return (await realpath(want)) === want && (await lstat(want)).isDirectory() ? want : null;
  } catch {
    return null;
  }
}

/** A project's documents (README, docs, reports, its coding agents' plans), by its real path. */
export async function projectDocs(real: string): Promise<FoundFile[]> {
  const docs = (await listFolder(real, BUILD_FOLDERS)).filter((f) => isProjectDoc(f.path));
  const plans = await plansFolder(real);
  if (plans) {
    for (const f of await listFolder(plans)) {
      if (isProjectDoc(f.path)) docs.push({ ...f, path: `${PLANS_PATH}/${f.path}` });
    }
  }
  return docs;
}

/**
 * Where the project document at `path` is read from: a folder and the path
 * inside it, or null when it can't be one of the project's documents. A plan
 * is read from inside the plans folder, so no hidden name is ever walked.
 */
export async function projectDocAt(
  real: string,
  path: string,
): Promise<{ readonly root: string; readonly path: string } | null> {
  if (!path.startsWith(`${PLANS_PATH}/`)) return isProjectDoc(path) ? { root: real, path } : null;
  const inPlans = path.slice(PLANS_PATH.length + 1);
  if (!isProjectDoc(inPlans)) return null;
  const plans = await plansFolder(real);
  return plans ? { root: plans, path: inPlans } : null;
}

// ---------------------------------------------------------------- status

/** A coding session working, or waiting on the user, right now. */
export interface CodeJob {
  readonly cwd: string;
  readonly phase: "working" | "needsYou";
  /** What it is doing ("Running tests"), or what it asks. */
  readonly line: string;
}

export interface ProjectSummary {
  readonly name: string;
  /** ISO: the newest of its folder's last change and its sessions' activity. */
  readonly lastActivity: string;
  /** Its saved coding sessions. */
  readonly sessions: number;
  /** What a coding session in it is doing now; absent when none is. */
  readonly now?: { readonly state: "working" | "needs_you"; readonly doing: string };
}

export interface ProjectStatus extends ProjectSummary {
  /** Its newest coding sessions, newest first (at most RECENT_MAX). */
  readonly recent: readonly { readonly title: string; readonly lastActivity: string }[];
}

const timeOf = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** One project, from the saved coding sessions and the jobs running now. */
export function projectStatus(
  project: ProjectFolder,
  rows: readonly SavedRow[],
  jobs: readonly CodeJob[],
): ProjectStatus {
  const mine = rows
    .filter((r) => worksIn(r.cwd, project))
    .sort((a, b) => timeOf(b.lastActivity) - timeOf(a.lastActivity));
  const running = jobs.filter((j) => worksIn(j.cwd, project));
  // A question waiting on the user matters more than work going on.
  const job = running.find((j) => j.phase === "needsYou") ?? running[0];
  const newest = Math.max(project.mtimeMs, ...mine.map((r) => timeOf(r.lastActivity)));
  return {
    name: project.name,
    lastActivity: new Date(newest).toISOString(),
    sessions: mine.length,
    ...(job
      ? { now: { state: job.phase === "needsYou" ? "needs_you" : "working", doing: job.line } }
      : {}),
    recent: mine.slice(0, RECENT_MAX).map((r) => ({
      title: r.title,
      lastActivity: r.lastActivity,
    })),
  };
}

/** The id of the project's most recently active coding session, or null. */
export function newestSession(project: ProjectFolder, rows: readonly SavedRow[]): string | null {
  let best: SavedRow | null = null;
  for (const r of rows) {
    if (!worksIn(r.cwd, project)) continue;
    if (!best || timeOf(r.lastActivity) > timeOf(best.lastActivity)) best = r;
  }
  return best?.id ?? null;
}

/** Every project, most recently active first (then by name), at most PROJECTS_MAX. */
export function projectSummaries(
  projects: readonly ProjectFolder[],
  rows: readonly SavedRow[],
  jobs: readonly CodeJob[],
): ProjectSummary[] {
  return projects
    .map((p) => {
      const { recent: _recent, ...summary } = projectStatus(p, rows, jobs);
      return summary;
    })
    .sort(
      (a, b) =>
        timeOf(b.lastActivity) - timeOf(a.lastActivity) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .slice(0, PROJECTS_MAX);
}
