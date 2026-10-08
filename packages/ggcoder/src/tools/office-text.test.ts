import { describe, expect, it } from "vitest";
import { buildZip } from "../test-support/zip.js";
import { extractOfficeText } from "./office-text.js";

describe("extractOfficeText", () => {
  it("reads docx paragraphs, tabs, breaks and entities", () => {
    const xml =
      '<?xml version="1.0"?><w:document><w:body>' +
      "<w:p><w:r><w:t>Hello</w:t><w:tab/><w:t>world &amp; more</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Line</w:t><w:br/><w:t>two &#x263A; &lt;b&gt;</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    const out = extractOfficeText(buildZip([{ name: "word/document.xml", data: xml }]), "docx");
    expect(out).toEqual({ ok: true, text: "Hello\tworld & more\nLine\ntwo ☺ <b>\n" });
  });

  it("reads pptx slides in numeric order", () => {
    const slide = (t: string): string =>
      `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p><a:p><a:r><a:t>more</a:t></a:r></a:p></p:sld>`;
    const zip = buildZip([
      { name: "ppt/slides/slide10.xml", data: slide("Ten") },
      { name: "ppt/slides/slide2.xml", data: slide("Two") },
      { name: "ppt/slides/slide1.xml", data: slide("One"), store: true },
    ]);
    const out = extractOfficeText(zip, "pptx");
    expect(out).toEqual({
      ok: true,
      text: "Slide 1\nOne\nmore\n\nSlide 2\nTwo\nmore\n\nSlide 10\nTen\nmore",
    });
  });

  it("reads xlsx sheets in workbook order with shared, inline and number cells", () => {
    const zip = buildZip([
      {
        name: "xl/workbook.xml",
        data: '<workbook><sheets><sheet name="Budget &amp; Plan" sheetId="1" r:id="rId2"/><sheet name="Other" sheetId="2" r:id="rId1"/></sheets></workbook>',
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      },
      {
        name: "xl/sharedStrings.xml",
        data: '<sst><si><t>Item</t></si><si><r><t>Co</t></r><r><t xml:space="preserve">st</t></r></si></sst>',
      },
      {
        name: "xl/worksheets/sheet2.xml",
        data:
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Rent</t></is></c><c r="B2"><v>1200.5</v></c></row></sheetData></worksheet>',
      },
      {
        name: "xl/worksheets/sheet1.xml",
        data: "<worksheet><sheetData><row><c><v>7</v></c></row></sheetData></worksheet>",
      },
    ]);
    expect(extractOfficeText(zip, "xlsx")).toEqual({
      ok: true,
      text: "Sheet: Budget & Plan\nItem\tCost\nRent\t1200.5\n\nSheet: Other\n7",
    });
  });

  it("caps xlsx rows per sheet", () => {
    const rows = Array.from({ length: 2_100 }, (_, i) => `<row><c><v>${i}</v></c></row>`).join("");
    const zip = buildZip([
      { name: "xl/worksheets/sheet1.xml", data: `<sheetData>${rows}</sheetData>` },
    ]);
    const out = extractOfficeText(zip, "xlsx");
    expect(out.ok && out.text.split("\n")).toHaveLength(2_001);
  });

  it("skips a paragraph's tab stops but keeps its tabs, and reads slide line breaks", () => {
    const doc =
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
      "<w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>";
    expect(extractOfficeText(buildZip([{ name: "word/document.xml", data: doc }]), "docx")).toEqual(
      { ok: true, text: "A\tB\n" },
    );
    const slide = "<a:p><a:r><a:t>One</a:t></a:r><a:br/><a:r><a:t>Two</a:t></a:r></a:p>";
    expect(
      extractOfficeText(buildZip([{ name: "ppt/slides/slide1.xml", data: slide }]), "pptx"),
    ).toEqual({ ok: true, text: "Slide 1\nOne\nTwo" });
  });

  it("reads prefixed spreadsheet XML, without phonetic guides", () => {
    const zip = buildZip([
      {
        name: "xl/sharedStrings.xml",
        data: '<x:sst><x:si><x:t>Kanji</x:t><x:rPh sb="0" eb="1"><x:t>kana</x:t></x:rPh></x:si></x:sst>',
      },
      {
        name: "xl/worksheets/sheet1.xml",
        data: '<x:worksheet><x:sheetData><x:row><x:c t="s"><x:v>0</x:v></x:c><x:c/><x:c><x:v>3</x:v></x:c></x:row></x:sheetData></x:worksheet>',
      },
    ]);
    expect(extractOfficeText(zip, "xlsx")).toEqual({
      ok: true,
      text: "Sheet: Sheet1\nKanji\t\t3",
    });
  });

  it("scans malformed markup in linear time", () => {
    // Unclosed tags: quadratic for a backtracking tag regex, one pass here.
    const flood = "<w:t ".repeat(200_000);
    const docx = buildZip([
      { name: "word/document.xml", data: `<w:p><w:t>Kept</w:t></w:p>${flood}` },
    ]);
    const rows = "<row><c><v>1</v></c>".repeat(100_000);
    const xlsx = buildZip([
      { name: "xl/sharedStrings.xml", data: "<si><t>x".repeat(100_000) },
      { name: "xl/worksheets/sheet1.xml", data: `<sheetData>${rows}` },
    ]);
    const started = performance.now();
    expect(extractOfficeText(docx, "docx")).toEqual({ ok: true, text: "Kept\n" });
    expect(extractOfficeText(xlsx, "xlsx")).toEqual({ ok: true, text: "Sheet: Sheet1" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("refuses a zip bomb, an encrypted entry, garbage, and a missing part", () => {
    const bomb = buildZip([
      { name: "word/document.xml", data: Buffer.alloc(60 * 1024 * 1024, 0x20) },
    ]);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(extractOfficeText(bomb, "docx")).toEqual({ ok: false, error: "unreadable" });
    // Lies about its size: inflation is still capped by the real limit.
    const liar = buildZip([
      { name: "word/document.xml", data: Buffer.alloc(60 * 1024 * 1024, 0x20), size: 10 },
    ]);
    expect(extractOfficeText(liar, "docx")).toEqual({ ok: false, error: "unreadable" });
    const encrypted = buildZip([{ name: "word/document.xml", data: "<w:p/>", flags: 1 }]);
    expect(extractOfficeText(encrypted, "docx")).toEqual({ ok: false, error: "unreadable" });
    expect(extractOfficeText(Buffer.from("not a zip at all, sorry"), "docx")).toEqual({
      ok: false,
      error: "unreadable",
    });
    expect(extractOfficeText(buildZip([{ name: "x.xml", data: "<a/>" }]), "docx")).toEqual({
      ok: false,
      error: "unreadable",
    });
    const truncated = buildZip([{ name: "word/document.xml", data: "<w:p>hi</w:p>" }]);
    expect(extractOfficeText(truncated.subarray(10), "docx")).toEqual({
      ok: false,
      error: "unreadable",
    });
  });
});
