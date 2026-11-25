import { describe, expect, it } from "vitest";
import { CAST, POSES, POSE_URLS } from "./cast";
import { GODS, type GodId } from "./gods";

const ids = Object.keys(GODS) as GodId[];

describe("the cast data", () => {
  it("says which mockup it was cut from", () => {
    expect(CAST.source).toMatch(/mockups\/subagents\/v4\/olympus\.html at [0-9a-f]{7,}$/);
  });

  it("has every god of the cast, under the name its rows use", () => {
    expect(Object.keys(CAST.gods).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(CAST.gods[id].name).toBe(GODS[id].name);
  });

  it("measures every god in the 73×100 cell", () => {
    expect(CAST.cell).toEqual({ w: 73, h: 100, head: 33 });
    for (const id of ids) {
      const god = CAST.gods[id];
      const [lo, hi] = god.env;
      expect(lo).toBeLessThan(hi);
      expect(god.envol.length).toBeGreaterThan(20);
      for (const [y, a, b] of god.envol) {
        // A god may reach over its cell's top, but not out of the lane.
        expect(y).toBeGreaterThanOrEqual(-4);
        expect(y).toBeLessThan(100);
        expect(a).toBeLessThanOrEqual(b);
        // The outline is the envelope's, give or take the rounding.
        expect(a).toBeGreaterThanOrEqual(lo - 0.5);
        expect(b).toBeLessThanOrEqual(hi + 0.5);
      }
      for (const pose of POSES) {
        const [a, b] = god.fp[pose];
        expect(a).toBeLessThan(b);
        expect(a).toBeGreaterThanOrEqual(lo - 0.5);
        expect(b).toBeLessThanOrEqual(hi + 0.5);
      }
      const [hx, hy] = god.hand;
      expect(hx).toBeGreaterThan(33); // the open hand is held out in front
      expect(hy).toBeGreaterThan(0);
      expect(hy).toBeLessThan(100);
      const [ex, ey] = god.seal;
      expect(ex).toBeGreaterThan(0);
      expect(ex).toBeLessThan(73);
      expect(ey).toBeGreaterThan(0);
      expect(ey).toBeLessThan(100);
      expect(god.fissure.map((node) => node.tag)).toEqual(["path", "path", "path"]);
      for (const node of god.fissure) expect(node.attrs.d).toMatch(/^M[\d. ]+L/);
    }
  });

  it("has one seal, drawn in its own box", () => {
    expect(CAST.seal.viewBox).toBe("0 0 26 26");
    expect(CAST.seal.nodes.map((node) => node.tag)).toEqual(["path", "circle", "circle", "g"]);
  });

  it("has a picture of every god in every pose the lane draws", () => {
    for (const id of ids)
      for (const pose of POSES) expect(POSE_URLS[id][pose]).toMatch(new RegExp(`${id}-${pose}`));
  });

  it("leaves room for the five widest gods on the narrowest lane", () => {
    // A 660px window: a 604px column, 602px inside its frame, 16px clear at each end.
    const widths = ids.map((id) => CAST.gods[id].env[1] - CAST.gods[id].env[0]);
    const widest = Math.max(...widths);
    expect(5 * widest + 4 * 10).toBeLessThanOrEqual(602 - 2 * 16);
  });
});
