// The files an agent made, for Kleio's voice (list_files / read_file): Kleio's
// own main chat, a specialist, a group's members, or a saved chat or coding
// session. Listing walks the owner's folder without ever following a symlink;
// a session's files come from the sidecar and are kept only when their real
// path sits strictly inside the session's folder. Reading goes through
// files.ts's resolveAgentFile, so every rule of the file route applies.

import { lstat, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, sep } from "node:path";
import { err, ok, type Result } from "./result.js";

export type FileKind =
  | "pdf"
  | "document"
  | "spreadsheet"
  | "slides"
  | "web_page"
  | "text"
  | "data"
  | "code"
  | "image"
  | "audio"
  | "video"
  | "other";

const KIND_EXTENSIONS: Readonly<Record<Exclude<FileKind, "other">, readonly string[]>> = {
  pdf: ["pdf"],
  document: ["docx", "doc", "rtf", "odt"],
  spreadsheet: ["xlsx", "xls", "numbers"],
  slides: ["pptx", "ppt", "key"],
  web_page: ["html", "htm"],
  text: ["txt", "text", "md", "markdown"],
  data: ["csv", "tsv", "json", "xml", "yaml", "yml", "toml"],
  code: [
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",
    "py",
    "rb",
    "go",
    "rs",
    "swift",
    "java",
    "kt",
    "c",
    "h",
    "cpp",
    "hpp",
    "cs",
    "php",
    "sh",
    "sql",
    "css",
    "scss",
  ],
  image: ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"],
  audio: ["mp3", "m4a", "wav", "aac"],
  video: ["mp4", "mov", "webm"],
};

/** Lowercase extension (no dot) → kind. Anything absent is "other". */
export const FILE_KINDS: ReadonlyMap<string, FileKind> = new Map(
  Object.entries(KIND_EXTENSIONS).flatMap(([kind, exts]) =>
    exts.map((e): [string, FileKind] => [e, kind as FileKind]),
  ),
);

/** Extensions the sidecar's POST /file-text can turn into text. Nothing else is read. */
export const READABLE: ReadonlySet<string> = new Set([
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "html",
  "htm",
  ...KIND_EXTENSIONS.text,
  ...KIND_EXTENSIONS.data,
  ...KIND_EXTENSIONS.code,
]);

/** Largest file read_file extracts. */
export const MAX_READ_BYTES = 20 * 1024 * 1024;
/** Characters per part of a long file. */
export const PART_CHARS = 12_000;
/** Most entries list_files answers. */
export const LIST_MAX = 40;

function extensionOf(name: string): string {
  return extname(name).slice(1).toLowerCase();
}

export function fileKind(name: string): FileKind {
  return FILE_KINDS.get(extensionOf(name)) ?? "other";
}

export function isReadable(name: string): boolean {
  return READABLE.has(extensionOf(name));
}

/** A file found for an owner, before it is shaped for a device. */
export interface FoundFile {
  /** "/"-joined, relative to the owner's folder. */
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface AgentFileEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: FileKind;
  readonly size: number;
  /** ISO time. */
  readonly modified: string;
  readonly readable: boolean;
  /** Group only: the member's Blob id. */
  readonly member?: string;
  /** Group only: the member's name. */
  readonly by?: string;
}

export function toEntry(f: FoundFile, tag?: { member: string; by?: string }): AgentFileEntry {
  return {
    path: f.path,
    name: f.name,
    kind: fileKind(f.name),
    size: f.size,
    modified: new Date(f.mtimeMs).toISOString(),
    readable: isReadable(f.name) && f.size <= MAX_READ_BYTES,
    ...(tag ? { member: tag.member, ...(tag.by !== undefined ? { by: tag.by } : {}) } : {}),
  };
}

/** Newest first, at most LIST_MAX. */
export function newestFirst(entries: readonly AgentFileEntry[]): AgentFileEntry[] {
  return [...entries]
    .sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0))
    .slice(0, LIST_MAX);
}

/** Folders never walked into (and never read from): tooling, not an agent's work. */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  "node_modules",
  "__pycache__",
  "venv",
  "site-packages",
]);
/** Folder levels walked below the owner's folder. */
export const MAX_DEPTH = 5;
/** Directory entries looked at before the walk stops. */
export const MAX_VISITED = 3_000;

/** Whether a "/"-split relative path is one listFolder could have produced. */
export function walkable(segments: readonly string[]): boolean {
  return segments.every(
    (s, i) =>
      s.length > 0 && !s.startsWith(".") && (i === segments.length - 1 || !SKIPPED_FOLDERS.has(s)),
  );
}

/**
 * Every regular file under `root`, breadth first, by lstat: a symlink is
 * neither listed nor followed. Hidden names and SKIPPED_FOLDERS are left out;
 * `skipTop` names are left out at the top level only. A missing folder is empty.
 */
export async function listFolder(
  root: string,
  skipTop: ReadonlySet<string> = new Set(),
): Promise<FoundFile[]> {
  let base: string;
  try {
    base = await realpath(root);
    if (!(await lstat(base)).isDirectory()) return [];
  } catch {
    return [];
  }
  const out: FoundFile[] = [];
  let visited = 0;
  let level: { dir: string; rel: string[] }[] = [{ dir: base, rel: [] }];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: { dir: string; rel: string[] }[] = [];
    for (const { dir, rel } of level) {
      let names: string[];
      try {
        names = (await readdir(dir)).sort();
      } catch {
        continue;
      }
      for (const name of names) {
        if (++visited > MAX_VISITED) return out;
        if (name.startsWith(".")) continue;
        if (depth === 0 && skipTop.has(name)) continue;
        const full = dir + sep + name;
        let st;
        try {
          st = await lstat(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!SKIPPED_FOLDERS.has(name)) next.push({ dir: full, rel: [...rel, name] });
        } else if (st.isFile()) {
          out.push({ path: [...rel, name].join("/"), name, size: st.size, mtimeMs: st.mtimeMs });
        }
      }
    }
    level = next;
  }
  return out;
}

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** Most paths taken from a session's list. */
const MAX_SESSION_PATHS = 500;
const MAX_PATH = 4096;

/**
 * The files a chat or coding session reported (absolute, unvalidated) that
 * are regular files whose real path is strictly inside `dir` (a real path),
 * with no hidden segment on the way. Paths are relative to `dir`.
 */
export async function sessionFiles(dir: string, reported: unknown): Promise<FoundFile[]> {
  if (!Array.isArray(reported)) return [];
  const out: FoundFile[] = [];
  const seen = new Set<string>();
  for (const p of reported.slice(0, MAX_SESSION_PATHS)) {
    if (typeof p !== "string" || p.length === 0 || p.length > MAX_PATH || !isAbsolute(p)) continue;
    if (hasControl(p)) continue;
    let real: string;
    let st;
    try {
      real = await realpath(p);
      st = await lstat(real);
    } catch {
      continue;
    }
    if (!st.isFile() || !real.startsWith(dir + sep)) continue;
    const rel = relative(dir, real);
    if (rel.length === 0 || isAbsolute(rel)) continue;
    const segments = rel.split(sep);
    if (segments.includes("..") || !walkable(segments)) continue;
    const path = segments.join("/");
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      name: segments[segments.length - 1] ?? path,
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  }
  return out;
}

/** Extracted text, as the sidecar's POST /file-text answered it. */
export interface ExtractedText {
  readonly text: string;
  readonly pages?: number;
}

export interface TextCache {
  get(key: string): ExtractedText | undefined;
  set(key: string, value: ExtractedText): void;
}

/** A small LRU with a TTL, for extracted text keyed by real path + size + mtime. */
export function createTextCache(max = 6, ttlMs = 10 * 60_000, now = Date.now): TextCache {
  const entries = new Map<string, { value: ExtractedText; at: number }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      entries.delete(key);
      if (now() - hit.at > ttlMs) return undefined;
      entries.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, at: now() });
      while (entries.size > max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
  };
}

/** Part `part` (from 1) of `text`, or the number of parts when there is no such part. */
export function partOf(
  text: string,
  part: number,
): Result<{ text: string; parts: number }, { parts: number }> {
  const parts = Math.max(1, Math.ceil(text.length / PART_CHARS));
  if (part > parts) return err({ parts });
  return ok({ text: text.slice((part - 1) * PART_CHARS, part * PART_CHARS), parts });
}
