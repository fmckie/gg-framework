import { describe, expect, it, vi } from "vitest";
import {
  cleanTranscript,
  correctVocabulary,
  createDictation,
  decodePcm16,
  DICTATION_MAX_SECONDS,
  DICTATION_SAMPLE_RATE,
  DICTATION_VOCABULARY,
  type DictationModel,
  trimToSpeech,
} from "./dictation.js";

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

describe("createDictation", () => {
  it("prompts Whisper with the vocabulary and never returns the prompt", async () => {
    const fake = fakeWhisper("Run the tests.");
    const dictation = createDictation({ cacheDir: "/unused", loadModel: async () => fake.model });

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
    const dictation = createDictation({ cacheDir: "/unused", loadModel: async () => fake.model });
    expect(await dictation.transcribe(seconds(3))).toBe("Run the tests.");
  });

  it.each([
    [1.49, false],
    [1.5, true],
  ])("with %f s of speech, prompts: %s", async (length, prompted) => {
    const fake = fakeWhisper("Commit and push.");
    const dictation = createDictation({ cacheDir: "/unused", loadModel: async () => fake.model });

    expect(await dictation.transcribe(seconds(length))).toBe("Commit and push.");
    expect(fake.prefixes[0]?.length === 2).toBe(!prompted);
  });

  it("transcribes speech over 30 s in chunks, without the prompt", async () => {
    const fake = fakeWhisper("A long note about the tail scale setup.");
    const dictation = createDictation({ cacheDir: "/unused", loadModel: async () => fake.model });

    const text = await dictation.transcribe(seconds(31));

    expect(fake.transcribeLong).toHaveBeenCalledOnce();
    expect(fake.prefixes).toEqual([]);
    expect(text).toBe("A long note about the Tailscale setup.");
  });

  it("cleans the transcript, then fixes project names", async () => {
    const fake = fakeWhisper("Um, restart it over tail scale.");
    const dictation = createDictation({ cacheDir: "/unused", loadModel: async () => fake.model });
    expect(await dictation.transcribe(seconds(3))).toBe("Restart it over Tailscale.");
  });

  it("tries loading again after a failed load", async () => {
    const fake = fakeWhisper("Hello.");
    const loadModel = vi
      .fn<() => Promise<DictationModel>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(fake.model);
    const dictation = createDictation({ cacheDir: "/unused", loadModel });

    await expect(dictation.transcribe(seconds(3))).rejects.toThrow("offline");
    expect(await dictation.transcribe(seconds(3))).toBe("Hello.");
    expect(loadModel).toHaveBeenCalledTimes(2);
  });
});
