// Files an agent writes in its folder on the Mac mini and links in chat by
// relative name ("[Your report](Morning-AI-Research-2026-10-01.pdf)"). The
// webview only ever names a file by its owner plus that relative path; the
// Rust side validates both, downloads through the device-authenticated
// client and previews / opens / saves its own cached copy (kleio/files.rs).

import { invoke } from "@tauri-apps/api/core";
import { errorText } from "./kleioApi";

export type FileOwner =
  { kind: "blob"; blobId: string } | { kind: "group"; groupId: string; blobId: string };

export interface FileInfo {
  name: string;
  size: number;
  mime: string;
  /** A PNG data URL of the first page (Quick Look), or null. */
  thumbnail: string | null;
}

export const fetchFile = (owner: FileOwner, path: string): Promise<FileInfo> =>
  invoke<FileInfo>("kleio_file_fetch", { owner, path });

export const openFile = (owner: FileOwner, path: string): Promise<void> =>
  invoke<void>("kleio_file_open", { owner, path });

/** True when saved, false when the save dialog was cancelled. */
export const saveFile = (owner: FileOwner, path: string): Promise<boolean> =>
  invoke<boolean>("kleio_file_save", { owner, path });

export function fileOwner(blobId: string, groupId?: string): FileOwner {
  return groupId ? { kind: "group", groupId, blobId } : { kind: "blob", blobId };
}

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
  const raw = h.split("/");
  if (raw.length > MAX_SEGMENTS) return null;
  const segments: string[] = [];
  for (const r of raw) {
    let s: string;
    try {
      s = decodeURIComponent(r);
    } catch {
      return null;
    }
    if (!plainSegment(s)) return null;
    segments.push(s);
  }
  const last = segments[segments.length - 1] ?? "";
  if (!/\.[a-z0-9]{1,8}$/i.test(last)) return null;
  return segments.join("/");
}

/** Markdown links: `[label](href)` or `[label](<href with spaces>)`, optional title. */
const LINK = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+["'][^"'\n]*["'])?\s*\)/g;

export interface FileLink {
  path: string;
  /** The link text, without inline markup. */
  label: string;
}

/** The agent-folder files a message links to, in order, each once. Images
 *  (`![…](…)`) are left to the message itself. */
export function fileLinks(markdown: string): FileLink[] {
  const out: FileLink[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(LINK)) {
    if (m[1]) continue;
    let href = m[3] ?? "";
    if (href.startsWith("<")) href = href.slice(1, -1);
    const path = agentFilePath(href);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ path, label: (m[2] ?? "").replace(/[*_`]/g, "").trim() });
  }
  return out;
}

const KINDS: Record<string, string> = {
  pdf: "PDF document",
  docx: "Word document",
  doc: "Word document",
  xlsx: "Spreadsheet",
  xls: "Spreadsheet",
  csv: "Spreadsheet (CSV)",
  pptx: "Presentation",
  md: "Text document",
  txt: "Text document",
  json: "Data file",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  gif: "Image",
  webp: "Image",
  heic: "Image",
  mp3: "Audio",
  m4a: "Audio",
  wav: "Audio",
  mp4: "Video",
  mov: "Video",
};

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m?.[1]?.toLowerCase() ?? "";
}

export function fileKind(name: string): string {
  return KINDS[fileExtension(name)] ?? "File";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The Rust/host error as something to show under a file. */
export function fileErrorText(e: unknown): string {
  const raw = errorText(e);
  if (/^no such file/i.test(raw)) return "This file isn't on your Mac mini any more.";
  if (/^no such agent/i.test(raw)) return "That specialist no longer exists.";
  if (/^no such group/i.test(raw)) return "That group no longer exists.";
  if (/^file too large/i.test(raw) || /larger than/i.test(raw))
    return "This file is too big to open from Kleio (over 50 MB).";
  if (/bad path/i.test(raw)) return "Kleio only opens files from its own folders.";
  if (/^not found$/i.test(raw)) return "Your Mac mini needs an update to share files.";
  return raw;
}
