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

describe("resampleTo16k", () => {
  it("returns 16 kHz input unchanged", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resampleTo16k(input, DICTATION_SAMPLE_RATE)).toBe(input);
  });

  it("downsamples 48 kHz to a third of the samples", () => {
    const input = new Float32Array(Array.from({ length: 9 }, (_, i) => i / 10));
    const out = resampleTo16k(input, 48_000);
    expect(out).toHaveLength(3);
    expect(out[1]).toBeCloseTo(0.3, 5);
  });

  it("interpolates between samples for a non-integer ratio", () => {
    const out = resampleTo16k(new Float32Array([0, 1, 0, 1]), 24_000);
    expect(out).toHaveLength(2);
    // Sample 1 falls halfway between input 1 (1) and input 2 (0).
    expect(out[1]).toBeCloseTo(0.5, 5);
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
