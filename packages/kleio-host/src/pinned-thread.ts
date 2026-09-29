// A pinned conversation: one sidecar chat session that the host keeps for a
// purpose (the home thread, one per Blob) and hands out on request.
//
// - sessionId is the sidecar's in-memory id; it dies with the sidecar process.
// - sessionPath is the transcript on disk, and it survives: once the stored id
//   404s (the sidecar restarted), a new session is created with that
//   sessionPath, and the sidecar resumes the same conversation under a new id.
//   A transcript that is gone from disk, or that the sidecar refuses, costs
//   one fresh session — never a retry loop.
// - A brand-new session has no transcript until its first message is written
//   (/state says sessionPath ""), so the path is learnt when a run ends. It is
//   re-read at every run end, since compaction moves a conversation to a new
//   file. A known path is never replaced by an empty one.
//
// resolve() is serialised: calls that overlap share one in-flight answer, so
// two devices opening the app at once never create two sessions.
//
// Where the record lives is the caller's business (PinnedStore): home.json for
// the home thread, the Blob's entry in blobs.json for a Blob.

import { mkdir, stat } from "node:fs/promises";
import { err, ok, type Result } from "./result.js";

/** `GET /kleio/home` / `GET /kleio/blobs/:id/session` response body. */
export interface PinnedSession {
  readonly sessionId: string;
  /** Transcript on the host's disk; null until the first message is persisted. */
  readonly sessionPath: string | null;
  /** True when this call started a sidecar session (fresh, or resuming sessionPath). */
  readonly created: boolean;
  readonly agent: "general";
}

/** Error body (502): the proxy's `{ error, detail? }` shape. */
export interface PinnedSessionError {
  readonly error: string;
  readonly detail?: string;
}

/** A sidecar answer to a call the host makes on its own behalf. */
export interface SidecarReply {
  readonly status: number;
  readonly body: string;
}

/** null = the sidecar could not be reached. `session` goes in `x-gg-session`. */
export type SidecarCall = (
  method: string,
  path: string,
  opts?: { readonly session?: string; readonly body?: unknown; readonly timeoutMs?: number },
) => Promise<SidecarReply | null>;

export interface PinnedRecord {
  readonly sessionId?: string;
  readonly sessionPath: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Where a pinned thread's record lives. put() never rejects. */
export interface PinnedStore {
  get(): Promise<PinnedRecord | null>;
  put(next: PinnedRecord): Promise<void>;
}

export interface PinnedThreadOptions {
  /** Log tag, e.g. "home" or "blob b_1a2b3c4d". */
  readonly name: string;
  readonly store: PinnedStore;
  /** cwd of the session; created if missing. */
  readonly cwd: string;
  /** Extra `POST /session` fields (persona, model), read at every create. */
  readonly sessionFields?: () => Record<string, unknown>;
  readonly call: SidecarCall;
  readonly track: (sessionId: string) => Promise<void>;
  readonly untrack: (sessionId: string) => Promise<void>;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
}

export interface PinnedThread {
  resolve(): Promise<Result<PinnedSession, PinnedSessionError>>;
  /** Replace the conversation with a brand-new one; the old transcript stays on disk. */
  startNew(): Promise<Result<PinnedSession, PinnedSessionError>>;
  /** A run ended on `sessionId`: if it is this thread's, learn its transcript path. */
  onRunEnd(sessionId: string): Promise<void>;
  /**
   * Forget the live session (untrack it, dispose it on the sidecar) but keep
   * sessionPath, so the next resolve() resumes the same conversation with
   * whatever the session fields are by then. Returns the retired id.
   */
  retire(): Promise<string | null>;
}

const AGENT = "general";
const UNREACHABLE: PinnedSessionError = { error: "sidecar unavailable" };
export const MODEL_UNAVAILABLE = "model unavailable";
/** Creating a session starts MCP servers and builds the prompt; allow for it. */
const CREATE_TIMEOUT_MS = 60_000;

/** A non-empty string field of a JSON object body, else null. */
export function field(body: string, key: string): string | null {
  try {
    const v = (JSON.parse(body) as Record<string, unknown> | null)?.[key];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export function createPinnedThread(options: PinnedThreadOptions): PinnedThread {
  const log = options.log ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  const { store, name } = options;
  let resolving: Promise<Result<PinnedSession, PinnedSessionError>> | null = null;
  let starting: Promise<Result<PinnedSession, PinnedSessionError>> | null = null;

  /** Remember a newly learnt transcript path for the current session. */
  async function notePath(sessionId: string, path: string | null): Promise<void> {
    const rec = await store.get();
    if (!path || !rec || rec.sessionId !== sessionId || rec.sessionPath === path) return;
    log(`[${name}] transcript ${path}`);
    await store.put({ ...rec, sessionPath: path, updatedAt: now().toISOString() });
  }

  async function create(resume: string | null): Promise<Result<string, PinnedSessionError>> {
    const r = await options.call("POST", "/session", {
      body: {
        mode: "chat",
        chatAgent: AGENT,
        cwd: options.cwd,
        ...(resume ? { sessionPath: resume } : {}),
        ...options.sessionFields?.(),
      },
      timeoutMs: CREATE_TIMEOUT_MS,
    });
    if (!r) return err(UNREACHABLE);
    const id = r.status === 200 ? field(r.body, "sessionId") : null;
    if (id) return ok(id);
    log(`[${name}] POST /session -> ${r.status} ${r.body.slice(0, 200)}`);
    // The pinned model is unknown or blocked. The engine fails closed and so
    // do we: no fallback model, and no fresh-session retry that would drop the
    // transcript for nothing.
    if (r.status === 409)
      return err({
        error: MODEL_UNAVAILABLE,
        detail: field(r.body, "error") ?? `POST /session -> 409`,
      });
    return err({ error: "sidecar error", detail: `POST /session -> ${r.status}` });
  }

  async function resolveNow(): Promise<Result<PinnedSession, PinnedSessionError>> {
    const rec = await store.get();
    if (rec?.sessionId) {
      const sessionId = rec.sessionId;
      const st = await options.call("GET", "/state", { session: sessionId });
      if (!st) return err(UNREACHABLE);
      if (st.status === 200) {
        await options.track(sessionId);
        await notePath(sessionId, field(st.body, "sessionPath"));
        return ok({
          sessionId,
          sessionPath: (await store.get())?.sessionPath ?? null,
          created: false,
          agent: AGENT,
        });
      }
      if (st.status !== 404)
        return err({ error: "sidecar error", detail: `GET /state -> ${st.status}` });
      log(`[${name}] session ${sessionId} is gone from the sidecar; recreating`);
      await options.untrack(sessionId);
    }

    let resume = rec?.sessionPath ?? null;
    if (
      resume &&
      !(await stat(resume).then(
        () => true,
        () => false,
      ))
    ) {
      log(`[${name}] transcript ${resume} is gone; starting a fresh conversation`);
      resume = null;
    }
    await mkdir(options.cwd, { recursive: true });
    let made = await create(resume);
    if (
      !made.ok &&
      made.error !== UNREACHABLE &&
      made.error.error !== MODEL_UNAVAILABLE &&
      resume
    ) {
      log(`[${name}] sidecar refused to resume ${resume}; starting a fresh conversation`);
      resume = null;
      made = await create(null);
    }
    if (!made.ok) return made;
    const sessionId = made.value;
    await options.track(sessionId);
    const st = await options.call("GET", "/state", { session: sessionId });
    const sessionPath = (st?.status === 200 ? field(st.body, "sessionPath") : null) ?? resume;
    const at = now().toISOString();
    await store.put({
      sessionId,
      sessionPath,
      // A resumed transcript is the same conversation; only a fresh one is new.
      createdAt: resume && rec ? rec.createdAt : at,
      updatedAt: at,
    });
    log(`[${name}] ${resume ? `resumed ${resume} as` : "created"} session ${sessionId}`);
    return ok({ sessionId, sessionPath, created: true, agent: AGENT });
  }

  async function startNow(): Promise<Result<PinnedSession, PinnedSessionError>> {
    const old = (await store.get())?.sessionId ?? null;
    await mkdir(options.cwd, { recursive: true });
    const made = await create(null);
    if (!made.ok) return made;
    const sessionId = made.value;
    await options.track(sessionId);
    const st = await options.call("GET", "/state", { session: sessionId });
    const sessionPath = st?.status === 200 ? field(st.body, "sessionPath") : null;
    const at = now().toISOString();
    await store.put({ sessionId, sessionPath, createdAt: at, updatedAt: at });
    // The old conversation is finished with; stop recording it. Its sidecar
    // session is left alone (a reply may still be streaming to a device).
    if (old && old !== sessionId) await options.untrack(old);
    log(`[${name}] new conversation: session ${sessionId}${old ? ` replaces ${old}` : ""}`);
    return ok({ sessionId, sessionPath, created: true, agent: AGENT });
  }

  async function settled(): Promise<void> {
    await starting?.catch(() => {});
    await resolving?.catch(() => {});
  }

  return {
    resolve() {
      // A fresh conversation is on its way: hand out that one, not the one it replaces.
      if (starting) return starting;
      resolving ??= resolveNow().finally(() => {
        resolving = null;
      });
      return resolving;
    },
    startNew() {
      // Two taps (or two devices) at once make one new conversation, not two.
      starting ??= (async () => {
        await resolving?.catch(() => {});
        return startNow();
      })().finally(() => {
        starting = null;
      });
      return starting;
    },
    async onRunEnd(sessionId) {
      if ((await store.get())?.sessionId !== sessionId) return;
      const st = await options.call("GET", "/state", { session: sessionId });
      if (st?.status === 200) await notePath(sessionId, field(st.body, "sessionPath"));
    },
    async retire() {
      await settled();
      const rec = await store.get();
      if (!rec?.sessionId) return null;
      const { sessionId, ...rest } = rec;
      await store.put({ ...rest, updatedAt: now().toISOString() });
      await options.untrack(sessionId);
      const r = await options.call("DELETE", `/session/${encodeURIComponent(sessionId)}`);
      if (r?.status !== 200)
        log(`[${name}] disposing ${sessionId}: ${r ? r.status : "unreachable"}`);
      log(`[${name}] retired session ${sessionId}`);
      return sessionId;
    },
  };
}
