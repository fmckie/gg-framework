// Typed client for the Kleio host's device-authenticated product routes: the
// pinned home thread, Blobs, groups and app connections. Every call goes
// through the Rust `kleio_api` command, which holds the device token, enforces
// the route allow-list and only exists in remote mode — the webview never sees
// a credential. Shapes mirror kleio-next/.gg/plans/blobs-b1.md §2 and
// blobs-b2-b4.md §2–4; the iPhone app reads the same data, so both stay in sync.

import { invoke } from "@tauri-apps/api/core";
import type { HistoryEntry, MemorySnapshot } from "../agent";
import type { AskAnswers } from "../ask-user";
import type { BlobFaceKind, BlobShape } from "./blobLook";

// ─── shapes ─────────────────────────────────────────────────────────────────

/** The first six are the original palette; hosts before agent looks accept only those. */
export const BLOB_COLORS = [
  "sky",
  "mint",
  "peach",
  "lilac",
  "lemon",
  "rose",
  "coral",
  "amber",
  "teal",
  "indigo",
  "plum",
  "slate",
] as const;
export type BlobColor = (typeof BLOB_COLORS)[number];

/** `GET /kleio/home`, `GET /kleio/blobs/:id/session` and their `…/new`. */
export interface ThreadSession {
  sessionId: string;
  sessionPath: string | null;
  created: boolean;
  agent?: string;
}

export type ScheduleKind = "interval" | "daily" | "weekly" | "once";

export interface ScheduleLastRun {
  at: string;
  outcome: "ran" | "skipped" | "error";
  error?: string;
}

export interface Schedule {
  id: string;
  label: string;
  prompt: string;
  kind: ScheduleKind;
  /** interval only, ≥ 15. */
  everyMinutes?: number;
  /** "HH:MM", daily/weekly. */
  time?: string;
  /** weekly, 0 = Sunday … 6 = Saturday. */
  days?: number[];
  /** once: ISO instant. */
  at?: string;
  timezone: string;
  enabled: boolean;
  notify: boolean;
  nextRunAt: string | null;
  lastRun?: ScheduleLastRun;
  /** Server-set; absent on hosts before auto-schedules (read as "manual"). */
  source?: "auto" | "manual";
}

/** `POST …/schedules` body; id/nextRunAt/lastRun/source are server-set. */
export interface ScheduleInput {
  label: string;
  prompt: string;
  kind: ScheduleKind;
  everyMinutes?: number;
  time?: string;
  days?: number[];
  at?: string;
  timezone?: string;
  enabled?: boolean;
  notify?: boolean;
}

export interface Run {
  id: string;
  blobId: string;
  scheduleId: string | null;
  label: string;
  startedAt: string;
  endedAt?: string;
  outcome: "ok" | "error" | "skipped";
  summary?: string;
  error?: string;
}

/** BlobView: the stored Blob minus sessionPath, plus live state. */
export interface Blob {
  id: string;
  name: string;
  /** Kept for the iPhone app; the desktop draws `shape` + `face` instead. */
  emoji: string;
  color: BlobColor;
  /** Absent on hosts before agent looks: use `lookOf()` (blobLook.ts). */
  shape?: BlobShape;
  face?: BlobFaceKind;
  job: string;
  /** null = the host's default Blob model. */
  model: string | null;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  schedules: Schedule[];
  running: boolean;
  lastRun?: Run;
}

export interface BlobInput {
  name: string;
  job: string;
  emoji?: string;
  color?: BlobColor;
  shape?: BlobShape;
  face?: BlobFaceKind;
  model?: string | null;
  /** IANA zone for auto-extracted schedules. */
  timezone?: string;
  /** Default true on the host. */
  autoSchedule?: boolean;
}

export type BlobPatch = Partial<BlobInput>;

export interface AutoSchedules {
  status: "ok" | "none" | "failed";
  count: number;
  error?: string;
}

/** Create/patch reply. `autoSchedules` is absent on older hosts, and on a
 *  patch that didn't touch the job. */
export interface BlobSaved {
  blob: Blob;
  autoSchedules?: AutoSchedules;
}

export interface KleioModel {
  id: string;
  label: string;
  /** Runs on a private provider (Tinfoil/Ollama). Listed first by the host. */
  private: boolean;
}

export interface ModelList {
  models: KleioModel[];
  defaultBlobModel: string;
}

export interface GroupMessage {
  seq: number;
  id: string;
  /** "you" or a Blob id. */
  author: string;
  authorName: string;
  emoji: string;
  text: string;
  at: string;
}

export interface Group {
  id: string;
  name: string;
  emoji: string;
  color: BlobColor;
  /** Blob ids, 1–8. */
  members: string[];
  createdAt: string;
  updatedAt: string;
  /** Blob ids whose turn is running. */
  typing: string[];
  lastMessage?: GroupMessage;
  /** The last seq of the conversation a new session cleared (absent: never). */
  clearedThrough?: number;
}

export interface GroupInput {
  name: string;
  members: string[];
  emoji?: string;
  color?: BlobColor;
}

export type GroupPatch = Partial<GroupInput>;

/**
 * One tool call of an agent's current or last turn (a group member's, or a
 * specialist's in its own chat): a summary, never its output.
 */
export interface ToolActivityEntry {
  /** The tool call id. */
  id: string;
  name: string;
  /** One clipped line from the args: a command, path, query… or "". */
  summary: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  endedAt?: string;
}

export type GroupTurnOutcomeKind =
  | "replied"
  | "passed"
  | "timed_out"
  | "failed"
  | "unavailable"
  /** The group spent its turns for the message before this member's came. */
  | "budget_exhausted";

/** How a member's last turn ended; cleared while its next turn runs. */
export interface GroupTurnOutcome {
  kind: GroupTurnOutcomeKind;
  /** Short and human ("took over 2 min"); "" for a reply. */
  reason: string;
}

export interface GroupMessagesPage {
  /** Oldest first. */
  messages: GroupMessage[];
  typing: string[];
  lastSeq: number;
  /**
   * Blob id → the tool calls of its current or last turn, oldest first. Held in
   * the host's memory only; absent from older hosts.
   */
  activity?: Record<string, ToolActivityEntry[]>;
  /** Blob id → how its last turn ended. Absent from older hosts. */
  outcomes?: Record<string, GroupTurnOutcome>;
  /**
   * A new session cleared messages up to this seq: a device showing older
   * ones drops them. Absent until the group's first new session.
   */
  clearedThrough?: number;
  /** Blob id → the question it's waiting on you to answer. Absent from older hosts. */
  asks?: Record<string, unknown>;
}

export interface Connection {
  id: string;
  toolkit: string;
  name: string;
  /** Composio's free-form logo link; null when it has none. Not rendered. */
  logo: string | null;
  status: string;
  createdAt: string;
}

export interface ConnectionList {
  configured: boolean;
  connections: Connection[];
}

/**
 * How an app connects: "none" needs no sign-in (agents can use it already);
 * "signin" opens a sign-in in the browser; "setup" needs the user's own
 * developer keys in Composio first. Hosts before this send nothing.
 */
export type ToolkitAuth = "none" | "signin" | "setup";

export interface Toolkit {
  slug: string;
  name: string;
  /** Composio's free-form logo link; null when it has none. Not rendered. */
  logo: string | null;
  description: string;
  categories: string[];
  auth?: ToolkitAuth;
}

export interface ToolkitPage {
  toolkits: Toolkit[];
  nextCursor: string | null;
}

export interface ConnectStart {
  redirectUrl: string;
  connectionId: string;
}

/** One job in a "Brief me" briefing (the host's brief.ts), in the order it is said. */
export interface BriefItem {
  target: string;
  kind: "chat" | "code" | "specialist" | "group";
  /** How the briefing names it: "Code in gg-framework", "The Launch group". */
  name: string;
  phase: "working" | "needsYou" | "done" | "failed" | "stopped";
  /** Its question, how it ended, or what it is doing. */
  detail?: string;
  /** Unix seconds: when it ended, or when it started. */
  at: number;
}

/** What needs you, what finished, what is still working: words to read aloud. */
export interface Brief {
  spoken: string;
  items: BriefItem[];
  since: number;
  at: number;
}

/** The slice of the sidecar's `GET /state` the compact chat view needs. */
export interface ThreadState {
  running: boolean;
  runState?: "idle" | "running" | "cancelling";
  model?: string;
  provider?: string;
  /** Questions the agent is waiting on you to answer (`ask_user`), oldest first. */
  pendingAsks?: unknown[];
}

// ─── transport ──────────────────────────────────────────────────────────────

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RawResponse {
  status: number;
  body: unknown;
}

/** A non-2xx host reply. `status` 0 = never reached the host. */
export class KleioApiError extends Error {
  readonly status: number;
  readonly detail?: string;
  /** A machine-readable reason the host sent, e.g. "needs_setup". */
  readonly code?: string;
  constructor(status: number, message: string, detail?: string, code?: string) {
    super(message);
    this.name = "KleioApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

/** A failed call, in words for the page. */
export function errorText(e: unknown): string {
  if (e instanceof KleioApiError) return e.detail ? `${e.message}: ${e.detail}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

function errorFrom(status: number, body: unknown): KleioApiError {
  const o = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const msg = typeof o.error === "string" ? o.error : `request failed (HTTP ${status})`;
  const detail = typeof o.detail === "string" ? o.detail : undefined;
  const code = typeof o.code === "string" ? o.code : undefined;
  return new KleioApiError(status, msg, detail, code);
}

async function call<T>(method: Method, path: string, body?: unknown, session?: string): Promise<T> {
  let res: RawResponse;
  try {
    res = await invoke<RawResponse>("kleio_api", {
      method,
      path,
      body: body ?? null,
      session: session ?? null,
    });
  } catch (e) {
    throw new KleioApiError(0, e instanceof Error ? e.message : String(e));
  }
  if (res.status < 200 || res.status >= 300) throw errorFrom(res.status, res.body);
  return res.body as T;
}

/** Strict percent-encoding: the Rust allow-list only admits unreserved chars
 *  and `%XX` escapes, so `!'()*` (left bare by encodeURIComponent) are escaped. */
function enc(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function query(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== "")
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

const blobPath = (id: string): string => `/kleio/blobs/${enc(id)}`;
const groupPath = (id: string): string => `/kleio/groups/${enc(id)}`;

/** Stops every reply in progress in a group and clears its queue. */
export const stopGroup = async (id: string): Promise<void> => {
  await call("POST", `${groupPath(id)}/stop`);
};

// ─── host health ────────────────────────────────────────────────────────────

/** The engine's state behind the host: `up`, `stale` (its record outlived it), `down`. */
export type SidecarHealth = "up" | "stale" | "down";

export interface HostHealth {
  sidecar: SidecarHealth;
  /** Paired devices that are not revoked. */
  devices: number;
  /** Round trip for this call, measured here. */
  latencyMs: number;
}

export const hostHealth = async (): Promise<HostHealth> => {
  const started = performance.now();
  const body = await call<Record<string, unknown>>("GET", "/kleio/health");
  const latencyMs = Math.round(performance.now() - started);
  const sidecar = body.sidecar === "up" || body.sidecar === "stale" ? body.sidecar : "down";
  const devices = typeof body.devices === "number" ? body.devices : 0;
  return { sidecar, devices, latencyMs };
};

// ─── home thread ────────────────────────────────────────────────────────────

export const getHome = (): Promise<ThreadSession> => call("GET", "/kleio/home");
export const newHome = (): Promise<ThreadSession> => call("POST", "/kleio/home/new");

/** Who runs a chat started by voice. */
export type ChatAgent = "general" | "research";

/** Starts a new chat on the Mac (it shows in Chats; a push comes when it's done). */
export const startChat = (prompt: string, agent: ChatAgent): Promise<{ sessionId: string }> =>
  call("POST", "/kleio/chats", { prompt, agent });

// ─── "Brief me" ──────────────────────────────────────────────────────────────────────

/** The briefing since you were last briefed; `all` repeats the last day's news. */
export const getBrief = (all = false): Promise<Brief> =>
  call("POST", "/kleio/brief", all ? { all: true } : {});

// ─── Kleio's voice (OpenAI Realtime, kleio-host voice.ts) ─────────────────────────────────

export interface VoiceStatus {
  /** An OpenAI key is saved on the Mac mini: conversations can start. */
  ready: boolean;
  voice: string;
  model: string;
  voices: string[];
  /** Her speaking pace: 1 is the voice's own, 1.5 the fastest. */
  speed: number;
}

export const getVoiceStatus = (): Promise<VoiceStatus> => call("GET", "/kleio/voice");
/** Checks the key with OpenAI, then saves it on the Mac mini (admin devices only). */
export const setVoiceKey = (key: string): Promise<VoiceStatus> =>
  call("POST", "/kleio/voice/key", { key });
export const removeVoiceKey = (): Promise<VoiceStatus> => call("DELETE", "/kleio/voice/key");
export const setVoiceName = (voice: string): Promise<VoiceStatus> =>
  call("POST", "/kleio/voice/settings", { voice });

/**
 * Runs one of the Brain's tools (remember, forget, set_jiwa…) on the Mac
 * mini, as text chat does: `{ result }` when it worked, `{ error }` when the
 * Brain said no (a limit, an unknown id). Throws only when it can't be reached.
 */
export const runBrainTool = (
  name: string,
  args: Record<string, unknown>,
): Promise<{ result?: string; error?: string }> =>
  call("POST", "/kleio/voice/brain", { name, args });

/**
 * Sends this device's WebRTC offer; the Mac mini returns OpenAI's answer.
 * `mic`: near (a phone or headset) or far (a laptop or desk microphone).
 */
export async function startVoiceCall(offerSdp: string, mic: "near" | "far"): Promise<string> {
  let res: RawResponse;
  try {
    res = await invoke<RawResponse>("kleio_voice_call", { sdp: offerSdp, mic });
  } catch (e) {
    throw new KleioApiError(0, e instanceof Error ? e.message : String(e));
  }
  if (res.status < 200 || res.status >= 300) throw errorFrom(res.status, res.body);
  if (typeof res.body !== "string" || !res.body.startsWith("v=")) {
    throw new KleioApiError(res.status, "bad_answer");
  }
  return res.body;
}

// ─── Blobs ──────────────────────────────────────────────────────────────────

export const listBlobs = async (): Promise<Blob[]> =>
  (await call<{ blobs: Blob[] }>("GET", "/kleio/blobs")).blobs;

export const getBlob = async (id: string): Promise<Blob> =>
  (await call<{ blob: Blob }>("GET", blobPath(id))).blob;

export const createBlob = (input: BlobInput): Promise<BlobSaved> =>
  call("POST", "/kleio/blobs", input);

export const updateBlob = (id: string, patch: BlobPatch): Promise<BlobSaved> =>
  call("PATCH", blobPath(id), patch);

export const deleteBlob = async (id: string): Promise<void> => {
  await call("DELETE", blobPath(id));
};

export const getBlobSession = (id: string): Promise<ThreadSession> =>
  call("GET", `${blobPath(id)}/session`);

export const newBlobSession = (id: string): Promise<ThreadSession> =>
  call("POST", `${blobPath(id)}/new`);

export const listRuns = async (id: string): Promise<Run[]> =>
  (await call<{ runs: Run[] }>("GET", `${blobPath(id)}/runs`)).runs;

/** The tool calls of the agent's run in progress; none between runs. */
export const getBlobActivity = async (id: string): Promise<ToolActivityEntry[]> =>
  (await call<{ activity: ToolActivityEntry[] }>("GET", `${blobPath(id)}/activity`)).activity;

export const addSchedule = async (id: string, input: ScheduleInput): Promise<Schedule> =>
  (await call<{ schedule: Schedule }>("POST", `${blobPath(id)}/schedules`, input)).schedule;

export const updateSchedule = async (
  id: string,
  sid: string,
  patch: Partial<ScheduleInput>,
): Promise<Schedule> =>
  (await call<{ schedule: Schedule }>("PATCH", `${blobPath(id)}/schedules/${enc(sid)}`, patch))
    .schedule;

export const deleteSchedule = async (id: string, sid: string): Promise<void> => {
  await call("DELETE", `${blobPath(id)}/schedules/${enc(sid)}`);
};

export const runScheduleNow = async (id: string, sid: string): Promise<Run> =>
  (await call<{ run: Run }>("POST", `${blobPath(id)}/schedules/${enc(sid)}/run`)).run;

/** Preview of what auto-scheduling would make of `job`; no side effects. */
export const suggestSchedules = async (input: {
  job: string;
  model?: string | null;
  timezone?: string;
}): Promise<ScheduleInput[]> =>
  (await call<{ schedules: ScheduleInput[] }>("POST", "/kleio/blobs/suggest-schedules", input))
    .schedules;

export const listModels = (): Promise<ModelList> => call("GET", "/kleio/models");

// ─── groups ─────────────────────────────────────────────────────────────────

export const listGroups = async (): Promise<Group[]> =>
  (await call<{ groups: Group[] }>("GET", "/kleio/groups")).groups;

export const createGroup = async (input: GroupInput): Promise<Group> =>
  (await call<{ group: Group }>("POST", "/kleio/groups", input)).group;

export const updateGroup = async (id: string, patch: GroupPatch): Promise<Group> =>
  (await call<{ group: Group }>("PATCH", groupPath(id), patch)).group;

export const deleteGroup = async (id: string): Promise<void> => {
  await call("DELETE", groupPath(id));
};

/** Messages with `seq > after` (oldest first); poll with the last `lastSeq`. */
export const listGroupMessages = (
  id: string,
  opts: { after?: number; limit?: number } = {},
): Promise<GroupMessagesPage> =>
  call("GET", `${groupPath(id)}/messages${query({ after: opts.after, limit: opts.limit })}`);

/** Posts the user's message; Blob replies arrive via polling. */
export const sendGroupMessage = async (id: string, text: string): Promise<GroupMessage> =>
  (await call<{ message: GroupMessage }>("POST", `${groupPath(id)}/messages`, { text })).message;

/**
 * Starts the group's conversation over: the Mac mini stops any reply in
 * progress, sets the messages aside (kept on disk), and every member starts a
 * fresh conversation.
 */
export const newGroupSession = async (id: string): Promise<Group> =>
  (await call<{ group: Group }>("POST", `${groupPath(id)}/new`)).group;

// ─── app connections ────────────────────────────────────────────────────────

export const listConnections = (): Promise<ConnectionList> => call("GET", "/kleio/connections");

export const listToolkits = (
  opts: { search?: string; cursor?: string } = {},
): Promise<ToolkitPage> =>
  call("GET", `/kleio/connections/toolkits${query({ search: opts.search, cursor: opts.cursor })}`);

/** Starts an OAuth link; open `redirectUrl` in the browser, then re-list. */
export const connectToolkit = (toolkit: string): Promise<ConnectStart> =>
  call("POST", "/kleio/connections", { toolkit });

export const disconnect = async (id: string): Promise<void> => {
  await call("DELETE", `/kleio/connections/${enc(id)}`);
};

// ─── a pinned thread's sidecar session (compact chat view) ─────────────────

export const threadState = (session: string): Promise<ThreadState> =>
  call("GET", "/state", undefined, session);

export const threadHistory = async (session: string): Promise<HistoryEntry[]> =>
  (await call<{ history?: HistoryEntry[] }>("GET", "/history", undefined, session)).history ?? [];

export const threadPrompt = async (session: string, text: string): Promise<void> => {
  await call("POST", "/prompt", { text, attachments: [] }, session);
};

export const threadCancel = async (session: string): Promise<void> => {
  await call("POST", "/cancel", {}, session);
};

/** Answer (or dismiss) a question the agent is waiting on. */
export const threadAnswerAsk = async (
  session: string,
  askId: string,
  action: "answer" | "cancel",
  answers?: AskAnswers,
): Promise<void> => {
  await call("POST", `/ask/${enc(askId)}`, { action, ...(answers ? { answers } : {}) }, session);
};

/** Answer (or dismiss) a group member's question; its turn is waiting on it. */
export const answerGroupAsk = async (
  id: string,
  askId: string,
  action: "answer" | "cancel",
  answers?: AskAnswers,
): Promise<void> => {
  await call("POST", `${groupPath(id)}/ask/${enc(askId)}`, {
    action,
    ...(answers ? { answers } : {}),
  });
};

export const threadMemories = (session: string): Promise<MemorySnapshot> =>
  call("GET", "/memories", undefined, session);
