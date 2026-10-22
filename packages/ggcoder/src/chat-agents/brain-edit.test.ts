import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRAIN_FULL_MESSAGE,
  BRAIN_ID_MAX,
  brainIdFromPath,
  editJiwa,
  editMemory,
} from "./brain-edit.js";
import { JIWA_CATEGORIES, JIWA_HARD_LIMIT, JiwaStore } from "./jiwa.js";
import { MEMORY_CATEGORIES, MEMORY_HARD_LIMIT, MemoryStore } from "./memory.js";

let tempDir: string;
let memoryPath: string;
let jiwaPath: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gg-brain-edit-test-"));
  memoryPath = path.join(tempDir, "chat-memories.json");
  jiwaPath = path.join(tempDir, "chat-jiwa.json");
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const memoryBody = {
  text: "Prefers short answers in chat.",
  category: "preference",
  importance: 3,
};
const jiwaBody = {
  text: "Keep answers short unless I ask.",
  category: "interaction",
  importance: 3,
};

function body(value: unknown): string {
  return JSON.stringify(value);
}

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

/** A Brain file holding `count` distinct entries of one category and importance. */
async function seed(
  file: string,
  key: "memories" | "jiwa",
  count: number,
  category: string,
  importance: number,
) {
  const at = "2026-01-01T00:00:00.000Z";
  const entries = Array.from({ length: count }, (_, index) => ({
    id: `seed-${index}`,
    text: `Seeded entry number ${index}.`,
    category,
    importance,
    createdAt: at,
    updatedAt: at,
  }));
  await fs.writeFile(file, JSON.stringify({ version: 1, [key]: entries }));
}

function memoryStore() {
  const onChange = vi.fn();
  return { store: new MemoryStore({ filePath: memoryPath, onChange }), onChange };
}

function jiwaStore() {
  const onChange = vi.fn();
  return { store: new JiwaStore({ filePath: jiwaPath, onChange }), onChange };
}

const IMPORTANCE = "importance: must be a whole number from 1 to 5";

/** Bodies both kinds refuse, built from a valid one, and the reason after "Invalid Brain entry: ". */
const refusedBodies: Array<[string, (valid: Record<string, unknown>) => string, string]> = [
  ["a body that isn't JSON", () => "{", "the body isn't JSON"],
  [
    "a body that isn't an object",
    () => "[]",
    "must be an object with text, category and importance",
  ],
  [
    "an unknown field",
    (valid) => body({ ...valid, forgetIds: ["seed-1"] }),
    "forgetIds: not a field of a Brain entry",
  ],
  ["a missing field", (valid) => body(without(valid, "importance")), "importance: required"],
  ["blank text", (valid) => body({ ...valid, text: "   " }), "text: can't be empty"],
  ["text that isn't text", (valid) => body({ ...valid, text: 42 }), "text: must be text"],
  [
    "601 characters",
    (valid) => body({ ...valid, text: "x".repeat(601) }),
    "text: must be 600 characters or fewer",
  ],
  ["importance 0", (valid) => body({ ...valid, importance: 0 }), IMPORTANCE],
  ["importance 6", (valid) => body({ ...valid, importance: 6 }), IMPORTANCE],
  ["importance 2.5", (valid) => body({ ...valid, importance: 2.5 }), IMPORTANCE],
  ["importance as a string", (valid) => body({ ...valid, importance: "3" }), IMPORTANCE],
];

describe("editMemory", () => {
  it("adds a memory and answers with the store and the saved entry", async () => {
    const { store, onChange } = memoryStore();
    const text = "x".repeat(600);
    const result = await editMemory(
      store,
      null,
      body({ text: `  ${text}  `, category: "identity", importance: 4 }),
    );
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.memory).toMatchObject({ text, category: "identity", importance: 4 });
    expect(result.body.memories).toEqual(await store.list());
    expect(result.body).toMatchObject({ softLimit: 60, hardLimit: 90 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(memoryPath, "utf8")).toContain(text);
  });

  it("edits a memory's text, category and importance, and nothing else", async () => {
    const { store, onChange } = memoryStore();
    const kept = (await store.remember("Lives in Leeds.", "identity", 5)).memory;
    const original = (await store.remember("Likes long answers.", "preference", 2)).memory;
    onChange.mockClear();

    const result = await editMemory(
      store,
      original?.id ?? "",
      body({ text: "Likes short answers.", category: "other", importance: 4 }),
    );
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.memory).toMatchObject({
      id: original?.id,
      text: "Likes short answers.",
      category: "other",
      importance: 4,
      createdAt: original?.createdAt,
    });
    expect(result.body.memories.map((memory) => memory.text).sort()).toEqual([
      "Likes short answers.",
      "Lives in Leeds.",
    ]);
    expect(result.body.memories).toContainEqual(kept);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for a memory that isn't there", async () => {
    const { store, onChange } = memoryStore();
    expect(await editMemory(store, "m-gone", body(memoryBody))).toEqual({
      status: 404,
      body: { error: "That memory isn't in Brain any more." },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("answers 409 with the match for a near duplicate on add", async () => {
    const { store, onChange } = memoryStore();
    const existing = (await store.remember(memoryBody.text, "preference", 3)).memory;
    onChange.mockClear();
    const result = await editMemory(
      store,
      null,
      body({ ...memoryBody, text: "prefers SHORT answers, in chat!" }),
    );
    expect(result).toEqual({
      status: 409,
      body: {
        error: `Brain already has one like this: “${memoryBody.text}”`,
        duplicateOf: existing,
      },
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(await store.list()).toHaveLength(1);
  });

  it("answers 409 for an edit that would copy another memory exactly", async () => {
    const { store, onChange } = memoryStore();
    const first = (await store.remember(memoryBody.text, "preference", 3)).memory;
    const second = (await store.remember("Works in Leeds.", "project", 3)).memory;
    onChange.mockClear();
    const result = await editMemory(store, second?.id ?? "", body(memoryBody));
    expect(result.status).toBe(409);
    if (result.status === 200) return;
    expect(result.body.duplicateOf).toEqual(first);
    expect(onChange).not.toHaveBeenCalled();
    expect((await store.list()).map((memory) => memory.text)).toContain("Works in Leeds.");
  });

  it("answers 409 when every slot holds an Identity memory", async () => {
    await seed(memoryPath, "memories", MEMORY_HARD_LIMIT, "identity", 3);
    const { store, onChange } = memoryStore();
    expect(await editMemory(store, null, body({ ...memoryBody, importance: 5 }))).toEqual({
      status: 409,
      body: { error: BRAIN_FULL_MESSAGE },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("answers 409 when a full store would drop the new importance-1 memory at once", async () => {
    await seed(memoryPath, "memories", MEMORY_HARD_LIMIT, "project", 4);
    const { store } = memoryStore();
    expect(await editMemory(store, null, body({ ...memoryBody, importance: 1 }))).toEqual({
      status: 409,
      body: { error: BRAIN_FULL_MESSAGE },
    });
    expect(await store.list()).toHaveLength(MEMORY_HARD_LIMIT);
  });

  it("adds to a full store by dropping the least important memory, as the tools do", async () => {
    await seed(memoryPath, "memories", MEMORY_HARD_LIMIT, "project", 2);
    const { store } = memoryStore();
    const result = await editMemory(store, null, body({ ...memoryBody, importance: 3 }));
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.memories).toHaveLength(MEMORY_HARD_LIMIT);
    expect(result.body.memories).toContainEqual(result.body.memory);
  });

  it.each(refusedBodies)("answers 400 for %s", async (_name, build, reason) => {
    const { store, onChange } = memoryStore();
    expect(await editMemory(store, null, build(memoryBody))).toEqual({
      status: 400,
      body: { error: `Invalid Brain entry: ${reason}` },
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });

  it("answers 400 for a category memories don't have", async () => {
    const { store } = memoryStore();
    expect(await editMemory(store, null, body({ ...memoryBody, category: "voice" }))).toEqual({
      status: 400,
      body: {
        error: `Invalid Brain entry: category: must be one of ${MEMORY_CATEGORIES.join(", ")}`,
      },
    });
  });

  it("checks the body before looking for the memory", async () => {
    const { store } = memoryStore();
    const result = await editMemory(store, "m-gone", body({ ...memoryBody, importance: 9 }));
    expect(result.status).toBe(400);
  });
});

describe("editJiwa", () => {
  it("adds an instruction and answers with the store and the saved entry", async () => {
    const { store, onChange } = jiwaStore();
    const result = await editJiwa(store, null, body({ ...jiwaBody, category: "voice" }));
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.entry).toMatchObject({
      text: jiwaBody.text,
      category: "voice",
      importance: 3,
    });
    expect(result.body.jiwa).toEqual(await store.list());
    expect(result.body).toMatchObject({ softLimit: 60, hardLimit: 90 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(jiwaPath, "utf8")).toContain(jiwaBody.text);
  });

  it("edits an instruction", async () => {
    const { store, onChange } = jiwaStore();
    const original = (await store.set("Use British spelling.", "voice", 3)).entry;
    onChange.mockClear();
    const result = await editJiwa(
      store,
      original?.id ?? "",
      body({ text: "Use British spelling, always.", category: "boundaries", importance: 5 }),
    );
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.entry).toMatchObject({
      id: original?.id,
      text: "Use British spelling, always.",
      category: "boundaries",
      importance: 5,
    });
    expect(result.body.jiwa).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an instruction that isn't there", async () => {
    const { store } = jiwaStore();
    expect(await editJiwa(store, "j-gone", body(jiwaBody))).toEqual({
      status: 404,
      body: { error: "That Jiwa instruction isn't in Brain any more." },
    });
  });

  it("answers 409 for a near duplicate on add and an exact one on edit", async () => {
    const { store, onChange } = jiwaStore();
    const first = (await store.set(jiwaBody.text, "interaction", 3)).entry;
    const second = (await store.set("Never use emoji.", "boundaries", 3)).entry;
    onChange.mockClear();

    const added = await editJiwa(
      store,
      null,
      body({ ...jiwaBody, text: "keep answers SHORT, unless I ask" }),
    );
    expect(added).toEqual({
      status: 409,
      body: { error: `Brain already has one like this: “${jiwaBody.text}”`, duplicateOf: first },
    });
    const edited = await editJiwa(store, second?.id ?? "", body(jiwaBody));
    expect(edited.status).toBe(409);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("answers 409 when full, for both reasons", async () => {
    await seed(jiwaPath, "jiwa", JIWA_HARD_LIMIT, "identity", 3);
    const { store } = jiwaStore();
    const full = { status: 409, body: { error: BRAIN_FULL_MESSAGE } };
    expect(await editJiwa(store, null, body({ ...jiwaBody, importance: 5 }))).toEqual(full);

    await seed(jiwaPath, "jiwa", JIWA_HARD_LIMIT, "workflow", 4);
    expect(await editJiwa(store, null, body({ ...jiwaBody, importance: 1 }))).toEqual(full);
    expect(await store.list()).toHaveLength(JIWA_HARD_LIMIT);
  });

  it.each(refusedBodies)("answers 400 for %s", async (_name, build, reason) => {
    const { store, onChange } = jiwaStore();
    expect(await editJiwa(store, null, build(jiwaBody))).toEqual({
      status: 400,
      body: { error: `Invalid Brain entry: ${reason}` },
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });

  it("answers 400 for a category Jiwa doesn't have", async () => {
    const { store } = jiwaStore();
    expect(await editJiwa(store, null, body({ ...jiwaBody, category: "health" }))).toEqual({
      status: 400,
      body: {
        error: `Invalid Brain entry: category: must be one of ${JIWA_CATEGORIES.join(", ")}`,
      },
    });
  });
});

describe("brainIdFromPath", () => {
  it("decodes the id after the prefix and drops a query string", () => {
    expect(brainIdFromPath("/memories/3f2a-11", "/memories/")).toBe("3f2a-11");
    expect(brainIdFromPath("/memories/a%20b%2Fc", "/memories/")).toBe("a b/c");
    expect(brainIdFromPath("/jiwa/3f2a?x=1", "/jiwa/")).toBe("3f2a");
    expect(brainIdFromPath(`/jiwa/${"a".repeat(BRAIN_ID_MAX)}`, "/jiwa/")).toHaveLength(
      BRAIN_ID_MAX,
    );
  });

  it("refuses a malformed, empty or overlong id, or another route", () => {
    expect(brainIdFromPath("/memories/%E0%A4%A", "/memories/")).toBeNull();
    expect(brainIdFromPath("/memories/", "/memories/")).toBeNull();
    expect(brainIdFromPath("/memories/?x=1", "/memories/")).toBeNull();
    expect(brainIdFromPath(`/memories/${"a".repeat(BRAIN_ID_MAX + 1)}`, "/memories/")).toBeNull();
    expect(brainIdFromPath("/jiwa/3f2a", "/memories/")).toBeNull();
  });
});
