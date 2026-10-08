/**
 * Plain text from Office Open XML files (docx, pptx, xlsx) with a minimal,
 * bounded ZIP reader on node:zlib. Contents are untrusted: every size is
 * checked before use, and anything unusual (ZIP64, encryption, unknown
 * compression, bad offsets, oversize inflation) fails closed as "unreadable".
 */
import path from "node:path";
import { inflateRawSync } from "node:zlib";

export const ZIP_MAX_ENTRIES = 5_000;
export const ZIP_MAX_ENTRY_BYTES = 50 * 1024 * 1024;
export const ZIP_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const XLSX_MAX_ROWS = 2_000;

export type OfficeKind = "docx" | "pptx" | "xlsx";

export type OfficeTextResult = { ok: true; text: string } | { ok: false; error: "unreadable" };

class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** A read-only view of a ZIP archive with a shared inflation budget. */
export class ZipReader {
  private readonly entries = new Map<string, ZipEntry>();
  private inflated = 0;

  constructor(private readonly buf: Buffer) {
    this.parse();
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  private u16(at: number): number {
    if (at < 0 || at + 2 > this.buf.length) throw new ZipError("out of bounds");
    return this.buf.readUInt16LE(at);
  }

  private u32(at: number): number {
    if (at < 0 || at + 4 > this.buf.length) throw new ZipError("out of bounds");
    return this.buf.readUInt32LE(at);
  }

  private parse(): void {
    const buf = this.buf;
    if (buf.length < 22) throw new ZipError("too small");
    let eocd = -1;
    const lowest = Math.max(0, buf.length - 22 - 0xffff);
    for (let i = buf.length - 22; i >= lowest; i--) {
      if (buf.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError("no end of central directory");
    if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) {
      throw new ZipError("zip64");
    }
    const disk = this.u16(eocd + 4);
    const cdDisk = this.u16(eocd + 6);
    const diskEntries = this.u16(eocd + 8);
    const count = this.u16(eocd + 10);
    const cdSize = this.u32(eocd + 12);
    const cdOffset = this.u32(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new ZipError("zip64");
    }
    if (disk !== 0 || cdDisk !== 0 || diskEntries !== count) throw new ZipError("multi-disk");
    if (count > ZIP_MAX_ENTRIES) throw new ZipError("too many entries");
    if (cdOffset + cdSize > eocd) throw new ZipError("bad central directory");

    let at = cdOffset;
    for (let i = 0; i < count; i++) {
      if (this.u32(at) !== CENTRAL_SIG) throw new ZipError("bad central entry");
      const flags = this.u16(at + 8);
      const method = this.u16(at + 10);
      const compressedSize = this.u32(at + 20);
      const size = this.u32(at + 24);
      const nameLen = this.u16(at + 28);
      const extraLen = this.u16(at + 30);
      const commentLen = this.u16(at + 32);
      const localOffset = this.u32(at + 42);
      const end = at + 46 + nameLen + extraLen + commentLen;
      if (end > cdOffset + cdSize) throw new ZipError("bad central entry");
      if (flags & 0x1) throw new ZipError("encrypted");
      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
        throw new ZipError("zip64");
      }
      if (method !== 0 && method !== 8) throw new ZipError("unsupported method");
      if (size > ZIP_MAX_ENTRY_BYTES) throw new ZipError("entry too large");
      const name = buf.toString("utf-8", at + 46, at + 46 + nameLen);
      if (!this.entries.has(name))
        this.entries.set(name, { method, compressedSize, size, localOffset });
      at = end;
    }
  }

  /** An entry's bytes, or null when absent. Throws ZipError on anything malformed. */
  read(name: string): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const at = entry.localOffset;
    if (this.u32(at) !== LOCAL_SIG) throw new ZipError("bad local header");
    if (this.u16(at + 6) & 0x1) throw new ZipError("encrypted");
    const start = at + 30 + this.u16(at + 26) + this.u16(at + 28);
    const end = start + entry.compressedSize;
    if (end > this.buf.length) throw new ZipError("entry out of bounds");
    const raw = this.buf.subarray(start, end);
    const budget = Math.min(ZIP_MAX_ENTRY_BYTES, ZIP_MAX_TOTAL_BYTES - this.inflated);
    if (budget <= 0 || entry.size > budget) throw new ZipError("inflation limit");
    let data: Buffer;
    if (entry.method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: budget });
      } catch {
        throw new ZipError("inflate failed");
      }
    }
    if (data.length !== entry.size) throw new ZipError("size mismatch");
    this.inflated += data.length;
    return data;
  }

  readText(name: string): string | null {
    const data = this.read(name);
    return data === null ? null : data.toString("utf-8");
  }
}

/** Decode the five XML entities and numeric references. */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (whole, ref: string) => {
    switch (ref.toLowerCase()) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const code =
      ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isFinite(code) &&
      code >= 0 &&
      code <= 0x10ffff &&
      !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : whole;
  });
}

type XmlToken = { readonly tag: string } | { readonly text: string };

/**
 * The tags (the text between "<" and ">") and the runs of text between them,
 * in order, in one forward pass: each character is looked at most twice, so a
 * malformed part can't make it slow (backtracking tag regexes are quadratic
 * on, say, "<" repeated with no ">"). A "<" with no ">" after it ends the scan.
 */
function* xmlTokens(xml: string): Generator<XmlToken> {
  let at = 0;
  while (at < xml.length) {
    const open = xml.indexOf("<", at);
    if (open === -1) {
      yield { text: xml.slice(at) };
      return;
    }
    if (open > at) yield { text: xml.slice(at, open) };
    const close = xml.indexOf(">", open + 1);
    if (close === -1) return;
    yield { tag: xml.slice(open + 1, close) };
    at = close + 1;
  }
}

/** A tag's name: "w:p" for <w:p a="1">, "/w:p" for </w:p>, "w:tab" for <w:tab/>. */
function tagName(tag: string): string {
  let end = tag.charCodeAt(0) === 0x2f ? 1 : 0;
  while (end < tag.length) {
    const c = tag.charCodeAt(end);
    if (c <= 0x20 || c === 0x2f) break;
    end++;
  }
  return tag.slice(0, end);
}

/** A name without its namespace prefix: "x:row" is "row", "/x:row" is "/row". */
function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  if (colon === -1) return name;
  return (name.startsWith("/") ? "/" : "") + name.slice(colon + 1);
}

function selfClosing(tag: string): boolean {
  return tag.endsWith("/");
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, "\\$&")}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  const m = re.exec(tag);
  return m ? decodeXmlEntities(m[2] ?? m[3] ?? "") : null;
}

/**
 * A Word document's words: the text runs (<w:t>), a tab for <w:tab/> (but
 * not the tab stops a paragraph defines in <w:tabs>), a newline for each
 * break and each paragraph's end.
 */
function docxText(zip: ZipReader): string {
  const xml = zip.readText("word/document.xml");
  if (xml === null) throw new ZipError("missing word/document.xml");
  let out = "";
  let inText = false;
  let inTabStops = false;
  for (const token of xmlTokens(xml)) {
    if ("text" in token) {
      if (inText) out += decodeXmlEntities(token.text);
      continue;
    }
    const name = tagName(token.tag);
    if (name === "w:t") inText = !selfClosing(token.tag);
    else if (name === "/w:t") inText = false;
    else if (name === "w:tabs") inTabStops = !selfClosing(token.tag);
    else if (name === "/w:tabs") inTabStops = false;
    else if (name === "w:tab" && !inTabStops) out += "\t";
    else if (name === "w:br" || name === "w:cr" || name === "/w:p") out += "\n";
  }
  return out;
}

function numbered(names: string[], re: RegExp): string[] {
  return names
    .map((name) => ({ name, m: re.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => x.name);
}

function pptxText(zip: ZipReader): string {
  const slides = numbered(zip.names(), /^ppt\/slides\/slide(\d+)\.xml$/);
  if (slides.length === 0) throw new ZipError("no slides");
  const out: string[] = [];
  for (const name of slides) {
    const n = /(\d+)\.xml$/.exec(name)?.[1] ?? "";
    const xml = zip.readText(name) ?? "";
    let text = "";
    let inText = false;
    for (const token of xmlTokens(xml)) {
      if ("text" in token) {
        if (inText) text += decodeXmlEntities(token.text);
        continue;
      }
      const tag = tagName(token.tag);
      if (tag === "a:t") inText = !selfClosing(token.tag);
      else if (tag === "/a:t") inText = false;
      else if (tag === "a:br" || tag === "/a:p") text += "\n";
    }
    out.push(`Slide ${n}\n${text.trim()}`);
  }
  return out.join("\n\n");
}

function sheetTargets(zip: ZipReader): { name: string; path: string }[] {
  const workbook = zip.readText("xl/workbook.xml");
  const rels = zip.readText("xl/_rels/workbook.xml.rels");
  const fromWorkbook: { name: string; path: string }[] = [];
  if (workbook !== null && rels !== null) {
    const targets = new Map<string, string>();
    for (const token of xmlTokens(rels)) {
      if (!("tag" in token) || localName(tagName(token.tag)) !== "Relationship") continue;
      const id = attr(token.tag, "Id");
      const target = attr(token.tag, "Target");
      if (id && target) targets.set(id, target);
    }
    for (const token of xmlTokens(workbook)) {
      if (!("tag" in token) || localName(tagName(token.tag)) !== "sheet") continue;
      const name = attr(token.tag, "name");
      const target = targets.get(attr(token.tag, "r:id") ?? "");
      if (name === null || !target) continue;
      const resolved = target.startsWith("/")
        ? path.posix.normalize(target.slice(1))
        : path.posix.normalize(`xl/${target}`);
      if (zip.has(resolved)) fromWorkbook.push({ name, path: resolved });
    }
  }
  if (fromWorkbook.length > 0) return fromWorkbook;
  return numbered(zip.names(), /^xl\/worksheets\/sheet(\d+)\.xml$/).map((p) => ({
    name: `Sheet${/sheet(\d+)\.xml$/.exec(p)?.[1] ?? ""}`,
    path: p,
  }));
}

/** The shared strings: each <si>'s <t> runs, without phonetic guides (<rPh>). */
function sharedStrings(xml: string): string[] {
  const shared: string[] = [];
  let current: string | null = null;
  let inText = false;
  let inPhonetic = false;
  for (const token of xmlTokens(xml)) {
    if ("text" in token) {
      if (current !== null && inText && !inPhonetic) current += decodeXmlEntities(token.text);
      continue;
    }
    const name = localName(tagName(token.tag));
    if (name === "si") {
      if (selfClosing(token.tag)) shared.push("");
      else current = "";
    } else if (name === "/si") {
      if (current !== null) shared.push(current);
      current = null;
    } else if (name === "t") inText = !selfClosing(token.tag);
    else if (name === "/t") inText = false;
    else if (name === "rPh") inPhonetic = !selfClosing(token.tag);
    else if (name === "/rPh") inPhonetic = false;
  }
  return shared;
}

interface Cell {
  readonly type: string | null;
  value: string | null;
  inline: string;
}

function cellText(cell: Cell, shared: readonly string[]): string {
  if (cell.type === "s") {
    const idx = Number(cell.value);
    return cell.value !== null && Number.isInteger(idx) && idx >= 0 ? (shared[idx] ?? "") : "";
  }
  if (cell.type === "inlineStr") return cell.inline;
  return cell.value === null ? "" : decodeXmlEntities(cell.value);
}

/** A sheet's rows, cells tab-separated, at most XLSX_MAX_ROWS of them. */
function sheetRows(xml: string, shared: readonly string[]): string[] {
  const rows: string[] = [];
  let cells: string[] | null = null;
  let cell: Cell | null = null;
  let inValue = false;
  let inInline = false;
  let inText = false;
  for (const token of xmlTokens(xml)) {
    if (rows.length >= XLSX_MAX_ROWS) break;
    if ("text" in token) {
      if (cell !== null && inValue) cell.value = (cell.value ?? "") + token.text;
      else if (cell !== null && inInline && inText) cell.inline += decodeXmlEntities(token.text);
      continue;
    }
    const tag = token.tag;
    switch (localName(tagName(tag))) {
      case "row":
        if (selfClosing(tag)) rows.push("");
        else cells = [];
        break;
      case "/row":
        if (cells !== null) rows.push(cells.join("\t").replace(/[\r\n]+/g, " "));
        cells = null;
        break;
      case "c":
        if (cells === null) break;
        if (selfClosing(tag)) cells.push("");
        else cell = { type: attr(tag, "t"), value: null, inline: "" };
        break;
      case "/c":
        if (cells !== null && cell !== null) cells.push(cellText(cell, shared));
        cell = null;
        break;
      case "v":
        inValue = !selfClosing(tag);
        break;
      case "/v":
        inValue = false;
        break;
      case "is":
        inInline = !selfClosing(tag);
        break;
      case "/is":
        inInline = false;
        break;
      case "t":
        inText = !selfClosing(tag);
        break;
      case "/t":
        inText = false;
        break;
    }
  }
  return rows;
}

function xlsxText(zip: ZipReader): string {
  const sharedXml = zip.readText("xl/sharedStrings.xml");
  const shared = sharedXml === null ? [] : sharedStrings(sharedXml);
  const sheets = sheetTargets(zip);
  if (sheets.length === 0) throw new ZipError("no sheets");
  const out: string[] = [];
  for (const sheet of sheets) {
    const rows = sheetRows(zip.readText(sheet.path) ?? "", shared);
    out.push([`Sheet: ${sheet.name}`, ...rows].join("\n"));
  }
  return out.join("\n\n");
}

/** Text of a docx/pptx/xlsx file's bytes; any malformation is "unreadable". */
export function extractOfficeText(bytes: Buffer, kind: OfficeKind): OfficeTextResult {
  try {
    const zip = new ZipReader(bytes);
    const text = kind === "docx" ? docxText(zip) : kind === "pptx" ? pptxText(zip) : xlsxText(zip);
    return { ok: true, text };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}
