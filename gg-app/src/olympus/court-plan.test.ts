import { describe, expect, it } from "vitest";
import { CAST } from "./cast";
import {
  climb,
  COURT,
  freeSlot,
  LEVEL_SCENES,
  placeFor,
  planCourt,
  reroute,
  route,
  routeAt,
  routeMs,
  stairProfile,
  ZONES,
} from "./court-plan";
import { MOSAIC } from "./mosaic";

const xs = (slots: readonly { x: number }[]): number[] => slots.map((s) => s.x);

describe("the courtyard's plan", () => {
  it("is cut to the lane's own measures", () => {
    expect(COURT.floor).toBe(MOSAIC.h);
    expect(COURT.cell).toEqual(CAST.cell);
    expect(COURT.terrace).toBe(COURT.floor + COURT.tread);
    expect(COURT.height).toBe(3 * COURT.terrace);
    expect(COURT.stair.steps * COURT.stair.rise).toBe(COURT.terrace);
    expect(LEVEL_SCENES.map((id) => MOSAIC.scenes.some((s) => s.id === id))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("at the session's full column: five slots a half-terrace and six round the hearth", () => {
    const plan = planCourt(698);
    expect(plan.hearth).toBe(349);
    expect(plan.stairs).toEqual([
      { lower: 0, dir: 1, approach: 583, foot: 592, head: 664 },
      { lower: 1, dir: -1, approach: 115, foot: 106, head: 34 },
    ]);
    // Each half's slots in the order they are taken: the middle, the ends, then between.
    expect(xs(plan.zones.make.slots)).toEqual([170, 48, 293, 109, 231]);
    expect(xs(plan.zones.run.slots)).toEqual([431, 309, 553, 370, 492]);
    expect(xs(plan.zones.look.slots)).toEqual([258, 145, 370, 201, 314]);
    expect(xs(plan.zones.web.slots)).toEqual([499, 386, 611, 442, 555]);
    expect(xs(plan.zones.temple.slots)).toEqual([303, 395, 251, 447, 199, 499]);
    // The halves of a terrace face each other, and the temple faces its hearth.
    expect(plan.zones.make.slots.every((s) => s.face === 1)).toBe(true);
    expect(plan.zones.web.slots.every((s) => s.face === -1)).toBe(true);
    expect(plan.zones.temple.slots.map((s) => s.face)).toEqual([1, -1, 1, -1, 1, -1]);
    expect(ZONES.map((id) => plan.zones[id].level)).toEqual([0, 0, 1, 1, 2]);
  });

  it("in a narrow window: fewer slots, by proportion, and every one inside the stage and off the stairs", () => {
    for (const width of [698, 560, 462, 380]) {
      const plan = planCourt(width);
      const [up, top] = plan.stairs;
      for (const id of ZONES) {
        const zone = plan.zones[id];
        expect(zone.slots.length).toBeGreaterThan(0);
        const sorted = xs(zone.slots).sort((a, b) => a - b);
        expect(sorted[0]).toBeGreaterThanOrEqual(zone.level === 0 ? COURT.edge : top.head);
        expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(width - COURT.edge);
        const gaps = sorted.slice(1).map((x, i) => x - sorted[i]!);
        const least = id === "temple" ? COURT.temple.pitch : COURT.pitch;
        expect(Math.min(least, ...gaps)).toBe(least);
      }
      expect(Math.max(...xs(plan.zones.run.slots))).toBeLessThanOrEqual(up.approach - COURT.clear);
      expect(Math.min(...xs(plan.zones.look.slots))).toBeGreaterThanOrEqual(
        top.approach + COURT.clear,
      );
      // A name under the last slot is clear of the top steps that cross its terrace's step.
      const crossing = 7 * COURT.stair.tread;
      expect(Math.max(...xs(plan.zones.web.slots)) + 40).toBeLessThanOrEqual(up.foot + crossing);
      expect(Math.min(...xs(plan.zones.temple.slots)) - 26).toBeGreaterThanOrEqual(
        top.foot - crossing,
      );
    }
    const narrow = planCourt(462);
    expect(narrow.zones.make.slots).toHaveLength(3);
    expect(narrow.zones.web.slots).toHaveLength(2);
    expect(narrow.zones.temple.slots).toHaveLength(6);
    expect(planCourt(380).zones.temple.slots).toHaveLength(4);
  });

  it("puts a worker where its kind of work is done, and leaves a thinker where it is", () => {
    expect(placeFor("working", "look", null)).toBe("look");
    expect(placeFor("working", "web", "make")).toBe("web");
    expect(placeFor("working", "make", "look")).toBe("make");
    expect(placeFor("working", "run", "look")).toBe("run");
    expect(placeFor("working", "think", "web")).toBe("web");
    // New, with no tool yet: by the gate.
    expect(placeFor("working", "think", null)).toBe("make");
    expect(placeFor("idle", "run", "look")).toBe("look");
    expect(placeFor("done", "run", "look")).toBe("temple");
    expect(placeFor("failed", "run", "look")).toBe("look");
    // Ended before it was ever seen: where its last tool's work is done.
    expect(placeFor("stopped", "think", null)).toBe("make");
    expect(placeFor("failed", "web", null)).toBe("web");
  });

  it("gives out a zone's slots in order, and none when it is full", () => {
    const zone = planCourt(698).zones.look;
    expect(freeSlot(zone, new Set())).toBe(0);
    expect(freeSlot(zone, new Set([0, 1, 3]))).toBe(2);
    expect(freeSlot(zone, new Set([0, 1, 2, 3, 4]))).toBeNull();
  });
});

describe("the stairs", () => {
  const plan = planCourt(698);
  const [up, top] = plan.stairs;

  it("rise a terrace in nine steps, from the foot to the head", () => {
    const profile = stairProfile(up);
    expect(profile[0]).toEqual([592, 0]);
    expect(profile[1]).toEqual([592, 14]);
    expect(profile[profile.length - 1]).toEqual([664, 126]);
    expect(stairProfile(top)[profile.length - 1]).toEqual([34, 126]);
  });

  it("carry a walker's feet from one floor to the next, never down on the way up", () => {
    expect(climb(up, up.approach)).toBe(0);
    expect(climb(up, up.head)).toBe(COURT.terrace);
    expect(climb(top, top.approach)).toBe(0);
    expect(climb(top, top.head)).toBe(COURT.terrace);
    expect(climb(up, up.approach - 50)).toBe(0);
    expect(climb(up, up.head + 50)).toBe(COURT.terrace);
    let last = 0;
    for (let x = up.approach; x <= up.head; x += 0.5) {
      const h = climb(up, x);
      expect(h).toBeGreaterThanOrEqual(last);
      // Never under the step it is over.
      expect(h).toBeGreaterThanOrEqual(
        x < up.foot ? 0 : Math.floor((x - up.foot) / COURT.stair.tread) * COURT.stair.rise,
      );
      last = h;
    }
  });
});

describe("the way from one spot to another", () => {
  const plan = planCourt(698);
  const [up, top] = plan.stairs;
  const pace = 100 * COURT.pace;

  it("along one terrace is one walk, as long as the god's pace makes it", () => {
    const legs = route(plan, { level: 0, x: 100 }, { level: 0, x: 420 }, 100);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ kind: "walk", x0: 100, x1: 420, from: 0, to: 0 });
    expect(legs[0]!.ms).toBeCloseTo((320 / pace) * 1000);
    expect(route(plan, { level: 1, x: 200 }, { level: 1, x: 200 }, 100)).toEqual([]);
    // A slower god takes longer over the same ground.
    expect(routeMs(route(plan, { level: 0, x: 100 }, { level: 0, x: 420 }, 50))).toBeCloseTo(
      2 * legs[0]!.ms,
    );
  });

  it("from the agora to the temple zig-zags: right to the first flight, left to the second", () => {
    const legs = route(plan, { level: 0, x: 170 }, { level: 2, x: 303 }, 100);
    expect(legs.map((l) => [l.kind, l.x0, l.x1, l.from, l.to])).toEqual([
      ["walk", 170, up.approach, 0, 0],
      ["stair", up.approach, up.head, 0, 1],
      ["walk", up.head, top.approach, 1, 1],
      ["stair", top.approach, top.head, 1, 2],
      ["walk", top.head, 303, 2, 2],
    ]);
    // A flight is climbed slower than the floor is walked.
    const flight = Math.hypot(81, 126);
    expect(legs[1]!.ms).toBeCloseTo((flight / (pace * COURT.stair.pace)) * 1000);
    expect(legs[3]!.ms).toBe(legs[1]!.ms);
  });

  it("and back down the same stairs", () => {
    const legs = route(plan, { level: 2, x: 303 }, { level: 0, x: 170 }, 100);
    expect(legs.map((l) => [l.kind, l.x0, l.x1, l.from, l.to])).toEqual([
      ["walk", 303, top.head, 2, 2],
      ["stair", top.head, top.approach, 2, 1],
      ["walk", top.approach, up.head, 1, 1],
      ["stair", up.head, up.approach, 1, 0],
      ["walk", up.approach, 170, 0, 0],
    ]);
  });

  it("is one unbroken line: where a walker is follows from the time alone", () => {
    const legs = route(plan, { level: 0, x: 170 }, { level: 2, x: 303 }, 100);
    const total = routeMs(legs);
    expect(routeAt(legs, 0)).toMatchObject({ x: 170, lift: 0, dir: 1, leg: 0, over: false });
    expect(routeAt(legs, total)).toMatchObject({ x: 303, lift: 252, leg: 4, over: true });
    expect(routeAt(legs, total + 5000)).toMatchObject({ x: 303, lift: 252, over: true });
    expect(routeAt([], 100)).toBeNull();
    let was = routeAt(legs, 0)!;
    for (let t = 0; t <= total; t += 16) {
      const now = routeAt(legs, t)!;
      // Never more than a step's worth in a frame, and never down on the way up.
      expect(Math.abs(now.x - was.x)).toBeLessThan(4);
      expect(now.lift - was.lift).toBeGreaterThanOrEqual(0);
      expect(now.lift - was.lift).toBeLessThan(8);
      was = now;
    }
    // On the second terrace it walks left, to the second flight.
    const mid = legs[0]!.ms + legs[1]!.ms + legs[2]!.ms / 2;
    expect(routeAt(legs, mid)).toMatchObject({ lift: 126, dir: -1, leg: 2, on: "walk" });
  });

  it("sent elsewhere on a terrace it turns where it is; on a flight, at the flight's end", () => {
    const legs = route(plan, { level: 0, x: 170 }, { level: 1, x: 522 }, 100);
    const walking = reroute(plan, legs, 500, { level: 0, x: 48 }, 100);
    expect(walking.map((l) => [l.kind, l.x0, l.x1])).toEqual([["walk", 250, 48]]);
    const half = legs[0]!.ms + legs[1]!.ms / 2;
    const climbing = reroute(plan, legs, half, { level: 0, x: 48 }, 100);
    expect(climbing.map((l) => [l.kind, l.from, l.to])).toEqual([
      ["stair", 0, 1],
      ["stair", 1, 0],
      ["walk", 0, 0],
    ]);
    expect(climbing[0]!.ms).toBeCloseTo(legs[1]!.ms / 2);
    // It goes on from where it was.
    expect(routeAt(climbing, 0)).toMatchObject({
      x: routeAt(legs, half)!.x,
      lift: routeAt(legs, half)!.lift,
    });
  });
});
