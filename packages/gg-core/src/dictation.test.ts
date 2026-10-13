import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { downloadModel, modelBytes, modelDir, type SpeechModel } from "./dictation-model.js";
import {
  cleanTranscript,
  correctVocabulary,
  createDictation,
  decodePcm16,
  DICTATION_MAX_SECONDS,
  DICTATION_SAMPLE_RATE,
  DICTATION_VOCABULARY,
  DictationUnavailableError,
  type Dictation,
  type DictationFailure,
  type DictationModel,
  type DictationOptions,
  trimToSpeech,
} from "./dictation.js";
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

const log = vi.hoisted(() => vi.fn());
vi.mock("./logger.js", () => ({ log }));

beforeEach(() => {
  log.mockReset();
});

function pcm16Base64(samples: number[]): string {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  return buf.toString("base64");
}

/** `seconds` of a 440 Hz tone at `amplitude` (0..1). */
function tone(seconds: number, amplitude: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * DICTATION_SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / DICTATION_SAMPLE_RATE);
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe("decodePcm16", () => {
  it("decodes little-endian 16-bit samples to floats", () => {
    const result = decodePcm16(pcm16Base64([0, 16_384, -32_768]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.value)).toEqual([0, 0.5, -1]);
  });

  it.each([
    ["not base64", "%%%%"],
    ["unpadded base64", "AAA"],
    ["an odd byte count", Buffer.from([1, 2, 3]).toString("base64")],
  ])("rejects %s", (_label, input) => {
    expect(decodePcm16(input)).toEqual({ ok: false, error: "invalid_audio" });
  });

  it("rejects clips over the length limit before decoding them", () => {
    const tooLong = "A".repeat(
      Math.ceil((DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE * 2) / 3) * 4 + 4,
    );
    expect(decodePcm16(tooLong)).toEqual({ ok: false, error: "too_long" });
  });

  it("accepts a clip at exactly the length limit", () => {
    const samples = new Array<number>(DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE).fill(0);
    expect(decodePcm16(pcm16Base64(samples)).ok).toBe(true);
  });
});

describe("trimToSpeech", () => {
  it("returns null for clips under half a second", () => {
    expect(trimToSpeech(tone(0.4, 0.5))).toBeNull();
  });

  it("returns null for silence and for noise under the threshold", () => {
    expect(trimToSpeech(new Float32Array(DICTATION_SAMPLE_RATE * 2))).toBeNull();
    expect(trimToSpeech(tone(2, 0.003))).toBeNull();
  });

  it("trims quiet ends but keeps a short guard around the speech", () => {
    const clip = concat(
      new Float32Array(DICTATION_SAMPLE_RATE),
      tone(1, 0.3),
      new Float32Array(DICTATION_SAMPLE_RATE),
    );
    const speech = trimToSpeech(clip);
    expect(speech).not.toBeNull();
    const seconds = (speech?.length ?? 0) / DICTATION_SAMPLE_RATE;
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(1.4);
  });

  it("keeps a clip that is speech from start to end", () => {
    const clip = tone(1, 0.3);
    expect(trimToSpeech(clip)?.length).toBe(clip.length);
  });
});

describe("cleanTranscript", () => {
  it.each([
    [" Fix the padding on the login screen.", "Fix the padding on the login screen."],
    ["[BLANK_AUDIO]", ""],
    [" (music) ", ""],
    [" ...", ""],
    ["Okay so um I want you to look at it.", "Okay so I want you to look at it."],
    ["Um, run the tests.", "Run the tests."],
    ["iPhone build first, um, then the Mac.", "iPhone build first, then the Mac."],
    ["So, uh, then add a test [inaudible] for it.", "So, then add a test for it."],
    ["Hmm.", ""],
    // A filler opening a later sentence takes the capital with it.
    ["Add it to the iPhone app. Uh, using Whisper.", "Add it to the iPhone app. Using Whisper."],
    ["Ship it! Um so then test.", "Ship it! So then test."],
    ["Is it done? Erm, check.", "Is it done? Check."],
  ])("%j becomes %j", (raw, expected) => {
    expect(cleanTranscript(raw)).toBe(expected);
  });
});

describe("DICTATION_VOCABULARY", () => {
  it("is the 30 terms the benchmark used, in order", () => {
    expect(DICTATION_VOCABULARY).toHaveLength(30);
    expect(DICTATION_VOCABULARY.slice(0, 3)).toEqual(["pnpm", "TypeScript", "Tauri"]);
    expect(DICTATION_VOCABULARY.at(-1)).toBe("Homebrew");
  });
});

describe("correctVocabulary", () => {
  // Each fix the benchmark's glossary pass made on the 13 real recordings.
  it.each([
    ["Run, Pnpm, Check and fix it.", "Run, pnpm, Check and fix it."],
    ["proxies the route over the tail scale.", "proxies the route over the Tailscale."],
    ["switch from anthropic Claude to open AI and", "switch from Anthropic Claude to OpenAI and"],
    ["Ask Kimi on the moonshot to review it.", "Ask Kimi on the Moonshot to review it."],
    ["Run PNPM check.", "Run pnpm check."],
    ["through Huggingface Transformers in Node.", "through Hugging Face Transformers in Node."],
  ])("%j becomes %j", (text, expected) => {
    expect(correctVocabulary(text)).toBe(expected);
  });

  it("keeps a sentence-opening capital", () => {
    expect(correctVocabulary("PNPM check first.")).toBe("Pnpm check first.");
  });

  it("never folds a leading article into a term", () => {
    expect(correctVocabulary("the tin foil set up")).toBe("the Tinfoil set up");
  });

  it("leaves terms that are already spelled right alone", () => {
    const text = "Upgrade Vite, then run Vitest in GitHub Actions on the Mac mini.";
    expect(correctVocabulary(text)).toBe(text);
  });

  // Words one letter away from a term (code/Xcode, reach/React, clause/Claude,
  // "open a"/OpenAI) and possessives must not turn into project names.
  it.each([
    "Fix the code and open a pull request.",
    "We need to reach the clause in the code.",
    "Open a file in the editor and write some code.",
    "Anthropic's model handles the long context.",
    "Commit and push.",
    "Rebase the batch branch onto main.",
  ])("adds no project names to %j", (text) => {
    expect(correctVocabulary(text)).toBe(text);
  });
});

/** A stand-in Whisper: one id per word, ids 1-3 special, prefix echoed back. */
function fakeWhisper(answer: string, options: { echoPrefix?: boolean } = {}) {
  const ids = new Map<string, number>();
  const words: string[] = [];
  const encode = (text: string): number[] =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => {
        const known = ids.get(word);
        if (known !== undefined) return known;
        words.push(word);
        ids.set(word, 99 + words.length);
        return 99 + words.length;
      });
  const prefixes: number[][] = [];
  const transcribeLong = vi.fn(async () => answer);
  const model: DictationModel = {
    previousTextId: 1,
    startIds: [2, 3],
    encode,
    async generate(_samples, prefix) {
      prefixes.push([...prefix]);
      return [...(options.echoPrefix === false ? [] : prefix), ...encode(answer)];
    },
    decode: (tokens) =>
      tokens
        .filter((id) => id >= 100)
        .map((id) => words[id - 100] ?? "")
        .join(" "),
    transcribeLong,
  };
  return { model, prefixes, transcribeLong };
}

const seconds = (s: number): Float32Array =>
  new Float32Array(Math.round(s * DICTATION_SAMPLE_RATE));

/** A model with no files: getting it only writes the marker. */
const EMPTY_MODEL: SpeechModel = { id: "test/empty", revision: "r1", files: [] };

/** A temp models folder, removed when the test ends. */
async function tempModels(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kleio-dictation-"));
  onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** createDictation with a temp models folder, an engine that runs, and no network. */
async function testDictation(options: Partial<DictationOptions> = {}): Promise<Dictation> {
  return createDictation({
    cacheDir: await tempModels(),
    model: EMPTY_MODEL,
    loadEngine: async () => undefined,
    fetch: () => Promise.reject(new Error("no network in tests")),
    ...options,
  });
}

describe("createDictation", () => {
  it("prompts Whisper with the vocabulary and never returns the prompt", async () => {
    const fake = fakeWhisper("Run the tests.");
    const dictation = await testDictation({ loadModel: async () => fake.model });

    const text = await dictation.transcribe(seconds(3));

    expect(text).toBe("Run the tests.");
    const prefix = fake.prefixes[0] ?? [];
    expect(prefix[0]).toBe(1);
    expect(prefix.slice(-2)).toEqual([2, 3]);
    expect(prefix.length).toBeGreaterThan(3 + DICTATION_VOCABULARY.length);
    for (const term of DICTATION_VOCABULARY) expect(text).not.toContain(term);
  });

  it("keeps every word when Whisper returns only the new tokens", async () => {
    const fake = fakeWhisper("Run the tests.", { echoPrefix: false });
    const dictation = await testDictation({ loadModel: async () => fake.model });
    expect(await dictation.transcribe(seconds(3))).toBe("Run the tests.");
  });

  it.each([
    [1.49, false],
    [1.5, true],
  ])("with %f s of speech, prompts: %s", async (length, prompted) => {
    const fake = fakeWhisper("Commit and push.");
    const dictation = await testDictation({ loadModel: async () => fake.model });

    expect(await dictation.transcribe(seconds(length))).toBe("Commit and push.");
    expect(fake.prefixes[0]?.length === 2).toBe(!prompted);
  });

  it("transcribes speech over 30 s in chunks, without the prompt", async () => {
    const fake = fakeWhisper("A long note about the tail scale setup.");
    const dictation = await testDictation({ loadModel: async () => fake.model });

    const text = await dictation.transcribe(seconds(31));

    expect(fake.transcribeLong).toHaveBeenCalledOnce();
    expect(fake.prefixes).toEqual([]);
    expect(text).toBe("A long note about the Tailscale setup.");
  });

  it("cleans the transcript, then fixes project names", async () => {
    const fake = fakeWhisper("Um, restart it over tail scale.");
    const dictation = await testDictation({ loadModel: async () => fake.model });
    expect(await dictation.transcribe(seconds(3))).toBe("Restart it over Tailscale.");
  });

  it("tries loading again after a failed load", async () => {
    const fake = fakeWhisper("Hello.");
    const loadModel = vi
      .fn<() => Promise<DictationModel>>()
      .mockRejectedValueOnce(new Error("bad model file"))
      .mockResolvedValue(fake.model);
    const dictation = await testDictation({ loadModel });

    const failed = dictation.transcribe(seconds(3));
    await expect(failed).rejects.toThrow(DictationUnavailableError);
    await expect(failed).rejects.toMatchObject({ reason: "load" });
    // The reason only: "bad model file" stays in the host's log.
    expect(await dictation.status()).toEqual({ state: "failed", reason: "load", bytes: 0 });
    expect(log).toHaveBeenCalledWith("ERROR", "dictation", "couldn't load the speech model", {
      error: "bad model file",
    });
    expect(await dictation.transcribe(seconds(3))).toBe("Hello.");
    expect(loadModel).toHaveBeenCalledTimes(2);
  });
});

const MODEL_FILE = "onnx/model.onnx";

/** A small file, then one big enough to arrive in several chunks. */
const hubModel = (): TestModel =>
  testModel({ "config.json": Buffer.from("{}\n"), [MODEL_FILE]: testBytes(256 * 1024) });

/** A fake Hugging Face for this test only. */
async function startHub(
  test: TestModel,
  answer?: (request: HubRequest, index: number) => HubAnswer,
): Promise<FakeHub> {
  const hub = await startFakeHub(test, answer);
  onTestFinished(() => hub.close());
  return hub;
}

/** createDictation downloading `test` from `hub` with the real fetch. */
function hubDictation(
  test: TestModel,
  hub: FakeHub,
  options: Partial<DictationOptions> = {},
): Promise<Dictation> {
  return testDictation({
    model: test.model,
    baseUrl: hub.baseUrl,
    fetch,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
    ...options,
  });
}

/** Wait for a stopped run to end, so its files are closed before the folder goes. */
async function settled(dictation: Dictation): Promise<void> {
  await vi.waitFor(async () => {
    expect(["absent", "ready", "failed"]).toContain((await dictation.status()).state);
  });
}

describe("createDictation: getting the model ready", () => {
  it("says absent, with the model's size, before anything has run", async () => {
    const dictation = createDictation({ cacheDir: await tempModels() });

    expect(await dictation.status()).toEqual({ state: "absent", bytes: modelBytes() });
  });

  it("serves prepare() and a clip with one run: one download, one load", async () => {
    const test = hubModel();
    const hub = await startHub(test);
    const fake = fakeWhisper("Run the tests.");
    const loadModel = vi.fn(async () => fake.model);
    const loadEngine = vi.fn(async () => undefined);
    const dictation = await hubDictation(test, hub, { loadModel, loadEngine });

    dictation.prepare();
    // Under way at once, so Setup starts polling.
    expect((await dictation.status()).state).toBe("loading");
    dictation.prepare();
    expect(await dictation.transcribe(seconds(3))).toBe("Run the tests.");

    expect(hub.requests.map((r) => r.file)).toEqual(["config.json", MODEL_FILE]);
    expect(loadEngine).toHaveBeenCalledOnce();
    expect(loadModel).toHaveBeenCalledOnce();
    expect(await dictation.status()).toEqual({ state: "ready", bytes: modelBytes(test.model) });
  });

  it("stops a download on dispose(), keeping the .part; the next start resumes it", async () => {
    const cacheDir = await tempModels();
    const test = testModel({ [MODEL_FILE]: testBytes(256 * 1024) });
    const bytes = modelBytes(test.model);
    const stalled = await startHub(test, () => ({ kind: "stall", after: 50_000 }));
    const first = await hubDictation(test, stalled, { cacheDir });

    first.prepare();
    await vi.waitFor(async () => {
      expect(await first.status()).toEqual({ state: "downloading", loaded: 50_000, bytes });
    });
    first.dispose();
    await settled(first);

    expect(await first.status()).toEqual({ state: "absent", bytes });
    const part = path.join(modelDir(cacheDir, test.model), "onnx", "model.onnx.part");
    expect((await fs.stat(part)).size).toBe(50_000);

    const hub = await startHub(test);
    const fake = fakeWhisper("Hello.");
    const next = await hubDictation(test, hub, { cacheDir, loadModel: async () => fake.model });
    expect(await next.transcribe(seconds(3))).toBe("Hello.");
    expect(hub.requests).toEqual([{ file: MODEL_FILE, range: "bytes=50000-" }]);
  });

  it("lets a clip stop waiting while the download carries on", async () => {
    const test = hubModel();
    const hub = await startHub(test, (request) =>
      request.file === MODEL_FILE ? { kind: "stall", after: 50_000 } : { kind: "serve" },
    );
    const dictation = await hubDictation(test, hub);
    const gone = new AbortController();

    const clip = dictation.transcribe(seconds(3), gone.signal);
    await vi.waitFor(async () => {
      expect(await dictation.status()).toMatchObject({ state: "downloading" });
    });
    gone.abort();

    await expect(clip).rejects.toMatchObject({ name: "AbortError" });
    expect(await dictation.status()).toMatchObject({ state: "downloading" });
    dictation.dispose();
    await settled(dictation);
  });

  it("starts a fresh run after a failed download, and that one can succeed", async () => {
    const test = hubModel();
    const hub = await startHub(test, (_request, index) =>
      index === 0 ? { kind: "status", status: 503 } : { kind: "serve" },
    );
    const fake = fakeWhisper("Hello.");
    const dictation = await hubDictation(test, hub, { loadModel: async () => fake.model });

    const failed = dictation.transcribe(seconds(3));
    await expect(failed).rejects.toBeInstanceOf(DictationUnavailableError);
    await expect(failed).rejects.toMatchObject({ reason: "server" });
    expect(await dictation.status()).toEqual({
      state: "failed",
      reason: "server",
      bytes: modelBytes(test.model),
    });

    expect(await dictation.transcribe(seconds(3))).toBe("Hello.");
    expect(await dictation.status()).toEqual({ state: "ready", bytes: modelBytes(test.model) });
  });

  it("gives unsupported for good when the engine can't run: nothing downloads, logged once", async () => {
    const cacheDir = await tempModels();
    const test = hubModel();
    const download = vi.fn<typeof fetch>();
    const loadEngine = vi.fn(() =>
      Promise.reject(new Error("Cannot find module 'onnxruntime_binding.node'")),
    );
    const dictation = await testDictation({
      cacheDir,
      model: test.model,
      loadEngine,
      fetch: download,
    });

    dictation.prepare();
    await vi.waitFor(async () => {
      expect((await dictation.status()).state).toBe("unsupported");
    });
    dictation.prepare();
    // Asked again, it doesn't even flicker back to "loading".
    expect((await dictation.status()).state).toBe("unsupported");
    const clip = dictation.transcribe(seconds(3));

    await expect(clip).rejects.toBeInstanceOf(DictationUnavailableError);
    await expect(clip).rejects.toMatchObject({ reason: "unsupported" });
    expect(await dictation.status()).toEqual({
      state: "unsupported",
      os: process.platform,
      arch: process.arch,
      bytes: modelBytes(test.model),
    });
    expect(loadEngine).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    await expect(fs.stat(modelDir(cacheDir, test.model))).rejects.toThrow();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "ERROR",
      "dictation",
      "the speech engine can't run on this host",
      expect.objectContaining({ error: expect.stringContaining("onnxruntime_binding") }),
    );
  });

  /** Each way a download fails, and the raw text that must stay in the log. */
  const failures: {
    readonly label: string;
    readonly reason: DictationFailure;
    readonly raw: string;
    readonly answer?: (test: TestModel) => HubAnswer;
    readonly options?: Partial<DictationOptions>;
    readonly fullDisk?: boolean;
  }[] = [
    {
      label: "no network",
      reason: "offline",
      raw: "ENOTFOUND",
      options: {
        fetch: () =>
          Promise.reject(
            new TypeError("fetch failed", {
              cause: new Error("getaddrinfo ENOTFOUND huggingface.co"),
            }),
          ),
      },
    },
    {
      label: "the pinned model gone from the Hub",
      reason: "missing",
      raw: "404",
      answer: () => ({ kind: "status", status: 404 }),
    },
    {
      label: "bytes that don't match the pin",
      reason: "integrity",
      raw: MODEL_FILE,
      answer: (test) => {
        const wrong = Buffer.from(bytesOf(test, MODEL_FILE));
        wrong[0] = (wrong[0] ?? 0) ^ 0xff;
        return { kind: "body", body: wrong, sized: true };
      },
    },
    {
      label: "a file growing past its size",
      reason: "integrity",
      raw: MODEL_FILE,
      answer: (test) => ({
        kind: "body",
        body: Buffer.concat([bytesOf(test, MODEL_FILE), Buffer.alloc(1_000)]),
      }),
    },
    { label: "a full disk (ENOSPC)", reason: "storage", raw: "ENOSPC", fullDisk: true },
    {
      label: "too little free space",
      reason: "storage",
      raw: "needs",
      options: { freeBytes: async () => 0 },
    },
  ];

  it.each(failures)(
    "$label: reason $reason reaches status() and the clip, the details only the log",
    async ({ reason, raw, answer, options, fullDisk }) => {
      const test = hubModel();
      const hub = await startHub(test, (request) =>
        answer && request.file === MODEL_FILE ? answer(test) : { kind: "serve" },
      );
      if (fullDisk) {
        const realOpen = fs.open;
        const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
          const handle = await realOpen(...args);
          vi.spyOn(handle, "write").mockRejectedValue(
            Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }),
          );
          return handle;
        });
        onTestFinished(() => open.mockRestore());
      }
      const dictation = await hubDictation(test, hub, options);

      const error: unknown = await dictation.transcribe(seconds(3)).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DictationUnavailableError);
      expect(error).toMatchObject({ reason });
      const status = await dictation.status();
      expect(status).toEqual({ state: "failed", reason, bytes: modelBytes(test.model) });
      expect(JSON.stringify(log.mock.calls)).toContain(raw);
      expect(`${JSON.stringify(status)} ${String(error)}`).not.toContain(raw);
    },
  );

  it.each(["removed", "resized"])(
    "says ready from disk on a fresh start, and absent once a file is %s",
    async (change) => {
      const cacheDir = await tempModels();
      const test = hubModel();
      const hub = await startHub(test);
      const got = await downloadModel(cacheDir, { model: test.model, baseUrl: hub.baseUrl });
      expect(got).toEqual({ ok: true });
      const loadEngine = vi.fn(async () => undefined);
      const fake = fakeWhisper("Hello.");
      const dictation = createDictation({
        cacheDir,
        model: test.model,
        loadEngine,
        loadModel: async () => fake.model,
      });

      expect(await dictation.status()).toEqual({ state: "ready", bytes: modelBytes(test.model) });
      expect(loadEngine).not.toHaveBeenCalled();
      expect(await dictation.transcribe(seconds(3))).toBe("Hello.");
      expect(hub.requests).toHaveLength(2);

      const config = path.join(modelDir(cacheDir, test.model), "config.json");
      if (change === "removed") await fs.rm(config);
      else await fs.appendFile(config, "\n");
      expect(await createDictation({ cacheDir, model: test.model }).status()).toEqual({
        state: "absent",
        bytes: modelBytes(test.model),
      });
    },
  );
});
