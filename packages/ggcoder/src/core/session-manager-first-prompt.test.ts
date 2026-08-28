/**
 * SessionInfo.firstPrompt — the label field session pickers use instead of a UUID.
 *
 * The load-bearing property is that it is captured during the SINGLE listing scan
 * `list()` already performs. The last test enforces that by counting real file
 * opens: if anyone reintroduces a second read to fetch the prompt, it fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Message } from "@kleio/ai";
import { SessionManager } from "./session-manager.js";

/**
 * Records every real read of a session file. Module-level mocks (not namespace
 * spies) are required: session-manager.ts imports `createReadStream` as a named
 * binding, which is captured at module load and unaffected by spyOn(fs, ...).
 * Both mocks delegate to the genuine implementation, so list() returns real data.
 */
const { jsonlReads } = vi.hoisted(() => ({ jsonlReads: [] as string[] }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const target = args[0];
      if (typeof target === "string" && target.endsWith(".jsonl")) jsonlReads.push(target);
      return actual.createReadStream(...args);
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = (...args: Parameters<typeof actual.readFile>) => {
    const target = args[0];
    if (typeof target === "string" && target.endsWith(".jsonl")) jsonlReads.push(target);
    return actual.readFile(...args);
  };
  return { ...actual, default: { ...actual, readFile }, readFile };
});

let sessionsDir: string;
let cwd: string;
let manager: SessionManager;

beforeEach(async () => {
  sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "kleio-first-prompt-store-"));
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kleio-first-prompt-cwd-"));
  manager = new SessionManager(sessionsDir);
  jsonlReads.length = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(sessionsDir, { recursive: true, force: true });
  await fs.rm(cwd, { recursive: true, force: true });
});

/** Append one user/assistant message to a session, keeping the leaf pointer valid. */
async function addMessage(sessionPath: string, message: Message): Promise<void> {
  const id = crypto.randomUUID();
  await manager.appendEntry(sessionPath, {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message,
  });
  await manager.updateLeaf(sessionPath, id);
}

async function listOne() {
  const listed = await manager.list(cwd);
  expect(listed).toHaveLength(1);
  return listed[0]!;
}

describe("SessionManager.list — firstPrompt", () => {
  it("captures a plain string user message", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(session.path, { role: "user", content: "Refactor the auth flow" });

    expect((await listOne()).firstPrompt).toBe("Refactor the auth flow");
  });

  it("captures the first text block from mixed text/media content", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(session.path, {
      role: "user",
      content: [
        { type: "image", data: "AAAA", mediaType: "image/png" },
        { type: "text", text: "What is wrong with this screenshot?" },
        { type: "text", text: "second block, ignored" },
      ],
    });

    expect((await listOne()).firstPrompt).toBe("What is wrong with this screenshot?");
  });

  it("omits firstPrompt for an image-only turn rather than labelling it empty", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(session.path, {
      role: "user",
      content: [{ type: "image", data: "AAAA", mediaType: "image/png" }],
    });

    expect((await listOne()).firstPrompt).toBeUndefined();
  });

  it("uses the FIRST user message, ignoring later turns and assistant replies", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(session.path, { role: "assistant", content: "assistant speaks first" });
    await addMessage(session.path, { role: "user", content: "the real first prompt" });
    await addMessage(session.path, { role: "user", content: "a later prompt" });

    expect((await listOne()).firstPrompt).toBe("the real first prompt");
  });

  it("omits firstPrompt for a session with no messages", async () => {
    await manager.create(cwd, "anthropic", "test-model");
    const listed = await manager.list(cwd);

    expect(listed).toHaveLength(1);
    expect(listed[0]!.firstPrompt).toBeUndefined();
    expect(listed[0]).not.toHaveProperty("firstPrompt");
  });

  it("caps a huge paste instead of holding it whole", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(session.path, { role: "user", content: "x".repeat(10_000) });

    const { firstPrompt } = await listOne();
    expect(firstPrompt).toHaveLength(512);
  });

  it("preserves raw whitespace and control characters for the caller to sanitize", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(session.path, { role: "user", content: "  Refactor\tthe\n\nauth flow  " });

    expect((await listOne()).firstPrompt).toBe("  Refactor\tthe\n\nauth flow  ");
  });

  it("reads each session file exactly ONCE — no second pass for the prompt", async () => {
    const a = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(a.path, { role: "user", content: "session A prompt" });
    const b = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(b.path, { role: "user", content: "session B prompt" });

    // Only count reads performed by list() itself, not by the setup above.
    jsonlReads.length = 0;
    const listed = await manager.list(cwd);

    expect(listed).toHaveLength(2);
    expect(listed.map((s) => s.firstPrompt).sort()).toEqual([
      "session A prompt",
      "session B prompt",
    ]);
    // Two sessions, two reads: a single pass each, prompts included.
    expect(jsonlReads).toHaveLength(2);
    expect(new Set(jsonlReads).size).toBe(2);
  });
});
