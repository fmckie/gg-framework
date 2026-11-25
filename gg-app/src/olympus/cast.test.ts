import { describe, expect, it } from "vitest";
import {
  CAST,
  FRAME_URLS,
  POSES,
  POSE_URLS,
  type Fidget,
  type FidgetMove,
  type Pose,
  type Skill,
} from "./cast";
import { GODS, type GodId } from "./gods";

const ids = Object.keys(GODS) as GodId[];

/** The pictures on disk, by file name, as data URLs. */
const FILES = import.meta.glob<string>("./poses/*.webp", {
  query: "?inline",
  import: "default",
  eager: true,
});

/** A lossless WebP's width and height, from its header. */
function sizeOf(god: GodId, pose: Pose | `${Skill}-b`): [number, number] {
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
      // Standing and speaking it is inside its envelope; it never strides at its place.
      for (const pose of ["stand", "speak"] as const) {
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

  it("cuts every god's speaking and standing pose into tesserae, in twelve of its own ivories", () => {
    for (const id of ids) {
      const { palette, ...poses } = CAST.gods[id].tiles;
      expect(palette).toHaveLength(12);
      for (const hex of palette) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(palette).size).toBe(12);
      expect(Object.keys(poses).sort()).toEqual(["speak", "stand"]);
      for (const pose of ["speak", "stand"] as const) {
        const rows = poses[pose];
        let stones = 0;
        rows.forEach(([y0, y1, x0, w, chars], r) => {
          // Courses from the feet up, each on the one under it; a stone is 2.3 to 2.8px each way.
          expect(y1).toBe(r ? rows[r - 1]![0] : 10 * CAST.cell.h);
          expect(y1 - y0).toBeGreaterThanOrEqual(23);
          expect(y1 - y0).toBeLessThanOrEqual(28);
          expect(w).toBeGreaterThanOrEqual(230);
          expect(w).toBeLessThanOrEqual(280);
          // A stone a character: its ivory in the palette, or a gap where the figure isn't.
          expect(chars).toMatch(/^[0-9ab-]+$/);
          expect(chars).toMatch(/[0-9ab]/);
          stones += chars.replace(/-/g, "").length;
          expect(x0).toBeGreaterThanOrEqual(0);
          expect(x0 / 10 + (chars.length * w) / 100).toBeLessThanOrEqual(CAST.cell.w);
        });
        expect(stones).toBeGreaterThan(250);
        expect(stones).toBeLessThan(400);
      }
    }
  });

  it("cuts them where the figure is: along its footprint, and up to its top", () => {
    for (const id of ids) {
      const god = CAST.gods[id];
      for (const pose of ["speak", "stand"] as const) {
        const rows = god.tiles[pose];
        let from = Infinity;
        let to = -Infinity;
        for (const [, , x0, w, chars] of rows) {
          const first = chars.search(/[^-]/);
          const last = chars.length - [...chars].reverse().join("").search(/[^-]/);
          from = Math.min(from, x0 / 10 + (first * w) / 100);
          to = Math.max(to, x0 / 10 + (last * w) / 100);
        }
        expect(Math.abs(from - god.fp[pose][0])).toBeLessThan(2);
        expect(Math.abs(to - god.fp[pose][1])).toBeLessThan(2);
        expect(Math.abs(rows[rows.length - 1]![0] / 10 - god.top[pose])).toBeLessThan(1.5);
      }
    }
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

  it("gives every god its own way of walking", () => {
    expect(Object.fromEntries(ids.map((id) => [id, CAST.gods[id].move]))).toEqual({
      athena: { speed: 64, bob: 0, lift: 0, pause: 0, ease: "linear" },
      herodotus: { speed: 47.5, bob: 0, lift: 0, pause: 0.4, ease: "linear" },
      hermes: { speed: 128.8, bob: 0, lift: 0, pause: 0, ease: "ease-in-out" },
      hephaestus: { speed: 53.2, bob: 1, lift: 0, pause: 0, ease: "linear" },
      argus: { speed: 68, bob: 0, lift: 0, pause: 0.3, ease: "linear" },
      themis: { speed: 46.8, bob: 0, lift: 0, pause: 0, ease: "linear" },
      nike: { speed: 105.6, bob: 0, lift: 2, pause: 0, ease: "ease-out" },
    });
    for (const id of ids) {
      const { speed } = CAST.gods[id].move;
      const stride = (speed * CAST.gods[id].step) / 1000;
      // A stride is a good part of the cell, and never a whole one.
      expect(stride).toBeGreaterThan(25);
      expect(stride).toBeLessThan(45);
    }
  });

  it("has every god's stride: its picture, where its feet fall, and its top", () => {
    expect(POSES).toEqual(["speak", "stand", "stride"]);
    for (const id of ids) {
      const god = CAST.gods[id];
      expect(POSE_URLS[id].stride).toMatch(new RegExp(`${id}-stride`));
      const [a, b] = god.fp.stride;
      // In mid stride its feet are wider apart than standing, and all inside the cell.
      expect(b - a).toBeGreaterThan(god.fp.stand[1] - god.fp.stand[0]);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(73);
      // And its head stays where it is: within a pixel of its standing top.
      expect(Math.abs(god.top.stride - god.top.stand)).toBeLessThanOrEqual(1);
      // The card over a walker stands over its standing top, less its skim: at or over the stride's.
      expect(god.top.stand - god.move.lift - 10).toBeLessThanOrEqual(god.top.stride - 2);
    }
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

  it("gives every pose the lane draws its top in the cell", () => {
    for (const id of ids) {
      const god = CAST.gods[id];
      expect(Object.keys(god.top).sort()).toEqual(Object.keys(god.fp).sort());
      for (const y of Object.values(god.top)) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(30);
      }
    }
  });

  it("holds each god's card at one height at its work: at or over the top of every pose it acts, lifted", () => {
    expect(Object.fromEntries(ids.map((id) => [id, CAST.gods[id].card]))).toEqual({
      athena: 0,
      herodotus: 8,
      hermes: 3,
      hephaestus: 5.2,
      argus: 6,
      themis: 4,
      nike: -2,
    });
    for (const id of ids) {
      const god = CAST.gods[id];
      for (const pose of Object.keys(god.at) as Skill[])
        expect(god.card).toBeLessThanOrEqual(god.top[pose]! - (god.lift[pose] ?? 0));
      // And never so high that its caret leaves the lane's frame: its foot is within 9px of the lane's top.
      expect(3 + god.card - 10).toBeGreaterThanOrEqual(-9);
    }
  });

  it("has every picture at twice the size it is drawn, lossless", () => {
    expect(Object.keys(FILES)).toHaveLength(14 + 26 + 7 + 3);
    for (const id of ids) {
      for (const pose of POSES) expect(sizeOf(id, pose)).toEqual([146, 200]);
      for (const [pose, at] of Object.entries(CAST.gods[id].at))
        expect(sizeOf(id, pose as Skill)).toEqual([2 * at[1], 200]);
    }
  });

  it("has a second frame of three poses, each the size of its first: a stride, a blow, a wingbeat", () => {
    const second = ids.flatMap((id) =>
      Object.entries(CAST.gods[id].frames).map(([pose, frames]) => [id, pose, frames]),
    );
    expect(second).toEqual([
      ["hermes", "run", ["b"]],
      ["hephaestus", "make", ["b"]],
      ["nike", "look", ["b"]],
    ]);
    for (const id of ids) {
      const poses = Object.keys(CAST.gods[id].frames) as Skill[];
      expect(Object.keys(FRAME_URLS[id] ?? {})).toEqual(poses);
      for (const pose of poses) {
        expect(FRAME_URLS[id]![pose]).toMatch(new RegExp(`${id}-${pose}-b`));
        expect(sizeOf(id, `${pose}-b`)).toEqual([2 * CAST.gods[id].at[pose]![1], 200]);
      }
    }
  });

  it("cuts a part out of four poses: a polygon inside the pose's own picture, and the hole it leaves", () => {
    const parts = ids.flatMap((id) =>
      Object.entries(CAST.gods[id].parts).map(([pose, part]) => `${id} ${pose} ${part.name}`),
    );
    expect(parts).toEqual([
      "argus web flame",
      "themis think-l scales",
      "themis think-r scales",
      "themis run pebble",
    ]);
    for (const id of ids) {
      const god = CAST.gods[id];
      for (const [pose, part] of Object.entries(god.parts) as [
        Skill,
        (typeof god.parts)[Skill],
      ][]) {
        const [, width] = god.at[pose]!;
        expect(god.frames[pose]).toBeUndefined(); // one cut-out to a pose, and none on a pose in two frames
        for (const shape of [part!.cut, part!.hole]) {
          expect(shape.length).toBeGreaterThanOrEqual(3);
          for (const [x, y] of shape) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(width);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(100);
          }
        }
        // The hole is the part's own outline, or a hair inside it: never a gap round the part at rest.
        const box = (shape: readonly (readonly [number, number])[], i: 0 | 1): [number, number] => [
          Math.min(...shape.map((p) => p[i])),
          Math.max(...shape.map((p) => p[i])),
        ];
        for (const i of [0, 1] as const) {
          expect(box(part!.hole, i)[0]).toBeGreaterThanOrEqual(box(part!.cut, i)[0]);
          expect(box(part!.hole, i)[1]).toBeLessThanOrEqual(box(part!.cut, i)[1]);
        }
      }
    }
  });

  it("gives every god its fidgets, a pose each: in its beats, small, and only what the lane can play", () => {
    let poses = 0;
    for (const id of ids) {
      const god = CAST.gods[id];
      const named = Object.keys(god.at);
      for (const [pose, fid] of Object.entries(god.fid) as [Skill, Fidget][]) {
        poses += 1;
        expect(named).toContain(pose);
        const moves: FidgetMove[] = [...(fid.cut ? [fid.cut] : []), ...fid.moves];
        // A move played once on the cut; or a rhythm of one move; or idling, with a rest.
        if (fid.cut) expect(fid.moves).toHaveLength(0);
        else if (fid.idle) expect(fid.rest).toBeGreaterThan(0);
        else expect(fid.moves).toHaveLength(1);
        if (!fid.cut) expect(fid.bar).toBeGreaterThan(0);
        for (const move of moves) {
          const beats = move.keys.map(([beat]) => beat);
          expect(beats.every((beat) => (beat * 4) % 1 === 0)).toBe(true); // on the quarter-beat
          expect(beats).toEqual([...new Set(beats)].sort((a, b) => a - b));
          expect(move.end).toBeCloseTo(beats[beats.length - 1]! + move.ease / god.step, 9);
          if (!fid.cut) expect(move.end).toBeLessThanOrEqual(fid.bar + 1e-9); // over inside its bar
          if (fid.idle) expect(move.keys[move.keys.length - 1]![1]).toEqual({}); // and back at rest
          expect(move.part).toBe(move.part === null ? null : god.parts[pose]!.name);
          for (const [, state] of move.keys) {
            // The whole figure by 2px or 2° at most; a part by 6°.
            expect(Math.abs(state.dx ?? 0)).toBeLessThanOrEqual(move.part ? 6 : 2);
            expect(Math.abs(state.dy ?? 0)).toBeLessThanOrEqual(move.part ? 6 : 2);
            expect(Math.abs(state.rot ?? 0)).toBeLessThanOrEqual(move.part ? 6 : 2);
            if (state.rot !== undefined) expect(move.pivot).toHaveLength(2);
            if (state.frame !== undefined) expect(god.frames[pose]).toContain(state.frame);
            // The one who flies rides under her lift, never over it.
            if (state.lift !== undefined) {
              expect(state.lift).toBeGreaterThan(0);
              expect(state.lift).toBeLessThanOrEqual(god.lift[pose]!);
            }
            if (move.part) expect(state.turn ?? state.frame ?? state.lift).toBeUndefined();
            else expect(state.gone).toBeUndefined();
          }
          // A figure leans about the floor: nothing sinks into the step.
          if (!move.part && move.pivot) expect(move.pivot[1]).toBe(100);
        }
      }
    }
    expect(poses).toBe(25);
    // How often is the trait's: Hermes idles in bars a third as long as Themis's.
    expect(CAST.gods.hermes.fid.look!.bar * CAST.gods.hermes.step).toBeLessThan(
      (CAST.gods.themis.fid.look!.bar * CAST.gods.themis.step) / 3,
    );
  });

  it("leaves room for the five widest gods on the narrowest lane", () => {
    // A 660px window: a 604px column, 602px inside its frame, 16px clear at each end.
    const widths = ids.map((id) => CAST.gods[id].env[1] - CAST.gods[id].env[0]);
    const widest = Math.max(...widths);
    expect(5 * widest + 4 * 10).toBeLessThanOrEqual(602 - 2 * 16);
  });
});
