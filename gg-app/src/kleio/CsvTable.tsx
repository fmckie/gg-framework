// A CSV in the file viewer (FileViewer.tsx): a table when it is small enough
// (csv.ts), else its text with a note saying why. Every cell is React text,
// so nothing in a cell is ever markup.

import { useMemo } from "react";
import { parseCsv } from "./csv";

const TOO_BIG = "Shown as text: it's too big for a table.";
const UNREADABLE = "Shown as text: Kleio couldn't read it as a table.";

export function CsvTable({
  text,
  name,
}: {
  readonly text: string;
  /** The file's name, for the table's label. */
  readonly name: string;
}): React.ReactElement {
  const parsed = useMemo(() => parseCsv(text), [text]);
  if (!parsed.ok)
    return (
      <>
        <p className="voice-show-note file-viewer-csv-note">
          {parsed.error === "too_big" ? TOO_BIG : UNREADABLE}
        </p>
        <pre className="voice-show-pre">{text}</pre>
      </>
    );
  const { header, rows } = parsed.value;
  return (
    // Focusable, so the keyboard can scroll a wide table sideways.
    <div
      className="file-viewer-table"
      role="region"
      aria-label={`${name}, as a table`}
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} scope="col">
                <div className="file-viewer-cell">{cell}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i}>
                  <div className="file-viewer-cell">{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
