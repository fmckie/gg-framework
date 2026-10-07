import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chatAgentSessionsDir } from "./chat-agents/index.js";
import {
  deleteChatSession,
  listSidecarSessions,
  listStoredSessions,
  readStoredSession,
} from "./app-sidecar-sessions.js";
import { motionSessionsDir } from "./motion-agent/motion-agent.js";
import { encodeCwd } from "./core/encode-cwd.js";
import { archiveColdSession, archiveSessionPath } from "./core/session-storage.js";
import { importForeignSession } from "./core/foreign-session-import.js";
import { SessionManager } from "./core/session-manager.js";

/**
 * Write a Claude Code transcript into a fixture `~/.claude/projects` dir.
 * Claude's directory encoding is ambiguous, so the cwd it records inside the
 * records — not the folder name — is what discovery matches on.
 */
async function writeClaudeTranscript(
  homeDir: string,
  cwd: string,
  sessionId: string,
  prompt: string,
): Promise<string> {
  // The folder name is deliberately only *shaped* like Claude's encoding: since
  // discovery reads the cwd out of the records, the exact name is irrelevant to
  // what these tests assert. It does have to be a VALID single directory name on
  // the host though — collapsing only "/" left Windows paths as `-C:\Users\...`,
  // whose drive colon and backslashes made `mkdir` fail with ENOENT. Fold both
  // separators and the drive colon into dashes so the fixture is portable.
  const encoded = `-${cwd.replace(/[\\/:]/g, "-")}`;
  const projectDir = path.join(homeDir, ".claude", "projects", encoded);
  await fs.mkdir(projectDir, { recursive: true });
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  const stamp = new Date().toISOString();
  const records = [
    {
      parentUuid: null,
      isSidechain: false,
      type: "user",
      uuid: "u1",
      timestamp: stamp,
      cwd,
      message: { role: "user", content: prompt },
    },
    {
      parentUuid: "u1",
      isSidechain: false,
      type: "assistant",
      uuid: "a1",
      timestamp: stamp,
      cwd,
      message: { role: "assistant", content: [{ type: "text", text: "On it." }] },
    },
  ];
  await fs.writeFile(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return file;
}

async function writeSessions(
  sessionsRoot: string,
  cwd: string,
  prefix: string,
  count: number,
): Promise<void> {
  const projectSessionsDir = path.join(sessionsRoot, encodeCwd(cwd));
  await fs.mkdir(projectSessionsDir, { recursive: true });

  for (let index = 0; index < count; index++) {
    const timestamp = new Date(Date.now() + index * 1_000).toISOString();
    const file = path.join(projectSessionsDir, `${prefix}-${index}.jsonl`);
    const records = [
      {
        type: "session",
        version: 2,
        id: `${prefix}-${index}`,
        conversationId: `${prefix}-${index}`,
        timestamp,
        cwd,
        provider: "anthropic",
        model: "claude-sonnet-5",
      },
      {
        type: "message",
        id: `${prefix}-message-${index}`,
        timestamp,
        message: { role: "user", content: `Session ${index}` },
      },
    ];
    await fs.writeFile(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    const modified = new Date(timestamp);
    await fs.utimes(file, modified, modified);
  }
}

describe("gg-app sidecar session listings", () => {
  let tmp: string;
  let cwd: string;
  let coderSessionsDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gg-sidecar-sessions-"));
    cwd = path.join(tmp, "project");
    coderSessionsDir = path.join(tmp, "sessions");
    await fs.mkdir(cwd, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns up to 30 chat sessions while coding remains capped at 5", async () => {
    await writeSessions(coderSessionsDir, cwd, "coding", 31);
    await writeSessions(chatAgentSessionsDir(coderSessionsDir, "general"), cwd, "chat", 31);

    const codingSessions = await listSidecarSessions(cwd, null, coderSessionsDir);
    const chatSessions = await listSidecarSessions(cwd, "all", coderSessionsDir);

    expect(codingSessions).toHaveLength(5);
    expect(codingSessions.map((session) => session.id)).toEqual([
      "coding-30",
      "coding-29",
      "coding-28",
      "coding-27",
      "coding-26",
    ]);
    expect(chatSessions).toHaveLength(30);
    expect(chatSessions[0]).toMatchObject({ id: "chat-30", chatAgent: "general" });
    expect(chatSessions.at(-1)).toMatchObject({ id: "chat-1", chatAgent: "general" });
  });

  it("surfaces a Claude Code session for the project and opens it as a resumable GG Coder session", async () => {
    const home = path.join(tmp, "home");
    const transcript = await writeClaudeTranscript(
      home,
      cwd,
      "cc-session-1",
      "Add a retry to the fetch helper.",
    );

    // 1. It shows up in the session list, tagged with where it came from.
    const sessions = await listSidecarSessions(cwd, null, coderSessionsDir, home);
    const foreign = sessions.find((session) => session.source === "claude-code");
    expect(foreign).toBeDefined();
    expect(foreign?.path).toBe(transcript);
    expect(foreign?.preview).toBe("Add a retry to the fetch helper.");
    expect(foreign?.messageCount).toBe(2);

    // 2. Clicking it (import-then-open) yields a real, loadable GG Coder session.
    const sessionManager = new SessionManager(coderSessionsDir);
    const imported = await importForeignSession({
      filePath: foreign!.path,
      sessionManager,
      provider: "anthropic",
      model: "claude-sonnet-5",
      cwd,
    });
    const loaded = await sessionManager.load(imported.sessionPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.header.cwd).toBe(cwd);
    expect(
      sessionManager.getMessages(loaded!.entries, loaded!.header.leafId).map((m) => m.role),
    ).toEqual(["user", "assistant"]);

    // 3. It now also appears as a NATIVE row, so the next open skips the import.
    const after = await listSidecarSessions(cwd, null, coderSessionsDir, home);
    const native = after.find((session) => session.path === imported.sessionPath);
    expect(native).toBeDefined();
    expect(native?.source).toBeUndefined();
  });

  it("keeps native sessions listed ahead of foreign ones", async () => {
    const home = path.join(tmp, "home");
    await writeClaudeTranscript(home, cwd, "cc-session-2", "Foreign prompt.");
    await writeSessions(coderSessionsDir, cwd, "coding", 2);

    const sessions = await listSidecarSessions(cwd, null, coderSessionsDir, home);
    const firstForeignIndex = sessions.findIndex((session) => session.source === "claude-code");
    const lastNativeIndex = sessions.map((session) => session.source).lastIndexOf(undefined);
    expect(firstForeignIndex).toBeGreaterThan(-1);
    expect(firstForeignIndex).toBeGreaterThan(lastNativeIndex);
  });

  it("ignores a Claude Code session recorded against a different project", async () => {
    const home = path.join(tmp, "home");
    const otherCwd = path.join(tmp, "other-project");
    await fs.mkdir(otherCwd, { recursive: true });
    await writeClaudeTranscript(home, otherCwd, "cc-elsewhere", "Not this project.");

    const sessions = await listSidecarSessions(cwd, null, coderSessionsDir, home);
    expect(sessions.some((session) => session.source === "claude-code")).toBe(false);
  });

  it("lists only Motion's own sessions for the motion query", async () => {
    await writeSessions(coderSessionsDir, cwd, "coding", 2);
    await writeSessions(chatAgentSessionsDir(coderSessionsDir, "general"), cwd, "chat", 2);
    await writeSessions(motionSessionsDir(coderSessionsDir), cwd, "motion", 3);

    const motionSessions = await listSidecarSessions(cwd, "motion", coderSessionsDir);
    const chatSessions = await listSidecarSessions(cwd, "all", coderSessionsDir);

    expect(motionSessions.map((session) => session.id)).toEqual([
      "motion-2",
      "motion-1",
      "motion-0",
    ]);
    expect(chatSessions.some((session) => session.id.startsWith("motion"))).toBe(false);
  });

  it("does not mix foreign sessions into a chat-agent listing", async () => {
    const home = path.join(tmp, "home");
    await writeClaudeTranscript(home, cwd, "cc-session-3", "Foreign prompt.");

    const chatSessions = await listSidecarSessions(cwd, "general", coderSessionsDir, home);
    expect(chatSessions.some((session) => session.source === "claude-code")).toBe(false);
  });

  it("lists archived coding and chat sessions once despite their redirect counterparts", async () => {
    const chatRoot = chatAgentSessionsDir(coderSessionsDir, "general");
    await writeSessions(coderSessionsDir, cwd, "coding-archive", 1);
    await writeSessions(chatRoot, cwd, "chat-archive", 1);
    const codingPlain = path.join(coderSessionsDir, encodeCwd(cwd), "coding-archive-0.jsonl");
    const chatPlain = path.join(chatRoot, encodeCwd(cwd), "chat-archive-0.jsonl");
    await Promise.all([archiveColdSession(codingPlain), archiveColdSession(chatPlain)]);

    const codingSessions = await listSidecarSessions(cwd, null, coderSessionsDir);
    const chatSessions = await listSidecarSessions(cwd, "general", coderSessionsDir);
    expect(codingSessions).toHaveLength(1);
    expect(codingSessions[0]?.path).toBe(archiveSessionPath(codingPlain));
    expect(chatSessions).toHaveLength(1);
    expect(chatSessions[0]?.path).toBe(archiveSessionPath(chatPlain));
  });
});

describe("stored sessions for Kleio's voice", () => {
  let tmp: string;
  let coderSessionsDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gg-stored-sessions-"));
    coderSessionsDir = path.join(tmp, "sessions");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function writeTranscript(
    root: string,
    cwd: string,
    id: string,
    at: string,
    records: object[],
    header: object = {},
  ): Promise<void> {
    const dir = path.join(root, encodeCwd(cwd));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}.jsonl`);
    const lines = [
      {
        type: "session",
        version: 2,
        id,
        conversationId: id,
        timestamp: at,
        cwd,
        provider: "anthropic",
        model: "claude-sonnet-5",
        ...header,
      },
      ...records,
    ];
    await fs.writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    await fs.utimes(file, new Date(at), new Date(at));
  }

  function message(
    id: string,
    parentId: string | null,
    role: string,
    content: unknown,
    extra: object = {},
  ): object {
    return {
      type: "message",
      id,
      parentId,
      timestamp: "2026-10-07T09:00:00.000Z",
      message: { role, content, ...extra },
    };
  }

  it("lists chats from every chat agent, or coding sessions, newest first", async () => {
    const projects = "/Users/me/projects";
    await writeTranscript(
      chatAgentSessionsDir(coderSessionsDir, "general"),
      projects,
      "chat-old",
      "2026-10-05T09:00:00.000Z",
      [message("m1", null, "user", "Plan a weekend in Bath")],
    );
    await writeTranscript(
      chatAgentSessionsDir(coderSessionsDir, "research"),
      projects,
      "chat-new",
      "2026-10-07T09:00:00.000Z",
      [message("m1", null, "user", "Research heat pumps")],
    );
    await writeTranscript(
      coderSessionsDir,
      `${projects}/app`,
      "code-1",
      "2026-10-06T09:00:00.000Z",
      [message("m1", null, "user", "Fix the login redirect")],
    );
    // Nothing said in it yet: not listed.
    await writeTranscript(
      coderSessionsDir,
      `${projects}/app`,
      "code-empty",
      "2026-10-07T10:00:00.000Z",
      [],
    );

    const chats = await listStoredSessions({ kind: "chat", coderSessionsDir });
    expect(chats.map((s) => [s.id, s.chatAgent, s.title])).toEqual([
      ["chat-new", "research", "Research heat pumps"],
      ["chat-old", "general", "Plan a weekend in Bath"],
    ]);
    expect(await listStoredSessions({ kind: "chat", coderSessionsDir, limit: 1 })).toHaveLength(1);
    expect(await listStoredSessions({ kind: "code", coderSessionsDir })).toEqual([
      {
        id: "code-1",
        kind: "code",
        title: "Fix the login redirect",
        cwd: `${projects}/app`,
        lastActivity: new Date("2026-10-06T09:00:00.000Z").toISOString(),
      },
    ]);
  });

  it("reads the active branch's prompts and replies, without tool calls or injected notes", async () => {
    await writeTranscript(
      coderSessionsDir,
      "/Users/me/projects/app",
      "code-1",
      "2026-10-07T09:00:00.000Z",
      [
        message("m1", null, "user", "Fix the login redirect"),
        message("m2", "m1", "assistant", [
          { type: "thinking", thinking: "Let me look." },
          { type: "text", text: "Looking at the router." },
          { type: "tool_call", id: "t1", name: "read", args: {} },
        ]),
        message("m3", "m2", "tool", [
          { type: "tool_result", toolCallId: "t1", content: "file contents" },
        ]),
        message("m4", "m3", "user", "[Background update] the build finished", {
          provenance: { source: "runtime", kind: "notification", visibility: "transcript" },
        }),
        message("m5", "m4", "assistant", [
          { type: "text", text: "Fixed: the redirect now keeps the query." },
        ]),
        // Rewound away from: no longer part of the conversation.
        message("m6", "m1", "assistant", [{ type: "text", text: "An abandoned answer." }]),
      ],
      { leafId: "m5" },
    );

    const read = await readStoredSession({ kind: "code", id: "code-1", coderSessionsDir });
    expect(read?.session).toMatchObject({
      id: "code-1",
      kind: "code",
      title: "Fix the login redirect",
    });
    expect(read?.messages).toEqual([
      { role: "user", text: "Fix the login redirect" },
      { role: "assistant", text: "Looking at the router." },
      { role: "assistant", text: "Fixed: the redirect now keeps the query." },
    ]);
    const latest = await readStoredSession({
      kind: "code",
      id: "code-1",
      coderSessionsDir,
      limit: 1,
    });
    expect(latest?.messages).toEqual([
      { role: "assistant", text: "Fixed: the redirect now keeps the query." },
    ]);
    // Only ids from that kind's listing; never a path.
    expect(await readStoredSession({ kind: "chat", id: "code-1", coderSessionsDir })).toBeNull();
    expect(
      await readStoredSession({ kind: "code", id: "../sessions/code-1", coderSessionsDir }),
    ).toBeNull();
  });
});

describe("deleteChatSession", () => {
  let tmp: string;
  let cwd: string;
  let coderSessionsDir: string;
  let chatDir: string;

  async function writeGeneration(name: string, conversationId: string): Promise<string> {
    const file = path.join(chatDir, `${name}.jsonl`);
    const header = { type: "session", version: 2, id: name, conversationId, cwd };
    await fs.writeFile(file, `${JSON.stringify(header)}\n`);
    return file;
  }

  async function exists(target: string): Promise<boolean> {
    return fs.lstat(target).then(
      () => true,
      () => false,
    );
  }

  beforeEach(async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "gg-chat-delete-")));
    cwd = path.join(tmp, "project");
    coderSessionsDir = path.join(tmp, "sessions");
    chatDir = path.join(chatAgentSessionsDir(coderSessionsDir, "general"), encodeCwd(cwd));
    await fs.mkdir(chatDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("deletes every generation of the conversation with its archive and assets", async () => {
    const older = await writeGeneration("gen-1", "conv-a");
    const newer = await writeGeneration("gen-2", "conv-a");
    const other = await writeGeneration("other", "conv-b");
    await fs.writeFile(archiveSessionPath(older), "gz");
    await fs.mkdir(`${older}.assets`);
    await fs.writeFile(path.join(`${older}.assets`, "img.png"), "x");
    await fs.mkdir(`${newer}.assets`);

    const result = await deleteChatSession({ path: newer, coderSessionsDir, openPaths: [] });

    expect(result).toEqual({ status: "ok", removed: 2 });
    for (const gone of [
      older,
      newer,
      archiveSessionPath(older),
      `${older}.assets`,
      `${newer}.assets`,
    ]) {
      expect(await exists(gone)).toBe(false);
    }
    expect(await exists(other)).toBe(true);
  });

  it("rejects paths outside the chat stores", async () => {
    await writeSessions(coderSessionsDir, cwd, "coding", 1);
    const coding = path.join(coderSessionsDir, encodeCwd(cwd), "coding-0.jsonl");
    const traversal = path.join(chatDir, "..", "..", "..", encodeCwd(cwd), "coding-0.jsonl");

    for (const candidate of [coding, traversal, "relative.jsonl", "", 42, `${chatDir}/x.txt`]) {
      const result = await deleteChatSession({ path: candidate, coderSessionsDir, openPaths: [] });
      expect(result.status).toBe("invalid");
    }
    expect(await exists(coding)).toBe(true);
  });

  it("rejects a symlinked folder that escapes the chat store", async () => {
    await writeSessions(coderSessionsDir, cwd, "coding", 1);
    const link = path.join(chatAgentSessionsDir(coderSessionsDir, "general"), "escape");
    await fs.symlink(path.join(coderSessionsDir, encodeCwd(cwd)), link);
    const result = await deleteChatSession({
      path: path.join(link, "coding-0.jsonl"),
      coderSessionsDir,
      openPaths: [],
    });
    expect(result.status).toBe("invalid");
    expect(await exists(path.join(coderSessionsDir, encodeCwd(cwd), "coding-0.jsonl"))).toBe(true);
  });

  it("refuses while any generation is open in a window", async () => {
    const older = await writeGeneration("gen-1", "conv-a");
    const newer = await writeGeneration("gen-2", "conv-a");

    const result = await deleteChatSession({ path: newer, coderSessionsDir, openPaths: [older] });

    expect(result).toEqual({
      status: "busy",
      message: "This chat is open in a window. Close it there first.",
    });
    expect(await exists(older)).toBe(true);
    expect(await exists(newer)).toBe(true);
  });

  it("treats an already-deleted chat as success", async () => {
    const missing = path.join(chatDir, "gone.jsonl");
    expect(await deleteChatSession({ path: missing, coderSessionsDir, openPaths: [] })).toEqual({
      status: "ok",
      removed: 0,
    });
  });
});
