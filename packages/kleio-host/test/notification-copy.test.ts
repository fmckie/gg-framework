import { describe, expect, it } from "vitest";
import {
  clipAtWord,
  collapseIdFor,
  COLLAPSE_ID_MAX_BYTES,
  createReplyTracker,
  noticeFor,
  plainText,
} from "../src/notification-copy.js";

const frame = (type: string, data: Record<string, unknown> = {}): string =>
  `id: 1\ndata: ${JSON.stringify({ type, data })}`;

describe("plainText", () => {
  it("strips markdown to one plain line", () => {
    const md = [
      "## Done",
      "",
      "I **fixed** the _login_ bug in `auth.ts` — see [the PR](https://x.y/1).",
      "",
      "```ts",
      "const secret = 1;",
      "```",
      "",
      "- first item",
      "1. second item",
      "> quoted",
      "![shot](a.png) <b>bold</b>",
    ].join("\n");
    expect(plainText(md)).toBe(
      "Done. I fixed the login bug in auth.ts, see the PR. first item. second item. quoted. bold.",
    );
  });

  it("drops an unclosed fence and emoji, collapses whitespace", () => {
    expect(plainText("Ready 🎉\n\n```\nnever shown")).toBe("Ready");
    expect(plainText("a   b\t\tc")).toBe("a b c");
  });
});

describe("clipAtWord", () => {
  it("cuts at a word boundary with one ellipsis", () => {
    const text = "word ".repeat(60).trim();
    const out = clipAtWord(text, 170);
    expect([...out].length).toBeLessThanOrEqual(170);
    expect(out.endsWith("word…")).toBe(true);
    expect(out.match(/…/g)).toHaveLength(1);
  });
  it("leaves short text alone and cuts a single long word mid-word", () => {
    expect(clipAtWord("short", 170)).toBe("short");
    expect(clipAtWord("x".repeat(300), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("noticeFor", () => {
  it("words each kind", () => {
    expect(noticeFor({ kind: "finished", name: "kleio-website" }).subtitle).toBe("Finished");
    expect(noticeFor({ kind: "failed" }).subtitle).toBe("Couldn't finish");
    expect(noticeFor({ kind: "stopped" }).subtitle).toBe("Stopped");
    expect(noticeFor({ kind: "question" }).subtitle).toBe("Needs your answer");
    expect(noticeFor({ kind: "message", author: "Chef" }).subtitle).toBe("Chef replied");
  });
  it("titles with the name (emoji dropped), never empty", () => {
    const n = noticeFor({ kind: "message", name: "🍳 Dinner plans", author: "Chef", text: "" });
    expect(n.title).toBe("Dinner plans");
    expect(n.body).toBe("Tap to read the reply.");
    expect(noticeFor({ kind: "finished" }).title).toBe("Kleio");
  });
  it("weights by kind and collapses run ends only", () => {
    expect(noticeFor({ kind: "question" }, "s1")).toMatchObject({
      relevanceScore: 1,
      interruptionLevel: "active",
    });
    expect(noticeFor({ kind: "question" }, "s1").collapseId).toBeUndefined();
    expect(noticeFor({ kind: "message" }, "g1").collapseId).toBeUndefined();
    expect(noticeFor({ kind: "failed" }, "s1")).toMatchObject({
      relevanceScore: 0.8,
      collapseId: "s1:run",
    });
    expect(noticeFor({ kind: "finished" }, "s1").relevanceScore).toBe(0.6);
  });
  it("never uses the old brand names or em dashes in its own words", () => {
    for (const kind of ["finished", "failed", "stopped", "question", "message"] as const) {
      const n = noticeFor({ kind });
      expect(`${n.title} ${n.subtitle} ${n.body}`).not.toMatch(/GG|Ken|—/);
    }
  });
});

describe("collapseIdFor", () => {
  it("is at most 64 bytes, stable, and shared by every run-end kind", () => {
    const long = "é".repeat(80);
    const id = collapseIdFor(long, "finished");
    expect(id).toBeDefined();
    expect(new TextEncoder().encode(id ?? "").length).toBeLessThanOrEqual(COLLAPSE_ID_MAX_BYTES);
    expect(collapseIdFor(long, "failed")).toBe(id);
    expect(collapseIdFor("abc", "stopped")).toBe("abc:run");
    expect(collapseIdFor("abc", "question")).toBeUndefined();
  });
});

describe("createReplyTracker", () => {
  it("quotes the final reply, after the last tool call", () => {
    const t = createReplyTracker();
    t.onFrame("s", frame("run_start"));
    t.onFrame("s", frame("text_delta", { text: "Let me look." }));
    t.onFrame("s", frame("tool_call_start", { name: "read" }));
    t.onFrame("s", frame("text_delta", { text: "All " }));
    t.onFrame("s", frame("text_delta", { text: "good." }));
    expect(t.onFrame("s", frame("run_end", {}))).toEqual({ kind: "finished", text: "All good." });
  });
  it("reports a failure's headline and a cancel", () => {
    const t = createReplyTracker();
    t.onFrame("s", frame("error", { headline: "Rate limited", message: "429" }));
    expect(t.onFrame("s", frame("run_end", { failed: true }))).toEqual({
      kind: "failed",
      text: "Rate limited",
    });
    expect(t.onFrame("s", frame("run_end", { cancelled: true }))).toEqual({ kind: "stopped" });
  });
});
