import { describe, expect, it } from "vitest";
import { defaultLook, lookOf } from "./blobLook";
import { agentFilePath, fileErrorText, fileKind, fileLinks, formatBytes } from "./kleioFiles";
import { plainSummary, scheduledPrompt } from "./blobFormat";

describe("agentFilePath", () => {
  it.each([
    ["Morning-AI-Research-2026-10-01.pdf", "Morning-AI-Research-2026-10-01.pdf"],
    ["./reports/week 40.pdf", "reports/week 40.pdf"],
    ["reports/week%2040.pdf", "reports/week 40.pdf"],
    ["Résumé%20—%20final.docx", "Résumé — final.docx"],
    ["notes.md#top", "notes.md"],
  ])("accepts %s", (href, path) => {
    expect(agentFilePath(href)).toBe(path);
  });

  it.each([
    "https://example.com/report.pdf",
    "file:///Users/me/report.pdf",
    "mailto:me@example.com",
    "/etc/passwd.txt",
    "\\\\server\\share\\x.pdf",
    "../secrets.txt",
    "reports/../../x.pdf",
    ".venv/bin/activate.sh",
    "reports/.hidden.pdf",
    "%2e%2e/x.pdf",
    "a%2Fb.pdf",
    "a%5Cb.pdf",
    "bad%E0%A4%A.pdf",
    "reports",
    "#section",
    "",
  ])("rejects %s", (href) => {
    expect(agentFilePath(href)).toBeNull();
  });

  it("rejects paths deeper than the host allows", () => {
    expect(agentFilePath(`${"a/".repeat(16)}x.pdf`)).toBeNull();
    expect(agentFilePath(`${"a/".repeat(15)}x.pdf`)).not.toBeNull();
  });
});

describe("fileLinks", () => {
  it("finds the agent's files in a reply, once each, in order", () => {
    const md = [
      "**[Download your AI research report — 1 October 2026](Morning-AI-Research-2026-10-01.pdf)**",
      'See [the data](<data/raw table.csv> "CSV") and [a site](https://example.com).',
      "Again: [report](Morning-AI-Research-2026-10-01.pdf). ![chart](chart.png)",
    ].join("\n");
    expect(fileLinks(md)).toEqual([
      {
        path: "Morning-AI-Research-2026-10-01.pdf",
        label: "Download your AI research report — 1 October 2026",
      },
      { path: "data/raw table.csv", label: "the data" },
    ]);
  });
});

describe("file words", () => {
  it("names kinds and sizes plainly", () => {
    expect(fileKind("Report.PDF")).toBe("PDF document");
    expect(fileKind("thing.xyz")).toBe("File");
    expect(formatBytes(900)).toBe("900 bytes");
    expect(formatBytes(48_000)).toBe("47 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });

  it("explains the host's file errors", () => {
    expect(fileErrorText(new Error("no such file"))).toMatch(/isn't on your Mac mini/);
    expect(fileErrorText(new Error("file too large"))).toMatch(/too big/);
    expect(fileErrorText(new Error("not found"))).toMatch(/needs an update/);
  });
});

describe("agent looks", () => {
  it("derives the same default look as the host for agents without one", () => {
    // Pinned against kleio-host's defaultLook (blobs.test.ts).
    expect(defaultLook("b_0000aaaa")).toEqual({ shape: "drop", face: "focused" });
    expect(defaultLook("b_00000000")).toEqual({ shape: "ghost", face: "happy" });
  });

  it("keeps a stored look and repairs unknown parts", () => {
    expect(lookOf({ id: "b_0000aaaa", color: "teal", shape: "ghost", face: "wink" })).toEqual({
      shape: "ghost",
      face: "wink",
      color: "teal",
    });
    expect(lookOf({ id: "b_0000aaaa", color: "mint", shape: "blob?", face: undefined })).toEqual({
      shape: "drop",
      face: "focused",
      color: "mint",
    });
  });
});

describe("plainSummary", () => {
  it("reads a run's summary without Markdown marks", () => {
    expect(
      plainSummary(
        "The PDF was already generated and checked successfully: **six pages, 17 links**.",
      ),
    ).toBe("The PDF was already generated and checked successfully: six pages, 17 links.");
    expect(
      plainSummary(
        "## Done\n- See [the report](Morning-AI-Research.pdf) and `out.csv`\n- _All_ checks passed",
      ),
    ).toBe("Done See the report and out.csv All checks passed");
    expect(plainSummary("snake_case_name stays")).toBe("snake_case_name stays");
    expect(plainSummary("Clipped mid-phrase: **six pages, 17 link")).toBe(
      "Clipped mid-phrase: six pages, 17 link",
    );
  });
});

describe("scheduledPrompt", () => {
  it("drops the host's alarm-clock prefix from a schedule's prompt", () => {
    // As the host words it (kleio-host blobs.ts): a newline after the colon.
    expect(
      scheduledPrompt('\u23F0 Scheduled task "Morning research":\nCreate a pdf report on AI'),
    ).toEqual({ label: "Morning research", prompt: "Create a pdf report on AI" });
    expect(scheduledPrompt("Just a normal message")).toBeNull();
  });
});
