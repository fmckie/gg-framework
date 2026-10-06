// Files an agent writes in its folder on the Mac mini and links in chat by
// relative name ("[Your report](Morning-AI-Research-2026-10-01.pdf)"). The
// webview only ever names a file by its owner plus that relative path; the
// Rust side validates both, downloads through the device-authenticated
// client and previews / opens / saves its own cached copy (kleio/files.rs).
// Web pages are never downloaded: `openSite` asks the host for a short-lived
// link on its sandboxed preview origin and opens that in the browser.

import { invoke } from "@tauri-apps/api/core";
import { errorText } from "./kleioApi";
import {
  agentFilePath,
  fileExtension,
  isOutputPath,
  specialistFilePath,
  workspaceFilePath,
} from "./filePaths";

/** A Specialist, a member of a group, or a Chat/Code session's folder on the
 *  host (keyed by its cwd, which survives restarts; session ids do not). */
export type FileOwner =
  | { kind: "blob"; blobId: string }
  | { kind: "group"; groupId: string; blobId: string }
  | { kind: "workspace"; cwd: string };

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

/** Opens an agent-written web page (`.html`/`.htm`) in the browser. */
export const openSite = (owner: FileOwner, path: string): Promise<void> =>
  invoke<void>("kleio_site_open", { owner, path });

export function fileOwner(blobId: string, groupId?: string): FileOwner {
  return groupId ? { kind: "group", groupId, blobId } : { kind: "blob", blobId };
}

/** A stable string per owner, for effect dependencies and React keys. */
export function ownerKey(owner: FileOwner): string {
  switch (owner.kind) {
    case "blob":
      return `blob:${owner.blobId}`;
    case "group":
      return `group:${owner.groupId}/${owner.blobId}`;
    case "workspace":
      return `workspace:${owner.cwd}`;
  }
}

/** Markdown links: `[label](href)` or `[label](<href with spaces>)`, optional title. */
const LINK = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+["'][^"'\n]*["'])?\s*\)/g;

export interface FileLink {
  path: string;
  /** The link text, without inline markup. */
  label: string;
}

/** The agent-folder files a message links to, in order, each once. Images
 *  (`![…](…)`) are left to the message itself. With the message's `owner`
 *  (a Specialist or group member), absolute links into that owner's own
 *  folder count too (see `specialistFilePath`). */
export function fileLinks(markdown: string, owner?: FileOwner): FileLink[] {
  return linksBy(markdown, (href) => ownerFilePath(href, owner));
}

/** The path inside `owner`'s folder a link points at, or null. */
export function ownerFilePath(href: string, owner?: FileOwner): string | null {
  if (!owner) return agentFilePath(href);
  switch (owner.kind) {
    case "blob":
      return specialistFilePath(href, { blobId: owner.blobId });
    case "group":
      return specialistFilePath(href, { blobId: owner.blobId, groupId: owner.groupId });
    case "workspace":
      return workspaceFilePath(href, owner.cwd);
  }
}

/** The outputs (see `isOutputPath`) a Chat/Code reply links to inside its
 *  session folder `cwd`, in order, each once. Source files the agent mentions
 *  (`src/App.tsx`) stay plain links. */
export function workspaceFileLinks(markdown: string, cwd: string): FileLink[] {
  return linksBy(markdown, (href) => {
    const path = workspaceFilePath(href, cwd);
    return path && isOutputPath(path) ? path : null;
  });
}

function linksBy(markdown: string, pathOf: (href: string) => string | null): FileLink[] {
  const out: FileLink[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(LINK)) {
    if (m[1]) continue;
    let href = m[3] ?? "";
    if (href.startsWith("<")) href = href.slice(1, -1);
    const path = pathOf(href);
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
  html: "Website",
  htm: "Website",
  mp3: "Audio",
  m4a: "Audio",
  wav: "Audio",
  mp4: "Video",
  mov: "Video",
};

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
  if (/^no such workspace/i.test(raw) || /bad folder/i.test(raw))
    return "Kleio only opens files from its project folders.";
  if (/^file too large/i.test(raw) || /larger than/i.test(raw))
    return "This file is too big to open from Kleio (over 50 MB).";
  if (/bad path/i.test(raw)) return "Kleio only opens files from its own folders.";
  if (/^not found$/i.test(raw)) return "Your Mac mini needs an update to share files.";
  if (/^bad_request$/i.test(raw))
    return "Your Mac mini didn't understand that request. Update Kleio on both devices.";
  return raw;
}

/** The Rust/host error from `openSite` as something to show under a page. */
export function siteErrorText(e: unknown): string {
  const raw = errorText(e);
  // An older host has no preview route ("not found"); a newer one without a
  // preview port answers "not_found".
  if (/^not[ _]found$/i.test(raw)) return "Your Mac mini needs an update to open sites.";
  if (/^not_a_site$/i.test(raw)) return "Only web pages open as a site.";
  return fileErrorText(e);
}
