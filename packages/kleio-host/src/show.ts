// A voice show (POST /kleio/voice/show, routes in host.ts): something Kleio
// puts on the user's screen, beside her, while she talks about it. A file one
// of her agents made, or a web page or PDF at a link (capture.ts draws those).
//
// A file is named only by its owner and a path relative to the owner's folder,
// never an absolute path, and is checked in four steps, again on every part
// request:
//   1. checkShowPath: the path's spelling. No empty, ".", ".." or "~" segment,
//      no backslash or control character, no percent escape that spells one,
//      and nothing hidden but an owner's `.gg/plans/<file>` and
//      `.gg/generated/<file>`, one level deep.
//   2. allowedAt: the place's allow-list. A plan must be a document and a
//      generated file a picture; nothing under tooling folders; in a project,
//      only its documents and pictures, outside build output.
//   3. showKind: a kind a show can draw. Never SVG or HTML as markup (HTML
//      shows as its text), HEIC, code, audio or video.
//   4. resolveShowFile: on disk, each segment a real folder or file by lstat,
//      so no symlink anywhere below the owner's folder.
// The owner's own checks (a specialist that exists, a current group member, a
// file the session made) are host.ts's.
//
// Shows live in memory, bound to the device that made them, for SHOW_TTL_MS.
// Nothing here logs: host.ts logs hosts, never names, paths or addresses.

import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileKind, SHOWN_IMAGES, SKIPPED_FOLDERS, type FilesSource } from "./agent-files.js";
import {
  failureText,
  type CaptureFailure,
  type PdfDoc,
  type UrlShot,
  type View,
} from "./capture.js";
import { BUILD_FOLDERS, DOC_KINDS } from "./projects.js";

/** How long a show can be looked at. */
export const SHOW_TTL_MS = 15 * 60_000;
/** The most of a text file, or of a document's text, a show draws. */
export const SHOW_TEXT_MAX = 1024 * 1024;
/** The largest picture file a show draws. */
export const SHOW_IMAGE_MAX = 20 * 1024 * 1024;
/** The largest PDF file a show draws. */
export const SHOW_PDF_MAX = 50 * 1024 * 1024;
/** The longest relative path a show takes. */
export const SHOW_PATH_MAX = 1024;
/** The highest page a part request may name (a PDF shows at most 100). */
export const SHOW_PAGE_MAX = 500;
/** Bytes read to tell what a picture is. */
export const IMAGE_SNIFF_BYTES = 12;
const SHOW_SEGMENTS_MAX = 16;
/** Shows kept for one device, and in all; the oldest go first. */
const SHOWS_PER_DEVICE = 20;
const SHOWS_MAX = 200;

const SHOW_ID = /^sh_[0-9a-f]{32}$/;

export function isShowId(v: string): boolean {
  return SHOW_ID.test(v);
}

// ---------------------------------------------------------------- parts

/** What a part request asks for: a show's text, its picture, or one page of its PDF. */
export type ShowPart =
  | { readonly kind: "text" }
  | { readonly kind: "image" }
  | { readonly kind: "page"; readonly page: number };

/** A part's name in a request path: `text`, `image` or `page-<n>`, n from 1 to SHOW_PAGE_MAX. */
export function parseShowPart(raw: string): ShowPart | null {
  if (raw === "text" || raw === "image") return { kind: raw };
  const m = /^page-([1-9][0-9]{0,2})$/.exec(raw);
  const page = m ? Number(m[1]) : 0;
  return page >= 1 && page <= SHOW_PAGE_MAX ? { kind: "page", page } : null;
}

// ---------------------------------------------------------------- paths

/** Where on the allow-list a file is: its owner's folder, or one of the two hidden folders in it. */
export type Place = "folder" | "plans" | "generated";

export interface ShowPath {
  readonly segments: readonly string[];
  readonly place: Place;
}

/** Control characters (NUL included), DEL, "/" and "\". */
function badChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x2f || c === 0x5c) return true;
  }
  return false;
}

/**
 * Whether one segment is a plain name. A percent escape is part of a name,
 * never decoded, but a segment whose decoding spells a dot-name, "~", a
 * separator or a control character is refused outright.
 */
function plainSegment(s: string): boolean {
  if (s.length === 0 || s === "." || s === ".." || s.startsWith("~") || badChars(s)) return false;
  let decoded = s;
  for (let i = 0; i < 3 && decoded.includes("%"); i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
    if (decoded.startsWith(".") || decoded.startsWith("~") || badChars(decoded)) return false;
  }
  return true;
}

/**
 * A show's path, judged by its spelling alone, or null. Relative and
 * "/"-separated; the only hidden segments allowed are `.gg/plans/<file>` and
 * `.gg/generated/<file>` at the top of the owner's folder.
 */
export function checkShowPath(path: string): ShowPath | null {
  // A drive letter ("C:x") makes a Windows path absolute or drive-relative.
  if (path.length === 0 || path.length > SHOW_PATH_MAX || /^[A-Za-z]:/.test(path)) return null;
  const segments = path.split("/");
  if (segments.length > SHOW_SEGMENTS_MAX || !segments.every(plainSegment)) return null;
  if (!segments.some((s) => s.startsWith("."))) return { segments, place: "folder" };
  const [gg, folder, name, ...rest] = segments;
  if (
    gg === ".gg" &&
    (folder === "plans" || folder === "generated") &&
    name !== undefined &&
    !name.startsWith(".") &&
    rest.length === 0
  )
    return { segments, place: folder };
  return null;
}

/**
 * Whether a checked path is on its place's allow-list: a plan must be a
 * document and a generated file a picture; in an owner's folder nothing under
 * a tooling folder (node_modules and the like), and in a project only its
 * documents and pictures, outside build output (never code, data or secrets).
 */
export function allowedAt(path: ShowPath, project: boolean): boolean {
  const name = path.segments[path.segments.length - 1] ?? "";
  const kind = fileKind(name);
  if (path.place === "plans") return DOC_KINDS.has(kind);
  if (path.place === "generated") return kind === "image";
  const folders = path.segments.slice(0, -1);
  if (folders.some((s) => SKIPPED_FOLDERS.has(s))) return false;
  if (!project) return true;
  return (DOC_KINDS.has(kind) || kind === "image") && !folders.some((s) => BUILD_FOLDERS.has(s));
}

// ---------------------------------------------------------------- kinds

/** How a show draws a file. */
export type ShowKind =
  | {
      readonly draws: "text";
      readonly format: "markdown" | "plain";
      /** A document's text, as the sidecar extracts it (never its markup). */
      readonly extracted: boolean;
    }
  | { readonly draws: "image" }
  | { readonly draws: "pdf" };

const MARKDOWN: ReadonlySet<string> = new Set(["md", "markdown"]);
const PLAIN: ReadonlySet<string> = new Set([
  "txt",
  "text",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
]);
/** Documents shown as their text: Office files, and web pages (never as markup). */
const EXTRACTED: ReadonlySet<string> = new Set(["docx", "xlsx", "pptx", "html", "htm"]);

/** How a show draws a file by its name, or null when it can't (SVG, HEIC, code, audio, video...). */
export function showKind(name: string): ShowKind | null {
  const ext = extname(name).slice(1).toLowerCase();
  if (MARKDOWN.has(ext)) return { draws: "text", format: "markdown", extracted: false };
  if (PLAIN.has(ext)) return { draws: "text", format: "plain", extracted: false };
  if (EXTRACTED.has(ext)) return { draws: "text", format: "plain", extracted: true };
  if (SHOWN_IMAGES.has(ext)) return { draws: "image" };
  if (ext === "pdf") return { draws: "pdf" };
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The picture type a file's first bytes say it is, or null when it is none a show draws. */
export function imageType(head: Buffer): string | null {
  if (head.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  const ascii = head.subarray(0, IMAGE_SNIFF_BYTES).toString("latin1");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** `bytes` without a character cut off at its end: the last UTF-8 sequence whole, or gone. */
export function wholeUtf8(bytes: Buffer): Buffer {
  for (let back = 1; back <= Math.min(4, bytes.length); back++) {
    const b = bytes[bytes.length - back] ?? 0;
    if ((b & 0xc0) === 0x80) continue; // a continuation byte: keep looking for its lead
    const length = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return length > back ? bytes.subarray(0, bytes.length - back) : bytes;
  }
  return bytes;
}

/** The text a show draws: at most SHOW_TEXT_MAX bytes of `bytes`, cut between characters. */
export function shownText(bytes: Buffer, whole: number): Buffer {
  return whole > SHOW_TEXT_MAX ? wholeUtf8(bytes.subarray(0, SHOW_TEXT_MAX)) : bytes;
}

// ---------------------------------------------------------------- disk

/** A file a show resolved: its real path, strictly below the owner folder's real path. */
export interface ShowFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * The regular file at `segments` below `root`, or null. Each segment is
 * looked at with lstat, so a symlink anywhere below the owner's folder (a
 * folder or the file) is not followed, and the result must be its own real path.
 */
export async function resolveShowFile(
  root: string,
  segments: readonly string[],
): Promise<ShowFile | null> {
  let at: string;
  try {
    at = await realpath(root);
  } catch {
    return null;
  }
  let size = 0;
  let mtimeMs = 0;
  for (const [i, segment] of segments.entries()) {
    at = join(at, segment);
    let st;
    try {
      st = await lstat(at);
    } catch {
      return null;
    }
    const last = i === segments.length - 1;
    // lstat: a symlink is neither a folder nor a file.
    if (last ? !st.isFile() : !st.isDirectory()) return null;
    size = st.size;
    mtimeMs = st.mtimeMs;
  }
  const name = segments[segments.length - 1];
  if (name === undefined) return null;
  try {
    if ((await realpath(at)) !== at) return null;
  } catch {
    return null;
  }
  return { path: at, name, size, mtimeMs };
}

/**
 * The first `max` bytes of a resolved file, or null when it is no longer the
 * file that was resolved: opened without following a symlink, and still the
 * same size and mtime.
 */
export async function readHead(file: ShowFile, max: number): Promise<Buffer | null> {
  let fh;
  try {
    // O_NOFOLLOW and O_NONBLOCK are undefined, so 0, on Windows (as in send-file.ts).
    fh = await open(
      file.path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch {
    return null;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size !== file.size || st.mtimeMs !== file.mtimeMs) return null;
    const want = Math.min(file.size, max);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const { bytesRead } = await fh.read(buf, got, want - got, got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    return got === want ? buf : null;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- shows

/** A file to show, as the request named it: found and checked again on every request. */
export interface ShowFileTarget {
  readonly source: FilesSource;
  readonly id: string | null;
  readonly member: string | null;
  readonly path: string;
}

interface FileShowBase {
  readonly kind: "file";
  readonly target: ShowFileTarget;
  /** The file when it was shown: a file changed since then ends the show. */
  readonly size: number;
  readonly mtimeMs: number;
}

/** A file's show: drawn from the file itself. */
export type FileShow =
  | (FileShowBase & {
      readonly draws: "text";
      readonly format: "markdown" | "plain";
      readonly extracted: boolean;
      /** Only the first SHOW_TEXT_MAX bytes are drawn. */
      readonly cut: boolean;
    })
  | (FileShowBase & { readonly draws: "image"; readonly type: string })
  | (FileShowBase & { readonly draws: "pdf"; readonly doc: PdfDoc });

export type LinkOutcome =
  | { readonly state: "capturing" }
  | { readonly state: "ready"; readonly shot: UrlShot }
  | { readonly state: "failed"; readonly failure: CaptureFailure };

/** A link's show: captured in the background, then a picture of the page or its PDF. */
export interface LinkShow {
  readonly kind: "link";
  readonly host: string;
  readonly view: View;
  /** Set once, when the capture ends. */
  outcome: LinkOutcome;
  /** Stops the capture: a newer show replaced this one, or it expired. */
  readonly controller: AbortController;
}

export interface Show {
  /** `sh_` and 32 random hex digits. */
  readonly id: string;
  readonly deviceId: string;
  readonly expiresAt: number;
  /** The file's name, or the link's host. */
  readonly name: string;
  readonly what: FileShow | LinkShow;
}

export type ShowState = LinkOutcome["state"];

/** A show as a device sees it (`{ show }` from POST /kleio/voice/show and GET …/<id>). */
export interface ShowInfo {
  readonly id: string;
  readonly kind: "text" | "image" | "pdf" | "web";
  readonly name: string;
  readonly state: ShowState;
  /** text: Markdown or plain text. */
  readonly format?: "markdown" | "plain";
  /** text: only its first MB is drawn; web: the page goes on below the picture. */
  readonly cut?: boolean;
  /** pdf: the pages that can be shown, and how many it has. */
  readonly pages?: number;
  readonly totalPages?: number;
  /** A link's site. */
  readonly host?: string;
  /** web: a sign-in, account or paywall page: what a visitor without your accounts sees. */
  readonly signIn?: boolean;
  /** web: the picture's size in pixels. */
  readonly width?: number;
  readonly height?: number;
  /** The page's or PDF's own title. */
  readonly title?: string;
  /** failed: why (a capture failure's kind), in plain words, and the site's answer. */
  readonly reason?: CaptureFailure["kind"];
  readonly detail?: string;
  readonly status?: number;
}

export function showInfo(show: Show): ShowInfo {
  const what = show.what;
  const base = { id: show.id, name: show.name };
  if (what.kind === "file") {
    switch (what.draws) {
      case "text":
        return {
          ...base,
          kind: "text",
          state: "ready",
          format: what.format,
          ...(what.cut ? { cut: true } : {}),
        };
      case "image":
        return { ...base, kind: "image", state: "ready" };
      case "pdf":
        return {
          ...base,
          kind: "pdf",
          state: "ready",
          pages: what.doc.pages,
          totalPages: what.doc.totalPages,
          ...(what.doc.title ? { title: what.doc.title } : {}),
        };
    }
  }
  const o = what.outcome;
  const link = { ...base, host: what.host };
  if (o.state === "capturing") return { ...link, kind: "web", state: "capturing" };
  if (o.state === "failed") {
    const f = o.failure;
    return {
      ...link,
      kind: "web",
      state: "failed",
      reason: f.kind,
      detail: failureText(f),
      ...(f.kind === "http_status" ? { status: f.status } : {}),
    };
  }
  const shot = o.shot;
  if (shot.kind === "pdf") {
    return {
      ...link,
      kind: "pdf",
      state: "ready",
      pages: shot.doc.pages,
      totalPages: shot.doc.totalPages,
      ...(shot.doc.title ? { title: shot.doc.title } : {}),
    };
  }
  return {
    ...link,
    kind: "web",
    state: "ready",
    width: shot.png.width,
    height: shot.png.height,
    cut: shot.cut,
    signIn: shot.signIn,
    ...(shot.title ? { title: shot.title } : {}),
  };
}

export interface Shows {
  /**
   * A new show for `deviceId`. A show replaces what was showing, so the
   * device's captures still running stop.
   */
  add(deviceId: string, name: string, what: FileShow | LinkShow): Show;
  /** The device's own show, unexpired; null for any other id, another device's included. */
  get(id: string, deviceId: string): Show | null;
  /** Ends every show, and stops every capture still running (the host is stopping). */
  stop(): void;
}

export function createShows(now: () => number): Shows {
  const shows = new Map<string, Show>();
  const end = (show: Show): void => {
    if (show.what.kind === "link") show.what.controller.abort();
  };
  const drop = (show: Show): void => {
    shows.delete(show.id);
    end(show);
  };
  const sweep = (): void => {
    const t = now();
    for (const show of [...shows.values()]) if (show.expiresAt <= t) drop(show);
  };
  return {
    add(deviceId, name, what) {
      sweep();
      const mine = [...shows.values()].filter((s) => s.deviceId === deviceId);
      for (const s of mine) end(s);
      for (const s of mine.slice(0, Math.max(0, mine.length - SHOWS_PER_DEVICE + 1))) drop(s);
      for (const s of [...shows.values()].slice(0, Math.max(0, shows.size - SHOWS_MAX + 1)))
        drop(s);
      const show: Show = {
        id: `sh_${randomBytes(16).toString("hex")}`,
        deviceId,
        expiresAt: now() + SHOW_TTL_MS,
        name,
        what,
      };
      shows.set(show.id, show);
      return show;
    },
    get(id, deviceId) {
      sweep();
      const show = shows.get(id);
      return show?.deviceId === deviceId ? show : null;
    },
    stop() {
      for (const show of [...shows.values()]) drop(show);
    },
  };
}
