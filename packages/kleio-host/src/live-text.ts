/**
 * Plain words for the iPhone Live Activity (lock screen + Dynamic Island).
 *
 * Shared by session targets (live-activity.ts) and group targets (groups.ts).
 * Never the tool's output or full args: a step names the kind of work and, at
 * most, a short file name.
 */
import { toolSummary } from "./tool-activity.js";

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

/** One tool call as a step of the run's trail. */
export interface ToolStep {
  /** What kind of action it is: calls of one kind in a row are one step. */
  readonly kind: string;
  /** While it runs: "Editing host.ts". */
  readonly line: string;
  /** Once it's done: "Edited host.ts". */
  readonly done: string;
}

/** One tool call as a step, e.g. "Editing host.ts" (done: "Edited host.ts"). */
export function toolStep(name: string, args: unknown): ToolStep {
  const summary = toolSummary(args);
  const last = summary.split(/[/\\]/).pop()?.trim() ?? "";
  const file = last && [...last].length <= FILE_MAX ? last : "";
  const step = (kind: string, line: string, done: string): ToolStep => ({
    kind,
    line: clipText(line, LINE_MAX),
    done: clipText(done, LINE_MAX),
  });
  switch (name) {
    case "bash":
      return step("command", "Running a command", "Ran a command");
    case "read":
      return file
        ? step("read", `Reading ${file}`, `Read ${file}`)
        : step("read", "Reading a file", "Read a file");
    case "write":
      return file
        ? step("write", `Writing ${file}`, `Wrote ${file}`)
        : step("write", "Writing a file", "Wrote a file");
    case "edit":
      return file
        ? step("edit", `Editing ${file}`, `Edited ${file}`)
        : step("edit", "Editing a file", "Edited a file");
    case "ls":
    case "grep":
    case "find":
      return step("search", "Searching files", "Searched files");
    case "web_fetch":
      return step("web_page", "Reading a web page", "Read a web page");
    case "web_search":
      return step("web_search", "Searching the web", "Searched the web");
    case "subagent":
      return step("handoff", "Handing off a task", "Handed off a task");
    default:
      // Each other tool is its own kind: two different ones are two steps.
      return step(`tool:${name}`, "Working", "Used a tool");
  }
}

/** One tool call as a plain step, e.g. "Editing host.ts", "Running a command". */
export function stepText(name: string, args: unknown): string {
  return toolStep(name, args).line;
}

/** A step of several calls, in the past tense; searches read the same however many. */
const MANY_DONE: Readonly<Record<string, (n: number) => string>> = {
  command: (n) => `Ran ${n} commands`,
  read: (n) => `Read ${n} files`,
  write: (n) => `Wrote ${n} files`,
  edit: (n) => `Edited ${n} files`,
  web_page: (n) => `Read ${n} web pages`,
  handoff: (n) => `Handed off ${n} tasks`,
};

/**
 * A finished step in the past tense: what its one call did (`last`, e.g.
 * "Read host.ts"), or a count of its `calls` ("Read 3 files").
 */
export function stepDone(kind: string, calls: number, last: string): string {
  if (calls <= 1) return last;
  const many = MANY_DONE[kind];
  if (many) return many(calls);
  return kind.startsWith("tool:") ? `Used a tool ${calls} times` : last;
}
