// The lane's engine, part 2 of Olympus: the mockup's floor.js, as stills.
// Kleio's subagents as gods on one open lane, reconciled to the records by
// sync(agents). Nothing is choreographed: every step follows from the records
// and from where the others are.
// - The lane opens when the first agent is sent and shuts after the last god
//   has gone.
// - Gods land one at a time, each at a place of its own, and say a greeting on
//   a ribbon. At its place a god stands and faces the middle of the lane.
// - Places: every god has an envelope, all the floor it can cover at its
//   place, and two places are never nearer than their envelopes and a gap. A
//   first crowd is spread over the lane; a later god takes the gap with most
//   room, and if there isn't enough the nearest step aside. A god with no room
//   waits unseen until there is.
// - Ribbons: a line is held out only where all of it clears every other god
//   and every other ribbon: toward the middle of the lane, else the other way,
//   else a little higher. With nowhere yet the god waits for room, and if none
//   comes it goes on without a word.
// - Done: a farewell, the seal on its rolled scroll, and it goes. Failed: it
//   stands dimmed and cracked, and goes. Stopped: dimmed, with no crack.
// - From the sixth agent working at once, an agent waits unseen and lands,
//   oldest first, once a god has left its place.
// Every change is a cut: nothing here travels, fades or eases. Those, the
// skill poses, the mosaic, the card and the pool's medallions are later parts.
// It runs on sim.ts's clock, each step put on it for its moment.

import type { Cast, CastGod, Pose, SvgNode } from "./cast";
import { POSES } from "./cast";
import type { GodId } from "./gods";
import type { Sim, SimEvent } from "./sim";

/** How an agent's record reads, as its row has it (OlympusRows' rowState). */
export type LaneLook = "run" | "done" | "fail" | "stop";

/** One agent, as the lane needs it. */
export interface LaneAgent {
  readonly key: string;
  readonly god: GodId;
  readonly look: LaneLook;
}

export interface FloorOptions {
  readonly sim: Sim;
  readonly cast: Cast;
  /** The floor's dice: 0 to 1. */
  readonly random: () => number;
  /** Each god's pictures. */
  readonly poses: Readonly<Record<GodId, Readonly<Record<Pose, string>>>>;
  /** The lane's width inside its frame; the element's own unless given. */
  readonly width?: () => number;
  /** A line's or a name's length as drawn; the element's own unless given. */
  readonly measure?: (el: HTMLElement) => number;
}

/** What the floor holds, for tests and previews. */
export interface FloorPeek {
  readonly open: boolean;
  readonly width: number;
  /** Waiting to land, in order. */
  readonly queue: readonly string[];
  /** Waiting unseen for a place, oldest first. */
  readonly waiting: readonly string[];
  readonly gods: readonly {
    readonly key: string;
    readonly god: GodId;
    readonly x: number;
    /** The floor its figure stands on now: from, to. */
    readonly figure: readonly [number, number];
    /** All the floor it can cover at its place, while it has one: from, to. */
    readonly place: readonly [number, number] | null;
    readonly face: number;
    readonly pose: Pose;
    readonly step: string;
    /** The line on its ribbon, and where the ribbon runs along the floor. */
    readonly line: string | null;
    readonly ribbon: readonly [number, number] | null;
    readonly ending: Exclude<LaneLook, "run"> | null;
  }[];
}

export interface Floor {
  /** Reconcile the floor with the records. Cheap; called on every change. */
  sync(agents: readonly LaneAgent[]): void;
  /** The lane's frame may have changed width. */
  resize(): void;
  /** The carved names' face has loaded: measure them again. */
  remeasure(): void;
  peek(): FloorPeek;
  /** Back to an empty, shut lane, for good. */
  dispose(): void;
}

// ── The lane, CSS px ──
const LANE_H = 126;
const TREAD = 22;
const WIDE = 698; // the lane in the mockup's column; a narrow window's is less
const H = LANE_H - TREAD; // the floor above the stylobate
const HEAD = 33; // every pose's head line in its 73×100 cell
const AXIS = 2 * HEAD; // a god faces left by mirroring about its head: x → AXIS − x
const TOP = H - 100; // a cell's top, in the floor
const EDGE = 16; // inside the antae, with a little air
const GAP = 10; // between all one god can cover at its place and all the next can
const AIR = 90; // and the room a first crowd leaves between places besides: a line's length
const CAPACITY = 5; // the lane holds five working; from the sixth, they wait
const SHIFT_MIN = 14; // a god at its place doesn't step aside for less, if the lane works out without
const SQUEEZE = 12; // a newcomer between two gods may have this much less than the gaps
const TILT = 6; // degrees: a ribbon runs up and away from the hand
const RIB_HALF = 8.5; // half a ribbon's height
const RIB_PAD = 3; // kept clear all round a ribbon
const RIB_TOP = 3; // the lane's top, under the dock's rim
const LIFTS = [0, 3, 6]; // held a little higher, over a neighbour's low reach
const SPREAD = 16; // the room kept round a god as it is set

// ── A god's turn, ms: the mockup's stills ──
const LAND_STILL = 500; // a beat after the lane opens, so a crowd sent together is placed together
const LAND_GAP = 850; // and the next no sooner
const CLOSE_AFTER = 600; // the lane waits a beat after the last god has gone
const RETRY = 400; // no room yet to land: look again
const SAID = 1700; // a line held on the ribbon
const SEALED = 1200; // it stands while the seal is on its scroll
const FAIL_HOLD = 3000; // dimmed, and cracked if it failed, before it goes
const HOLD = 200; // waiting for room for a line: look again
const GREET_WAIT = 1500; // a greeting waits this long for room, then the god goes on without a word
const BYE_WAIT = 3000; // a farewell waits its turn longer; then it seals its scroll and goes
const BYE_STUCK = 1200; // but if nothing round it will make room, the longest waiting goes after this

// Greetings and farewells, in Kleio's voice: short, a little dry. Most are one
// god's own; two of each anyone may say.
type Line = readonly [text: string, who: GodId | "*"];
const LINES: Readonly<Record<"greeting" | "farewell", readonly Line[]>> = {
  greeting: [
    ["At your service.", "*"],
    ["Here, and listening.", "*"],
    ["I have the brief.", "athena"],
    ["Tell me everything.", "herodotus"],
    ["Already halfway there.", "hermes"],
    ["To the anvil, then.", "hephaestus"],
    ["All eyes on it.", "argus"],
    ["Let it be weighed.", "themis"],
    ["This one is ours.", "nike"],
  ],
  farewell: [
    ["It is written.", "*"],
    ["I leave it with you.", "*"],
    ["Sealed, and yours.", "athena"],
    ["There is more, another day.", "herodotus"],
    ["Done before you asked.", "hermes"],
    ["Built to last.", "hephaestus"],
    ["Nothing got past me.", "argus"],
    ["Weighed, and found true.", "themis"],
    ["Victory, as promised.", "nike"],
  ],
};

/** The floor's dice from a seed (the mockup's rng). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

type Range = readonly [number, number];
interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** A line held out, or the room kept for one: where it runs along the floor. */
interface Rib {
  readonly text: string;
  readonly side: number;
  readonly lift: number;
  readonly ox: number;
  readonly oy: number;
  readonly reach: number;
  readonly x0: number;
  readonly x1: number;
}

type Ending = Exclude<LaneLook, "run">;
type Saying = "greet" | "report";

/** A step of a god's turn: what it is doing, from when to when. */
interface Seg {
  readonly kind: "greet" | "report" | "seal" | "fail" | "work" | "hold";
  readonly t1: number;
  readonly then?: (t: number) => void;
  timer?: SimEvent;
}

interface God {
  readonly key: string;
  readonly gid: GodId;
  readonly c: CastGod;
  readonly el: HTMLElement;
  readonly label: HTMLElement;
  labelW: number;
  ribbon: HTMLElement | null;
  rib: Rib | null;
  /** The greeting kept for it as it lands. */
  line: string | null;
  /** The line it last held out. */
  said: string | null;
  /** Since when it has waited for room. */
  waiting: number | null;
  x: number;
  dir: number;
  /** The way it faces at its place: toward the middle of the lane. */
  face: number;
  pose: Pose;
  seat: number | null;
  landed: boolean;
  gone: boolean;
  ending: Ending | null;
  seg: Seg | null;
  sealed: boolean;
  dim: boolean;
  crack: boolean;
  /** What was last written to the page, so a frame writes only what changed. */
  out: Record<string, unknown>;
}

interface Placed {
  readonly g: God;
  readonly x: number;
}

const SVG = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Readonly<Record<string, string>>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
function grow(parent: SVGElement, nodes: readonly SvgNode[]): void {
  for (const node of nodes) {
    const el = svg(node.tag, node.attrs);
    if (node.children) grow(el, node.children);
    parent.append(el);
  }
}
function html(tag: string, className: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

export function createFloor(lane: HTMLElement, opts: FloorOptions): Floor {
  const { sim, cast: CAST, random } = opts;
  const godsEl = lane.querySelector<HTMLElement>(".oly-gods")!;
  const namesEl = lane.querySelector<HTMLElement>(".oly-names")!;
  const measure = opts.measure ?? ((el: HTMLElement) => el.offsetWidth);
  const gods = new Map<string, God>(); // by agent key: landed, waiting to land, or waiting for a place
  const queue: God[] = []; // waiting to land, in the order they were sent
  const pool: God[] = []; // waiting unseen for a place, oldest first
  const laneTimers = new Set<SimEvent>();
  const recent: Record<"greeting" | "farewell", string[]> = { greeting: [], farewell: [] };
  let latest: readonly LaneAgent[] = [];
  let landTimer: SimEvent | null = null;
  let nextLandAt = -Infinity;
  let disposed = false;

  // The lane: open while anyone is out.
  let open = false;
  let readyAt = 0;
  let closing: SimEvent | null = null;
  let W = WIDE;
  const edgeL = EDGE;
  let edgeR = W - EDGE;

  // Every picture, fetched once up front, so no god is drawn before it is in.
  const preload = Object.values(opts.poses).flatMap((urls) =>
    Object.values(urls).map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    }),
  );

  function later(t: number, fn: () => void): SimEvent {
    const e = sim.at(t, () => {
      laneTimers.delete(e);
      fn();
    });
    laneTimers.add(e);
    return e;
  }

  // Places. A god's place is where its cell stands; its envelope, in the cell,
  // is all it can cover there. At its place a god faces the middle of the lane,
  // and its envelope turns with it: facing left, it is mirrored about the head
  // line. So the room two neighbours need depends on how each faces.
  const mid = (): number => W / 2 - HEAD; // the place whose head line is the middle of the lane
  const facing = (x: number): number => (x + HEAD < W / 2 ? 1 : -1);
  const envOf = (god: God): Range =>
    god.face < 0 ? [AXIS - god.c.env[1], AXIS - god.c.env[0]] : god.c.env;
  const seatMin = (god: God): number => edgeL - envOf(god)[0];
  const seatMax = (god: God): number => edgeR - envOf(god)[1];
  const pitch = (a: God, b: God): number => envOf(a)[1] - envOf(b)[0] + GAP; // a to the left of b

  // ───────── the lane ─────────
  function measureLane(): boolean {
    const w = Math.round(opts.width ? opts.width() : lane.clientWidth);
    // A lane that isn't laid out (its chat hidden) keeps the width it had.
    if (w <= 0 || w === W) return false;
    W = w;
    edgeR = W - EDGE;
    return true;
  }

  function openLane(t: number): void {
    if (closing) {
      sim.cancel(closing);
      laneTimers.delete(closing);
      closing = null;
    }
    if (open) return;
    open = true;
    lane.classList.remove("is-shut");
    measureLane();
    readyAt = t + LAND_STILL;
  }

  function maybeClose(t: number): void {
    if (gods.size || queue.length || closing || !open) return;
    closing = later(t + CLOSE_AFTER, () => {
      closing = null;
      if (!gods.size && !queue.length) shut();
    });
  }

  function shut(): void {
    open = false;
    lane.classList.add("is-shut");
  }

  // ───────── where gods may stand ─────────
  const working = (god: God): boolean => god.seg?.kind === "work";

  function span(god: God, x: number, pose: Pose, dir: number): Range {
    const [a, b] = god.c.fp[pose];
    return dir > 0 ? [x + a, x + b] : [x + AXIS - b, x + AXIS - a];
  }

  // The floor a god covers now: at its place, all it can cover there.
  function body(god: God): Range {
    if (working(god)) {
      const [a, b] = envOf(god);
      return [god.x + a, god.x + b];
    }
    return span(god, god.x, god.pose, god.dir);
  }

  // All a god can cover at a place, band by band: its envelope's outline there, as it faces.
  function reach(god: God, x: number): Box[] {
    const left = god.face < 0;
    return god.c.envol.map(([y, a, b]) => ({
      x0: x + (left ? AXIS - b : a),
      x1: x + (left ? AXIS - a : b),
      y0: TOP + y,
      y1: TOP + y + 2,
    }));
  }

  // ───────── ribbons: room for a line ─────────
  const COS = Math.cos((TILT * Math.PI) / 180);
  const TAN = Math.tan((TILT * Math.PI) / 180);
  const widths = new Map<string, number>();

  function ribbonEl(text: string, side: number): HTMLElement {
    const el = html("span", `oly-ribbon ${side > 0 ? "is-r" : "is-l"}`);
    const band = html("span", "oly-band");
    const initial = document.createElement("b");
    initial.textContent = text.slice(0, 1);
    band.append(initial, text.slice(1));
    el.append(band);
    return el;
  }

  // A line's length on the ribbon, in the reading serif: measured once.
  function ribbonW(text: string): number {
    let w = widths.get(text);
    if (w === undefined) {
      const el = ribbonEl(text, 1);
      el.style.visibility = "hidden";
      godsEl.append(el);
      w = measure(el);
      el.remove();
      widths.set(text, w);
    }
    return w;
  }

  // A line held out by a god standing at x: from the fingers, up and away at
  // the tilt, raised by lift. It runs along the floor from x0 to x1.
  function ribbonAt(god: God, x: number, side: number, lift: number, text: string): Rib {
    const [hx, hy] = god.c.hand;
    const ox = side > 0 ? x + hx - 2 : x + AXIS - hx + 2;
    const far = ribbonW(text) * COS + 1; // and the far end's corners, turned
    return {
      text,
      side,
      lift,
      ox,
      oy: TOP + hy - 2 - lift,
      reach: far,
      x0: side > 0 ? ox - 1 : ox - far,
      x1: side > 0 ? ox + far : ox + 1,
    };
  }

  // Its band's top and bottom where it passes over x.
  function bandAt(r: Rib, x: number): Range {
    const y = r.oy - clamp((x - r.ox) * r.side, 0, r.reach) * TAN;
    const h = RIB_HALF / COS;
    return [y - h, y + h];
  }

  // Whether a ribbon comes within RIB_PAD of a box.
  function grazes(r: Rib, b: Box): boolean {
    const lo = Math.max(r.x0, b.x0 - RIB_PAD);
    const hi = Math.min(r.x1, b.x1 + RIB_PAD);
    if (lo > hi) return false;
    const [t0, b0] = bandAt(r, lo);
    const [t1, b1] = bandAt(r, hi);
    return Math.min(t0, t1) < b.y1 + RIB_PAD && Math.max(b0, b1) > b.y0 - RIB_PAD;
  }

  // Whether two ribbons come within RIB_PAD of each other.
  function meet(r: Rib, q: Rib): boolean {
    const lo = Math.max(r.x0, q.x0) - RIB_PAD;
    const hi = Math.min(r.x1, q.x1) + RIB_PAD;
    for (let i = 0; i <= 8 && lo <= hi; i++) {
      const x = lerp(lo, hi, i / 8);
      const [a0, a1] = bandAt(r, x);
      const [c0, c1] = bandAt(q, x);
      if (a0 < c1 + RIB_PAD && c0 < a1 + RIB_PAD) return true;
    }
    return false;
  }

  // Whether a ribbon comes within RIB_PAD of a stretch of floor taken at full height.
  const across = (q: Rib, [lo, hi]: Range): boolean => q.x1 + RIB_PAD > lo && q.x0 - RIB_PAD < hi;
  const tall = ([x0, x1]: Range): Box => ({ x0, x1, y0: -Infinity, y1: Infinity });

  // A pose's figure along the floor from x, facing either way.
  function either(god: God, pose: Pose, x: number): Range {
    const [a, b] = god.c.fp[pose];
    return [x + Math.min(a, AXIS - b), x + Math.max(b, AXIS - a)];
  }

  const out = (g: God): boolean => g.landed && !g.gone;

  // Every line another god holds out now, or is kept for one landing.
  function ribbons(except: God): Rib[] {
    const held: Rib[] = [];
    for (const g of gods.values()) if (g !== except && out(g) && g.rib) held.push(g.rib);
    return held;
  }

  // What a god takes up while a line is held out near it. Standing, its
  // figure's floor at full height. At its place, the outline of its whole
  // envelope: a line clear of that stays clear whatever it does there. Still to
  // go to its place, all it can cover once it is there.
  function zone(g: God): Box[] {
    const boxes = working(g) ? reach(g, g.x) : [tall(either(g, g.pose, g.x))];
    if (g.seat != null && !g.ending && (Math.abs(g.seat - g.x) > 1.5 || !working(g)))
      boxes.push(...reach(g, g.seat));
    return boxes;
  }

  interface Near {
    readonly boxes: readonly Box[];
    readonly held: readonly Rib[];
  }

  // All a line held out by this god now must keep off.
  function around(god: God): Near {
    const boxes: Box[] = [];
    for (const g of gods.values()) if (g !== god && out(g)) boxes.push(...zone(g));
    return { boxes, held: ribbons(god) };
  }

  // Whether a god standing at x may hold this ribbon out: inside the lane,
  // clear of everything around it, and the god not standing up into another's.
  function clear(god: God, x: number, r: Rib, near: Near): boolean {
    if (r.x0 < edgeL || r.x1 > edgeR || bandAt(r, r.side > 0 ? r.x1 : r.x0)[0] < RIB_TOP)
      return false;
    const fig = span(god, x, "speak", r.side);
    if (near.held.some((q) => across(q, fig) || meet(r, q))) return false;
    return !near.boxes.some((b) => grazes(r, b));
  }

  // Where a god standing at x may hold this line out in full: toward the
  // middle of the lane first, then the other way, then a little higher.
  function placeRibbon(god: God, x: number, text: string, near: Near): Rib | null {
    const first = facing(x);
    for (const lift of LIFTS) {
      for (const side of [first, -first]) {
        const r = ribbonAt(god, x, side, lift, text);
        if (clear(god, x, r, near)) return r;
      }
    }
    return null;
  }

  // What every other god holds: where it is, and the place it is bound for.
  function claims(except: God): Range[] {
    const held: Range[] = [];
    for (const g of gods.values()) {
      if (g === except || !out(g)) continue;
      let [lo, hi] = body(g);
      if (g.seat != null) {
        const [a, b] = envOf(g);
        lo = Math.min(lo, g.seat + a);
        hi = Math.max(hi, g.seat + b);
      }
      held.push([lo, hi]);
    }
    return held;
  }

  const byseat = (): (God & { seat: number })[] =>
    [...gods.values()]
      .filter((g): g is God & { seat: number } => g.seat != null && !g.gone)
      .sort((a, b) => a.seat - b.seat);

  // Spread a crowd over the lane, left to right in this order: each pair as far
  // apart as their envelopes need, with air between where there is room, a
  // little off the middle and not quite even.
  function evenSeats(order: readonly God[]): number[] {
    const n = order.length;
    const need = [0]; // each one's place from the first's, at the least
    for (let i = 1; i < n; i++) need.push(need[i - 1]! + pitch(order[i - 1]!, order[i]!));
    const lo = seatMin(order[0]!);
    const slack = Math.max(0, seatMax(order[n - 1]!) - need[n - 1]! - lo);
    const air = n > 1 ? Math.min(AIR, slack / (n - 1)) : 0;
    const start = lo + (slack - air * (n - 1)) * (0.25 + 0.5 * random());
    const jit = Math.min(7, air / 2);
    return order.map((g, i) =>
      clamp(
        start + need[i]! + i * air + (n > 1 ? (random() - 0.5) * 2 * jit : 0),
        seatMin(g),
        seatMax(g),
      ),
    );
  }

  // The least anyone has to move for everyone to have room: places in order,
  // each pair at least its pitch apart, the first and the last inside the lane.
  // Those in stay don't move at all; null if that leaves the ones between them
  // without room, even a little nearer than the gap.
  function spread(all: readonly Placed[], stay: ReadonlySet<God>): number[] | null {
    const seats = all.map((o) => o.x);
    for (let i = 0; i < all.length; i++) {
      if (stay.has(all[i]!.g)) continue;
      // all[i..j] may move, between whoever stays either side of them, or the lane's ends
      let j = i;
      while (j + 1 < all.length && !stay.has(all[j + 1]!.g)) j++;
      const need = [0];
      for (let k = i + 1; k <= j; k++)
        need.push(need[need.length - 1]! + pitch(all[k - 1]!.g, all[k]!.g));
      const lo = i ? seats[i - 1]! + pitch(all[i - 1]!.g, all[i]!.g) : seatMin(all[i]!.g);
      const hi =
        (j + 1 < all.length
          ? seats[j + 1]! - pitch(all[j]!.g, all[j + 1]!.g)
          : seatMax(all[j]!.g)) - need[j - i]!;
      if (hi < lo - SQUEEZE) return null;
      const blocks: { s: number; n: number }[] = [];
      for (let k = i; k <= j; k++) {
        blocks.push({ s: all[k]!.x - need[k - i]!, n: 1 });
        while (blocks.length > 1) {
          const b = blocks[blocks.length - 1]!;
          const a = blocks[blocks.length - 2]!;
          if (a.s / a.n <= b.s / b.n) break;
          a.s += b.s;
          a.n += b.n;
          blocks.pop();
        }
      }
      let k = i;
      for (const b of blocks)
        for (let m = 0; m < b.n; m++, k++)
          seats[k] = (hi < lo ? (lo + hi) / 2 : clamp(b.s / b.n, lo, hi)) + need[k - i]!;
      i = j;
    }
    return seats;
  }

  // A place for a god about to land. False if there is no room for it yet.
  function planSeat(god: God, t: number): boolean {
    if (god.seat != null) return true;
    const others = byseat();
    if (!others.length) {
      // A first crowd: everyone sent so far gets a place now, in a random order along the lane.
      const order = queue.filter((g) => g.seat == null);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      // The left half of them face right and the right half left; an odd one in the middle, either.
      order.forEach((g, i) => {
        const side = i - (order.length - 1) / 2;
        g.face = side < 0 ? 1 : side > 0 ? -1 : random() < 0.5 ? 1 : -1;
      });
      const seats = evenSeats(order);
      order.forEach((g, i) => (g.seat = seats[i]!));
      // One alone has no half to be in: it faces the middle from where it stands.
      if (order.length === 1) {
        const g = order[0]!;
        g.face = facing(g.seat!);
        g.seat = clamp(g.seat!, seatMin(g), seatMax(g));
      }
      return true;
    }
    const face = god.face;
    const best = gapFor(god, others);
    god.face = best.face; // kept while it has this place: stepping aside doesn't turn it
    const all: Placed[] = [...others.map((g) => ({ g, x: g.seat })), { g: god, x: best.x }].sort(
      (a, b) => a.x - b.x,
    );
    // Whoever would step aside only a little stays where it is, if the lane
    // works out without it: the one asked to move least first, and the rest
    // looked at again each time one stays.
    const stay = new Set<God>();
    let seats = spread(all, stay);
    if (!seats) {
      // Not without two places overlapping: it waits for one to be left.
      god.face = face;
      return false;
    }
    for (let held = true; held;) {
      held = false;
      const few = all
        .map((o, i) => ({ g: o.g, d: Math.abs(seats![i]! - o.x) }))
        .filter((o) => o.g !== god && !stay.has(o.g) && o.d <= SHIFT_MIN)
        .sort((a, b) => a.d - b.d);
      for (const { g } of few) {
        stay.add(g);
        const tried = spread(all, stay);
        if (tried) {
          seats = tried;
          held = true;
          break;
        }
        stay.delete(g);
      }
    }
    all.forEach((o, i) => {
      if (o.g === god) god.seat = seats![i]!;
      else if (Math.abs(seats![i]! - o.x) > 0.5) reseat(o.g, seats![i]!, t);
    });
    return true;
  }

  // A later one takes the gap with most room for it; if that is too narrow, the
  // nearest make room. It faces the middle from the gap it takes, and its
  // envelope turns with it, so each gap is measured as it would stand there.
  // It draws no dice. god.face is left as the last gap tried; the caller sets it.
  function gapFor(
    god: God,
    others: readonly (God & { seat: number })[],
  ): { x: number; room: number; face: number } {
    let best: { x: number; room: number; face: number } | null = null;
    const consider = (gap: () => { x: number; room: number }): void => {
      let o = { x: 0, room: 0 };
      for (const face of [1, -1]) {
        god.face = face;
        o = gap();
        if (facing(o.x) === face) break;
      }
      if (
        !best ||
        o.room > best.room + 4 ||
        (Math.abs(o.room - best.room) <= 4 && Math.abs(o.x - mid()) < Math.abs(best.x - mid()))
      )
        best = { ...o, face: god.face };
    };
    const first = others[0]!;
    const last = others[others.length - 1]!;
    consider(() => {
      const x = Math.max(seatMin(god), first.seat - pitch(god, first) - AIR);
      return { x, room: first.seat - pitch(god, first) - x };
    });
    consider(() => {
      const x = Math.min(seatMax(god), last.seat + pitch(last, god) + AIR);
      return { x, room: x - last.seat - pitch(last, god) };
    });
    for (let i = 0; i + 1 < others.length; i++) {
      consider(() => {
        const lo = others[i]!.seat + pitch(others[i]!, god);
        const hi = others[i + 1]!.seat - pitch(god, others[i + 1]!);
        return { x: (lo + hi) / 2, room: (hi - lo) / 2 };
      });
    }
    return best!;
  }

  interface Entry {
    readonly x: number;
    readonly text: string | null;
    readonly r: Rib | null;
  }

  // Where a god is set, and the greeting it will say there: at its place, once
  // nobody is in it and no ribbon is, with a line that can be held out in full.
  // If none fits yet, it is set anyway, and looks for room for a line once it is.
  function entryFor(god: God): Entry | null {
    const taken = claims(god);
    const held = ribbons(god);
    const x = god.seat!;
    const [a, b] = either(god, "speak", x);
    const free =
      x + 4 >= edgeL - 6 &&
      x + 64 <= edgeR + 6 &&
      taken.every(([lo, hi]) => b + 2 <= lo || a - 2 >= hi) &&
      !held.some((q) => across(q, [a - SPREAD, b + SPREAD]));
    if (!free) return null;
    const near = around(god);
    const said = pickLine("greeting", god, (text) => placeRibbon(god, x, text, near));
    return said ? { x, text: said.text, r: said.r } : { x, text: null, r: null };
  }

  // A line for a god to say, of those fit(text) finds room for: its own most
  // often, or one any god may, and never what the last three gods said.
  function pickLine(
    kind: "greeting" | "farewell",
    god: God,
    fit: (text: string) => Rib | null,
  ): { text: string; r: Rib } | null {
    const avoid = recent[kind];
    const found: { text: string; w: number; r: Rib }[] = [];
    let total = 0;
    for (const [text, who] of LINES[kind]) {
      const w = avoid.includes(text) ? 0 : who === god.gid ? 3 : who === "*" ? 1 : 0;
      const r = w > 0 ? fit(text) : null;
      if (!r) continue;
      found.push({ text, w, r });
      total += w;
    }
    if (!total) return null;
    let dice = random() * total;
    let chosen = found[found.length - 1]!;
    for (const o of found) {
      dice -= o.w;
      if (dice <= 0) {
        chosen = o;
        break;
      }
    }
    avoid.push(chosen.text);
    if (avoid.length > 3) avoid.shift();
    return { text: chosen.text, r: chosen.r };
  }

  // ───────── a god ─────────
  function makeGod(a: LaneAgent): God {
    const c = CAST.gods[a.god];
    const el = html("div", "oly-cell");
    el.dataset.god = a.god;
    el.style.setProperty("--oly-ex", `${c.seal[0]}px`);
    el.style.setProperty("--oly-ey", `${c.seal[1]}px`);
    const fig = html("div", "oly-fig");
    const poses = html("div", "oly-poses");
    for (const pose of POSES) {
      const img = document.createElement("img");
      img.className = `oly-pose oly-p-${pose}`;
      img.src = opts.poses[a.god][pose];
      img.alt = "";
      img.draggable = false;
      poses.append(img);
    }
    const seal = svg("svg", { class: "oly-seal", viewBox: CAST.seal.viewBox });
    grow(seal, CAST.seal.nodes);
    const fissure = svg("svg", {
      class: "oly-fissure",
      viewBox: `0 0 ${CAST.cell.w} ${CAST.cell.h}`,
    });
    grow(fissure, c.fissure);
    fig.append(poses, seal, fissure);
    el.append(fig);
    const label = html("p", "oly-ins");
    label.textContent = c.name; // the god's own name; the agent's is in its row
    return {
      key: a.key,
      gid: a.god,
      c,
      el,
      label,
      labelW: 0,
      ribbon: null,
      rib: null,
      line: null,
      said: null,
      waiting: null,
      x: 0,
      dir: 1,
      face: 1,
      pose: "speak",
      seat: null,
      landed: false,
      gone: false,
      ending: null,
      seg: null,
      sealed: false,
      dim: false,
      crack: false,
      out: {},
    };
  }

  // At its place: it stands there, facing the middle.
  function work(god: God, t: number): void {
    const seat = god.seat!;
    // Not into a line held out across its place: it waits for that to be furled.
    const held = ribbons(god);
    god.pose = "stand";
    if (held.length && reach(god, seat).some((b) => held.some((q) => grazes(q, b))))
      return wait(god, t, (t2) => (god.ending ? ending(god, t2) : work(god, t2)));
    god.x = seat;
    god.dir = god.face;
    enter(god, "work", t, Infinity);
  }

  function enter(god: God, kind: Seg["kind"], t: number, dur: number, then?: Seg["then"]): void {
    if (god.seg?.timer) sim.cancel(god.seg.timer);
    const seg: Seg = { kind, t1: t + dur, then };
    god.seg = seg;
    if (Number.isFinite(seg.t1)) {
      seg.timer = sim.at(seg.t1, () => {
        if (god.seg === seg && !god.gone) next(god, seg);
      });
    }
  }

  function next(god: God, seg: Seg): void {
    const t = seg.t1;
    switch (seg.kind) {
      case "greet":
        unsay(god);
        return god.ending ? ending(god, t) : work(god, t);
      case "report":
        unsay(god);
        god.pose = "stand";
        god.sealed = true;
        return enter(god, "seal", t, SEALED);
      case "seal":
      case "fail":
        return remove(god, t);
      case "hold":
        return seg.then?.(t);
      default:
        return undefined;
    }
  }

  function land(god: God, t: number, at: Entry): void {
    god.landed = true;
    god.x = at.x;
    god.line = at.text;
    god.waiting = null;
    god.rib = at.r; // the room for its greeting is kept for it
    god.dir = at.r ? at.r.side : facing(at.x);
    godsEl.append(god.el);
    namesEl.append(god.label);
    god.labelW = measure(god.label);
    speak(god, t, "greet");
  }

  function speak(god: God, t: number, kind: Saying): void {
    const x = god.x;
    const report = kind === "report";
    // Ended while it waited for room to greet: it has nothing to say now.
    if (!report && god.ending) return ending(god, t);
    const near = around(god);
    const fits = (text: string): Rib | null => placeRibbon(god, x, text, near);
    let r: Rib | null;
    if (report) r = pickLine("farewell", god, fits)?.r ?? null;
    else if (god.line)
      // The room kept for its greeting, if nothing has come into it; else wherever the line fits.
      r = god.rib && clear(god, x, god.rib, near) ? god.rib : fits(god.line);
    else r = pickLine("greeting", god, fits)?.r ?? null;
    if (!r) {
      god.rib = null;
      god.waiting ??= t;
      const waited = t - god.waiting;
      // Room only for a line just said: it won't say that again, and won't wait long for another.
      const stale =
        !god.line &&
        LINES[report ? "farewell" : "greeting"].some(
          ([text, who]) => (who === god.gid || who === "*") && fits(text),
        );
      const limit = stale ? BYE_STUCK : report ? BYE_WAIT : GREET_WAIT;
      god.pose = "stand"; // standing by, waiting for room to say it
      if (waited < limit && !(report && waited >= BYE_STUCK && stuck(god)))
        return wait(god, t, (t2) => speak(god, t2, kind));
      // No room came: it goes on without a word.
      god.waiting = null;
      god.line = null;
      if (!report) return god.ending ? ending(god, t) : work(god, t);
      god.sealed = true;
      return enter(god, "seal", t, SEALED);
    }
    god.waiting = null;
    god.rib = r;
    god.dir = r.side;
    god.pose = "speak";
    const el = ribbonEl(r.text, r.side);
    const [hx, hy] = god.c.hand;
    if (r.side > 0) el.style.left = `${(hx - 2).toFixed(1)}px`;
    else el.style.right = `${(CAST.cell.w - (AXIS - hx) - 2).toFixed(1)}px`;
    el.style.top = `${(hy - 9.5 - r.lift).toFixed(1)}px`;
    el.style.transform = `rotate(${-r.side * TILT}deg)`;
    god.el.append(el);
    god.ribbon = el;
    god.said = r.text;
    god.line = null;
    enter(god, report ? "report" : "greet", t, SAID);
  }

  function unsay(god: God): void {
    god.ribbon?.remove();
    god.ribbon = null;
    god.rib = null;
  }

  // Whether nothing on the lane will move to make room for a farewell: everyone
  // else is at their place or waiting to say one too, and this god has waited
  // longest. Then it goes without a word, and its going makes room for the rest.
  function stuck(god: God): boolean {
    for (const g of gods.values()) {
      if (g === god || !out(g)) continue;
      const k = g.seg?.kind;
      if (!g.ending && k === "work") continue;
      if (k !== "hold" || g.ending !== "done" || g.waiting == null) return false;
      if (g.waiting < god.waiting! || (g.waiting === god.waiting && g.x < god.x)) return false;
    }
    return true;
  }

  // No room yet: it stays as it is and looks again in a moment.
  function wait(god: God, t: number, then: (t: number) => void): void {
    enter(god, "hold", t, HOLD, then);
  }

  // A god moved over to make room: at its place, it is there at once.
  function reseat(god: God, seat: number, t: number): void {
    god.seat = seat;
    if (god.landed && !god.ending && working(god)) work(god, t);
  }

  // Done, it says its farewell; failed or stopped, it stands dimmed.
  function ending(god: God, t: number): void {
    if (god.ending === "done") return speak(god, t, "report");
    unsay(god);
    god.pose = "stand";
    god.dim = true;
    god.crack = god.ending === "fail";
    enter(god, "fail", t, FAIL_HOLD);
  }

  function remove(god: God, t: number): void {
    god.gone = true;
    if (god.seg?.timer) sim.cancel(god.seg.timer);
    god.seat = null;
    god.el.remove();
    god.label.remove();
    gods.delete(god.key);
    const i = queue.indexOf(god);
    if (i >= 0) queue.splice(i, 1);
    const k = pool.indexOf(god);
    if (k >= 0) pool.splice(k, 1);
    // Sent on again while it was going: it is summoned again.
    const a = latest.find((o) => o.key === god.key);
    if (a?.look === "run") summon(a, t);
    drawPool(t);
    maybeClose(t);
  }

  function finish(god: God, kind: Ending, t: number): void {
    if (god.ending) return;
    god.ending = kind;
    // Finished before it ever landed: it never comes out.
    if (!god.landed) return remove(god, t);
    if (working(god)) ending(god, t);
    // anything else it finishes first; next() sees the ending
  }

  // ───────── waiting for a place ─────────
  // A record waits unseen if anyone is waiting already, so nobody overtakes
  // it; if five gods that aren't ending are on the lane or waiting to land; or
  // if its place couldn't be planned without two places overlapping.
  const working5 = (except: God): number =>
    [...gods.values()].filter(
      (g) => g !== except && !g.ending && !g.gone && (g.landed || queue.includes(g)),
    ).length;

  function fitsOn(god: God): boolean {
    const others = byseat().filter((g) => !g.ending);
    if (!others.length) return true;
    const face = god.face;
    const best = gapFor(god, others);
    god.face = best.face;
    const all: Placed[] = [...others.map((g) => ({ g, x: g.seat })), { g: god, x: best.x }].sort(
      (a, b) => a.x - b.x,
    );
    const ok = spread(all, new Set()) !== null;
    god.face = face;
    return ok;
  }

  // While fewer than five gods are on the lane or wait to land, the oldest
  // waiting goes to the landing queue.
  function drawPool(t: number): void {
    while (pool.length) {
      const held = [...gods.values()].filter(
        (g) => !g.gone && (g.landed || queue.includes(g)),
      ).length;
      if (held >= CAPACITY || !fitsOn(pool[0]!)) return;
      queue.push(pool.shift()!);
      scheduleLanding(t);
    }
  }

  function summon(a: LaneAgent, t: number): void {
    const god = makeGod(a);
    gods.set(a.key, god);
    if (pool.length > 0 || working5(god) >= CAPACITY || !fitsOn(god)) {
      pool.push(god);
      return;
    }
    queue.push(god);
    openLane(t);
    scheduleLanding(t);
  }

  // ───────── landing ─────────
  function scheduleLanding(t: number, from = t): void {
    if (landTimer || !queue.length || !open) return;
    landTimer = sim.at(Math.max(from, readyAt, nextLandAt), () => {
      landTimer = null;
      landNext(sim.now());
    });
  }

  function landNext(t: number): void {
    const god = queue[0];
    if (!god || !open) return;
    const at = planSeat(god, t) ? entryFor(god) : null;
    if (!at) return scheduleLanding(t, t + RETRY);
    queue.shift();
    nextLandAt = t + LAND_GAP;
    land(god, t, at);
    scheduleLanding(t);
  }

  // ───────── one frame ─────────
  function put<T>(god: God, key: string, value: T, write: (value: T) => void): void {
    if (god.out[key] === value) return;
    god.out[key] = value;
    write(value);
  }

  function renderGod(god: God): void {
    const el = god.el;
    put(god, "tx", `translate3d(${god.x.toFixed(2)}px, 0, 0)`, (tx) => (el.style.transform = tx));
    put(god, "dir", god.dir < 0, (left) => el.classList.toggle("is-left", left));
    put(god, "pose", god.pose, (pose) => (el.dataset.pose = pose));
    put(god, "sealed", god.sealed, (on) => el.classList.toggle("is-sealed", on));
    put(god, "speaking", god.ribbon !== null, (on) => el.classList.toggle("is-speaking", on));
    put(god, "dim", god.dim, (on) => el.classList.toggle("is-dim", on));
    put(god, "crack", god.crack, (on) => el.classList.toggle("is-cracked", on));
  }

  // The names on the stylobate, under their gods, kept apart and inside the step.
  function renderNames(): void {
    const list: { god: God; c: number; w: number }[] = [];
    for (const god of gods.values()) {
      if (!out(god)) continue;
      // At its place its name stays where its standing name is, as it faces there.
      const at = working(god);
      const [a, b] = god.c.fp[at ? "stand" : god.pose];
      const middle = (at ? god.face : god.dir) > 0 ? (a + b) / 2 : AXIS - (a + b) / 2;
      list.push({ god, c: god.x + middle, w: god.labelW });
    }
    list.sort((p, q) => p.c - q.c);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1]!;
        const q = list[i]!;
        const min = (p.w + q.w) / 2 + 12;
        if (q.c - p.c < min) {
          const push = (min - (q.c - p.c)) / 2;
          p.c -= push;
          q.c += push;
        }
      }
      for (const n of list) n.c = clamp(n.c, n.w / 2 + 14, W - n.w / 2 - 14);
    }
    for (const n of list)
      put(
        n.god,
        "name",
        `translate3d(${(n.c - n.w / 2).toFixed(2)}px, 0, 0)`,
        (tx) => (n.god.label.style.transform = tx),
      );
  }

  sim.view(() => {
    if (disposed) return false;
    for (const god of gods.values()) if (out(god)) renderGod(god);
    renderNames();
    return false; // stills: nothing moves between one step and the next
  });

  function reconcile(agents: readonly LaneAgent[]): void {
    const t = sim.now();
    latest = agents;
    const seen = new Set<string>();
    for (const a of agents) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      const god = gods.get(a.key);
      if (!god) {
        if (a.look === "run") summon(a, t); // else it finished before the floor saw it
        continue;
      }
      if (a.look !== "run") finish(god, a.look, t);
    }
    for (const god of [...gods.values()]) if (!seen.has(god.key)) remove(god, t);
  }

  let synced = "";

  return {
    sync(agents) {
      if (disposed) return;
      const now = agents.map((a) => `${a.key} ${a.god} ${a.look}`).join("\n");
      if (now === synced) return;
      synced = now;
      const records = [...agents];
      sim.soon(() => reconcile(records));
    },
    resize() {
      if (disposed) return;
      sim.soon(() => {
        if (!open || !measureLane()) return;
        // Everyone keeps its order and its facing, and takes the nearest place there is room for.
        const t = sim.now();
        const all = byseat().map((g) => ({ g, x: clamp(g.seat, seatMin(g), seatMax(g)) }));
        const seats = spread(all, new Set()) ?? all.map((o) => o.x);
        all.forEach((o, i) => reseat(o.g, seats[i]!, t));
      });
    },
    remeasure() {
      if (disposed) return;
      sim.soon(() => {
        for (const god of gods.values()) {
          if (!god.landed) continue;
          god.labelW = measure(god.label);
          god.out.name = null;
        }
      });
    },
    peek: () => ({
      open,
      width: W,
      queue: queue.map((g) => g.key),
      waiting: pool.map((g) => g.key),
      gods: [...gods.values()].filter(out).map((g) => {
        const [a, b] = envOf(g);
        return {
          key: g.key,
          god: g.gid,
          x: g.x,
          figure: span(g, g.x, g.pose, g.dir),
          place: g.seat == null ? null : ([g.seat + a, g.seat + b] as const),
          face: g.face,
          pose: g.pose,
          step: g.seg?.kind ?? "",
          line: g.ribbon ? g.said : null,
          ribbon: g.ribbon && g.rib ? ([g.rib.x0, g.rib.x1] as const) : null,
          ending: g.ending,
        };
      }),
    }),
    dispose() {
      disposed = true;
      for (const god of gods.values()) {
        god.gone = true;
        if (god.seg?.timer) sim.cancel(god.seg.timer);
        god.el.remove();
        god.label.remove();
      }
      gods.clear();
      queue.length = 0;
      pool.length = 0;
      for (const e of laneTimers) sim.cancel(e);
      laneTimers.clear();
      sim.cancel(landTimer);
      landTimer = null;
      preload.length = 0;
      shut();
    },
  };
}
