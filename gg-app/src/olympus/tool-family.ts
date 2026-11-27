// What kind of work an agent's latest activity is: the family that picks a
// god's skill pose on the lane (the mockup's figures.json, `_families`), and
// the words a row shows for it.
//
// An activity arrives in two shapes:
//  1. Humanized (the coder's tools/subagent.ts formatToolActivity):
//     "Reading src/a.ts", 'Searching for "foo"', "Running pnpm test"…
//  2. Raw (the coder's core/subagent-manager.ts activity(), and the first
//     shape's fallback for a tool it has no verb for): "<tool>: <arg>" or "<tool>".
// Nothing says an agent is thinking: think is an agent with no tool yet, or
// one whose tool has no family.

export type ToolFamily = "look" | "web" | "make" | "run" | "think";

/** Humanized verbs, most specific first; `chip` when what follows is code. */
const VERBS: readonly (readonly [verb: string, family: ToolFamily, chip: boolean])[] = [
  ["Reading task output", "think", true],
  ["Stopping task", "think", true],
  ["Loading skill", "think", true],
  ["Searching web for", "web", false],
  ["Searching for", "look", true],
  ["Resolving source for", "look", true],
  ["Finding", "look", true],
  ["Reading", "look", true],
  ["Listing", "look", true],
  ["Writing", "make", true],
  ["Editing", "make", true],
  ["Running", "run", true],
  ["Fetching", "web", true],
];

/** Raw tool names. Any other tool (MCP tools, sub-agents…) is think. */
const TOOLS: ReadonlyMap<string, ToolFamily> = new Map<string, ToolFamily>([
  ["read", "look"],
  ["grep", "look"],
  ["find", "look"],
  ["ls", "look"],
  ["code_search", "look"],
  ["source_path", "look"],
  ["web_search", "web"],
  ["web_fetch", "web"],
  ["steroids", "web"],
  ["write", "make"],
  ["edit", "make"],
  ["bash", "run"],
]);

/** A bare tool name, optionally followed by ": detail". */
const NAMED = /^([A-Za-z_][\w.-]*)(?::|$)/;

export interface ActivityParts {
  readonly family: ToolFamily;
  /** The words before the subject, or the whole activity when it has none. */
  readonly lead: string;
  /** What the tool is working on, shown as code. */
  readonly subject?: string;
}

/** An activity as its family, its words, and the subject to set as code. */
export function activityParts(activity: string | undefined): ActivityParts {
  const text = activity?.trim() ?? "";
  for (const [verb, family, chip] of VERBS) {
    if (text === verb) return { family, lead: verb };
    if (!text.startsWith(`${verb} `)) continue;
    const rest = text.slice(verb.length + 1).trim();
    if (!chip || !rest) return { family, lead: text };
    // The verb's own quotes around a pattern: the chip says "code" instead.
    const quoted = /^"(.+)"$/.exec(rest);
    return { family, lead: verb, subject: quoted ? quoted[1] : rest };
  }
  const tool = NAMED.exec(text)?.[1]?.toLowerCase();
  return { family: (tool && TOOLS.get(tool)) || "think", lead: text };
}

/** The family of an agent's latest activity. */
export function toolFamilyOf(activity: string | undefined): ToolFamily {
  return activityParts(activity).family;
}
