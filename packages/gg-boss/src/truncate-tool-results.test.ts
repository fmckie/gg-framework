import { describe, expect, it } from "vitest";
import type { Message } from "@kleio/ai";
import { truncateOversizedToolResults } from "./truncate-tool-results.js";

function bigToolResult(text: string, id = "t1"): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: id, content: text }],
  };
}

function bigToolResultBlocks(text: string, id = "t1"): Message {
  return {
    role: "tool",
    content: [
      {
        type: "tool_result",
        toolCallId: id,
        content: [{ type: "text", text }],
      },
    ],
  };
}

function userMsg(): Message {
  return { role: "user", content: "ok" };
}

describe("truncateOversizedToolResults", () => {
  it("leaves short results alone", () => {
    const messages: Message[] = [
      bigToolResult("short"),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
    ];
    const messagesBefore = JSON.parse(JSON.stringify(messages));
    const trimmed = truncateOversizedToolResults(messages, { maxChars: 100, tailProtected: 0 });
    expect(trimmed).toBe(0);
    expect(messages).toEqual(messagesBefore);
  });

  it("truncates oversized string content in place with a notice", () => {
    const big = "x".repeat(50_000);
    const messages: Message[] = [
      bigToolResult(big),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
    ];
    const trimmed = truncateOversizedToolResults(messages, { maxChars: 1000 });
    expect(trimmed).toBe(1);
    const block = (messages[0] as { content: { content: string }[] }).content[0]!;
    expect(typeof block.content).toBe("string");
    expect((block.content as string).length).toBeLessThan(big.length);
    expect(block.content as string).toContain("gg-boss:truncated");
    expect(block.content as string).toContain("50,000");
  });

  it("truncates text blocks inside ToolResultContent arrays", () => {
    const big = "y".repeat(50_000);
    const messages: Message[] = [
      bigToolResultBlocks(big),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
    ];
    const trimmed = truncateOversizedToolResults(messages, { maxChars: 500 });
    expect(trimmed).toBe(1);
    const blocks = (messages[0] as { content: { content: { type: string; text: string }[] }[] })
      .content[0]!.content;
    expect(blocks[0]!.text).toContain("gg-boss:truncated");
  });

  it("is idempotent — second call truncates nothing", () => {
    const big = "z".repeat(50_000);
    const messages: Message[] = [
      bigToolResult(big),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
    ];
    expect(truncateOversizedToolResults(messages, { maxChars: 1000 })).toBe(1);
    expect(truncateOversizedToolResults(messages, { maxChars: 1000 })).toBe(0);
  });

  it("skips error results", () => {
    const big = "e".repeat(50_000);
    const messages: Message[] = [
      {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "t1", content: big, isError: true }],
      },
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
    ];
    expect(truncateOversizedToolResults(messages, { maxChars: 1000 })).toBe(0);
    const block = (messages[0] as { content: { content: string }[] }).content[0]!;
    expect((block.content as string).length).toBe(50_000);
  });

  it("protects the last N messages", () => {
    const big = "p".repeat(50_000);
    const messages: Message[] = [bigToolResult(big, "t1"), bigToolResult(big, "t2")];
    // tailProtected default is 6 — both messages fall within the tail.
    expect(truncateOversizedToolResults(messages, { maxChars: 1000 })).toBe(0);
  });

  it("truncates older results when newer ones are within the tail window", () => {
    const big = "q".repeat(50_000);
    const messages: Message[] = [
      bigToolResult(big, "old"),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
      userMsg(),
    ];
    const trimmed = truncateOversizedToolResults(messages, { maxChars: 1000, tailProtected: 6 });
    expect(trimmed).toBe(1);
  });
});
