/**
 * SessionInfo.firstPrompt — the label field session pickers use instead of a UUID.
 *
 * The load-bearing property is that it is captured during the SINGLE listing scan
 * `list()` already performs. The last test enforces that by counting real file
 * opens: if anyone reintroduces a second read to fetch the prompt, it fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import type * as NodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { Message } from "@kleio/ai";
import { SessionManager } from "./session-manager.js";

/**
 * Records every real read of a session file. Module-level mocks (not namespace
 * spies) are required: session-storage.ts imports `createReadStream` as a named
 * binding, which is captured at module load and unaffected by spyOn(fs, ...).
 * Both mocks delegate to the genuine implementation, so list() returns real data.
 */
const { jsonlReads } = vi.hoisted(() => ({ jsonlReads: [] as string[] }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    default: actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const target = args[0];
      if (typeof target === "string" && /\.jsonl(?:\.gz)?$/.test(target)) jsonlReads.push(target);
      return actual.createReadStream(...args);
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  const readFile = (...args: Parameters<typeof actual.readFile>) => {
    const target = args[0];
    if (typeof target === "string" && /\.jsonl(?:\.gz)?$/.test(target)) jsonlReads.push(target);
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

/**
 * Storage now probes files up to 4 KiB for redirect stubs. Use realistic larger
 * transcripts for single-pass assertions, so both eager reads and extra streams
 * still fail the original instrumentation. Deterministic hash text stays larger
 * than that bound even after gzip compression.
 */
async function expandTranscript(sessionPath: string): Promise<void> {
  const content = Array.from({ length: 256 }, (_, i) =>
    createHash("sha256").update(String(i)).digest("hex"),
  ).join("");
  await addMessage(sessionPath, { role: "assistant", content });
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

  it("keeps raw firstPrompt alongside normalized preview", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    const raw = "  Refactor\tthe\n\nauth flow  ";
    await addMessage(session.path, { role: "user", content: raw });

    const listed = await listOne();
    expect(listed.firstPrompt).toBe(raw);
    expect(listed.preview).toBe("Refactor the auth flow");
  });

  it("captures archived prompts in the same single stream pass", async () => {
    const session = await manager.create(cwd, "anthropic", "test-model");
    const raw = "  archived\nrequest  ";
    await addMessage(session.path, { role: "user", content: raw });
    await expandTranscript(session.path);
    const archivePath = `${session.path}.gz`;
    const archive = gzipSync(await fs.readFile(session.path));
    expect(archive.length).toBeGreaterThan(4096);
    await fs.writeFile(archivePath, archive);
    await fs.unlink(session.path);
    jsonlReads.length = 0;

    const listed = await listOne();
    expect(listed.path).toBe(archivePath);
    expect(listed.firstPrompt).toBe(raw);
    expect(listed.preview).toBe("archived request");
    expect(jsonlReads).toEqual([archivePath]);
  });

  it("uses the canonical newest checkpoint without replacing its preview", async () => {
    const original = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(original.path, { role: "user", content: "original request" });
    await expandTranscript(original.path);
    const checkpoint = await manager.create(cwd, "anthropic", "test-model", {
      conversationId: original.id,
      parentSessionId: original.id,
      generation: 1,
      preview: "original request",
    });
    await addMessage(checkpoint.path, { role: "user", content: "  retained\nraw tail  " });
    await expandTranscript(checkpoint.path);
    jsonlReads.length = 0;

    const listed = await listOne();
    expect(listed.path).toBe(checkpoint.path);
    expect(listed.firstPrompt).toBe("  retained\nraw tail  ");
    expect(listed.preview).toBe("original request");
    expect(jsonlReads).toHaveLength(2);
    expect(new Set(jsonlReads)).toEqual(new Set([original.path, checkpoint.path]));
  });

  it("reads each session file exactly ONCE — no second pass for the prompt", async () => {
    const a = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(a.path, { role: "user", content: "session A prompt" });
    await expandTranscript(a.path);
    const b = await manager.create(cwd, "anthropic", "test-model");
    await addMessage(b.path, { role: "user", content: "session B prompt" });
    await expandTranscript(b.path);

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
