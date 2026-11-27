import { describe, expect, it } from "vitest";
import { countingBrush } from "./fixtures";
import { rng } from "./floor";
import {
  cropFloor,
  downAt,
  drawFloor,
  layScene,
  LIFT,
  LIFT_END,
  MOSAIC,
  SCENES,
  SET,
  SET_END,
  type LaidFloor,
  type SceneId,
} from "./mosaic";

const sceneOf = (id: SceneId): (typeof MOSAIC.scenes)[number] =>
  MOSAIC.scenes.find((scene) => scene.id === id)!;
const lay = (id: SceneId, seed = 3): LaidFloor => layScene(sceneOf(id), rng(seed));
/** A laid scene's stones by course, the lowest first: a stone lies in the course its middle is in. */
function courses(id: SceneId, floor = lay(id)): LaidFloor["stones"][] {
  return sceneOf(id).rows.map(([top, bottom]) =>
    floor.stones.filter((k) => k.y >= top / 10 && k.y < bottom / 10),
  );
}
const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;
/** How light a colour is, as written: rgb(r g b). */
const light = (rgb: string): number =>
  rgb
    .match(/\d+/g)!
    .map(Number)
    .reduce((sum, v) => sum + v, 0);

describe("the floor's data", () => {
  it("says which mockup it was cut from, and is cut for the lane: 698 by 104", () => {
    expect(MOSAIC.source).toMatch(/mockups\/subagents\/v4\/olympus\.html at [0-9a-f]{7,}$/);
    expect([MOSAIC.w, MOSAIC.h]).toEqual([698, 104]);
  });

  it("has the three scenes, in their turn", () => {
    expect(MOSAIC.scenes.map((scene) => scene.id)).toEqual(SCENES);
    expect(SCENES).toEqual(["temple", "grove", "agora"]);
    expect(MOSAIC.scenes.map((scene) => scene.name)).toEqual([
      "Summit temple",
      "Olive grove",
      "Agora",
    ]);
  });

  it("sets each scene in five or six dark stones", () => {
    for (const scene of MOSAIC.scenes) {
      expect(scene.palette.length).toBeGreaterThanOrEqual(5);
      expect(scene.palette.length).toBeLessThanOrEqual(6);
      for (const hex of scene.palette) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        // Dark: no channel over a fifth of the way to white, so the gods read on it.
        expect(Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))).toBeLessThan(
          56,
        );
      }
    }
  });

  it("cuts each scene in courses from the stylobate up, each across the whole lane, a stone to a cell", () => {
    for (const scene of MOSAIC.scenes) {
      expect(scene.rows.length).toBeGreaterThan(20);
      expect(scene.rows[0]![1]).toBe(1040); // the lowest course stands on the stylobate
      expect(scene.rows[scene.rows.length - 1]![0]).toBeLessThanOrEqual(0); // the top one reaches the lane's top
      scene.rows.forEach(([top, bottom, left, widths, stones, cuts], r) => {
        expect(bottom).toBeGreaterThan(top);
        if (r) expect(bottom).toBe(scene.rows[r - 1]![0]); // each on the one below
        expect(left).toBeLessThanOrEqual(0);
        expect(left + widths.reduce((sum, w) => sum + w, 0)).toBeGreaterThanOrEqual(6980);
        expect(stones).toHaveLength(widths.length);
        for (const w of widths) expect(w).toBeGreaterThan(0);
        for (const ch of stones) expect(Number(ch)).toBeLessThan(scene.palette.length);
        for (const [cell, deg, , beyond] of cuts) {
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(cell).toBeLessThan(widths.length);
          expect(Math.abs(deg)).toBeLessThanOrEqual(180);
          expect(beyond).toBeLessThan(scene.palette.length);
        }
      });
    }
  });
});

describe("a scene laid", () => {
  it("is a stone for every cell, and two for a cell nipped on an outline, but for chips too small to set", () => {
    for (const id of SCENES) {
      const rows = sceneOf(id).rows;
      const cells = rows.reduce((n, row) => n + row[3].length, 0);
      const nipped = rows.reduce((n, row) => n + row[5].length, 0);
      const { stones } = lay(id);
      expect(stones.length).toBeGreaterThan(cells);
      expect(stones.length).toBeLessThanOrEqual(cells + nipped);
      expect(stones.length).toBeGreaterThan(cells + nipped * 0.6);
      for (const k of stones) {
        expect(k.pts.length).toBeGreaterThanOrEqual(6);
        expect(k.pts.length % 2).toBe(0);
        expect(k.cell.length).toBeGreaterThanOrEqual(6);
        // In its cell, in the lane.
        expect(k.x).toBeGreaterThan(k.from);
        expect(k.x).toBeLessThan(k.to);
        expect(k.to).toBeGreaterThan(-1);
        expect(k.from).toBeLessThan(MOSAIC.w + 1);
        expect(k.y).toBeGreaterThan(-5);
        expect(k.y).toBeLessThan(MOSAIC.h);
      }
    }
  });

  it("gives each stone its scene's colour, never lighter than it, and a darker joint", () => {
    for (const id of SCENES) {
      const { palette } = sceneOf(id);
      const most = Math.max(
        ...palette.map((hex) =>
          [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0),
        ),
      );
      const { stones } = lay(id);
      const fills = new Set(stones.map((k) => k.fill));
      const joints = new Set(stones.map((k) => k.joint));
      // Four tones of each stone, and one joint for each.
      expect(fills.size).toBeLessThanOrEqual(palette.length * 4);
      expect(joints.size).toBeLessThanOrEqual(palette.length);
      for (const k of stones) {
        expect(light(k.fill)).toBeLessThanOrEqual(most);
        expect(light(k.joint)).toBeLessThan(light(k.fill));
      }
    }
  });

  it("is laid the same from the same dice, and otherwise from others", () => {
    expect(lay("grove", 3)).toEqual(lay("grove", 3));
    expect(lay("grove", 3).stones).not.toEqual(lay("grove", 4).stones);
  });

  it("keeps its stones again by colour, so those at rest go down in a few fills", () => {
    const floor = lay("agora");
    for (const key of ["fill", "joint"] as const) {
      const sorted = key === "fill" ? floor.byFill : floor.byJoint;
      expect(sorted).toHaveLength(floor.stones.length);
      expect(new Set(sorted)).toEqual(new Set(floor.stones));
      sorted.forEach((k, i) => {
        if (i) expect(k[key] >= sorted[i - 1]![key]).toBe(true);
      });
    }
  });
});

describe("a floor set and prised up", () => {
  it("is set from the stylobate up: no stone before 140ms, each over 330ms, and the last down by 1580ms", () => {
    expect(SET_END).toBe(1580);
    for (const id of SCENES) {
      const floor = lay(id);
      for (const k of floor.stones) {
        expect(k.setAt).toBeGreaterThanOrEqual(SET.from);
        expect(k.setAt + SET.each).toBeLessThanOrEqual(SET_END);
        expect(downAt(k, "set", k.setAt)).toBe(0);
        expect(downAt(k, "set", k.setAt + SET.each / 2)).toBeCloseTo(0.5, 9);
        expect(downAt(k, "set", k.setAt + SET.each)).toBeCloseTo(1, 9);
      }
      const when = courses(id, floor).map((stones) => mean(stones.map((k) => k.setAt)));
      expect(when[when.length - 1]! - when[0]!).toBeGreaterThan(SET.span * 0.9);
      when.forEach((at, r) => {
        if (r) expect(at).toBeGreaterThan(when[r - 1]!);
      });
    }
  });

  it("is prised up from the top course down: each stone over 620ms, and the last off by 1150ms", () => {
    expect(LIFT_END).toBe(1150);
    for (const id of SCENES) {
      const floor = lay(id);
      for (const k of floor.stones) {
        expect(k.liftAt).toBeGreaterThanOrEqual(0);
        expect(k.liftAt + LIFT.each).toBeLessThanOrEqual(LIFT_END);
        expect(downAt(k, "lift", k.liftAt)).toBe(1);
        expect(downAt(k, "lift", k.liftAt + LIFT.each)).toBeCloseTo(0, 9);
        // Thrown up and off, the way its side of the lane lies.
        expect(Math.sin(k.angle)).toBeLessThan(0);
        expect(k.dist).toBeGreaterThanOrEqual(34);
      }
      const when = courses(id, floor).map((stones) => mean(stones.map((k) => k.liftAt)));
      expect(when[0]! - when[when.length - 1]!).toBeGreaterThan(LIFT.span * 0.9);
      when.forEach((at, r) => {
        if (r) expect(at).toBeLessThan(when[r - 1]!);
      });
    }
  });

  it("at rest is drawn in a few fills, a joint's colour and a stone's each once, and whole", () => {
    for (const id of SCENES) {
      const floor = lay(id);
      const brush = countingBrush();
      expect(drawFloor(brush.ctx, floor, "shown", 0)).toBe(0);
      const colours = new Set([
        ...floor.stones.map((k) => k.fill),
        ...floor.stones.map((k) => k.joint),
      ]);
      expect(brush.ivories).toEqual(colours);
      expect(brush.filled).toBeLessThanOrEqual(sceneOf(id).palette.length * 5);
      expect(brush.ctx.globalAlpha).toBe(1);
    }
  });

  it("on its way a stone is a fill of its own, over those at rest", () => {
    const floor = lay("temple");
    const rest = countingBrush();
    drawFloor(rest.ctx, floor, "shown", 0);
    for (const [phase, t] of [
      ["set", 700],
      ["lift", 400],
    ] as const) {
      const brush = countingBrush();
      const flying = drawFloor(brush.ctx, floor, phase, t);
      const on = floor.stones.filter((k) => {
        const q = downAt(k, phase, t);
        return q > 0 && q < 1;
      });
      expect(flying).toBeGreaterThan(500);
      expect(flying).toBeLessThanOrEqual(on.length);
      expect(brush.filled).toBeGreaterThan(flying);
      expect(brush.filled).toBeLessThanOrEqual(flying + rest.filled);
      expect(brush.ctx.globalAlpha).toBe(1); // and the brush is left as it was found
    }
  });

  it("nothing is drawn before the first stone is set, or once the last is off; set, it is the floor at rest", () => {
    const floor = lay("grove");
    const fills = (phase: "set" | "shown" | "lift", t: number): number => {
      const brush = countingBrush();
      drawFloor(brush.ctx, floor, phase, t);
      return brush.filled;
    };
    expect(fills("set", 0)).toBe(0);
    expect(fills("set", SET.from)).toBe(0);
    expect(fills("set", SET_END)).toBe(fills("shown", 0));
    expect(fills("lift", 0)).toBe(fills("shown", 0));
    expect(fills("lift", LIFT_END)).toBe(0);
  });
});

describe("a narrower lane", () => {
  it("shows the scene's middle: the stones wholly beyond it are left out, and no other", () => {
    const floor = lay("agora");
    const shown = cropFloor(floor, 48, 650);
    expect(shown.id).toBe("agora");
    expect(shown.stones.length).toBeLessThan(floor.stones.length);
    expect(shown.stones.length).toBeGreaterThan(floor.stones.length * 0.8);
    expect(shown.stones).toEqual(floor.stones.filter((k) => k.to >= 47 && k.from <= 651));
    expect(new Set(shown.byFill)).toEqual(new Set(shown.stones));
    expect(new Set(shown.byJoint)).toEqual(new Set(shown.stones));
  });

  it("the lane it was cut for shows all of it", () => {
    const floor = lay("temple");
    expect(cropFloor(floor, 0, MOSAIC.w)).toBe(floor);
  });
});
