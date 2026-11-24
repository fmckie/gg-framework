import { describe, expect, it } from "vitest";
import type { OrbMood } from "../VoiceOrb";
import { CYCLE, inputAt, poseAt, STEPS, thinkingAt, voiceAt } from "./motion";

const MOODS: OrbMood[] = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "muted",
  "ended",
];

describe("the Hairline instrument's poses", () => {
  it("are repeatable, finite and within the instrument's limits", () => {
    for (const mood of MOODS) {
      for (let t = 0; t < 60; t += 0.17) {
        const p = poseAt(mood, t, t);
        expect(p).toEqual(poseAt(mood, t, t));
        expect(Object.values(p).every(Number.isFinite)).toBe(true);
        expect(Math.abs(p.yaw)).toBeLessThanOrEqual(0.028);
        expect(Math.abs(p.pitch)).toBeLessThanOrEqual(0.02);
        expect(p.amp).toBeLessThanOrEqual(0.024);
        expect(p.assemble).toBeGreaterThanOrEqual(0);
        expect(p.assemble).toBeLessThanOrEqual(1);
      }
    }
  });

  // Brightness is live × dim, relative to the fully lit instrument.
  it.each([
    ["connecting", 0.62],
    ["listening", 0.92],
    ["idle", 0.69],
    ["thinking", 0.8],
    ["speaking", 1],
    ["muted", 0.341],
    ["ended", 0.48],
  ] as const)("%s is lit at %s of full", (mood, brightness) => {
    const p = poseAt(mood, 9, 9);
    expect(p.live * p.dim).toBeCloseTo(brightness, 3);
    expect(p.muted).toBe(mood === "muted" ? 1 : 0);
    expect(p.retract).toBe(mood === "ended" ? 1 : 0);
  });

  it("connecting builds on once, then steps the cursor a quarter turn every 1.2 s", () => {
    expect(poseAt("connecting", 0, 0).assemble).toBe(0);
    expect(poseAt("connecting", 2, 2).assemble).toBe(1);
    expect(poseAt("connecting", 9, 9).assemble).toBe(1);
    expect(poseAt("connecting", 1.5, 1.5).seekAmt).toBe(0);
    expect(poseAt("connecting", 2.1, 2.1).seekAmt).toBe(1);
    expect(poseAt("connecting", 2.1, 2.1).seek).toBe(0);
    expect(poseAt("connecting", 2.1 + 0.45, 0).seek).toBeCloseTo(1, 10);
    expect(poseAt("connecting", 2.1 + 1.19, 0).seek).toBeCloseTo(1, 10);
    expect(poseAt("connecting", 2.1 + 1.2 + 0.45, 0).seek).toBeCloseTo(2, 10);
    expect(poseAt("connecting", 0, 0).yaw).toBe(0);
  });

  it("connecting never puts the cursor and its trail a turn apart", () => {
    for (let t = 0; t < 30; t += 0.01) {
      const ahead = poseAt("connecting", t, t).seek - poseAt("connecting", t - 0.12, t).seek;
      expect(ahead).toBeGreaterThanOrEqual(-1e-9);
      expect(ahead).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("listening stays quiet: no voice trace, no rotation, input only in the fixed utterance", () => {
    for (let t = 0; t < 30; t += 0.5) {
      const p = poseAt("listening", t, t);
      expect(p.amp).toBe(0);
      expect(p.seg + p.dots + p.outer).toBe(0);
      expect(p.inAmp).toBeLessThanOrEqual(0.009);
    }
    expect(inputAt(1.55)).toBeGreaterThan(0.8);
    expect(inputAt(0.2)).toBeLessThan(0.02);
    expect(inputAt(5)).toBeLessThan(0.02);
    expect(inputAt(1.55 + 6.5)).toBeCloseTo(inputAt(1.55), 10);
    expect(poseAt("listening", 1.55, 1.55).inAmp).toBeGreaterThan(0.007);
    expect(poseAt("listening", 5, 5).inAmp).toBeLessThan(5e-4);
  });

  it("idle is listening at three quarters brightness", () => {
    expect(poseAt("idle", 3, 3)).toEqual({ ...poseAt("listening", 3, 3), dim: 0.75 });
  });

  it("thinking indexes each ring by its detent, then holds", () => {
    expect(thinkingAt(1.8)).toEqual(thinkingAt(3.1));
    expect(thinkingAt(0.2)).not.toEqual(thinkingAt(0.6));
    expect(thinkingAt(1.8)).toEqual(STEPS);
    expect(thinkingAt(CYCLE * 2).seg).toBe(STEPS.seg * 2);
    // Arcs 24°, dots 12° and bezel 17.8°; the cursor an eighth of a turn.
    expect((STEPS.seg * 180) / Math.PI).toBeCloseTo(24, 0);
    expect((-STEPS.dots * 180) / Math.PI).toBeCloseTo(12, 0);
    expect((-STEPS.outer * 180) / Math.PI).toBeCloseTo(17.8, 1);
    expect(STEPS.scan).toBe(Math.PI / 4);
  });

  it("speaking follows the fixed 6.8 s phrase, with rests", () => {
    expect(voiceAt(2.55)).toBeGreaterThan(0.8);
    expect(voiceAt(6.5)).toBeLessThan(0.05);
    const loud = poseAt("speaking", 2.55, 2.55);
    const rest = poseAt("speaking", 6.5, 6.5);
    expect(loud.amp).toBeGreaterThan(rest.amp + 0.018);
    expect(loud.extend).toBeGreaterThan(0.8);
    // The echo is the same phrase 0.16 s late.
    expect(poseAt("speaking", 2.71, 0).echoAmp / 0.018).toBeCloseTo(voiceAt(2.55), 10);
  });

  it("reduced motion makes every mood one still pose", () => {
    for (const mood of MOODS) expect(poseAt(mood, 0, 0, true)).toEqual(poseAt(mood, 41, 41, true));
    expect(poseAt("connecting", 0, 0, true)).toMatchObject({ assemble: 1, seekAmt: 1, seek: 0 });
    expect(poseAt("listening", 1.55, 1.55, true)).toMatchObject({ inAmp: 0, yaw: 0, pitch: 0 });
    expect(poseAt("thinking", 0, 0, true)).toMatchObject({ ...STEPS, scanAmt: 1, yaw: 0 });
    const speaking = poseAt("speaking", 0, 0, true);
    expect(speaking.amp).toBeCloseTo(0.024 * 0.55, 10);
    expect(speaking.echoAmp).toBeCloseTo(0.018 * 0.45, 10);
    expect(speaking.extend).toBe(0.55);
  });

  it("muted and ended are still with or without reduced motion", () => {
    for (const mood of ["muted", "ended"] as const) {
      expect(poseAt(mood, 0, 0)).toEqual(poseAt(mood, 37, 37));
      expect(poseAt(mood, 0, 0)).toEqual(poseAt(mood, 0, 0, true));
    }
  });
});
