/**
 * The tool calls of an agent's current or last turn, as the chats show them
 * live: one clipped line from the args, never the tool's output or full args.
 * A group keeps a list per member (groups.ts), a Blob one for its own chat
 * (blobs.ts).
 */

/** Tool calls kept per turn; older ones roll off. */
const MAX_ACTIVITY = 30;
const SUMMARY_CHARS = 120;

/** One tool call of a turn: a one-line summary of its args, never its output. */
export interface ActivityEntry {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  status: "running" | "done" | "failed";
  readonly startedAt: string;
  endedAt?: string;
}

const clip = (s: string, n: number): string => {
  const cs = [...s];
  return cs.length > n ? `${cs.slice(0, n - 1).join("")}…` : s;
};

const oneLine = (s: string, n: number): string => clip(s.replace(/\s+/g, " ").trim(), n);

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

/** A `tool_call_start` frame: the call, running. */
export function toolStarted(
  entries: ActivityEntry[],
  d: Record<string, unknown>,
  at: string,
): void {
  const id = d.toolCallId;
  const name = d.name;
  if (typeof id !== "string" || !id || id.length > 128) return;
  if (typeof name !== "string" || !name) return;
  if (entries.some((e) => e.id === id)) return;
  entries.push({
    id,
    name: clip(name, 64),
    summary: toolSummary(d.args),
    status: "running",
    startedAt: at,
  });
  if (entries.length > MAX_ACTIVITY) entries.splice(0, entries.length - MAX_ACTIVITY);
}

/**
 * A `server_tool_call` frame: a tool the model's provider runs (web search,
 * web fetch). It starts and finishes inside the model call, so it is done at once.
 */
export function serverToolCalled(
  entries: ActivityEntry[],
  d: Record<string, unknown>,
  at: string,
): void {
  const id = d.id;
  const name = d.name;
  if (typeof id !== "string" || !id || id.length > 128) return;
  if (typeof name !== "string" || !name) return;
  if (entries.some((e) => e.id === id)) return;
  entries.push({
    id,
    name: clip(name, 64),
    summary: toolSummary(d.input),
    status: "done",
    startedAt: at,
    endedAt: at,
  });
  if (entries.length > MAX_ACTIVITY) entries.splice(0, entries.length - MAX_ACTIVITY);
}

/** A `tool_call_end` frame: how the call ended. */
export function toolEnded(entries: ActivityEntry[], d: Record<string, unknown>, at: string): void {
  const e = entries.find((x) => x.id === d.toolCallId);
  if (!e || e.status !== "running") return;
  e.status = d.isError === true ? "failed" : "done";
  e.endedAt = at;
}
