// The gods' tesserae, part 5b of Olympus: the mockup's godTiles and
// drawGodTiles. A god is set from the stones of its speaking pose, from the
// feet up, each brought in from a little way off; it goes back to those of its
// standing pose. Done or stopped, they are prised up, the crown first, and
// thrown off; failed, they fall where they are and lie a moment on the floor.
// Each stone's moment and its way of going are cut once, from dice of the
// god's own and never the floor's. Where a stone is at a moment follows from
// that and the time alone, so a frame draws them and no step reads them back.

import type { Course } from "./cast";

export const UNSET = 140; // the figure gives way to its tesserae
const T_EACH = 340; // a tessera's flight into place
const T_LIFT = 620; // and off it
const GRAVITY = 1500; // px/s², a crumbling figure's
const LAIN = 0.28; // s a fallen stone lies on the floor as it goes

/** Being set, set and showing its figure through, prised up and thrown off, or falling. */
export type TesseraeMode = "set" | "rest" | "lift" | "fall";

/**
 * How a figure's stones are cut and flown: the gap about a stone and its
 * unevenness, px; when its flight in begins (first, how much later at the top,
 * how far apart) and from how far off (across, up, and how much further up);
 * when it is lifted (first, how much later at the foot, how far apart) and how
 * far thrown; when it falls (first, how far apart, how much later at the
 * foot), its drift and its first speed; and a flight in and a flight off, ms.
 */
export interface Cut {
  readonly gap: number;
  readonly jig: number;
  readonly setAt: readonly [number, number, number];
  readonly from: readonly [number, number, number];
  readonly liftAt: readonly [number, number, number];
  readonly dist: readonly [number, number];
  readonly fallAt: readonly [number, number, number];
  readonly vx: number;
  readonly v0: number;
  readonly each: number;
  readonly lift: number;
}
const GOD: Cut = {
  gap: 0.3,
  jig: 0.4,
  setAt: [40, 620, 150],
  from: [30, 8, 26],
  liftAt: [UNSET, 380, 150],
  dist: [30, 62],
  fallAt: [UNSET, 240, 140],
  vx: 34,
  v0: 20,
  each: T_EACH,
  lift: T_LIFT,
};
/** A medallion's: the mockup's medalTiles, M_EACH and M_LIFT. Smaller stones, a shorter way. */
export const MEDAL: Cut = {
  gap: 0.18,
  jig: 0.24,
  setAt: [0, 300, 120],
  from: [14, 4, 12],
  liftAt: [0, 220, 80],
  dist: [16, 30],
  fallAt: [0, 200, 120],
  vx: 16,
  v0: 10,
  each: 180,
  lift: 400,
};

/** One stone, in its god's cell facing right. */
export interface Tessera {
  /** Its middle. */
  readonly cx: number;
  readonly cy: number;
  /** Its four corners about its middle: x, y, four times. */
  readonly pts: readonly number[];
  /** Its ivory in the god's palette. */
  readonly k: number;
  readonly rot: number;
  /** Set: when its flight begins, where from, and how far turned. */
  readonly setAt: number;
  readonly fx: number;
  readonly fy: number;
  readonly twist: number;
  /** Lifted: when, how far and which way it is thrown, and its spin. */
  readonly liftAt: number;
  readonly dist: number;
  readonly angle: number;
  readonly spin: number;
  /** Fallen: when it lets go, its drift and first speed, its tumble, and where on the floor it lies. */
  readonly fallAt: number;
  readonly vx: number;
  readonly v0: number;
  readonly tumble: number;
  readonly ground: number;
}

/**
 * A pose cut into its stones, as the mockup's build.py cut it. `rand` is the
 * pose's own dice; `ground` is the floor's height, where a fallen stone lies.
 */
export function cutTesserae(
  rows: readonly Course[],
  rand: () => number,
  ground: number,
  cut: Cut = GOD,
): Tessera[] {
  const stones: Tessera[] = [];
  const courses = rows.length;
  rows.forEach(([y0, y1, x0, w, chars], r) => {
    const top = y0 / 10;
    const bot = y1 / 10;
    const ww = w / 100;
    const up = r / Math.max(1, courses - 1); // 0 at the feet, 1 at the crown
    let x = x0 / 10;
    for (const ch of chars) {
      const a = x;
      x += ww;
      if (ch === "-") continue;
      const hw = ww / 2;
      const hh = (bot - top) / 2;
      const e = cut.gap;
      const jig = (): number => (rand() - 0.5) * cut.jig;
      stones.push({
        cx: a + hw,
        cy: (top + bot) / 2,
        pts: [
          -hw + e + jig(),
          -hh + e + jig(),
          hw - e + jig(),
          -hh + e + jig(),
          hw - e + jig(),
          hh - e + jig(),
          -hw + e + jig(),
          hh - e + jig(),
        ],
        k: parseInt(ch, 36),
        rot: (rand() - 0.5) * 0.06,
        // set: from the feet up, each brought in from a little way off, larger and turned
        setAt: cut.setAt[0] + up * cut.setAt[1] + rand() * cut.setAt[2],
        fx: (rand() - 0.5) * cut.from[0],
        fy: -(cut.from[1] + rand() * cut.from[2]),
        twist: (rand() - 0.5) * 2.4,
        // lifted: the crown first, each prised up and thrown off
        liftAt: cut.liftAt[0] + (1 - up) * cut.liftAt[1] + rand() * cut.liftAt[2],
        dist: cut.dist[0] + rand() * cut.dist[1],
        angle: -Math.PI / 2 + (rand() - 0.5) * 1.8,
        spin: (rand() - 0.5) * 2 * (1.4 + rand() * 2.6),
        // fallen: they fall where they are, and lie a moment on the floor
        fallAt: cut.fallAt[0] + rand() * cut.fallAt[1] + (1 - up) * cut.fallAt[2],
        vx: (rand() - 0.5) * cut.vx,
        v0: rand() * cut.v0,
        tumble: (rand() - 0.5) * 7,
        ground: ground - 0.6 - rand() * 2.6,
      });
    }
  });
  return stones;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const u = clamp01((v - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const outCubic = (k: number): number => 1 - (1 - k) ** 3;

/** A stone on its way: how far from its bed, its size, its turn and how far it shows. */
export interface Flight {
  readonly dx: number;
  readonly dy: number;
  readonly s: number;
  readonly rot: number;
  readonly a: number;
}

/**
 * Where a stone is `u` ms into its god's setting or unsetting, or null while
 * there is nothing of it to see. `top` is its cell's top on the floor, which a
 * falling stone's drop is measured from; `a` is how far the stones show at rest.
 * A medallion's go `inward`, toward the lane (1 to the right, -1 to the left):
 * a god's are thrown either way.
 */
export function flightOf(
  k: Tessera,
  mode: TesseraeMode,
  u: number,
  top: number,
  a = 1,
  cut: Cut = GOD,
  inward = 0,
): Flight | null {
  let dx = 0;
  let dy = 0;
  let s = 1;
  let rot = k.rot;
  if (mode === "set") {
    const q = clamp01((u - k.setAt) / cut.each);
    if (q <= 0) return null;
    const e = outCubic(q);
    dx = k.fx * (1 - e);
    dy = k.fy * (1 - e);
    s = 1 + 0.55 * (1 - e);
    rot = k.rot + k.twist * (1 - e);
    a = clamp01(q / 0.35);
  } else if (mode === "lift") {
    const q = clamp01((u - k.liftAt) / cut.lift);
    a = clamp01(u / UNSET);
    if (q > 0) {
      const up = smooth(0, 0.2, q);
      const v = clamp01((q - 0.16) / 0.84);
      const go = k.dist * v ** 1.7;
      dx = inward ? Math.abs(Math.cos(k.angle)) * go * inward : Math.cos(k.angle) * go;
      dy = -1.6 * up + Math.sin(k.angle) * go;
      s = 1 + 0.2 * up - 0.5 * v;
      rot = k.rot + k.spin * v ** 1.3;
      a = 1 - smooth(0.3, 1, v);
    }
  } else if (mode === "fall") {
    const tt = (u - k.fallAt) / 1000;
    a = clamp01(u / UNSET);
    if (tt > 0) {
      const drop = Math.max(0, k.ground - (top + k.cy));
      const land = (-k.v0 + Math.sqrt(k.v0 * k.v0 + 2 * GRAVITY * drop)) / GRAVITY;
      const tf = Math.min(tt, land);
      dy = Math.min(drop, k.v0 * tf + 0.5 * GRAVITY * tf * tf);
      dx = inward ? k.vx * tf * inward : k.vx * tf;
      rot = k.rot + k.tumble * tf;
      s = 1 - 0.18 * clamp01(tf / 0.35);
      a = tt > land ? 1 - clamp01((tt - land) / LAIN) : 1;
    }
  }
  return a <= 0 ? null : { dx, dy, s, rot, a };
}

/**
 * A failed or stopped god's stone: the figure's own dimming, grayscale(0.6)
 * brightness(0.74) contrast(0.92), worked on the ivory itself; a failed
 * medallion's is a little darker.
 */
export function dimmed(hex: string, bright = 0.74): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const c = [r, g, b].map((v) => {
    const gray = (v + (y - v) * 0.6) * bright;
    return Math.round(clamp01((gray - 0.5) * 0.92 + 0.5) * 255);
  });
  return `rgb(${c.join(" ")})`;
}

/** What the stones are drawn with: a canvas's 2D context, or a test's. */
export type Brush = Pick<
  CanvasRenderingContext2D,
  "globalAlpha" | "fillStyle" | "beginPath" | "moveTo" | "lineTo" | "closePath" | "fill"
>;

/** A god's stones at a moment: where its cell stands on the floor, which way it faces, and how far in. */
export interface Laid {
  readonly mode: TesseraeMode;
  readonly u: number;
  /** How far they show at rest: they give way as the figure shows through. */
  readonly a: number;
  /** Its cell's left and top on the floor. */
  readonly x: number;
  readonly y: number;
  readonly dir: number;
  /** A god faces left by mirroring about this line in its cell. */
  readonly axis: number;
  /** A medallion's: how its stones were cut, and which way the lane is. */
  readonly cut?: Cut;
  readonly inward?: number;
}

/** One god's stones for one frame; how many were drawn. */
export function drawTesserae(
  ctx: Brush,
  stones: readonly Tessera[],
  palette: readonly string[],
  at: Laid,
): number {
  const flip = at.dir < 0 ? -1 : 1;
  let drawn = 0;
  for (const k of stones) {
    const f = flightOf(k, at.mode, at.u, at.y, at.a, at.cut, at.inward);
    if (!f) continue;
    const cx = at.x + (flip > 0 ? k.cx : at.axis - k.cx) + flip * f.dx;
    const cy = at.y + k.cy + f.dy;
    const rot = flip * f.rot;
    const c = Math.cos(rot) * f.s;
    const n = Math.sin(rot) * f.s;
    const p = k.pts;
    ctx.globalAlpha = f.a;
    ctx.fillStyle = palette[k.k]!;
    ctx.beginPath();
    ctx.moveTo(cx + flip * p[0]! * c - p[1]! * n, cy + flip * p[0]! * n + p[1]! * c);
    for (let i = 2; i < p.length; i += 2)
      ctx.lineTo(cx + flip * p[i]! * c - p[i + 1]! * n, cy + flip * p[i]! * n + p[i + 1]! * c);
    ctx.closePath();
    ctx.fill();
    drawn += 1;
  }
  ctx.globalAlpha = 1;
  return drawn;
}
