// The floor's mosaic, part 6 of Olympus: the mockup's lay and drawTerrain.
// Behind the gods the lane's floor is one of three scenes, each set in a few
// dark stones and cut in courses from the stylobate up (mosaic.json, written
// by scripts/olympus-cast.mjs from the mockup's terrain.py). As the lane opens
// its stones are set, the lowest course first, in a wave along the lane, each
// brought down onto the bed and pressed in; as it shuts they are prised up,
// the top course first, and thrown off. A cell nipped on an outline is two
// stones, one each side of the cut.
// A scene is laid once, whole, at the width it was cut for, from dice of its
// own and never the floor's: so it is laid the same every time, and a
// narrower lane only shows less of it. Where a stone is at a moment follows
// from that and the time alone, so a frame draws them and no step reads them
// back.

import data from "./mosaic.json";
import type { Brush } from "./tesserae";

export type SceneId = "temple" | "grove" | "agora";
/** The scenes in their turn: no scene comes twice running. */
export const SCENES: readonly SceneId[] = ["temple", "grove", "agora"];

/** A cell nipped in two: which, the cut's angle in degrees, how far from the cell's middle in tenths of a px, and the stone beyond it. */
export type Nip = readonly [cell: number, deg: number, off: number, beyond: number];
/**
 * A course of a scene: its top, its bottom and its left in tenths of a px,
 * each cell's width in tenths, a stone a character (its place in the scene's
 * palette), and the cells nipped in two.
 */
export type FloorCourse = readonly [
  top: number,
  bottom: number,
  left: number,
  widths: readonly number[],
  stones: string,
  cuts: readonly Nip[],
];

export interface Scene {
  readonly id: SceneId;
  readonly name: string;
  readonly palette: readonly string[];
  /** From the stylobate up. */
  readonly rows: readonly FloorCourse[];
}

export interface Mosaic {
  readonly source: string;
  /** The lane the scenes were cut for: the floor above the stylobate, CSS px. */
  readonly w: number;
  readonly h: number;
  readonly scenes: readonly Scene[];
}

// JSON has no tuples: its courses are checked by mosaic.test.ts instead.
export const MOSAIC = data as unknown as Mosaic;

// ── The setting and the lifting, ms ──
/** Set: the first stone, the courses' spread from the lowest to the top, a stone's own lateness, and its flight. */
export const SET = { from: 140, span: 760, jitter: 170, each: 330 } as const;
/** Lifted: the courses' spread from the top to the lowest, a stone's own lateness, and its flight. */
export const LIFT = { span: 380, jitter: 150, each: 620 } as const;
const ROLL = 90; // the wave along the lane, either way
/** The last stone is down. */
export const SET_END = SET.from + 2 * ROLL + SET.span + SET.jitter + SET.each;
/** The last stone is off. */
export const LIFT_END = LIFT.span + LIFT.jitter + LIFT.each;
const INSET = 0.34; // a stone sits this far inside its cell: half a joint
const JOINT = 0.6; // a joint is its stone, this much darker

/** One stone of a scene, where it lies in the scene. */
export interface FloorStone {
  /** Its middle. */
  readonly x: number;
  readonly y: number;
  /** Its corners about its middle: x, y, each in turn. */
  readonly pts: readonly number[];
  /** Its corners where it lies at rest in the scene, a little out of true. */
  readonly rest: readonly number[];
  /** Its cell's corners in the scene, which its joint fills. */
  readonly cell: readonly number[];
  /** Its cell's left and right. */
  readonly from: number;
  readonly to: number;
  readonly rot: number;
  readonly fill: string;
  readonly joint: string;
  /** Set: when its flight begins, how far above, how far aside and how far turned. */
  readonly setAt: number;
  readonly drop: number;
  readonly slide: number;
  readonly twist: number;
  /** Lifted: when, how far and which way it is thrown, and its spin. */
  readonly liftAt: number;
  readonly dist: number;
  readonly angle: number;
  readonly spin: number;
}

/** A scene laid: its stones in their courses, and again by colour, so those at rest go down in a few fills. */
export interface LaidFloor {
  readonly id: SceneId;
  readonly stones: readonly FloorStone[];
  readonly byFill: readonly FloorStone[];
  readonly byJoint: readonly FloorStone[];
}

type Point = readonly [number, number];

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * k)));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

// The part of a convex polygon on the near side of a line: n·p <= d.
function clip(poly: readonly Point[], nx: number, ny: number, d: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const da = nx * ax + ny * ay - d;
    const db = nx * bx + ny * by - d;
    if (da <= 0) out.push([ax, ay]);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const u = da / (da - db);
      out.push([ax + (bx - ax) * u, ay + (by - ay) * u]);
    }
  }
  return out;
}

// A polygon's middle and its area.
function middle(poly: readonly Point[]): [number, number, number] {
  let a = 0;
  let x = 0;
  let y = 0;
  poly.forEach(([px, py], i) => {
    const [qx, qy] = poly[(i + 1) % poly.length]!;
    const c = px * qy - qx * py;
    a += c;
    x += (px + qx) * c;
    y += (py + qy) * c;
  });
  return Math.abs(a) < 1e-6 ? [0, 0, 0] : [x / (3 * a), y / (3 * a), Math.abs(a) / 2];
}

function byColour(stones: readonly FloorStone[], key: "fill" | "joint"): FloorStone[] {
  return [...stones].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
}

function laid(id: SceneId, stones: readonly FloorStone[]): LaidFloor {
  return { id, stones, byFill: byColour(stones, "fill"), byJoint: byColour(stones, "joint") };
}

/**
 * Every stone of a scene: its cut, its colour, and when and how it is set and
 * thrown off. `rand` is the scene's own dice; `width` is the lane it was cut
 * for.
 */
export function layScene(scene: Scene, rand: () => number, width = MOSAIC.w): LaidFloor {
  const stones: FloorStone[] = [];
  const courses = scene.rows.length;
  const wave = [rand() * 6.3, rand() * 6.3] as const;
  scene.rows.forEach(([y0, y1, x0, widths, chars, cuts], r) => {
    const top = y0 / 10;
    const bot = y1 / 10;
    const nips = new Map(
      cuts.map(([i, deg, off, beyond]) => [i, [(deg * Math.PI) / 180, off / 10, beyond] as const]),
    );
    let x = x0 / 10;
    widths.forEach((w, i) => {
      const a = x;
      const b = x + w / 10;
      x = b;
      if (b < -1 || a > width + 1) return;
      const cx = (a + b) / 2;
      const cy = (top + bot) / 2;
      const hw = (b - a) / 2;
      const hh = (bot - top) / 2;
      const jig = (): number => (rand() - 0.5) * 0.56;
      const e = INSET;
      const stone = [
        -hw + e + jig(),
        -hh + e + jig(),
        hw - e + jig(),
        -hh + e + jig(),
        hw - e + jig(),
        hh - e + jig(),
        -hw + e + jig(),
        hh - e + jig(),
      ];
      const inner: Point[] = [0, 2, 4, 6].map((k) => [stone[k]!, stone[k + 1]!]);
      const outer: Point[] = [
        [-hw - 0.05, -hh - 0.05],
        [hw + 0.05, -hh - 0.05],
        [hw + 0.05, hh + 0.05],
        [-hw - 0.05, hh + 0.05],
      ];
      const own = Number(chars[i]);
      const nip = nips.get(i);
      let pieces: (readonly [Point[], Point[], number])[] = [[inner, outer, own]];
      if (nip) {
        const [ang, off, beyond] = nip;
        const nx = Math.cos(ang);
        const ny = Math.sin(ang);
        pieces = [
          [clip(inner, nx, ny, off - e), clip(outer, nx, ny, off), own],
          [clip(inner, -nx, -ny, -off - e), clip(outer, -nx, -ny, -off), beyond],
        ];
      }
      for (const [poly, cellPoly, which] of pieces) {
        const [gx, gy, area] = middle(poly);
        if (poly.length < 3 || area < 0.5) continue; // too small a chip to set
        // The dice fall in the mockup's order, so a scene is laid as it was there.
        const tone = 1 - Math.floor(rand() * 4) * 0.015; // never lighter than its stone
        const px = cx + gx;
        const rot = (rand() - 0.5) * 0.05;
        const drop = 5 + rand() * 5;
        const slide = (rand() - 0.5) * 4;
        const twist = (rand() - 0.5) * 0.8;
        const liftAt = (1 - r / (courses - 1)) * LIFT.span + rand() * LIFT.jitter;
        const dist = 34 + rand() * 72;
        const angle = -Math.PI / 2 + (rand() - 0.5) * 1.9 + ((a + b) / 2 / width - 0.5) * 1.1;
        const spin = (rand() - 0.5) * 2 * (1.4 + rand() * 2.6);
        const roll = 55 * Math.sin(px / 61 + wave[0]) + 35 * Math.sin(px / 23 + wave[1]);
        const pts = poly.flatMap(([qx, qy]) => [qx - gx, qy - gy]);
        const c = Math.cos(rot);
        const n = Math.sin(rot);
        stones.push({
          x: px,
          y: cy + gy,
          pts,
          rest: poly.flatMap(([qx, qy]) => [
            px + (qx - gx) * c - (qy - gy) * n,
            cy + gy + (qx - gx) * n + (qy - gy) * c,
          ]),
          cell: cellPoly.flatMap(([qx, qy]) => [cx + qx, cy + qy]),
          from: a,
          to: b,
          rot,
          fill: shade(scene.palette[which]!, tone),
          joint: shade(scene.palette[which]!, JOINT),
          setAt: SET.from + ROLL + roll + (r / (courses - 1)) * SET.span + rand() * SET.jitter,
          drop,
          slide,
          twist,
          liftAt,
          dist,
          angle,
          spin,
        });
      }
    });
  });
  return laid(scene.id, stones);
}

/** The part of a laid scene a lane shows: every stone whose cell comes within a px of it. */
export function cropFloor(floor: LaidFloor, from: number, to: number): LaidFloor {
  const shown = (k: FloorStone): boolean => k.to >= from - 1 && k.from <= to + 1;
  const stones = floor.stones.filter(shown);
  if (stones.length === floor.stones.length) return floor;
  // Each kept in the order it had: by course, and by colour.
  return {
    id: floor.id,
    stones,
    byFill: floor.byFill.filter(shown),
    byJoint: floor.byJoint.filter(shown),
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const u = clamp01((v - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const outCubic = (k: number): number => 1 - (1 - k) ** 3;

/** Being set, laid whole, or being prised up. */
export type FloorPhase = "set" | "shown" | "lift";

/** How far down a stone is `t` ms into a phase: 0 not on the floor, 1 at rest. */
export function downAt(k: FloorStone, phase: FloorPhase, t: number): number {
  if (phase === "set") return clamp01((t - k.setAt) / SET.each);
  if (phase === "lift") return 1 - clamp01((t - k.liftAt) / LIFT.each);
  return 1;
}

// A polygon where it lies.
function trace(ctx: Brush, p: readonly number[]): void {
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.closePath();
}

// A stone on its way: its corners about its middle, there, at a size and a turn.
function polygon(
  ctx: Brush,
  p: readonly number[],
  cx: number,
  cy: number,
  s: number,
  rot: number,
): void {
  const c = Math.cos(rot) * s;
  const n = Math.sin(rot) * s;
  ctx.moveTo(cx + p[0]! * c - p[1]! * n, cy + p[0]! * n + p[1]! * c);
  for (let i = 2; i < p.length; i += 2)
    ctx.lineTo(cx + p[i]! * c - p[i + 1]! * n, cy + p[i]! * n + p[i + 1]! * c);
  ctx.closePath();
}

/**
 * One frame of the floor, `t` ms into its phase: every stone at rest in a few
 * fills, joints and then stones, and the ones on their way over them, each a
 * fill of its own. How many are on their way.
 */
export function drawFloor(ctx: Brush, floor: LaidFloor, phase: FloorPhase, t: number): number {
  // At rest, as downAt has it at 1: set and pressed in, or not yet prised up.
  const set = phase === "set";
  const whole = phase === "shown";
  const atRest = (k: FloorStone): boolean =>
    whole || (set ? (t - k.setAt) / SET.each >= 1 : t <= k.liftAt);
  let fill: string | null = null;
  ctx.globalAlpha = 1;
  for (const k of floor.byJoint) {
    if (!atRest(k)) continue;
    if (k.joint !== fill) {
      if (fill !== null) ctx.fill();
      ctx.fillStyle = fill = k.joint;
      ctx.beginPath();
    }
    trace(ctx, k.cell);
  }
  if (fill !== null) ctx.fill();
  fill = null;
  for (const k of floor.byFill) {
    if (!atRest(k)) continue;
    if (k.fill !== fill) {
      if (fill !== null) ctx.fill();
      ctx.fillStyle = fill = k.fill;
      ctx.beginPath();
    }
    trace(ctx, k.rest);
  }
  if (fill !== null) ctx.fill();
  let flying = 0;
  if (phase === "shown") return flying;
  for (const k of floor.stones) {
    const q = downAt(k, phase, t);
    if (q <= 0 || q >= 1) continue;
    let dx: number;
    let dy: number;
    let s: number;
    let rot: number;
    let a: number;
    if (phase === "set") {
      // Brought down onto the bed and pressed in: from a little above, larger and turned, to rest.
      const e = outCubic(q);
      dx = k.slide * (1 - e);
      dy = -k.drop * (1 - e);
      s = 1 + 0.45 * (1 - e);
      rot = k.rot + k.twist * (1 - e);
      a = clamp01(q / 0.3);
    } else {
      // Prised up, then off: it rises, turns and goes, smaller as it leaves the floor.
      const p = 1 - q;
      const up = smooth(0, 0.2, p);
      const u = clamp01((p - 0.16) / 0.84);
      const go = k.dist * u ** 1.7;
      dx = Math.cos(k.angle) * go;
      dy = -1.6 * up + Math.sin(k.angle) * go;
      s = 1 + 0.22 * up - 0.5 * u;
      rot = k.rot + k.spin * u ** 1.3 + 0.12 * up * Math.sign(k.spin);
      a = 1 - smooth(0.3, 1, u);
    }
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = k.fill;
    ctx.beginPath();
    polygon(ctx, k.pts, k.x + dx, k.y + dy, s, rot);
    ctx.fill();
    flying += 1;
  }
  ctx.globalAlpha = 1;
  return flying;
}
