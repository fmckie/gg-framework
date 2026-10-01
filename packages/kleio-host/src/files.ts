// An agent's own files (the reports and images it writes in its folder),
// served to paired devices so a link in chat opens.
//
// The request path arrives still percent-encoded and is judged segment by
// segment before the disk is touched: no empty, "." or ".." segments, no
// hidden ones (.venv, .env, .cache …), no separator or control character
// smuggled in through an escape. Then the real path must sit strictly inside
// the folder's real path, so a symlink never leads out of it, and it must be
// a regular file under the size cap.

import { realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { err, ok, type Result } from "./result.js";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Longest still-encoded path accepted after `/files/`. */
const MAX_RAW_PATH = 1024;
const MAX_SEGMENTS = 16;

export interface AgentFile {
  /** Real path, inside the folder's real path. */
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  /** The last segment, decoded. */
  readonly name: string;
}

export interface AgentFileError {
  readonly kind: "bad_path" | "not_found" | "too_large";
}

/** Errors that mean "there is nothing here you may read". Anything else is a real fault. */
const ABSENT = new Set(["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG", "EACCES", "EPERM", "EINVAL"]);

function absent(e: unknown): boolean {
  return ABSENT.has(String((e as NodeJS.ErrnoException | null)?.code));
}

/** The decoded segments of `rawPath`, or null when any of them is not allowed. */
function segmentsOf(rawPath: string): string[] | null {
  if (rawPath.length > MAX_RAW_PATH) return null;
  const raw = rawPath.split("/");
  if (raw.length > MAX_SEGMENTS) return null;
  const out: string[] = [];
  for (const r of raw) {
    let s: string;
    try {
      s = decodeURIComponent(r);
    } catch {
      return null;
    }
    // Covers "", ".", ".." and every hidden name.
    if (s.length === 0 || s.startsWith(".")) return null;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      // control characters (incl. NUL), DEL, "/" and "\"
      if (c < 0x20 || c === 0x7f || c === 0x2f || c === 0x5c) return null;
    }
    out.push(s);
  }
  return out;
}

/**
 * Resolve `rawPath` (the still-encoded remainder after `/files/`) to a
 * readable regular file inside `root`.
 */
export async function resolveAgentFile(
  root: string,
  rawPath: string,
  maxBytes = MAX_FILE_BYTES,
): Promise<Result<AgentFile, AgentFileError>> {
  const segments = segmentsOf(rawPath);
  if (!segments) return err({ kind: "bad_path" });
  const name = segments[segments.length - 1]!;

  let rootReal: string;
  let target: string;
  try {
    rootReal = await realpath(root);
    target = await realpath(join(root, ...segments));
  } catch (e) {
    if (absent(e)) return err({ kind: "not_found" });
    throw e;
  }
  // Strictly inside: the folder itself is not a file, and a symlink that
  // resolves anywhere else (even a sibling folder) is not there.
  if (!target.startsWith(rootReal + sep)) return err({ kind: "not_found" });

  let st;
  try {
    st = await stat(target);
  } catch (e) {
    if (absent(e)) return err({ kind: "not_found" });
    throw e;
  }
  if (!st.isFile()) return err({ kind: "not_found" });
  if (st.size > maxBytes) return err({ kind: "too_large" });
  return ok({ path: target, size: st.size, mtimeMs: st.mtimeMs, name });
}

const CONTENT_TYPES = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".json", "application/json"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);

/**
 * Content type by extension. Anything not listed — html, svg, js included —
 * is an opaque download, never something a client renders as active content.
 */
export function fileContentType(name: string): string {
  return CONTENT_TYPES.get(extname(name).toLowerCase()) ?? "application/octet-stream";
}

/** `attachment` with the RFC 5987 UTF-8 file name (encodeURIComponent leaves '()* bare). */
export function contentDisposition(name: string): string {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}
