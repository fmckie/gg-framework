import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REDACTION_MARKER } from "@kleio/ai";
import { buildZip } from "../test-support/zip.js";
import {
  FILE_TEXT_MAX_CHARS,
  FILE_TEXT_MAX_HTML_BYTES,
  fileText,
  fileTextExtension,
} from "./file-text.js";

const unpdfInstalled = await import("unpdf").then(() => true).catch(() => false);
// Built from parts so the fixture reads the same in any redacted transcript.
const SECRET = ["zq81kd03", "pw77xx42"].join("");

describe("fileText", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.FILE_TEXT_TEST_API_KEY;
    process.env.FILE_TEXT_TEST_API_KEY = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.FILE_TEXT_TEST_API_KEY;
    else process.env.FILE_TEXT_TEST_API_KEY = saved;
  });

  it("reads plain text as UTF-8, strips a BOM and collapses blank runs", async () => {
    const out = await fileText("Notes.MD", Buffer.from("\uFEFF# Hi\n\n\n\n\nthere\r\n", "utf-8"));
    expect(out).toEqual({ ok: true, text: "# Hi\n\n\nthere\n" });
    expect(await fileText("a.py", Buffer.from("x = 1"))).toEqual({ ok: true, text: "x = 1" });
  });

  it("refuses text with NUL bytes as unreadable", async () => {
    expect(await fileText("a.txt", Buffer.from([0x61, 0x00, 0x62]))).toEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it("cleans HTML", async () => {
    const out = await fileText(
      "page.html",
      Buffer.from("<html><script>alert(1)</script><p>Hello</p><p>World</p></html>"),
    );
    expect(out.ok && out.text).toContain("Hello");
    expect(out.ok && out.text).not.toContain("alert");
  });

  it("reads no more HTML than a fetched web page gets", async () => {
    const filler = "<p>filler</p>".repeat(Math.ceil(FILE_TEXT_MAX_HTML_BYTES / 13));
    const out = await fileText(
      "big.html",
      Buffer.from(`<p>Start here</p>${filler}<p>Past the cap</p>`),
    );
    expect(out.ok && out.text).toContain("Start here");
    expect(out.ok && out.text).not.toContain("Past the cap");
  });

  it("reads office files and fails closed on bad ones", async () => {
    const docx = buildZip([{ name: "word/document.xml", data: "<w:p><w:t>Doc body</w:t></w:p>" }]);
    expect(await fileText("r.docx", docx)).toEqual({ ok: true, text: "Doc body\n" });
    expect(await fileText("r.xlsx", Buffer.from("junk"))).toEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it("refuses unsupported extensions and bad names", async () => {
    for (const name of ["a.exe", "a.doc", "Makefile", ".env", "a.xls"]) {
      expect(await fileText(name, Buffer.from("x"))).toEqual({ ok: false, error: "unsupported" });
    }
    for (const name of [null, "", "dir/", "a\0.txt"]) {
      expect(await fileText(name, Buffer.from("x"))).toEqual({ ok: false, error: "bad_request" });
    }
    expect(fileTextExtension("/x/y/Report.PDF")).toBe("pdf");
  });

  it("caps text at 400k characters", async () => {
    const out = await fileText("big.txt", Buffer.from("a".repeat(FILE_TEXT_MAX_CHARS + 50)));
    expect(out.ok && out.text.length).toBe(FILE_TEXT_MAX_CHARS);
  });

  it("redacts environment secrets", async () => {
    const out = await fileText("cfg.json", Buffer.from(`{"key":"${SECRET}"}`));
    expect(out.ok && out.text).not.toContain(SECRET);
    expect(out.ok && out.text).toContain(REDACTION_MARKER);
  });

  it("returns unreadable for a damaged PDF", async () => {
    expect(await fileText("x.pdf", Buffer.from("%PDF-1.4 garbage"))).toEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it.skipIf(!unpdfInstalled)("reads a PDF with its page count", async () => {
    const fixture = fileURLToPath(new URL("./__fixtures__/sample.pdf", import.meta.url));
    const out = await fileText("s.pdf", await readFile(fixture));
    expect(out).toMatchObject({ ok: true, pages: 1 });
    expect(out.ok && out.text).toContain("Hello PDF World");
  });
});
