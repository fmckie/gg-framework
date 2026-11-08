import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AskUserResult } from "./ask-user.js";
import { encodeCwd } from "./encode-cwd.js";

/**
 * Goals: a long-running objective the user hands to Kleio Coder ("Bring p95
 * latency under 200 ms across the whole API"). Each goal is its own folder under
 * `<agentDir>/goals/<id>/` holding `goal.json`; that folder is also the goal's
 * workspace (the coordinator session's cwd) and, later, its shared library.
 * Context folders and files the user attaches live elsewhere on disk and are
 * referenced by absolute path.
 */

export const GOAL_FILE = "goal.json";

/** New names stay short enough to read at a glance in the goal list. */
export const GOAL_NAME_MAX = 15;
/** Stored names may be longer (created before the limit); still bounded. */
const GOAL_NAME_STORED_MAX = 80;
export const GOAL_TEXT_MAX = 2000;
export const GOAL_CONTEXT_MAX = 20;

const contextItemSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["folder", "file"]),
});

const goalRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1).max(GOAL_NAME_STORED_MAX),
  goal: z.string().min(1).max(GOAL_TEXT_MAX),
  context: z.array(contextItemSchema).max(GOAL_CONTEXT_MAX),
  createdAt: z.string(),
  /** When the coordinator's first, automatic reply was started. Set once. */
  kickoffAt: z.string().optional(),
  /** When the user chose to start the goal (briefing over, work begins). Set once. */
  startedAt: z.string().optional(),
  /** The model Kleio Goals' workers run on; absent: Kleio Goals' own. */
  critterModel: z.object({ provider: z.string().min(1), model: z.string().min(1) }).optional(),
});

/** What the app sends to create a goal. Context kinds are re-derived on disk. */
export const createGoalInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the goal a name")
    .max(GOAL_NAME_MAX, `Keep the name to ${GOAL_NAME_MAX} characters`),
  goal: z.string().trim().min(1, "Describe the goal").max(GOAL_TEXT_MAX),
  context: z.array(z.string().min(1)).max(GOAL_CONTEXT_MAX).default([]),
});

export type GoalContextItem = z.infer<typeof contextItemSchema>;
export type GoalRecord = z.infer<typeof goalRecordSchema>;
export type CreateGoalInput = z.input<typeof createGoalInputSchema>;

export type GoalResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Folder that holds every goal. */
export function goalsRoot(agentDir: string): string {
  return path.join(agentDir, "goals");
}

/** Lowercase dashed folder name; empty when the name has no usable characters. */
export function goalSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** True when `dir` is exactly one goal folder directly inside `root`. */
export function isGoalDir(root: string, dir: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(dir));
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    !relative.includes(path.sep)
  );
}

/** True when `target` is `root` or anything beneath it. */
export function isInsideGoalsRoot(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Read and validate one goal folder's record; null when absent or invalid. */
export async function readGoal(dir: string): Promise<GoalRecord | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, GOAL_FILE), "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = goalRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

async function writeGoal(dir: string, record: GoalRecord): Promise<void> {
  const file = path.join(dir, GOAL_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, file);
}

/**
 * Resolve the user's context picks to absolute, existing paths. Kinds come
 * from the filesystem, never from the client. Duplicates collapse; order is
 * kept so the list reads the way the user built it.
 */
async function resolveContext(paths: readonly string[]): Promise<GoalResult<GoalContextItem[]>> {
  const items: GoalContextItem[] = [];
  const seen = new Set<string>();
  for (const entry of paths) {
    if (!path.isAbsolute(entry)) return { ok: false, error: `Not an absolute path: ${entry}` };
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolved);
    } catch {
      return { ok: false, error: `Not found: ${resolved}` };
    }
    if (stat.isDirectory()) items.push({ path: resolved, kind: "folder" });
    else if (stat.isFile()) items.push({ path: resolved, kind: "file" });
    else return { ok: false, error: `Not a file or folder: ${resolved}` };
  }
  return { ok: true, value: items };
}

/**
 * Create a goal folder and its record. The folder name is the slug, suffixed
 * `-2`, `-3`… when taken; `mkdir` without `recursive` makes the claim atomic.
 */
export async function createGoal(
  root: string,
  input: CreateGoalInput,
  now: Date,
): Promise<GoalResult<{ dir: string; record: GoalRecord }>> {
  const parsed = createGoalInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid goal" };
  }
  const { name, goal, context } = parsed.data;
  const resolved = await resolveContext(context);
  if (!resolved.ok) return resolved;

  const base = goalSlug(name) || "goal";
  await fs.mkdir(root, { recursive: true });
  for (let attempt = 1; attempt <= 100; attempt++) {
    const id = attempt === 1 ? base : `${base}-${attempt}`;
    const dir = path.join(root, id);
    try {
      await fs.mkdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    const record: GoalRecord = {
      schemaVersion: 1,
      id,
      name,
      goal,
      context: resolved.value,
      createdAt: now.toISOString(),
    };
    await writeGoal(dir, record);
    return { ok: true, value: { dir, record } };
  }
  return { ok: false, error: "Too many goals share that name" };
}

/** Every valid goal under `root` with its folder. Unreadable folders are skipped. */
export async function listGoals(root: string): Promise<Array<{ dir: string; record: GoalRecord }>> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const goals: Array<{ dir: string; record: GoalRecord }> = [];
  for (const entry of entries.sort()) {
    const dir = path.join(root, entry);
    const record = await readGoal(dir);
    if (record) goals.push({ dir, record });
  }
  return goals;
}

/**
 * True while a goal still needs Kleio Goals' automatic first reply: the kickoff
 * was never started and the conversation has no user or assistant message yet.
 * The system prompt is not conversation, so it does not count.
 */
export function goalNeedsKickoff(
  record: GoalRecord,
  messages: ReadonlyArray<{ role: string }>,
): boolean {
  return !record.kickoffAt && !messages.some((m) => m.role !== "system");
}

/** Briefing until the user starts the goal; active from then on. */
export type GoalPhase = "briefing" | "active";

export function goalPhase(record: GoalRecord): GoalPhase {
  return record.startedAt ? "active" : "briefing";
}

/** True when an ask_user result is the user choosing to start the goal. */
export function isGoalStartAnswer(result: AskUserResult): boolean {
  if (result.action !== "answer") return false;
  const wanted = GOAL_START_OPTION.toLowerCase();
  return Object.values(result.answers).some((answer) =>
    (Array.isArray(answer) ? answer : [answer]).some(
      (value) => value.trim().toLowerCase() === wanted,
    ),
  );
}

/**
 * Pin the model the goal's workers run on, or clear it (null) so they follow
 * Kleio Goals' model. Returns the updated record; null when the goal is gone.
 */
export async function setGoalCritterModel(
  dir: string,
  pick: { provider: string; model: string } | null,
): Promise<GoalRecord | null> {
  const record = await readGoal(dir);
  if (!record) return null;
  const { critterModel: _previous, ...rest } = record;
  const next: GoalRecord = pick ? { ...rest, critterModel: { ...pick } } : rest;
  await writeGoal(dir, next);
  return next;
}

/**
 * Record that the user started the goal. Returns the updated record, or null
 * when it had already started (or the goal is gone), so it is set only once.
 */
export async function markGoalStarted(dir: string, now: Date): Promise<GoalRecord | null> {
  const record = await readGoal(dir);
  if (!record || record.startedAt) return null;
  const next: GoalRecord = { ...record, startedAt: now.toISOString() };
  await writeGoal(dir, next);
  return next;
}

/**
 * Delete one goal: its folder (record, notes, artifacts) and the coordinator
 * sessions stored for it. Attached context lives elsewhere and is untouched.
 * `id` must name a direct child of `root`; anything else is refused.
 */
export async function deleteGoal(
  root: string,
  sessionsDir: string,
  id: string,
): Promise<GoalResult<{ dir: string }>> {
  const dir = path.join(root, id);
  if (!id || id !== path.basename(id) || !isGoalDir(root, dir)) {
    return { ok: false, error: "Unknown goal" };
  }
  if (!(await readGoal(dir))) return { ok: false, error: "Unknown goal" };
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(path.join(sessionsDir, encodeCwd(dir)), { recursive: true, force: true });
  return { ok: true, value: { dir } };
}

/**
 * Record that the coordinator's first reply has started. Returns null when it
 * already had (or the goal is gone), so a second caller never kicks off twice.
 */
export async function markGoalKickoff(dir: string, now: Date): Promise<GoalRecord | null> {
  const record = await readGoal(dir);
  if (!record || record.kickoffAt) return null;
  const next: GoalRecord = { ...record, kickoffAt: now.toISOString() };
  await writeGoal(dir, next);
  return next;
}

/** The two answers to the coordinator's "ready to start?" question. */
export const GOAL_START_OPTION = "Start the goal now";
export const GOAL_HOLD_OPTION = "Hang on, I want to discuss it more";

/**
 * The coordinator's standing brief, appended to the system prompt of a session
 * whose cwd is a goal folder. Static for the goal's lifetime.
 */
export function renderGoalPrompt(dir: string, record: GoalRecord): string {
  const context =
    record.context.length > 0
      ? record.context.map((item) => `- ${item.kind}: ${item.path}`).join("\n")
      : "- (none attached yet)";
  return [
    "# Goal",
    "",
    `You are coordinating the goal "${record.name}". It is an ongoing piece of work that spans many sessions, not a single task.`,
    "",
    "Goal:",
    record.goal,
    "",
    "Context the user attached (folders are in your workspace; read files by path):",
    context,
    "",
    `Goal folder (shared notes and artifacts for this goal): ${dir}`,
    "",
    "## Before the goal starts",
    "A goal begins with a short briefing, not with work. Until the user has chosen " +
      `"${GOAL_START_OPTION}", do not edit files, run builds, install anything or start ` +
      "tasks. Reading the context to understand it is fine.",
    "- Your first reply opens with a written message, before any tool call: greet the " +
      "user warmly in a line, then acknowledge the goal in your own words so they can " +
      "see you understood it. Questions come after that, never first.",
    "- Look at the attached context and say briefly what you found that matters.",
    "- If something you need is missing or unclear (success criteria, scope, constraints, " +
      "access, which repo owns what), ask about it. Ask only what you cannot find out " +
      "yourself, a few questions at a time, and use `ask_user` when the answers are choices.",
    "- When you have what you need, say in two or three lines how you would approach it, " +
      "then ask with `ask_user` (kind `choice`, one question) whether to start, with exactly " +
      `these option labels and no custom values: "${GOAL_START_OPTION}" (recommended) and ` +
      `"${GOAL_HOLD_OPTION}".`,
    "- If they want to discuss more, keep talking it through and ask the same question " +
      "again when it is settled.",
    "",
    "## Once the goal has started",
    "Your team does the work. Right after the user starts the goal, split it into " +
      "independent tasks and start their workers in one spawn_agent call (cwd: the attached " +
      "folder each one works in). Then wait_agent for reports, follow up, verify, and keep " +
      "the user informed about what is happening and what needs them.",
  ].join("\n");
}

/** The hidden instruction behind the coordinator's first, automatic reply. */
export function goalKickoffPrompt(record: GoalRecord): string {
  return [
    `The user just created the goal "${record.name}" and opened it for the first time.`,
    "Start the briefing described in your Goal instructions, in this order:",
    "1. Before any tool call, write a short message: greet the user, then say the goal " +
      "back in your own words.",
    "2. Read the attached context if there is any, and say briefly what matters in it.",
    "3. Ask about anything you need that is missing. If nothing is, ask whether to start.",
    "Do not start the work itself in this reply.",
  ].join("\n");
}
