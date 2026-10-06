/**
 * "Brief me": what needs you, what finished or failed, and what is still
 * working, in a few sentences to be read aloud (Siri on the phone, the app's
 * own voice on the desktop).
 *
 * The host already follows every job for the Live Activity (live-activity.ts)
 * but forgets one the moment it ends. This keeps how each job ended, with the
 * first words of its last reply, and when the owner was last briefed, so a
 * briefing only repeats what is new. Read-only: nothing here acts on a job.
 */
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./device-registry.js";
import type { LiveAttributes, LiveState } from "./live-activity.js";
import type { LivePhase } from "./live-text.js";

export type JobKind = LiveAttributes["kind"];

/** How a job ended. Times are unix seconds. */
export interface BriefOutcome {
  readonly target: string;
  readonly kind: JobKind;
  readonly title: string;
  readonly phase: "done" | "failed";
  /** The first words of the job's last reply, as plain text. */
  readonly gist?: string;
  readonly startedAt: number;
  readonly endedAt: number;
}

/** A job happening now (the Live Activity tracker's state), or one ending. */
export interface BriefJob {
  readonly target: string;
  readonly kind: JobKind;
  readonly title: string;
  readonly state: LiveState;
}

/** One job in a briefing, in the order it is said. */
export interface BriefItem {
  readonly target: string;
  readonly kind: JobKind;
  /** How the briefing names it: "Code in gg-framework", "The Launch group". */
  readonly name: string;
  readonly phase: LivePhase;
  /** Its question (needs you), its reply's gist (ended) or its step (working). */
  readonly detail?: string;
  /** Unix seconds: when it ended, or when it started. */
  readonly at: number;
}

export interface Brief {
  /** What to say. */
  readonly spoken: string;
  /** Needs you, failed, finished, still working. */
  readonly items: readonly BriefItem[];
  /** Unix seconds: jobs that ended after this were news. */
  readonly since: number;
  readonly at: number;
}

/** At most this many of each are named; the rest are counted. */
const SAY = { needsYou: 3, failed: 2, done: 3, working: 3 } as const;
const GIST_MAX = 160;
const QUESTION_MAX = 160;
const ERROR_MAX = 120;
/** A job working longer than this says for how long (a stuck one shows). */
const LONG_SECONDS = 15 * 60;
/** A chat or code reply quicker than this is a conversation, not a job. */
const MIN_JOB_SECONDS = 45;
const KEEP_OUTCOMES = 50;
const KEEP_SECONDS = 3 * 86_400;
/** The first briefing, and "everything", cover this much. */
const WINDOW_SECONDS = 86_400;
/** Asking again this soon repeats the last briefing's news (a missed word). */
const REPEAT_SECONDS = 600;
/** Enough of a reply for its first sentences. */
const REPLY_KEEP = 1_200;

const QUIET = "All quiet. Nothing needs you, nothing is running, and nothing new has finished.";

// ── Words ──────────────────────────────────────────────────────────────────

/** Markdown and links out, lines joined into sentences: text to read aloud. */
export function speakable(text: string): string {
  const lines = text
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, "")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, "$1$2")
        .replace(/\|/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((l) => l && !/^[-=:\s]+$/.test(l));
  // A line with no closing punctuation (a heading, a list item) ends a sentence.
  return lines
    .map((l, i) => (i < lines.length - 1 && !/[.!?:;,…]$/.test(l) ? `${l}.` : l))
    .join(" ");
}

/** "Reading a.ts. Done!" → ["Reading a.ts.", "Done!"] (a dot inside a word doesn't end one). */
function sentences(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === "." || c === "!" || c === "?") && (i + 1 === s.length || s[i + 1] === " ")) {
      out.push(s.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = s.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

function clipWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const base = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s,;:.-]+$/, "")}…`;
}

/** A reply's first sentences, plain, at most `max` characters. */
export function gistOf(text: string, max = GIST_MAX): string {
  const plain = speakable(text);
  let out = "";
  for (const s of sentences(plain)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out || clipWords(plain, max);
}

/** Ends with a full stop unless it already ends a sentence. */
function sentence(s: string): string {
  const t = s.trim();
  return !t || /[.!?…]$/.test(t) ? t : `${t}.`;
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Plain code-unit order: the same on every machine, unlike localeCompare. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1500 → "25 minutes", 5400 → "an hour and a half"… as said aloud. */
export function spokenDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return min === 1 ? "a minute" : `${min} minutes`;
  const hours = seconds / 3600;
  if (hours < 1.25) return "an hour";
  if (hours < 1.75) return "an hour and a half";
  if (hours < 23.5) return `${Math.round(hours)} hours`;
  return "over a day";
}

/** What the briefing calls a job. */
export function spokenName(kind: JobKind, title: string): string {
  const t = title.trim();
  switch (kind) {
    case "code":
      return t && t !== "Code" ? `Code in ${t}` : "A coding job";
    case "specialist":
      return t || "A specialist";
    case "group":
      if (!t) return "A group";
      return /\b(?:group|team|crew|squad|club|council|board|committee)$/i.test(t)
        ? `The ${t}`
        : `The ${t} group`;
    case "chat":
      return t === "Kleio" ? "Kleio" : "A chat";
  }
}

function questionOf(state: LiveState): string {
  // The lock screen's "(+1 more)" reads badly aloud.
  const q = (state.detail ?? "").replace(/\s*\(\+\d+ more\)$/, "");
  return clipWords(speakable(q), QUESTION_MAX);
}

/** A working job's step, unless it is only "Thinking…". */
function stepOf(state: LiveState): string {
  const step = state.line.replace(/(?:…|\.\.\.)$/, "").trim();
  return /^(?:Thinking|Starting|Back to work)$/i.test(step) ? "" : speakable(step);
}

/** "2 more finished." */
function more(n: number, one: string, many: string): string {
  return `${n} more ${n === 1 ? one : many}.`;
}

/** The briefing: who needs you, what failed, what finished, what's working. */
export function composeBrief(input: {
  readonly current: readonly BriefJob[];
  readonly outcomes: readonly BriefOutcome[];
  /** Unix seconds: jobs that ended after this are news. */
  readonly since: number;
  /** Unix seconds. */
  readonly now: number;
}): { spoken: string; items: BriefItem[] } {
  const busy = new Set(input.current.map((c) => c.target));
  const byStart = (a: BriefJob, b: BriefJob): number =>
    a.state.startedAt - b.state.startedAt || cmp(a.target, b.target);
  const waiting = input.current.filter((c) => c.state.phase === "needsYou").sort(byStart);
  const working = input.current.filter((c) => c.state.phase === "working").sort(byStart);
  // A job that has started again is told as working, not by its last ending.
  const ended = input.outcomes
    .filter((o) => o.endedAt > input.since && !busy.has(o.target))
    .sort((a, b) => b.endedAt - a.endedAt || cmp(a.target, b.target));
  const failed = ended.filter((o) => o.phase === "failed");
  const done = ended.filter((o) => o.phase === "done");

  const now = (c: BriefJob, detail: string): BriefItem => ({
    target: c.target,
    kind: c.kind,
    name: spokenName(c.kind, c.title),
    phase: c.state.phase,
    ...(detail ? { detail } : {}),
    at: c.state.startedAt,
  });
  const then = (o: BriefOutcome): BriefItem => ({
    target: o.target,
    kind: o.kind,
    name: spokenName(o.kind, o.title),
    phase: o.phase,
    ...(o.gist ? { detail: o.gist } : {}),
    at: o.endedAt,
  });
  const items = {
    needsYou: waiting.map((c) => now(c, questionOf(c.state))),
    failed: failed.map(then),
    done: done.map(then),
    working: working.map((c) => now(c, stepOf(c.state))),
  };
  const all = [...items.needsYou, ...items.failed, ...items.done, ...items.working];
  if (!all.length) return { spoken: QUIET, items: all };

  const said: string[] = [];
  if (!waiting.length) said.push("Nothing needs you right now.");
  const tell = (list: BriefItem[], max: number, line: (i: BriefItem) => string): number => {
    for (const i of list.slice(0, max)) said.push(upperFirst(line(i)));
    return Math.max(0, list.length - max);
  };
  // "Chef finished. Here are tonight's ideas." — two sentences read better
  // aloud than one with a colon.
  const told = (i: BriefItem, verb: string): string =>
    i.detail ? `${i.name} ${verb}. ${upperFirst(sentence(i.detail))}` : `${i.name} ${verb}.`;
  const workingFor = (i: BriefItem): string => {
    const took = input.now - i.at;
    return took >= LONG_SECONDS
      ? `${i.name} has been working for ${spokenDuration(took)}.`
      : `${i.name} is working.`;
  };

  let rest = tell(items.needsYou, SAY.needsYou, (i) => told(i, "needs you"));
  if (rest) said.push(more(rest, "needs you too", "need you too"));
  rest = tell(items.failed, SAY.failed, (i) => told(i, "failed"));
  if (rest) said.push(more(rest, "failed", "failed"));
  rest = tell(items.done, SAY.done, (i) => told(i, "finished"));
  if (rest) said.push(more(rest, "finished", "finished"));
  rest = tell(items.working, SAY.working, (i) =>
    i.detail ? `${workingFor(i)} ${upperFirst(sentence(i.detail))}` : workingFor(i),
  );
  if (rest) said.push(more(rest, "is working", "are working"));
  return { spoken: said.join(" "), items: all };
}

// ── State ──────────────────────────────────────────────────────────────────

/** When the owner was last briefed, and what that briefing counted as news. */
interface Heard {
  readonly at: number;
  readonly since: number;
}

export interface Briefing {
  /** Read what was kept (once, before any frame). */
  load(): Promise<void>;
  /** Every frame of a followed session (not a group member's): keeps its reply. */
  onFrame(sessionId: string, raw: string): void;
  /** A job ended (the Live Activity tracker's end). */
  ended(job: BriefJob): void;
  /** A session is no longer followed. */
  forget(sessionId: string): void;
  /**
   * Compose a briefing from what is happening now and mark it heard, for
   * every device. `all`: the last day's endings, heard or not.
   */
  brief(current: readonly BriefJob[], opts?: { readonly all?: boolean }): Brief;
  /** Settles once every write so far has landed. */
  flush(): Promise<void>;
}

const REPLY_FRAME_RE =
  /"type":"(run_start|text_delta|tool_call_start|tool_call_end|turn_end|error)"/;
const KINDS: readonly string[] = ["chat", "code", "specialist", "group"];

function isOutcome(v: unknown): v is BriefOutcome {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.target === "string" &&
    typeof o.kind === "string" &&
    KINDS.includes(o.kind) &&
    typeof o.title === "string" &&
    (o.phase === "done" || o.phase === "failed") &&
    (o.gist === undefined || typeof o.gist === "string") &&
    Number.isFinite(o.startedAt) &&
    Number.isFinite(o.endedAt)
  );
}

function isHeard(v: unknown): v is Heard {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return Number.isFinite(h.at) && Number.isFinite(h.since);
}

export function createBriefing(opts: {
  readonly statePath: string;
  /** ms */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}): Briefing {
  const log = opts.log ?? ((): void => {});
  const nowSec = (): number => (opts.now ?? Date.now)() / 1000;
  let outcomes: BriefOutcome[] = [];
  let heard: Heard | null = null;
  /** Each session's current message so far (after its last tool call), and its last error. */
  const replies = new Map<string, { text: string; stale: boolean; error?: string }>();
  let saving: Promise<void> = Promise.resolve();

  function save(): void {
    const data = `${JSON.stringify({ version: 1, heard, outcomes }, null, 2)}\n`;
    saving = saving
      .then(() => atomicWrite(opts.statePath, data, 0o600))
      .catch((e: unknown) => log(`[brief] could not save: ${String(e)}`));
  }

  function prune(at: number): void {
    outcomes = outcomes.filter((o) => o.endedAt > at - KEEP_SECONDS).slice(-KEEP_OUTCOMES);
  }

  return {
    async load() {
      let raw: string;
      try {
        raw = await readFile(opts.statePath, "utf8");
      } catch {
        return; // first start
      }
      try {
        const o = JSON.parse(raw) as { heard?: unknown; outcomes?: unknown };
        outcomes = Array.isArray(o.outcomes) ? o.outcomes.filter(isOutcome) : [];
        heard = isHeard(o.heard) ? { at: o.heard.at, since: o.heard.since } : null;
        prune(nowSec());
      } catch (e) {
        log(`[brief] ignored unreadable ${opts.statePath}: ${String(e)}`);
      }
    },
    onFrame(sessionId, raw) {
      const type = REPLY_FRAME_RE.exec(raw)?.[1];
      if (!type) return;
      const r = replies.get(sessionId);
      if (type === "run_start") {
        replies.set(sessionId, { text: "", stale: false });
        return;
      }
      if (type !== "text_delta" && type !== "error") {
        // A tool call or a turn's end: the next text is a new message.
        if (r) r.stale = true;
        return;
      }
      // Enough of this message kept: skip parsing the rest of it.
      if (type === "text_delta" && r && !r.stale && r.text.length >= REPLY_KEEP) return;
      let d: Record<string, unknown>;
      try {
        const f = JSON.parse(raw.match(/^data: (.*)$/m)?.[1] ?? "null") as {
          data?: unknown;
        } | null;
        d =
          typeof f?.data === "object" && f.data !== null ? (f.data as Record<string, unknown>) : {};
      } catch {
        return;
      }
      const reply = r ?? { text: "", stale: false };
      replies.set(sessionId, reply);
      if (type === "error") {
        // The plain-English headline ("Claude usage limit reached.") first.
        const msg = typeof d.headline === "string" && d.headline ? d.headline : d.message;
        if (typeof msg === "string" && msg.trim()) reply.error = msg;
        return;
      }
      if (typeof d.text !== "string") return;
      if (reply.stale) reply.text = "";
      reply.stale = false;
      reply.text += d.text;
    },
    ended(job) {
      const sessionId = job.target.startsWith("s:") ? job.target.slice(2) : null;
      const reply = sessionId ? replies.get(sessionId) : undefined;
      if (sessionId) replies.delete(sessionId);
      const { phase, startedAt } = job.state;
      // Stopped is the owner's own doing (or a group's pause they'll see).
      if (phase !== "done" && phase !== "failed") return;
      const endedAt = job.state.endedAt ?? nowSec();
      const quick = endedAt - startedAt < MIN_JOB_SECONDS;
      if (phase === "done" && quick && (job.kind === "chat" || job.kind === "code")) return;
      // Why it failed, else what it last said (a group: its last message).
      const said = reply?.text.trim() ? reply.text : (job.state.detail ?? "");
      const gist =
        phase === "failed" && reply?.error
          ? clipWords(speakable(reply.error), ERROR_MAX)
          : said
            ? gistOf(said)
            : "";
      outcomes = [
        ...outcomes.filter((o) => o.target !== job.target),
        {
          target: job.target,
          kind: job.kind,
          title: job.title,
          phase,
          ...(gist ? { gist } : {}),
          startedAt,
          endedAt,
        },
      ];
      prune(nowSec());
      save();
    },
    forget(sessionId) {
      replies.delete(sessionId);
    },
    brief(current, o = {}) {
      const at = nowSec();
      // Asked again straight away: the same news again (plus anything newer),
      // and the clock for "new" stays where that briefing put it.
      const repeat = !o.all && heard !== null && at - heard.at < REPEAT_SECONDS;
      const since = o.all || heard === null ? at - WINDOW_SECONDS : repeat ? heard.since : heard.at;
      const { spoken, items } = composeBrief({ current, outcomes, since, now: at });
      if (!o.all && !repeat) {
        heard = { at, since };
        save();
      }
      return { spoken, items, since, at };
    },
    async flush() {
      for (;;) {
        const s = saving;
        await s;
        if (s === saving) return;
      }
    },
  };
}
