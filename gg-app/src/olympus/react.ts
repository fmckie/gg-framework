// The gods' notices, part 6c of Olympus: the mockup's reaction as a record,
// and what it shows at a moment. When a god arrives, finishes or fails, a god
// at its work nearby may notice: in front of it, a glance, the whole figure
// leaning a little toward it; behind it, a turn to face, where its pose may
// turn, else a glance back. The one with a crown raises it toward a god that
// has finished. A reaction is held for so many of the god's own beats, begins
// on its quarter-beat, and is played like a fidget: from the record and the
// time alone. Nothing here knows the lane's clock, its dice or who stands
// where; the lane (floor.ts) decides who notices, and when one ends early.
// A start, part 7, is the same kind of thing in a slot of its own: the reader
// pressed a god at its work, and it cuts to its start picture and hops, the
// whole figure easing back to the floor, held for its beats.

import type { Crown, Fidget, FidgetMove, Noticed, NoticeOf } from "./cast";
import { keyed, shifted, STILL, type FidgetAt, type Shown } from "./fidget";

/** How a god reacts: a lean toward, a lean back, an about-face, or the crown. */
export type How = "glance" | "back" | "turn" | "crown";

/** A reaction: what it answers, and, once it has begun, when and how it plays. */
export interface Reaction {
  /** The agent whose record changed, how, where its god was, and when. */
  readonly of: string;
  readonly kind: Noticed;
  readonly x: number;
  readonly at: number;
  readonly crown: boolean;
  /** The latest it may begin, and how many beats it is held. */
  readonly late: number;
  readonly beats: number;
  /** When it begins: not yet known while a cut of the god's own is coming first. */
  start: number | null;
  /** When a cut or the god's leaving ended it, if one did. */
  end: number;
  /** Dropped: replaced before it began, too late to begin, or never to begin. */
  off: boolean;
  how: How | null;
  /** Whether the god is turned about for it. */
  turn: boolean;
  /** The cut that showed the pose it began in: it is that pose's alone. */
  shownAt: number | null;
  /** A lean's move: in, held, and back. */
  move: FidgetMove | null;
  /** How long a lean eases, in beats. */
  ease: number;
  /** Where its fidget had the figure as a lean began: it leans in from there. */
  from: FidgetAt | null;
}

const SLACK = 1e-6;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const inOut = (k: number): number => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** The god's first quarter-beat at or after `from`, its beats counted from `beat0`. */
export function quarter(beat0: number, step: number, from: number): number {
  const q = step / 4;
  return beat0 + Math.ceil((from - beat0 - SLACK) / q) * q;
}

/** A record has changed at `t`: a reaction to it, not yet begun. */
export function armed(
  of: string,
  kind: Noticed,
  x: number,
  t: number,
  late: number,
  beats: number,
  crown: Crown | undefined,
): Reaction {
  return {
    of,
    kind,
    x,
    at: t,
    crown: crown !== undefined,
    late: t + (crown ? crown.late : late),
    beats: crown ? crown.beats : beats,
    start: null,
    end: Infinity,
    off: false,
    how: null,
    turn: false,
    shownAt: null,
    move: null,
    ease: 0,
    from: null,
  };
}

/**
 * It begins at `start`, in the pose cut in at `shownAt`: toward what is in
 * front of it, a glance; behind it, a turn to face where the pose may turn,
 * else a glance back; the crown faces the one it is for.
 */
export function begun(
  r: Reaction,
  start: number,
  shownAt: number,
  front: boolean,
  nt: NoticeOf,
  ease: number,
  step: number,
  from: FidgetAt | null,
): void {
  r.start = start;
  r.shownAt = shownAt;
  r.turn = !front;
  r.how = r.crown ? "crown" : front ? "glance" : nt.turn ? "turn" : "back";
  r.ease = ease;
  r.from = null;
  r.move = null;
  if (r.how !== "glance" && r.how !== "back") return;
  r.turn = false;
  r.from = from;
  r.move = {
    keys: [
      [0, { rot: r.how === "glance" ? nt.lean : -nt.lean }],
      [r.beats - ease, {}],
    ],
    ease: ease * step,
    w: 1,
    part: null,
    pivot: r.how === "glance" ? nt.front : nt.back,
    end: r.beats,
  };
}

/** When a reaction that has begun is over: its beats, each `slow` times as long, unless it was ended first. */
export function over(r: Reaction, step: number, slow: number): number {
  return Math.min(r.end, (r.start ?? Infinity) + r.beats * step * slow);
}

/**
 * How long a pose's fidget rests for a reaction that ends at `end`: until its
 * first bar after that; for good, if it is a move played on the cut; null if
 * the pose has no fidget.
 */
export function hushUntil(
  f: Fidget | undefined,
  shownAt: number,
  end: number,
  step: number,
): number | null {
  if (!f) return null;
  if (f.cut) return Infinity;
  const bar = f.bar * step;
  return shownAt + Math.ceil((end - shownAt) / bar - SLACK) * bar;
}

/** Turned about, and nothing else: a turn to face, or the crown for one behind. */
export const TURNED: Shown = Object.freeze({ ...STILL, turn: true });

/**
 * What a reaction shows at `now`, and when it will next be drawn otherwise:
 * `now` while a lean eases, else its next key or its end; null if it shows
 * nothing then. A turn and the crown are cuts. A lean eases in from wherever
 * the fidget had the figure, which eases out as it does; the fidget's frame,
 * its about-face and a part that moves by steps cut back at once. Asked for
 * less motion (`quiet`), a lean shows nothing, and a turn or the crown is a
 * still held twice as long. `lift` is how far the pose is held off the floor.
 */
export function played(
  r: Reaction,
  now: number,
  step: number,
  quiet: boolean,
  lift: number,
): { readonly shown: Shown; readonly wake: number } | null {
  if (r.off || r.start === null || r.how === null || now < r.start || now >= r.end) return null;
  const slow = quiet ? 2 : 1;
  const b = (now - r.start) / step / slow;
  if (b >= r.beats) return null;
  const end = over(r, step, slow);
  if (!r.move) return { shown: r.turn ? TURNED : STILL, wake: end };
  if (quiet) return null;
  const s = keyed(r.move, b, step, false);
  if (!s) return null;
  const f = r.from;
  const fade = f ? 1 - inOut(clamp01((now - r.start) / (r.ease * step))) : 0;
  const turns: (readonly [number, FidgetAt["pivot"]])[] = [];
  let dx = 0;
  let dy = 0;
  let part = "";
  let ptx = "";
  if (f && fade > 0) {
    if (f.part) {
      ptx = f.gone || !f.eased ? "" : shifted(f.dx * fade, f.dy * fade, [[f.rot * fade, f.pivot]]);
      part = ptx ? f.part : "";
    } else {
      dx = f.dx * fade;
      dy = f.dy * fade;
      turns.push([f.rot * fade, f.pivot]);
    }
  }
  turns.push([lerp(s.was.rot ?? 0, s.now.rot ?? 0, s.k), r.move.pivot]);
  const tx = shifted(dx, dy, turns);
  const h = lift ? lerp(lift, f?.lift ?? lift, fade) : null;
  const held = r.beats - r.ease;
  const easing = b < r.ease || b >= held - SLACK;
  const wake = easing ? now : Math.min(end, r.start + held * step);
  if (!tx && !part && (h === null || h === lift)) return { shown: STILL, wake };
  return { shown: { tx, frame: "", turn: false, lift: h, part, ptx }, wake };
}

/** A start: the reader pressed a god at its work. A record, as a reaction is. */
export interface Start {
  /** When the reader's press was seen, and when it begins: the god's quarter-beat at or after. */
  readonly at: number;
  readonly start: number;
  /** When a cut, a notice, a line put out near it or the god's leaving ended it, if one did. */
  end: number;
  /** Dropped: one of those came before it began. */
  off: boolean;
  /** The cut that showed the pose it began in: its fidget rests for it in that pose alone. */
  readonly shownAt: number;
  /** For how many of the god's beats it is held. */
  readonly beats: number;
  /** How far it hops, px: nothing for a smaller start, or for the one who flies at her height. */
  readonly hop: number;
  /** Whether it is the smaller start of a god startled again. */
  readonly small: boolean;
  /** The height the one who flies holds through it: the one she had; null on the floor. */
  readonly lift: number | null;
}

/** When a start that has begun is over: its beats, each `slow` times as long, unless it was ended first. */
export function startOver(s: Start, step: number, slow: number): number {
  return Math.min(s.end, s.start + s.beats * step * slow);
}

/**
 * What a start shows at `now`, besides its picture, and when it will next be
 * drawn otherwise: `now` while its hop eases back to the floor, over `down`
 * beats, else its end; null if it shows nothing then. Asked for less motion
 * (`quiet`), it is a still with no hop, held twice as long.
 */
export function started(
  s: Start,
  now: number,
  step: number,
  quiet: boolean,
  down: number,
): { readonly shown: Shown; readonly wake: number } | null {
  if (s.off || now < s.start) return null;
  const end = startOver(s, step, quiet ? 2 : 1);
  if (now >= end) return null;
  const k = clamp01((now - s.start) / (down * step));
  const hopping = !quiet && s.hop > 0 && k < 1;
  const tx = hopping ? shifted(0, -s.hop * (1 - inOut(k)), []) : "";
  const wake = hopping ? now : end;
  if (!tx && s.lift === null) return { shown: STILL, wake };
  return { shown: { ...STILL, tx, lift: s.lift }, wake };
}
