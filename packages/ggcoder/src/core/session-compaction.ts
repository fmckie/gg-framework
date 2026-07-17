import crypto from "node:crypto";
import type { Message, Provider } from "@kleio/ai";
import type { SessionManager, MessageEntry } from "./session-manager.js";

export async function appendMessagesToSession(
  sessionManager: SessionManager,
  sessionPath: string,
  messages: readonly Message[],
  startIndex = 0,
): Promise<void> {
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") continue;
    const entry: MessageEntry = {
      type: "message",
      id: crypto.randomUUID(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: msg,
    };
    await sessionManager.appendEntry(sessionPath, entry);
  }
}

export async function createCompactedSessionCheckpoint(
  sessionManager: SessionManager,
  options: {
    cwd: string;
    provider: Provider;
    model: string;
    messages: readonly Message[];
  },
): Promise<{ path: string; id: string }> {
  const session = await sessionManager.create(options.cwd, options.provider, options.model);
  await appendMessagesToSession(sessionManager, session.path, options.messages, 0);
  return { path: session.path, id: session.id };
}

export function getRestoredMessagesForDisplay(messages: readonly Message[]): Message[] {
  return messages.filter((msg) => msg.role !== "system");
}

export function formatRestoreInfoText(originalCount: number, restoredCount: number): string {
  if (originalCount === restoredCount) {
    return `↻ Restored session (${originalCount} messages)`;
  }
  return `↻ Restored compacted session (${originalCount} → ${restoredCount} messages)`;
}
