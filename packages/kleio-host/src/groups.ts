/**
 * Group chats: several Blobs in one conversation with the user.
 *
 * The user posts; the members they @mention reply, in the order mentioned. With
 * no mention, a router (Jev) picks who starts, or without one every member
 * replies, most relevant first. A reply that @mentions another member hands the
 * turn on. When nobody is queued, the router checks the work: done or waiting
 * on the user stops the group, else it hands the turn to whoever should act
 * next. Each (group, Blob) pair has its own pinned sidecar conversation, a
 * persona of the Blob's job plus a short group addendum, so a Blob keeps
 * context between turns. Every turn is prompted with the group messages that
 * Blob has not seen yet. One serial queue per group; at most MAX_TURNS Blob
 * turns per user message. A Blob that has nothing to add answers PASS and
 * posts nothing.
 *
 * State: groups.json (atomic), messages in group-<id>.jsonl (last 500); a new
 * session moves the log aside to group-<id>.<time>.jsonl. The conductor's
 * queue is in memory only: after a restart the log is the truth.
 */
import { appendFile, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Nudge } from "./apns.js";
import {
  color,
  emoji,
  hex,
  Invalid,
  object,
  text,
  type Blob,
  type BlobColor,
  type Reply,
} from "./blobs.js";
import { atomicWrite } from "./device-registry.js";
import { stepText, type GroupLive } from "./live-text.js";
import {
  createPinnedThread,
  sessionIdle,
  type PinnedThread,
  type SidecarCall,
} from "./pinned-thread.js";

export interface GroupSession {
  readonly sessionId?: string;
  readonly sessionPath: string | null;
  /** seq of the last group message this Blob has been shown. */
  readonly seenSeq: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Group {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly color: BlobColor;
  readonly members: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * The last seq of the conversation a new session cleared (absent: never).
   * seq carries on after it, so a device polling with an older `after` still
   * gets the new messages, and drops the ones it shows up to this seq.
   */
  readonly clearedThrough?: number;
  /** Host-internal: each member's pinned conversation in this group. */
  readonly sessions: Record<string, GroupSession>;
}

export interface GroupMessage {
  readonly seq: number;
  readonly id: string;
  /** "you" or a Blob id. */
  readonly author: string;
  readonly authorName: string;
  readonly emoji: string;
  readonly text: string;
  readonly at: string;
}

export type GroupView = Omit<Group, "sessions"> & {
  typing: string[];
  lastMessage?: GroupMessage;
};

export interface GroupsOptions {
  /** groups.json; group-<id>.jsonl go next to it. */
  readonly statePath: string;
  /** Parent of each (group, Blob) conversation's cwd (`<homeCwd>/groups`). */
  readonly cwdRoot: string;
  readonly call: SidecarCall;
  readonly track: (sessionId: string) => Promise<void>;
  readonly untrack: (sessionId: string) => Promise<void>;
  readonly findBlob: (blobId: string) => Promise<Blob | undefined>;
  readonly modelOf: (b: Blob) => string;
  /** Sends a push (the host wires APNs here). */
  readonly notify?: (n: Nudge) => Promise<void>;
  /**
   * The group's Live Activity changed (the host wires the tracker here).
   * `fresh`: new work began, restart the timer. `alert`: light the phone up.
   * Resolves true when an alerting push reached the phone.
   */
  readonly onLive?: (
    groupId: string,
    title: string,
    live: GroupLive,
    alert: boolean,
    fresh?: boolean,
  ) => Promise<boolean>;
  /**
   * Who acts next, and when the work is done (the host wires Jev here).
   * Absent or unanswered: every member replies, most relevant first, then
   * the group stops.
   */
  readonly router?: GroupRouter;
  /** How long one Blob's turn may run. Default 30 minutes. */
  readonly turnTimeoutMs?: number;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
}

export interface Groups {
  /** Load groups.json. Returns the member session ids to track. */
  load(): Promise<string[]>;
  /** A /kleio/groups request, or null when the path is not one. */
  route(
    method: string,
    path: string,
    query: URLSearchParams,
    body: () => Promise<unknown>,
  ): Promise<Reply | null>;
  /** Every upstream frame of every tracked session. */
  onFrame(sessionId: string, raw: string): void;
  /** True for a group member's session (the host sends no generic nudge for it). */
  owns(sessionId: string): boolean;
  /** True when the group exists. */
  has(groupId: string): Promise<boolean>;
  /** A Blob was deleted: drop it from every group. */
  onBlobDeleted(blobId: string): Promise<void>;
  /** A Blob's name, job or model changed: retire the conversations that describe it. */
  onBlobChanged(blobId: string): Promise<void>;
  /**
   * Retire every member conversation that isn't mid-turn, so its next turn
   * loads the current MCP tools (a new app connection). Returns how many.
   */
  retireIdle(): Promise<number>;
  /** Settles once every write started so far has landed, and every turn has finished. */
  flush(): Promise<void>;
}

/** What a router decides from. Text only: names, jobs and the conversation. */
export interface RouteRequest {
  readonly group: string;
  /** The members it may pick (not those who passed since the last reply), in member order. */
  readonly members: readonly { readonly id: string; readonly name: string; readonly job: string }[];
  /** A few messages before the user's latest one, oldest first. */
  readonly earlier: readonly { readonly from: string; readonly text: string }[];
  /** The user's latest message, then everything since, oldest first. */
  readonly conversation: readonly { readonly from: string; readonly text: string }[];
  /** Nobody has taken a turn on the message yet: pick who starts. */
  readonly first: boolean;
}

export interface RouteDecision {
  /** Member ids, best first. */
  readonly ranked: readonly string[];
  /** The request is done, or the group needs the user. Ignored when `first`. */
  readonly stop: boolean;
  /** One short line for the log, e.g. "next 0.65, done 0.04". */
  readonly note: string;
  /** Why it stops: the work is done, or the group waits on the user. */
  readonly reason?: "done" | "waiting";
}

/** Who acts next in a group and whether its work is done; null when it can't say. */
export type GroupRouter = (req: RouteRequest, signal: AbortSignal) => Promise<RouteDecision | null>;

const MAX_GROUPS = 20;
const MAX_MEMBERS = 8;
/**
 * Member turns per user message: the runaway guard for members @mentioning
 * each other, or the router handing the turn on, in a loop. At 20, longer
 * jobs (build, check, fix, re-check) ran out with work left (5 Oct 2026).
 */
const MAX_TURNS = 35;
/** How long the router may take to decide; past it, the fallback rule decides. */
const ROUTE_TIMEOUT_MS = 12_000;
/** Messages the router sees: since the user's latest one, and a few before it. */
const ROUTE_MESSAGES = 20;
const ROUTE_EARLIER = 4;
/** Added to the prompt of a member the router hands the turn to. */
const NUDGE =
  "[Kleio]: It's your turn: carry on with your part of the user's request, " +
  "or reply PASS if there's nothing you can do.";
/**
 * How long one member's turn may run. Members with tools make many model calls
 * in a row (at 2 minutes, 30 of the 39 timeouts on the Mac mini, 1-3 Oct 2026,
 * stopped a member mid-task). The cost: a stuck member holds the group up to
 * this long. Nothing below it ends a run sooner: the sidecar accepts /prompt at
 * once, and the agent loop's own limits are per model request.
 */
const TURN_TIMEOUT_MS = 30 * 60_000;
/** Tool calls kept per member turn for the sidebar; older ones roll off. */
const MAX_ACTIVITY = 30;
const SUMMARY_CHARS = 120;
const REASON_CHARS = 120;
const KEEP_MESSAGES = 500;
const PROMPT_MESSAGES = 30;
const PROMPT_CHARS = 6000;
const NOTIFY_BODY_CHARS = 180;
/** No push while a device polled the group this recently (it's on screen). */
const WATCHING_MS = 20_000;
const INSTRUCTIONS_MAX = 8000;

/**
 * One tool call of a member's current or last turn, for the sidebar. Holds a
 * one-line summary of the args only: never the tool's output or full args.
 */
export interface ActivityEntry {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  status: "running" | "done" | "failed";
  readonly startedAt: string;
  endedAt?: string;
}

/** How a member's last turn ended, or that the reply budget ran out first. */
export type TurnOutcomeKind =
  "replied" | "passed" | "timed_out" | "failed" | "unavailable" | "budget_exhausted";

export interface TurnOutcome {
  readonly kind: TurnOutcomeKind;
  /** Short and human: "took over 2 min". Empty for a reply. */
  readonly reason: string;
}

/** In memory only, per (group, member): reset when its next turn starts. */
interface MemberActivity {
  /** Every tool call the member made for the user's latest message, not just its last turn. */
  entries: ActivityEntry[];
  outcome: TurnOutcome | null;
  /** The user's message these are for (its seq). */
  askSeq: number;
  /** It has replied to that message: a later PASS doesn't undo that. */
  replied: boolean;
}

interface Active {
  /** The text since the last turn or tool boundary. */
  text: string;
  /**
   * The last text that finished a turn ("end_turn") and wasn't a PASS. A
   * completion hook (post-edit diagnostics, say) can start one more turn after
   * the answer, which the member may close with PASS: the answer still stands.
   */
  answer: string;
  stale: boolean;
  failed: boolean;
  cancelled: boolean;
  /** The run's error frame, as a short reason. */
  error: string | null;
  readonly activity: MemberActivity;
  readonly finish: () => void;
  /** The group, the member and its name, for the Live Activity's step line. */
  readonly gid: string;
  readonly bid: string;
  readonly name: string;
  /** The member's question still waiting on the user (its `ask_user` frame), if any. */
  ask: AskPrompt | null;
}

/** A member's open `ask_user` question, as the sidecar framed it. */
export interface AskPrompt {
  readonly id: string;
  readonly questions: readonly { readonly question: string }[];
}

const ASK_ID = /^ask-\d{1,9}$/;
const ANSWER_CHARS = 2000;
const MAX_ANSWERS = 20;

/** A device's answers to a question (question id → a value, or values for a multi). */
export function answersOf(v: unknown): Record<string, string | string[]> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Invalid("answers");
  const entries = Object.entries(v);
  if (entries.length < 1 || entries.length > MAX_ANSWERS) throw new Invalid("answers");
  const one = (s: unknown): string => {
    if (typeof s !== "string" || s.length > ANSWER_CHARS) throw new Invalid("answers");
    return s;
  };
  const out: Record<string, string | string[]> = {};
  for (const [id, a] of entries) {
    if (id.length > 80) throw new Invalid("answers");
    if (Array.isArray(a)) {
      if (a.length > MAX_ANSWERS) throw new Invalid("answers");
      out[id] = a.map(one);
    } else out[id] = one(a);
  }
  return out;
}

/** An `ask_user` frame's data, when it is one the app can show. */
export function askPromptOf(d: Record<string, unknown>): AskPrompt | null {
  const { id, questions } = d;
  if (typeof id !== "string" || !ASK_ID.test(id) || !Array.isArray(questions)) return null;
  const ok = questions.every(
    (q: unknown) =>
      typeof q === "object" &&
      q !== null &&
      typeof (q as { id?: unknown }).id === "string" &&
      typeof (q as { question?: unknown }).question === "string",
  );
  return ok && questions.length > 0 ? ({ ...d, id, questions } as AskPrompt) : null;
}

interface Conductor {
  queue: string[];
  budget: number;
  running: Promise<void> | null;
  typing: string | null;
  lastReply: GroupMessage | null;
  /** seq of the user's latest message: the request the group works on. */
  askSeq: number;
  /** Turns taken since that message. */
  turns: number;
  /** Members who took a turn without replying since the last reply: not routed to. */
  idle: Set<string>;
  /** The member the router just handed the turn to (its prompt gets NUDGE). */
  nudge: string | null;
  /** Bumped by a new session: a turn begun before it drops its reply. */
  epoch: number;
  /** Why the router last stopped the group, if it did. */
  stopWhy: "done" | "waiting" | null;
}

const clip = (s: string, n: number): string => {
  const cs = [...s];
  return cs.length > n ? `${cs.slice(0, n - 1).join("")}…` : s;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Members a text @mentions, in the order it first mentions them; longest names match first. */
export function mentioned(textIn: string, members: readonly Blob[]): string[] {
  let rest = textIn;
  const at = new Map<string, number>();
  for (const b of [...members].sort((a, c) => c.name.length - a.name.length)) {
    const re = new RegExp(`@${escapeRegExp(b.name)}(?![\\p{L}\\p{N}_])`, "giu");
    const first = rest.search(re);
    if (first >= 0) {
      at.set(b.id, first);
      // Blank it out at the same length, so later positions still line up.
      rest = rest.replace(re, (m) => " ".repeat(m.length));
    }
  }
  return [...at].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

const STOPWORDS = new Set(
  (
    "that this with from have your what when they them then than will would could should " +
    "there their about into just like some also been were here does make need want please " +
    "can you the and for are"
  ).split(" "),
);
const words = (s: string): Set<string> =>
  new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)));

/** Same word, give or take an ending: "fix"/"fixes", "failing"/"failures". */
function akin(a: string, b: string): boolean {
  const need = Math.min(4, a.length, b.length);
  let i = 0;
  while (i < need && a[i] === b[i]) i += 1;
  return i === need;
}

/**
 * Member ids, most relevant to a message first: a member named in it, then
 * the most words shared with the member's name and job. Ties keep member order.
 */
export function byRelevance(said: string, members: readonly Blob[]): string[] {
  const asked = words(said);
  const score = (b: Blob): number => {
    const named = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapeRegExp(b.name)}(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    let n = named.test(said) ? 100 : 0;
    const own = [...words(`${b.name} ${b.job}`)];
    for (const w of asked) if (own.some((o) => akin(w, o))) n += 1;
    return n;
  };
  return members
    .map((b, i) => ({ id: b.id, s: score(b), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.id);
}

/** A Blob's persona instructions in a group: its job plus the group addendum. */
export function groupInstructions(g: Pick<Group, "name">, self: Blob, others: Blob[]): string {
  const roster = others.length
    ? others.map((o) => `${o.name} — ${clip(o.job.replace(/\s+/g, " "), 80)}`).join("; ")
    : "nobody else yet";
  const addendum =
    `\n\nYou are also in the group chat "${g.name}" with: ${roster}. The user is "you". ` +
    "Reply with your message only: short (1–4 sentences unless asked for more), in your own " +
    "voice. To ask another member to act, mention them as @Name. If you have nothing useful " +
    "to add, reply exactly PASS.";
  const room = INSTRUCTIONS_MAX - [...addendum].length;
  return clip(self.job, room) + addendum;
}

/** The unseen messages as a prompt, oldest first, capped by count and size. */
export function promptFor(unseen: readonly GroupMessage[]): string {
  const lines = unseen.slice(-PROMPT_MESSAGES).map((m) => `[${m.authorName}]: ${m.text}`);
  let total = lines.reduce((n, l) => n + l.length + 1, 0);
  while (lines.length > 1 && total > PROMPT_CHARS) total -= lines.shift()!.length + 1;
  return lines.join("\n");
}

const isPass = (s: string): boolean => /^pass[.!]?$/i.test(s.trim());

const oneLine = (s: string, n: number): string => clip(s.replace(/\s+/g, " ").trim(), n);

const durationText = (ms: number): string =>
  ms < 1000
    ? `${ms} ms`
    : ms < 60_000
      ? `${Math.round(ms / 1000)} s`
      : `${Math.round(ms / 60_000)} min`;

/**
 * Arg keys that say what a tool call is doing, most telling first. Anything
 * else (file contents, message bodies) is never summarised.
 */
const SUMMARY_KEYS = [
  "command",
  "file_path",
  "query",
  "pattern",
  "url",
  "urls",
  "path",
  "symbol",
  "skill",
  "task",
  "title",
  "name",
  "action",
] as const;

/** A tool call's args as one clipped line: the command, path, query… or "". */
export function toolSummary(args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const o = args as Record<string, unknown>;
  for (const k of SUMMARY_KEYS) {
    const v = o[k];
    const s =
      typeof v === "string" ? v : Array.isArray(v) ? v.find((x) => typeof x === "string") : null;
    if (typeof s === "string" && s.trim()) return oneLine(s, SUMMARY_CHARS);
  }
  return "";
}

export function createGroups(options: GroupsOptions): Groups {
  const log = options.log ?? ((msg: string) => console.error(msg));
  const now = options.now ?? (() => new Date());
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const dir = dirname(options.statePath);
  const logPath = (gid: string): string => join(dir, `group-${gid}.jsonl`);

  let groups: Group[] = [];
  let loading: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const logs = new Map<string, GroupMessage[]>();
  const threads = new Map<string, PinnedThread>();
  const conductors = new Map<string, Conductor>();
  const lastPoll = new Map<string, number>();
  const actives = new Map<string, Active>();
  /** key(group, blob) → its tool calls and last outcome, for the sidebar. */
  const activity = new Map<string, MemberActivity>();
  /** Blob data for sessionFields(), which must answer synchronously. */
  const blobCache = new Map<string, Blob>();
  /** A new session in progress, per group: a message posted meanwhile waits for it. */
  const resets = new Map<string, Promise<void>>();

  // ---------------------------------------------------------------- storage

  function loaded(): Promise<void> {
    loading ??= (async () => {
      try {
        const raw = JSON.parse(await readFile(options.statePath, "utf8")) as { groups?: unknown };
        groups = Array.isArray(raw.groups) ? (raw.groups as Group[]) : [];
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          log(`[groups] reading ${options.statePath} failed: ${String(e)}`);
        groups = [];
      }
    })();
    return loading;
  }

  function queueWrite(work: () => Promise<void>, what: string): Promise<void> {
    writes = writes.then(work).catch((e) => log(`[groups] writing ${what} failed: ${String(e)}`));
    return writes;
  }

  function save(): Promise<void> {
    return queueWrite(
      () => atomicWrite(options.statePath, JSON.stringify({ version: 1, groups }, null, 2), 0o600),
      "groups.json",
    );
  }

  const find = (gid: string): Group | undefined => groups.find((g) => g.id === gid);

  function replace(g: Group): void {
    groups = groups.map((x) => (x.id === g.id ? g : x));
  }

  async function messages(gid: string): Promise<GroupMessage[]> {
    const cached = logs.get(gid);
    if (cached) return cached;
    let list: GroupMessage[] = [];
    try {
      for (const line of (await readFile(logPath(gid), "utf8")).split("\n")) {
        if (!line.trim()) continue;
        try {
          list.push(JSON.parse(line) as GroupMessage);
        } catch {
          // a torn last line: skip it
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        log(`[groups] reading messages of ${gid} failed: ${String(e)}`);
    }
    list = list.slice(-KEEP_MESSAGES);
    // Another caller may have filled the cache while this one read the file.
    const raced = logs.get(gid);
    if (raced) return raced;
    logs.set(gid, list);
    return list;
  }

  async function append(
    gid: string,
    msg: Omit<GroupMessage, "seq" | "id" | "at">,
  ): Promise<GroupMessage> {
    const list = await messages(gid);
    const full: GroupMessage = {
      seq: (list[list.length - 1]?.seq ?? find(gid)?.clearedThrough ?? 0) + 1,
      id: `m_${hex()}`,
      at: now().toISOString(),
      ...msg,
    };
    list.push(full);
    const trim = list.length > KEEP_MESSAGES;
    if (trim) list.splice(0, list.length - KEEP_MESSAGES);
    const data = trim
      ? list.map((m) => JSON.stringify(m)).join("\n") + "\n"
      : JSON.stringify(full) + "\n";
    void queueWrite(
      () => (trim ? atomicWrite(logPath(gid), data, 0o600) : appendFile(logPath(gid), data)),
      `messages of ${gid}`,
    );
    return full;
  }

  // ---------------------------------------------------------------- sessions

  const key = (gid: string, bid: string): string => `${gid}/${bid}`;

  function setSession(gid: string, bid: string, patch: { seenSeq?: number; drop?: true }): void {
    const g = find(gid);
    if (!g) return;
    const prev = g.sessions[bid];
    const at = now().toISOString();
    const base: GroupSession = prev ?? {
      sessionPath: null,
      seenSeq: 0,
      createdAt: at,
      updatedAt: at,
    };
    const { sessionId, ...rest } = base;
    const next: GroupSession = {
      ...rest,
      ...(sessionId && !patch.drop ? { sessionId } : {}),
      ...(patch.seenSeq !== undefined ? { seenSeq: patch.seenSeq } : {}),
      updatedAt: at,
    };
    replace({ ...g, sessions: { ...g.sessions, [bid]: next } });
  }

  function thread(gid: string, bid: string): PinnedThread {
    const k = key(gid, bid);
    const existing = threads.get(k);
    if (existing) return existing;
    const t = createPinnedThread({
      name: `group ${gid} ${bid}`,
      cwd: join(options.cwdRoot, gid, bid),
      store: {
        get: async () => {
          const s = find(gid)?.sessions[bid];
          return s
            ? {
                ...(s.sessionId ? { sessionId: s.sessionId } : {}),
                sessionPath: s.sessionPath,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              }
            : null;
        },
        put: async (rec) => {
          const g = find(gid);
          if (!g) return;
          const prev = g.sessions[bid];
          const next: GroupSession = {
            seenSeq: prev?.seenSeq ?? 0,
            createdAt: prev?.createdAt ?? rec.createdAt,
            updatedAt: rec.updatedAt,
            sessionPath: rec.sessionPath,
            ...(rec.sessionId ? { sessionId: rec.sessionId } : {}),
          };
          replace({ ...g, sessions: { ...g.sessions, [bid]: next } });
          await save();
        },
      },
      sessionFields: () => {
        const g = find(gid);
        const self = blobCache.get(bid);
        if (!g || !self) return {};
        const others = g.members
          .filter((m) => m !== bid)
          .map((m) => blobCache.get(m))
          .filter((b): b is Blob => b !== undefined);
        return {
          persona: { name: self.name, instructions: groupInstructions(g, self, others) },
          model: options.modelOf(self),
        };
      },
      call: options.call,
      track: options.track,
      untrack: options.untrack,
      log,
      now,
    });
    threads.set(k, t);
    return t;
  }

  async function retire(gid: string, bid: string): Promise<void> {
    const k = key(gid, bid);
    const t = threads.get(k);
    threads.delete(k);
    if (t) {
      await t.retire().catch((e) => log(`[groups] retire ${k}: ${String(e)}`));
      return;
    }
    // Not opened since the host started: dispose the stored session directly.
    const sid = find(gid)?.sessions[bid]?.sessionId;
    if (!sid) return;
    await options.untrack(sid).catch(() => {});
    await options.call("DELETE", `/session/${encodeURIComponent(sid)}`).catch(() => null);
    setSession(gid, bid, { drop: true });
  }

  async function membersOf(g: Group): Promise<Blob[]> {
    const out: Blob[] = [];
    for (const id of g.members) {
      const b = await options.findBlob(id);
      if (b) {
        blobCache.set(id, b);
        out.push(b);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- activity

  function memberActivity(gid: string, bid: string): MemberActivity {
    const k = key(gid, bid);
    let m = activity.get(k);
    if (!m) {
      m = { entries: [], outcome: null, askSeq: -1, replied: false };
      activity.set(k, m);
    }
    return m;
  }

  const outcomeOf = (kind: TurnOutcomeKind, reason: string): TurnOutcome => ({
    kind,
    reason: oneLine(reason, REASON_CHARS),
  });

  /** Record an outcome outside a turn, if the Blob is still a member. */
  function setOutcome(gid: string, bid: string, kind: TurnOutcomeKind, reason: string): void {
    if (!find(gid)?.members.includes(bid)) return;
    memberActivity(gid, bid).outcome = outcomeOf(kind, reason);
  }

  /** Drop a group's activity, or one member's. */
  function forgetActivity(gid: string, bid?: string): void {
    for (const k of [...activity.keys()])
      if (bid ? k === key(gid, bid) : k.startsWith(`${gid}/`)) activity.delete(k);
  }

  function toolStarted(m: MemberActivity, d: Record<string, unknown>): void {
    const id = d.toolCallId;
    const name = d.name;
    if (typeof id !== "string" || !id || id.length > 128) return;
    if (typeof name !== "string" || !name) return;
    if (m.entries.some((e) => e.id === id)) return;
    m.entries.push({
      id,
      name: clip(name, 64),
      summary: toolSummary(d.args),
      status: "running",
      startedAt: now().toISOString(),
    });
    if (m.entries.length > MAX_ACTIVITY) m.entries.splice(0, m.entries.length - MAX_ACTIVITY);
  }

  function serverToolCalled(m: MemberActivity, d: Record<string, unknown>): void {
    const id = d.id;
    const name = d.name;
    if (typeof id !== "string" || !id || id.length > 128) return;
    if (typeof name !== "string" || !name) return;
    if (m.entries.some((e) => e.id === id)) return;
    const at = now().toISOString();
    m.entries.push({
      id,
      name: clip(name, 64),
      summary: toolSummary(d.input),
      status: "done",
      startedAt: at,
      endedAt: at,
    });
    if (m.entries.length > MAX_ACTIVITY) m.entries.splice(0, m.entries.length - MAX_ACTIVITY);
  }

  function toolEnded(m: MemberActivity, d: Record<string, unknown>): void {
    const e = m.entries.find((x) => x.id === d.toolCallId);
    if (!e || e.status !== "running") return;
    e.status = d.isError === true ? "failed" : "done";
    e.endedAt = now().toISOString();
  }

  /** The members' activity and outcomes, as GET .../messages reports them. */
  function activityOf(g: Group): {
    activity: Record<string, ActivityEntry[]>;
    outcomes: Record<string, TurnOutcome>;
  } {
    const out = {
      activity: {} as Record<string, ActivityEntry[]>,
      outcomes: {} as Record<string, TurnOutcome>,
    };
    for (const bid of g.members) {
      const m = activity.get(key(g.id, bid));
      if (!m) continue;
      out.activity[bid] = m.entries.map((e) => ({ ...e }));
      if (m.outcome) out.outcomes[bid] = m.outcome;
    }
    return out;
  }

  // ---------------------------------------------------------------- conductor

  function conductor(gid: string): Conductor {
    let c = conductors.get(gid);
    if (!c) {
      c = {
        queue: [],
        budget: 0,
        running: null,
        typing: null,
        lastReply: null,
        askSeq: 0,
        turns: 0,
        idle: new Set(),
        nudge: null,
        epoch: 0,
        stopWhy: null,
      };
      conductors.set(gid, c);
    }
    return c;
  }

  function enqueue(gid: string, ids: readonly string[]): void {
    const c = conductor(gid);
    for (const id of ids) if (!c.queue.includes(id)) c.queue.push(id);
    c.running ??= pump(gid).finally(() => {
      c.running = null;
    });
  }

  const fromOf = (m: GroupMessage): { from: string; text: string } => ({
    from: m.author === "you" ? "User" : m.authorName,
    text: m.text,
  });

  /**
   * The queue is empty: ask the router who acts next and queue them. "stop"
   * when the work is done or needs the user, nobody is left to ask, or the
   * router can't say after someone has replied (before anyone has, every
   * member replies, most relevant first). "stale" when a new message or
   * session came in while it decided: decide again.
   */
  async function route(
    gid: string,
    c: Conductor,
    router: GroupRouter,
  ): Promise<"queued" | "stop" | "stale"> {
    const g = find(gid);
    if (!g) return "stop";
    const { epoch, askSeq } = c;
    const first = c.turns === 0;
    const ready = (await membersOf(g)).filter((b) => !c.idle.has(b.id));
    // Not straight back to whoever just replied: they had the floor and
    // stopped. Unless nobody else is left (they may carry on alone).
    const just = c.lastReply?.author;
    const open = ready.length > 1 && just ? ready.filter((b) => b.id !== just) : ready;
    const only = open[0];
    if (!only) return "stop";
    if (first && open.length === 1) {
      c.queue.push(only.id);
      return "queued";
    }
    const list = await messages(gid);
    const at = Math.max(
      0,
      list.findIndex((m) => m.seq === askSeq),
    );
    const since = list.slice(at);
    const ask = list[at];
    // Over the cap: keep the user's message, then the latest of what followed.
    const conversation =
      since.length > ROUTE_MESSAGES && ask ? [ask, ...since.slice(-(ROUTE_MESSAGES - 1))] : since;
    const decision = await router(
      {
        group: g.name,
        members: open.map((b) => ({ id: b.id, name: b.name, job: b.job })),
        earlier: list.slice(Math.max(0, at - ROUTE_EARLIER), at).map(fromOf),
        conversation: conversation.map(fromOf),
        first,
      },
      AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    ).catch((e: unknown) => {
      log(`[groups] ${gid}: routing failed: ${String(e)}`);
      return null;
    });
    if (c.epoch !== epoch || c.askSeq !== askSeq) return "stale";
    const pick = decision?.ranked.find((id) => open.some((b) => b.id === id));
    if (!decision || !pick) {
      if (!first) return "stop";
      log(`[groups] ${gid}: no route; every member replies, most relevant first`);
      c.queue.push(...byRelevance(ask?.text ?? "", open));
      return "queued";
    }
    if (!first && decision.stop) {
      log(`[groups] ${gid}: stops (${decision.note})`);
      c.stopWhy = decision.reason ?? "done";
      return "stop";
    }
    log(`[groups] ${gid}: ${blobCache.get(pick)?.name ?? pick} is next (${decision.note})`);
    c.queue.push(pick);
    if (!first) c.nudge = pick;
    return "queued";
  }

  async function pump(gid: string): Promise<void> {
    const c = conductor(gid);
    // A message that came in while the last one wound down is worked on next.
    let settled: number;
    do settled = await conduct(gid, c);
    while (c.askSeq !== settled && c.budget > 0);
  }

  /** Tell the Live Activity; never lets a failure reach the conductor. */
  async function live(
    gid: string,
    state: GroupLive,
    alert = false,
    fresh = false,
  ): Promise<boolean> {
    const g = find(gid);
    if (!g || !options.onLive) return false;
    try {
      return await options.onLive(gid, g.name, state, alert, fresh);
    } catch (e) {
      log(`[groups] live ${gid}: ${String(e)}`);
      return false;
    }
  }

  /** Work the queue until it's done; returns the message it finished on. */
  async function conduct(gid: string, c: Conductor): Promise<number> {
    const router = options.router;
    const epoch = c.epoch;
    c.stopWhy = null;
    while (c.budget > 0) {
      if (!c.queue.length) {
        if (!router) break;
        const routed = await route(gid, c, router);
        if (routed === "stop") break;
        if (routed === "stale") continue;
      }
      const bid = c.queue.shift();
      if (bid === undefined) break;
      const nudged = c.nudge === bid;
      c.nudge = null;
      c.budget -= 1;
      c.turns += 1;
      try {
        await turn(gid, bid, nudged);
      } catch (e) {
        log(`[groups] ${gid} turn of ${bid} failed: ${String(e)}`);
        setOutcome(gid, bid, "failed", "the host hit an error (see its log)");
        c.idle.add(bid);
      }
    }
    const settled = c.askSeq;
    const outOfTurns = c.queue.length > 0 || (c.budget <= 0 && c.stopWhy === null);
    // Only the budget ends the loop with members still waiting.
    if (c.queue.length) {
      const names = c.queue.map((id) => blobCache.get(id)?.name ?? id);
      log(`[groups] ${gid}: all ${MAX_TURNS} turns used; not reached: ${names.join(", ")}`);
      for (const id of c.queue)
        setOutcome(
          gid,
          id,
          "budget_exhausted",
          `the group used all ${MAX_TURNS} turns for this message`,
        );
    }
    c.queue = [];
    c.nudge = null;
    const last = c.lastReply;
    c.lastReply = null;
    const g = find(gid);
    const watching = now().getTime() - (lastPoll.get(gid) ?? -Infinity) < WATCHING_MS;
    // A new session ended this work: startOver() already told the activity.
    if (g && c.epoch === epoch) {
      const reached =
        c.stopWhy === "waiting"
          ? await live(
              gid,
              {
                phase: "needsYou",
                line: "Needs your help",
                ...(last ? { detail: clip(`${last.authorName}: ${last.text}`, 140) } : {}),
              },
              !watching,
            )
          : outOfTurns
            ? await live(gid, { phase: "stopped", line: `Paused after ${MAX_TURNS} turns` })
            : await live(gid, { phase: "done", line: "Done" });
      // The activity already lit the phone up: no second buzz.
      if (reached) return settled;
    }
    if (!last || !g || !options.notify) return settled;
    if (watching) return settled;
    await options
      .notify({
        groupId: gid,
        title: `${g.emoji} ${g.name}`,
        body: clip(`${last.authorName}: ${last.text}`, NOTIFY_BODY_CHARS),
      })
      .catch((e) => log(`[groups] notify ${gid}: ${String(e)}`));
    return settled;
  }

  /** One member's turn. `nudged`: the router handed it the turn, so it is told to carry on. */
  async function turn(gid: string, bid: string, nudged: boolean): Promise<void> {
    const g = find(gid);
    if (!g || !g.members.includes(bid)) return;
    const c = conductor(gid);
    const epoch = c.epoch;
    const all = await membersOf(g);
    const self = all.find((b) => b.id === bid);
    if (!self) return;
    const list = await messages(gid);
    const seen = g.sessions[bid]?.seenSeq ?? 0;
    const unseen = list.filter((m) => m.seq > seen && m.author !== bid);
    const prompt = [promptFor(unseen), nudged ? NUDGE : ""].filter(Boolean).join("\n");
    if (!prompt) {
      c.idle.add(bid);
      return;
    }

    c.typing = bid;
    void live(gid, { phase: "working", line: `${self.name} is on it` });
    // A new turn: the sidebar shows only this turn's tool calls, then how it ended.
    // The sidebar shows everything the member did for the user's latest
    // message: its tool calls across turns, and how it ended.
    const mine = memberActivity(gid, bid);
    if (mine.askSeq !== c.askSeq) {
      mine.entries = [];
      mine.replied = false;
      mine.askSeq = c.askSeq;
    }
    mine.outcome = null;
    const end = (kind: TurnOutcomeKind, reason: string): void => {
      // A PASS after replying: it replied (it just had nothing more to add).
      mine.outcome =
        kind === "passed" && mine.replied ? outcomeOf("replied", "") : outcomeOf(kind, reason);
      if (kind === "replied") {
        mine.replied = true;
        c.idle.clear();
      } else c.idle.add(bid);
    };
    let sessionId: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      const session = await thread(gid, bid).resolve();
      if (!session.ok) {
        log(`[groups] ${gid}: ${self.name} unavailable: ${session.error.error}`);
        end("unavailable", session.error.error);
        return;
      }
      if (c.epoch !== epoch) return;
      const sid = session.value.sessionId;
      sessionId = sid;
      const lastSeq = list[list.length - 1]?.seq;
      if (lastSeq !== undefined) setSession(gid, bid, { seenSeq: lastSeq });
      void save();

      const ended = new Promise<"done" | "timeout">((resolve) => {
        actives.set(sid, {
          text: "",
          answer: "",
          stale: false,
          failed: false,
          cancelled: false,
          error: null,
          activity: mine,
          finish: () => resolve("done"),
          gid,
          bid,
          name: self.name,
          ask: null,
        });
        timer = setTimeout(() => resolve("timeout"), turnTimeoutMs);
      });
      const r = await options.call("POST", "/prompt", {
        session: sid,
        body: { text: prompt },
        timeoutMs: 30_000,
      });
      if (!r || r.status < 200 || r.status >= 300) {
        log(`[groups] ${gid}: prompting ${self.name} -> ${r ? r.status : "unreachable"}`);
        end(
          "unavailable",
          r ? `the agent didn't take the message (HTTP ${r.status})` : "couldn't reach the agent",
        );
        return;
      }
      const how = await ended;
      // Stopped, or a new session began, during the turn: drop what it said.
      if (c.epoch !== epoch) {
        log(`[groups] ${gid}: ${self.name}'s turn was stopped; reply dropped`);
        return;
      }
      if (how === "timeout") {
        log(`[groups] ${gid}: ${self.name} took too long`);
        end("timed_out", `took over ${durationText(turnTimeoutMs)}`);
        void options.call("POST", "/cancel", { session: sid }).catch(() => null);
        return;
      }
      const a = actives.get(sid);
      if (!a || a.failed) {
        const why = a?.cancelled ? "the run was cancelled" : (a?.error ?? "the run failed");
        log(`[groups] ${gid}: ${self.name}'s run failed: ${why}`);
        end("failed", why);
        return;
      }
      const last = a.text.trim();
      const reply = last && !isPass(last) ? last : a.answer;
      if (!reply) {
        log(`[groups] ${gid}: ${self.name} ${last ? "passed" : "sent an empty reply"}`);
        end("passed", last ? "had nothing to add" : "sent an empty reply");
        return;
      }
      const msg = await append(gid, {
        author: bid,
        authorName: self.name,
        emoji: self.emoji,
        text: clip(reply, 4000),
      });
      setSession(gid, bid, { seenSeq: msg.seq });
      void save();
      c.lastReply = msg;
      end("replied", "");
      for (const id of mentioned(reply, all))
        if (id !== bid && !c.queue.includes(id)) c.queue.push(id);
    } finally {
      clearTimeout(timer);
      if (sessionId) actives.delete(sessionId);
      // Nothing reports on a call still open once its turn is over.
      const at = now().toISOString();
      for (const e of mine.entries)
        if (e.status === "running") {
          e.status = "failed";
          e.endedAt = at;
        }
      if (c.typing === bid) c.typing = null;
    }
  }

  /**
   * Stop: end the reply in progress and drop everyone still queued. The
   * conversation stays; the member's run is cancelled, so whatever it had
   * said is dropped, and its sidebar line says it was stopped.
   */
  async function stopWork(gid: string): Promise<void> {
    const c = conductor(gid);
    const was = c.typing;
    c.epoch += 1;
    c.queue = [];
    c.budget = 0;
    c.lastReply = null;
    c.nudge = null;
    const g = find(gid);
    if (!g) return;
    for (const s of Object.values(g.sessions)) {
      const a = s.sessionId ? actives.get(s.sessionId) : undefined;
      if (!a || !s.sessionId) continue;
      void options.call("POST", "/cancel", { session: s.sessionId }).catch(() => null);
      a.cancelled = true;
      a.failed = true;
      a.finish();
    }
    if (was) setOutcome(gid, was, "failed", "you stopped it");
    await live(gid, { phase: "stopped", line: "Stopped" });
    log(`[groups] ${gid}: stopped by the user`);
  }

  /**
   * A new session: stop the group's work, retire every member's conversation
   * (the next turn starts a fresh one), and set the message log aside as
   * group-<id>.<time>.jsonl. Nothing is deleted.
   */
  async function startOver(gid: string): Promise<void> {
    const c = conductor(gid);
    c.epoch += 1;
    c.queue = [];
    c.budget = 0;
    c.lastReply = null;
    c.nudge = null;
    c.turns = 0;
    c.idle.clear();
    c.stopWhy = null;
    const g = find(gid);
    if (!g) return;
    void live(gid, { phase: "stopped", line: "New conversation" });
    // A turn in flight: cancel its run and end its wait now; it drops its reply.
    for (const s of Object.values(g.sessions)) {
      const a = s.sessionId ? actives.get(s.sessionId) : undefined;
      if (!a || !s.sessionId) continue;
      void options.call("POST", "/cancel", { session: s.sessionId }).catch(() => null);
      a.cancelled = true;
      a.failed = true;
      a.finish();
    }
    for (const id of g.members) await retire(gid, id);
    const list = await messages(gid);
    const cur = find(gid) ?? g;
    const through = list[list.length - 1]?.seq ?? cur.clearedThrough ?? 0;
    // clearedThrough first: append() numbers new messages on from it.
    replace({ ...cur, sessions: {}, clearedThrough: through, updatedAt: now().toISOString() });
    logs.set(gid, []);
    const archive = join(dir, `group-${gid}.${now().toISOString().replace(/[:.]/g, "-")}.jsonl`);
    await queueWrite(async () => {
      await rename(logPath(gid), archive).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
    }, `the old messages of ${gid}`);
    forgetActivity(gid);
    await save();
    log(`[groups] ${gid}: new session (messages up to ${through} kept in ${archive})`);
  }

  // ---------------------------------------------------------------- views

  async function view(g: Group): Promise<GroupView> {
    const { sessions: _s, ...rest } = g;
    const list = await messages(g.id);
    const last = list[list.length - 1];
    const typing = conductors.get(g.id)?.typing;
    return { ...rest, typing: typing ? [typing] : [], ...(last ? { lastMessage: last } : {}) };
  }

  async function validMembers(v: unknown): Promise<string[]> {
    const bad = `members must be 1–${MAX_MEMBERS} of your specialists`;
    if (!Array.isArray(v) || v.length < 1 || v.length > MAX_MEMBERS) throw new Invalid(bad);
    if (new Set(v).size !== v.length) throw new Invalid("members must not repeat");
    for (const id of v)
      if (typeof id !== "string" || !(await options.findBlob(id))) throw new Invalid(bad);
    return v as string[];
  }

  // ---------------------------------------------------------------- routes

  async function readJson(body: () => Promise<unknown>): Promise<Record<string, unknown>> {
    const b = await body();
    if (b === undefined) throw new Invalid("body must be JSON");
    return object(b);
  }

  async function handle(
    method: string,
    path: string,
    query: URLSearchParams,
    body: () => Promise<unknown>,
  ): Promise<Reply> {
    const notFound: Reply = { status: 404, body: { error: "not found" } };
    const notAllowed: Reply = { status: 405, body: { error: "method not allowed" } };
    if (path === "/kleio/groups") {
      if (method === "GET") {
        const views = await Promise.all(groups.map(view));
        const activity = (v: GroupView): string => v.lastMessage?.at ?? v.updatedAt;
        views.sort((a, b) => activity(b).localeCompare(activity(a)));
        return { status: 200, body: { groups: views } };
      }
      if (method !== "POST") return notAllowed;
      const o = await readJson(body);
      if (groups.length >= MAX_GROUPS)
        throw new Invalid(`you can have at most ${MAX_GROUPS} groups`);
      const at = now().toISOString();
      const g: Group = {
        id: `g_${hex()}`,
        name: text(o.name, "name", 40),
        emoji: o.emoji === undefined ? "💬" : emoji(o.emoji),
        color: o.color === undefined ? "lilac" : color(o.color),
        members: await validMembers(o.members),
        createdAt: at,
        updatedAt: at,
        sessions: {},
      };
      groups = [...groups, g];
      await save();
      log(`[groups] created ${g.id} "${g.name}" with ${g.members.length} member(s)`);
      return { status: 200, body: { group: await view(g) } };
    }

    const m = path.match(
      /^\/kleio\/groups\/(g_[0-9a-f]{8})(\/messages|\/new|\/stop|\/ask\/(ask-\d{1,9}))?$/,
    );
    if (!m) return notFound;
    const g = find(m[1]!);
    if (!g) return notFound;

    // Answer (or dismiss) a member's question: its turn is waiting on it.
    if (m[3]) {
      if (method !== "POST") return notAllowed;
      const askId = m[3];
      const asking = [...actives.entries()].find(([, a]) => a.gid === g.id && a.ask?.id === askId);
      if (!asking) return { status: 409, body: { error: "That question is no longer waiting." } };
      const [sid, a] = asking;
      const o = await readJson(body);
      if (o.action !== "answer" && o.action !== "cancel") throw new Invalid("action");
      const r = await options.call("POST", `/ask/${askId}`, {
        session: sid,
        body: o.action === "answer" ? { action: "answer", answers: answersOf(o.answers) } : o,
        timeoutMs: 15_000,
      });
      if (!r) return { status: 502, body: { error: "Couldn't reach the agent." } };
      if (r.status >= 200 && r.status < 300 && a.ask?.id === askId) {
        a.ask = null;
        void live(g.id, { phase: "working", line: `${a.name} is on it` });
      }
      return { status: r.status, body: r.body ?? {} };
    }

    if (m[2] === "/stop") {
      if (method !== "POST") return notAllowed;
      await stopWork(g.id);
      return { status: 200, body: { ok: true } };
    }

    if (m[2] === "/new") {
      if (method !== "POST") return notAllowed;
      // Two taps (or two devices) at once make one new session, not two.
      let reset = resets.get(g.id);
      if (!reset) {
        reset = startOver(g.id).finally(() => resets.delete(g.id));
        resets.set(g.id, reset);
      }
      await reset;
      return { status: 200, body: { group: await view(find(g.id) ?? g) } };
    }

    if (m[2]) {
      if (method === "GET") {
        lastPoll.set(g.id, now().getTime());
        const afterRaw = Math.floor(Number(query.get("after") ?? 0));
        const after = Number.isFinite(afterRaw) && afterRaw > 0 ? afterRaw : 0;
        const limRaw = Math.floor(Number(query.get("limit") ?? 100));
        const limit = Number.isFinite(limRaw) ? Math.min(200, Math.max(1, limRaw)) : 100;
        const list = await messages(g.id);
        const page = list.filter((x) => x.seq > after).slice(0, limit);
        const typing = conductors.get(g.id)?.typing;
        return {
          status: 200,
          body: {
            messages: page,
            typing: typing ? [typing] : [],
            lastSeq:
              page[page.length - 1]?.seq ?? list[list.length - 1]?.seq ?? g.clearedThrough ?? 0,
            ...(g.clearedThrough ? { clearedThrough: g.clearedThrough } : {}),
            ...activityOf(g),
            // Members' questions waiting on the user, by member id.
            asks: Object.fromEntries(
              [...actives.values()].flatMap((a) =>
                a.gid === g.id && a.ask ? [[a.bid, a.ask]] : [],
              ),
            ),
          },
        };
      }
      if (method !== "POST") return notAllowed;
      const o = await readJson(body);
      const said = text(o.text, "text", 4000);
      await resets.get(g.id);
      const all = await membersOf(g);
      const message = await append(g.id, {
        author: "you",
        authorName: "You",
        emoji: "🙂",
        text: said,
      });
      replace({ ...(find(g.id) ?? g), updatedAt: message.at });
      void save();
      const c = conductor(g.id);
      c.budget = MAX_TURNS;
      c.askSeq = message.seq;
      c.turns = 0;
      c.idle.clear();
      void live(g.id, { phase: "working", line: "Starting…" }, false, true);
      // Mentioned members go first, in the order mentioned. Otherwise the
      // router picks who starts; without one, everyone, most relevant first.
      const hit = mentioned(said, all);
      enqueue(g.id, hit.length ? hit : options.router ? [] : byRelevance(said, all));
      return { status: 200, body: { message } };
    }

    if (method === "GET") return { status: 200, body: { group: await view(g) } };

    if (method === "PATCH") {
      const o = await readJson(body);
      const next: Group = {
        ...g,
        ...(o.name !== undefined ? { name: text(o.name, "name", 40) } : {}),
        ...(o.emoji !== undefined ? { emoji: emoji(o.emoji) } : {}),
        ...(o.color !== undefined ? { color: color(o.color) } : {}),
        ...(o.members !== undefined ? { members: await validMembers(o.members) } : {}),
        updatedAt: now().toISOString(),
      };
      const rosterChanged =
        next.name !== g.name ||
        next.members.length !== g.members.length ||
        next.members.some((id, i) => g.members[i] !== id);
      // Every persona names the group and lists the others: retire them all,
      // so each resumes its transcript with the new description next turn.
      if (rosterChanged) for (const id of g.members) await retire(g.id, id);
      const sessions = { ...find(g.id)!.sessions };
      for (const id of g.members)
        if (!next.members.includes(id)) {
          delete sessions[id];
          forgetActivity(g.id, id);
        }
      replace({ ...next, sessions });
      await save();
      return { status: 200, body: { group: await view(find(g.id)!) } };
    }

    if (method === "DELETE") {
      for (const id of g.members) await retire(g.id, id);
      groups = groups.filter((x) => x.id !== g.id);
      conductors.delete(g.id);
      forgetActivity(g.id);
      logs.delete(g.id);
      lastPoll.delete(g.id);
      await save();
      await rm(logPath(g.id), { force: true }).catch(() => {});
      // And the logs earlier sessions set aside.
      const prefix = `group-${g.id}.`;
      for (const f of await readdir(dir).catch(() => []))
        if (f.startsWith(prefix) && f.endsWith(".jsonl"))
          await rm(join(dir, f), { force: true }).catch(() => {});
      log(`[groups] deleted ${g.id}`);
      return { status: 200, body: { ok: true } };
    }
    return notAllowed;
  }

  // ---------------------------------------------------------------- frames

  function owns(sessionId: string): boolean {
    return groups.some((g) => Object.values(g.sessions).some((s) => s.sessionId === sessionId));
  }

  function onFrame(sessionId: string, raw: string): void {
    const a = actives.get(sessionId);
    if (!a && !raw.includes('"run_end"')) return;
    const data = raw.match(/^data: (.*)$/m)?.[1];
    if (!data) return;
    let f: { type?: unknown; data?: unknown };
    try {
      f = JSON.parse(data) as typeof f;
    } catch {
      return;
    }
    const d =
      typeof f.data === "object" && f.data !== null ? (f.data as Record<string, unknown>) : {};
    switch (f.type) {
      case "run_start":
        if (a) {
          a.text = "";
          a.answer = "";
          a.stale = false;
        }
        return;
      case "turn_end":
        if (a) {
          a.stale = true;
          // Text before a tool call ("tool_use") is narration, not an answer.
          const said = a.text.trim();
          if (d.stopReason === "end_turn" && said && !isPass(said)) a.answer = said;
        }
        return;
      case "text_delta":
        if (a && typeof d.text === "string") {
          if (a.stale) a.text = "";
          a.stale = false;
          a.text += d.text;
        }
        return;
      case "run_end":
        // The transcript path appears at the first run end and moves on compaction.
        for (const g of groups)
          for (const [bid, s] of Object.entries(g.sessions))
            if (s.sessionId === sessionId)
              void thread(g.id, bid)
                .onRunEnd(sessionId)
                .catch((e) => log(`[groups] ${g.id}/${bid} path: ${String(e)}`));
        if (a) {
          a.cancelled = d.cancelled === true;
          a.failed = d.failed === true || a.cancelled;
          a.finish();
        }
        return;
      case "tool_call_start":
        if (a) {
          a.stale = true;
          toolStarted(a.activity, d);
          if (typeof d.name === "string" && d.name && d.name !== "ask_user" && !a.ask)
            void live(a.gid, { phase: "working", line: `${a.name} · ${stepText(d.name, d.args)}` });
        }
        return;
      case "server_tool_call":
        // A tool the model's provider runs (web search, web fetch): it starts
        // and finishes inside the model call, so it shows as done at once.
        if (a) {
          a.stale = true;
          serverToolCalled(a.activity, d);
          if (typeof d.name === "string" && d.name)
            void live(a.gid, {
              phase: "working",
              line: `${a.name} · ${stepText(d.name, d.input)}`,
            });
        }
        return;
      case "tool_call_end":
        if (a) {
          a.stale = true;
          toolEnded(a.activity, d);
        }
        return;
      case "error":
        if (a) {
          const why = [d.headline, d.message].filter((s) => typeof s === "string" && s.trim());
          if (why.length) a.error = why.join(": ");
        }
        return;
      case "ask_user": {
        // The member asks the user and waits: the chat shows the question's
        // buttons, and the phone lights up unless someone is watching.
        const ask = a ? askPromptOf(d) : null;
        if (!a || !ask) return;
        a.ask = ask;
        const more = ask.questions.length > 1 ? ` (+${ask.questions.length - 1} more)` : "";
        const watching = now().getTime() - (lastPoll.get(a.gid) ?? -Infinity) < WATCHING_MS;
        void live(
          a.gid,
          {
            phase: "needsYou",
            line: "Needs your help",
            detail: clip(`${a.name}: ${ask.questions[0]?.question ?? ""}${more}`, 140),
            ask: d,
          },
          !watching,
        );
        return;
      }
      case "ask_user_done":
        if (a?.ask && d.id === a.ask.id) {
          a.ask = null;
          void live(a.gid, { phase: "working", line: `${a.name} is on it` });
        }
        return;
      default:
        if (a && typeof f.type === "string" && f.type.startsWith("tool_")) a.stale = true;
    }
  }

  return {
    async load() {
      await loaded();
      return groups.flatMap((g) =>
        Object.values(g.sessions)
          .map((s) => s.sessionId)
          .filter((s): s is string => typeof s === "string"),
      );
    },
    async route(method, path, query, body) {
      if (path !== "/kleio/groups" && !path.startsWith("/kleio/groups/")) return null;
      await loaded();
      try {
        return await handle(method, path, query, body);
      } catch (e) {
        if (e instanceof Invalid) return { status: 400, body: { error: e.message } };
        throw e;
      }
    },
    onFrame,
    owns,
    async has(groupId) {
      await loaded();
      return find(groupId) !== undefined;
    },
    async onBlobDeleted(blobId) {
      await loaded();
      blobCache.delete(blobId);
      for (const g of groups.filter((x) => x.members.includes(blobId))) {
        for (const id of g.members) await retire(g.id, id);
        const cur = find(g.id)!;
        const sessions = { ...cur.sessions };
        delete sessions[blobId];
        forgetActivity(g.id, blobId);
        replace({
          ...cur,
          members: cur.members.filter((id) => id !== blobId),
          sessions,
          updatedAt: now().toISOString(),
        });
      }
      await save();
    },
    async onBlobChanged(blobId) {
      await loaded();
      blobCache.delete(blobId);
      // Its own persona and every other member's roster line describe it.
      for (const g of groups.filter((x) => x.members.includes(blobId)))
        for (const id of g.members) await retire(g.id, id);
      await save();
    },
    async retireIdle() {
      await loaded();
      let n = 0;
      for (const g of groups)
        for (const [bid, sess] of Object.entries(g.sessions)) {
          if (!sess.sessionId || conductors.get(g.id)?.typing === bid) continue;
          if (!(await sessionIdle(options.call, sess.sessionId))) continue;
          await retire(g.id, bid);
          n += 1;
        }
      if (n) await save();
      return n;
    },
    async flush() {
      await Promise.all([...conductors.values()].map((c) => c.running));
      await writes;
    },
  };
}
