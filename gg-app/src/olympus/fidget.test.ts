import { describe, expect, it, vi } from "vitest";
import { CAST, type Fidget, type FidgetMove, type Skill } from "./cast";
import { deal, fidgetAt, keyed, nextAt, shown, STILL, type Dealt } from "./fidget";
import { rng } from "./floor";
import { GODS, type GodId } from "./gods";

// All CPU work, nothing waits: the cast's every pose takes 1s here, 5.7s on CI's runners.
vi.setConfig({ testTimeout: 15_000 });

const ids = Object.keys(GODS) as GodId[];
const move = (keys: FidgetMove["keys"], ease = 0, more: Partial<FidgetMove> = {}): FidgetMove => ({
  keys,
  ease,
  w: 1,
  part: null,
  pivot: [10, 100],
  end: keys[keys.length - 1]![0] + ease / 500,
  ...more,
});
/** Every bar dealt by dice seeded from the bar alone, kept as the lane keeps them. */
function dealer(f: Fidget, seed = 1): (n: number) => Dealt | null {
  const bars = new Map<number, Dealt | null>();
  return (n) => {
    if (!bars.has(n)) bars.set(n, deal(f, n, rng(seed * 7919 + n)));
    return bars.get(n)!;
  };
}

describe("a gesture", () => {
  it("is at rest before its first key, then in the state of the last key reached", () => {
    const m = move([
      [1, { rot: 2 }],
      [2, {}],
    ]);
    expect(keyed(m, 0.99, 500, false)).toBeNull();
    expect(keyed(m, 1, 500, false)).toEqual({ now: { rot: 2 }, was: {}, k: 1 });
    expect(keyed(m, 1.99, 500, false)).toEqual({ now: { rot: 2 }, was: {}, k: 1 });
    expect(keyed(m, 2, 500, false)).toEqual({ now: {}, was: { rot: 2 }, k: 1 });
    expect(keyed(m, 99, 500, false)).toEqual({ now: {}, was: { rot: 2 }, k: 1 });
  });

  it("eases into each state over its own time, slow at both ends; with none it is a cut", () => {
    const m = move([[0, { rot: 2 }]], 400);
    expect(keyed(m, 0, 500, false)!.k).toBe(0);
    expect(keyed(m, 0.2, 500, false)!.k).toBeCloseTo(0.25 * 0.25 * (3 - 0.5), 9); // 100 of 400ms
    expect(keyed(m, 0.4, 500, false)!.k).toBeCloseTo(0.5, 9);
    expect(keyed(m, 0.8, 500, false)!.k).toBe(1);
    expect(keyed(m, 5, 500, false)!.k).toBe(1);
  });

  it("a rhythm come round again starts as its last key left it", () => {
    const m = move([
      [0, { lift: 8 }],
      [1, { lift: 6 }],
    ]);
    expect(keyed(m, 0, 500, true)).toEqual({ now: { lift: 8 }, was: { lift: 6 }, k: 1 });
    const late = move([
      [1, { rot: 1 }],
      [2, {}],
    ]);
    expect(keyed(late, 0.5, 500, true)).toEqual({ now: {}, was: {}, k: 1 });
  });

  it("a key falls on its beat however the division rounds", () => {
    const m = move([[3, { turn: true }]]);
    expect(keyed(m, (1680 - 0.0000001) / 560, 560, false)).not.toBeNull();
  });
});

describe("a bar of idling", () => {
  const f: Fidget = {
    bar: 4,
    idle: true,
    rest: 1,
    cut: null,
    moves: [
      move(
        [
          [0, { rot: 1 }],
          [1, {}],
        ],
        250,
        { w: 2 },
      ),
      move(
        [
          [0, { rot: 1 }],
          [2.5, {}],
        ],
        250,
        { w: 1 },
      ),
    ],
  };

  it("is dealt a move by its weight against the others and the pose's rest, or nothing", () => {
    const dice = rng(3);
    const dealtBars = Array.from({ length: 4000 }, (_, n) => deal(f, n, dice));
    const share = (m: FidgetMove | null): number =>
      dealtBars.filter((d) => (d?.move ?? null) === m).length / dealtBars.length;
    expect(share(f.moves[0]!)).toBeCloseTo(0.5, 1);
    expect(share(f.moves[1]!)).toBeCloseTo(0.25, 1);
    expect(share(null)).toBeCloseTo(0.25, 1);
  });

  it("starts on a whole beat that leaves the move room to end inside its bar", () => {
    // A bar that is no whole number of beats, as a trait's pace makes them.
    const odd = { ...f, bar: 3.6 };
    const dice = rng(11);
    const starts = new Set<number>();
    let dropped = 0;
    for (let n = 0; n < 500; n++) {
      const d = deal(odd, n, dice);
      if (!d) continue;
      expect(Number.isInteger(d.start)).toBe(true);
      expect(d.start).toBeGreaterThanOrEqual(n * odd.bar - 1e-6);
      expect(d.start + d.move.end).toBeLessThanOrEqual((n + 1) * odd.bar + 1e-6);
      starts.add(d.start - Math.ceil(n * odd.bar - 1e-6));
    }
    expect(starts.size).toBeGreaterThan(1); // not always on the bar's first whole beat
    // With no such beat in the bar, the move is not played in it: the pose rests.
    const tight = { ...odd, rest: 0, moves: [odd.moves[1]!] };
    for (let n = 0; n < 50; n++) if (!deal(tight, n, dice)) dropped += 1;
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThan(50);
  });

  it("the same dice deal the same bar", () => {
    expect(deal(f, 4, rng(99))).toEqual(deal(f, 4, rng(99)));
  });
});

describe("what a fidget writes", () => {
  it("is a shift, then a turn about its pivot from the box's own corner", () => {
    const at = { pivot: [49.5, 100] as const, part: "", gone: false, frame: "", turn: false };
    expect(shown({ ...at, dx: 0, dy: 0, rot: 1.5, lift: null } as never, 0).tx).toBe(
      "translate(49.5px, 100px) rotate(1.500deg) translate(-49.5px, -100px)",
    );
    expect(shown({ ...at, dx: -2, dy: 0, rot: 0, lift: null } as never, 0).tx).toBe(
      "translate(-2.00px, 0.00px)",
    );
    expect(shown({ ...at, dx: 0, dy: -1, rot: 1, lift: null } as never, 0).tx).toBe(
      "translate(0.00px, -1.00px) translate(49.5px, 100px) rotate(1.000deg) translate(-49.5px, -100px)",
    );
  });

  it("is nothing at all at rest: a figure not shifted, turned, about-faced or in its second frame", () => {
    const rest = {
      dx: 0,
      dy: 0,
      rot: 0,
      pivot: null,
      part: "",
      gone: false,
      frame: "",
      turn: false,
    } as const;
    expect(shown(null, 0)).toBe(STILL);
    expect(shown({ ...rest, lift: null }, 0)).toBe(STILL);
    expect(shown({ ...rest, lift: 8 }, 8)).toBe(STILL); // the one who flies, at her lift
    expect(shown({ ...rest, lift: 6 }, 8)).toMatchObject({ tx: "", lift: 6 });
    expect(shown({ ...rest, frame: "b", lift: null }, 0)).toMatchObject({ tx: "", frame: "b" });
    expect(shown({ ...rest, turn: true, lift: null }, 0)).toMatchObject({ tx: "", turn: true });
  });

  it("a part is moved by its own transform, the figure untouched; gone, it is nowhere", () => {
    const part = {
      dx: 0,
      dy: 0,
      rot: 0,
      pivot: [47.9, 20.4],
      part: "scales",
      frame: "",
      turn: false,
      lift: null,
    } as const;
    expect(shown({ ...part, rot: 5, gone: false }, 0)).toEqual({
      ...STILL,
      part: "scales",
      ptx: "translate(47.9px, 20.4px) rotate(5.000deg) translate(-47.9px, -20.4px)",
    });
    expect(shown({ ...part, gone: true }, 0)).toEqual({
      ...STILL,
      part: "scales",
      ptx: "scale(0)",
    });
    expect(shown({ ...part, gone: false }, 0)).toBe(STILL); // back where it hangs: only the pose shows
  });
});

describe("when a pose will next be drawn otherwise", () => {
  it("is now while a figure eases, then the next key; never once a move played on the cut is over", () => {
    const f: Fidget = {
      bar: 0,
      idle: false,
      rest: 0,
      cut: move(
        [
          [1, { rot: 1 }],
          [3, {}],
        ],
        250,
      ),
      moves: [],
    };
    const none = (): null => null;
    expect(nextAt(f, 0, 500, none)).toBe(1);
    expect(nextAt(f, 1, 500, none)).toBe(1); // easing in: every frame
    expect(nextAt(f, 1.49, 500, none)).toBe(1.49);
    expect(nextAt(f, 1.5, 500, none)).toBe(3); // held: nothing until the next key
    expect(nextAt(f, 3.2, 500, none)).toBe(3.2);
    expect(nextAt(f, 3.5, 500, none)).toBe(Infinity);
  });

  it("a rhythm's next key may be in the next bar", () => {
    const f: Fidget = {
      bar: 4,
      idle: false,
      rest: 0,
      cut: null,
      moves: [
        move([
          [0, { frame: "b" }],
          [0.25, {}],
        ]),
      ],
    };
    const none = (): null => null;
    expect(nextAt(f, 0, 560, none)).toBe(0.25);
    expect(nextAt(f, 0.25, 560, none)).toBe(4);
    expect(nextAt(f, 7.9, 560, none)).toBe(8);
    expect(nextAt(f, 8, 560, none)).toBe(8.25);
  });

  it("never sleeps through a change: for every pose of the cast, nothing is drawn otherwise before the moment it names", () => {
    let slept = 0;
    let woke = 0;
    for (const id of ids) {
      const god = CAST.gods[id];
      for (const [pose, f] of Object.entries(god.fid) as [Skill, Fidget][]) {
        const lift = god.lift[pose] ?? 0;
        const dealt = dealer(f, id.length + pose.length);
        const look = (b: number): string =>
          JSON.stringify(shown(fidgetAt(f, b, god.step, lift, dealt), lift));
        let b = 0;
        for (let n = 0; n < 400 && b < 200; n++) {
          const next = nextAt(f, b, god.step, dealt);
          if (next <= b) {
            b += 16 / god.step; // easing: a frame, as a window gives them
            continue;
          }
          if (next === Infinity) break;
          // Asleep from here to there: looked at every 5ms, it is as it was.
          const was = look(b);
          for (let at = b + 5 / god.step; at < next - 1e-6; at += 5 / god.step) {
            expect(`${id} ${pose} ${look(at)}`).toBe(`${id} ${pose} ${was}`);
            slept += 1;
          }
          b = next;
          woke += 1;
        }
      }
    }
    expect(slept).toBeGreaterThan(10_000);
    expect(woke).toBeGreaterThan(500);
  });
});
