import { describe, expect, it } from "vitest";
import { defaultLook, lookOf } from "./blobLook";
import {
  agentFilePath,
  isOutputPath,
  isSitePath,
  specialistFilePath,
  workspaceFilePath,
} from "./filePaths";
import {
  fileErrorText,
  fileKind,
  fileLinks,
  formatBytes,
  ownerKey,
  siteErrorText,
  workspaceFileLinks,
} from "./kleioFiles";
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

describe("specialist file links", () => {
  const member = { blobId: "b_2d3c73f2", groupId: "g_c6b8e35f" };
  const group = "/Users/mini/Kleio/groups/g_c6b8e35f";

  it("accepts relative links and absolute paths in the author's own group folder", () => {
    expect(specialistFilePath("festivals.md", member)).toBe("festivals.md");
    expect(specialistFilePath(`${group}/b_2d3c73f2/festivals.md`, member)).toBe("festivals.md");
    expect(specialistFilePath(`${group}/b_2d3c73f2/out/My%20plan.pdf`, member)).toBe(
      "out/My plan.pdf",
    );
  });

  it("accepts absolute paths in a single specialist's own folder", () => {
    const own = { blobId: "b1" };
    expect(specialistFilePath("/Users/x/Kleio/blobs/b1/report.pdf", own)).toBe("report.pdf");
    expect(specialistFilePath("/Users/x/Kleio/blobs/b2/report.pdf", own)).toBeNull();
    expect(specialistFilePath("/Users/x/Kleio/groups/g1/b1/report.pdf", own)).toBeNull();
  });

  it("rejects paths outside the author's folder", () => {
    for (const href of [
      "/etc/passwd.txt",
      `${group}/b_other/a.md`,
      "/Users/x/Kleio/groups/g_other/b_2d3c73f2/a.md",
      "/Users/x/Kleio/blobs/b_2d3c73f2/a.md",
      `${group}/b_2d3c73f2/../b_other/a.md`,
      `${group}/b_2d3c73f2/.secret.md`,
      `${group}/b_2d3c73f2/folder`,
      `${group}/b_2d3c73f2/`,
      "/Users/../Kleio/groups/g_c6b8e35f/b_2d3c73f2/a.md",
    ]) {
      expect(specialistFilePath(href, member), href).toBeNull();
    }
  });

  it("turns an author's absolute links into file cards, labels kept", () => {
    const md = `I've created [festivals.md](${group}/b_2d3c73f2/festivals.md) and [x](/etc/passwd.txt)`;
    expect(fileLinks(md, { kind: "group", ...member })).toEqual([
      { path: "festivals.md", label: "festivals.md" },
    ]);
    expect(fileLinks(md, { kind: "group", groupId: "g_c6b8e35f", blobId: "b_other" })).toEqual([]);
    expect(fileLinks(md)).toEqual([]);
  });
});

describe("workspaceFilePath", () => {
  const cwd = "/Users/me/kleio-projects/app";

  it.each([
    ["out/report.pdf", "out/report.pdf"],
    ["./site/index.html", "site/index.html"],
    ["/Users/me/kleio-projects/app/out/report.pdf", "out/report.pdf"],
    ["/Users/me/kleio-projects/app/out/week%2040.pdf", "out/week 40.pdf"],
    ["file:///Users/me/kleio-projects/app/data.csv", "data.csv"],
    ["file://localhost/Users/me/kleio-projects/app/data.csv?x=1", "data.csv"],
  ])("accepts %s", (href, path) => {
    expect(workspaceFilePath(href, cwd)).toBe(path);
  });

  it("accepts a cwd with a trailing slash", () => {
    expect(workspaceFilePath(`${cwd}/r.pdf`, `${cwd}/`)).toBe("r.pdf");
  });

  it.each([
    "/Users/me/kleio-projects/other/report.pdf",
    "/Users/me/kleio-projects/app-evil/report.pdf",
    "/Users/me/kleio-projects/app",
    "/Users/me/kleio-projects/app/../other/report.pdf",
    "/Users/me/kleio-projects/app/.secret/report.pdf",
    "/Users/me/kleio-projects/app//report.pdf",
    "/tmp/report.pdf",
    "file://server/Users/me/kleio-projects/app/report.pdf",
    "../report.pdf",
    "https://example.com/report.pdf",
  ])("rejects %s", (href) => {
    expect(workspaceFilePath(href, cwd)).toBeNull();
  });

  it("takes no absolute links when the cwd is not absolute", () => {
    expect(workspaceFilePath("/a/b.pdf", "a")).toBeNull();
    expect(workspaceFilePath("b.pdf", "a")).toBe("b.pdf");
  });
});

describe("workspaceFileLinks", () => {
  it("keeps outputs and leaves source files as plain links", () => {
    const cwd = "/Users/me/kleio-projects/app";
    const md = [
      "Changed [App.tsx](src/App.tsx) and [notes](README.md).",
      `Report: [Quarterly report](${cwd}/out/report.pdf), [Demo site](site/index.html).`,
      "Again [the report](out/report.pdf). ![chart](chart.png)",
    ].join("\n");
    expect(workspaceFileLinks(md, cwd)).toEqual([
      { path: "out/report.pdf", label: "Quarterly report" },
      { path: "site/index.html", label: "Demo site" },
    ]);
  });

  it("sorts outputs from sites", () => {
    expect(isOutputPath("a/Data.XLSX")).toBe(true);
    expect(isOutputPath("src/App.tsx")).toBe(false);
    expect(isOutputPath("notes.md")).toBe(false);
    expect(isSitePath("site/index.HTML")).toBe(true);
    expect(isSitePath("page.htm")).toBe(true);
    expect(isSitePath("report.pdf")).toBe(false);
    expect(fileKind("index.html")).toBe("Website");
  });
});

describe("ownerKey", () => {
  it("is distinct per owner", () => {
    const keys = [
      ownerKey({ kind: "blob", blobId: "b_1" }),
      ownerKey({ kind: "group", groupId: "g_1", blobId: "b_1" }),
      ownerKey({ kind: "workspace", cwd: "/a/b" }),
      ownerKey({ kind: "workspace", cwd: "/a/c" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
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
    expect(fileErrorText(new Error("no such workspace"))).toMatch(/project folders/);
    expect(fileErrorText(new Error("kleio_file: bad folder"))).toMatch(/project folders/);
  });

  it("explains the host's site errors", () => {
    expect(siteErrorText(new Error("not_found"))).toMatch(/needs an update to open sites/);
    expect(siteErrorText(new Error("not found"))).toMatch(/needs an update to open sites/);
    expect(siteErrorText(new Error("not_a_site"))).toBe("Only web pages open as a site.");
    expect(siteErrorText(new Error("bad_request"))).toMatch(/didn't understand/);
    expect(siteErrorText(new Error("no such file"))).toMatch(/isn't on your Mac mini/);
    expect(siteErrorText(new Error("no such workspace"))).toMatch(/project folders/);
    expect(siteErrorText(new Error("Your Mac mini answered 401"))).toBe(
      "Your Mac mini answered 401",
    );
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
