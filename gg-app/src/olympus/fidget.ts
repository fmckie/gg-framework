// The gods' fidgets, part 6b of Olympus: the mockup's keyed, moveAt, fidgetAt
// and fidget. A god holding a pose at its work moves in its own way: a gesture
// with a start and an end, in the god's own beats, counted from the cut that
// showed the pose. The whole figure may ease a little; a limb only ever
// changes by a cut to another frame. Only work that is itself a rhythm comes
// round again.
// All of it is worked out from the time alone: what a pose is doing so many
// beats after its cut, and when that will next change. Nothing here knows the
// lane's clock or its dice; an idling pose's bars are dealt by dice the caller
// seeds from the god, the pose, the cut and the bar.

import type { Fidget, FidgetMove, FidgetState } from "./cast";

const NONE: FidgetState = Object.freeze({});
const SLACK = 1e-6; // of a beat: a key falls on its beat however the division rounds
const LOOK = 8; // how many bars of idling to look ahead for the next gesture
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const inOut = (k: number): number => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** The move a bar of idling was dealt, and the beat it starts on. */
export interface Dealt {
  readonly move: FidgetMove;
  readonly start: number;
}

/**
 * A bar of idling: one of the pose's moves, by its weight against the others
 * and the pose's rest, starting on a whole beat that leaves it room to end
 * inside the bar; or nothing.
 */
export function deal(f: Fidget, n: number, dice: () => number): Dealt | null {
  let r = dice() * (f.rest + f.moves.reduce((sum, m) => sum + m.w, 0));
  const move = f.moves.find((m) => (r -= m.w) < 0);
  if (!move) return null;
  const from = Math.ceil(n * f.bar - SLACK);
  const room = Math.floor((n + 1) * f.bar - move.end - from + SLACK);
  return room < 0 ? null : { move, start: from + Math.floor(dice() * (room + 1)) };
}

/** The move a pose is in, the beat it counts from, and whether it has come round again. */
interface Playing {
  readonly move: FidgetMove;
  readonly from: number;
  readonly round: boolean;
}

/**
 * The move a pose is in, b beats after its cut: the one that plays on the
 * cut; in a rhythm, the bar's, from the bar's start; idling, the one this bar
 * was dealt, if any, from the beat it was dealt.
 */
function moveAt(f: Fidget, b: number, dealt: (n: number) => Dealt | null): Playing | null {
  if (f.cut) return { move: f.cut, from: 0, round: false };
  const n = Math.floor(b / f.bar + SLACK);
  // A rhythm comes round as its last bar left it.
  if (!f.idle) return { move: f.moves[0]!, from: n * f.bar, round: n > 0 };
  const d = dealt(n);
  return d && { move: d.move, from: d.start, round: false };
}

/**
 * Where a move is, b beats in: the state of the last key reached, and how far
 * it has eased into it from the one before. Before its first key it is at
 * rest, or, in a rhythm come round again, as its last key left it.
 */
export function keyed(
  move: FidgetMove,
  b: number,
  step: number,
  round: boolean,
): { now: FidgetState; was: FidgetState; k: number } | null {
  const keys = move.keys;
  const last = keys[keys.length - 1]![1];
  let i = -1;
  while (i + 1 < keys.length && keys[i + 1]![0] <= b + SLACK) i++;
  if (i < 0) return round ? { now: last, was: last, k: 1 } : null;
  return {
    now: keys[i]![1],
    was: i ? keys[i - 1]![1] : round ? last : NONE,
    k: move.ease ? inOut(clamp01(((b - keys[i]![0]) * step) / move.ease)) : 1,
  };
}

/** A fidget as numbers: the figure, or its part, shifted and turned about the move's pivot. */
export interface FidgetAt {
  readonly dx: number;
  readonly dy: number;
  readonly rot: number;
  readonly pivot: readonly [number, number] | null;
  /** The cut-out part that is moved, if not the whole figure; and whether it is gone. */
  readonly part: string;
  readonly gone: boolean;
  /** Its pose's second frame, and an about-face: each a cut. */
  readonly frame: "" | "b";
  readonly turn: boolean;
  /** The height the one who flies rides at; null for a pose that isn't lifted. */
  readonly lift: number | null;
}

/**
 * What a pose is doing b beats after the cut that showed it, on a beat of
 * `step` ms; null at rest. `lift` is how far the pose is held off the floor.
 */
export function fidgetAt(
  f: Fidget,
  b: number,
  step: number,
  lift: number,
  dealt: (n: number) => Dealt | null,
): FidgetAt | null {
  const at = moveAt(f, b, dealt);
  const s = at && keyed(at.move, b - at.from, step, at.round);
  if (!at || !s) return null;
  const num = (key: "dx" | "dy" | "rot" | "lift", rest = 0): number =>
    lerp(s.was[key] ?? rest, s.now[key] ?? rest, s.k);
  return {
    dx: num("dx"),
    dy: num("dy"),
    rot: num("rot"),
    pivot: at.move.pivot,
    part: at.move.part ?? "",
    gone: s.now.gone === true,
    frame: s.now.frame ?? "",
    turn: s.now.turn === true,
    lift: lift ? num("lift", lift) : null,
  };
}

// A move b beats in: b itself while it eases into a key, else the beat of its
// next key, else null: it is over.
function ahead(move: FidgetMove, b: number, step: number): number | null {
  const keys = move.keys;
  let i = -1;
  while (i + 1 < keys.length && keys[i + 1]![0] <= b + SLACK) i++;
  if (i >= 0 && move.ease && (b - keys[i]![0]) * step < move.ease) return b;
  return i + 1 < keys.length ? keys[i + 1]![0] : null;
}

/**
 * When a pose, b beats after its cut, will next be drawn otherwise, in beats
 * from the cut: b itself while a figure eases; else its next key, in this bar
 * or a later one; never, once a move played on the cut is over. So frames
 * are needed only while it eases, and one at each key.
 */
export function nextAt(
  f: Fidget,
  b: number,
  step: number,
  dealt: (n: number) => Dealt | null,
): number {
  if (f.cut) return ahead(f.cut, b, step) ?? Infinity;
  const n = Math.floor(b / f.bar + SLACK);
  if (!f.idle) {
    const move = f.moves[0]!;
    const from = n * f.bar;
    const next = ahead(move, b - from, step);
    if (next === null) return (n + 1) * f.bar + move.keys[0]![0];
    return next === b - from ? b : from + next;
  }
  const d = dealt(n);
  const next = d ? ahead(d.move, b - d.start, step) : null;
  if (d && next !== null) return next === b - d.start ? b : d.start + next;
  for (let m = n + 1; m <= n + LOOK; m++) {
    const later = dealt(m);
    if (later) return later.start + later.move.keys[0]![0];
  }
  return (n + LOOK + 1) * f.bar; // nothing dealt for a long while: look again then
}

/**
 * A fidget as the lane writes it: the whole figure's transform, its pose's
 * second frame, an about-face, the height the one who flies rides at, and its
 * cut-out part's transform.
 */
export interface Shown {
  readonly tx: string;
  readonly frame: "" | "b";
  readonly turn: boolean;
  readonly lift: number | null;
  readonly part: string;
  readonly ptx: string;
}

/** At rest: the pose as it is, untouched. */
export const STILL: Shown = Object.freeze({
  tx: "",
  frame: "",
  turn: false,
  lift: null,
  part: "",
  ptx: "",
});

// A shift and a turn, as a transform about the box's own corner: the shift,
// then the turn about its pivot.
function shifted(dx: number, dy: number, rot: number, pivot: FidgetAt["pivot"]): string {
  let tx = "";
  if (Math.abs(dx) >= 0.005 || Math.abs(dy) >= 0.005)
    tx = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
  if (pivot && Math.abs(rot) >= 0.0005) {
    const [px, py] = pivot;
    tx += `${tx && " "}translate(${px}px, ${py}px) rotate(${rot.toFixed(3)}deg) translate(${-px}px, ${-py}px)`;
  }
  return tx;
}

/** What to write for a fidget; STILL if nothing shows of it. */
export function shown(s: FidgetAt | null, lift: number): Shown {
  if (!s) return STILL;
  const tx = s.gone ? "scale(0)" : shifted(s.dx, s.dy, s.rot, s.pivot);
  if (s.part) return tx ? { ...STILL, part: s.part, ptx: tx } : STILL;
  if (!tx && !s.frame && !s.turn && (s.lift === null || s.lift === lift)) return STILL;
  return { tx, frame: s.frame, turn: s.turn, lift: s.lift, part: "", ptx: "" };
}
