/**
 * Group chats: several Blobs in one conversation with the user.
 *
 * The user posts; the members they @mention reply (everyone, in member order,
 * when nobody is mentioned); a reply that @mentions another member hands the
 * turn on. Each (group, Blob) pair has its own pinned sidecar conversation, a
 * persona of the Blob's job plus a short group addendum, so a Blob keeps
 * context between turns. Every turn is prompted with the group messages that
 * Blob has not seen yet. One serial queue per group; at most MAX_TURNS Blob
 * turns per user message. A Blob that has nothing to add answers PASS and
 * posts nothing.
 *
 * State: groups.json (atomic), messages in group-<id>.jsonl (last 500). The
 * conductor's queue is in memory only: after a restart the log is the truth.
 */
import { appendFile, readFile, rm } from "node:fs/promises";
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
  /** How long one Blob's turn may run. Default 120 s. */
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

const MAX_GROUPS = 20;
const MAX_MEMBERS = 8;
const MAX_TURNS = 6;
const KEEP_MESSAGES = 500;
const PROMPT_MESSAGES = 30;
const PROMPT_CHARS = 6000;
const NOTIFY_BODY_CHARS = 180;
/** No push while a device polled the group this recently (it's on screen). */
const WATCHING_MS = 20_000;
const INSTRUCTIONS_MAX = 8000;

interface Active {
  text: string;
  stale: boolean;
  failed: boolean;
  readonly finish: () => void;
}

interface Conductor {
  queue: string[];
  budget: number;
  running: Promise<void> | null;
  typing: string | null;
  lastReply: GroupMessage | null;
}

const clip = (s: string, n: number): string => {
  const cs = [...s];
  return cs.length > n ? `${cs.slice(0, n - 1).join("")}…` : s;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Members a text @mentions, in member order; longest names match first. */
export function mentioned(textIn: string, members: readonly Blob[]): string[] {
  let rest = textIn;
  const hit = new Set<string>();
  for (const b of [...members].sort((a, c) => c.name.length - a.name.length)) {
    const re = new RegExp(`@${escapeRegExp(b.name)}(?![\\p{L}\\p{N}_])`, "giu");
    if (re.test(rest)) {
      hit.add(b.id);
      rest = rest.replace(re, " ");
    }
  }
  return members.filter((b) => hit.has(b.id)).map((b) => b.id);
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

export function createGroups(options: GroupsOptions): Groups {
  const log = options.log ?? ((msg: string) => console.error(msg));
  const now = options.now ?? (() => new Date());
  const turnTimeoutMs = options.turnTimeoutMs ?? 120_000;
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
  /** Blob data for sessionFields(), which must answer synchronously. */
  const blobCache = new Map<string, Blob>();

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
      seq: (list[list.length - 1]?.seq ?? 0) + 1,
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

  // ---------------------------------------------------------------- conductor

  function conductor(gid: string): Conductor {
    let c = conductors.get(gid);
    if (!c) {
      c = { queue: [], budget: 0, running: null, typing: null, lastReply: null };
      conductors.set(gid, c);
    }
    return c;
  }

  function enqueue(gid: string, ids: string[]): void {
    const c = conductor(gid);
    for (const id of ids) if (!c.queue.includes(id)) c.queue.push(id);
    c.running ??= pump(gid).finally(() => {
      c.running = null;
    });
  }

  async function pump(gid: string): Promise<void> {
    const c = conductor(gid);
    while (c.queue.length && c.budget > 0) {
      const bid = c.queue.shift()!;
      c.budget -= 1;
      try {
        await turn(gid, bid);
      } catch (e) {
        log(`[groups] ${gid} turn of ${bid} failed: ${String(e)}`);
      }
    }
    c.queue = [];
    const last = c.lastReply;
    c.lastReply = null;
    const g = find(gid);
    if (!last || !g || !options.notify) return;
    if (now().getTime() - (lastPoll.get(gid) ?? -Infinity) < WATCHING_MS) return;
    await options
      .notify({
        groupId: gid,
        title: `${g.emoji} ${g.name}`,
        body: clip(`${last.authorName}: ${last.text}`, NOTIFY_BODY_CHARS),
      })
      .catch((e) => log(`[groups] notify ${gid}: ${String(e)}`));
  }

  async function turn(gid: string, bid: string): Promise<void> {
    const g = find(gid);
    if (!g || !g.members.includes(bid)) return;
    const all = await membersOf(g);
    const self = all.find((b) => b.id === bid);
    if (!self) return;
    const list = await messages(gid);
    const seen = g.sessions[bid]?.seenSeq ?? 0;
    const unseen = list.filter((m) => m.seq > seen && m.author !== bid);
    if (!unseen.length) return;

    const c = conductor(gid);
    c.typing = bid;
    let sessionId: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      const session = await thread(gid, bid).resolve();
      if (!session.ok) {
        log(`[groups] ${gid}: ${self.name} unavailable: ${session.error.error}`);
        return;
      }
      const sid = session.value.sessionId;
      sessionId = sid;
      setSession(gid, bid, { seenSeq: list[list.length - 1]!.seq });
      void save();

      const ended = new Promise<"done" | "timeout">((resolve) => {
        actives.set(sid, { text: "", stale: false, failed: false, finish: () => resolve("done") });
        timer = setTimeout(() => resolve("timeout"), turnTimeoutMs);
      });
      const r = await options.call("POST", "/prompt", {
        session: sid,
        body: { text: promptFor(unseen) },
        timeoutMs: 30_000,
      });
      if (!r || r.status < 200 || r.status >= 300) {
        log(`[groups] ${gid}: prompting ${self.name} -> ${r ? r.status : "unreachable"}`);
        return;
      }
      if ((await ended) === "timeout") {
        log(`[groups] ${gid}: ${self.name} took too long`);
        void options.call("POST", "/cancel", { session: sid }).catch(() => null);
        return;
      }
      const a = actives.get(sid);
      const reply = a?.text.trim() ?? "";
      if (!a || a.failed || !reply || isPass(reply)) return;
      const msg = await append(gid, {
        author: bid,
        authorName: self.name,
        emoji: self.emoji,
        text: clip(reply, 4000),
      });
      setSession(gid, bid, { seenSeq: msg.seq });
      void save();
      c.lastReply = msg;
      for (const id of mentioned(reply, all))
        if (id !== bid && !c.queue.includes(id)) c.queue.push(id);
    } finally {
      clearTimeout(timer);
      if (sessionId) actives.delete(sessionId);
      if (c.typing === bid) c.typing = null;
    }
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
    const bad = `members must be 1–${MAX_MEMBERS} of your agents`;
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

    const m = path.match(/^\/kleio\/groups\/(g_[0-9a-f]{8})(\/messages)?$/);
    if (!m) return notFound;
    const g = find(m[1]!);
    if (!g) return notFound;

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
            lastSeq: page.length ? page[page.length - 1]!.seq : (list[list.length - 1]?.seq ?? 0),
          },
        };
      }
      if (method !== "POST") return notAllowed;
      const o = await readJson(body);
      const said = text(o.text, "text", 4000);
      const all = await membersOf(g);
      const message = await append(g.id, {
        author: "you",
        authorName: "You",
        emoji: "🙂",
        text: said,
      });
      replace({ ...find(g.id)!, updatedAt: message.at });
      void save();
      const hit = mentioned(said, all);
      conductor(g.id).budget = MAX_TURNS;
      enqueue(g.id, hit.length ? hit : all.map((b) => b.id));
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
      for (const id of g.members) if (!next.members.includes(id)) delete sessions[id];
      replace({ ...next, sessions });
      await save();
      return { status: 200, body: { group: await view(find(g.id)!) } };
    }

    if (method === "DELETE") {
      for (const id of g.members) await retire(g.id, id);
      groups = groups.filter((x) => x.id !== g.id);
      conductors.delete(g.id);
      logs.delete(g.id);
      lastPoll.delete(g.id);
      await save();
      await rm(logPath(g.id), { force: true }).catch(() => {});
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
          a.stale = false;
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
          a.failed = d.failed === true || d.cancelled === true;
          a.finish();
        }
        return;
      default:
        if (
          a &&
          typeof f.type === "string" &&
          (f.type === "turn_end" || f.type.startsWith("tool_"))
        )
          a.stale = true;
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
    async onBlobDeleted(blobId) {
      await loaded();
      blobCache.delete(blobId);
      for (const g of groups.filter((x) => x.members.includes(blobId))) {
        for (const id of g.members) await retire(g.id, id);
        const cur = find(g.id)!;
        const sessions = { ...cur.sessions };
        delete sessions[blobId];
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
