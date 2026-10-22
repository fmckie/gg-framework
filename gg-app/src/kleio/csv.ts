// A CSV's text as a table, for the file viewer (CsvTable.tsx): RFC 4180's
// quoting (quoted fields, doubled quotes, line breaks inside quotes) over CRLF
// or LF lines. Only a small CSV becomes a table; anything bigger, or text that
// isn't CSV (an unclosed quote), is shown as text instead. Cells are strings:
// React draws them as text, never as markup.

/** The most a CSV may hold to be drawn as a table; past any of these it is shown as text. */
export const CSV_TABLE_MAX_BYTES = 256 * 1024;
/** Rows below the header. */
export const CSV_TABLE_MAX_ROWS = 1000;
export const CSV_TABLE_MAX_COLUMNS = 50;
/** A longer cell is cut, with "…" after it. */
export const CSV_CELL_MAX = 500;

export interface CsvGrid {
  /** The first row, padded to the widest row. */
  readonly header: readonly string[];
  /** The rows below it, each padded to the widest row. */
  readonly rows: readonly (readonly string[])[];
}

/** Why a CSV isn't a table: too big for one, or not CSV Kleio can read. */
export type CsvTrouble = "too_big" | "unreadable";

/** UTF-8 length; at least the string's length, so a long one is never encoded. */
function tooManyBytes(text: string): boolean {
  if (text.length > CSV_TABLE_MAX_BYTES) return true;
  return new TextEncoder().encode(text).length > CSV_TABLE_MAX_BYTES;
}

/** `cell` cut to CSV_CELL_MAX characters, never through a surrogate pair. */
function cut(cell: string): string {
  if (cell.length <= CSV_CELL_MAX) return cell;
  let end = CSV_CELL_MAX;
  const last = cell.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${cell.slice(0, end)}…`;
}

/**
 * The CSV's rows, the first as its header, or why it can't be a table. Blank
 * lines are skipped; a line ends at CRLF, LF or a lone CR outside quotes.
 * Stops as soon as a row or a column is past the caps.
 */
export function parseCsv(
  text: string,
): { ok: true; value: CsvGrid } | { ok: false; error: CsvTrouble } {
  if (tooManyBytes(text)) return { ok: false, error: "too_big" };
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  // The cell began with a quote (so an empty one is still a field).
  let quotedCell = false;
  let inQuotes = false;
  const endCell = (): boolean => {
    row.push(cell);
    cell = "";
    quotedCell = false;
    return row.length <= CSV_TABLE_MAX_COLUMNS;
  };
  const endRow = (): boolean => {
    // A blank line is no row.
    if (row.length === 0 && cell === "" && !quotedCell) return true;
    if (!endCell()) return false;
    rows.push(row);
    row = [];
    return rows.length <= CSV_TABLE_MAX_ROWS + 1;
  };
  // A byte order mark is not part of the first cell.
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else inQuotes = false;
      continue;
    }
    if (c === '"' && cell === "" && !quotedCell) {
      inQuotes = true;
      quotedCell = true;
    } else if (c === ",") {
      if (!endCell()) return { ok: false, error: "too_big" };
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (!endRow()) return { ok: false, error: "too_big" };
    } else {
      // Anything else, a stray quote inside a field included, is the cell's.
      cell += c;
    }
  }
  if (inQuotes) return { ok: false, error: "unreadable" };
  if (!endRow()) return { ok: false, error: "too_big" };
  const [first, ...rest] = rows;
  if (!first) return { ok: false, error: "unreadable" };
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: readonly string[]): string[] => [
    ...r.map(cut),
    ...Array.from({ length: width - r.length }, () => ""),
  ];
  return { ok: true, value: { header: pad(first), rows: rest.map(pad) } };
}
