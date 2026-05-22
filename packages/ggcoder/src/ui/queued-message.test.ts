import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isActiveItem, type CompletedItem } from "./App.js";

const appSource = readFileSync(fileURLToPath(new URL("./App.tsx", import.meta.url)), "utf8");

function queuedItem(overrides: Partial<Extract<CompletedItem, { kind: "queued" }>> = {}) {
  return {
    kind: "queued" as const,
    text: "follow-up prompt",
    id: "queued-1",
    ...overrides,
  };
}

describe("queued message UI invariants", () => {
  it("uses a non-emoji dot marker with warning color styling", () => {
    const renderItemStart = appSource.indexOf("const renderItem");
    expect(renderItemStart).toBeGreaterThanOrEqual(0);
    const queuedBranchStart = appSource.indexOf('case "queued":', renderItemStart);
    expect(queuedBranchStart).toBeGreaterThanOrEqual(0);
    const queuedBranch = appSource.slice(
      queuedBranchStart,
      appSource.indexOf('case "compacting":', queuedBranchStart),
    );

    expect(queuedBranch).toContain('{"• "}');
    expect(queuedBranch).toContain("theme.warning");
    expect(queuedBranch).toContain("Queued: ");
    expect(queuedBranch).not.toContain("⏳");
  });

  it("keeps queued placeholders active so insertion flush removes them from live items", () => {
    expect(isActiveItem(queuedItem())).toBe(true);
  });
});
