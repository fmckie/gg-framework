import { describe, expect, it } from "vitest";
import {
  cleanTranscript,
  decodePcm16,
  DICTATION_MAX_SECONDS,
  DICTATION_SAMPLE_RATE,
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
