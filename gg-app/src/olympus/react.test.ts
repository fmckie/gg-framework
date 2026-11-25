import { describe, expect, it } from "vitest";
import type { Fidget, NoticeOf } from "./cast";
import { fidgetAt, shifted, STILL, type FidgetAt } from "./fidget";
import { armed, begun, hushUntil, over, played, quarter, TURNED, type Reaction } from "./react";

const NT: NoticeOf = { front: [50, 100], back: [10, 100], lean: 1.5, turn: true };
const STIFF: NoticeOf = { ...NT, turn: false };
const turnOf = (pivot: readonly [number, number], deg: number): string =>
  `translate(${pivot[0]}px, ${pivot[1]}px) rotate(${deg.toFixed(3)}deg) translate(${-pivot[0]}px, ${-pivot[1]}px)`;

/** A notice of a finish, begun at 1000 on a beat of 600ms: two beats, easing over half a beat. */
function noticed(front: boolean, nt = NT, from: FidgetAt | null = null): Reaction {
  const r = armed("other", "done", 300, 800, 1500, 2, undefined);
  begun(r, 1000, 400, front, nt, 0.5, 600, from);
  return r;
}

describe("a reaction's beat", () => {
  it("begins on the god's own quarter-beat: the first at or after a moment, counted from when it took its place", () => {
    // A beat of 600ms from 1000: quarters at 1000, 1150, 1300.
    expect(quarter(1000, 600, 1000)).toBe(1000);
    expect(quarter(1000, 600, 1001)).toBe(1150);
    expect(quarter(1000, 600, 1150)).toBe(1150);
    expect(quarter(1000, 600, 1150.5)).toBe(1300);
    expect(quarter(37, 360, 400)).toBe(37 + 5 * 90);
  });

  it("is armed with the latest it may begin and its beats: the table's, or the crown's own", () => {
    const glance = armed("other", "fail", 300, 800, 1500, 3, undefined);
    expect(glance).toMatchObject({ of: "other", kind: "fail", x: 300, at: 800, crown: false });
    expect(glance).toMatchObject({ late: 2300, beats: 3, start: null, how: null, off: false });
    const crown = armed("other", "done", 300, 800, 1500, 2, { late: 3000, beats: 4, at: [11, 67] });
    expect(crown).toMatchObject({ crown: true, late: 3800, beats: 4, start: null });
  });
});

describe("how a god reacts", () => {
  it("to what is in front of it, a glance; behind it, a turn to face where its pose may turn, else a glance back", () => {
    expect(noticed(true)).toMatchObject({ how: "glance", turn: false, start: 1000, shownAt: 400 });
    expect(noticed(false)).toMatchObject({ how: "turn", turn: true, move: null });
    expect(noticed(false, STIFF)).toMatchObject({ how: "back", turn: false });
    // A lean is about the floor under its front; back, about the floor under its heel, the other way.
    expect(noticed(true).move).toMatchObject({ pivot: [50, 100], ease: 300 });
    expect(noticed(true).move!.keys).toEqual([
      [0, { rot: 1.5 }],
      [1.5, {}],
    ]);
    expect(noticed(false, STIFF).move).toMatchObject({ pivot: [10, 100] });
    expect(noticed(false, STIFF).move!.keys[0]).toEqual([0, { rot: -1.5 }]);
  });

  it("the crown faces the one it is for, turned about if that is behind, whatever the pose may do", () => {
    const crown = (front: boolean): Reaction => {
      const r = armed("other", "done", 300, 800, 1500, 2, { late: 3000, beats: 4, at: [11, 67] });
      begun(r, 1000, 400, front, STIFF, 0.5, 360, null);
      return r;
    };
    expect(crown(true)).toMatchObject({ how: "crown", turn: false, move: null });
    expect(crown(false)).toMatchObject({ how: "crown", turn: true, move: null });
  });
});

describe("what a reaction shows at a moment", () => {
  it("a glance leans in over half a beat, is held, and eases back: frames only while it eases", () => {
    const r = noticed(true);
    expect(played(r, 999, 600, false, 0)).toBeNull();
    expect(played(r, 1000, 600, false, 0)).toEqual({ shown: STILL, wake: 1000 }); // not yet leant, and easing
    const at = (ms: number): string => played(r, 1000 + ms, 600, false, 0)!.shown.tx;
    expect(at(150)).toBe(turnOf([50, 100], 0.75));
    expect(at(300)).toBe(turnOf([50, 100], 1.5));
    expect(at(899)).toBe(turnOf([50, 100], 1.5));
    expect(at(1050)).toBe(turnOf([50, 100], 0.75));
    expect(played(r, 1100, 600, false, 0)!.wake).toBe(1100); // easing in: the very next frame
    expect(played(r, 1300, 600, false, 0)!.wake).toBe(1900); // held: asleep until it eases back
    expect(played(r, 1899, 600, false, 0)!.wake).toBe(1900);
    expect(played(r, 1900, 600, false, 0)!.wake).toBe(1900);
    expect(played(r, 2199, 600, false, 0)!.wake).toBe(2199);
    expect(played(r, 2200, 600, false, 0)).toBeNull(); // two beats, and it is over
    // A glance back leans the other way, about the heel.
    const back = noticed(false, STIFF);
    expect(played(back, 1300, 600, false, 0)!.shown.tx).toBe(turnOf([10, 100], -1.5));
  });

  it("a turn and the crown are cuts: turned about or not for its beats, with one frame to come, at its end", () => {
    const turn = noticed(false);
    expect(played(turn, 1000, 600, false, 0)).toEqual({ shown: TURNED, wake: 2200 });
    expect(played(turn, 2199, 600, false, 0)).toEqual({ shown: TURNED, wake: 2200 });
    expect(played(turn, 2200, 600, false, 0)).toBeNull();
    expect(TURNED).toEqual({ ...STILL, turn: true });
    const crown = armed("other", "done", 300, 800, 1500, 2, { late: 3000, beats: 4, at: [11, 67] });
    begun(crown, 1000, 400, true, NT, 0.5, 360, null);
    expect(played(crown, 1000, 360, false, 8)).toEqual({ shown: STILL, wake: 2440 });
    expect(played(crown, 2440, 360, false, 8)).toBeNull();
  });

  it("ended by a cut or by leaving, it shows nothing from then, and its frame to come is then", () => {
    const turn = noticed(false);
    turn.end = 1500;
    expect(over(turn, 600, 1)).toBe(1500);
    expect(played(turn, 1499, 600, false, 0)).toEqual({ shown: TURNED, wake: 1500 });
    expect(played(turn, 1500, 600, false, 0)).toBeNull();
    const glance = noticed(true);
    glance.end = 1500;
    expect(played(glance, 1400, 600, false, 0)!.wake).toBe(1500);
    expect(played(glance, 1500, 600, false, 0)).toBeNull();
    // Dropped, or not begun: nothing.
    const off = noticed(true);
    off.off = true;
    expect(played(off, 1100, 600, false, 0)).toBeNull();
    expect(played(armed("o", "done", 0, 0, 1500, 2, undefined), 100, 600, false, 0)).toBeNull();
    expect(over(armed("o", "done", 0, 0, 1500, 2, undefined), 600, 1)).toBe(Infinity);
  });

  it("asked for less motion, a lean shows nothing, and a turn or the crown is a still held twice as long", () => {
    expect(played(noticed(true), 1300, 600, true, 0)).toBeNull();
    expect(played(noticed(false, STIFF), 1300, 600, true, 0)).toBeNull();
    const turn = noticed(false);
    expect(over(turn, 600, 2)).toBe(3400);
    expect(played(turn, 2200, 600, true, 0)).toEqual({ shown: TURNED, wake: 3400 });
    expect(played(turn, 3399, 600, true, 0)).toEqual({ shown: TURNED, wake: 3400 });
    expect(played(turn, 3400, 600, true, 0)).toBeNull();
  });

  it("a glance leans in from wherever the fidget had the figure, which eases out as the lean eases in", () => {
    const rest = { part: "", gone: false, frame: "", turn: false, lift: null } as const;
    // The whole figure, shifted and turned about a pivot of its own, in its second frame, about-faced.
    const from: FidgetAt = {
      ...rest,
      dx: -2,
      dy: 1,
      rot: 1,
      pivot: [30, 80],
      eased: true,
      frame: "b",
      turn: true,
    };
    const r = noticed(true, NT, from);
    const at = (ms: number): ReturnType<typeof played> => played(r, 1000 + ms, 600, false, 0);
    // As it begins the figure is where it was; its frame and its about-face have cut back.
    expect(at(0)!.shown).toEqual({
      ...STILL,
      tx: `translate(-2.00px, 1.00px) ${turnOf([30, 80], 1)}`,
    });
    // Half way: half of each.
    expect(at(150)!.shown.tx).toBe(
      `translate(-1.00px, 0.50px) ${turnOf([30, 80], 0.5)} ${turnOf([50, 100], 0.75)}`,
    );
    expect(at(300)!.shown.tx).toBe(turnOf([50, 100], 1.5));
  });

  it("a part that eases is eased back as the lean comes in; one that moves by steps, or was gone, cuts back at once", () => {
    const part = { dx: 0, dy: 0, pivot: [47.9, 20.4], frame: "", turn: false, lift: null } as const;
    const swung: FidgetAt = { ...part, rot: 4, part: "scales", gone: false, eased: true };
    const eased = played(noticed(true, NT, swung), 1150, 600, false, 0)!.shown;
    expect(eased).toMatchObject({ part: "scales", ptx: turnOf([47.9, 20.4], 2) });
    expect(eased.tx).toBe(turnOf([50, 100], 0.75));
    expect(played(noticed(true, NT, swung), 1300, 600, false, 0)!.shown).toMatchObject({
      part: "",
      ptx: "",
    });
    const stepped: FidgetAt = { ...swung, eased: false };
    expect(played(noticed(true, NT, stepped), 1001, 600, false, 0)!.shown).toMatchObject({
      part: "",
      ptx: "",
    });
    const gone: FidgetAt = { ...swung, gone: true };
    expect(played(noticed(true, NT, gone), 1001, 600, false, 0)!.shown).toMatchObject({
      part: "",
      ptx: "",
    });
  });

  it("the one who flies leans at the height her fidget had her, easing to her lift", () => {
    const rest = { dx: 0, dy: 0, rot: 0, pivot: null, part: "", gone: false, turn: false } as const;
    const riding: FidgetAt = { ...rest, frame: "", lift: 6, eased: true };
    const r = noticed(true, NT, riding);
    expect(played(r, 1000, 600, false, 8)!.shown.lift).toBe(6);
    expect(played(r, 1150, 600, false, 8)!.shown.lift).toBe(7);
    expect(played(r, 1300, 600, false, 8)!.shown.lift).toBe(8);
    expect(played(noticed(true), 1300, 600, false, 8)!.shown.lift).toBe(8); // from no fidget: at her lift
    expect(played(noticed(true), 1300, 600, false, 0)!.shown.lift).toBeNull();
  });
});

describe("how long a fidget rests for a reaction", () => {
  const rhythm: Fidget = { bar: 4, idle: false, rest: 0, cut: null, moves: [] };
  it("until the first bar after the reaction ends; for good if it is a move played on the cut; not at all with no fidget", () => {
    // Bars of four beats of 500ms from the cut at 1000: 3000, 5000, 7000.
    expect(hushUntil(rhythm, 1000, 3200, 500)).toBe(5000);
    expect(hushUntil(rhythm, 1000, 4999, 500)).toBe(5000);
    expect(hushUntil(rhythm, 1000, 5000, 500)).toBe(5000); // ending on a bar, it begins with it
    expect(hushUntil(rhythm, 1000, 5001, 500)).toBe(7000);
    const once: Fidget = {
      ...rhythm,
      bar: 0,
      cut: { keys: [], ease: 0, w: 1, part: null, pivot: null, end: 1 },
    };
    expect(hushUntil(once, 1000, 3200, 500)).toBe(Infinity);
    expect(hushUntil(undefined, 1000, 3200, 500)).toBeNull();
  });
});

describe("what a reaction asks of a fidget", () => {
  // The one who flies, as the cast has her: wings down as she rises to 8, up as she sinks to 6.
  const wings: Fidget = {
    bar: 2,
    idle: false,
    rest: 0,
    cut: null,
    moves: [
      {
        keys: [
          [0, { frame: "b", lift: 8 }],
          [1, { lift: 6 }],
        ],
        ease: 300,
        w: 1,
        part: null,
        pivot: null,
        end: 1.84,
      },
    ],
  };
  const none = (): null => null;

  it("a rhythm told a bar is the one it starts again with begins it from rest, not as its last bar left it", () => {
    // Come round, the third bar begins as the second left her: at 6, rising.
    expect(fidgetAt(wings, 4, 360, 8, none)).toMatchObject({ frame: "b", lift: 6 });
    expect(fidgetAt(wings, 4.5, 360, 8, none)!.lift).toBeGreaterThan(6);
    // Having rested, she is at her lift, and stays there for the beat.
    const fresh = (n: number): boolean => n === 2;
    expect(fidgetAt(wings, 4, 360, 8, none, fresh)).toMatchObject({ frame: "b", lift: 8 });
    expect(fidgetAt(wings, 4.5, 360, 8, none, fresh)).toMatchObject({ frame: "b", lift: 8 });
    expect(fidgetAt(wings, 5, 360, 8, none, fresh)).toMatchObject({ frame: "", lift: 8 }); // and sinks
    // The bar after is come round as ever.
    expect(fidgetAt(wings, 6, 360, 8, none, fresh)).toMatchObject({ frame: "b", lift: 6 });
  });

  it("says whether its move eases: what eases can be eased out of, and a cut cannot", () => {
    expect(fidgetAt(wings, 0.5, 360, 8, none)!.eased).toBe(true);
    const cuts: Fidget = { ...wings, moves: [{ ...wings.moves[0]!, ease: 0 }] };
    expect(fidgetAt(cuts, 0.5, 360, 8, none)!.eased).toBe(false);
  });

  it("writes a shift and then each turn about its own pivot, leaving out a turn of nothing", () => {
    const turn = (x: number, y: number, deg: string): string =>
      `translate(${x}px, ${y}px) rotate(${deg}deg) translate(${-x}px, ${-y}px)`;
    expect(shifted(0, 0, [])).toBe("");
    expect(shifted(1, -2, [])).toBe("translate(1.00px, -2.00px)");
    expect(
      shifted(0, 0, [
        [0.5, [30, 80]],
        [0, [1, 1]],
        [1.5, [50, 100]],
        [2, null],
      ]),
    ).toBe(`${turn(30, 80, "0.500")} ${turn(50, 100, "1.500")}`);
  });
});
