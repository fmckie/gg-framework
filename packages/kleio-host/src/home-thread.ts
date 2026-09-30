// The home thread: one pinned, persistent assistant conversation that every
// paired device opens (`GET /kleio/home`).
//
// To the sidecar it is an ordinary chat session (`mode: "chat"`, `chatAgent:
// "general"`, cwd `homeCwd`). What makes it "home" lives here, in `home.json`
// next to sessions.json: { sessionId, sessionPath, createdAt, updatedAt }.
// The resolve / resume / fresh-on-failure / new-conversation rules are the
// pinned thread's (pinned-thread.ts), shared with Blob conversations.

import { readFile } from "node:fs/promises";
import { atomicWrite } from "./device-registry.js";
import {
  createPinnedThread,
  type PinnedRecord,
  type PinnedSession,
  type PinnedSessionError,
  type SidecarCall,
  sessionIdle,
} from "./pinned-thread.js";
import type { Result } from "./result.js";

export type { SidecarCall, SidecarReply } from "./pinned-thread.js";

/** `GET /kleio/home` response body. */
export type HomeThread = PinnedSession;

/** `GET /kleio/home` error body (502): the proxy's `{ error, detail? }` shape. */
export type HomeThreadError = PinnedSessionError;

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
  /**
   * Retire the live home session unless it is mid-run, so the next open
   * resumes the transcript with the current MCP tools. True when retired.
   */
  retireIdle(): Promise<boolean>;
  /** Settles once every home.json write started so far has landed. */
  flush(): Promise<void>;
}

function parseRecord(raw: string): PinnedRecord | null {
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
  let record: PinnedRecord | null = null;
  let loading: Promise<void> | null = null;

  function current(): Promise<PinnedRecord | null> {
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
  function save(next: PinnedRecord): Promise<void> {
    record = next;
    const p = writes
      .catch(() => {})
      .then(() => atomicWrite(options.statePath, `${JSON.stringify(record)}\n`, 0o600));
    writes = p;
    return p.catch((e) => log(`[home] writing ${options.statePath} failed: ${String(e)}`));
  }

  const thread = createPinnedThread({
    name: "home",
    store: { get: current, put: save },
    cwd: options.cwd,
    call: options.call,
    track: options.track,
    untrack: options.untrack,
    log,
    ...(options.now ? { now: options.now } : {}),
  });

  return {
    load: () => current().then((r) => r?.sessionId ?? null),
    sessionId: () => record?.sessionId ?? null,
    resolve: () => thread.resolve(),
    startNew: () => thread.startNew(),
    onRunEnd: (sessionId) => thread.onRunEnd(sessionId),
    async retireIdle() {
      const sid = (await current())?.sessionId;
      if (!sid || !(await sessionIdle(options.call, sid))) return false;
      return (await thread.retire()) !== null;
    },
    flush: () => writes.catch(() => {}),
  };
}
