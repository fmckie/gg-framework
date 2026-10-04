// Which chat links point at a file in an agent's folder on the Mac mini, and
// what kind of file it is. Pure path rules, no I/O: a click is claimed or
// passed on synchronously, so these stay in the initial chunk while opening,
// fetching and cards (kleioFiles.ts, FileCard.tsx) load on first use.

const MAX_SEGMENTS = 16;

function plainSegment(s: string): boolean {
  if (!s || s.startsWith(".")) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x2f || c === 0x5c) return false;
  }
  return true;
}

/**
 * The path inside the agent's folder that a chat link points at, or null for
 * anything else: web links, absolute or `file:` paths, `..`, hidden files,
 * and folders (the last part must have an extension). Mirrors the host's and
 * the Rust side's rules, which check again.
 */
export function agentFilePath(href: string): string | null {
  let h = href.trim();
  if (!h || h.startsWith("#") || h.startsWith("/") || h.startsWith("\\")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  h = h.replace(/[?#].*$/, "");
  while (h.startsWith("./")) h = h.slice(2);
  const segments = decodedSegments(h);
  return segments ? relativeFile(segments) : null;
}

/** The `/`-separated parts of a link, each percent-decoded; null when one
 *  does not decode. */
function decodedSegments(h: string): string[] | null {
  const out: string[] = [];
  for (const r of h.split("/")) {
    try {
      out.push(decodeURIComponent(r));
    } catch {
      return null;
    }
  }
  return out;
}

/** The relative file path made of these decoded parts, or null when one is
 *  not a plain name, there are too many, or the last has no extension. */
function relativeFile(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  if (!segments.every(plainSegment)) return null;
  const last = segments[segments.length - 1] ?? "";
  if (!/\.[a-z0-9]{1,8}$/i.test(last)) return null;
  return segments.join("/");
}

/**
 * The path inside a Chat/Code session's folder (`cwd`, absolute on the host)
 * that a chat link points at, or null. Takes relative links like
 * `agentFilePath`, and also absolute or `file://` links under `cwd` (Code
 * agents often print absolute paths), cut down to the part below `cwd`.
 */
export function workspaceFilePath(href: string, cwd: string): string | null {
  let h = href.trim();
  const file = /^file:\/\/(?:localhost)?(\/[^?#]*)/i.exec(h);
  if (file) h = file[1] ?? "";
  else if (!h.startsWith("/")) return agentFilePath(h);
  const base = cwd.replace(/\/+$/, "").split("/");
  if (!cwd.startsWith("/") || base.slice(1).some((s) => !s)) return null;
  const parts = decodedSegments(h.replace(/[?#].*$/, ""));
  if (!parts || parts.length <= base.length) return null;
  if (base.some((s, i) => parts[i] !== s)) return null;
  return relativeFile(parts.slice(base.length));
}

/** File types that are results for the user (reports, data, media, sites),
 *  as opposed to the code and notes a Code session also links to. */
export const OUTPUT_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "csv",
  "xlsx",
  "xls",
  "docx",
  "doc",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "html",
  "htm",
  "mp3",
  "m4a",
  "wav",
  "mp4",
  "mov",
]);

export function isOutputPath(path: string): boolean {
  return OUTPUT_EXTENSIONS.has(fileExtension(path));
}

/** A web page, opened as a site in the browser rather than downloaded. */
export function isSitePath(path: string): boolean {
  const ext = fileExtension(path);
  return ext === "html" || ext === "htm";
}

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m?.[1]?.toLowerCase() ?? "";
}
