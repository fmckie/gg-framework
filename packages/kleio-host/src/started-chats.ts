// Chats the host starts on a device's behalf (`POST /kleio/chats`): the voice
// asks for research or a long piece of work, and it runs here on its own,
// in Kleio's projects folder, so it shows in every device's Chats list.
//
// Until a device opens it, the host manages it:
// - its run end sends a named nudge ("Research ready") when nobody watches;
// - a device opening it from Chats sends `POST /session { sessionPath }`.
//   adopt() answers with this live session instead of letting the sidecar
//   open a second one on the same transcript (two sessions writing one file).
//   From then on it is the device's like any other session;
// - a device removing it from Chats (`POST /sessions/delete { path }`) first
//   has release() dispose it, or the sidecar refuses ("open in a window");
// - left unopened, it is disposed 12 h after its run ended, and at most 8
//   idle ones are kept (oldest disposed first).
//
// In memory only: after a host restart these are ordinary sessions (still
// tracked, still in Chats; a device opening one gets a new sidecar session on
// its transcript, as for any chat). The sidecar does not reap idle sessions
// itself, which is why the 12 h disposal is here.

import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { Nudge } from "./apns.js";
import { field, MODEL_UNAVAILABLE, type SidecarCall } from "./pinned-thread.js";
import { err, ok, type Result } from "./result.js";

export type StartedChatAgent = "general" | "research";

export interface StartChatRequest {
  readonly prompt: string;
  readonly agent: StartedChatAgent;
}

/** A failed start: the HTTP status and `{ error, detail? }` body to answer with. */
export interface StartChatError {
  readonly status: 400 | 404 | 429 | 502;
  readonly body: { readonly error: string; readonly detail?: string };
}

export interface StartedChatsOptions {
  /** Kleio's projects folders; the first is the chat's cwd. Unset = the route is a 404. */
  readonly workspaceRoots?: () => Promise<string[]>;
  readonly call: SidecarCall;
  readonly track: (sessionId: string) => Promise<void>;
  readonly untrack: (sessionId: string) => Promise<void>;
  /** Note the new session's cwd and title, so it is named like a chat. */
  readonly remember: (sessionId: string, cwd: string, title: string) => void;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
  readonly idleMs?: number;
}

export interface StartedChats {
  start(req: StartChatRequest): Promise<Result<{ sessionId: string }, StartChatError>>;
  /**
   * A run ended on `sessionId`. For an unclaimed started chat: marks it idle
   * and returns the nudge to send when nobody was watching. Else null.
   */
  onRunEnd(sessionId: string, unwatched: boolean): Nudge | null;
  /** True while any unclaimed started chat exists (the proxy's fast path). */
  pending(): boolean;
  /**
   * A device's `POST /session` body: when its sessionPath is an unclaimed
   * started chat's transcript, claim that chat and return its id.
   */
  adopt(body: Buffer): Promise<string | null>;
  /**
   * A device's `POST /sessions/delete` body (`{ path }`). An idle unclaimed
   * started chat on that transcript is disposed first, so the sidecar's
   * "open in a window" check doesn't refuse; a running one is "running".
   */
  release(body: Buffer): Promise<"none" | "released" | "running">;
  stop(): void;
}

export const PROMPT_MAX = 4000;
export const MAX_RUNNING = 5;
export const MAX_IDLE = 8;
const IDLE_MS = 12 * 3600_000;
const TITLE_CLIP = 80;
const SUFFIX = "\n\n(Started by voice from Kleio.)";
const UNREACHABLE: StartChatError = { status: 502, body: { error: "sidecar unavailable" } };

const bad = (detail: string): Result<never, string> => err(detail);

/** The route's body, checked. err = the 400's detail. */
export function parseStartChat(raw: string): Result<StartChatRequest, string> {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return bad("body must be JSON");
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return bad("body must be an object");
  const { prompt, agent } = o as { prompt?: unknown; agent?: unknown };
  if (typeof prompt !== "string") return bad("prompt must be a string");
  const text = prompt.trim();
  if (!text) return bad("prompt is empty");
  if (text.length > PROMPT_MAX) return bad(`prompt is over ${PROMPT_MAX} characters`);
  if (agent !== undefined && agent !== "general" && agent !== "research")
    return bad('agent must be "general" or "research"');
  return ok({ prompt: text, agent: agent ?? "general" });
}

/** The prompt as a one-line title, clipped on a word boundary. */
export function chatTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (flat.length <= TITLE_CLIP) return flat;
  const cut = flat.slice(0, TITLE_CLIP);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_CLIP / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A transcript path as compared: absolute, without a trailing `.gz`. */
function samePath(p: string): string {
  return resolvePath(p.endsWith(".gz") ? p.slice(0, -3) : p);
}

interface StartedChat {
  readonly sessionId: string;
  readonly agent: StartedChatAgent;
  readonly title: string;
  readonly startedAt: number;
  running: boolean;
  idleSince: number;
  timer: NodeJS.Timeout | null;
}

export function createStartedChats(options: StartedChatsOptions): StartedChats {
  const log = options.log ?? ((): void => {});
  const now = (): number => (options.now?.() ?? new Date()).getTime();
  const idleMs = options.idleMs ?? IDLE_MS;
  const chats = new Map<string, StartedChat>();
  /** Starts between their cap check and their record, so a burst can't pass the cap. */
  let starting = 0;

  function drop(rec: StartedChat): void {
    if (rec.timer) clearTimeout(rec.timer);
    chats.delete(rec.sessionId);
  }

  async function dispose(rec: StartedChat, why: string): Promise<void> {
    drop(rec);
    await options.untrack(rec.sessionId);
    const r = await options.call("DELETE", `/session/${encodeURIComponent(rec.sessionId)}`);
    log(
      `[chats] disposed ${rec.sessionId} (${why}) -> ${r ? r.status : "unreachable"}, ${now() - rec.startedAt} ms after start`,
    );
  }

  /** The unclaimed started chat whose current transcript is `wanted`. */
  async function byTranscript(wanted: string | null): Promise<StartedChat | null> {
    if (!wanted) return null;
    const target = samePath(wanted);
    for (const rec of [...chats.values()]) {
      const st = await options.call("GET", "/state", { session: rec.sessionId });
      const path = st?.status === 200 ? field(st.body, "sessionPath") : null;
      // Skip one claimed or disposed while we asked.
      if (path && samePath(path) === target && chats.get(rec.sessionId) === rec) return rec;
    }
    return null;
  }

  async function create(
    agent: StartedChatAgent,
    cwd: string,
  ): Promise<Result<string, StartChatError>> {
    const r = await options.call("POST", "/session", {
      body: { mode: "chat", chatAgent: agent, cwd },
      timeoutMs: 60_000,
    });
    if (!r) return err(UNREACHABLE);
    const id = r.status === 200 ? field(r.body, "sessionId") : null;
    if (id) return ok(id);
    log(`[chats] POST /session -> ${r.status}`);
    if (r.status === 409)
      return err({
        status: 502,
        body: {
          error: MODEL_UNAVAILABLE,
          detail: field(r.body, "error") ?? "POST /session -> 409",
        },
      });
    return err({
      status: 502,
      body: { error: "sidecar error", detail: `POST /session -> ${r.status}` },
    });
  }

  async function startNow(
    req: StartChatRequest,
  ): Promise<Result<{ sessionId: string }, StartChatError>> {
    const roots = options.workspaceRoots ? await options.workspaceRoots() : [];
    const cwd = roots[0];
    if (!cwd) return err({ status: 404, body: { error: "not_found" } });
    await mkdir(cwd, { recursive: true });
    const made = await create(req.agent, cwd);
    if (!made.ok) return made;
    const sessionId = made.value;
    const title = chatTitle(req.prompt);
    options.remember(sessionId, cwd, title);
    // Tapped before the prompt, so the ring catches the first frames.
    await options.track(sessionId);
    const p = await options.call("POST", "/prompt", {
      session: sessionId,
      body: { text: `${req.prompt}${SUFFIX}` },
      timeoutMs: 30_000,
    });
    if (!p || p.status < 200 || p.status >= 300) {
      log(`[chats] prompting ${sessionId} -> ${p ? p.status : "unreachable"}; disposing`);
      await options.call("DELETE", `/session/${encodeURIComponent(sessionId)}`);
      await options.untrack(sessionId);
      return err(
        p
          ? { status: 502, body: { error: "sidecar error", detail: `POST /prompt -> ${p.status}` } }
          : UNREACHABLE,
      );
    }
    const at = now();
    chats.set(sessionId, {
      sessionId,
      agent: req.agent,
      title,
      startedAt: at,
      running: true,
      idleSince: 0,
      timer: null,
    });
    log(`[chats] started ${sessionId} agent=${req.agent}`);
    return ok({ sessionId });
  }

  return {
    async start(req) {
      const running = [...chats.values()].filter((c) => c.running).length + starting;
      if (running >= MAX_RUNNING)
        return err({
          status: 429,
          body: { error: "too_many", detail: `${MAX_RUNNING} started chats are still running` },
        });
      starting += 1;
      try {
        return await startNow(req);
      } finally {
        starting -= 1;
      }
    },

    onRunEnd(sessionId, unwatched) {
      const rec = chats.get(sessionId);
      if (!rec?.running) return null;
      rec.running = false;
      rec.idleSince = now();
      log(
        `[chats] ${sessionId} finished agent=${rec.agent} in ${rec.idleSince - rec.startedAt} ms`,
      );
      rec.timer = setTimeout(() => void dispose(rec, "idle").catch(() => {}), idleMs);
      rec.timer.unref();
      const idle = [...chats.values()]
        .filter((c) => !c.running)
        .sort((a, b) => a.idleSince - b.idleSince);
      for (const old of idle.slice(0, Math.max(0, idle.length - MAX_IDLE)))
        void dispose(old, "too many idle").catch(() => {});
      if (!unwatched) return null;
      return {
        sessionId,
        // The chat's name; the host adds how the run ended and its reply.
        kind: "finished",
        name: rec.title,
      };
    },

    pending: () => chats.size > 0,

    async adopt(body) {
      const rec = await byTranscript(field(body.toString("utf8"), "sessionPath"));
      if (!rec) return null;
      drop(rec);
      log(`[chats] ${rec.sessionId} claimed by a device`);
      return rec.sessionId;
    },

    async release(body) {
      const rec = await byTranscript(field(body.toString("utf8"), "path"));
      if (!rec) return "none";
      if (rec.running) return "running";
      await dispose(rec, "removed by a device");
      return "released";
    },

    stop() {
      for (const rec of chats.values()) if (rec.timer) clearTimeout(rec.timer);
    },
  };
}
