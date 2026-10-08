import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePath } from "./tools/path-utils.js";

/** Most files reported for one session. */
export const SESSION_FILES_MAX = 100;

/** Extensions a markdown link must have to count as a file the session made. */
const LINKED = new Set([
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "csv",
  "tsv",
  "json",
  "md",
  "markdown",
  "txt",
  "html",
  "htm",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "mp3",
  "m4a",
  "wav",
  "mp4",
  "mov",
]);

/**
 * `[label](href)` / `![alt](<href with spaces> "title")`. Every run is
 * bounded, so a reply full of unclosed brackets is scanned in linear time.
 */
const LINK_RE =
  /!?\[[^\]\n]{0,500}\]\(\s*(<[^>\n]{0,2048}>|[^\s()<>]{1,2048})(?:\s+(?:"[^"\n]{0,500}"|'[^'\n]{0,500}'))?\s*\)/g;

/** Message shape as read from a transcript: content is untrusted JSON. */
export interface SessionFileMessage {
  role: string;
  content: unknown;
}

function stripQueryHash(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}

/** A link target as a local path, or null for other schemes and bad escapes. */
function linkPath(rawHref: string): string | null {
  let href = rawHref.trim();
  if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1).trim();
  if (!href) return null;
  if (/^file:/i.test(href)) {
    try {
      return fileURLToPath(stripQueryHash(href));
    } catch {
      return null;
    }
  }
  // Any other scheme (http, mailto, data...) is not a local file. A Windows
  // drive letter (`C:\x`, `C:/x`) is a path, not a scheme.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return null;
  const bare = stripQueryHash(href);
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}

function linkedExtension(p: string): boolean {
  return LINKED.has(path.extname(p).slice(1).toLowerCase());
}

/** Paths mentioned by one assistant message, latest mention first. */
function messagePaths(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return typeof content === "string" ? textPaths(content) : [];
  }
  const out: string[] = [];
  for (let i = content.length - 1; i >= 0; i--) {
    const part: unknown = content[i];
    if (typeof part !== "object" || part === null) continue;
    const { type, text, name, args } = part as {
      type?: unknown;
      text?: unknown;
      name?: unknown;
      args?: unknown;
    };
    if (type === "text" && typeof text === "string") {
      out.push(...textPaths(text));
    } else if (type === "tool_call" && typeof args === "object" && args !== null) {
      const a = args as { file_path?: unknown; out_path?: unknown };
      const target =
        name === "write"
          ? a.file_path
          : name === "generate_image" || name === "screenshot"
            ? a.out_path
            : undefined;
      if (typeof target === "string" && target.trim()) out.push(target.trim());
    }
  }
  return out;
}

function textPaths(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LINK_RE)) {
    const p = linkPath(match[1] ?? "");
    if (p && linkedExtension(p)) found.push(p);
  }
  return found.reverse();
}

/**
 * Files a session made, newest mention first: `write` / `generate_image` /
 * `screenshot` tool calls and markdown links (to document/media types) in
 * assistant replies. Absolute, normalized, deduplicated, at most 100. Never
 * touches the filesystem; callers validate existence and containment.
 */
export function sessionFilesFromMessages(
  messages: readonly SessionFileMessage[],
  cwd: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < SESSION_FILES_MAX; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    for (const raw of messagePaths(message.content)) {
      let abs: string;
      try {
        abs = path.normalize(resolvePath(cwd, raw));
      } catch {
        continue;
      }
      if (!path.isAbsolute(abs) || seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
      if (out.length >= SESSION_FILES_MAX) break;
    }
  }
  return out;
}
