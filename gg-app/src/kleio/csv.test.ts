import { describe, expect, it } from "vitest";
import {
  CSV_CELL_MAX,
  CSV_TABLE_MAX_BYTES,
  CSV_TABLE_MAX_COLUMNS,
  CSV_TABLE_MAX_ROWS,
  parseCsv,
} from "./csv";

/** The grid, or the test fails with why it isn't one. */
function grid(text: string): { header: readonly string[]; rows: readonly (readonly string[])[] } {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(`not a table: ${r.error}`);
  return r.value;
}

describe("parseCsv", () => {
  it("takes the first row as the header", () => {
    expect(grid("name,score\nAda,3\nCy,5")).toEqual({
      header: ["name", "score"],
      rows: [
        ["Ada", "3"],
        ["Cy", "5"],
      ],
    });
  });

  it("ends lines at CRLF, LF or a lone CR, and skips blank lines and a final line break", () => {
    const want = { header: ["a", "b"], rows: [["1", "2"]] };
    expect(grid("a,b\r\n1,2\r\n")).toEqual(want);
    expect(grid("a,b\n\n1,2\n")).toEqual(want);
    expect(grid("a,b\r1,2")).toEqual(want);
    expect(grid("\ufeffa,b\n1,2")).toEqual(want);
  });

  it("reads quoted fields: commas, doubled quotes and line breaks inside them", () => {
    expect(grid('item,note\n"Paris, FR","say ""hi"""\n"two\r\nlines",""')).toEqual({
      header: ["item", "note"],
      rows: [
        ["Paris, FR", 'say "hi"'],
        ["two\r\nlines", ""],
      ],
    });
    // A line holding only a quoted empty field is a row, not a blank line.
    expect(grid('a\n""\nb').rows).toEqual([[""], ["b"]]);
    // A stray quote inside a field is part of it.
    expect(grid('a,b\n5" disk,x"y').rows).toEqual([['5" disk', 'x"y']]);
  });

  it("keeps empty fields and pads short rows to the widest", () => {
    expect(grid("a,,c,\n1\n1,2,3,4,5")).toEqual({
      header: ["a", "", "c", "", ""],
      rows: [
        ["1", "", "", "", ""],
        ["1", "2", "3", "4", "5"],
      ],
    });
  });

  it("keeps cells as their text, markup included", () => {
    expect(grid('a\n"<img src=x onerror=alert(1)>"').rows).toEqual([
      ["<img src=x onerror=alert(1)>"],
    ]);
  });

  it("is unreadable with an unclosed quote, or no rows", () => {
    expect(parseCsv('a,b\n"open,1')).toEqual({ ok: false, error: "unreadable" });
    expect(parseCsv('a,"b""')).toEqual({ ok: false, error: "unreadable" });
    expect(parseCsv("\n\r\n")).toEqual({ ok: false, error: "unreadable" });
  });

  it("is a table up to 1,000 rows below the header, too big past it", () => {
    const rows = (n: number): string =>
      ["n", ...Array.from({ length: n }, (_, i) => String(i))].join("\n");
    expect(grid(rows(CSV_TABLE_MAX_ROWS)).rows).toHaveLength(CSV_TABLE_MAX_ROWS);
    expect(parseCsv(rows(CSV_TABLE_MAX_ROWS + 1))).toEqual({ ok: false, error: "too_big" });
  });

  it("is a table up to 50 columns, too big past it", () => {
    const cols = (n: number): string => Array.from({ length: n }, (_, i) => `c${i}`).join(",");
    expect(grid(cols(CSV_TABLE_MAX_COLUMNS)).header).toHaveLength(CSV_TABLE_MAX_COLUMNS);
    expect(parseCsv(cols(CSV_TABLE_MAX_COLUMNS + 1))).toEqual({ ok: false, error: "too_big" });
    // In any row, not only the header.
    expect(parseCsv(`a\n${cols(CSV_TABLE_MAX_COLUMNS + 1)}`)).toEqual({
      ok: false,
      error: "too_big",
    });
  });

  it("is a table up to 256 KB of UTF-8, too big past it", () => {
    const fits = `a\n${"x".repeat(CSV_TABLE_MAX_BYTES - 2)}`;
    expect(parseCsv(fits).ok).toBe(true);
    expect(parseCsv(`${fits}x`)).toEqual({ ok: false, error: "too_big" });
    // "é" is 2 bytes: fewer characters than the cap, more bytes.
    const wide = `a\n${"é".repeat(CSV_TABLE_MAX_BYTES / 2)}`;
    expect(wide.length).toBeLessThan(CSV_TABLE_MAX_BYTES);
    expect(parseCsv(wide)).toEqual({ ok: false, error: "too_big" });
  });

  it("cuts a long cell at 500 characters, never through a surrogate pair", () => {
    const long = "y".repeat(CSV_CELL_MAX + 20);
    expect(grid(`a\n${long}`).rows[0]?.[0]).toBe(`${"y".repeat(CSV_CELL_MAX)}…`);
    expect(grid(`a\n${"y".repeat(CSV_CELL_MAX)}`).rows[0]?.[0]).toHaveLength(CSV_CELL_MAX);
    // An emoji (two UTF-16 units) across the cut is left out whole.
    const emoji = `${"y".repeat(CSV_CELL_MAX - 1)}😀tail`;
    expect(grid(`a\n${emoji}`).rows[0]?.[0]).toBe(`${"y".repeat(CSV_CELL_MAX - 1)}…`);
  });
});
