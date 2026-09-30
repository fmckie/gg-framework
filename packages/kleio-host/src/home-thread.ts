// The home thread: one pinned, persistent assistant conversation that every
// paired device opens (`GET /kleio/home`).
//
// To the sidecar it is an ordinary chat session (`mode: "chat"`, `chatAgent:
// "general"`, cwd `homeCwd`). What makes it "home" lives here, in `home.json`
// next to sessions.json: { sessionId, sessionPath, createdAt, updatedAt }.
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

import { mkdir, readFile, stat } from "node:fs/promises";
import { atomicWrite } from "./device-registry.js";
import { err, ok, type Result } from "./result.js";

/** `GET /kleio/home` response body. */
export interface HomeThread {
  readonly sessionId: string;
  /** Transcript on the host's disk; null until the first message is persisted. */
  readonly sessionPath: string | null;
  /** True when this call started a sidecar session (fresh, or resuming sessionPath). */
  readonly created: boolean;
  readonly agent: "general";
}

/** `GET /kleio/home` error body (502): the proxy's `{ error, detail? }` shape. */
export interface HomeThreadError {
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

export interface HomeThreadOptions {
  /** home.json. */
  readonly statePath: string;
  /** cwd of the home session; created if missing. */
  readonly cwd: string;
  readonly call: SidecarCall;
  readonly track: (sessionId: string) => Promise<void>;
  readonly untrack: (sessionId: string) => Promise<void>;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
}

export interface HomeThreads {
  /** Read home.json (once). Returns the stored session id, for resubscription. */
  load(): Promise<string | null>;
  /** The home session id as last recorded (after load()), else null. */
  sessionId(): string | null;
  resolve(): Promise<Result<HomeThread, HomeThreadError>>;
  /**
   * Replace the home thread with a brand-new conversation (the phone's "new
   * conversation" button). The old transcript stays on disk; durable memory
   * and Jiwa carry over because they are not per-session.
   */
  startNew(): Promise<Result<HomeThread, HomeThreadError>>;
  /** A run ended on `sessionId`: if it is home, learn its transcript path. */
  onRunEnd(sessionId: string): Promise<void>;
  /** Settles once every home.json write started so far has landed. */
  flush(): Promise<void>;
}

interface HomeRecord {
  readonly sessionId?: string;
  readonly sessionPath: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const AGENT = "general";
const UNREACHABLE: HomeThreadError = { error: "sidecar unavailable" };
/** Creating a session starts MCP servers and builds the prompt; allow for it. */
const CREATE_TIMEOUT_MS = 60_000;

/** A non-empty string field of a JSON object body, else null. */
function field(body: string, key: string): string | null {
  try {
    const v = (JSON.parse(body) as Record<string, unknown> | null)?.[key];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function parseRecord(raw: string): HomeRecord | null {
  const r = JSON.parse(raw) as unknown;
  if (typeof r !== "object" || r === null) return null;
  const o = r as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  const at = str(o.createdAt) ?? new Date(0).toISOString();
  const sessionId = str(o.sessionId);
  return {
    ...(sessionId ? { sessionId } : {}),
    sessionPath: str(o.sessionPath) ?? null,
    createdAt: at,
    updatedAt: str(o.updatedAt) ?? at,
  };
}

export function createHomeThreads(options: HomeThreadOptions): HomeThreads {
  const log = options.log ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  let record: HomeRecord | null = null;
  let loading: Promise<void> | null = null;
  let resolving: Promise<Result<HomeThread, HomeThreadError>> | null = null;
  let starting: Promise<Result<HomeThread, HomeThreadError>> | null = null;

  function current(): Promise<HomeRecord | null> {
    loading ??= readFile(options.statePath, "utf8").then(
      (raw) => {
        try {
          record = parseRecord(raw);
        } catch (e) {
          log(`[home] ignoring unreadable ${options.statePath}: ${String(e)}`);
        }
      },
      () => {
        /* first start */
      },
    );
    return loading.then(() => record);
  }

  // One home.json write at a time, each with the record as it is when its turn
  // comes, like sessions.json.
  let writes: Promise<void> = Promise.resolve();
  function save(next: HomeRecord): Promise<void> {
    record = next;
    const p = writes
      .catch(() => {})
      .then(() => atomicWrite(options.statePath, `${JSON.stringify(record)}\n`, 0o600));
    writes = p;
    return p.catch((e) => log(`[home] writing ${options.statePath} failed: ${String(e)}`));
  }

  /** Remember a newly learnt transcript path for the current home session. */
  function notePath(sessionId: string, path: string | null): Promise<void> {
    const rec = record;
    if (!path || !rec || rec.sessionId !== sessionId || rec.sessionPath === path)
      return Promise.resolve();
    log(`[home] transcript ${path}`);
    return save({ ...rec, sessionPath: path, updatedAt: now().toISOString() });
  }

  async function create(resume: string | null): Promise<Result<string, HomeThreadError>> {
    const r = await options.call("POST", "/session", {
      body: {
        mode: "chat",
        chatAgent: AGENT,
        cwd: options.cwd,
        ...(resume ? { sessionPath: resume } : {}),
      },
      timeoutMs: CREATE_TIMEOUT_MS,
    });
    if (!r) return err(UNREACHABLE);
    const id = r.status === 200 ? field(r.body, "sessionId") : null;
    if (id) return ok(id);
    log(`[home] POST /session -> ${r.status} ${r.body.slice(0, 200)}`);
    return err({ error: "sidecar error", detail: `POST /session -> ${r.status}` });
  }

  async function resolveNow(): Promise<Result<HomeThread, HomeThreadError>> {
    const rec = await current();
    if (rec?.sessionId) {
      const sessionId = rec.sessionId;
      const st = await options.call("GET", "/state", { session: sessionId });
      if (!st) return err(UNREACHABLE);
      if (st.status === 200) {
        await options.track(sessionId);
        await notePath(sessionId, field(st.body, "sessionPath"));
        return ok({
          sessionId,
          sessionPath: record?.sessionPath ?? null,
          created: false,
          agent: AGENT,
        });
      }
      if (st.status !== 404)
        return err({ error: "sidecar error", detail: `GET /state -> ${st.status}` });
      log(`[home] session ${sessionId} is gone from the sidecar; recreating`);
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
      log(`[home] transcript ${resume} is gone; starting a fresh home thread`);
      resume = null;
    }
    await mkdir(options.cwd, { recursive: true });
    let made = await create(resume);
    if (!made.ok && made.error !== UNREACHABLE && resume) {
      log(`[home] sidecar refused to resume ${resume}; starting a fresh home thread`);
      resume = null;
      made = await create(null);
    }
    if (!made.ok) return made;
    const sessionId = made.value;
    await options.track(sessionId);
    const st = await options.call("GET", "/state", { session: sessionId });
    const sessionPath = (st?.status === 200 ? field(st.body, "sessionPath") : null) ?? resume;
    const at = now().toISOString();
    await save({
      sessionId,
      sessionPath,
      // A resumed transcript is the same conversation; only a fresh one is new.
      createdAt: resume && rec ? rec.createdAt : at,
      updatedAt: at,
    });
    log(`[home] ${resume ? `resumed ${resume} as` : "created"} session ${sessionId}`);
    return ok({ sessionId, sessionPath, created: true, agent: AGENT });
  }

  async function startNow(): Promise<Result<HomeThread, HomeThreadError>> {
    const old = (await current())?.sessionId ?? null;
    await mkdir(options.cwd, { recursive: true });
    const made = await create(null);
    if (!made.ok) return made;
    const sessionId = made.value;
    await options.track(sessionId);
    const st = await options.call("GET", "/state", { session: sessionId });
    const sessionPath = st?.status === 200 ? field(st.body, "sessionPath") : null;
    const at = now().toISOString();
    await save({ sessionId, sessionPath, createdAt: at, updatedAt: at });
    // The old conversation is finished with; stop recording it. Its sidecar
    // session is left alone (a reply may still be streaming to a device).
    if (old && old !== sessionId) await options.untrack(old);
    log(`[home] new conversation: session ${sessionId}${old ? ` replaces ${old}` : ""}`);
    return ok({ sessionId, sessionPath, created: true, agent: AGENT });
  }

  return {
    load: () => current().then((r) => r?.sessionId ?? null),
    sessionId: () => record?.sessionId ?? null,
    resolve() {
      // A fresh home is on its way: hand out that one, not the one it replaces.
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
      if ((await current())?.sessionId !== sessionId) return;
      const st = await options.call("GET", "/state", { session: sessionId });
      if (st?.status === 200) await notePath(sessionId, field(st.body, "sessionPath"));
    },
    flush: () => writes.catch(() => {}),
  };
}
