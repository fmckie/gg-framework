/**
 * Plain words for the iPhone Live Activity (lock screen + Dynamic Island).
 *
 * Shared by session targets (live-activity.ts) and group targets (groups.ts).
 * Never the tool's output or full args: a step names the kind of work and, at
 * most, a short file name.
 */
import { toolSummary } from "./groups.js";

export type LivePhase = "working" | "needsYou" | "done" | "failed" | "stopped";

/** What a group target shows; the host adds the timestamps. */
export interface GroupLive {
  readonly phase: LivePhase;
  readonly line: string;
  readonly detail?: string;
  /** With needsYou: the `ask_user` data, so the activity can offer its options. */
  readonly ask?: Readonly<Record<string, unknown>>;
}

/** At most this many options become buttons on the lock screen. */
export const OPTIONS_MAX = 4;
const OPTION_MAX = 24;

/** A question the lock screen can answer with one tap. */
export interface AskButtons {
  readonly askId: string;
  readonly questionId: string;
  /** What the buttons say. */
  readonly labels: readonly string[];
  /** What each button answers (the option's value, else its label). */
  readonly values: readonly string[];
  /** The option the agent recommends, if it marked one. */
  readonly recommended: number | null;
}

const ASK_ID = /^ask-\d{1,9}$/;

/**
 * The buttons for an `ask_user` question, or null when it needs the app: one
 * question only, a single pick (choice or confirm), 1–OPTIONS_MAX options.
 */
export function askButtons(d: Readonly<Record<string, unknown>>): AskButtons | null {
  const { id, questions } = d;
  if (typeof id !== "string" || !ASK_ID.test(id) || !Array.isArray(questions)) return null;
  if (questions.length !== 1) return null;
  const q: unknown = questions[0];
  if (typeof q !== "object" || q === null) return null;
  const { id: qid, kind, options } = q as { id?: unknown; kind?: unknown; options?: unknown };
  if (typeof qid !== "string" || (kind !== "choice" && kind !== "confirm")) return null;
  const raw: unknown[] = Array.isArray(options)
    ? options
    : kind === "confirm"
      ? [{ label: "Yes" }, { label: "No" }]
      : [];
  if (raw.length < 1 || raw.length > OPTIONS_MAX) return null;
  const labels: string[] = [];
  const values: string[] = [];
  let recommended: number | null = null;
  for (const o of raw) {
    if (typeof o !== "object" || o === null) return null;
    const {
      label,
      value,
      recommended: rec,
    } = o as {
      label?: unknown;
      value?: unknown;
      recommended?: unknown;
    };
    if (typeof label !== "string" || !label.trim()) return null;
    if (rec === true && recommended === null) recommended = labels.length;
    labels.push(clipText(label, OPTION_MAX));
    values.push(typeof value === "string" && value ? value : label);
  }
  return { askId: id, questionId: qid, labels, values, recommended };
}

export const LINE_MAX = 60;
export const DETAIL_MAX = 140;
export const TITLE_MAX = 40;
const FILE_MAX = 28;

/** Clip to `max` code points, ending with … when cut. Whitespace collapsed. */
export function clipText(text: string, max: number): string {
  const cs = [...text.replace(/\s+/g, " ").trim()];
  return cs.length > max ? `${cs.slice(0, max - 1).join("")}…` : cs.join("");
}

/** One tool call as a plain step, e.g. "Editing host.ts", "Running a command". */
export function stepText(name: string, args: unknown): string {
  const summary = toolSummary(args);
  const last = summary.split(/[/\\]/).pop()?.trim() ?? "";
  const file = last && [...last].length <= FILE_MAX ? last : "";
  let line: string;
  switch (name) {
    case "bash":
      line = "Running a command";
      break;
    case "read":
      line = file ? `Reading ${file}` : "Reading a file";
      break;
    case "write":
      line = file ? `Writing ${file}` : "Writing a file";
      break;
    case "edit":
      line = file ? `Editing ${file}` : "Editing a file";
      break;
    case "ls":
    case "grep":
    case "find":
      line = "Searching files";
      break;
    case "web_fetch":
      line = "Reading a web page";
      break;
    case "web_search":
      line = "Searching the web";
      break;
    case "subagent":
      line = "Handing off a task";
      break;
    default:
      line = "Working";
  }
  return clipText(line, LINE_MAX);
}
