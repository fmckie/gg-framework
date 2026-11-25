import { describe, expect, it } from "vitest";
import { CAST } from "./cast";
import { countingBrush } from "./fixtures";
import { rng } from "./floor";
import { GODS, type GodId } from "./gods";
import { cutTesserae, dimmed, drawTesserae, flightOf, UNSET, type Tessera } from "./tesserae";

const ids = Object.keys(GODS) as GodId[];
const H = 104; // the floor above the stylobate
const TOP = 4; // a cell's top on it
const cut = (id: GodId, pose: "speak" | "stand", seed = 3): Tessera[] =>
  cutTesserae(CAST.gods[id].tiles[pose], rng(seed), H);
/** A pose's stones by course: the feet's first, the crown's last. */
function courses(id: GodId, pose: "speak" | "stand"): Tessera[][] {
  const stones = cut(id, pose);
  let from = 0;
  return CAST.gods[id].tiles[pose].map((course) => {
    const n = course[4].replace(/-/g, "").length;
    from += n;
    return stones.slice(from - n, from);
  });
}

describe("a pose cut into tesserae", () => {
  it("is a stone for every one in the cast's courses, each in its course and its ivory", () => {
    for (const id of ids) {
      for (const pose of ["speak", "stand"] as const) {
        const rows = CAST.gods[id].tiles[pose];
        const byCourse = courses(id, pose);
        expect(byCourse.flat()).toHaveLength(cut(id, pose).length);
        byCourse.forEach((stones, r) => {
          const [y0, y1, x0, w, chars] = rows[r]!;
          expect(stones).toHaveLength(chars.replace(/-/g, "").length);
          const placed = [...chars].flatMap((ch, i) => (ch === "-" ? [] : [[ch, i] as const]));
          stones.forEach((stone, i) => {
            const [ch, at] = placed[i]!;
            expect(stone.k).toBe(parseInt(ch, 36));
            expect(stone.cx).toBeCloseTo(x0 / 10 + (at + 0.5) * (w / 100), 9);
            expect(stone.cy).toBeCloseTo((y0 + y1) / 20, 9);
            // Four corners, a joint's width inside its bed and a little out of true.
            expect(stone.pts).toHaveLength(8);
            for (let p = 0; p < 8; p += 2) {
              expect(Math.abs(stone.pts[p]!)).toBeLessThanOrEqual(w / 200 - 0.3 + 0.2 + 1e-9);
              expect(Math.abs(stone.pts[p + 1]!)).toBeLessThanOrEqual(
                (y1 - y0) / 20 - 0.3 + 0.2 + 1e-9,
              );
            }
          });
        });
      }
    }
  });

  it("is cut the same from the same dice, and otherwise from others", () => {
    expect(cut("athena", "speak", 3)).toEqual(cut("athena", "speak", 3));
    expect(cut("athena", "speak", 3)).not.toEqual(cut("athena", "speak", 4));
  });
});

describe("a god set from its tesserae", () => {
  it("from the feet up: a course's stones begin after those of the course under it could, the crown's last", () => {
    const byCourse = courses("hermes", "speak");
    const n = byCourse.length;
    byCourse.forEach((stones, r) => {
      const up = r / (n - 1);
      for (const stone of stones) {
        expect(stone.setAt).toBeGreaterThanOrEqual(40 + up * 620);
        expect(stone.setAt).toBeLessThan(40 + up * 620 + 150);
      }
    });
    expect(Math.max(...byCourse[0]!.map((stone) => stone.setAt))).toBeLessThan(
      Math.min(...byCourse[n - 1]!.map((stone) => stone.setAt)),
    );
  });

  it("each stone comes in over 340ms from a little way off above, larger and turned, and lies in its bed", () => {
    for (const stone of cut("hermes", "speak")) {
      expect(flightOf(stone, "set", stone.setAt, TOP)).toBeNull(); // not yet
      const mid = flightOf(stone, "set", stone.setAt + 170, TOP)!;
      expect(mid.dy).toBeLessThan(0);
      expect(Math.hypot(mid.dx, mid.dy)).toBeLessThanOrEqual(Math.hypot(15, 34) / 8 + 1e-9);
      expect(mid.s).toBeCloseTo(1 + 0.55 / 8, 9); // eased out: an eighth of the way left, half way in
      expect(mid.a).toBe(1); // whole from 119ms in
      const down = flightOf(stone, "set", stone.setAt + 340, TOP)!;
      expect(Math.hypot(down.dx, down.dy)).toBe(0);
      expect(down).toMatchObject({ s: 1, rot: stone.rot, a: 1 });
    }
  });

  it("every stone of every god is in its bed 1150ms in, when the carved figure begins to show", () => {
    for (const id of ids)
      for (const stone of cut(id, "speak")) {
        const down = flightOf(stone, "set", 1150, TOP)!;
        expect(Math.hypot(down.dx, down.dy)).toBe(0);
        expect(down).toMatchObject({ s: 1, rot: stone.rot, a: 1 });
      }
  });

  it("at rest they show as far as they are told, and are not drawn once the figure is whole", () => {
    const [stone] = cut("athena", "speak");
    expect(flightOf(stone!, "rest", 1275, TOP, 0.5)).toEqual({
      dx: 0,
      dy: 0,
      s: 1,
      rot: stone!.rot,
      a: 0.5,
    });
    expect(flightOf(stone!, "rest", 1400, TOP, 0)).toBeNull();
  });
});

describe("a god going back to its tesserae", () => {
  it("lifted: they show as the figure gives way over 140ms, and are prised up from the crown down", () => {
    const byCourse = courses("argus", "stand");
    const n = byCourse.length;
    for (const stone of byCourse.flat()) {
      expect(flightOf(stone, "lift", 0, TOP)).toBeNull();
      expect(flightOf(stone, "lift", UNSET / 2, TOP)).toEqual({
        dx: 0,
        dy: 0,
        s: 1,
        rot: stone.rot,
        a: 0.5,
      });
      expect(stone.liftAt).toBeGreaterThanOrEqual(UNSET);
    }
    expect(Math.max(...byCourse[n - 1]!.map((stone) => stone.liftAt))).toBeLessThan(
      Math.min(...byCourse[0]!.map((stone) => stone.liftAt)),
    );
  });

  it("lifted: each is thrown up and out over 620ms, smaller as it goes, and is gone; all of them by 1300ms", () => {
    for (const id of ids) {
      for (const stone of cut(id, "stand")) {
        const mid = flightOf(stone, "lift", stone.liftAt + 310, TOP)!;
        expect(mid.dy).toBeLessThan(0); // up: never more than 52° off it
        expect(mid.s).toBeLessThan(1.2);
        expect(Math.hypot(mid.dx, mid.dy)).toBeLessThan(92 + 1.6);
        expect(flightOf(stone, "lift", stone.liftAt + 620, TOP)).toBeNull();
        expect(flightOf(stone, "lift", 1300, TOP)).toBeNull();
      }
    }
  });

  it("fallen: each drops where it is, no further than the floor, lies there a moment and is gone; all of them by 1250ms", () => {
    for (const id of ids) {
      for (const stone of cut(id, "stand")) {
        expect(stone.ground).toBeGreaterThan(H - 3.2 - 1e-9);
        expect(stone.ground).toBeLessThanOrEqual(H - 0.6);
        expect(flightOf(stone, "fall", stone.fallAt, TOP)).toMatchObject({ dx: 0, dy: 0, a: 1 });
        // The feet's lowest already lie on it.
        const drop = Math.max(0, stone.ground - (TOP + stone.cy));
        let last = 0;
        for (let u = stone.fallAt; u <= 1250; u += 10) {
          const f = flightOf(stone, "fall", u, TOP);
          if (!f) break;
          expect(f.dy).toBeGreaterThanOrEqual(last); // down, and never back up
          expect(f.dy).toBeLessThanOrEqual(drop + 1e-9); // and not through the floor
          last = f.dy;
        }
        expect(last).toBeCloseTo(drop, 6); // it reached the floor
        expect(flightOf(stone, "fall", 1250, TOP)).toBeNull();
      }
    }
  });

  it("fallen from higher up, as the one who flies never is: the drop is measured from where the cell stands", () => {
    const [stone] = cut("nike", "stand");
    const low = flightOf(stone!, "fall", stone!.fallAt + 200, TOP)!;
    const high = flightOf(stone!, "fall", stone!.fallAt + 200, TOP - 8)!;
    expect(high.dy).toBeGreaterThanOrEqual(low.dy);
  });
});

describe("a failed or stopped god's ivories", () => {
  it("are the figure's own dimming worked on each: greyed, darker, flatter", () => {
    expect(dimmed("#ffffff")).toBe("rgb(184 184 184)");
    expect(dimmed("#000000")).toBe("rgb(10 10 10)");
    expect(dimmed("#ff0000")).toBe("rgb(102 32 32)");
  });

  it("are never lighter than the god's own, stone for stone", () => {
    const light = (rgb: readonly number[]): number =>
      0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
    for (const id of ids) {
      for (const hex of CAST.gods[id].tiles.palette) {
        const own = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const dim = dimmed(hex).slice(4, -1).split(" ").map(Number);
        expect(dim).toHaveLength(3);
        if (light(own) > 24) expect(light(dim)).toBeLessThan(light(own));
      }
    }
  });
});

describe("drawing a god's tesserae", () => {
  const at = { mode: "rest", u: 0, a: 1, x: 100, y: TOP, dir: 1, axis: 66 } as const;

  it("fills every stone that shows, in its own ivory, and leaves the brush whole", () => {
    const stones = cut("themis", "speak");
    const brush = countingBrush();
    const palette = CAST.gods.themis.tiles.palette;
    expect(drawTesserae(brush.ctx, stones, palette, at)).toBe(stones.length);
    expect(brush.stones).toBe(stones.length);
    expect([...brush.ivories].sort()).toEqual(
      [...new Set(stones.map((stone) => palette[stone.k]!))].sort(),
    );
    expect(brush.ctx.globalAlpha).toBe(1);
    // None before the first has begun its flight.
    expect(drawTesserae(brush.ctx, stones, palette, { ...at, mode: "set", u: 40 })).toBe(0);
  });

  it("draws each where its god's cell stands, and mirrored about the head line when the god faces left", () => {
    const [stone] = cut("themis", "speak");
    const xs = (dir: number): number[] => {
      const seen: number[] = [];
      const brush = countingBrush();
      const ctx = Object.assign(brush.ctx, {
        moveTo: (x: number) => void seen.push(x),
        lineTo: (x: number) => void seen.push(x),
      });
      drawTesserae(ctx, [stone!], ["#000000"], { ...at, dir });
      return seen;
    };
    const mean = (list: readonly number[]): number =>
      list.reduce((sum, x) => sum + x, 0) / list.length;
    const right = xs(1);
    const left = xs(-1);
    expect(right).toHaveLength(4);
    // Its corners are out of true by 0.2px at most, so their middle is its own within that.
    expect(mean(right)).toBeCloseTo(100 + stone!.cx, 0);
    expect(mean(left)).toBeCloseTo(100 + 66 - stone!.cx, 0);
    expect(mean(left) - (100 + 33)).toBeCloseTo(100 + 33 - mean(right), 9);
  });
});
