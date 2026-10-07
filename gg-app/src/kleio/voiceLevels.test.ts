import { describe, expect, it } from "vitest";
import { levelOf } from "./voiceLevels";

describe("levelOf", () => {
  it("is 0 for silence and rises with loudness, capped at 1", () => {
    expect(levelOf(new Float32Array(512))).toBe(0);
    const quiet = levelOf(new Float32Array(512).fill(0.003));
    const speech = levelOf(new Float32Array(512).fill(0.05));
    const loud = levelOf(new Float32Array(512).fill(0.9));
    expect(quiet).toBeLessThan(speech);
    expect(speech).toBeGreaterThan(0.3);
    expect(loud).toBe(1);
  });
});
