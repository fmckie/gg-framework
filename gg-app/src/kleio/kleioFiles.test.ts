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

describe("files a reply names without linking", () => {
  const own = { kind: "blob", blobId: "b_0f35a4fa" } as const;
  const folder = "/Users/mini/Kleio/blobs/b_0f35a4fa";

  // Regression: specialists and chats began writing their files as code or
  // bold instead of links, and the cards (preview, Open, Save a copy) vanished.
  it("cards an output named in code or bold, the reply's own folder only", () => {
    const md = [
      "Today's report is ready: **london-ai-jobs-2026-10-08.pdf** in the Job hunter folder.",
      `Also at \`${folder}/out/table.xlsx\` and **\`chart.png\`**.`,
      "Not `/Users/mini/Kleio/blobs/b_other/x.pdf` or `../up.pdf`.",
    ].join("\n");
    expect(fileLinks(md, own)).toEqual([
      {
        path: "london-ai-jobs-2026-10-08.pdf",
        label: "london-ai-jobs-2026-10-08.pdf",
        named: true,
      },
      { path: "out/table.xlsx", label: "table.xlsx", named: true },
      { path: "chart.png", label: "chart.png", named: true },
    ]);
  });

  it("cards a Chat or Code output named by its absolute path", () => {
    const cwd = "/Users/willmckie/kleio-projects";
    const md =
      "Done — a single-page A4 test PDF is at `/Users/willmckie/kleio-projects/test.pdf` (606 bytes).";
    expect(workspaceFileLinks(md, cwd)).toEqual([
      { path: "test.pdf", label: "test.pdf", named: true },
    ]);
    expect(workspaceFileLinks("See `/Users/willmckie/elsewhere/test.pdf`.", cwd)).toEqual([]);
  });

  it("leaves code, notes, prose, commands and code blocks alone", () => {
    const md = [
      "Edited `src/App.tsx`, `jobs/latest.json`, `notes.md` and `site/index.html`.",
      "**Saved the report.pdf** and run `open report.pdf`. **File:** `v2.0`",
      "```",
      "listing.pdf",
      "`inside.pdf`",
      "```",
      "~~~~",
      "**tilde.pdf**",
      "~~~",
      "still `fenced.pdf`",
      "~~~~",
      "After: `after.pdf`",
    ].join("\n");
    expect(fileLinks(md, own).map((l) => l.path)).toEqual(["after.pdf"]);
    expect(workspaceFileLinks(md, "/Users/me/app").map((l) => l.path)).toEqual(["after.pdf"]);
  });

  it("reads ~/ paths as absolute, never as a file in the folder", () => {
    const md = "Saved to `~/Kleio/blobs/b_0f35a4fa/week.pdf`, not `~/Desktop/other.pdf`.";
    expect(fileLinks(md, own)).toEqual([{ path: "week.pdf", label: "week.pdf", named: true }]);
    // A Chat or Code session's ~ is the home its folder is in.
    const chat = "See `~/kleio-projects/out/test.pdf`, not `~/Desktop/other.pdf`.";
    expect(workspaceFileLinks(chat, "/Users/me/kleio-projects")).toEqual([
      { path: "out/test.pdf", label: "test.pdf", named: true },
    ]);
    // A folder in no home has no ~ to read it against.
    for (const cwd of ["/Volumes/Data/kleio-projects", "/Users/Shared/kleio-projects"]) {
      expect(workspaceFileLinks("See `~/kleio-projects/test.pdf`.", cwd), cwd).toEqual([]);
    }
  });

  // Regression: Chat saves what it makes under "Kleio Chat/", and a named path
  // with a space in it never counted, so none of its files got a card.
  it("cards a path with spaces in its names, as Chat's own folder has", () => {
    const cwd = "/Users/willmckie/kleio-projects";
    // A Chat reply on the Mac mini, 9 Oct 2026.
    const md =
      'Done — your test PDF is at **Kleio Chat/test-pdf/test.pdf** (1 page, ~17 KB). It just says "Test PDF", today\'s date, and a line confirming generation works.';
    expect(workspaceFileLinks(md, cwd)).toEqual([
      { path: "Kleio Chat/test-pdf/test.pdf", label: "test.pdf", named: true },
    ]);
    expect(workspaceFileLinks("At `~/kleio-projects/Kleio Chat/q3/Q3 report.pdf`.", cwd)).toEqual([
      { path: "Kleio Chat/q3/Q3 report.pdf", label: "Q3 report.pdf", named: true },
    ]);
    // A lone name with a space, or spaces beside a slash, is prose or a command.
    expect(workspaceFileLinks("Run `open report.pdf` or **out / report.pdf**.", cwd)).toEqual([]);
  });

  // Regression: a Chat reply listed the London jobs report by name under its
  // folder (WorkspaceFiles.test.tsx has the reply), and the card looked for it
  // in the session folder itself.
  it("finds a list's bare names in the folder the line above the list names", () => {
    const md = [
      "**`~/kleio-projects/job-research/report/`**",
      "- `jobs.pdf` — the report",
      "",
      "- `page-1.png` and `notes.md`",
      "  with `chart.png` under it",
      "Then `summary.pdf`.",
      "Files in `out/`:",
      "1. `table.xlsx`",
      "2) `other/data.csv`",
    ].join("\n");
    expect(workspaceFileLinks(md, "/Users/me/kleio-projects").map((l) => l.path)).toEqual([
      "job-research/report/jobs.pdf",
      "job-research/report/page-1.png",
      "job-research/report/chart.png",
      "summary.pdf",
      "out/table.xlsx",
      "other/data.csv",
    ]);
  });

  it("never moves a list's names out of the folder, or into a folder an item names", () => {
    const md = [
      "In `~/Desktop/stuff/`:",
      "- `report.pdf`",
      "In `../`:",
      "- `up.pdf`",
      "Done:",
      "- `out/` has the charts",
      "- `chart.png`",
    ].join("\n");
    expect(workspaceFileLinks(md, "/Users/me/kleio-projects").map((l) => l.path)).toEqual([
      "chart.png",
    ]);
  });

  it("lists a file once, keeping its link's label", () => {
    const md = "[The report](report.pdf), also `report.pdf` and **report.pdf**.";
    expect(fileLinks(md, own)).toEqual([{ path: "report.pdf", label: "The report" }]);
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
    ["~/kleio-projects/app/out/report.pdf", "out/report.pdf"],
    ["/~/kleio-projects/app/out/report.pdf", "out/report.pdf"],
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
    "~/kleio-projects/other/report.pdf",
    "~/kleio-projects/app/../other/report.pdf",
    "~/../me/kleio-projects/app/report.pdf",
    "~/kleio-projects/app/.secret/report.pdf",
    "~/kleio-projects/app",
  ])("rejects %s", (href) => {
    expect(workspaceFilePath(href, cwd)).toBeNull();
  });

  it("takes no absolute links when the cwd is not absolute", () => {
    expect(workspaceFilePath("/a/b.pdf", "a")).toBeNull();
    expect(workspaceFilePath("~/a/b.pdf", "a")).toBeNull();
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
