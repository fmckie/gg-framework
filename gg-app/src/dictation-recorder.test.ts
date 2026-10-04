// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DICTATION_SAMPLE_RATE,
  encodePcm16Base64,
  formatElapsed,
  resampleTo16k,
  startRecording,
} from "./dictation-recorder";

function decode(base64: string): number[] {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) out.push(view.getInt16(i, true));
  return out;
}

/** One second of a sine at `hz`, amplitude 0.5, sampled at `rate`. */
function tone(hz: number, rate: number): Float32Array {
  return Float32Array.from(
    { length: rate },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate),
  );
}

/** RMS of the middle of a clip (the edges carry the filter's start-up). */
function middleRms(samples: Float32Array): number {
  const middle = samples.subarray(
    Math.floor(samples.length / 4),
    Math.floor((samples.length * 3) / 4),
  );
  let sum = 0;
  for (const v of middle) sum += v * v;
  return Math.sqrt(sum / middle.length);
}

const SINE_RMS = 0.5 / Math.SQRT2;

describe("resampleTo16k", () => {
  it("returns 16 kHz input unchanged", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resampleTo16k(input, DICTATION_SAMPLE_RATE)).toBe(input);
  });

  it.each([48_000, 44_100])("keeps the clip's length from %i Hz", (rate) => {
    expect(resampleTo16k(tone(440, rate), rate)).toHaveLength(DICTATION_SAMPLE_RATE);
  });

  // Sound above 8 kHz cannot exist at 16 kHz. Without a low-pass filter it
  // folds back as a false lower tone (10 kHz at 48 kHz becomes 6 kHz), which
  // garbles s, t, sh and other consonants Whisper needs.
  it.each([
    [48_000, 10_000],
    [48_000, 14_000],
    [44_100, 10_000],
    [44_100, 12_000],
  ])("removes a %i Hz mic's %i Hz content instead of folding it back", (rate, hz) => {
    const out = resampleTo16k(tone(hz, rate), rate);
    // At least 40 dB down: under 1% of the original level.
    expect(middleRms(out)).toBeLessThan(SINE_RMS / 100);
  });

  it.each([
    [48_000, 300],
    [48_000, 3_000],
    [48_000, 6_000],
    [44_100, 1_000],
    [44_100, 6_000],
  ])("keeps a %i Hz mic's %i Hz speech band at full level", (rate, hz) => {
    const out = resampleTo16k(tone(hz, rate), rate);
    expect(middleRms(out)).toBeGreaterThan(SINE_RMS * 0.9);
    expect(middleRms(out)).toBeLessThan(SINE_RMS * 1.1);
  });
});

// A stand-in for WebKit's audio graph: the context runs at the hardware
// rate, and `feed` plays samples through the capture node.
class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  readonly sampleRate = 48_000;
  state: AudioContextState = "running";
  readonly destination = {};
  processor: { onaudioprocess: ((e: unknown) => void) | null } | null = null;
  readonly options: AudioContextOptions | undefined;
  constructor(options?: AudioContextOptions) {
    this.options = options;
    FakeAudioContext.created.push(this);
  }
  createMediaStreamSource(): { connect(): void; disconnect(): void } {
    return { connect: () => {}, disconnect: () => {} };
  }
  createScriptProcessor(): object {
    this.processor = { onaudioprocess: null };
    return Object.assign(this.processor, { connect: () => {}, disconnect: () => {} });
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {
    this.state = "closed";
  }
  feed(samples: Float32Array): void {
    this.processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
  }
}

describe("startRecording", () => {
  afterEach(() => {
    FakeAudioContext.created = [];
    vi.unstubAllGlobals();
  });

  it("records at the microphone's own rate and hands back 16 kHz", async () => {
    const stopTrack = vi.fn();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) },
    });

    const started = await startRecording();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const ctx = FakeAudioContext.created[0];
    // WebKit refuses a microphone whose rate differs from the context's, so
    // the context must not be pinned to 16 kHz.
    expect(ctx?.options?.sampleRate).toBeUndefined();

    ctx?.feed(new Float32Array(4_800).fill(0.25)); // 0.1 s at 48 kHz
    const pcm = await started.value.stop();
    expect(decode(pcm)).toHaveLength(1_600); // 0.1 s at 16 kHz
    expect(stopTrack).toHaveBeenCalled();
    expect(ctx?.state).toBe("closed");
  });
});

describe("encodePcm16Base64", () => {
  it("writes little-endian 16-bit samples, clamped to full scale", () => {
    expect(decode(encodePcm16Base64(new Float32Array([0, 0.25, -0.25, 1, -1, 2, -2])))).toEqual([
      0, 8_192, -8_192, 32_767, -32_767, 32_767, -32_767,
    ]);
  });

  it("encodes a long clip without overflowing the call stack", () => {
    const twoMinutes = new Float32Array(DICTATION_SAMPLE_RATE * 120);
    expect(encodePcm16Base64(twoMinutes)).toHaveLength(Math.ceil((twoMinutes.length * 2) / 3) * 4);
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [7_400, "0:07"],
    [119_999, "1:59"],
    [-50, "0:00"],
  ])("%d ms reads %s", (ms, label) => {
    expect(formatElapsed(ms)).toBe(label);
  });
});
