/**
 * One anatomy for every Kleio alert notification.
 *
 *   title    the conversation's own name (project folder, chat title,
 *            specialist or group name)
 *   subtitle what happened, 1-3 words: "Finished", "Needs your answer", …
 *   body     the substance as plain text: the reply, the question, the error
 *
 * Pure: the APNs pusher (apns.ts) and the Live Activity alerts
 * (live-activity.ts callers) render through `noticeFor`. A small reply
 * tracker (`createReplyTracker`) collects the text a run-end notice quotes.
 */

import { createHash } from "node:crypto";

/** What a notification is about. */
export type NoticeKind = "finished" | "failed" | "stopped" | "question" | "message";

/** The raw material for one notification, before any wording. */
export interface NoticeInput {
  readonly kind: NoticeKind;
  /** The conversation's own name. */
  readonly name?: string;
  /** The substance, markdown allowed: the final reply, the question, the error. */
  readonly text?: string;
  /** `message` only: who replied (a specialist's name). */
  readonly author?: string;
}

export interface Notice {
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly interruptionLevel: "active" | "passive";
  readonly relevanceScore: number;
  /** Run ends only: a newer one replaces the older in Notification Centre. */
  readonly collapseId?: string;
}

export const BODY_MAX = 170;
const TITLE_MAX = 60;
const AUTHOR_MAX = 24;
/** APNs rejects an `apns-collapse-id` over 64 bytes. */
export const COLLAPSE_ID_MAX_BYTES = 64;

const FALLBACK_TITLE = "Kleio";

const SUBTITLES: Readonly<Record<Exclude<NoticeKind, "message">, string>> = {
  finished: "Finished",
  failed: "Couldn't finish",
  stopped: "Stopped",
  question: "Needs your answer",
};

const FALLBACK_BODIES: Readonly<Record<NoticeKind, string>> = {
  finished: "Tap to see the result.",
  failed: "Something went wrong. Tap to see what happened.",
  stopped: "The run was stopped before it finished.",
  question: "Tap to answer.",
  message: "Tap to read the reply.",
};

const RELEVANCE: Readonly<Record<NoticeKind, number>> = {
  question: 1,
  failed: 0.8,
  finished: 0.6,
  stopped: 0.3,
  message: 0.3,
};

const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;

/** Emoji out, em/en dashes softened, whitespace collapsed. */
function tidy(text: string): string {
  return text
    .replace(EMOJI, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

/** Markdown to one line of plain text. */
export function plainText(markdown: string): string {
  let t = markdown.replace(/\r\n?/g, "\n");
  // Fenced code blocks, contents and all (an unclosed fence runs to the end).
  t = t.replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, "$1");
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  // Images go; links keep their text.
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  t = t.replace(/<(https?:[^>\s]+)>/g, "$1");
  t = t.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // Line-level markers: headings, quotes, lists, rules, table pipes.
  const lines = t
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(>\s?)+/, "")
        .replace(/^\s*([-*+]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?/, "")
        .replace(/^\s*([-*_]\s*){3,}$/, "")
        .replace(/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/, "")
        .replace(/\s*\|\s*/g, " ")
        .trim(),
    )
    .filter(Boolean);
  // With several lines, one ending without punctuation reads as its own sentence.
  t = (lines.length > 1 ? lines.map((l) => (/[.!?:;,…]$/.test(l) ? l : `${l}.`)) : lines).join(" ");
  // Inline code keeps its text; emphasis markers go.
  t = t.replace(/`+([^`]*)`+/g, "$1");
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  t = t.replace(/(^|[^\w*])[*_](?=\S)([^*_]*?\S)[*_](?!\w)/g, "$1$2");
  t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1");
  return tidy(t);
}

/** At most `max` characters, cut at a word boundary with a single "…". */
export function clipAtWord(text: string, max: number = BODY_MAX): string {
  const cs = [...text.trim()];
  if (cs.length <= max) return cs.join("");
  const head = cs.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  // A single very long word is cut mid-word rather than left nearly empty.
  const cut = space >= Math.floor(max / 2) ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,;:.!?-]+$/, "")}…`;
}

/** A one-line name: plain, no emoji, clipped. */
function cleanName(name: string | undefined, max: number): string {
  return clipAtWord(tidy(name ?? ""), max);
}

/**
 * `apns-collapse-id` for a run end: one per conversation, shared by
 * finished, failed and stopped so the newest replaces the last. Never over
 * 64 bytes: a long id is hashed.
 */
export function collapseIdFor(conversationId: string, kind: NoticeKind): string | undefined {
  if (kind !== "finished" && kind !== "failed" && kind !== "stopped") return undefined;
  const id = `${conversationId}:run`;
  if (Buffer.byteLength(id, "utf8") <= COLLAPSE_ID_MAX_BYTES) return id;
  return `${createHash("sha256").update(conversationId).digest("hex").slice(0, 48)}:run`;
}

/** The words and weights for one notification. */
export function noticeFor(input: NoticeInput, conversationId?: string): Notice {
  const title = cleanName(input.name, TITLE_MAX) || FALLBACK_TITLE;
  const author = cleanName(input.author, AUTHOR_MAX);
  const subtitle =
    input.kind === "message" ? (author ? `${author} replied` : "New reply") : SUBTITLES[input.kind];
  const body = clipAtWord(plainText(input.text ?? ""), BODY_MAX) || FALLBACK_BODIES[input.kind];
  const collapseId = conversationId ? collapseIdFor(conversationId, input.kind) : undefined;
  return {
    title,
    subtitle,
    body,
    // Every kind is something the user started and is waiting on; none is
    // background info, so none is "passive" (which would also mute the sound).
    interruptionLevel: "active",
    relevanceScore: RELEVANCE[input.kind],
    ...(collapseId ? { collapseId } : {}),
  };
}

// ── Run replies ────────────────────────────────────────────────────────────

/** How a run ended, and what a run-end notice should quote. */
export interface RunOutcome {
  readonly kind: "finished" | "failed" | "stopped";
  readonly text?: string;
}

export interface ReplyTracker {
  /** Feed every SSE frame of a session; returns the outcome on `run_end`. */
  onFrame(sessionId: string, raw: string): RunOutcome | null;
  forget(sessionId: string): void;
}

/** Kept per session: enough for a 170-character body after markdown is stripped. */
const REPLY_KEEP = 4000;
const FRAME_HINT = /"(run_start|text_delta|tool_call_start|server_tool_call|error|run_end)"/;

/**
 * The final reply's text per session (text after the last tool call) and the
 * last error headline, so a run-end notice can quote it.
 */
export function createReplyTracker(): ReplyTracker {
  const runs = new Map<string, { text: string; error?: string; afterTool: boolean }>();
  return {
    onFrame(sessionId, raw) {
      if (!FRAME_HINT.test(raw)) return null;
      const data = raw.match(/^data: (.*)$/m)?.[1];
      if (!data) return null;
      let f: { type?: unknown; data?: unknown };
      try {
        f = JSON.parse(data) as typeof f;
      } catch {
        return null;
      }
      const d =
        typeof f.data === "object" && f.data !== null ? (f.data as Record<string, unknown>) : {};
      let r = runs.get(sessionId);
      if (!r) runs.set(sessionId, (r = { text: "", afterTool: false }));
      switch (f.type) {
        case "run_start":
          runs.set(sessionId, { text: "", afterTool: false });
          return null;
        case "tool_call_start":
        case "server_tool_call":
          r.afterTool = true;
          return null;
        case "text_delta":
          if (typeof d.text !== "string") return null;
          // A new message after a tool call: the final reply starts over.
          if (r.afterTool) {
            r.text = "";
            r.afterTool = false;
          }
          if (r.text.length < REPLY_KEEP) r.text += d.text;
          return null;
        case "error": {
          const h = typeof d.headline === "string" && d.headline ? d.headline : d.message;
          if (typeof h === "string" && h) r.error = h;
          return null;
        }
        case "run_end": {
          runs.delete(sessionId);
          if (d.cancelled === true) return { kind: "stopped" };
          if (d.failed === true) return { kind: "failed", ...(r.error ? { text: r.error } : {}) };
          const text = r.text.trim();
          return { kind: "finished", ...(text ? { text } : {}) };
        }
        default:
          return null;
      }
    },
    forget(sessionId) {
      runs.delete(sessionId);
    },
  };
}
