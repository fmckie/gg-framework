// Saved chats and coding sessions, read-only, for Kleio's voice. The sidecar
// lists and reads them (GET /stored-sessions); this shapes its answers for a
// device: no folders beyond a project's name, and none of Kleio's own threads
// (home, Blobs, groups), which live in her folder and have their own routes.

import { basename } from "node:path";

export type SavedSessionKind = "chat" | "code";

export interface SavedSession {
  readonly id: string;
  readonly title: string;
  /** The chat agent, for chats other than General's (research, therapist…). */
  readonly agent?: string;
  /** The project folder's name, for coding sessions. */
  readonly project?: string;
  /** ISO time it was last active. */
  readonly lastActivity: string;
}

export interface SavedMessage {
  readonly from: "user" | "assistant";
  readonly text: string;
}

export interface SavedSessionRead extends SavedSession {
  /** The latest prompts and replies, oldest first. */
  readonly messages: readonly SavedMessage[];
}

/** Asked of the sidecar, so Kleio's own threads can be left out and still leave plenty. */
export const SIDECAR_LIST_LIMIT = 200;
/** Answered to a device. */
export const SAVED_LIST_MAX = 30;

/** A session id as the sidecar mints them: one plain path segment. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export function isSavedSessionKind(value: unknown): value is SavedSessionKind {
  return value === "chat" || value === "code";
}

export function isSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

interface Row {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly lastActivity: string;
  readonly chatAgent?: string;
}

function row(value: unknown): Row | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.title !== "string" ||
    typeof r.cwd !== "string" ||
    typeof r.lastActivity !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    title: r.title,
    cwd: r.cwd,
    lastActivity: r.lastActivity,
    ...(typeof r.chatAgent === "string" ? { chatAgent: r.chatAgent } : {}),
  };
}

function shown(r: Row, kind: SavedSessionKind): SavedSession {
  return {
    id: r.id,
    title: r.title,
    // A General chat is just a chat; other agents say what kind it is.
    ...(kind === "chat" && r.chatAgent && r.chatAgent !== "general" ? { agent: r.chatAgent } : {}),
    ...(kind === "code" ? { project: basename(r.cwd) } : {}),
    lastActivity: r.lastActivity,
  };
}

/** The sidecar's listing, newest first, without Kleio's own threads, at most `max`. */
export function savedSessionList(
  body: unknown,
  kind: SavedSessionKind,
  isKleios: (cwd: string) => boolean,
  max: number,
): SavedSession[] {
  const list =
    typeof body === "object" && body !== null ? (body as { sessions?: unknown }).sessions : null;
  if (!Array.isArray(list)) return [];
  const out: SavedSession[] = [];
  for (const value of list) {
    if (out.length >= max) break;
    const r = row(value);
    if (r && !isKleios(r.cwd)) out.push(shown(r, kind));
  }
  return out;
}

/** The sidecar's read of one session, or null when it's Kleio's own or unreadable. */
export function savedSessionRead(
  body: unknown,
  kind: SavedSessionKind,
  isKleios: (cwd: string) => boolean,
): SavedSessionRead | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { session?: unknown; messages?: unknown };
  const r = row(b.session);
  if (!r || isKleios(r.cwd)) return null;
  const messages: SavedMessage[] = [];
  for (const value of Array.isArray(b.messages) ? b.messages : []) {
    if (typeof value !== "object" || value === null) continue;
    const { role, text } = value as { role?: unknown; text?: unknown };
    if ((role === "user" || role === "assistant") && typeof text === "string" && text) {
      messages.push({ from: role, text });
    }
  }
  return { ...shown(r, kind), messages };
}
