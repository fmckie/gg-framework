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
  /** The host's JSON reply, for fields beyond `error` (e.g. `parts` on a 416). */
  readonly body?: unknown;
  constructor(status: number, message: string, detail?: string, code?: string, body?: unknown) {
    super(message);
    this.name = "KleioApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.body = body;
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
  return new KleioApiError(status, msg, detail, code, body);
}

/** `timeoutMs`: give up sooner than an ordinary call's minute (a reachability check). */
async function call<T>(
  method: Method,
  path: string,
  body?: unknown,
  session?: string,
  timeoutMs?: number,
): Promise<T> {
  let res: RawResponse;
  try {
    res = await invoke<RawResponse>("kleio_api", {
      method,
      path,
      body: body ?? null,
      session: session ?? null,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
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

/** `timeoutMs`: how long to wait before calling the Mac mini unreachable. */
export const hostHealth = async (timeoutMs?: number): Promise<HostHealth> => {
  const started = performance.now();
  const body = await call<Record<string, unknown>>(
    "GET",
    "/kleio/health",
    undefined,
    undefined,
    timeoutMs,
  );
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

// ─── First-run setup (kleio-host setup routes) ───────────────────────────────────────────

/** "env": set on the host itself, so the app can't change or remove it. */
export type KeyState = "missing" | "saved" | "env";
/** The keys the app can set; OpenAI's goes through the voice routes. */
export type SetupKeyName = "composio" | "typesafe";

export interface SetupStatus {
  /** Whether this device may change keys. */
  admin: boolean;
  keys: { openai: KeyState; composio: KeyState; typesafe: KeyState };
}

export const getSetupStatus = (): Promise<SetupStatus> => call("GET", "/kleio/setup");
export const setSetupKey = (name: SetupKeyName, key: string): Promise<SetupStatus> =>
  call("POST", `/kleio/setup/keys/${name}`, { key });
export const removeSetupKey = (name: SetupKeyName): Promise<SetupStatus> =>
  call("DELETE", `/kleio/setup/keys/${name}`);

// ─── Dictation's step (kleio-host dictation-setup.ts) ────────────────────────────────────

/** Why the host couldn't get dictation's speech model ready. */
export type DictationFailure = "offline" | "server" | "missing" | "storage" | "integrity" | "load";

const DICTATION_FAILURES: readonly string[] = [
  "offline",
  "server",
  "missing",
  "storage",
  "integrity",
  "load",
] satisfies readonly DictationFailure[];

/** Where the host's speech model is. `bytes` is the whole model's size, in every state. */
export type DictationSetup =
  | { state: "absent"; bytes: number }
  | { state: "downloading"; loaded: number; bytes: number }
  | { state: "loading"; bytes: number }
  | { state: "ready"; bytes: number }
  | { state: "failed"; reason: DictationFailure; bytes: number }
  /** The speech engine has no build for the host (`os`, `arch`: Node's names). */
  | { state: "unsupported"; os: string; arch: string; bytes: number };

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isPlatformWord = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9_]{1,16}$/.test(v);

/** The host's `dictation`, checked: a known state with only its own fields, else null. */
export function parseDictationStatus(value: unknown): DictationSetup | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const bytes = v.bytes;
  if (!isCount(bytes)) return null;
  switch (v.state) {
    case "absent":
    case "loading":
    case "ready":
      return { state: v.state, bytes };
    case "downloading":
      return isCount(v.loaded) && v.loaded <= bytes
        ? { state: "downloading", loaded: v.loaded, bytes }
        : null;
    case "failed":
      return typeof v.reason === "string" && DICTATION_FAILURES.includes(v.reason)
        ? { state: "failed", reason: v.reason as DictationFailure, bytes }
        : null;
    case "unsupported":
      return isPlatformWord(v.os) && isPlatformWord(v.arch)
        ? { state: "unsupported", os: v.os, arch: v.arch, bytes }
        : null;
    default:
      return null;
  }
}

/** A status call gives up after this, so the card can say so instead of spinning. */
const DICTATION_SETUP_TIMEOUT_MS = 10_000;

async function dictationCall(method: "GET" | "POST"): Promise<DictationSetup> {
  const body = await call<{ dictation?: unknown } | null>(
    method,
    "/kleio/setup/dictation",
    undefined,
    undefined,
    DICTATION_SETUP_TIMEOUT_MS,
  );
  const dictation = parseDictationStatus(body?.dictation);
  // A state this app doesn't know: a newer host. Shown as "couldn't check".
  if (!dictation) throw new KleioApiError(502, "unexpected reply from the host");
  return dictation;
}

/** Where the host's speech model is (any paired device). */
export const getDictationSetup = (): Promise<DictationSetup> => dictationCall("GET");
/** Starts the host's speech model download, or joins the one under way (any paired device). */
export const startDictationSetup = (): Promise<DictationSetup> => dictationCall("POST");

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

/** Chats or coding sessions saved on the Mac mini (Kleio's own threads aside). */
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

export interface SavedSessionRead extends SavedSession {
  /** The latest prompts and replies, oldest first. */
  readonly messages: readonly { readonly from: "user" | "assistant"; readonly text: string }[];
}

/** The newest saved chats or coding sessions, newest first (at most 30). */
export const listSavedSessions = (kind: SavedSessionKind): Promise<{ sessions: SavedSession[] }> =>
  call("GET", `/kleio/sessions?kind=${kind}`);

/** One saved chat or coding session's latest messages. */
export const readSavedSession = (kind: SavedSessionKind, id: string): Promise<SavedSessionRead> =>
  call("GET", `/kleio/sessions/${encodeURIComponent(id)}?kind=${kind}`);

// ─── Kleio's projects (her projects folders on the Mac mini, for her voice) ─────────────

/** What a coding agent is doing in a project right now. */
export interface ProjectNow {
  readonly state: "working" | "needs_you";
  /** What it is doing ("Running tests"), or the question it asks. */
  readonly doing: string;
}

export interface ProjectSummary {
  readonly name: string;
  /** ISO time it was last worked on. */
  readonly lastActivity: string;
  /** Its saved coding sessions. */
  readonly sessions: number;
  /** Absent when no coding agent is working in it. */
  readonly now?: ProjectNow;
}

export interface ProjectStatus extends ProjectSummary {
  /** Its newest coding sessions, newest first. */
  readonly recent: readonly { readonly title: string; readonly lastActivity: string }[];
  /** Its newest coding session's latest prompts and replies. */
  readonly latest?: SavedSessionRead;
  /** Its newest documents (README, docs, its coding agents' plans), newest first. */
  readonly docs: readonly AgentFileEntry[];
}

/** Kleio's projects, most recently worked on first (at most 40). */
export const listProjects = (): Promise<{ projects: ProjectSummary[] }> =>
  call("GET", "/kleio/projects");

/** One project's status: what's running in it, its latest update, its documents. */
export const readProject = (name: string): Promise<ProjectStatus> =>
  call("GET", `/kleio/projects${query({ name })}`);

/** Makes a new, empty project; `name` is lowercase words joined by dashes. */
export const newProject = (name: string): Promise<{ name: string }> =>
  call("POST", "/kleio/projects", { name });

/** Starts a coding agent on `prompt` in a project (it shows in Code; a push comes when it's done). */
export const startCodeWork = (
  project: string,
  prompt: string,
): Promise<{ project: string; sessionId: string }> =>
  call("POST", "/kleio/projects/code", { name: project, prompt });

/** Whose files: Kleio's own, a specialist's, a group's, a saved chat's or coding session's, a project's. */
export type FileSource = "kleio" | "specialist" | "group" | "chat" | "code" | "project";

export type FileKind =
  | "pdf"
  | "document"
  | "spreadsheet"
  | "slides"
  | "web_page"
  | "text"
  | "data"
  | "code"
  | "image"
  | "audio"
  | "video"
  | "other";

/** A file an agent made, as the Mac mini lists it. */
export interface AgentFileEntry {
  /** Relative, "/"-joined. */
  readonly path: string;
  readonly name: string;
  readonly kind: FileKind;
  readonly size: number;
  /** ISO time it was last changed. */
  readonly modified: string;
  readonly readable: boolean;
  /** Group files: the member's blob id. */
  readonly member?: string;
  /** Group files: the member's name. */
  readonly by?: string;
}

/** One part of a file's text. */
export interface AgentFileText {
  readonly name: string;
  readonly kind: FileKind;
  readonly part: number;
  readonly parts: number;
  readonly text: string;
  /** A PDF's page count. */
  readonly pages?: number;
}

/** The files an agent made, newest first (at most 40). `id` is omitted for Kleio. */
/** An owner's files; for a session's, project's or (when served) Kleio's own
 *  folder, that folder too, which FileCard fetches them through. */
export interface AgentFileList {
  readonly files: AgentFileEntry[];
  readonly cwd?: string;
}

export const listAgentFiles = (source: FileSource, id?: string): Promise<AgentFileList> =>
  call("GET", `/kleio/voice/files${query({ source, id })}`);

/** One part of a file's text. The path goes in the body, never the query. */
export const readAgentFile = (req: {
  readonly source: FileSource;
  readonly id?: string;
  readonly member?: string;
  readonly path: string;
  readonly part?: number;
}): Promise<AgentFileText> => call("POST", "/kleio/voice/files/read", req);

// ─── shows: what her voice puts on the screen beside her ────────────────────
// kleio-host show.ts. A show is a file her agents made, or a web page or PDF
// at a link that the host draws. The device names a file by its owner and
// path, as read_file does, and a part only by the show's id and the part's
// name; the Rust side (show.rs) passes on only plain text and pictures.

/** How a show is drawn: a document's text, a picture, a PDF's pages, a picture of a web page. */
export type ShowKind = "text" | "image" | "pdf" | "web";
/** A web page is drawn on the host while the device waits; a file is ready at once. */
export type ShowState = "capturing" | "ready" | "failed";
/** The width the host draws a web page at. */
export type ShowView = "desktop" | "phone";

/** A show as the host describes it (`{ show }` from POST /kleio/voice/show and GET …/<id>). */
export interface ShowInfo {
  /** `sh_` and 32 hex digits. */
  readonly id: string;
  readonly kind: ShowKind;
  /** A file's name, or a link's site. */
  readonly name: string;
  readonly state: ShowState;
  /** text: Markdown or plain text. */
  readonly format?: "markdown" | "plain";
  /** text: only its first MB is drawn; web: the page goes on below the picture. */
  readonly cut?: boolean;
  /** pdf: the pages that can be shown (from 1), and how many it has. */
  readonly pages?: number;
  readonly totalPages?: number;
  /** A link's site. */
  readonly host?: string;
  /** web: a sign-in, account or paywall page, as a visitor without their accounts sees it. */
  readonly signIn?: boolean;
  /** The page's or PDF's own title. */
  readonly title?: string;
  /** failed: why (a capture failure's kind), and in plain words. */
  readonly reason?: string;
  readonly detail?: string;
}

/** The most pages a show asks for (the Rust side's limit; the host draws at most 100). */
export const SHOW_PAGES_MAX = 500;
const SHOW_KINDS: readonly string[] = ["text", "image", "pdf", "web"];
const SHOW_STATES: readonly string[] = ["capturing", "ready", "failed"];
/** Longest name, site, title or detail kept from the host (they are labels and sentences). */
const SHOW_WORDS_MAX = 500;

export function isShowId(id: unknown): id is string {
  return typeof id === "string" && /^sh_[0-9a-f]{32}$/.test(id);
}

/** A string from the host as a label: trimmed, cut to a sentence's length; null when empty. */
function words(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, SHOW_WORDS_MAX) : null;
}

const pageCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;

/**
 * The host's `show`, checked field by field: null when what it must say is
 * missing or odd, so the panel never draws from a guess (a page count drives
 * how many pages it asks for). Fields it doesn't know are dropped.
 */
export function parseShowInfo(v: unknown): ShowInfo | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name = words(o.name);
  if (!isShowId(o.id) || !SHOW_KINDS.includes(String(o.kind))) return null;
  if (!SHOW_STATES.includes(String(o.state)) || name === null) return null;
  const kind = o.kind as ShowKind;
  const state = o.state as ShowState;
  const show: { -readonly [K in keyof ShowInfo]: ShowInfo[K] } = { id: o.id, kind, name, state };
  if (kind === "text") show.format = o.format === "markdown" ? "markdown" : "plain";
  if (o.cut === true) show.cut = true;
  if (kind === "pdf" && state === "ready") {
    const pages = pageCount(o.pages);
    if (pages === null || pages > SHOW_PAGES_MAX) return null;
    const total = pageCount(o.totalPages);
    show.pages = pages;
    show.totalPages = total !== null && total >= pages ? total : pages;
  }
  const host = words(o.host);
  if (host) show.host = host;
  if (o.signIn === true) show.signIn = true;
  const title = words(o.title);
  if (title) show.title = title;
  if (state === "failed") {
    const reason = words(o.reason);
    if (reason && /^[a-z_]{1,40}$/.test(reason)) show.reason = reason;
    const detail = words(o.detail);
    if (detail) show.detail = detail;
  }
  return show;
}

/** A show route's `{ show }`, checked; a reply that isn't one is an error. */
async function showCall(
  method: Method,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<ShowInfo> {
  const res = await call<unknown>(method, path, body, undefined, timeoutMs);
  const show = parseShowInfo(
    typeof res === "object" && res !== null ? (res as { show?: unknown }).show : undefined,
  );
  if (!show)
    throw new KleioApiError(502, "bad_answer", "Your host sent a show Kleio couldn't read.");
  return show;
}

/** Shows a file from list_files: named by its owner and relative path, as read_file names it. */
export const createFileShow = (req: {
  readonly source: FileSource;
  readonly id?: string;
  readonly member?: string;
  readonly path: string;
}): Promise<ShowInfo> => showCall("POST", "/kleio/voice/show", req);

/** Shows a web page or PDF at `url`: the host checks the address, then draws it. */
export const createLinkShow = (url: string, view: ShowView): Promise<ShowInfo> =>
  showCall("POST", "/kleio/voice/show", { url, view });

/** How a show is now (a page being drawn is `capturing` until it's `ready` or `failed`). */
export async function getShow(id: string): Promise<ShowInfo> {
  if (!isShowId(id)) throw new KleioApiError(0, "bad_request");
  return showCall("GET", `/kleio/voice/show/${id}`, undefined, 15_000);
}

/** A show's part: its text, its picture, or one of its pages (from 1). */
export type ShowPart = "text" | "image" | `page-${number}`;

/** The bytes Tauri hands back for a raw reply: an ArrayBuffer, or numbers when it can't. */
function bytesOf(v: unknown): Uint8Array | null {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return Uint8Array.from(v as number[]);
  }
  return null;
}

/**
 * One part of one of this device's shows, as bytes. Plain text for `text`;
 * a picture for `image` and each page (the Rust side checks the type).
 * Fails with the host's reason, e.g. `expired`, or `changed` for a file
 * changed since it was shown.
 */
export async function getShowPart(id: string, part: ShowPart): Promise<Uint8Array> {
  let out: unknown;
  try {
    out = await invoke<unknown>("kleio_show_part", { id, part });
  } catch (e) {
    const o = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : null;
    if (o && typeof o.status === "number" && typeof o.error === "string") {
      throw new KleioApiError(
        o.status,
        o.error,
        typeof o.detail === "string" ? o.detail : undefined,
        undefined,
        o,
      );
    }
    throw new KleioApiError(0, e instanceof Error ? e.message : String(e));
  }
  const bytes = bytesOf(out);
  if (!bytes) throw new KleioApiError(502, "bad_answer");
  return bytes;
}

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

/** A specialist's latest prompts and replies, oldest first; none before its first conversation. */
export const listSpecialistMessages = (
  id: string,
): Promise<{ messages: SavedSessionRead["messages"]; lastActivity?: string }> =>
  call("GET", `${blobPath(id)}/messages`);

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
