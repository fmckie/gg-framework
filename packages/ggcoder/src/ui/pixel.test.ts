import { describe, it, expect } from "vitest";
import { renderScreen } from "./pixel.js";
import type { PixelFetchResult } from "../core/pixel.js";

function strip(s: string): string {
  // Strip ANSI escape sequences for assertion readability.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "");
}

const empty: PixelFetchResult = {
  entries: [],
  unreachable: [],
  unmanaged: [],
  hasProjects: false,
};

const noErrors: PixelFetchResult = {
  entries: [],
  unreachable: [],
  unmanaged: [],
  hasProjects: true,
};

const mixed: PixelFetchResult = {
  hasProjects: true,
  unreachable: [],
  unmanaged: [],
  entries: [
    {
      errorId: "err_1",
      projectId: "proj_a",
      projectName: "alpha",
      projectPath: "/p/a",
      status: "open",
      type: "TypeError",
      message: "Cannot read 'name' of undefined",
      occurrences: 47,
      recurrenceCount: 0,
      location: "/p/a/src/UserCard.tsx:42",
      branch: null,
    },
    {
      errorId: "err_2",
      projectId: "proj_a",
      projectName: "alpha",
      projectPath: "/p/a",
      status: "awaiting_review",
      type: "RangeError",
      message: "Bad index",
      occurrences: 1,
      recurrenceCount: 2,
      location: "/p/a/src/api.ts:7",
      branch: "fix/pixel-err_2",
    },
    {
      errorId: "err_3",
      projectId: "proj_b",
      projectName: "beta",
      projectPath: "/p/b",
      status: "failed",
      type: "SyntaxError",
      message: "Unexpected token",
      occurrences: 3,
      recurrenceCount: 0,
      location: "/p/b/src/parse.ts:18",
      branch: null,
    },
  ],
};

describe("renderScreen", () => {
  it("renders the Kleio Coder banner with the Pixel label", () => {
    const out = strip(renderScreen(empty, 0));
    expect(out).toContain("Kleio Coder");
    expect(out).toContain("Pixel");
    expect(out).not.toContain("By Ken Kai");
  });

  it("shows the install hint when no projects are registered", () => {
    const out = strip(renderScreen(empty, 0));
    expect(out).toContain("No projects registered");
    expect(out).toContain("kleio-coder pixel install");
  });

  it("shows a clean-state message when projects exist but no errors", () => {
    const out = strip(renderScreen(noErrors, 0));
    expect(out).toContain("No open errors");
  });

  it("renders project headers and rows with status badges", () => {
    const out = strip(renderScreen(mixed, 0));
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("OPEN");
    expect(out).toContain("REVIEW");
    expect(out).toContain("FAILED");
    expect(out).toContain("TypeError");
    expect(out).toContain("/p/a/src/UserCard.tsx:42");
  });

  it("marks the selected row with the ❯ chevron", () => {
    const out0 = strip(renderScreen(mixed, 0));
    const out2 = strip(renderScreen(mixed, 2));
    expect(out0.split("\n").find((l) => l.includes("TypeError"))).toContain("❯");
    expect(out2.split("\n").find((l) => l.includes("SyntaxError"))).toContain("❯");
  });

  it("includes occurrence count and recurrence indicator", () => {
    const out = strip(renderScreen(mixed, 0));
    expect(out).toContain("×47");
    expect(out).toContain("↻2"); // recurrence on err_2
  });

  it("shows footer with nav hints when entries exist", () => {
    const out = strip(renderScreen(mixed, 0));
    expect(out).toContain("↑↓ navigate");
    expect(out).toContain("Enter");
    expect(out).toContain("fix one");
    expect(out).toContain("fix all");
    expect(out).toContain("Esc");
    expect(out).toContain("close");
  });

  it("shows only Esc-close hint when no entries", () => {
    const out = strip(renderScreen(noErrors, 0));
    expect(out).toContain("Esc close");
    expect(out).not.toContain("fix one");
  });

  it("flags unreachable backends with a red bullet", () => {
    const data: PixelFetchResult = {
      hasProjects: true,
      entries: [],
      unreachable: ["client-x"],
      unmanaged: [],
    };
    const out = strip(renderScreen(data, 0));
    expect(out).toContain("✗ client-x: backend unreachable");
  });

  it("groups errors by project — alpha rows precede beta rows", () => {
    const out = strip(renderScreen(mixed, 0));
    const alphaIdx = out.indexOf("alpha");
    const betaIdx = out.indexOf("beta");
    const typeErrIdx = out.indexOf("TypeError");
    const syntaxErrIdx = out.indexOf("SyntaxError");
    expect(alphaIdx).toBeLessThan(typeErrIdx);
    expect(typeErrIdx).toBeLessThan(betaIdx);
    expect(betaIdx).toBeLessThan(syntaxErrIdx);
  });
});
