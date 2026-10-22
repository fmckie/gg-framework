/**
 * Adding and editing Brain entries from the Brain window: the sidecar's
 * `POST /memories`, `PATCH /memories/:id`, `POST /jiwa` and `PATCH /jiwa/:id`.
 *
 * The body is checked here, strictly: exactly `text`, `category` and
 * `importance`. Then the very store methods the chat tools call save it
 * (`remember`/`update`, `set`/`update`), under the same file lock and limits,
 * and the store's own change hook tells every window. Each answer is a status
 * with a body in plain words, so a phone and a laptop show the same reason.
 */
import { z } from "zod";
import { BrainEntryNotFoundError, BrainFullError } from "./brain-errors.js";
import {
  JIWA_CATEGORIES,
  JIWA_HARD_LIMIT,
  JIWA_SOFT_LIMIT,
  JIWA_TEXT_LIMIT,
  type JiwaEntry,
  type JiwaStore,
} from "./jiwa.js";
import {
  MEMORY_CATEGORIES,
  MEMORY_HARD_LIMIT,
  MEMORY_SOFT_LIMIT,
  MEMORY_TEXT_LIMIT,
  type Memory,
  type MemoryStore,
} from "./memory.js";

/** Largest body the add and edit routes read. One entry is at most 600 characters. */
export const BRAIN_EDIT_BODY_MAX = 16 * 1024;

/** Longest entry id the edit routes take. The stores make UUIDs (36 characters). */
export const BRAIN_ID_MAX = 200;

/** Both reasons a store refuses a new entry when it's full (see BrainFullError). */
export const BRAIN_FULL_MESSAGE =
  "Brain is full. Delete one first, or give this one a higher importance.";

export interface BrainEditError {
  error: string;
  /** The entry a refused duplicate matches. */
  duplicateOf?: Memory | JiwaEntry;
}

/** A saved memory: the store as it is now, and the entry. */
export interface SavedMemory {
  memories: Memory[];
  softLimit: number;
  hardLimit: number;
  memory: Memory;
}

/** A saved Jiwa instruction: the store as it is now, and the entry. */
export interface SavedJiwa {
  jiwa: JiwaEntry[];
  softLimit: number;
  hardLimit: number;
  entry: JiwaEntry;
}

export type BrainEditResult<T> =
  { status: 200; body: T } | { status: 400 | 404 | 409 | 500; body: BrainEditError };

const IMPORTANCE = "must be a whole number from 1 to 5";

/** The body of an add or an edit: these three fields, nothing else. */
function entrySchema<const C extends readonly [string, ...string[]]>(
  categories: C,
  textLimit: number,
) {
  return z.strictObject(
    {
      text: z
        .string({ error: (issue) => (issue.input === undefined ? "required" : "must be text") })
        .trim()
        .min(1, { error: "can't be empty" })
        .max(textLimit, { error: `must be ${textLimit} characters or fewer` }),
      category: z.enum(categories, {
        error: (issue) =>
          issue.input === undefined ? "required" : `must be one of ${categories.join(", ")}`,
      }),
      importance: z
        .number({ error: (issue) => (issue.input === undefined ? "required" : IMPORTANCE) })
        .int({ error: IMPORTANCE })
        .min(1, { error: IMPORTANCE })
        .max(5, { error: IMPORTANCE }),
    },
    { error: "must be an object with text, category and importance" },
  );
}

const memoryEntry = entrySchema(MEMORY_CATEGORIES, MEMORY_TEXT_LIMIT);
const jiwaEntry = entrySchema(JIWA_CATEGORIES, JIWA_TEXT_LIMIT);

/** The first problem with a body, as "Invalid Brain entry: <field>: <issue>". */
function invalid(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid Brain entry.";
  if (issue.code === "unrecognized_keys") {
    return `Invalid Brain entry: ${issue.keys.join(", ")}: not a field of a Brain entry`;
  }
  const field = issue.path.map(String).join(".");
  return field
    ? `Invalid Brain entry: ${field}: ${issue.message}`
    : `Invalid Brain entry: ${issue.message}`;
}

function parseBody<S extends z.ZodType>(
  schema: S,
  raw: string,
): { ok: true; value: z.output<S> } | { ok: false; error: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid Brain entry: the body isn't JSON" };
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: invalid(parsed.error) };
}

function duplicate(existing: Memory | JiwaEntry): BrainEditResult<never> {
  return {
    status: 409,
    body: { error: `Brain already has one like this: “${existing.text}”`, duplicateOf: existing },
  };
}

/** A store that neither saved nor refused, which would be a bug: answered, not thrown. */
function nothingSaved(): BrainEditResult<never> {
  return { status: 500, body: { error: "Couldn't save to Brain: nothing was saved" } };
}

/** A store's refusal (or failure) as an answer. `missing` names the entry that's gone. */
function refusal(error: unknown, missing: string): BrainEditResult<never> {
  if (error instanceof BrainEntryNotFoundError) return { status: 404, body: { error: missing } };
  if (error instanceof BrainFullError) return { status: 409, body: { error: BRAIN_FULL_MESSAGE } };
  const reason = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: `Couldn't save to Brain: ${reason}` } };
}

/**
 * Add a memory (`id` null) or edit one. An edit replaces the text, category
 * and importance; it never merges or forgets other entries.
 */
export async function editMemory(
  store: MemoryStore,
  id: string | null,
  raw: string,
): Promise<BrainEditResult<SavedMemory>> {
  const parsed = parseBody(memoryEntry, raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const { text, category, importance } = parsed.value;
  try {
    const result =
      id === null
        ? await store.remember(text, category, importance)
        : await store.update(id, text, category, importance);
    if (result.duplicateOf) return duplicate(result.duplicateOf);
    if (!result.memory) return nothingSaved();
    return {
      status: 200,
      body: {
        memories: result.memories,
        softLimit: MEMORY_SOFT_LIMIT,
        hardLimit: MEMORY_HARD_LIMIT,
        memory: result.memory,
      },
    };
  } catch (error) {
    return refusal(error, "That memory isn't in Brain any more.");
  }
}

/** Add a Jiwa instruction (`id` null) or edit one, as editMemory does. */
export async function editJiwa(
  store: JiwaStore,
  id: string | null,
  raw: string,
): Promise<BrainEditResult<SavedJiwa>> {
  const parsed = parseBody(jiwaEntry, raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const { text, category, importance } = parsed.value;
  try {
    const result =
      id === null
        ? await store.set(text, category, importance)
        : await store.update(id, text, category, importance);
    if (result.duplicateOf) return duplicate(result.duplicateOf);
    if (!result.entry) return nothingSaved();
    return {
      status: 200,
      body: {
        jiwa: result.jiwa,
        softLimit: JIWA_SOFT_LIMIT,
        hardLimit: JIWA_HARD_LIMIT,
        entry: result.entry,
      },
    };
  } catch (error) {
    return refusal(error, "That Jiwa instruction isn't in Brain any more.");
  }
}

/**
 * The entry id in a route's path after `prefix` (e.g. "/memories/"), decoded,
 * or null when it's malformed, empty or longer than BRAIN_ID_MAX. A query
 * string isn't part of it. The id is only ever compared with the store's ids.
 */
export function brainIdFromPath(url: string, prefix: string): string | null {
  if (!url.startsWith(prefix)) return null;
  const segment = url.slice(prefix.length).split("?")[0] ?? "";
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return id.length > 0 && id.length <= BRAIN_ID_MAX ? id : null;
}
