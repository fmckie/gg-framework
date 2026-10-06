/**
 * Push the phone when the agent parks a turn on an `ask_user` question.
 *
 * The sidecar broadcasts `ask_user` `{id, questions}` when a question is
 * parked and `ask_user_done` `{id}` when it settles (answered anywhere,
 * cancelled, timed out). A question nobody is watching is pushed at once; one
 * a device is watching is re-checked after a grace period and pushed only if
 * it is still open and the watcher has gone. A settled question is never
 * pushed. Text only: the question and the option labels, clipped.
 */
import type { Nudge } from "./apns.js";

export const ASK_RECHECK_MS = 20_000;
const TITLE_MAX = 120;
const BODY_MAX = 200;

export type AskFrame =
  | { readonly type: "ask"; readonly id: string; readonly title: string; readonly body: string }
  | { readonly type: "done"; readonly id: string };

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

interface RawQuestion {
  question?: unknown;
  kind?: unknown;
  options?: unknown;
}

function optionLabels(q: RawQuestion): string[] {
  if (Array.isArray(q.options)) {
    return q.options
      .map((o: unknown) =>
        typeof o === "object" && o !== null && typeof (o as { label?: unknown }).label === "string"
          ? (o as { label: string }).label
          : "",
      )
      .filter((l) => l.trim() !== "");
  }
  return q.kind === "confirm" ? ["Yes", "No"] : [];
}

/** Lock-screen text for a question: title = first question, body = its options. */
export function askNudgeText(questions: readonly RawQuestion[]): { title: string; body: string } {
  const first = questions[0];
  const question = typeof first?.question === "string" ? first.question : "";
  const more = questions.length > 1 ? ` (+${questions.length - 1} more)` : "";
  const title = `${clip(question || "Kleio has a question", TITLE_MAX - more.length)}${more}`;
  const labels = first ? optionLabels(first) : [];
  const body = labels.length ? clip(labels.join(" · "), BODY_MAX) : "Tap to answer.";
  return { title, body };
}

/** Parse an SSE frame into an ask event, or null for anything else. */
export function parseAskFrame(raw: string): AskFrame | null {
  if (!raw.includes('"ask_user')) return null;
  const data = raw.match(/^data: (.*)$/m)?.[1];
  if (!data) return null;
  let f: { type?: unknown; data?: unknown };
  try {
    f = JSON.parse(data) as { type?: unknown; data?: unknown };
  } catch {
    return null;
  }
  const d =
    typeof f.data === "object" && f.data !== null ? (f.data as Record<string, unknown>) : {};
  if (typeof d.id !== "string") return null;
  if (f.type === "ask_user_done") return { type: "done", id: d.id };
  if (f.type !== "ask_user") return null;
  const questions = Array.isArray(d.questions)
    ? d.questions.filter((q: unknown): q is RawQuestion => typeof q === "object" && q !== null)
    : [];
  return { type: "ask", id: d.id, ...askNudgeText(questions) };
}

export interface AskNotifier {
  /** Feed every frame of a tracked session. `eligible` false = never push (group member). */
  onFrame(sessionId: string, raw: string, eligible: boolean): void;
  stop(): void;
}

export function createAskNotifier(opts: {
  /** Whether any device is attached to the session's stream right now. */
  attached: (sessionId: string) => boolean;
  push: (nudge: Nudge) => void;
  recheckMs?: number;
}): AskNotifier {
  const recheckMs = opts.recheckMs ?? ASK_RECHECK_MS;
  // Open questions by `${sessionId}\n${askId}`, with their recheck timer.
  const open = new Map<string, ReturnType<typeof setTimeout> | null>();
  const key = (sessionId: string, id: string): string => `${sessionId}\n${id}`;

  return {
    onFrame(sessionId, raw, eligible) {
      const f = parseAskFrame(raw);
      if (!f) return;
      const k = key(sessionId, f.id);
      if (f.type === "done") {
        const timer = open.get(k);
        if (timer) clearTimeout(timer);
        open.delete(k);
        return;
      }
      if (!eligible || open.has(k)) return;
      const nudge: Nudge = { sessionId, title: f.title, body: f.body, ask: true };
      if (!opts.attached(sessionId)) {
        open.set(k, null);
        opts.push(nudge);
        return;
      }
      const timer = setTimeout(() => {
        if (!open.has(k)) return;
        open.set(k, null);
        if (!opts.attached(sessionId)) opts.push(nudge);
      }, recheckMs);
      timer.unref?.();
      open.set(k, timer);
    },
    stop() {
      for (const t of open.values()) if (t) clearTimeout(t);
      open.clear();
    },
  };
}
