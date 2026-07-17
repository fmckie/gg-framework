import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Message } from "@kleio/ai";

/**
 * Minimal session persistence for `ggeditor continue`.
 *
 * Each TUI run writes its rolling message buffer to ~/.gg/editor/last.json
 * after every turn. `ggeditor continue` reads this file and hydrates a new
 * Agent with the prior messages.
 *
 * No multi-session support yet — just "the most recent conversation". Pairs
 * with the `priorMessages` option added to gg-agent.
 */

export const SESSIONS_DIR = path.join(os.homedir(), ".gg", "editor");
export const LAST_SESSION_FILE = path.join(SESSIONS_DIR, "last.json");

export interface PersistedSession {
  /** Format version for future compatibility. */
  v: 1;
  /** ISO timestamp of the last update. */
  updatedAt: string;
  /** Provider used for this session. */
  provider: string;
  /** Model used for this session. */
  model: string;
  /** Working directory at start. */
  cwd: string;
  /** Host name in use ("resolve" / "premiere" / "none"). */
  host: string;
  /** Full message buffer EXCLUDING the system prompt. */
  messages: Message[];
}

export async function saveSession(
  snapshot: Omit<PersistedSession, "v" | "updatedAt">,
): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  const payload: PersistedSession = {
    v: 1,
    updatedAt: new Date().toISOString(),
    ...snapshot,
  };
  // Atomic write so an interrupted save doesn't leave a half-file.
  const tmp = `${LAST_SESSION_FILE}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tmp, LAST_SESSION_FILE);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function loadLastSession(): Promise<PersistedSession | null> {
  if (!existsSync(LAST_SESSION_FILE)) return null;
  const raw = await fs.readFile(LAST_SESSION_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw) as PersistedSession;
    if (parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function hasLastSession(): Promise<boolean> {
  return existsSync(LAST_SESSION_FILE);
}

/**
 * Drop the system message from a saved messages array. Saved sessions
 * intentionally exclude the system prompt (which gets rebuilt fresh per run
 * to reflect current host caps), but if a future format change includes it,
 * we strip it defensively.
 */
export function stripSystem(messages: Message[]): Message[] {
  return messages.filter((m) => m.role !== "system");
}
