import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  CHAT_AGENT_IDS,
  chatAgentSessionsDir,
  sessionsDirForChatAgent,
  type ChatAgentId,
} from "./chat-agents/index.js";
import {
  listForeignSessions,
  listRecentSessions,
  type RecentSession,
} from "./core/project-discovery.js";
import {
  isSessionPath,
  isSessionTempPath,
  openSessionReadStream,
  plainSessionPath,
  resolveSessionPath,
  sessionGroupPaths,
} from "./core/session-storage.js";
import { MOTION_SESSIONS_QUERY, motionSessionsDir } from "./motion-agent/motion-agent.js";

const CODING_SESSION_LIMIT = 5;
const CHAT_SESSION_LIMIT = 30;
const MOTION_SESSION_LIMIT = 30;
/** Foreign rows are additive, so keep them a short tail under the native list. */
const FOREIGN_SESSION_LIMIT = 5;

export type SidecarSession = RecentSession & { chatAgent?: ChatAgentId };

/**
 * List coding or chat sessions using the caps exposed by the gg-app sidecar.
 *
 * `homeDir` only exists so tests can point the Claude Code / Codex lookup at a
 * fixture home; production always uses the real one.
 */
export async function listSidecarSessions(
  cwd: string,
  requestedAgent: string | null,
  coderSessionsDir: string,
  homeDir?: string,
): Promise<SidecarSession[]> {
  if (requestedAgent === MOTION_SESSIONS_QUERY) {
    return listRecentSessions(cwd, MOTION_SESSION_LIMIT, motionSessionsDir(coderSessionsDir));
  }
  if (requestedAgent !== "all") {
    // Chat agents have their own private stores; only the coding list (no
    // requested agent) shares a cwd with Claude Code and Codex.
    if (requestedAgent) {
      return listRecentSessions(
        cwd,
        CHAT_SESSION_LIMIT,
        sessionsDirForChatAgent(coderSessionsDir, requestedAgent),
      );
    }
    return listCodingSessions(cwd, coderSessionsDir, homeDir);
  }

  const groups = await Promise.all(
    CHAT_AGENT_IDS.map(async (agentId) => {
      const sessions = await listRecentSessions(
        cwd,
        CHAT_SESSION_LIMIT,
        chatAgentSessionsDir(coderSessionsDir, agentId),
      );
      return sessions.map((session) => ({ ...session, chatAgent: agentId }));
    }),
  );
  const dated = await Promise.all(
    groups.flat().map(async (session) => ({
      session,
      mtime: await fs
        .stat(session.path)
        .then((stat) => stat.mtimeMs)
        .catch(() => 0),
    })),
  );
  return dated
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, CHAT_SESSION_LIMIT)
    .map(({ session }) => session);
}

/**
 * GG Coder's own sessions for this project plus any Claude Code / Codex
 * transcripts recorded against the same cwd.
 *
 * The project picker already surfaces those stores, so a project can appear
 * *because* it has Claude Code history and then show an empty session list.
 * Foreign rows close that gap; the app imports one on click and opens it.
 *
 * A foreign store being slow or unreadable must never empty the native list,
 * so its failure degrades to "no foreign rows".
 */
async function listCodingSessions(
  cwd: string,
  coderSessionsDir: string,
  homeDir?: string,
): Promise<SidecarSession[]> {
  const [native, foreign] = await Promise.all([
    listRecentSessions(cwd, CODING_SESSION_LIMIT, coderSessionsDir),
    listForeignSessions(cwd, FOREIGN_SESSION_LIMIT, homeDir).catch(() => []),
  ]);
  // Native first: a session already resumable here beats one that needs an
  // import, even when the foreign transcript is a little newer.
  return [...native, ...foreign];
}

export type DeleteChatResult =
  | { status: "ok"; removed: number }
  | { status: "invalid"; message: string }
  | { status: "busy"; message: string };

const OPEN_CHAT_MESSAGE = "This chat is open in a window. Close it there first.";
const INVALID_CHAT_MESSAGE = "Only saved chats can be deleted.";

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** First-line `conversationId` (falls back to the session id); null if unreadable. */
async function readConversationId(filePath: string): Promise<string | null> {
  let opened: Awaited<ReturnType<typeof openSessionReadStream>> | undefined;
  try {
    opened = await openSessionReadStream(filePath);
    const rl = readline.createInterface({ input: opened.stream, crlfDelay: Infinity });
    for await (const line of rl) {
      rl.close();
      const header = JSON.parse(line) as { type?: unknown; id?: unknown; conversationId?: unknown };
      if (header.type !== "session") return null;
      if (typeof header.conversationId === "string" && header.conversationId) {
        return header.conversationId;
      }
      return typeof header.id === "string" && header.id ? header.id : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    opened?.close();
  }
}

async function removePath(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
  } catch {
    return false;
  }
  await fs.rm(target, { recursive: true, force: true });
  return true;
}

/**
 * Permanently delete one chat conversation: every generation sharing the
 * row's `conversationId` in its encoded-cwd folder, their `.gz` / `.assets`
 * siblings, and redirect stubs that resolve to them. Only paths inside a
 * chat-agent store are accepted; a chat open in any live window is refused.
 * Deleting a chat that is already gone is a no-op success.
 */
export async function deleteChatSession(opts: {
  path: unknown;
  coderSessionsDir: string;
  /** Session paths currently open in live sidecar sessions. */
  openPaths: readonly string[];
}): Promise<DeleteChatResult> {
  const input = opts.path;
  if (
    typeof input !== "string" ||
    !input ||
    !path.isAbsolute(input) ||
    !isSessionPath(input) ||
    isSessionTempPath(input) ||
    input.split(/[\\/]/).includes("..")
  ) {
    return { status: "invalid", message: INVALID_CHAT_MESSAGE };
  }

  const roots = (
    await Promise.all(
      CHAT_AGENT_IDS.map((id) => realpathOrNull(chatAgentSessionsDir(opts.coderSessionsDir, id))),
    )
  ).filter((root): root is string => root !== null);
  const dir = path.dirname(input);
  const realDir = await realpathOrNull(dir);
  if (realDir === null) {
    // Folder already gone: fine if it would have been inside a chat store.
    const lexicalRoots = CHAT_AGENT_IDS.map((id) =>
      path.resolve(chatAgentSessionsDir(opts.coderSessionsDir, id)),
    );
    return lexicalRoots.some((root) => isInside(root, path.resolve(dir)))
      ? { status: "ok", removed: 0 }
      : { status: "invalid", message: INVALID_CHAT_MESSAGE };
  }
  // Store root itself or one encoded-cwd folder below it — nothing deeper.
  const inRoot = roots.some(
    (root) => realDir === root || (isInside(root, realDir) && path.dirname(realDir) === root),
  );
  if (!inRoot) return { status: "invalid", message: INVALID_CHAT_MESSAGE };

  const target = path.join(realDir, path.basename(input));
  const targetStat = await fs.lstat(target).catch(() => null);
  if (!targetStat) return { status: "ok", removed: 0 };
  if (!targetStat.isFile()) return { status: "invalid", message: INVALID_CHAT_MESSAGE };

  const conversationId = await readConversationId(target);
  if (!conversationId) return { status: "invalid", message: INVALID_CHAT_MESSAGE };

  // Every regular session file in the folder whose (redirect-resolved)
  // header belongs to this conversation. Stubs resolve to their target, so
  // they match too.
  const entries = await fs.readdir(realDir, { withFileTypes: true });
  const doomed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isSessionPath(entry.name) || isSessionTempPath(entry.name)) continue;
    const file = path.join(realDir, entry.name);
    if ((await readConversationId(file)) === conversationId) doomed.push(file);
  }
  const doomedPlain = new Set(doomed.map((file) => plainSessionPath(file)));

  for (const open of opts.openPaths) {
    if (!open) continue;
    const resolved = await resolveSessionPath(open).catch(() => path.resolve(open));
    const real = (await realpathOrNull(resolved)) ?? resolved;
    if (
      doomedPlain.has(plainSessionPath(real)) ||
      doomedPlain.has(plainSessionPath(path.resolve(open)))
    ) {
      return { status: "busy", message: OPEN_CHAT_MESSAGE };
    }
  }

  let removed = 0;
  for (const plain of doomedPlain) {
    const group = sessionGroupPaths(plain);
    const results = await Promise.all([
      removePath(group.plainPath),
      removePath(group.archivePath),
      removePath(group.assetsPath),
    ]);
    if (results.some(Boolean)) removed++;
  }
  return { status: "ok", removed };
}
