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

/** Whose folder a specialist's link points into: a Specialist's own
 *  (`…/Kleio/blobs/<blobId>/`) or a group member's (`…/Kleio/groups/<groupId>/<blobId>/`). */
export interface SpecialistFolder {
  readonly blobId: string;
  readonly groupId?: string;
}

/**
 * The path inside a specialist's folder that its link points at, or null.
 * Takes relative links like `agentFilePath`, and also absolute paths on the
 * Mac mini whose folder part ends in this specialist's own
 * `/Kleio/blobs/<blobId>/` or `/Kleio/groups/<groupId>/<blobId>/` (the app
 * doesn't know the mini's home folder), cut down to the part below it. A path
 * into any other folder is refused.
 */
export function specialistFilePath(href: string, folder: SpecialistFolder): string | null {
  const h = href.trim();
  if (!h.startsWith("/")) return agentFilePath(h);
  if (!folder.blobId || folder.groupId === "") return null;
  const parts = decodedSegments(h.replace(/[?#].*$/, ""));
  if (!parts) return null;
  const tail = folder.groupId
    ? ["Kleio", "groups", folder.groupId, folder.blobId]
    : ["Kleio", "blobs", folder.blobId];
  // parts[0] is "" (leading slash); the home folder sits between it and the tail.
  for (let i = parts.length - tail.length - 1; i >= 1; i--) {
    if (tail.every((s, j) => parts[i + j] === s)) {
      if (parts.slice(1, i).some((s) => !s || s === "." || s === "..")) return null;
      return relativeFile(parts.slice(i + tail.length));
    }
  }
  return null;
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
 * `agentFilePath`, and also absolute, `file://` and `~/` links under `cwd`
 * (Code agents often print absolute paths, chats `~/…` ones), cut down to the
 * part below `cwd`.
 */
export function workspaceFilePath(href: string, cwd: string): string | null {
  let h = href.trim();
  const file = /^file:\/\/(?:localhost)?(\/[^?#]*)/i.exec(h);
  // "~/…", or "/~/…" as `filesBy` passes a named one on.
  const tilde = /^\/?~(?=\/)/.exec(h);
  if (file) h = file[1] ?? "";
  else if (tilde) {
    const home = homeFolder(cwd);
    if (!home) return null;
    h = home + h.slice(tilde[0].length);
  } else if (!h.startsWith("/")) return agentFilePath(h);
  const base = cwd.replace(/\/+$/, "").split("/");
  if (!cwd.startsWith("/") || base.slice(1).some((s) => !s)) return null;
  const parts = decodedSegments(h.replace(/[?#].*$/, ""));
  if (!parts || parts.length <= base.length) return null;
  if (base.some((s, i) => parts[i] !== s)) return null;
  return relativeFile(parts.slice(base.length));
}

/**
 * The home folder `cwd` is in, `/Users/<name>` (the host is a Mac), which a
 * `~/…` path the agent wrote starts from; null when `cwd` is in no home
 * (`/Users/Shared` is nobody's).
 */
function homeFolder(cwd: string): string | null {
  const name = /^\/Users\/([^/]+)(?:\/|$)/.exec(cwd)?.[1];
  return name && name !== "Shared" && plainSegment(name) ? `/Users/${name}` : null;
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
