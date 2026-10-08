// The Kleio host HTTP server.
//
// Listens on loopback only; Tailscale Serve terminates TLS and applies tailnet
// ACLs in front. Every request is one of:
//   - unauthenticated: GET /kleio/health, POST /kleio/pair/redeem
//   - device-authenticated (x-kleio-device-token): everything under the
//     sidecar's API, proxied with Host rewritten to loopback and x-gg-token
//     added; plus GET /events, which is intercepted for id/replay, and
//     GET /kleio/home, the pinned home thread (see home-thread.ts);
//     POST /kleio/home/new starts a fresh one. POST /kleio/chats starts a
//     chat that works on its own in Kleio's projects folder (voice's
//     start_chat, see started-chats.ts). /kleio/projects lists, tells,
//     makes and starts coding work in her projects (the voice's, see
//     projects.ts). /kleio/blobs/* and
//     GET /kleio/models, the Blobs (see blobs.ts). An agent's files:
//     GET /kleio/blobs/:id/files/*, /kleio/groups/:gid/members/:bid/files/*
//     and /kleio/workspace/files/*?cwd= (Chat/Code, see files.ts), always as
//     downloads; POST /kleio/previews mints a link to an agent-written web
//     page on the preview origin.
//
// The preview origin (preview.ts) is a second loopback listener on its own
// port, so its own browser origin. It serves only GET /p/<token>/<path>,
// sandboxed, and never reads a device token or reaches this API.
//   - admin (device is admin OR a valid control macaroon): /kleio/devices,
//     /kleio/devices/:id/revoke, /kleio/pair/offer, /kleio/pair/revoke.
//
// The sidecar's Host allowlist is satisfied because we always send
// `127.0.0.1:<port>`.
//
// The sidecar is the fork's, not stock gg-app's. Kleio relies on two engine
// changes the fork carries outside Kleio's own directories:
//   - persisted routines: the engine's `src/routines.ts` and the sidecar's
//     `/routines` routes, so schedules run with no window open;
//   - `GG_APP_HEADLESS=1` (set by this package's cli.ts): the engine's
//     `core/project-discovery.ts` then skips
//     macOS privacy prompts nobody is there to click.
// Whether each goes upstream or stays a named touch point is P3 in
// kleio-next/.gg/plans/step8-revised.md.

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve as resolvePath, sep } from "node:path";
import { atomicWrite } from "./device-registry.js";
import { formatPairCode, PAIR_REDEEM_MAX_BODY_BYTES, type PairingPayload } from "./pair-code.js";
import type { PairOfferStore } from "./pair-offer.js";
import type { DeviceRegistry, PairedDevice, PushRegistration } from "./device-registry.js";
import type { ApnsPusher, Nudge } from "./apns.js";
import { createReplyTracker, noticeFor, type NoticeInput } from "./notification-copy.js";
import { createBlobs, DEFAULT_BLOB_MODEL, type Blobs } from "./blobs.js";
import { createConnections } from "./connections.js";
import {
  contentDisposition,
  fileContentType,
  realRoots,
  resolveAgentFile,
  resolveWorkspaceDir,
  type AgentFile,
  type AgentFileError,
} from "./files.js";
import {
  createTextCache,
  isReadable,
  listFolder,
  MAX_READ_BYTES,
  newestFirst,
  partOf,
  sessionFiles,
  toEntry,
  walkable,
  type AgentFileEntry,
  type FoundFile,
} from "./agent-files.js";
import { jevRouter } from "./group-router.js";
import { createGroups, type GroupRouter, type Groups } from "./groups.js";
import { createJev, readKeyFile } from "./jev.js";
import { createStartedChats, parseStartChat } from "./started-chats.js";
import {
  isSavedSessionKind,
  isSessionId,
  SAVED_LIST_MAX,
  SIDECAR_LIST_LIMIT,
  savedRows,
  savedSessionList,
  savedSessionRead,
  type SavedMessage,
} from "./saved-sessions.js";
import {
  createProject,
  findProject,
  isProjectName,
  newestSession,
  parseNewProject,
  parseStartCode,
  projectDocAt,
  projectDocs,
  projectFolders,
  projectStatus,
  projectSummaries,
  STATUS_DOCS_MAX,
  type CodeJob,
  type ProjectFolder,
  type ProjectScan,
} from "./projects.js";
import { createHomeThreads, type SidecarCall, type SidecarReply } from "./home-thread.js";
import { createAskNotifier } from "./ask-push.js";
import { createBriefing, type BriefJob } from "./brief.js";
import {
  createVoice,
  isBrainToolName,
  isSpeed,
  isVoiceName,
  parseBrain,
  SDP_MAX,
  voiceErrorDetail,
  voiceErrorStatus,
  voiceInstructions,
} from "./voice.js";
import {
  createLiveActivityTracker,
  type LiveAlertText,
  type LiveAttributes,
  type SidecarFrame,
} from "./live-activity.js";
import { clipText, TITLE_MAX } from "./live-text.js";
import type { RingStore, SessionRing } from "./sse-ring.js";
import { readSidecarEndpoint, type SidecarEndpoint } from "./sidecar.js";
import * as macaroon from "./macaroon.js";
import { sendFile } from "./send-file.js";
import { createPreviewServer, createPreviewStore, type PreviewStore } from "./preview.js";
import { err, ok, type Result } from "./result.js";

/** Frame types that change a Live Activity (see live-activity.ts). */
const LIVE_FRAME_RE =
  /"type":"(run_start|tool_call_start|tool_call_end|ask_user|ask_user_done|run_end)"/;

export const DEVICE_TOKEN_HEADER = "x-kleio-device-token";
export const CONTROL_HEADER = "x-kleio-control";

export interface HostOptions {
  readonly listenHost?: string;
  readonly listenPort: number;
  /** Public base the host tells devices to use, e.g. https://mini.tailnet.ts.net:8443 */
  readonly publicBaseUrl: string;
  /** Tailnet host name, used as the macaroon node caveat. */
  readonly nodeId: string;
  readonly registry: DeviceRegistry;
  readonly offers: PairOfferStore;
  readonly rings: RingStore;
  /** Endpoint file published by the sidecar supervisor. */
  readonly sidecarEndpointPath: string;
  /** Root key for control macaroons (admin pairing). */
  readonly controlRootKey: string;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
  /**
   * How often to ask the sidecar for routine sessions (ms). Routines fire with
   * no client attached, so their sessions are never created through the proxy;
   * this poll is how the ring learns of them. A routine's first run is at least
   * a minute out, so 30 s never misses a frame. 0 disables.
   */
  readonly routinePollMs?: number;
  /** APNs nudge sender. Unconfigured = no-op. */
  readonly apns?: ApnsPusher;
  /**
   * Where `POST /kleio/diagnostics` appends device crash/hang reports
   * (`diagnostics.jsonl`, one JSON object per line, stamped with the device).
   * Unset = the route answers 404.
   */
  readonly diagnosticsDir?: string;
  /**
   * cwd of the home thread (`GET /kleio/home`); created if missing. The CLI
   * passes `KLEIO_HOME_CWD`, default `~/Kleio`. Unset = the route answers 404.
   */
  readonly homeCwd?: string;
  /**
   * Kleio's projects folders, where Chat and Code sessions run
   * (`GET /kleio/workspace/files/<path>?cwd=`). Called on each request so a
   * moved folder is followed. The CLI passes readWorkspaceRoots. Unset = the
   * route answers 404.
   */
  readonly workspaceRoots?: () => Promise<string[]>;
  /**
   * Port of the static-site preview origin (see preview.ts), on `listenHost`.
   * Its own port, so its own browser origin; Tailscale Serve fronts it like
   * the API. The CLI passes `KLEIO_PREVIEW_PORT`, default 8444. Unset = no
   * preview server, and `POST /kleio/previews` answers 404.
   */
  readonly previewPort?: number;
  /**
   * Public base of the preview origin, e.g. https://mini.tailnet.ts.net:8444.
   * Default: http://<listenHost>:<bound preview port>, for tests and local use.
   */
  readonly previewBaseUrl?: string;
  /**
   * Model of a Blob whose `model` is null. The CLI passes
   * `KLEIO_BLOB_DEFAULT_MODEL`; default DEFAULT_BLOB_MODEL.
   */
  readonly blobDefaultModel?: string;
  /** How often the Blob scheduler looks for a due schedule (ms). 0 disables. Default 5 s. */
  readonly blobTickMs?: number;
  /** How long one Blob's turn in a group chat may run (default 30 minutes). */
  readonly groupTurnTimeoutMs?: number;
  /**
   * App connections (Composio). Absent = the routes answer "not set up".
   * `keyPath` defaults to <state dir>/composio.key; `ggHome` to ~/.gg.
   */
  readonly composio?: {
    readonly apiKey?: string;
    readonly keyPath?: string;
    readonly baseUrl?: string;
    readonly ggHome?: string;
    readonly fetch?: typeof fetch;
  };
  /**
   * Kleio's conversational voice (OpenAI Realtime, voice.ts). The key is set
   * from an admin device's Settings; `keyPath` defaults to
   * <state dir>/openai.key.
   */
  readonly voice?: {
    readonly apiKey?: string;
    readonly keyPath?: string;
    readonly model?: string;
    readonly baseUrl?: string;
    readonly fetch?: typeof fetch;
  };
  /**
   * Jev (Typesafe), the group chats' router and job-complete checker. Without
   * a key, groups route by relevance. `keyPath` defaults to
   * <state dir>/typesafe.key.
   */
  readonly jev?: {
    readonly apiKey?: string;
    readonly keyPath?: string;
    readonly baseUrl?: string;
    readonly fetch?: typeof fetch;
  };
  /** Test seam: replaces the Jev router. */
  readonly groupRouter?: GroupRouter;
}

export interface Host {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly server: Server;
  /** The preview origin's server; null when `previewPort` is unset. */
  readonly previewServer: Server | null;
}

type Auth = { readonly device: PairedDevice; readonly admin: boolean };

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": data.length,
    "cache-control": "no-store",
  });
  res.end(data);
}

/** `GET /kleio/blobs/:blobId/files/<path>`; the remainder stays percent-encoded. */
const BLOB_FILE_RE = /^\/kleio\/blobs\/(b_[0-9a-f]{8})\/files\//;
/** `GET /kleio/groups/:groupId/members/:blobId/files/<path>`. */
const MEMBER_FILE_RE = /^\/kleio\/groups\/(g_[0-9a-f]{8})\/members\/(b_[0-9a-f]{8})\/files\//;
/** `GET /kleio/workspace/files/<path>?cwd=<absolute host path>`: a Chat or Code session's files. */
const WORKSPACE_FILE_PREFIX = "/kleio/workspace/files/";
const BLOB_ID_RE = /^b_[0-9a-f]{8}$/;
const GROUP_ID_RE = /^g_[0-9a-f]{8}$/;

/** The owner in a `POST /kleio/previews` body, or null when it is malformed. */
function parseFileOwner(v: unknown): FileOwner | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "blob" && typeof o.blobId === "string" && BLOB_ID_RE.test(o.blobId))
    return { kind: "blob", blobId: o.blobId };
  if (
    o.kind === "group" &&
    typeof o.groupId === "string" &&
    GROUP_ID_RE.test(o.groupId) &&
    typeof o.blobId === "string" &&
    BLOB_ID_RE.test(o.blobId)
  )
    return { kind: "group", groupId: o.groupId, blobId: o.blobId };
  if (o.kind === "workspace" && typeof o.cwd === "string") return { kind: "workspace", cwd: o.cwd };
  return null;
}

/** Whether `dir` is `root` or holds it: a preview of `dir` would expose all of `root`. */
function holds(dir: string, root: string): boolean {
  return root === dir || root.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

/** Whose files list_files / read_file look at. */
type FilesSource = "kleio" | "specialist" | "group" | "chat" | "code" | "project";
const FILES_SOURCES: ReadonlySet<string> = new Set([
  "kleio",
  "specialist",
  "group",
  "chat",
  "code",
  "project",
]);
/** Kleio's top-level folders that belong to other owners (her Blobs and groups). */
const KLEIO_OTHERS: ReadonlySet<string> = new Set(["blobs", "groups"]);
/** Longest relative path read_file accepts. */
const MAX_READ_PATH = 1024;
/** Highest part read_file accepts (20 MB of text is well under this many parts). */
const MAX_PART = 100_000;

function isFilesSource(v: unknown): v is FilesSource {
  return typeof v === "string" && FILES_SOURCES.has(v);
}

/** A voice files route's failure: the status and body to answer with. */
interface FilesFailure {
  readonly status: number;
  readonly error: string;
  readonly parts?: number;
}

function filesFail(status: number, error: string): Result<never, FilesFailure> {
  return err({ status, error });
}

/** A validated POST /kleio/voice/files/read body. */
interface FileReadRequest {
  readonly source: FilesSource;
  readonly id: string | null;
  readonly member: string | null;
  readonly path: string;
  readonly part: number;
}

function parseFileRead(v: unknown): FileReadRequest | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isFilesSource(o.source)) return null;
  if (o.id !== undefined && typeof o.id !== "string") return null;
  if (o.member !== undefined && typeof o.member !== "string") return null;
  if (typeof o.path !== "string" || o.path.length === 0 || o.path.length > MAX_READ_PATH)
    return null;
  const part = o.part === undefined ? 1 : o.part;
  if (typeof part !== "number" || !Number.isInteger(part) || part < 1 || part > MAX_PART)
    return null;
  return {
    source: o.source,
    id: typeof o.id === "string" ? o.id : null,
    member: typeof o.member === "string" ? o.member : null,
    path: o.path,
    part,
  };
}

/** Whose files: a Blob, a Blob in a group, or a Chat/Code session's folder. */
export type FileOwner =
  | { readonly kind: "blob"; readonly blobId: string }
  | { readonly kind: "group"; readonly groupId: string; readonly blobId: string }
  | { readonly kind: "workspace"; readonly cwd: string };

/** Where an owner's files live; `workspaceRoot` is set for a workspace owner. */
interface OwnerRoot {
  readonly root: string;
  readonly workspaceRoot?: string;
}

/**
 * The owner a file route names, and the still percent-encoded path after it;
 * null when `path` is not a file route.
 */
function fileOwnerOf(
  path: string,
  query: URLSearchParams,
): { readonly owner: FileOwner; readonly rest: string } | null {
  const blobFile = BLOB_FILE_RE.exec(path);
  if (blobFile)
    return {
      owner: { kind: "blob", blobId: blobFile[1] ?? "" },
      rest: path.slice(blobFile[0].length),
    };
  const memberFile = MEMBER_FILE_RE.exec(path);
  if (memberFile)
    return {
      owner: { kind: "group", groupId: memberFile[1] ?? "", blobId: memberFile[2] ?? "" },
      rest: path.slice(memberFile[0].length),
    };
  if (path.startsWith(WORKSPACE_FILE_PREFIX))
    return {
      owner: { kind: "workspace", cwd: query.get("cwd") ?? "" },
      rest: path.slice(WORKSPACE_FILE_PREFIX.length),
    };
  return null;
}

/** How a file request's owner appears in the log; a cwd is quoted so it stays one line. */
function ownerLabel(owner: FileOwner): string {
  switch (owner.kind) {
    case "blob":
      return owner.blobId;
    case "group":
      return `${owner.groupId}/${owner.blobId}`;
    case "workspace":
      return `workspace ${JSON.stringify(owner.cwd.slice(0, 200))}`;
  }
}

/** The HTTP answer for a file that resolveAgentFile refused. */
function fileErrorStatus(e: AgentFileError): [number, string] {
  return e.kind === "bad_path"
    ? [400, "bad path"]
    : e.kind === "too_large"
      ? [413, "file too large"]
      : [404, "no such file"];
}

/** Stream a resolved agent file as a download (see send-file.ts). Returns [status, bytes]. */
function sendAgentFile(res: ServerResponse, file: AgentFile): Promise<[number, number]> {
  return sendFile(res, file, {
    headers: {
      "content-type": fileContentType(file.name),
      "last-modified": new Date(file.mtimeMs).toUTCString(),
      etag: `"${file.size}-${Math.trunc(file.mtimeMs)}"`,
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-disposition": contentDisposition(file.name),
    },
    missing: (r) => json(r, 404, { error: "no such file" }),
  });
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

export function createHost(options: HostOptions): Host {
  const log = options.log ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  const { registry, offers, rings } = options;
  // The static-site preview origin (preview.ts): tokens minted here, served there.
  const previews: PreviewStore | null =
    options.previewPort === undefined
      ? null
      : createPreviewStore({
          deviceActive: (id) => registry.get(id)?.revoked === false,
          now,
        });
  const previewServer = previews ? createPreviewServer({ store: previews, log }) : null;
  let previewBase = options.previewBaseUrl?.replace(/\/$/, "") ?? null;
  let sidecar: SidecarEndpoint | null = null;
  const touched = new Map<string, number>();

  async function endpoint(refresh = false): Promise<SidecarEndpoint | null> {
    if (!sidecar || refresh) sidecar = await readSidecarEndpoint(options.sidecarEndpointPath);
    return sidecar;
  }

  function probeSidecar(ep: SidecarEndpoint): Promise<boolean> {
    return new Promise((resolve) => {
      const r = httpRequest(
        {
          host: "127.0.0.1",
          port: ep.port,
          path: "/state",
          method: "GET",
          headers: { host: `127.0.0.1:${ep.port}`, "x-gg-token": ep.token },
          timeout: 1500,
        },
        (res) => {
          res.resume();
          // Any HTTP answer at all means the process behind the port is ours
          // (it accepted the token); the sidecar answers 400 without a session.
          resolve(res.statusCode !== 401 && res.statusCode !== 403);
        },
      );
      r.on("timeout", () => {
        r.destroy();
        resolve(false);
      });
      r.on("error", () => resolve(false));
      r.end();
    });
  }

  function authenticate(req: IncomingMessage): Auth | null {
    const header = req.headers[DEVICE_TOKEN_HEADER];
    const token =
      typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
    if (!token) return null;
    const device = registry.authenticate(token);
    if (!device) return null;
    let admin = device.admin;
    if (!admin) {
      const control = req.headers[CONTROL_HEADER];
      const cred = typeof control === "string" ? control : undefined;
      if (cred && macaroon.isMacaroon(cred)) {
        const verdict = macaroon.verify(options.controlRootKey, cred, {
          now: now(),
          nodeId: options.nodeId,
        });
        admin = verdict.ok;
      }
    }
    // lastSeen at most once a minute per device; never on the request path.
    const last = touched.get(device.deviceId) ?? 0;
    if (Date.now() - last > 60_000) {
      touched.set(device.deviceId, Date.now());
      void background(registry.touch(device.deviceId));
    }
    return { device, admin };
  }

  function mintPayloadFor(admin: boolean): (label: string | undefined) => Promise<PairingPayload> {
    return async (label) => {
      const minted = await registry.mint(label ?? (admin ? "Admin device" : "Device"), { admin });
      if (!minted.ok) throw new Error(minted.error.message);
      const payload: PairingPayload = {
        baseUrl: options.publicBaseUrl,
        host: options.nodeId,
        token: minted.value.token,
        label: minted.value.device.label,
        deviceId: minted.value.device.deviceId,
      };
      if (!admin) return payload;
      const expires = new Date(now().getTime() + 365 * 24 * 3600_000);
      const cred = macaroon.mint(options.controlRootKey, minted.value.device.deviceId, [
        macaroon.expCaveat(expires),
        macaroon.nodeCaveat(options.nodeId),
      ]);
      return { ...payload, controlCredential: cred };
    };
  }

  // ------------------------------------------------------------------ SSE

  interface LiveSession {
    ring: SessionRing;
    subs: Set<ServerResponse>;
    upstream: ReturnType<typeof httpRequest> | null;
  }
  const live = new Map<string, LiveSession>();
  const liveLoading = new Map<string, Promise<LiveSession>>();

  // Two clients attaching to the same session at once must share one
  // LiveSession, or the upstream fan-out reaches only one of them.
  function liveSession(sessionId: string): Promise<LiveSession> {
    const ready = live.get(sessionId);
    if (ready) return Promise.resolve(ready);
    let p = liveLoading.get(sessionId);
    if (!p) {
      p = rings.session(sessionId).then((ring) => {
        const s: LiveSession = { ring, subs: new Set(), upstream: null };
        live.set(sessionId, s);
        liveLoading.delete(sessionId);
        return s;
      });
      p.catch(() => liveLoading.delete(sessionId));
      liveLoading.set(sessionId, p);
    }
    return p;
  }

  async function ensureUpstream(sessionId: string): Promise<void> {
    if (stopped) return;
    const s = await liveSession(sessionId);
    if (s.upstream) return;
    const ep = await endpoint();
    if (!ep) return;
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: ep.port,
        path: `/events?session=${encodeURIComponent(sessionId)}`,
        method: "GET",
        headers: {
          host: `127.0.0.1:${ep.port}`,
          "x-gg-token": ep.token,
          accept: "text/event-stream",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          log(`[sse] upstream ${sessionId} -> ${res.statusCode}`);
          res.resume();
          s.upstream = null;
          if (res.statusCode === 404) void untrack(sessionId);
          return;
        }
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (!raw.trim() || raw.startsWith(":") || raw.startsWith("retry:")) continue;
            const frame = s.ring.push(raw);
            for (const sub of s.subs) sub.write(frame.frame);
            const lf = liveFrame(raw);
            const outcome = replies.onFrame(sessionId, raw);
            // A group member's work shows on its group's activity instead.
            if (lf && !(groups?.owns(sessionId) ?? false))
              liveActivities.onFrame(sessionId, lf, outcome?.text);
            if (!(groups?.owns(sessionId) ?? false)) briefing.onFrame(sessionId, raw);
            const blobNudge = blobs?.onFrame(sessionId, raw) ?? null;
            groups?.onFrame(sessionId, raw);
            askNotifier.onFrame(sessionId, raw, !(groups?.owns(sessionId) ?? false));
            if (!isRunEnd(raw)) continue;
            // The home thread's transcript path appears at its first run end
            // and moves on compaction; re-learn it whoever is watching.
            if (home)
              void background(home.onRunEnd(sessionId).catch((e) => log(`[home] ${String(e)}`)));
            // A run finished and nobody was watching: one nudge per phone. The
            // content waits in the ring for the attach that follows. A Blob's
            // scheduled result is the point, so it is sent whoever is watching.
            // A group member's turn is announced by the group (one push per
            // exchange), never per session.
            const groupTurn = groups?.owns(sessionId) ?? false;
            // A chat started by voice and not yet opened is named in its nudge.
            const startedNudge = started.onRunEnd(sessionId, s.subs.size === 0);
            if (!groupTurn && (blobNudge || s.subs.size === 0) && options.apns?.configured) {
              const runNudge: Nudge = {
                sessionId,
                kind: outcome?.kind ?? "finished",
                name: startedNudge?.name ?? describeSession(sessionId).title,
                ...(outcome?.text ? { text: outcome.text } : {}),
              };
              void options.apns
                .notify(blobNudge ?? runNudge, registry.list())
                .catch((e) => log(`[apns] ${String(e)}`));
            }
          }
        });
        const gone = (): void => {
          s.upstream = null;
          if (s.subs.size) setTimeout(() => void ensureUpstream(sessionId), 1000).unref();
        };
        res.on("end", gone);
        res.on("error", gone);
      },
    );
    req.on("error", (e) => {
      log(`[sse] upstream ${sessionId} error ${e.message}`);
      s.upstream = null;
      void endpoint(true);
      if (s.subs.size) setTimeout(() => void ensureUpstream(sessionId), 1000).unref();
    });
    req.end();
    s.upstream = req;
  }

  /** Open SSE responses by device, so a revoke can cut them at once. */
  const streamsByDevice = new Map<string, Set<ServerResponse>>();

  function dropStreams(deviceId: string): number {
    const set = streamsByDevice.get(deviceId);
    if (!set) return 0;
    let n = 0;
    for (const res of set) {
      res.end();
      res.destroy();
      n += 1;
    }
    streamsByDevice.delete(deviceId);
    return n;
  }

  async function handleEvents(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    deviceId: string,
  ): Promise<void> {
    const sessionId =
      url.searchParams.get("session") ?? (req.headers["x-gg-session"] as string | undefined);
    if (!sessionId) return json(res, 400, { error: "session required" });
    let s: LiveSession;
    try {
      s = await liveSession(sessionId);
    } catch {
      return json(res, 400, { error: "bad session id" });
    }
    void ensureUpstream(sessionId);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 1000\n\n");
    const lastHeader = req.headers["last-event-id"];
    const last = Number(
      typeof lastHeader === "string" ? lastHeader : (url.searchParams.get("lastEventId") ?? NaN),
    );
    if (Number.isInteger(last) && last >= 0) {
      const oldest = s.ring.oldest();
      if (oldest !== null && last + 1 < oldest) {
        res.write(
          `id: ${s.ring.seq()}\ndata: ${JSON.stringify({ type: "kleio_replay_gap", data: { from: last, oldest } })}\n\n`,
        );
      }
      const missed = s.ring.since(last);
      for (const f of missed) res.write(f.frame);
      log(
        `[sse] resume ${sessionId} from ${last}: replayed ${missed.length} (seq=${s.ring.seq()})`,
      );
    } else {
      const ready = s.ring.findLast((f) => f.includes('"type":"ready"'));
      if (ready) res.write(ready.frame);
    }
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    s.subs.add(res);
    let mine = streamsByDevice.get(deviceId);
    if (!mine) streamsByDevice.set(deviceId, (mine = new Set()));
    mine.add(res);
    req.on("close", () => {
      clearInterval(ping);
      s.subs.delete(res);
      mine.delete(res);
      // The upstream stays attached: the ring must keep filling while no client
      // is connected, or a restart/outage loses exactly the frames that matter.
    });
  }

  /**
   * The proxy owns the set of live sessions: the sidecar has no "list live
   * sessions in this process" route (its /sessions is on-disk history by cwd).
   * Every session created through the proxy is recorded, subscribed upstream
   * at once, and re-subscribed after a proxy restart, so the ring keeps filling
   * whether or not any client is attached.
   */
  const trackedPath = join(dirname(options.sidecarEndpointPath), "sessions.json");
  const tracked = new Set<string>();
  let routinePoll: NodeJS.Timeout | null = null;
  let routineWake: NodeJS.Timeout | null = null;
  // Set by stop(). A poll that was already in flight when the host stopped
  // must not track sessions or open upstreams into a dead server.
  let stopped = false;
  // "Brief me" (brief.ts): how each job ended, for the spoken briefing.
  const briefing = createBriefing({
    statePath: join(dirname(options.sidecarEndpointPath), "brief.json"),
    now: () => (options.now?.() ?? new Date()).getTime(),
    log,
  });
  // Kleio's conversational voice (voice.ts): the OpenAI key stays here.
  const voice = createVoice({
    keyPath: options.voice?.keyPath ?? join(dirname(options.sidecarEndpointPath), "openai.key"),
    settingsPath: join(dirname(options.sidecarEndpointPath), "voice.json"),
    ...(options.voice?.apiKey ? { apiKey: options.voice.apiKey } : {}),
    ...(options.voice?.model ? { model: options.voice.model } : {}),
    ...(options.voice?.baseUrl ? { baseUrl: options.voice.baseUrl } : {}),
    ...(options.voice?.fetch ? { fetch: options.voice.fetch } : {}),
    log,
  });
  // Group names as the groups last said them, for the briefing.
  const groupTitles = new Map<string, string>();
  // Lock-screen Live Activities, updated from here while the phone is locked.
  // The iPhone Live Activity per session / group (live-activity.ts).
  const liveActivities = createLiveActivityTracker({
    apns: options.apns,
    startTokens: () =>
      registry
        .list()
        .flatMap((d) =>
          !d.revoked && d.liveStart ? [{ ...d.liveStart, deviceId: d.deviceId }] : [],
        ),
    log,
    now: () => (options.now?.() ?? new Date()).getTime(),
    onEnd: (target, state) => briefing.ended({ target, ...describeJob(target), state }),
  });
  // What POST /session asked for, so push-to-start can name the activity.
  // In memory only: after a restart an unknown session reads as a "Chat".
  // A chat started by voice (started-chats.ts) also has its title.
  // The final reply (or error) of each session's run, quoted by its run-end nudge.
  const replies = createReplyTracker();
  /** A Live Activity alert in the notifications' anatomy (title = name, body = substance). */
  function liveAlert(input: NoticeInput): LiveAlertText {
    const n = noticeFor(input);
    return { title: n.title, body: n.body };
  }
  const sessionKinds = new Map<string, { mode: "chat" | "code"; cwd: string; title?: string }>();
  /** Static attributes for a session's activity. Names only, never secrets. */
  function describeSession(sessionId: string): LiveAttributes {
    const blob = blobs?.bySession(sessionId);
    const base = (kind: LiveAttributes["kind"], title: string): LiveAttributes => ({
      kind,
      title: clipText(title, TITLE_MAX) || "Kleio",
      sessionId,
    });
    if (blob) return base("specialist", blob.name);
    if (home?.sessionId() === sessionId) return base("chat", "Kleio");
    const k = sessionKinds.get(sessionId);
    if (k?.mode === "code") return base("code", basename(k.cwd) || "Code");
    return base("chat", k?.title ?? "Chat");
  }
  /** Every job showing now, named for the briefing. */
  function currentJobs(): BriefJob[] {
    return liveActivities
      .snapshot()
      .map(({ target, state }) => ({ target, ...describeJob(target), state }));
  }
  /** A Live Activity target's kind and name, for the briefing. */
  function describeJob(target: string): { kind: LiveAttributes["kind"]; title: string } {
    if (target.startsWith("g:")) {
      return { kind: "group", title: groupTitles.get(target.slice(2)) ?? "" };
    }
    const { kind, title } = describeSession(target.slice(2));
    return { kind, title };
  }
  // `ask_user` questions pushed to the phone (ask-push.ts): through the Live
  // Activity when one is (or can be started) on the phone, else a plain alert.
  const askNotifier = createAskNotifier({
    attached: (sessionId) => (live.get(sessionId)?.subs.size ?? 0) > 0,
    push: (nudge) => {
      if (!options.apns?.configured) return;
      const apns = options.apns;
      const sid = nudge.sessionId;
      void (async () => {
        const viaLive = sid
          ? await liveActivities.alert(
              `s:${sid}`,
              liveAlert({ ...nudge, name: describeSession(sid).title }),
              () => describeSession(sid),
            )
          : false;
        if (!viaLive) {
          const name = sid ? describeSession(sid).title : undefined;
          await apns.notify({ ...nudge, ...(name ? { name } : {}) }, registry.list());
        }
      })().catch((e) => log(`[apns] ${String(e)}`));
    },
  });

  // Disk writes this host started and nobody awaits on the request path.
  // stop() waits for them, so a restart (or a test tearing its folder down)
  // never races a write still landing.
  const inflight = new Set<Promise<unknown>>();
  function background<T>(p: Promise<T>): Promise<T> {
    inflight.add(p);
    void p.then(
      () => inflight.delete(p),
      () => inflight.delete(p),
    );
    return p;
  }

  // One sessions.json write at a time, each with the set as it is when its
  // turn comes — two overlapping writes could otherwise land out of order and
  // drop a session.
  let trackedWrite: Promise<void> = Promise.resolve();
  function persistTracked(): Promise<void> {
    const next = trackedWrite
      .catch(() => {})
      .then(() => atomicWrite(trackedPath, `${JSON.stringify([...tracked])}\n`, 0o600));
    trackedWrite = next;
    return background(next);
  }

  async function track(sessionId: string): Promise<void> {
    if (tracked.has(sessionId)) return;
    tracked.add(sessionId);
    // Tap the stream first: the sidecar starts sending at once, and waiting
    // for the disk (hundreds of ms on a Windows runner) lost those frames.
    void ensureUpstream(sessionId).catch(() => {});
    await persistTracked().catch((e) => log(`[sse] persist tracked failed: ${String(e)}`));
  }

  async function untrack(sessionId: string): Promise<void> {
    if (!tracked.delete(sessionId)) return;
    const s = live.get(sessionId);
    s?.upstream?.destroy();
    live.delete(sessionId);
    briefing.forget(sessionId);
    replies.forget(sessionId);
    await persistTracked().catch(() => {});
  }

  async function resumeTracked(): Promise<void> {
    try {
      const ids = JSON.parse(await readFile(trackedPath, "utf8")) as unknown;
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") tracked.add(id);
    } catch {
      /* first start */
    }
    for (const id of tracked) void ensureUpstream(id).catch(() => {});
    if (tracked.size) log(`[sse] resubscribed ${tracked.size} tracked session(s)`);
  }

  /**
   * A call the host makes to the sidecar on its own behalf. null = unreachable.
   * A refused connection re-reads the endpoint file and tries once more, as
   * proxy() does: the sidecar may have respawned on a new port. The session
   * goes in `x-gg-session`, never `?session=`: the sidecar matches per-session
   * routes on the raw URL, so `/state?session=…` is its 404, not its /state.
   */
  const sidecarCall: SidecarCall = async (method, path, opts = {}) => {
    const data = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const once = (ep: SidecarEndpoint): Promise<SidecarReply | "refused" | null> =>
      new Promise((resolve) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port: ep.port,
            path,
            method,
            headers: {
              host: `127.0.0.1:${ep.port}`,
              "x-gg-token": ep.token,
              ...(opts.session ? { "x-gg-session": opts.session } : {}),
              ...(data
                ? { "content-type": "application/json", "content-length": data.length }
                : {}),
            },
            timeout: opts.timeoutMs ?? 5_000,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
            res.on("error", () => resolve(null));
          },
        );
        req.on("timeout", () => req.destroy());
        req.on("error", (e) =>
          resolve((e as NodeJS.ErrnoException).code === "ECONNREFUSED" ? "refused" : null),
        );
        req.end(data);
      });
    const first = await endpoint();
    if (!first) return null;
    const r = await once(first);
    if (r !== "refused") return r;
    const fresh = await endpoint(true);
    if (!fresh || (fresh.port === first.port && fresh.token === first.token)) return null;
    const again = await once(fresh);
    return again === "refused" ? null : again;
  };

  const home = options.homeCwd
    ? createHomeThreads({
        statePath: join(dirname(options.sidecarEndpointPath), "home.json"),
        cwd: options.homeCwd,
        call: sidecarCall,
        track,
        untrack,
        log,
        now,
      })
    : null;

  const started = createStartedChats({
    ...(options.workspaceRoots ? { workspaceRoots: options.workspaceRoots } : {}),
    call: sidecarCall,
    track,
    untrack,
    remember: (sessionId, mode, cwd, title) => sessionKinds.set(sessionId, { mode, cwd, title }),
    log,
    now,
  });

  const blobs: Blobs | null = home
    ? createBlobs({
        statePath: join(dirname(options.sidecarEndpointPath), "blobs.json"),
        cwdRoot: join(options.homeCwd!, "blobs"),
        defaultModel: options.blobDefaultModel || DEFAULT_BLOB_MODEL,
        call: sidecarCall,
        track,
        untrack,
        homeSession: () => home.resolve(),
        // Groups is created below; these run only on a request, after that.
        onDeleted: (blobId): Promise<void> => groups?.onBlobDeleted(blobId) ?? Promise.resolve(),
        onChanged: (blobId): Promise<void> => groups?.onBlobChanged(blobId) ?? Promise.resolve(),
        log,
        now,
      })
    : null;
  let blobTicker: NodeJS.Timeout | null = null;

  const groups: Groups | null = blobs
    ? createGroups({
        statePath: join(dirname(options.sidecarEndpointPath), "groups.json"),
        cwdRoot: join(options.homeCwd!, "groups"),
        call: sidecarCall,
        track,
        untrack,
        findBlob: (id) => blobs.find(id),
        modelOf: (b) => blobs.modelOf(b),
        notify: async (n) => {
          if (options.apns?.configured) await options.apns.notify(n, registry.list());
        },
        onLive: (groupId, title, state, alert, fresh) => {
          groupTitles.set(groupId, title);
          return liveActivities.set(`g:${groupId}`, state, {
            fresh: fresh === true,
            ...(alert
              ? {
                  alert: liveAlert({
                    kind: "question",
                    name: title,
                    ...(state.detail ? { text: state.detail } : {}),
                  }),
                }
              : {}),
            describe: () => ({ kind: "group", title: clipText(title, TITLE_MAX), groupId }),
          });
        },
        router:
          options.groupRouter ??
          jevRouter(
            createJev({
              apiKey: async () =>
                options.jev?.apiKey?.trim() ||
                (await readKeyFile(
                  options.jev?.keyPath ??
                    join(dirname(options.sidecarEndpointPath), "typesafe.key"),
                )),
              ...(options.jev?.baseUrl ? { baseUrl: options.jev.baseUrl } : {}),
              ...(options.jev?.fetch ? { fetch: options.jev.fetch } : {}),
            }),
            log,
          ),
        ...(options.groupTurnTimeoutMs !== undefined
          ? { turnTimeoutMs: options.groupTurnTimeoutMs }
          : {}),
        log,
        now,
      })
    : null;

  // App connections. Created whenever the home thread exists; the routes say
  // "not set up" until a Composio key is present.
  const connections = home
    ? createConnections({
        statePath: join(dirname(options.sidecarEndpointPath), "composio.json"),
        keyPath:
          options.composio?.keyPath ?? join(dirname(options.sidecarEndpointPath), "composio.key"),
        ...(options.composio?.apiKey ? { apiKey: options.composio.apiKey } : {}),
        ...(options.composio?.baseUrl ? { baseUrl: options.composio.baseUrl } : {}),
        ...(options.composio?.fetch ? { fetch: options.composio.fetch } : {}),
        publicBaseUrl: options.publicBaseUrl,
        ggHome: options.composio?.ggHome ?? join(homedir(), ".gg"),
        // New tools: idle conversations are retired so their next turn loads them.
        onToolsChanged: async () => {
          await home.retireIdle();
          await blobs?.retireIdle();
          await groups?.retireIdle();
        },
        log,
        now,
      })
    : null;

  /**
   * Tap the stored home and Blob sessions at start, so they record with no
   * device attached; Blob schedules missed while down are skipped forward.
   */
  async function resumeHome(): Promise<void> {
    const id = await home?.load();
    if (id) await track(id);
    for (const sid of (await blobs?.load()) ?? []) await track(sid);
    for (const sid of (await groups?.load()) ?? []) await track(sid);
    // After everything is tracked, so a tools change can retire idle threads.
    if (connections) void background(connections.ensure());
    const every = options.blobTickMs ?? 5_000;
    if (blobs && every > 0 && !stopped) {
      blobTicker = setInterval(() => void background(blobs.tick()), every);
      blobTicker.unref();
    }
  }

  /**
   * Routine sessions are created by the sidecar itself (a routine fired), not
   * through this proxy, so `track()` never saw them. Ask `GET /routines` for
   * the routine→session map and track anything new, so a routine's transcript
   * is in the ring for whichever device attaches later.
   */
  /**
   * A JSON call from the host itself to the sidecar (not a device's request):
   * its status and parsed body, or null when it can't be reached in time.
   */
  async function sidecarJson(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = 5_000,
  ): Promise<{ status: number; body: unknown } | null> {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return sidecarSend(method, path, payload, "application/json", timeoutMs);
  }

  /** sidecarJson's sibling for a raw-bytes body (POST /file-text); the answer is still JSON. */
  function sidecarBytes(
    path: string,
    bytes: Buffer,
    timeoutMs: number,
  ): Promise<{ status: number; body: unknown } | null> {
    return sidecarSend("POST", path, bytes, "application/octet-stream", timeoutMs);
  }

  async function sidecarSend(
    method: "GET" | "POST",
    path: string,
    payload: Buffer | null,
    contentType: string,
    timeoutMs: number,
  ): Promise<{ status: number; body: unknown } | null> {
    const ep = await endpoint();
    if (!ep) return null;
    return new Promise((resolve) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: ep.port,
          path,
          method,
          headers: {
            host: `127.0.0.1:${ep.port}`,
            "x-gg-token": ep.token,
            ...(payload
              ? { "content-type": contentType, "content-length": String(payload.length) }
              : {}),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              /* not JSON: the status says enough */
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
          res.on("error", () => resolve(null));
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(null));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function trackRoutineSessions(): Promise<void> {
    if (stopped) return;
    const ep = await endpoint();
    if (!ep) return;
    const body = await new Promise<string | null>((resolve) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: ep.port,
          path: "/routines",
          method: "GET",
          headers: { host: `127.0.0.1:${ep.port}`, "x-gg-token": ep.token },
          timeout: 5_000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          res.on("error", () => resolve(null));
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(null));
      req.end();
    });
    if (body === null || stopped) return;
    let parsed: { sessions?: unknown; routines?: unknown };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return;
    }
    const sessions = parsed.sessions;
    if (typeof sessions === "object" && sessions !== null) {
      for (const [routineId, sid] of Object.entries(sessions as Record<string, unknown>)) {
        if (typeof sid !== "string" || tracked.has(sid)) continue;
        log(`[routines] tracking session ${sid} for ${routineId}`);
        await track(sid);
      }
    }
    // A routine about to fire gets its session created at that moment; the
    // ring should be tapped in before the first frame, not a poll later. When
    // one is due within the next poll window, re-poll right after it fires.
    const soon = (Array.isArray(parsed.routines) ? parsed.routines : [])
      .map((r) => (r as { nextRunAt?: unknown }).nextRunAt)
      .filter((t): t is number => typeof t === "number")
      .map((t) => t - (options.now?.() ?? new Date()).getTime())
      .filter((dt) => dt >= 0 && dt < (options.routinePollMs ?? 30_000));
    if (soon.length > 0 && !routineWake && !stopped) {
      routineWake = setTimeout(
        () => {
          routineWake = null;
          void trackRoutineSessions().catch(() => {});
        },
        Math.min(...soon) + 250,
      );
      routineWake.unref();
    }
  }

  /** Is this raw SSE frame the sidecar's end-of-run marker? Cheap check before parsing. */
  /**
   * The frames that change a Live Activity, parsed; everything else (the
   * text_delta flood) is rejected by a substring check before any JSON work.
   */
  function liveFrame(raw: string): SidecarFrame | null {
    if (!LIVE_FRAME_RE.test(raw)) return null;
    const data = raw.match(/^data: (.*)$/m)?.[1];
    if (!data) return null;
    try {
      const f = JSON.parse(data) as { type?: unknown; data?: unknown };
      if (typeof f.type !== "string") return null;
      const d =
        typeof f.data === "object" && f.data !== null ? (f.data as Record<string, unknown>) : {};
      return { type: f.type, data: d };
    } catch {
      return null;
    }
  }

  function isRunEnd(raw: string): boolean {
    if (!raw.includes('"run_end"')) return false;
    const data = raw.match(/^data: (.*)$/m)?.[1];
    if (!data) return false;
    try {
      return (JSON.parse(data) as { type?: unknown }).type === "run_end";
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ proxy

  /** The sidecar API is JSON; 8 MiB is well above any real prompt or attachment. */
  const PROXY_BODY_MAX = 8 * 1024 * 1024;

  /**
   * Forward to the sidecar. A stale endpoint (sidecar respawned on a new port)
   * surfaces as a connect-phase error before any response bytes exist; in that
   * case re-read the endpoint file once and retry. The request body is buffered
   * up front so a retry can resend it; the sidecar API is JSON, bounded here at
   * 8 MiB to stay well above any real prompt/attachment while still bounded.
   */
  /** Note a new session's mode and cwd from its POST /session request. */
  function rememberKind(sessionId: string, raw: Buffer): void {
    try {
      const o = JSON.parse(raw.toString("utf8")) as { mode?: unknown; cwd?: unknown };
      sessionKinds.set(sessionId, {
        mode: o.mode === "chat" || o.mode === "motion" ? "chat" : "code",
        cwd: typeof o.cwd === "string" ? o.cwd : "",
      });
    } catch {
      /* not ours to validate */
    }
  }

  async function proxy(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    /** The body, when the caller has already read it off the stream. */
    preRead?: Buffer,
  ): Promise<void> {
    const body =
      preRead ??
      (req.method === "GET" || req.method === "HEAD"
        ? Buffer.alloc(0)
        : await readBody(req, PROXY_BODY_MAX));
    if (body === null) return json(res, 413, { error: "body too large" });
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (
        v === undefined ||
        HOP_BY_HOP.has(k) ||
        k === DEVICE_TOKEN_HEADER ||
        k === CONTROL_HEADER ||
        k === "content-length"
      )
        continue;
      headers[k] = v;
    }
    headers["x-gg-token"] = "";
    headers["content-length"] = String(body.length);

    const reqBody = body;
    const attemptOnce = (ep: SidecarEndpoint): Promise<"ok" | "stale" | "failed"> =>
      new Promise((resolve) => {
        const up = httpRequest(
          {
            host: "127.0.0.1",
            port: ep.port,
            path: url.pathname + url.search,
            method: req.method,
            headers: { ...headers, host: `127.0.0.1:${ep.port}`, "x-gg-token": ep.token },
          },
          (ures) => {
            const out: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(ures.headers))
              if (v !== undefined && !HOP_BY_HOP.has(k)) out[k] = v;
            if (req.method === "POST" && url.pathname === "/session" && ures.statusCode === 200) {
              // Learn the new session before the client can attach to it.
              let body = "";
              ures.setEncoding("utf8");
              ures.on("data", (c: string) => (body += c));
              ures.on("end", () => {
                void (async () => {
                  let id: unknown;
                  try {
                    id = (JSON.parse(body) as { sessionId?: unknown }).sessionId;
                  } catch {
                    /* not ours to validate */
                  }
                  // Answer only once the session is on disk: a client that has
                  // the id must be able to rely on a host restart still
                  // recording it.
                  if (typeof id === "string") {
                    rememberKind(id, reqBody);
                    await track(id);
                  }
                  delete out["content-length"];
                  res.writeHead(200, { ...out, "content-length": Buffer.byteLength(body) });
                  res.end(body);
                  resolve("ok");
                })();
              });
              ures.on("error", () => {
                res.destroy();
                resolve("failed");
              });
              return;
            }
            res.writeHead(ures.statusCode ?? 502, out);
            ures.pipe(res);
            ures.on("end", () => resolve("ok"));
            ures.on("error", () => {
              res.destroy();
              resolve("failed");
            });
          },
        );
        up.on("error", (e) => {
          const code = (e as NodeJS.ErrnoException).code;
          // Nothing reached the client yet and the socket never delivered a
          // response: the endpoint is stale (or the sidecar is mid-restart).
          if (
            !res.headersSent &&
            (code === "ECONNREFUSED" ||
              code === "ECONNRESET" ||
              code === "EPIPE" ||
              code === "ETIMEDOUT")
          ) {
            resolve("stale");
            return;
          }
          if (!res.headersSent) json(res, 502, { error: "sidecar error", detail: e.message });
          else res.destroy();
          resolve("failed");
        });
        up.end(body);
      });

    const first = await endpoint();
    if (!first) return json(res, 503, { error: "sidecar unavailable" });
    const outcome = await attemptOnce(first);
    if (outcome !== "stale") return;
    const fresh = await endpoint(true);
    if (!fresh) return json(res, 503, { error: "sidecar unavailable" });
    if (fresh.port === first.port && fresh.token === first.token) {
      // Same endpoint, still refusing: give it one short beat (respawn in progress).
      await new Promise((r) => setTimeout(r, 300));
    }
    const second = await attemptOnce(fresh);
    if (second === "stale") json(res, 503, { error: "sidecar unavailable" });
  }

  /**
   * Where an owner's files live, or the [status, error] to answer with: a Blob
   * or group member that does not exist, or a cwd outside Kleio's projects
   * folders, is a 404 like any missing file.
   */
  async function ownerRoot(owner: FileOwner): Promise<Result<OwnerRoot, [number, string]>> {
    switch (owner.kind) {
      case "blob":
        if (!options.homeCwd || !blobs || !(await blobs.find(owner.blobId)))
          return err([404, "no such agent"]);
        return ok({ root: join(options.homeCwd, "blobs", owner.blobId) });
      case "group":
        if (!options.homeCwd || !groups || !(await groups.has(owner.groupId)))
          return err([404, "no such group"]);
        return ok({ root: join(options.homeCwd, "groups", owner.groupId, owner.blobId) });
      case "workspace": {
        if (!options.workspaceRoots) return err([404, "no such workspace"]);
        const ws = await resolveWorkspaceDir(await options.workspaceRoots(), owner.cwd);
        if (!ws.ok) return err([404, "no such workspace"]);
        return ok({ root: ws.value.dir, workspaceRoot: ws.value.root });
      }
    }
  }

  // ------------------------------------------------- voice: agents' files

  /** Extracted text of recently read files, by real path + size + mtime. */
  const fileTexts = createTextCache();

  /** Whether `dir` (a real path) is Kleio's own folder or inside it. */
  async function inKleiosFolder(cwd: string, dir: string): Promise<boolean> {
    const homeCwd = options.homeCwd;
    if (homeCwd === undefined) return false;
    if (holds(homeCwd, cwd)) return true;
    try {
      return holds(await realpath(homeCwd), dir);
    } catch {
      return false;
    }
  }

  /** Kleio's own folder's real path (as configured while it doesn't exist), or null. */
  async function kleioFolder(): Promise<string | null> {
    const homeCwd = options.homeCwd;
    if (homeCwd === undefined) return null;
    try {
      return await realpath(homeCwd);
    } catch {
      return resolvePath(homeCwd);
    }
  }

  /** How projects are found: never Kleio's own folder, one holding it, or one inside it. */
  async function projectScan(): Promise<ProjectScan> {
    const kleio = await kleioFolder();
    return {
      home: homedir(),
      skip: (real) => kleio !== null && (holds(real, kleio) || holds(kleio, real)),
    };
  }

  /** The project a files request names (`id` is its name). */
  async function projectFor(name: string | null): Promise<Result<ProjectFolder, FilesFailure>> {
    if (name === null || !isProjectName(name)) return filesFail(400, "bad_request");
    const roots = options.workspaceRoots ? await options.workspaceRoots() : [];
    const project = await findProject(roots, name, await projectScan());
    return project ? ok(project) : filesFail(404, "not_found");
  }

  /**
   * The latest prompts and replies of the newest saved conversation that ran
   * in `dir` (one of Kleio's own folders), or null when there is none yet.
   */
  async function threadMessages(
    dir: string,
  ): Promise<
    Result<{ messages: readonly SavedMessage[]; lastActivity: string } | null, "unavailable">
  > {
    const listed = await sidecarJson(
      "GET",
      `/stored-sessions?kind=chat&limit=${SIDECAR_LIST_LIMIT}`,
      undefined,
      15_000,
    );
    if (!listed || listed.status !== 200) return err("unavailable");
    let real = resolvePath(dir);
    try {
      real = await realpath(dir);
    } catch {
      /* not made yet: compared as configured */
    }
    const want = new Set([resolvePath(dir), real]);
    // Newest first: the first in its folder is its current conversation.
    const row = savedRows(listed.body).find((r) => want.has(resolvePath(r.cwd)));
    if (!row || !isSessionId(row.id)) return ok(null);
    const read = await sidecarJson(
      "GET",
      `/stored-sessions/${row.id}?kind=chat`,
      undefined,
      15_000,
    );
    if (!read || read.status >= 500) return err("unavailable");
    const got = read.status === 200 ? savedSessionRead(read.body, "chat", () => false) : null;
    return ok(got ? { messages: got.messages, lastActivity: got.lastActivity } : null);
  }

  /**
   * The Code sessions working, or waiting on the user, now (their Live Activity
   * states): those made since the host started, whose kind it noted.
   */
  function codeJobs(): CodeJob[] {
    const jobs: CodeJob[] = [];
    for (const { target, state } of liveActivities.snapshot()) {
      if (!target.startsWith("s:")) continue;
      const k = sessionKinds.get(target.slice(2));
      if (k?.mode !== "code" || (state.phase !== "working" && state.phase !== "needsYou")) continue;
      jobs.push({
        cwd: k.cwd,
        phase: state.phase,
        // Waiting on the user: the question it asks.
        line: state.phase === "needsYou" && state.detail ? state.detail : state.line,
      });
    }
    return jobs;
  }

  /** A saved chat's or coding session's folder and the files it made there. */
  async function sessionFolder(
    kind: "chat" | "code",
    id: string | null,
  ): Promise<Result<{ dir: string; files: FoundFile[] }, FilesFailure>> {
    if (id === null || !isSessionId(id)) return filesFail(400, "bad_request");
    const r = await sidecarJson(
      "GET",
      `/stored-sessions/${id}?kind=${kind}&files=1`,
      undefined,
      15_000,
    );
    if (!r || r.status >= 500) return filesFail(503, "files_unavailable");
    if (r.status !== 200 || typeof r.body !== "object" || r.body === null)
      return filesFail(404, "not_found");
    const b = r.body as { session?: unknown; files?: unknown };
    const cwd =
      typeof b.session === "object" && b.session !== null
        ? (b.session as { cwd?: unknown }).cwd
        : undefined;
    if (typeof cwd !== "string" || !options.workspaceRoots) return filesFail(404, "not_found");
    const ws = await resolveWorkspaceDir(await options.workspaceRoots(), cwd);
    if (!ws.ok || (await inKleiosFolder(cwd, ws.value.dir))) return filesFail(404, "not_found");
    return ok({ dir: ws.value.dir, files: await sessionFiles(ws.value.dir, b.files) });
  }

  async function blobName(blobId: string): Promise<string | undefined> {
    return (await blobs?.find(blobId))?.name;
  }

  /** GET /kleio/voice/files: an owner's files, newest first. */
  async function listAgentFiles(
    source: FilesSource,
    id: string | null,
  ): Promise<Result<AgentFileEntry[], FilesFailure>> {
    const homeCwd = options.homeCwd;
    switch (source) {
      case "kleio":
        if (homeCwd === undefined) return filesFail(404, "not_found");
        return ok(newestFirst((await listFolder(homeCwd, KLEIO_OTHERS)).map((f) => toEntry(f))));
      case "specialist":
        if (id === null || !BLOB_ID_RE.test(id)) return filesFail(400, "bad_request");
        if (homeCwd === undefined || !blobs || !(await blobs.find(id)))
          return filesFail(404, "not_found");
        return ok(
          newestFirst((await listFolder(join(homeCwd, "blobs", id))).map((f) => toEntry(f))),
        );
      case "group": {
        if (id === null || !GROUP_ID_RE.test(id)) return filesFail(400, "bad_request");
        const members = homeCwd !== undefined && groups ? await groups.members(id) : null;
        if (homeCwd === undefined || members === null) return filesFail(404, "not_found");
        const all: AgentFileEntry[] = [];
        for (const member of members) {
          if (!BLOB_ID_RE.test(member)) continue;
          const by = await blobName(member);
          const found = await listFolder(join(homeCwd, "groups", id, member));
          for (const f of found) all.push(toEntry(f, { member, ...(by ? { by } : {}) }));
        }
        return ok(newestFirst(all));
      }
      case "chat":
      case "code": {
        const folder = await sessionFolder(source, id);
        if (!folder.ok) return folder;
        return ok(newestFirst(folder.value.files.map((f) => toEntry(f))));
      }
      case "project": {
        const project = await projectFor(id);
        if (!project.ok) return project;
        return ok(newestFirst((await projectDocs(project.value.real)).map((f) => toEntry(f))));
      }
    }
  }

  /**
   * Where a read_file request's file must live, after its owner checks: the
   * folder, and the file's path inside it (a project's plan is read from inside
   * its plans folder, so no hidden name is ever walked).
   */
  async function readRoot(
    q: FileReadRequest,
  ): Promise<Result<{ root: string; path: string }, FilesFailure>> {
    const homeCwd = options.homeCwd;
    const segments = q.path.split("/");
    const at = (root: string): Result<{ root: string; path: string }, never> =>
      ok({ root, path: q.path });
    switch (q.source) {
      case "kleio":
        if (homeCwd === undefined) return filesFail(404, "not_found");
        if (KLEIO_OTHERS.has(segments[0] ?? "")) return filesFail(404, "not_found");
        return at(homeCwd);
      case "specialist":
        if (q.id === null || !BLOB_ID_RE.test(q.id)) return filesFail(400, "bad_request");
        if (homeCwd === undefined || !blobs || !(await blobs.find(q.id)))
          return filesFail(404, "not_found");
        return at(join(homeCwd, "blobs", q.id));
      case "group": {
        if (q.id === null || !GROUP_ID_RE.test(q.id)) return filesFail(400, "bad_request");
        if (q.member === null || !BLOB_ID_RE.test(q.member)) return filesFail(400, "bad_request");
        const members = homeCwd !== undefined && groups ? await groups.members(q.id) : null;
        if (homeCwd === undefined || members === null || !members.includes(q.member))
          return filesFail(404, "not_found");
        return at(join(homeCwd, "groups", q.id, q.member));
      }
      case "chat":
      case "code": {
        const folder = await sessionFolder(q.source, q.id);
        if (!folder.ok) return folder;
        // Least privilege: only a file the session itself made or linked.
        if (!folder.value.files.some((f) => f.path === q.path)) return filesFail(404, "not_found");
        return at(folder.value.dir);
      }
      case "project": {
        const project = await projectFor(q.id);
        if (!project.ok) return project;
        // Least privilege: only one of its documents, never its code or secrets.
        const doc = await projectDocAt(project.value.real, q.path);
        return doc ? ok(doc) : filesFail(404, "not_found");
      }
    }
  }

  /** POST /kleio/voice/files/read: one part of a file's text. */
  async function readAgentFile(
    q: FileReadRequest,
  ): Promise<
    Result<
      { name: string; kind: string; part: number; parts: number; text: string; pages?: number },
      FilesFailure
    >
  > {
    const where = await readRoot(q);
    if (!where.ok) return where;
    const segments = where.value.path.split("/");
    const resolved = await resolveAgentFile(
      where.value.root,
      segments.map((s) => encodeURIComponent(s)).join("/"),
      MAX_READ_BYTES,
    );
    if (!resolved.ok) {
      const e = resolved.error.kind;
      return e === "bad_path"
        ? filesFail(400, "bad_request")
        : e === "too_large"
          ? filesFail(413, "too_large")
          : filesFail(404, "not_found");
    }
    // Only a file the listing could show: no skipped folder on the way, and
    // no symlink anywhere (its real path is the path asked for, so a link
    // inside Kleio's folder can't reach her Blobs' or groups' files).
    const file = resolved.value;
    let realRoot: string;
    try {
      realRoot = await realpath(where.value.root);
    } catch {
      return filesFail(404, "not_found");
    }
    if (!walkable(segments) || file.path !== join(realRoot, ...segments))
      return filesFail(404, "not_found");
    if (!isReadable(file.name)) return filesFail(415, "unsupported");
    const key = `${file.path}\u0000${file.size}\u0000${file.mtimeMs}`;
    let extracted = fileTexts.get(key);
    if (!extracted) {
      const bytes = await readFile(file.path);
      if (bytes.length > MAX_READ_BYTES) return filesFail(413, "too_large");
      const r = await sidecarBytes(
        `/file-text?name=${encodeURIComponent(file.name)}`,
        bytes,
        60_000,
      );
      if (!r || r.status >= 500) return filesFail(503, "files_unavailable");
      if (r.status === 413) return filesFail(413, "too_large");
      if (r.status === 415) return filesFail(415, "unsupported");
      if (r.status === 422) return filesFail(422, "unreadable");
      const body = (r.body ?? {}) as { text?: unknown; pages?: unknown };
      if (r.status !== 200 || typeof body.text !== "string")
        return filesFail(503, "files_unavailable");
      extracted = {
        text: body.text,
        ...(typeof body.pages === "number" && Number.isInteger(body.pages) && body.pages >= 0
          ? { pages: body.pages }
          : {}),
      };
      fileTexts.set(key, extracted);
    }
    const slice = partOf(extracted.text, q.part);
    if (!slice.ok) return err({ status: 416, error: "no_such_part", parts: slice.error.parts });
    return ok({
      name: file.name,
      kind: toEntry({ path: q.path, name: file.name, size: file.size, mtimeMs: file.mtimeMs }).kind,
      part: q.part,
      parts: slice.value.parts,
      text: slice.value.text,
      ...(extracted.pages !== undefined ? { pages: extracted.pages } : {}),
    });
  }

  // ------------------------------------------------------------------ routes

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    // Composio's OAuth landing page: no token (a browser lands here), fixed HTML.
    if (connections) {
      const page = connections.callback(req.method ?? "GET", path, url.searchParams);
      if (page) {
        const data = Buffer.from(page.html);
        res.writeHead(page.status, {
          "content-type": "text/html; charset=utf-8",
          "content-length": data.length,
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "referrer-policy": "no-referrer",
        });
        res.end(data);
        return;
      }
    }

    if (req.method === "GET" && path === "/kleio/health") {
      // Probe, don't trust the endpoint file: a supervisor that died leaves a
      // stale file behind, and "up" would then be a lie until the next request.
      const ep = await endpoint(true);
      const alive = ep ? await probeSidecar(ep) : false;
      return json(res, 200, {
        ok: true,
        sidecar: alive ? "up" : ep ? "stale" : "down",
        devices: registry.list().filter((d) => !d.revoked).length,
        offer: offers.peek().active,
        // The home thread's id is not advertised on this open route; devices
        // get it from GET /kleio/home.
        sessions: [...live.entries()]
          .filter(([id]) => id !== home?.sessionId())
          .map(([id, s]) => ({
            id,
            seq: s.ring.seq(),
            subscribers: s.subs.size,
          })),
      });
    }

    if (req.method === "POST" && path === "/kleio/pair/redeem") {
      const body = await readBody(req, PAIR_REDEEM_MAX_BODY_BYTES);
      if (body === null) return json(res, 413, { ok: false, error: "bad_request" });
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      } catch {
        return json(res, 400, { ok: false, error: "bad_request" });
      }
      const outcome = await offers.redeem(parsed.code, parsed.redemptionNonce, parsed.label);
      if (outcome.ok) return json(res, 200, { ok: true, payload: outcome.payload });
      const status =
        outcome.reason === "bad_request" ? 400 : outcome.reason === "not_found" ? 404 : 401;
      return json(res, status, { ok: false, error: outcome.reason });
    }

    const auth = authenticate(req);
    if (!auth) return json(res, 401, { error: "unauthorized" });

    // A device registers (or clears) ITS OWN APNs token. Not an admin route:
    // a phone must be able to do this for itself; it can never touch another
    // device's record.
    // A phone registers (or clears) the update token of ITS OWN Live Activity
    // for one session or group chat; the host then keeps it current (and
    // pushes the current state at once, so it catches up). Not persisted.
    if (req.method === "POST" && path === "/kleio/live-activity") {
      const body = await readBody(req, 1024);
      if (body === null) return json(res, 413, { error: "bad_request" });
      let parsed: { sessionId?: unknown; groupId?: unknown; token?: unknown; env?: unknown } = {};
      try {
        parsed = JSON.parse(body.toString("utf8")) as typeof parsed;
      } catch {
        return json(res, 400, { error: "bad_request" });
      }
      const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : null;
      const groupId = typeof parsed.groupId === "string" ? parsed.groupId : null;
      if ((sessionId === null) === (groupId === null))
        return json(res, 400, { error: "bad_target" });
      if (sessionId !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(sessionId))
        return json(res, 400, { error: "bad_session" });
      if (groupId !== null && !/^g_[0-9a-f]{8}$/.test(groupId))
        return json(res, 400, { error: "bad_group" });
      const target = sessionId !== null ? `s:${sessionId}` : `g:${groupId ?? ""}`;
      if (parsed.token === null) {
        liveActivities.unregister(target, auth.device.deviceId);
        return json(res, 200, { ok: true });
      }
      const token = typeof parsed.token === "string" ? parsed.token.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{32,400}$/.test(token)) return json(res, 400, { error: "bad_token" });
      liveActivities.register(target, {
        token,
        env: parsed.env === "production" ? "production" : "sandbox",
        deviceId: auth.device.deviceId,
        registeredAt: (options.now?.() ?? new Date()).toISOString(),
      });
      log(`[live] ${auth.device.label} registered a Live Activity for ${target}`);
      return json(res, 200, { ok: true });
    }

    // A button on the lock screen answered the question its Live Activity
    // shows. The one-off key it carries proves the tap came from that very
    // activity (Apple delivered it to the phone, nobody else has it).
    if (req.method === "POST" && path === "/kleio/live-activity/answer") {
      const body = await readBody(req, 2048);
      if (body === null) return json(res, 413, { error: "bad_request" });
      let p: {
        sessionId?: unknown;
        groupId?: unknown;
        askId?: unknown;
        key?: unknown;
        choice?: unknown;
      } = {};
      try {
        p = JSON.parse(body.toString("utf8")) as typeof p;
      } catch {
        return json(res, 400, { error: "bad_request" });
      }
      const sid =
        typeof p.sessionId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(p.sessionId)
          ? p.sessionId
          : null;
      const gid =
        typeof p.groupId === "string" && /^g_[0-9a-f]{8}$/.test(p.groupId) ? p.groupId : null;
      const askId = typeof p.askId === "string" && /^ask-\d{1,9}$/.test(p.askId) ? p.askId : null;
      const key = typeof p.key === "string" && /^[0-9a-f]{32}$/.test(p.key) ? p.key : null;
      const choice = typeof p.choice === "number" ? p.choice : NaN;
      if (!askId || !key || (sid ? gid : !gid)) return json(res, 400, { error: "bad_request" });
      const target = gid ? `g:${gid}` : `s:${sid}`;
      const answer = liveActivities.claimAnswer(target, askId, key, choice);
      if (!answer) return json(res, 409, { error: "That question is no longer waiting." });
      const answers = { [answer.questionId]: answer.value };
      const r = gid
        ? await groups?.route(
            "POST",
            `/kleio/groups/${gid}/ask/${askId}`,
            new URLSearchParams(),
            async () => ({ action: "answer", answers }),
          )
        : await sidecarCall("POST", `/ask/${askId}`, {
            session: sid ?? "",
            body: { action: "answer", answers },
            timeoutMs: 15_000,
          });
      const status = r?.status ?? 502;
      const delivered = status >= 200 && status < 300;
      log(
        `[live] ${auth.device.label} answered ${askId} on ${target} from the lock screen → ${status}`,
      );
      return delivered
        ? json(res, 200, { ok: true })
        : json(res, status, { error: "Your answer didn't reach the agent." });
    }

    // A phone sets (or clears) ITS OWN Live Activity push-to-start token, so
    // the host can start an activity on it (persisted in the device registry).
    if (req.method === "POST" && path === "/kleio/live-activity/start-token") {
      const body = await readBody(req, 1024);
      if (body === null) return json(res, 413, { error: "bad_request" });
      let parsed: { token?: unknown; env?: unknown } = {};
      try {
        parsed = JSON.parse(body.toString("utf8")) as typeof parsed;
      } catch {
        return json(res, 400, { error: "bad_request" });
      }
      let reg: PushRegistration | null = null;
      if (parsed.token !== null) {
        const token = typeof parsed.token === "string" ? parsed.token.trim().toLowerCase() : "";
        if (!/^[0-9a-f]{32,400}$/.test(token)) return json(res, 400, { error: "bad_token" });
        reg = {
          token,
          env: parsed.env === "production" ? "production" : "sandbox",
          registeredAt: (options.now?.() ?? new Date()).toISOString(),
        };
      }
      const r = await registry.setLiveStart(auth.device.deviceId, reg);
      if (!r.ok)
        return json(res, r.error.kind === "not_found" ? 404 : 500, { error: r.error.kind });
      log(
        `[live] ${auth.device.label} ${reg ? `registered (${reg.env})` : "cleared"} its Live Activity start token`,
      );
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/kleio/push") {
      const body = await readBody(req, 1024);
      if (body === null) return json(res, 413, { error: "bad_request" });
      let parsed: { token?: unknown; env?: unknown } = {};
      try {
        parsed = JSON.parse(body.toString("utf8")) as typeof parsed;
      } catch {
        return json(res, 400, { error: "bad_request" });
      }
      let push: PushRegistration | null = null;
      if (parsed.token !== null) {
        const token = typeof parsed.token === "string" ? parsed.token.trim().toLowerCase() : "";
        if (!/^[0-9a-f]{32,400}$/.test(token)) return json(res, 400, { error: "bad_token" });
        const env = parsed.env === "production" ? "production" : "sandbox";
        push = { token, env, registeredAt: (options.now?.() ?? new Date()).toISOString() };
      }
      const r = await registry.setPush(auth.device.deviceId, push);
      if (!r.ok)
        return json(res, r.error.kind === "not_found" ? 404 : 500, { error: r.error.message });
      log(
        `[push] ${auth.device.label} ${push ? `registered (${push.env})` : "cleared"} APNs token`,
      );
      return json(res, 200, { device: r.value });
    }

    // A device uploads its own MetricKit crash/hang report. Not admin: the
    // phone must be able to do this for itself. Bounded, appended as one
    // line, never parsed beyond "is it JSON" — it is diagnostic evidence,
    // not input.
    if (req.method === "POST" && path === "/kleio/diagnostics") {
      const dir = options.diagnosticsDir;
      if (!dir) return json(res, 404, { error: "not_found" });
      const body = await readBody(req, 64 * 1024);
      if (body === null) return json(res, 413, { error: "too_large" });
      let report: unknown;
      try {
        report = JSON.parse(body.toString("utf8"));
      } catch {
        return json(res, 400, { error: "bad_request" });
      }
      if (typeof report !== "object" || report === null || Array.isArray(report))
        return json(res, 400, { error: "bad_request" });
      const line = JSON.stringify({
        receivedAt: (options.now?.() ?? new Date()).toISOString(),
        deviceId: auth.device.deviceId,
        label: auth.device.label,
        report,
      });
      try {
        await mkdir(dir, { recursive: true });
        await appendFile(join(dir, "diagnostics.jsonl"), line + "\n", { mode: 0o600 });
      } catch (e) {
        log(`[diagnostics] write failed: ${String(e)}`);
        return json(res, 500, { error: "io" });
      }
      log(`[diagnostics] report from ${auth.device.label}`);
      return json(res, 200, { ok: true });
    }

    // "Brief me" (Siri on the phone, the app's voice on the desktop): what
    // needs you, what finished, what is still working, in a few sentences.
    // Read-only. Marks the endings heard for every device; `all` repeats the
    // last day's.
    if (req.method === "POST" && path === "/kleio/brief") {
      const started = Date.now();
      const body = await readBody(req, 256);
      if (body === null) return json(res, 413, { error: "bad_request" });
      let p: { all?: unknown } = {};
      if (body.length) {
        try {
          p = JSON.parse(body.toString("utf8")) as typeof p;
        } catch {
          return json(res, 400, { error: "bad_request" });
        }
      }
      const all = typeof p === "object" && p !== null && p.all === true;
      const b = briefing.brief(currentJobs(), { all });
      log(
        `[brief] ${auth.device.label}${all ? " (all)" : ""}: ${b.items.length} item(s) in ${Date.now() - started} ms`,
      );
      return json(res, 200, b);
    }

    // Kleio's conversational voice (voice.ts). Talking: any paired device.
    // The OpenAI key and the voice: an admin device's Settings.
    if (path === "/kleio/voice" && req.method === "GET") {
      return json(res, 200, await voice.status());
    }
    if (path === "/kleio/voice/call" && req.method === "POST") {
      const body = await readBody(req, SDP_MAX);
      if (body === null) return json(res, 413, { error: "too_large" });
      const sdp = body.toString("utf8");
      if (!sdp.startsWith("v=")) return json(res, 400, { error: "bad_request" });
      // The Brain (durable memory + Jiwa), as text chat gets it. Without it
      // she still talks; she just doesn't claim to remember.
      const fromSidecar = await sidecarJson("GET", "/brain");
      const brain = fromSidecar?.status === 200 ? parseBrain(fromSidecar.body) : null;
      if (!brain) log(`[voice] the Brain is unavailable for this call`);
      // What's new, without marking it heard: she still tells them about it.
      const now = new Date(options.now?.() ?? new Date());
      const instructions = voiceInstructions({
        now,
        brief: briefing.brief(currentJobs(), { peek: true }).spoken,
        brain: brain?.prompt ?? null,
      });
      // Devices still say which microphone they have (?mic=); GPT-Live handles
      // the room itself, so it isn't needed.
      const r = await voice.createCall(sdp, instructions, brain?.tools ?? []);
      if (!r.ok) {
        log(`[voice] ${auth.device.label}: call failed (${r.error.kind})`);
        return json(res, voiceErrorStatus(r.error), {
          error: r.error.kind,
          ...voiceErrorDetail(r.error),
        });
      }
      log(`[voice] ${auth.device.label}: call started${brain ? " with the Brain" : ""}`);
      res.writeHead(201, { "content-type": "application/sdp", "cache-control": "no-store" });
      res.end(r.value.sdp);
      return;
    }
    // A Brain tool the voice called (remember, update_memory, forget,
    // set_jiwa, update_jiwa, forget_jiwa): any paired device, as text chat
    // can be asked to remember from any of them. The sidecar runs the very
    // tool text chat uses; a tool's own failure comes back as { error }.
    if (path === "/kleio/voice/brain" && req.method === "POST") {
      const started = Date.now();
      const body = await readBody(req, 16 * 1024);
      if (body === null) return json(res, 413, { error: "too_large" });
      let p: { name?: unknown; args?: unknown };
      try {
        p = JSON.parse(body.toString("utf8")) as typeof p;
      } catch {
        return json(res, 400, { error: "bad_request" });
      }
      if (typeof p !== "object" || p === null || !isBrainToolName(p.name)) {
        return json(res, 400, { error: "bad_request" });
      }
      const args =
        typeof p.args === "object" && p.args !== null && !Array.isArray(p.args) ? p.args : {};
      const r = await sidecarJson("POST", "/brain/tool", { name: p.name, args });
      log(
        `[voice] ${auth.device.label}: brain ${p.name} ${r?.status ?? "unreachable"} in ${Date.now() - started} ms`,
      );
      if (!r || r.status >= 500) return json(res, 503, { error: "brain_unavailable" });
      const answer = (r.body ?? {}) as { result?: unknown; error?: unknown };
      if (r.status === 200 && typeof answer.result === "string") {
        return json(res, 200, { result: answer.result });
      }
      return json(res, 200, {
        error: typeof answer.error === "string" ? answer.error : "The Brain didn't accept that.",
      });
    }
    // The files agents made, for her voice (list_files, read_file): any
    // paired device, as with /kleio/sessions. Every argument came from the
    // voice model, so each is checked here; names, paths and text are never logged.
    if (path === "/kleio/voice/files" || path === "/kleio/voice/files/read") {
      const read = path === "/kleio/voice/files/read";
      if (req.method !== (read ? "POST" : "GET")) {
        res.setHeader("allow", read ? "POST" : "GET");
        return json(res, 405, { error: "method not allowed" });
      }
      const started = Date.now();
      let source = "unknown";
      let outcome: Result<unknown, FilesFailure>;
      if (!read) {
        const s = url.searchParams.get("source");
        if (isFilesSource(s)) {
          source = s;
          const listed = await listAgentFiles(s, url.searchParams.get("id"));
          outcome = listed.ok ? ok({ files: listed.value }) : listed;
        } else outcome = filesFail(400, "bad_request");
      } else {
        const body = await readBody(req, 4 * 1024);
        let q: FileReadRequest | null = null;
        if (body !== null) {
          try {
            q = parseFileRead(JSON.parse(body.toString("utf8")));
          } catch {
            q = null;
          }
        }
        if (body === null) outcome = filesFail(413, "too_large");
        else if (q === null) outcome = filesFail(400, "bad_request");
        else {
          source = q.source;
          outcome = await readAgentFile(q);
        }
      }
      const status = outcome.ok ? 200 : outcome.error.status;
      log(
        `[voice] ${auth.device.label}: files ${source} ${read ? "read" : "list"} ${status} in ${Date.now() - started} ms`,
      );
      if (outcome.ok) return json(res, 200, outcome.value);
      const e = outcome.error;
      return json(res, e.status, {
        error: e.error,
        ...(e.parts !== undefined ? { parts: e.parts } : {}),
      });
    }
    // Saved chats and coding sessions, read-only, for her voice: GET
    // /kleio/sessions?kind=chat|code lists the newest, GET
    // /kleio/sessions/<id>?kind=… reads one's latest messages. Any paired
    // device, as with specialists and groups (saved-sessions.ts).
    if (path === "/kleio/sessions" || path.startsWith("/kleio/sessions/")) {
      if (req.method !== "GET") {
        res.setHeader("allow", "GET");
        return json(res, 405, { error: "method not allowed" });
      }
      const kind = url.searchParams.get("kind");
      const id = path === "/kleio/sessions" ? null : path.slice("/kleio/sessions/".length);
      if (!isSavedSessionKind(kind) || (id !== null && !isSessionId(id))) {
        return json(res, 400, { error: "bad_request" });
      }
      const started = Date.now();
      const r = await sidecarJson(
        "GET",
        id === null
          ? `/stored-sessions?kind=${kind}&limit=${SIDECAR_LIST_LIMIT}`
          : `/stored-sessions/${id}?kind=${kind}`,
        undefined,
        15_000,
      );
      log(
        `[voice] ${auth.device.label}: ${kind} ${id === null ? "list" : "read"} ${r?.status ?? "unreachable"} in ${Date.now() - started} ms`,
      );
      if (!r || r.status >= 500) return json(res, 503, { error: "sessions_unavailable" });
      const homeCwd = options.homeCwd;
      const kleios = (cwd: string): boolean => homeCwd !== undefined && holds(homeCwd, cwd);
      if (id === null) {
        if (r.status !== 200) return json(res, 502, { error: "sidecar error" });
        return json(res, 200, {
          sessions: savedSessionList(r.body, kind, kleios, SAVED_LIST_MAX),
        });
      }
      const read = r.status === 200 ? savedSessionRead(r.body, kind, kleios) : null;
      return read ? json(res, 200, read) : json(res, 404, { error: "not_found" });
    }
    // Kleio's projects, for her voice (projects.ts): GET /kleio/projects lists
    // them, GET /kleio/projects?name= tells one's status (what a coding agent
    // is doing in it now, its newest sessions and latest messages, its
    // documents), POST /kleio/projects { name } makes a new one, and POST
    // /kleio/projects/code { name, prompt } starts coding work in one. Any
    // paired device, as a Code session through the proxy is.
    if (path === "/kleio/projects" || path === "/kleio/projects/code") {
      const roots = options.workspaceRoots ? await options.workspaceRoots() : [];
      if (roots.length === 0) return json(res, 404, { error: "not_found" });
      const since = Date.now();
      const done = (what: string, status: number): void =>
        log(`[projects] ${auth.device.label}: ${what} ${status} in ${Date.now() - since} ms`);
      const scan = await projectScan();
      if (path === "/kleio/projects/code" || req.method === "POST") {
        if (req.method !== "POST") {
          res.setHeader("allow", "POST");
          return json(res, 405, { error: "method not allowed" });
        }
        const code = path === "/kleio/projects/code";
        const body = await readBody(req, 16 * 1024);
        if (body === null) return json(res, 413, { error: "body too large" });
        if (code) {
          const parsed = parseStartCode(body.toString("utf8"));
          if (!parsed.ok) return json(res, 400, { error: "bad_request", detail: parsed.error });
          const project = await findProject(roots, parsed.value.name, scan);
          if (!project) {
            done("code", 404);
            return json(res, 404, { error: "not_found" });
          }
          const r = await background(
            started.startCode({
              prompt: parsed.value.prompt,
              cwd: project.dir,
              project: project.name,
            }),
          );
          done("code", r.ok ? 200 : r.error.status);
          return r.ok
            ? json(res, 200, { project: project.name, sessionId: r.value.sessionId })
            : json(res, r.error.status, r.error.body);
        }
        const parsed = parseNewProject(body.toString("utf8"));
        if (!parsed.ok) return json(res, 400, { error: "bad_request", detail: parsed.error });
        const made = await background(createProject(roots, parsed.value, scan));
        const status = made.ok ? 200 : made.error === "exists" ? 409 : 404;
        done("create", status);
        if (!made.ok)
          return json(res, status, { error: made.error === "exists" ? "exists" : "not_found" });
        return json(res, 200, { name: made.value.name });
      }
      if (req.method !== "GET") {
        res.setHeader("allow", "GET, POST");
        return json(res, 405, { error: "method not allowed" });
      }
      const name = url.searchParams.get("name");
      if (name !== null && !isProjectName(name)) return json(res, 400, { error: "bad_request" });
      const listed = await sidecarJson(
        "GET",
        `/stored-sessions?kind=code&limit=${SIDECAR_LIST_LIMIT}`,
        undefined,
        15_000,
      );
      if (!listed || listed.status >= 500) {
        done(name === null ? "list" : "status", 503);
        return json(res, 503, { error: "projects_unavailable" });
      }
      if (listed.status !== 200) return json(res, 502, { error: "sidecar error" });
      const rows = savedRows(listed.body);
      const jobs = codeJobs();
      if (name === null) {
        const projects = projectSummaries(await projectFolders(roots, scan), rows, jobs);
        done("list", 200);
        return json(res, 200, { projects });
      }
      const project = await findProject(roots, name, scan);
      if (!project) {
        done("status", 404);
        return json(res, 404, { error: "not_found" });
      }
      // Its latest update: the newest session's latest prompts and replies.
      const newest = newestSession(project, rows);
      const homeCwd = options.homeCwd;
      const kleios = (cwd: string): boolean => homeCwd !== undefined && holds(homeCwd, cwd);
      const read =
        newest !== null && isSessionId(newest)
          ? await sidecarJson("GET", `/stored-sessions/${newest}?kind=code`, undefined, 15_000)
          : null;
      const latest = read?.status === 200 ? savedSessionRead(read.body, "code", kleios) : null;
      const docs = newestFirst((await projectDocs(project.real)).map((f) => toEntry(f)));
      done("status", 200);
      return json(res, 200, {
        ...projectStatus(project, rows, jobs),
        ...(latest ? { latest } : {}),
        docs: docs.slice(0, STATUS_DOCS_MAX),
      });
    }
    // A specialist's latest messages, for her voice's read_specialist: read
    // from its saved conversation (the sidecar's listing, found by its folder),
    // so no session is opened for it. Any paired device, like its runs.
    const specialist = path.match(/^\/kleio\/blobs\/(b_[0-9a-f]{8})\/messages$/);
    if (specialist && blobs && options.homeCwd !== undefined) {
      if (req.method !== "GET") {
        res.setHeader("allow", "GET");
        return json(res, 405, { error: "method not allowed" });
      }
      const blobId = specialist[1] ?? "";
      if (!(await blobs.find(blobId))) return json(res, 404, { error: "no such agent" });
      const since = Date.now();
      const r = await threadMessages(join(options.homeCwd, "blobs", blobId));
      log(
        `[voice] ${auth.device.label}: specialist messages ${r.ok ? 200 : 503} in ${Date.now() - since} ms`,
      );
      return r.ok
        ? json(res, 200, r.value ?? { messages: [] })
        : json(res, 503, { error: "sessions_unavailable" });
    }
    if (path === "/kleio/voice/key" || path === "/kleio/voice/settings") {
      if (!auth.admin) return json(res, 403, { error: "forbidden" });
      const body = await readBody(req, 2 * 1024);
      if (body === null) return json(res, 413, { error: "too_large" });
      let p: Record<string, unknown> = {};
      if (body.length) {
        try {
          const parsed: unknown = JSON.parse(body.toString("utf8"));
          if (typeof parsed === "object" && parsed !== null) p = parsed as Record<string, unknown>;
        } catch {
          return json(res, 400, { error: "bad_request" });
        }
      }
      if (path === "/kleio/voice/key" && req.method === "POST") {
        if (typeof p.key !== "string") return json(res, 400, { error: "bad_request" });
        const r = await voice.setKey(p.key);
        if (!r.ok) {
          return json(res, voiceErrorStatus(r.error), {
            error: r.error.kind,
            ...voiceErrorDetail(r.error),
          });
        }
        log(`[voice] ${auth.device.label} saved the OpenAI key`);
        return json(res, 200, await voice.status());
      }
      if (path === "/kleio/voice/key" && req.method === "DELETE") {
        await voice.removeKey();
        log(`[voice] ${auth.device.label} removed the OpenAI key`);
        return json(res, 200, await voice.status());
      }
      if (path === "/kleio/voice/settings" && req.method === "POST") {
        const voiceName = p.voice === undefined ? undefined : p.voice;
        const speed = p.speed === undefined ? undefined : p.speed;
        if (voiceName === undefined && speed === undefined) {
          return json(res, 400, { error: "bad_request" });
        }
        if (voiceName !== undefined && !isVoiceName(voiceName)) {
          return json(res, 400, { error: "bad_request" });
        }
        if (speed !== undefined && !isSpeed(speed)) return json(res, 400, { error: "bad_request" });
        await voice.setSettings({
          ...(voiceName !== undefined ? { voice: voiceName } : {}),
          ...(speed !== undefined ? { speed } : {}),
        });
        return json(res, 200, await voice.status());
      }
      return json(res, 405, { error: "method_not_allowed" });
    }

    // The pinned home thread. Any paired device, not admin-only: it is the
    // conversation every device opens.
    if (req.method === "GET" && path === "/kleio/home") {
      if (!home) return json(res, 404, { error: "not_found" });
      const r = await background(home.resolve());
      return r.ok ? json(res, 200, r.value) : json(res, 502, r.error);
    }

    // Start a fresh home conversation; every device follows on its next
    // GET /kleio/home. Same shape as GET, created: true.
    if (req.method === "POST" && path === "/kleio/home/new") {
      if (!home) return json(res, 404, { error: "not_found" });
      const r = await background(home.startNew());
      return r.ok ? json(res, 200, r.value) : json(res, 502, r.error);
    }

    // Start a chat that works on its own (voice's start_chat). Any paired
    // device, like the home thread.
    if (path === "/kleio/chats") {
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        return json(res, 405, { error: "method not allowed" });
      }
      const body = await readBody(req, 16 * 1024);
      if (body === null) return json(res, 413, { error: "body too large" });
      const parsed = parseStartChat(body.toString("utf8"));
      if (!parsed.ok) return json(res, 400, { error: "bad_request", detail: parsed.error });
      const r = await background(started.start(parsed.value));
      return r.ok ? json(res, 200, r.value) : json(res, r.error.status, r.error.body);
    }

    // Mint a link that opens an agent-written web page on the preview origin
    // (preview.ts). Any paired device that may read the page's files. The
    // token covers the page's folder, or only the page itself when that folder
    // is (or holds) one of Kleio's projects folders, so a Chat report never
    // exposes every project beside it.
    if (path === "/kleio/previews") {
      if (!previews || !previewBase) return json(res, 404, { error: "not_found" });
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        return json(res, 405, { error: "method not allowed" });
      }
      const body = await readBody(req, 16 * 1024);
      if (body === null) return json(res, 413, { error: "bad_request" });
      let parsed: { owner?: unknown; path?: unknown };
      try {
        parsed = JSON.parse(body.toString("utf8")) as typeof parsed;
      } catch {
        return json(res, 400, { error: "bad_request" });
      }
      const owner = parseFileOwner(parsed?.owner);
      if (!owner || typeof parsed.path !== "string")
        return json(res, 400, { error: "bad_request" });
      const root = await ownerRoot(owner);
      if (!root.ok) return json(res, root.error[0], { error: root.error[1] });
      const r = await resolveAgentFile(root.value.root, parsed.path);
      if (!r.ok) {
        const [status, error] = fileErrorStatus(r.error);
        return json(res, status, { error });
      }
      const ext = extname(r.value.name).toLowerCase();
      if (ext !== ".html" && ext !== ".htm") return json(res, 400, { error: "not_a_site" });
      const siteRoot = dirname(r.value.path);
      const roots = options.workspaceRoots ? await realRoots(await options.workspaceRoots()) : [];
      const single = roots.some((ws) => holds(siteRoot, ws));
      const minted = previews.mint({
        deviceId: auth.device.deviceId,
        siteRoot,
        ...(single ? { onlyFile: r.value.path } : {}),
      });
      log(
        `[preview] ${auth.device.label} ${ownerLabel(owner)} ${single ? "page" : "site"} ${JSON.stringify(r.value.name.slice(0, 200))}`,
      );
      return json(res, 200, {
        url: `${previewBase}/p/${minted.token}/${encodeURIComponent(basename(r.value.path))}`,
        expiresAt: minted.expiresAt.toISOString(),
      });
    }

    // An agent's files (the reports it writes and links in chat), and a Chat or
    // Code session's files under Kleio's projects folders. Any paired device,
    // like Blobs; GET only; files.ts decides what may be read.
    const owner = fileOwnerOf(path, url.searchParams);
    if (owner && (owner.owner.kind === "workspace" || (blobs && groups))) {
      const started = Date.now();
      let outcome: [number, number] = [500, 0];
      try {
        outcome = await (async (): Promise<[number, number]> => {
          if (req.method !== "GET") {
            res.setHeader("allow", "GET");
            json(res, 405, { error: "method not allowed" });
            return [405, 0];
          }
          const root = await ownerRoot(owner.owner);
          if (!root.ok) {
            json(res, root.error[0], { error: root.error[1] });
            return [root.error[0], 0];
          }
          const r = await resolveAgentFile(root.value.root, owner.rest);
          if (!r.ok) {
            const [status, error] = fileErrorStatus(r.error);
            json(res, status, { error });
            return [status, 0];
          }
          return sendAgentFile(res, r.value);
        })();
      } finally {
        log(
          `[files] ${auth.device.label} ${ownerLabel(owner.owner)} → ${outcome[0]} ${outcome[1]}B ${Date.now() - started}ms`,
        );
      }
      return;
    }

    // Blobs and the model list. Any paired device, like the home thread.
    if (blobs) {
      const r = await background(
        blobs.route(req.method ?? "GET", path, async () => {
          const body = await readBody(req, 64 * 1024);
          try {
            return body && body.length ? (JSON.parse(body.toString("utf8")) as unknown) : {};
          } catch {
            return undefined;
          }
        }),
      );
      if (r) return json(res, r.status, r.body);
    }

    // App connections (Composio). Any paired device.
    if (connections) {
      const r = await background(
        connections.route(req.method ?? "GET", path, url.searchParams, async () => {
          const body = await readBody(req, 16 * 1024);
          try {
            return body && body.length ? (JSON.parse(body.toString("utf8")) as unknown) : {};
          } catch {
            return undefined;
          }
        }),
      );
      if (r) return json(res, r.status, r.body);
    }

    // Group chats. Any paired device, like Blobs.
    if (groups) {
      const r = await background(
        groups.route(req.method ?? "GET", path, url.searchParams, async () => {
          const body = await readBody(req, 64 * 1024);
          try {
            return body && body.length ? (JSON.parse(body.toString("utf8")) as unknown) : {};
          } catch {
            return undefined;
          }
        }),
      );
      if (r) return json(res, r.status, r.body);
    }

    if (path.startsWith("/kleio/")) {
      if (!auth.admin) return json(res, 403, { error: "forbidden" });
      if (req.method === "GET" && path === "/kleio/devices")
        return json(res, 200, { devices: registry.list() });
      const revoke = path.match(/^\/kleio\/devices\/([A-Za-z0-9-]+)\/revoke$/);
      if (req.method === "POST" && revoke) {
        const r = await registry.revoke(revoke[1]!);
        if (!r.ok)
          return json(res, r.error.kind === "not_found" ? 404 : 500, { error: r.error.message });
        const cut = dropStreams(revoke[1]!);
        liveActivities.dropDevice(revoke[1]!);
        log(`[admin] ${auth.device.label} revoked ${revoke[1]} (${cut} open stream(s) closed)`);
        return json(res, 200, { devices: r.value });
      }
      if (req.method === "POST" && path === "/kleio/pair/offer") {
        const body = await readBody(req, 1024);
        let admin = false;
        if (body && body.length) {
          try {
            admin = (JSON.parse(body.toString("utf8")) as { admin?: unknown }).admin === true;
          } catch {
            return json(res, 400, { error: "bad_request" });
          }
        }
        const offer = offers.offer(mintPayloadFor(admin), { admin });
        log(`[admin] ${auth.device.label} minted a pair offer (admin=${admin})`);
        return json(res, 200, {
          code: offer.code,
          display: formatPairCode(offer.code),
          expiresAt: offer.expiresAt,
          admin,
        });
      }
      if (req.method === "POST" && path === "/kleio/pair/revoke") {
        offers.revoke();
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && path === "/kleio/pair") return json(res, 200, offers.peek());
      return json(res, 404, { error: "not found" });
    }

    if (req.method === "GET" && path === "/events")
      return handleEvents(req, res, url, auth.device.deviceId);
    // A device opening a voice-started chat from Chats gets its live session,
    // not a second one on the same transcript. With none waiting, the body is
    // not touched here.
    if (req.method === "POST" && path === "/session" && started.pending()) {
      const body = await readBody(req, PROXY_BODY_MAX);
      if (body === null) return json(res, 413, { error: "body too large" });
      const adopted = await background(started.adopt(body));
      if (adopted) return json(res, 200, { sessionId: adopted });
      return proxy(req, res, url, body);
    }
    // Removing a voice-started chat nobody opened: release its idle session so
    // the sidecar can delete the transcript; a running one is refused here.
    if (req.method === "POST" && path === "/sessions/delete" && started.pending()) {
      const body = await readBody(req, PROXY_BODY_MAX);
      if (body === null) return json(res, 413, { error: "body too large" });
      const r = await background(started.release(body));
      if (r === "running")
        return json(res, 409, {
          error: "This chat is still working. Try again when it has finished.",
        });
      return proxy(req, res, url, body);
    }
    return proxy(req, res, url);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log(`[host] ${req.method} ${req.url} failed: ${String(e)}`);
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else res.destroy();
    });
  });
  server.keepAliveTimeout = 65_000;

  /** Listen on the preview port, if there is one; sets previewBase when it was not given. */
  function startPreview(): Promise<void> {
    const ps = previewServer;
    if (!ps) return Promise.resolve();
    const host = options.listenHost ?? "127.0.0.1";
    return new Promise((resolve, reject) => {
      ps.once("error", reject);
      ps.listen(options.previewPort, host, () => {
        ps.off("error", reject);
        const address = ps.address();
        const port = typeof address === "object" && address ? address.port : options.previewPort;
        previewBase ??= `http://${host}:${port}`;
        log(`[preview] listening on http://${host}:${port}`);
        resolve();
      });
    });
  }

  return {
    server,
    previewServer,
    start: async () => {
      await startPreview();
      await briefing.load();
      await new Promise<void>((resolve, reject) => {
        const failed = (e: Error): void => {
          // No API, no point serving previews: free the port for the next try.
          previewServer?.close();
          reject(e);
        };
        server.once("error", failed);
        server.listen(options.listenPort, options.listenHost ?? "127.0.0.1", () => {
          server.off("error", failed);
          log(
            `[host] listening on http://${options.listenHost ?? "127.0.0.1"}:${options.listenPort}`,
          );
          void resumeTracked()
            .then(resumeHome)
            .then(() => {
              const every = options.routinePollMs ?? 30_000;
              if (every > 0) {
                void trackRoutineSessions().catch(() => {});
                routinePoll = setInterval(() => void trackRoutineSessions().catch(() => {}), every);
                routinePoll.unref();
              }
              resolve();
            }, resolve);
        });
      });
    },
    stop: () =>
      new Promise((resolve) => {
        stopped = true;
        liveActivities.stop();
        askNotifier.stop();
        started.stop();
        if (routinePoll) clearInterval(routinePoll);
        routinePoll = null;
        if (routineWake) clearTimeout(routineWake);
        routineWake = null;
        if (blobTicker) clearInterval(blobTicker);
        blobTicker = null;
        for (const s of live.values()) {
          s.upstream?.destroy();
          for (const sub of s.subs) sub.destroy();
        }
        // close() alone waits for idle keep-alive sockets to time out (65 s here,
        // and slow to notice on Windows). Drop them: a stopping host has nothing
        // more to say, and clients reconnect with Last-Event-ID anyway.
        const closed = Promise.all(
          [server, previewServer].map((s) => {
            if (!s?.listening) return;
            const done = new Promise<void>((r) => s.close(() => r()));
            s.closeAllConnections();
            return done;
          }),
        );
        // Ring appends are queued, not awaited, on the hot path. A host that
        // resolves stop() with writes still in flight hands its successor a
        // file another handle is mid-append on — fine on POSIX, a stall or a
        // lost line on Windows (reproduced: the successor's readFile never
        // returned). Let them land first, within the same 2 s stop budget.
        const flushed = Promise.allSettled(rings.loaded().map((r) => r.flush()));
        const written = Promise.allSettled([
          ...inflight,
          home?.flush(),
          blobs?.flush(),
          groups?.flush(),
          briefing.flush(),
        ]);
        void Promise.all([closed, flushed, written]).then(() => resolve());
        setTimeout(resolve, 2000).unref();
      }),
  };
}
