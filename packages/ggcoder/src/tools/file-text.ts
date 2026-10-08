/**
 * Readable text of a file's bytes, for Kleio's voice (POST /file-text). A pure
 * transform: it never touches the filesystem. The extension (from the name)
 * picks the parser; anything else is refused. Output is redacted with the same
 * secret view the agents get.
 */
import { environmentSecrets, redactText } from "@kleio/ai";

import { extractOfficeText } from "./office-text.js";
import { extractPdfTextPages } from "./pdf-extract.js";
import { htmlToCleanText } from "./web-fetch.js";

export const FILE_TEXT_MAX_BODY_BYTES = 20 * 1024 * 1024;
export const FILE_TEXT_MAX_CHARS = 400_000;
export const FILE_TEXT_MAX_PDF_PAGES = 200;
/**
 * HTML read, as for a fetched page (web_fetch's 5 MB): htmlToCleanText's
 * markup regexes slow down on deliberately malformed markup, so a file gets
 * no more room than a web page does.
 */
export const FILE_TEXT_MAX_HTML_BYTES = 5 * 1024 * 1024;

const PLAIN = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
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
]);

export type FileTextResult =
  | { ok: true; text: string; pages?: number }
  | { ok: false; error: "unsupported" | "unreadable" | "bad_request" };

/** Lowercase extension of a bare file name, or null when the name is unusable. */
export function fileTextExtension(name: string | null): string | null {
  if (!name || name.length > 1024 || name.includes("\0")) return null;
  const base = name.split(/[\\/]/).pop() ?? "";
  if (!base) return null;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** UTF-8 text, BOM stripped; null when a NUL byte marks it as binary. */
function utf8(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  const text = bytes.toString("utf-8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function finish(text: string): string {
  const collapsed = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n\n");
  const capped =
    collapsed.length > FILE_TEXT_MAX_CHARS ? collapsed.slice(0, FILE_TEXT_MAX_CHARS) : collapsed;
  return redactText(capped, { secrets: environmentSecrets(process.env) });
}

/** Extract, normalize, cap and redact a file's text. Never throws. */
export async function fileText(name: string | null, bytes: Buffer): Promise<FileTextResult> {
  const ext = fileTextExtension(name);
  if (ext === null) return { ok: false, error: "bad_request" };
  try {
    if (PLAIN.has(ext)) {
      const text = utf8(bytes);
      return text === null ? { ok: false, error: "unreadable" } : { ok: true, text: finish(text) };
    }
    if (ext === "html" || ext === "htm") {
      const html = utf8(bytes.subarray(0, FILE_TEXT_MAX_HTML_BYTES));
      return html === null
        ? { ok: false, error: "unreadable" }
        : { ok: true, text: finish(htmlToCleanText(html)) };
    }
    if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
      const out = extractOfficeText(bytes, ext);
      return out.ok ? { ok: true, text: finish(out.text) } : out;
    }
    if (ext === "pdf") {
      const { text, pages } = await extractPdfTextPages(
        new Uint8Array(bytes),
        FILE_TEXT_MAX_PDF_PAGES,
      );
      return { ok: true, text: finish(text), pages };
    }
    return { ok: false, error: "unsupported" };
  } catch {
    // Damaged/encrypted PDF, unpdf missing, or any parser surprise: fail closed.
    return { ok: false, error: "unreadable" };
  }
}
