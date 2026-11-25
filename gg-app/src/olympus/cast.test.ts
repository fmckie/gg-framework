import { describe, expect, it } from "vitest";
import { CAST, POSES, POSE_URLS, type Pose, type Skill } from "./cast";
import { GODS, type GodId } from "./gods";

const ids = Object.keys(GODS) as GodId[];

/** The pictures on disk, by file name, as data URLs. */
const FILES = import.meta.glob<string>("./poses/*.webp", {
  query: "?inline",
  import: "default",
  eager: true,
});

/** A lossless WebP's width and height, from its header. */
function sizeOf(god: GodId, pose: Pose): [number, number] {
  const bytes = atob(FILES[`./poses/${god}-${pose}.webp`]!.split(",")[1]!);
  expect(bytes.slice(0, 4) + bytes.slice(8, 16)).toBe("RIFFWEBPVP8L");
  const at = (i: number): number => bytes.charCodeAt(i);
  const bits = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
  return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
}

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

  it("gives every god its own beat", () => {
    expect(Object.fromEntries(ids.map((id) => [id, CAST.gods[id].step]))).toEqual({
      athena: 520,
      herodotus: 600,
      hermes: 300,
      hephaestus: 560,
      argus: 500,
      themis: 640,
      nike: 360,
    });
  });

  it("says which pose each god acts each family of tool in, and none for the families it lacks", () => {
    const acts = (id: GodId): Record<string, string> =>
      Object.fromEntries(
        Object.entries(CAST.gods[id].acts).map(([family, act]) => [family, act.pose]),
      );
    expect(Object.fromEntries(ids.map((id) => [id, acts(id)]))).toEqual({
      athena: { look: "look", think: "think" },
      herodotus: { look: "look", web: "web", think: "think" },
      hermes: { look: "look", make: "make", run: "run", think: "think" },
      hephaestus: { look: "look", make: "make", run: "run", think: "think" },
      argus: { look: "look", web: "web", run: "run", think: "think" },
      themis: { look: "look", web: "web", run: "run", think: "think-r" },
      nike: { look: "look", web: "look", make: "make", run: "run", think: "think" },
    });
    // Only Themis thinks with her scales, tipped one way or the other.
    for (const id of ids) {
      const scales = Object.values(CAST.gods[id].acts).flatMap((act) => act.verdict ?? []);
      expect(scales).toEqual(id === "themis" ? [{ confirmed: "think-r", dropped: "think-l" }] : []);
    }
  });

  it("places every skill pose in the cell, inside the envelope the places were planned with", () => {
    let count = 0;
    for (const id of ids) {
      const god = CAST.gods[id];
      const named = new Set<Skill>(
        Object.values(god.acts).flatMap((act) => [act.pose, ...Object.values(act.verdict ?? {})]),
      );
      // A place and a picture for every pose an act names, and for no other.
      expect(Object.keys(god.at).sort()).toEqual([...named].sort());
      expect(Object.keys(POSE_URLS[id]).sort()).toEqual([...POSES, ...named].sort());
      const [lo, hi] = god.env;
      for (const pose of named) {
        count += 1;
        const [left, width] = god.at[pose]!;
        expect(width).toBeGreaterThan(30);
        expect(left + width).toBeGreaterThan(33); // it stands on the head line
        expect(left).toBeLessThan(33);
        // Its figure is inside its picture, and inside all the god may cover at its place.
        const [a, b] = god.fp[pose]!;
        expect(a).toBeGreaterThanOrEqual(left - 0.5);
        expect(b).toBeLessThanOrEqual(left + width + 0.5);
        expect(a).toBeGreaterThanOrEqual(lo - 0.5);
        expect(b).toBeLessThanOrEqual(hi + 0.5);
        expect(POSE_URLS[id][pose]).toMatch(new RegExp(`${id}-${pose}`));
      }
    }
    expect(count).toBe(26);
  });

  it("lifts only the one who flies, at her look, and not over her envelope's top", () => {
    for (const id of ids) expect(CAST.gods[id].lift).toEqual(id === "nike" ? { look: 8 } : {});
    expect(Math.min(...CAST.gods.nike.envol.map(([y]) => y))).toBeLessThan(0);
  });

  it("has every picture at twice the size it is drawn, lossless", () => {
    expect(Object.keys(FILES)).toHaveLength(14 + 26);
    for (const id of ids) {
      for (const pose of POSES) expect(sizeOf(id, pose)).toEqual([146, 200]);
      for (const [pose, at] of Object.entries(CAST.gods[id].at))
        expect(sizeOf(id, pose as Skill)).toEqual([2 * at[1], 200]);
    }
  });

  it("leaves room for the five widest gods on the narrowest lane", () => {
    // A 660px window: a 604px column, 602px inside its frame, 16px clear at each end.
    const widths = ids.map((id) => CAST.gods[id].env[1] - CAST.gods[id].env[0]);
    const widest = Math.max(...widths);
    expect(5 * widest + 4 * 10).toBeLessThanOrEqual(602 - 2 * 16);
  });
});
