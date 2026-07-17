import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Message } from "@kleio/ai";
import { getManagerPaths } from "./manager-paths.js";

/**
 * Lightweight per-session log for the boss orchestrator. Each session is one
 * `<id>.jsonl` file under `~/.gg/boss/sessions/`, append-only, one Message per
 * line. Mirrors how ggcoder/AgentSession persists conversations — but kept
 * simple (no DAG / branches / project encoding) since the boss only ever has
 * one in-flight conversation per process.
 */

function getSessionsDir(): string {
  return getManagerPaths().sessionsDir;
}

export interface BossSessionInfo {
  id: string;
  path: string;
  createdAt: number;
  lastModified: number;
  messageCount: number;
  /** First user-message text — useful as a session title. */
  firstUserMessage?: string;
}

export async function ensureSessionsDir(): Promise<string> {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function createSession(): Promise<{ id: string; filePath: string }> {
  await ensureSessionsDir();
  // Time-prefixed id keeps sessions naturally chronological in `ls`.
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const filePath = path.join(getSessionsDir(), `${id}.jsonl`);
  await fs.writeFile(filePath, "", "utf-8");
  return { id, filePath };
}

export async function appendMessages(filePath: string, msgs: Message[]): Promise<void> {
  if (msgs.length === 0) return;
  const lines = msgs.map((m) => JSON.stringify(m)).join("\n") + "\n";
  await fs.appendFile(filePath, lines, "utf-8");
}

export async function loadSession(filePath: string): Promise<Message[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    const messages: Message[] = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line) as Message);
      } catch {
        // Skip corrupt lines rather than failing the whole resume.
      }
    }
    return messages;
  } catch {
    return [];
  }
}

async function inspectSession(filePath: string, id: string): Promise<BossSessionInfo | null> {
  try {
    const stat = await fs.stat(filePath);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    let firstUserMessage: string | undefined;
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as Message;
        if (msg.role === "user") {
          const text = typeof msg.content === "string" ? msg.content : "";
          if (text) {
            const cleaned = text.replace(/^\[scope:[^\]]+\]\s*/, "");
            firstUserMessage = cleaned.slice(0, 80);
            break;
          }
        }
      } catch {
        // skip
      }
    }
    return {
      id,
      path: filePath,
      createdAt: stat.birthtimeMs || stat.ctimeMs,
      lastModified: stat.mtimeMs,
      messageCount: lines.length,
      firstUserMessage,
    };
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<BossSessionInfo[]> {
  await ensureSessionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(getSessionsDir());
  } catch {
    return [];
  }
  const infos: BossSessionInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.replace(/\.jsonl$/, "");
    const info = await inspectSession(path.join(getSessionsDir(), name), id);
    if (info) infos.push(info);
  }
  infos.sort((a, b) => b.lastModified - a.lastModified);
  return infos;
}

export async function getMostRecent(): Promise<BossSessionInfo | null> {
  const all = await listSessions();
  return all[0] ?? null;
}

export async function getSessionById(id: string): Promise<BossSessionInfo | null> {
  const filePath = path.join(getSessionsDir(), `${id}.jsonl`);
  return inspectSession(filePath, id);
}
