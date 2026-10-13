import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  downloadModel,
  modelBytes,
  modelDir,
  removeStaleTempFiles,
  verifiedOnDisk,
  WHISPER_MODEL,
  type ModelDownloadOptions,
  type ModelDownloadResult,
} from "./dictation-model.js";
import {
  bytesOf,
  startFakeHub,
  testBytes,
  testModel,
  type FakeHub,
  type HubAnswer,
  type HubRequest,
  type TestModel,
} from "./test-support/fake-hub.js";

const MODEL_FILE = "onnx/model.onnx";
const HOUR = 60 * 60 * 1000;

/** A temp models folder, removed when the test ends. */
async function tempModels(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kleio-model-"));
  onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake Hub for this test only. */
async function hubFor(
  test: TestModel,
  answer?: (request: HubRequest, index: number) => HubAnswer,
): Promise<FakeHub> {
  const hub = await startFakeHub(test, answer);
  onTestFinished(() => hub.close());
  return hub;
}

/** A small file, then one big enough to arrive in several chunks. */
const twoFiles = (): TestModel =>
  testModel({
    "config.json": Buffer.from('{"model_type":"whisper"}\n'),
    [MODEL_FILE]: testBytes(256 * 1024),
  });

/** Just the big file, for tests about one download. */
const oneFile = (): TestModel => testModel({ [MODEL_FILE]: testBytes(256 * 1024) });

/** Where a model file goes. */
const targetOf = (models: string, test: TestModel, file: string): string =>
  path.join(modelDir(models, test.model), ...file.split("/"));

async function place(file: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

/** Compared as digests: a deep equal of 256 KB takes vitest a quarter of a second. */
const digest = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
const digestOf = async (file: string): Promise<string> => digest(await fs.readFile(file));

const exists = (file: string): Promise<boolean> =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

function download(
  models: string,
  test: TestModel,
  hub: FakeHub,
  options: ModelDownloadOptions = {},
): Promise<ModelDownloadResult> {
  return downloadModel(models, {
    model: test.model,
    baseUrl: hub.baseUrl,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
    ...options,
  });
}

describe("WHISPER_MODEL", () => {
  it("pins one commit and the seven files transformers loads, each with a size and SHA-256", () => {
    expect(WHISPER_MODEL.id).toBe("onnx-community/whisper-base.en");
    expect(WHISPER_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(WHISPER_MODEL.files.map((f) => f.path)).toEqual([
      "config.json",
      "generation_config.json",
      "preprocessor_config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "onnx/encoder_model.onnx",
      "onnx/decoder_model_merged_quantized.onnx",
    ]);
    for (const file of WHISPER_MODEL.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
    }
    expect(modelBytes()).toBe(138_853_314);
  });

  it("lives where transformers kept it: <models>/onnx-community/whisper-base.en", () => {
    const models = path.join(os.tmpdir(), "models");
    expect(modelDir(models)).toBe(path.join(models, "onnx-community", "whisper-base.en"));
  });
});

describe("downloadModel", () => {
  it("fetches each file from the pinned commit, checks it, and writes the marker", async () => {
    const models = await tempModels();
    const test = twoFiles();
    const hub = await hubFor(test);

    expect(await download(models, test, hub)).toEqual({ ok: true });

    // The hub only knows the files under the pinned commit's URL.
    expect(hub.requests).toEqual([
      { file: "config.json", range: null },
      { file: MODEL_FILE, range: null },
    ]);
    for (const [file, data] of test.contents) {
      expect(await digestOf(targetOf(models, test, file))).toBe(digest(data));
    }
    expect(await verifiedOnDisk(models, test.model)).toBe(true);
  });

  it("reports progress that only goes up and ends at the model's size", async () => {
    const models = await tempModels();
    const test = twoFiles();
    const hub = await hubFor(test);
    const seen: [number, number][] = [];

    await download(models, test, hub, {
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });

    const total = modelBytes(test.model);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(([, t]) => t === total)).toBe(true);
    expect(seen.every(([n], i) => i === 0 || n > (seen[i - 1]?.[0] ?? Infinity))).toBe(true);
    expect(seen.at(-1)).toEqual([total, total]);
  });

  it("resumes a .part with a Range request, counting what's there at once", async () => {
    const models = await tempModels();
    const test = oneFile();
    const target = targetOf(models, test, MODEL_FILE);
    await place(`${target}.part`, bytesOf(test, MODEL_FILE).subarray(0, 100_000));
    const hub = await hubFor(test);
    const seen: number[] = [];

    const result = await download(models, test, hub, { onProgress: (n) => seen.push(n) });

    expect(result).toEqual({ ok: true });
    expect(hub.requests).toEqual([{ file: MODEL_FILE, range: "bytes=100000-" }]);
    expect(seen[0]).toBe(100_000);
    expect(await digestOf(target)).toBe(digest(bytesOf(test, MODEL_FILE)));
    expect(await exists(`${target}.part`)).toBe(false);
  });

  it("starts over when the Hub answers a Range request with the whole file", async () => {
    const models = await tempModels();
    const test = oneFile();
    const target = targetOf(models, test, MODEL_FILE);
    // Not the file's bytes: resuming after them would fail the hash.
    await place(`${target}.part`, Buffer.alloc(100_000, 7));
    const hub = await hubFor(test, () => ({ kind: "whole" }));

    expect(await download(models, test, hub)).toEqual({ ok: true });

    expect(hub.requests).toEqual([{ file: MODEL_FILE, range: "bytes=100000-" }]);
    expect(await digestOf(target)).toBe(digest(bytesOf(test, MODEL_FILE)));
  });

  it("puts a finished .part in place without asking the Hub again", async () => {
    const models = await tempModels();
    const test = oneFile();
    const target = targetOf(models, test, MODEL_FILE);
    await place(`${target}.part`, bytesOf(test, MODEL_FILE));
    const hub = await hubFor(test);

    expect(await download(models, test, hub)).toEqual({ ok: true });

    expect(hub.requests).toEqual([]);
    expect(await digestOf(target)).toBe(digest(bytesOf(test, MODEL_FILE)));
  });

  it("checks files that are already there instead of downloading them again", async () => {
    // What a host has when transformers downloaded the model itself: the files, no marker.
    const models = await tempModels();
    const test = twoFiles();
    for (const [file, data] of test.contents) await place(targetOf(models, test, file), data);
    const hub = await hubFor(test);
    const seen: number[] = [];

    const result = await download(models, test, hub, { onProgress: (n) => seen.push(n) });

    expect(result).toEqual({ ok: true });
    expect(hub.requests).toEqual([]);
    expect(seen.at(-1)).toBe(modelBytes(test.model));
    expect(await verifiedOnDisk(models, test.model)).toBe(true);
  });

  it("downloads again a file that is there but doesn't match the pin", async () => {
    const models = await tempModels();
    const test = twoFiles();
    const target = targetOf(models, test, MODEL_FILE);
    await place(targetOf(models, test, "config.json"), bytesOf(test, "config.json"));
    await place(target, Buffer.alloc(bytesOf(test, MODEL_FILE).byteLength, 1));
    const hub = await hubFor(test);

    expect(await download(models, test, hub)).toEqual({ ok: true });

    expect(hub.requests).toEqual([{ file: MODEL_FILE, range: null }]);
    expect(await digestOf(target)).toBe(digest(bytesOf(test, MODEL_FILE)));
  });

  it.each([
    [503, "server"],
    [429, "server"],
    [404, "missing"],
    [401, "missing"],
  ] as const)("an answer of %i from the Hub gives %s", async (status, kind) => {
    const models = await tempModels();
    const test = oneFile();
    const hub = await hubFor(test, () => ({ kind: "status", status }));

    expect(await download(models, test, hub)).toEqual({ ok: false, error: { kind, status } });
    expect(await verifiedOnDisk(models, test.model)).toBe(false);
  });

  it("a dropped connection gives offline and keeps the .part to resume from", async () => {
    const models = await tempModels();
    const test = oneFile();
    const target = targetOf(models, test, MODEL_FILE);
    const hub = await hubFor(test, (_request, index) =>
      index === 0 ? { kind: "stall", after: 50_000 } : { kind: "serve" },
    );

    const dropped = await download(models, test, hub, {
      onProgress: (n) => {
        if (n >= 50_000) hub.dropConnections();
      },
    });

    expect(dropped).toMatchObject({ ok: false, error: { kind: "offline" } });
    expect((await fs.stat(`${target}.part`)).size).toBe(50_000);
    expect(await exists(target)).toBe(false);

    expect(await download(models, test, hub)).toEqual({ ok: true });
    expect(hub.requests[1]).toEqual({ file: MODEL_FILE, range: "bytes=50000-" });
    expect(await digestOf(target)).toBe(digest(bytesOf(test, MODEL_FILE)));
  });

  it("a connection that goes quiet gives offline once the stall time passes", async () => {
    const models = await tempModels();
    const test = oneFile();
    const hub = await hubFor(test, () => ({ kind: "stall", after: 1_000 }));

    const result = await download(models, test, hub, { stallMs: 100 });

    expect(result).toMatchObject({ ok: false, error: { kind: "offline" } });
  });

  it("stops when the signal aborts, keeping the .part", async () => {
    const models = await tempModels();
    const test = oneFile();
    const target = targetOf(models, test, MODEL_FILE);
    const hub = await hubFor(test, () => ({ kind: "stall", after: 50_000 }));
    const stop = new AbortController();

    const result = await download(models, test, hub, {
      signal: stop.signal,
      onProgress: (n) => {
        if (n >= 50_000) stop.abort();
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "aborted" } });
    expect((await fs.stat(`${target}.part`)).size).toBe(50_000);
  });

  it("bytes that don't match the pin give integrity, and nothing is left in place", async () => {
    const models = await tempModels();
    const test = oneFile();
    const target = targetOf(models, test, MODEL_FILE);
    const wrong = Buffer.from(bytesOf(test, MODEL_FILE));
    wrong[1_000] = (wrong[1_000] ?? 0) ^ 0xff;
    const hub = await hubFor(test, () => ({ kind: "body", body: wrong, sized: true }));

    const result = await download(models, test, hub);

    expect(result).toEqual({ ok: false, error: { kind: "integrity", file: MODEL_FILE } });
    expect(await exists(target)).toBe(false);
    expect(await exists(`${target}.part`)).toBe(false);
    expect(await verifiedOnDisk(models, test.model)).toBe(false);
  });

  it.each([
    ["streamed with no length", false],
    ["sent with a length that isn't the pin's", true],
  ])("cuts off a file that grows past its size (%s)", async (_label, sized) => {
    const models = await tempModels();
    const test = oneFile();
    const target = targetOf(models, test, MODEL_FILE);
    const body = Buffer.concat([bytesOf(test, MODEL_FILE), Buffer.alloc(10_000, 1)]);
    const hub = await hubFor(test, () => ({ kind: "body", body, sized }));

    const result = await download(models, test, hub);

    expect(result).toEqual({ ok: false, error: { kind: "integrity", file: MODEL_FILE } });
    expect(await exists(target)).toBe(false);
    expect(await exists(`${target}.part`)).toBe(false);
  });

  it("too little free space gives storage before any request", async () => {
    const models = await tempModels();
    const test = twoFiles();
    const hub = await hubFor(test);

    const result = await download(models, test, hub, { freeBytes: async () => 1_000 });

    expect(result).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(hub.requests).toEqual([]);
  });

  it("a full disk while writing (ENOSPC) gives storage", async () => {
    const models = await tempModels();
    const test = oneFile();
    const hub = await hubFor(test);
    const realOpen = fs.open;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      vi.spyOn(handle, "write").mockRejectedValue(
        Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }),
      );
      return handle;
    });
    onTestFinished(() => open.mockRestore());

    const result = await download(models, test, hub);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "storage", detail: expect.stringContaining("ENOSPC") },
    });
    expect(await verifiedOnDisk(models, test.model)).toBe(false);
  });
});

describe("verifiedOnDisk", () => {
  it("is false until a download has checked the files", async () => {
    const models = await tempModels();
    const test = twoFiles();
    for (const [file, data] of test.contents) await place(targetOf(models, test, file), data);

    // The right files, but nothing has checked them yet.
    expect(await verifiedOnDisk(models, test.model)).toBe(false);
    expect(await download(models, test, await hubFor(test))).toEqual({ ok: true });
    expect(await verifiedOnDisk(models, test.model)).toBe(true);
  });

  it.each(["removed", "resized"])("is false once a file is %s", async (change) => {
    const models = await tempModels();
    const test = twoFiles();
    expect(await download(models, test, await hubFor(test))).toEqual({ ok: true });
    const target = targetOf(models, test, "config.json");

    if (change === "removed") await fs.rm(target);
    else await fs.appendFile(target, "\n");

    expect(await verifiedOnDisk(models, test.model)).toBe(false);
  });

  it("is false for another pinned commit", async () => {
    const models = await tempModels();
    const test = twoFiles();
    expect(await download(models, test, await hubFor(test))).toEqual({ ok: true });

    expect(await verifiedOnDisk(models, { ...test.model, revision: "0ther0" })).toBe(false);
  });
});

describe("removeStaleTempFiles", () => {
  const NOW = Date.parse("2026-10-13T12:00:00Z");

  async function touch(file: string, ageMs: number): Promise<void> {
    await place(file, Buffer.from("x"));
    const at = (NOW - ageMs) / 1000;
    await fs.utimes(file, at, at);
  }

  it("removes transformers' temp files untouched for an hour, and only those", async () => {
    const models = await tempModels();
    const test = twoFiles();
    const dir = modelDir(models, test.model);
    const stale = path.join(dir, "onnx", "model.onnx.tmp.4242.k3j2h1");
    const fresh = path.join(dir, "config.json.tmp.4243.-a1b2");
    const notTemp = path.join(dir, "notes.txt");
    const otherFolder = path.join(models, "model.onnx.tmp.4244.abc");
    await touch(stale, 2 * HOUR);
    await touch(fresh, HOUR / 6);
    await touch(notTemp, 2 * HOUR);
    await touch(otherFolder, 2 * HOUR);

    expect(await removeStaleTempFiles(models, { model: test.model, now: NOW })).toBe(1);

    expect(await exists(stale)).toBe(false);
    for (const kept of [fresh, notTemp, otherFolder]) expect(await exists(kept)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "leaves a symlink alone, even one named like an old temp file",
    async () => {
      const models = await tempModels();
      const test = twoFiles();
      const outside = path.join(models, "keep.bin");
      await touch(outside, 2 * HOUR);
      const link = path.join(modelDir(models, test.model), "config.json.tmp.1.abc");
      await fs.mkdir(path.dirname(link), { recursive: true });
      await fs.symlink(outside, link);
      const at = (NOW - 2 * HOUR) / 1000;
      await fs.lutimes(link, at, at);

      expect(await removeStaleTempFiles(models, { model: test.model, now: NOW })).toBe(0);

      expect(await exists(link)).toBe(true);
      expect(await exists(outside)).toBe(true);
    },
  );
});
