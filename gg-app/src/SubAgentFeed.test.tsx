import { describe, expect, it } from "vitest";
import { firstLine, formatSubAgentTokens } from "./SubAgentFeed";

describe("formatSubAgentTokens", () => {
  it("adds Anthropic cache writes to fresh input for provider-neutral usage", () => {
    expect(
      formatSubAgentTokens({ input: 2, output: 500, cacheRead: 80_000, cacheWrite: 12_000 }),
    ).toBe("↑ 12.0k · ↻ 80k cached · ↓ 500");
  });

  it("keeps OpenAI non-cached input unchanged", () => {
    expect(formatSubAgentTokens({ input: 50_000, output: 800, cacheRead: 65_000 })).toBe(
      "↑ 50k · ↻ 65k cached · ↓ 800",
    );
  });
});

describe("firstLine", () => {
  it("is the first line that says something", () => {
    expect(firstLine("\n\n  Run the auth suite  \nThen report.")).toBe("Run the auth suite");
    expect(firstLine("---\n```ts\nconst a = 1;")).toBe("const a = 1;");
  });

  it("drops Markdown marks and keeps code ticks", () => {
    expect(firstLine("## Audit `login.ts`")).toBe("Audit `login.ts`");
    expect(firstLine("- **Done:** two routes")).toBe("Done: two routes");
    expect(firstLine("> quoted")).toBe("quoted");
  });

  it("cuts a long line at 200 characters, with an ellipsis", () => {
    const line = firstLine("x".repeat(500));
    expect(line).toHaveLength(200);
    expect(line?.endsWith("\u2026")).toBe(true);
  });

  it("is nothing for no text", () => {
    expect(firstLine(undefined)).toBeUndefined();
    expect(firstLine(42)).toBeUndefined();
    expect(firstLine(" \n\n")).toBeUndefined();
  });
});
