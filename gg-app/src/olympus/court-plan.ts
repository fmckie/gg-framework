// The courtyard's plan: Olympus in side view, three terraces joined by two
// stairs. Where each zone's slots are for a given width, which zone a worker
// belongs in, and the way from one spot to another. Pure: no DOM, no clock.

import type { ToolFamily } from "./tool-family";

export const COURT = {
  // A terrace: a mosaic floor over a marble step.
  floor: 104,
  tread: 22,
  terrace: 126,
  height: 378,
  cell: { w: 73, h: 100, head: 33 },
  // A flight: its steps, and how far from the wall its head is.
  stair: { steps: 9, tread: 9, rise: 14, landing: 34, pace: 0.8 },
  // A slot's head line is kept this far inside the stage, and off a stair's foot.
  edge: 48,
  clear: 30,
  gap: 16,
  pitch: 56,
  most: 5,
  // A name's reach past its slot, kept off a flight's top steps.
  reach: 53,
  temple: { clear: 46, pitch: 52, side: 3, reach: 36 },
  // A god stays this long at a place before it moves again, ms.
  dwell: 2500,
  // The court is three lanes long: its gods walk this much faster than on the lane.
  pace: 1.6,
  gate: -44,
} as const;

export type Level = 0 | 1 | 2;
// The mosaic each level is floored with, from the ground up.
export const LEVEL_SCENES = ["agora", "grove", "temple"] as const;

// A work zone is named for the family of tool done there.
export type ZoneId = "make" | "run" | "look" | "web" | "temple";
export const ZONES: readonly ZoneId[] = ["make", "run", "look", "web", "temple"];
export type CourtStatus = "working" | "idle" | "done" | "failed" | "stopped";

export interface Slot {
  readonly x: number;
  readonly face: 1 | -1;
}
export interface Zone {
  readonly id: ZoneId;
  readonly level: Level;
  // In the order they are taken.
  readonly slots: readonly Slot[];
}
export interface Stair {
  readonly lower: Level;
  // Which way it climbs.
  readonly dir: 1 | -1;
  readonly approach: number;
  readonly foot: number;
  readonly head: number;
}
export interface Spot {
  readonly level: Level;
  readonly x: number;
}
export interface CourtPlan {
  readonly width: number;
  readonly zones: Readonly<Record<ZoneId, Zone>>;
  // Agora to grove, then grove to temple.
  readonly stairs: readonly [Stair, Stair];
  readonly hearth: number;
  readonly gate: Spot;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const smooth = (v: number): number => {
  const u = clamp(v, 0, 1);
  return u * u * (3 - 2 * u);
};

const RUN = (COURT.stair.steps - 1) * COURT.stair.tread;
const FLIGHT = Math.hypot(
  COURT.stair.steps * COURT.stair.tread,
  COURT.stair.steps * COURT.stair.rise,
);

// The order n slots in a row are taken: the middle, then whichever is farthest from those taken.
function spread(n: number): number[] {
  const order = [Math.floor((n - 1) / 2)];
  while (order.length < n) {
    let best = -1;
    let far = -1;
    for (let i = 0; i < n; i++) {
      if (order.includes(i)) continue;
      const d = Math.min(...order.map((o) => Math.abs(o - i)));
      if (d > far) [far, best] = [d, i];
    }
    order.push(best);
  }
  return order;
}

function row(from: number, to: number, face: 1 | -1): Slot[] {
  if (to <= from) return [{ x: Math.round((from + to) / 2), face }];
  const n = clamp(Math.floor((to - from) / COURT.pitch) + 1, 1, COURT.most);
  const at = (i: number): number =>
    n === 1 ? (from + to) / 2 : from + (i * (to - from)) / (n - 1);
  return spread(n).map((i) => ({ x: Math.round(at(i)), face }));
}

function halves(from: number, to: number): [Slot[], Slot[]] {
  const mid = (from + to) / 2;
  return [row(from, mid - COURT.gap / 2, 1), row(mid + COURT.gap / 2, to, -1)];
}

export function planCourt(width: number): CourtPlan {
  const W = Math.max(0, Math.round(width));
  const { landing, tread } = COURT.stair;
  const up: Stair = {
    lower: 0,
    dir: 1,
    approach: W - landing - RUN - tread,
    foot: W - landing - RUN,
    head: W - landing,
  };
  const top: Stair = {
    lower: 1,
    dir: -1,
    approach: landing + RUN + tread,
    foot: landing + RUN,
    head: landing,
  };
  const [make, run] = halves(COURT.edge, up.approach - COURT.clear);
  // Short of the first flight's top steps, which cross the grove's step: a name is carved clear of them.
  const [look, web] = halves(top.approach + COURT.clear, up.head - COURT.reach);
  const hearth = Math.round(W / 2);
  const T = COURT.temple;
  const side = clamp(
    Math.floor((hearth - T.clear - (top.head + T.reach)) / T.pitch) + 1,
    0,
    T.side,
  );
  // Round the hearth: the nearest place first, a side at a time.
  const temple: Slot[] = [];
  for (let i = 0; i < side; i++) {
    temple.push({ x: hearth - T.clear - i * T.pitch, face: 1 });
    temple.push({ x: hearth + T.clear + i * T.pitch, face: -1 });
  }
  return {
    width: W,
    zones: {
      make: { id: "make", level: 0, slots: make },
      run: { id: "run", level: 0, slots: run },
      look: { id: "look", level: 1, slots: look },
      web: { id: "web", level: 1, slots: web },
      temple: { id: "temple", level: 2, slots: temple },
    },
    stairs: [up, top],
    hearth,
    gate: { level: 0, x: COURT.gate },
  };
}

// Where a worker belongs. Thinking, idle or ended, it stays where it is; with no place yet,
// it is where its last tool's work is done, or by the gate.
export function placeFor(status: CourtStatus, family: ToolFamily, current: ZoneId | null): ZoneId {
  if (status === "done") return "temple";
  if (current && (status !== "working" || family === "think")) return current;
  return family === "think" ? "make" : family;
}

export function freeSlot(zone: Zone, taken: ReadonlySet<number>): number | null {
  for (let i = 0; i < zone.slots.length; i++) if (!taken.has(i)) return i;
  return null;
}

// A flight's outline from its foot to its head: x, and the height above its lower terrace.
export function stairProfile(stair: Stair): [number, number][] {
  const { steps, tread, rise } = COURT.stair;
  const points: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const x = stair.foot + stair.dir * i * tread;
    points.push([x, i * rise], [x, (i + 1) * rise]);
  }
  return points;
}

// How high a walker's feet are on a flight: none at its approach, a terrace at its head.
export function climb(stair: Stair, x: number): number {
  const { steps, tread, rise } = COURT.stair;
  const v = clamp(((x - stair.approach) * stair.dir) / tread, 0, steps);
  const k = Math.floor(v);
  // The foot comes up over the end of each tread, onto the next.
  return rise * Math.min(steps, k + smooth((v - k - 0.6) / 0.4));
}

export interface Leg {
  readonly kind: "walk" | "stair";
  readonly x0: number;
  readonly x1: number;
  readonly from: Level;
  readonly to: Level;
  readonly stair: Stair | null;
  readonly ms: number;
}

// The way from one spot to another at a god's pace, px a second: along each terrace and over the stairs between.
export function route(plan: CourtPlan, from: Spot, to: Spot, speed: number): Leg[] {
  const legs: Leg[] = [];
  const pace = Math.max(1, speed * COURT.pace);
  let { level, x } = from;
  const walk = (x1: number): void => {
    if (x1 !== x)
      legs.push({
        kind: "walk",
        x0: x,
        x1,
        from: level,
        to: level,
        stair: null,
        ms: (Math.abs(x1 - x) / pace) * 1000,
      });
    x = x1;
  };
  while (level !== to.level) {
    const up = to.level > level;
    const next = (up ? level + 1 : level - 1) as Level;
    const stair = plan.stairs[Math.min(level, next)]!;
    const [a, b] = up ? [stair.approach, stair.head] : [stair.head, stair.approach];
    walk(a);
    legs.push({
      kind: "stair",
      x0: a,
      x1: b,
      from: level,
      to: next,
      stair,
      ms: (FLIGHT / (pace * COURT.stair.pace)) * 1000,
    });
    x = b;
    level = next;
  }
  walk(to.x);
  return legs;
}

export const routeMs = (legs: readonly Leg[]): number => legs.reduce((ms, leg) => ms + leg.ms, 0);

export interface Along {
  readonly x: number;
  // How far above the agora's floor its feet are.
  readonly lift: number;
  readonly dir: 1 | -1;
  readonly leg: number;
  readonly on: "walk" | "stair";
  readonly over: boolean;
}

// Where a walker is, t ms into its way. Null for a way with no legs.
export function routeAt(legs: readonly Leg[], t: number): Along | null {
  let u = Math.max(0, t);
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const last = i === legs.length - 1;
    if (u >= leg.ms && !last) {
      u -= leg.ms;
      continue;
    }
    const k = leg.ms > 0 ? Math.min(1, u / leg.ms) : 1;
    const x = leg.x0 + (leg.x1 - leg.x0) * k;
    const lift =
      leg.stair === null
        ? leg.from * COURT.terrace
        : leg.stair.lower * COURT.terrace + climb(leg.stair, x);
    return { x, lift, dir: leg.x1 < leg.x0 ? -1 : 1, leg: i, on: leg.kind, over: last && k >= 1 };
  }
  return null;
}

// A walker sent somewhere else, t ms into its way: it turns where it is on a terrace, and at a flight's end.
export function reroute(
  plan: CourtPlan,
  legs: readonly Leg[],
  t: number,
  to: Spot,
  speed: number,
): Leg[] {
  const at = routeAt(legs, t);
  if (!at) return [];
  const leg = legs[at.leg]!;
  if (leg.kind === "walk" || at.over) return route(plan, { level: leg.to, x: at.x }, to, speed);
  const before = legs.slice(0, at.leg).reduce((ms, l) => ms + l.ms, 0);
  const rest: Leg = { ...leg, x0: at.x, ms: Math.max(0, leg.ms - (Math.max(0, t) - before)) };
  return [rest, ...route(plan, { level: leg.to, x: leg.x1 }, to, speed)];
}
