import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { SESSION_FILES_MAX, sessionFilesFromMessages } from "./session-files.js";

// Resolved, so they carry a drive letter on Windows: a bare "/x" file URL
// isn't absolute there, and "/tmp" means Git Bash's temp folder.
const cwd = path.resolve("/work/proj");
const shot = path.resolve("/shots/shot.png");
const chart = path.resolve("/abs/chart.png");
const say = (text: string): { role: string; content: unknown } => ({
  role: "assistant",
  content: [{ type: "text", text }],
});
const call = (name: string, args: object): { role: string; content: unknown } => ({
  role: "assistant",
  content: [{ type: "tool_call", id: "t", name, args }],
});

describe("sessionFilesFromMessages", () => {
  it("collects tool-call outputs and linked documents, newest first", () => {
    const files = sessionFilesFromMessages(
      [
        call("write", { file_path: "notes/plan.md", content: "x" }),
        call("generate_image", { prompt: "cat" }), // no out_path: skipped
        call("generate_image", { prompt: "cat", out_path: "~/Pictures/cat.png" }),
        call("screenshot", { out_path: shot }),
        call("read", { file_path: "src/App.tsx" }),
        { role: "user", content: "see [mine](mine.pdf)" },
        say(
          [
            'Report: [report](out/Report%20Final.pdf), [spaced](<out/My Deck.pptx> "Deck")',
            `![chart](${pathToFileURL(chart).href}?x=1#y) [web](https://x.com/a.pdf) [mail](mailto:a@b.md)`,
            "[data](data:text/plain,a.txt) [code](src/App.tsx) [sheet](./data.xlsx#Sheet1)",
          ].join("\n"),
        ),
      ],
      cwd,
    );
    expect(files).toEqual([
      path.resolve(cwd, "data.xlsx"),
      chart,
      path.resolve(cwd, "out/My Deck.pptx"),
      path.resolve(cwd, "out/Report Final.pdf"),
      shot,
      path.join(os.homedir(), "Pictures/cat.png"),
      path.resolve(cwd, "notes/plan.md"),
    ]);
  });

  it("dedupes to the newest mention and caps at 100", () => {
    const many = Array.from({ length: 150 }, (_, i) => say(`[f](f${i}.txt)`));
    const files = sessionFilesFromMessages(
      [say("[a](a.md)"), ...many, call("write", { file_path: path.join(cwd, "a.md") })],
      cwd,
    );
    expect(files).toHaveLength(SESSION_FILES_MAX);
    expect(files[0]).toBe(path.resolve(cwd, "a.md"));
    expect(files[1]).toBe(path.resolve(cwd, "f149.txt"));
    expect(files.filter((f) => f.endsWith("a.md"))).toHaveLength(1);
  });

  it("scans a flood of unclosed brackets in linear time", () => {
    // After the last link, so no "]" ever closes them: quadratic for an
    // unbounded label run, which rescans to the end from every "[".
    const flood = "[".repeat(200_000);
    const started = performance.now();
    const files = sessionFilesFromMessages([say(`See [the report](report.pdf) ${flood}`)], cwd);
    expect(files).toEqual([path.resolve(cwd, "report.pdf")]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
