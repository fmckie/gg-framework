// The courtyard's engine: a goal's Workers view as Olympus in side view.
// It builds the stage (three terraces, two flights, the hearth), lays the
// three floors, and keeps a god for each worker where court-plan.ts says its
// kind of work is done. As on the lane, where everything is follows from the
// records and the time alone, on sim.ts's clock: steps go on the clock, and
// a frame only draws.

import type { Cast, CastGod, Frames, Pictures, Pose, Skill, SvgNode } from "./cast";
import { POSES } from "./cast";
import {
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
  type CourtPlan,
  type CourtStatus,
  type Leg,
  type Level,
  type Spot,
  type ZoneId,
} from "./court-plan";
import {
  deal,
  fidgetAt,
  nextAt,
  shown,
  STILL,
  type Dealt,
  type FidgetAt,
  type Shown,
} from "./fidget";
import { rng } from "./floor";
import type { GodId } from "./gods";
import {
  cropFloor,
  drawFloor,
  layScene,
  MOSAIC,
  SET_END,
  type LaidFloor,
  type SceneId,
} from "./mosaic";
import type { Sim, SimEvent } from "./sim";
import type { ToolFamily } from "./tool-family";

// Finished: a stretch of the goal's work is over and came to something.
export type HearthState = "working" | "idle" | "waiting" | "finished";

// A worker, as its row has it.
export interface CourtAgent {
  readonly key: string;
  readonly god: GodId;
  readonly label: string;
  readonly status: CourtStatus;
  // The family of its latest tool; think before its first.
  readonly family: ToolFamily;
}

export interface CourtOptions {
  readonly sim: Sim;
  readonly cast: Cast;
  readonly poses: Readonly<Record<GodId, Pictures>>;
  // Each god's second frames, by pose; a pose given none keeps its first.
  readonly frames?: Readonly<Partial<Record<GodId, Frames>>>;
  // The crown's picture, for the god that gives one: without it no herald comes to a finish.
  readonly crowns?: Readonly<Partial<Record<GodId, string>>>;
  // The stage's width inside its frame; the element's own unless given.
  readonly width?: () => number;
  // Whether the reader asks for less motion; the window's setting unless given.
  readonly reduced?: () => boolean;
  // Whether a god at its work fidgets: it does unless this is false, for tests and previews.
  readonly fidget?: boolean;
  // The worker whose god the pointer is on, or nobody.
  readonly onHover?: (key: string | null) => void;
}

// What the stage holds, for tests and previews.
export interface CourtPeek {
  readonly width: number;
  readonly hearth: { readonly state: HearthState; readonly flame: number };
  // From the agora up.
  readonly floors: readonly ("bare" | "set" | "shown")[];
  readonly gods: readonly {
    readonly key: string;
    readonly god: GodId;
    readonly zone: ZoneId;
    readonly slot: number;
    readonly x: number;
    readonly lift: number;
    readonly dir: number;
    readonly pose: Pose;
    readonly walking: boolean;
    readonly shown: number;
    readonly name: number;
    readonly dim: number;
    readonly crack: number;
    readonly sealed: boolean;
    // Whether it wears the laurel.
    readonly laurel: boolean;
    readonly fidget: Shown | null;
  }[];
  // Workers with no place on the stage: their rows are all there is of them.
  readonly off: readonly string[];
  // The one who crowns at a finish, if she is there: where, which way she faces, and whether her crown is up.
  readonly herald: {
    readonly x: number;
    readonly dir: number;
    readonly shown: number;
    readonly crown: boolean;
  } | null;
}

export interface Courtyard {
  // `laurel`: the worker that did most of a finished stretch, or nobody.
  sync(agents: readonly CourtAgent[], hearth: HearthState, laurel?: string | null): void;
  resize(): void;
  // The worker whose row the pointer is on: its god's name is marked.
  mark(key: string | null): void;
  peek(): CourtPeek;
  dispose(): void;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Readonly<Record<string, string | number>>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
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

// The lane's seed for a scene, so a floor is laid here as it is there.
const hash = (s: string): number =>
  [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
const laid = new Map<SceneId, LaidFloor>();
function laidScene(id: SceneId): LaidFloor {
  let floor = laid.get(id);
  if (!floor) {
    floor = layScene(
      MOSAIC.scenes.find((scene) => scene.id === id)!,
      rng(hash(id)),
    );
    laid.set(id, floor);
  }
  return floor;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const outCubic = (k: number): number => 1 - (1 - k) ** 3;

const HEAD = COURT.cell.head;
const AXIS = 2 * HEAD; // a god faces left by mirroring about its head
// A floor is set a little after the one under it: the court is built from the ground up.
const STAGGER = 260;
// The flame is cut from one shape to the next on this beat, ms.
const FLAME = 170;
const FLAMES = [0, 1, 0, 2, 1, 2, 0, 2, 1, 0, 1, 2];
const FADE = 320; // a god shows, or goes
const NAME = 240; // its name is carved
const ARRIVE_GAP = 700; // those sent together come through the gate one at a time
const SEAL_AT = 300; // the seal comes down on the scroll
const PRESS = 180;
const DIM = 900;
const CRACK = 220;
const HOVER_UP = 240; // the one who flies: up, as her pose cuts in
const MOST_FAILED = 4;
const LAUREL_AT = 300; // the laurel comes down on its head, as the seal does on its scroll
// The one who crowns at a finish. She keeps her raised crown, and the last
// god's own width, clear of the summit's last place on her side.
const HERALD: GodId = "nike";
const HERALD_CLEAR = 82;

// The laurel, as a god facing right wears it: a spray from the knot at its
// nape up to its brow, two leaves a node and one at the tip.
const LAUREL = { w: 16, h: 10, box: "0 0 18 11" } as const;
// Where it sits on each standing head: its middle from the head line, and its
// top from the figure's (cast.json's top.stand), px.
const BROW: Readonly<Record<GodId, readonly [number, number]>> = {
  athena: [-1, 5],
  herodotus: [-2, 3],
  hermes: [-1, 1],
  hephaestus: [-1, 4],
  argus: [-1.5, 2.5],
  themis: [-1, 3.5],
  nike: [-0.5, 4],
};
function buildLaurel(): SVGElement {
  const el = svg("svg", { class: "oly-laurel", viewBox: LAUREL.box });
  const [x0, y0, x1, y1] = [2.5, 8.5, 15.5, 3.2];
  const along = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  const leaf = (k: number, tilt: number): SVGElement => {
    const deg = along + tilt;
    const r = (deg * Math.PI) / 180;
    const cx = (x0 + (x1 - x0) * k + 2.1 * Math.cos(r)).toFixed(2);
    const cy = (y0 + (y1 - y0) * k + 2.1 * Math.sin(r)).toFixed(2);
    return svg("ellipse", {
      class: "oly-laurel-leaf",
      cx,
      cy,
      rx: 2.5,
      ry: 1.05,
      transform: `rotate(${deg.toFixed(1)} ${cx} ${cy})`,
    });
  };
  el.append(
    svg("path", { class: "oly-laurel-tie", d: "M2.6 8.4L0.8 10.6M2.6 8.4L3.4 10.8" }),
    ...[0.05, 0.3, 0.55, 0.8].flatMap((k) => [leaf(k, -32), leaf(k, 26)]),
    leaf(0.92, -4),
  );
  return el;
}

const FLAME_SHAPES = [
  [
    "M12 28C10 20 16 16 17 9C20 13 21 15 22 3C25 10 30 14 29 20C31 18 32 22 32 28Z",
    "M16 28C15 23 19 20 20 14C23 18 26 21 26 28Z",
    "M19 28C19 25 21 23 22 20C23 23 25 25 24 28Z",
  ],
  [
    "M12 28C9 21 13 17 13 10C17 13 19 16 19 5C24 11 29 15 28 21C31 19 32 23 32 28Z",
    "M16 28C14 23 17 20 17 15C21 18 26 22 26 28Z",
    "M19 28C18 25 20 23 20 21C22 23 25 25 24 28Z",
  ],
] as const;

const ended = (status: CourtStatus): boolean =>
  status === "done" || status === "failed" || status === "stopped";

interface Terrace {
  readonly level: Level;
  readonly scene: SceneId;
  readonly canvas: HTMLCanvasElement;
  brush: CanvasRenderingContext2D | null | undefined;
  // What it shows at rest, as last drawn; null while its stones are on their way.
  drawn: string | null;
  phase: "bare" | "set" | "shown";
  shown: { key: string; floor: LaidFloor } | null;
}

interface Trip {
  readonly legs: readonly Leg[];
  readonly t0: number;
  readonly timer: SimEvent;
}

// A god as a frame draws it.
interface Vis {
  x: number;
  lift: number;
  y: number;
  dir: number;
  pose: Pose;
  walking: boolean;
  fig: number;
  name: number;
  dim: number;
  crack: number;
  sealed: boolean;
  press: number;
  laurel: boolean;
  wreath: number;
  react: "crown" | null;
  fid: Shown;
  moving: boolean;
  wake: number;
}

interface Fig {
  readonly key: string;
  readonly gid: GodId;
  readonly c: CastGod;
  agent: CourtAgent;
  readonly el: HTMLElement;
  readonly figEl: HTMLElement;
  readonly posesEl: HTMLElement;
  readonly seconds: Set<Pose>;
  readonly parts: Map<Pose, HTMLElement>;
  moved: HTMLElement | null;
  readonly sealEl: SVGElement;
  readonly laurelEl: SVGElement;
  readonly label: HTMLElement;
  // The place it holds: where it stands, or where it is going.
  zone: ZoneId;
  slot: number;
  // Where it last stood; and the way it faces there, if not its slot's.
  spot: Spot;
  readonly face: 1 | -1 | null;
  trip: Trip | null;
  restAt: number;
  // Where its work is done now; and whether it found no room there.
  want: ZoneId;
  stuck: boolean;
  dwell: SimEvent | null;
  // The family its pose acts, the pose, and the cut that showed it.
  family: ToolFamily;
  pose: Pose;
  shownAt: number;
  // It shows from then; simply there if that is never.
  showAt: number;
  // Its turn among those that have ended; 0 while it works.
  ended: number;
  dimAt: number | null;
  cracked: boolean;
  sealAt: number | null;
  goneAt: number | null;
  out: Record<string, unknown>;
  readonly deals: { held: string; readonly bars: Map<number, Dealt | null> };
  vis: Vis | null;
}

export function createCourtyard(root: HTMLElement, opts: CourtOptions): Courtyard {
  const { sim, cast: CAST } = opts;
  const reduced =
    opts.reduced ??
    ((): boolean =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const widthOf = opts.width ?? ((): number => root.clientWidth);
  const fidgeting = opts.fidget !== false;
  let plan: CourtPlan = planCourt(widthOf());
  let disposed = false;
  const born = sim.now();

  // ───────── the stage ─────────
  const defs = svg("svg", { class: "oly-court-defs", "aria-hidden": "true" });
  const grain = svg("filter", {
    id: "oly-court-grain",
    x: 0,
    y: 0,
    width: "100%",
    height: "100%",
    "color-interpolation-filters": "sRGB",
  });
  grain.append(
    svg("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: "0.004 0.11",
      numOctaves: 4,
      seed: 9,
    }),
    svg("feColorMatrix", {
      type: "matrix",
      values: "0 0 0 0 0.42  0 0 0 0 0.38  0 0 0 0 0.36  -2.6 0 0 0 1.45",
    }),
  );
  // The hearth's light on the summit's floor.
  const glow = svg("radialGradient", { id: "oly-court-glow" });
  glow.append(
    svg("stop", { offset: 0, "stop-color": "#d53446", "stop-opacity": 0.42 }),
    svg("stop", { offset: 0.45, "stop-color": "#c8283a", "stop-opacity": 0.16 }),
    svg("stop", { offset: 1, "stop-color": "#c8283a", "stop-opacity": 0 }),
  );
  defs.append(grain, glow);

  // From the summit down, as they stand.
  const terraceEls: HTMLElement[] = [];
  const terraces: Terrace[] = ([2, 1, 0] as const).map((level) => {
    const scene = LEVEL_SCENES[level];
    const el = html("div", "oly-terrace");
    el.dataset.scene = scene;
    const canvas = document.createElement("canvas");
    canvas.className = "oly-court-floor";
    const step = html("div", "oly-stylobate");
    const marble = svg("svg", { class: "oly-marble", preserveAspectRatio: "none" });
    marble.append(
      svg("rect", {
        width: "100%",
        height: "100%",
        filter: "url(#oly-court-grain)",
        opacity: 0.3,
      }),
    );
    step.append(marble);
    el.append(canvas, step);
    terraceEls.push(el);
    return { level, scene, canvas, brush: undefined, drawn: "", phase: "bare", shown: null };
  });
  const stairsEl = svg("svg", { class: "oly-court-stairs" });
  const hearthEl = html("div", "oly-hearth");
  const godsEl = html("div", "oly-gods");
  const namesEl = html("div", "oly-names");
  root.append(defs, ...terraceEls, stairsEl, hearthEl, godsEl, namesEl);

  // A terrace's feet line, from the stage's top.
  const feetY = (level: Level): number => (2 - level) * COURT.terrace + COURT.floor;

  function drawStairs(): void {
    const W = plan.width;
    const { steps, tread, rise } = COURT.stair;
    stairsEl.replaceChildren();
    stairsEl.setAttribute("viewBox", `0 0 ${Math.max(1, W)} ${COURT.height}`);
    plan.stairs.forEach((stair, i) => {
      const base = feetY(stair.lower);
      const wall = stair.dir > 0 ? W : 0;
      const outline = [
        ...stairProfile(stair).map(([x, h]) => [x, base - h]),
        [wall, base - COURT.terrace],
        [wall, base],
        [stair.foot, base],
      ];
      const d = `M${outline.map((p) => p.join(" ")).join("L")}Z`;
      const g = svg("g", { class: "oly-flight" });
      const clip = svg("clipPath", { id: `oly-court-flight-${i}` });
      clip.append(svg("path", { d }));
      g.append(clip, svg("path", { class: "oly-flight-body", d }));
      const band = (cls: string, x0: number, x1: number, y: number, h: number): SVGElement =>
        svg("rect", {
          class: cls,
          x: Math.min(x0, x1),
          y,
          width: Math.abs(x1 - x0),
          height: h,
        });
      for (let k = 0; k < steps; k++) {
        const y = base - (k + 1) * rise;
        const riser = stair.foot + stair.dir * k * tread;
        const open = k === steps - 1 ? wall : riser + stair.dir * tread;
        // Under the step above it, a step is in a little shade.
        if (k < steps - 1) g.append(band("oly-flight-shade", open, wall, y, rise));
        for (const [cls, x0, x1] of [
          ["", riser, open],
          [" oly-flight-course", open, wall],
        ] as const) {
          if (x0 === x1) continue;
          g.append(
            band(`oly-flight-nose-1${cls}`, x0, x1, y, 1),
            band(`oly-flight-nose-2${cls}`, x0, x1, y + 1, 2),
            band(`oly-flight-nose-3${cls}`, x0, x1, y + 3, 1),
          );
        }
        g.append(band("oly-flight-riser", riser, riser + stair.dir, y + 4, rise - 4));
      }
      g.append(
        svg("rect", {
          x: Math.min(wall, stair.foot),
          y: base - COURT.terrace,
          width: Math.abs(wall - stair.foot),
          height: COURT.terrace,
          filter: "url(#oly-court-grain)",
          opacity: 0.3,
          "clip-path": `url(#oly-court-flight-${i})`,
        }),
      );
      stairsEl.append(g);
    });
  }

  function buildHearth(): void {
    const art = svg("svg", { viewBox: "0 0 44 66", width: 44, height: 66 });
    art.append(
      svg("ellipse", {
        class: "oly-hearth-glow",
        cx: 22,
        cy: 22,
        rx: 54,
        ry: 44,
        fill: "url(#oly-court-glow)",
      }),
    );
    // Its three shapes: upright, leaning, and leaning the other way.
    [0, 1, 1].forEach((shape, n) => {
      const g = svg("g", {
        class: `oly-flame oly-flame-${n}`,
        ...(n === 2 ? { transform: "translate(44 0) scale(-1 1)" } : {}),
      });
      const [out, mid, core] = FLAME_SHAPES[shape]!;
      g.append(
        svg("path", { class: "oly-flame-out", d: out }),
        svg("path", { class: "oly-flame-mid", d: mid }),
        svg("path", { class: "oly-flame-core", d: core }),
      );
      art.append(g);
    });
    const rect = (cls: string, x: number, y: number, w: number, h: number): SVGElement =>
      svg("rect", { class: cls, x, y, width: w, height: h });
    art.append(
      svg("path", { class: "oly-hearth-ash", d: "M10 29Q22 21 34 29Z" }),
      rect("oly-hearth-ember", 14, 26, 2, 2),
      rect("oly-hearth-ember", 20, 24, 3, 3),
      rect("oly-hearth-ember", 27, 26, 2, 2),
      svg("path", { class: "oly-hearth-stone", d: "M4 31H40L33 39H11Z" }),
      svg("path", { class: "oly-hearth-dark", d: "M9.2 37H34.8L33 39H11Z" }),
      rect("oly-hearth-rim", 3, 28, 38, 3),
      rect("oly-hearth-dark", 14, 39, 16, 3),
      rect("oly-hearth-stone", 16, 42, 12, 18),
      rect("oly-hearth-light", 16, 42, 2, 18),
      rect("oly-hearth-dark", 26, 42, 2, 18),
      rect("oly-hearth-stone", 8, 60, 28, 6),
      rect("oly-hearth-light", 8, 60, 28, 1),
      rect("oly-hearth-dark", 8, 65, 28, 1),
    );
    hearthEl.append(art);
  }

  let hearth: HearthState = "idle";
  let hearthDrawn = "";
  // The finale: on from when the hearth was told a stretch had finished, for
  // as long as it is; and the worker that did most of it, if anyone.
  let finale: { readonly at: number } | null = null;
  let crowned: string | null = null;
  const flameAt = (now: number): number =>
    hearth === "working" && !reduced() ? FLAMES[Math.floor(now / FLAME) % FLAMES.length]! : 0;
  // The hearth as its frame has it: when its flame will next change shape, if it burns.
  function renderHearth(now: number): number {
    const flame = flameAt(now);
    const state = `${hearth} ${flame} ${plan.hearth}`;
    if (state !== hearthDrawn) {
      hearthDrawn = state;
      hearthEl.dataset.state = hearth;
      hearthEl.dataset.flame = String(flame);
      hearthEl.style.transform = `translate3d(${plan.hearth - 22}px, 0, 0)`;
    }
    return hearth === "working" && !reduced() ? (Math.floor(now / FLAME) + 1) * FLAME : Infinity;
  }

  // ───────── the floors ─────────
  const density = (): number => Math.max(1, window.devicePixelRatio || 1);

  // One terrace's floor as its frame has it: its stones on their way are drawn
  // every frame; at rest it is drawn once, until the width or the density is another.
  function renderFloor(t: Terrace, now: number): boolean {
    const W = plan.width;
    const dpr = density();
    const u = now - born - t.level * STAGGER;
    const whole = reduced() || u >= SET_END;
    t.phase = whole ? "shown" : u >= 0 ? "set" : "bare";
    const still = whole ? `${W} ${dpr}` : null;
    if (still !== null && still === t.drawn) return false;
    if (t.brush === undefined) t.brush = t.canvas.getContext("2d") ?? null;
    const ctx = t.brush;
    t.drawn = still;
    if (!ctx) return false;
    // The scene's middle on the stage's: a narrower stage shows less of it.
    const dx = Math.round((W - MOSAIC.w) / 2);
    const w = Math.round(W * dpr);
    const h = Math.round(COURT.floor * dpr);
    if (t.canvas.width !== w) t.canvas.width = w;
    if (t.canvas.height !== h) t.canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, dx * dpr, 0);
    ctx.clearRect(-dx, 0, W, COURT.floor);
    const key = `${W}`;
    if (t.shown?.key !== key) t.shown = { key, floor: cropFloor(laidScene(t.scene), -dx, W - dx) };
    if (t.phase !== "bare") drawFloor(ctx, t.shown.floor, whole ? "shown" : "set", u);
    return !whole;
  }

  // ───────── the gods ─────────
  const figs = new Map<string, Fig>();
  // Taken off the stage, and still fading from it.
  const leaving = new Set<Fig>();
  let latest: readonly CourtAgent[] = [];
  // Every worker the stage has been told of, on it or not.
  const known = new Set<string>();
  let opened = false;
  let seq = 0;
  let nextArrive = -Infinity;
  let marked: string | null = null;

  const spotOf = (zone: ZoneId, slot: number): Spot => ({
    level: plan.zones[zone].level,
    x: plan.zones[zone].slots[slot]!.x,
  });
  const faceOf = (fig: Fig): 1 | -1 => fig.face ?? plan.zones[fig.zone].slots[fig.slot]?.face ?? 1;
  const liftOf = (fig: Fig): number =>
    (fig.c.lift as Readonly<Partial<Record<Pose, number>>>)[fig.pose] ?? 0;

  function takenIn(zone: ZoneId): Set<number> {
    const taken = new Set<number>();
    for (const fig of figs.values()) if (fig.zone === zone && fig.slot >= 0) taken.add(fig.slot);
    return taken;
  }

  // A place in a zone, if there is one. The summit keeps the latest to finish:
  // full, the one sealed longest ago gives up its place.
  function claim(id: ZoneId, t: number, except?: Fig): number | null {
    const free = freeSlot(plan.zones[id], takenIn(id));
    if (free !== null || id !== "temple") return free;
    let oldest: Fig | null = null;
    for (const fig of figs.values()) {
      if (fig === except || fig.zone !== "temple" || fig.agent.status !== "done") continue;
      if (!oldest || fig.ended < oldest.ended) oldest = fig;
    }
    if (!oldest) return null;
    const slot = oldest.slot;
    leave(oldest, t);
    return slot;
  }

  // `at`: the herald's own spot. She is no worker: she holds no slot, no name
  // is carved under her, and the pointer finds nobody on her.
  function makeFig(a: CourtAgent, zone: ZoneId, slot: number, t: number, at?: Spot): Fig {
    const c = CAST.gods[a.god];
    const el = html("div", at ? "oly-cell oly-herald" : "oly-cell");
    el.dataset.god = a.god;
    if (!at) el.dataset.key = a.key;
    el.style.setProperty("--oly-ex", `${c.seal[0]}px`);
    el.style.setProperty("--oly-ey", `${c.seal[1]}px`);
    el.style.setProperty("--oly-lx", `${HEAD + BROW[a.god][0] - LAUREL.w / 2}px`);
    el.style.setProperty("--oly-ly", `${c.top.stand + BROW[a.god][1]}px`);
    const figEl = html("div", "oly-fig");
    const posesEl = html("div", "oly-poses");
    const urls = opts.poses[a.god];
    const picture = (pose: Pose | "crown", url: string): HTMLImageElement => {
      const img = document.createElement("img");
      img.className = `oly-pose oly-p-${pose}`;
      img.src = url;
      img.alt = "";
      img.draggable = false;
      posesEl.append(img);
      return img;
    };
    for (const pose of POSES) picture(pose, urls[pose]);
    // As the lane builds them: a skill pose sits in the cell on its own axis;
    // after it, its second frame, and its cut-out part.
    const seconds = new Set<Pose>();
    const parts = new Map<Pose, HTMLElement>();
    const px = (points: readonly (readonly [number, number])[]): string =>
      points.map(([x, y]) => `${x}px ${y}px`).join(",");
    for (const [pose, box] of Object.entries(c.at) as [Skill, readonly [number, number]][]) {
      const url = urls[pose];
      if (!url) continue;
      const img = picture(pose, url);
      img.style.left = `${box[0]}px`;
      img.style.width = `${box[1]}px`;
      if (!fidgeting) continue;
      const second = c.frames[pose] && opts.frames?.[a.god]?.[pose];
      if (second) {
        const frame = picture(pose, second);
        frame.classList.add("oly-f-b");
        frame.style.left = img.style.left;
        frame.style.width = img.style.width;
        seconds.add(pose);
      }
      const cut = c.parts[pose];
      if (cut) {
        const [w, h] = [box[1], CAST.cell.h];
        img.style.setProperty(
          "--oly-hole",
          `polygon(evenodd,0px 0px,${w}px 0px,${w}px ${h}px,0px ${h}px,0px 0px,${px(cut.hole)},${px(cut.hole.slice(0, 1))})`,
        );
        const part = document.createElement("img");
        part.className = "oly-part";
        part.dataset.of = pose;
        part.src = url;
        part.alt = "";
        part.draggable = false;
        part.style.left = img.style.left;
        part.style.width = img.style.width;
        part.style.setProperty("--oly-clip", `polygon(${px(cut.cut)})`);
        posesEl.append(part);
        parts.set(pose, part);
      }
    }
    // The herald's crown, as the lane builds it: shown in place of her pose while it is raised.
    const crown = at && c.rx.crown;
    const crownUrl = opts.crowns?.[a.god];
    if (crown && crownUrl) {
      const img = picture("crown", crownUrl);
      img.style.left = `${crown.at[0]}px`;
      img.style.width = `${crown.at[1]}px`;
    }
    const sealEl = svg("svg", { class: "oly-seal", viewBox: CAST.seal.viewBox });
    grow(sealEl, CAST.seal.nodes);
    const fissure = svg("svg", {
      class: "oly-fissure",
      viewBox: `0 0 ${CAST.cell.w} ${CAST.cell.h}`,
    });
    grow(fissure, c.fissure);
    const laurelEl = buildLaurel();
    figEl.append(posesEl, sealEl, fissure, laurelEl);
    el.append(figEl);
    // The worker's own name: its row's.
    const label = html("p", "oly-ins");
    label.textContent = a.label;
    godsEl.append(el);
    if (!at) {
      label.classList.toggle("is-marked", marked === a.key);
      for (const node of [el, label]) {
        node.addEventListener("pointerenter", () => opts.onHover?.(a.key));
        node.addEventListener("pointerleave", () => opts.onHover?.(null));
      }
      namesEl.append(label);
    }
    return {
      key: a.key,
      gid: a.god,
      c,
      agent: a,
      el,
      figEl,
      posesEl,
      seconds,
      parts,
      moved: null,
      sealEl,
      laurelEl,
      label,
      zone,
      slot,
      spot: at ?? spotOf(zone, slot),
      // She faces the temple, and whoever she crowns there.
      face: at ? -1 : null,
      trip: null,
      restAt: t,
      want: zone,
      stuck: false,
      dwell: null,
      family: a.family,
      pose: "stand",
      shownAt: t,
      showAt: -Infinity,
      ended: 0,
      dimAt: null,
      cracked: false,
      sealAt: null,
      goneAt: null,
      out: {},
      deals: { held: "", bars: new Map() },
      vis: null,
    };
  }

  // What its record says of how it ended: dimmed, cracked, or neither.
  function stamp(fig: Fig, t: number): void {
    const { status } = fig.agent;
    if (status === "failed" || status === "stopped") {
      if (fig.dimAt === null) fig.dimAt = t;
      fig.cracked = status === "failed";
    } else {
      fig.dimAt = null;
      fig.cracked = false;
    }
    if (status !== "done") fig.sealAt = null;
    if (!ended(status)) fig.ended = 0;
    else if (!fig.ended) fig.ended = ++seq;
  }

  // The pose it holds at its place: its tool's, where that work is done or where
  // it is stuck; about to leave, the pose it had; not at work, standing.
  function pose(fig: Fig, t: number): void {
    let next: Pose = "stand";
    if (fig.agent.status === "working") {
      if (fig.want === fig.zone || fig.stuck) fig.family = fig.agent.family;
      const act = (fig.c.acts[fig.family] ?? fig.c.acts.think).pose;
      if (opts.poses[fig.gid][act]) next = act;
    }
    if (next === fig.pose) return;
    fig.pose = next;
    fig.shownAt = t;
  }

  // At its place: it takes up its work there, and its stay counts from here.
  function settle(fig: Fig, t: number): void {
    sim.cancel(fig.trip?.timer);
    fig.trip = null;
    fig.spot = spotOf(fig.zone, fig.slot);
    fig.restAt = t;
    fig.want = placeFor(fig.agent.status, fig.agent.family, fig.zone);
    fig.stuck = false;
    fig.family = fig.want === fig.zone ? fig.agent.family : "think";
    pose(fig, t);
    if (fig.agent.status === "done" && fig.zone === "temple" && fig.sealAt === null) fig.sealAt = t;
    pending(fig, t);
  }

  function go(fig: Fig, legs: readonly Leg[], t: number): void {
    sim.cancel(fig.trip?.timer);
    fig.trip = null;
    if (!legs.length || reduced()) return settle(fig, t);
    sim.cancel(fig.dwell);
    fig.dwell = null;
    fig.trip = { legs, t0: t, timer: sim.at(t + routeMs(legs), () => settle(fig, sim.now())) };
  }

  // Wanted elsewhere: it goes once it has stayed its while here.
  function pending(fig: Fig, t: number): void {
    sim.cancel(fig.dwell);
    fig.dwell = null;
    if (fig.trip || fig.want === fig.zone) return;
    const due = fig.restAt + COURT.dwell;
    if (t >= due) return depart(fig, t);
    fig.dwell = sim.at(due, () => {
      fig.dwell = null;
      depart(fig, sim.now());
    });
  }

  function depart(fig: Fig, t: number): void {
    if (fig.goneAt !== null || fig.trip || fig.want === fig.zone) return;
    const slot = claim(fig.want, t, fig);
    if (slot === null) {
      // No room there: it does that work where it is, and looks again when a place is given up.
      if (!fig.stuck) {
        fig.stuck = true;
        pose(fig, t);
      }
      return;
    }
    const from = fig.spot;
    fig.zone = fig.want;
    fig.slot = slot;
    fig.stuck = false;
    go(fig, route(plan, from, spotOf(fig.zone, slot), fig.c.move.speed), t);
    retry(t);
  }

  // Wanted elsewhere on its way: the latest want wins, and it turns for it.
  function redirect(fig: Fig, t: number): void {
    const trip = fig.trip!;
    const slot = claim(fig.want, t, fig);
    if (slot === null) return; // it goes on; arrived, it looks again
    fig.zone = fig.want;
    fig.slot = slot;
    go(fig, reroute(plan, trip.legs, t - trip.t0, spotOf(fig.zone, slot), fig.c.move.speed), t);
    retry(t);
  }

  // Its record has changed.
  function heed(fig: Fig, a: CourtAgent, t: number): void {
    if (a.label !== fig.agent.label) fig.label.textContent = a.label;
    fig.agent = a;
    stamp(fig, t);
    fig.want = placeFor(a.status, a.family, fig.zone);
    if (fig.trip) {
      if (fig.want !== fig.zone) redirect(fig, t);
      return;
    }
    if (fig.want === fig.zone) fig.stuck = false;
    pose(fig, t);
    if (a.status === "done" && fig.zone === "temple" && fig.sealAt === null) fig.sealAt = t;
    pending(fig, t);
  }

  // Onto the stage, if there is a place for it. `cut`: it is simply there, as
  // the stage opens; else it comes in at the gate and walks to its place.
  function admit(a: CourtAgent, t: number, cut: boolean): boolean {
    const zone = placeFor(a.status, a.family, null);
    const slot = claim(zone, t);
    if (slot === null) return false;
    const fig = makeFig(a, zone, slot, t);
    figs.set(a.key, fig);
    stamp(fig, t);
    const quiet = reduced();
    // One that failed before the stage saw it never walked anywhere.
    if (cut || quiet || fig.dimAt !== null) {
      if (fig.dimAt !== null) fig.dimAt = -Infinity;
      if (a.status === "done") fig.sealAt = -Infinity;
      // As the stage opens, it shows as its terrace's last stones go down.
      const floorSet = born + fig.spot.level * STAGGER + SET_END - FADE;
      fig.showAt = quiet ? -Infinity : cut ? Math.max(t, floorSet) : t;
      settle(fig, t);
      return true;
    }
    fig.spot = plan.gate;
    const t0 = Math.max(t, nextArrive);
    nextArrive = t0 + ARRIVE_GAP;
    const legs = route(plan, plan.gate, spotOf(zone, slot), fig.c.move.speed);
    fig.trip = { legs, t0, timer: sim.at(t0 + routeMs(legs), () => settle(fig, sim.now())) };
    return true;
  }

  // Off the stage: its record is gone, or the stage shows only the latest to end.
  function leave(fig: Fig, t: number): void {
    figs.delete(fig.key);
    sim.cancel(fig.dwell);
    sim.cancel(fig.trip?.timer);
    fig.dwell = null;
    if (reduced()) return drop(fig);
    fig.goneAt = t;
    leaving.add(fig);
    sim.at(t + FADE, () => drop(fig));
  }

  function drop(fig: Fig): void {
    leaving.delete(fig);
    fig.el.remove();
    fig.label.remove();
  }

  // The places have changed: whoever found no room looks again, now that one
  // may have been given up, and then every name is put under its god.
  let retrying = false;
  let again = false;
  function retry(t: number): void {
    again = true;
    if (retrying) return;
    retrying = true;
    while (again) {
      again = false;
      for (const fig of [...figs.values()]) if (fig.stuck && !fig.trip) depart(fig, t);
      for (const a of latest) if (!figs.has(a.key) && !ended(a.status)) admit(a, t, false);
    }
    retrying = false;
    relabel();
    attend(t);
  }

  // ───────── the finale: a laurel, and the one who gives it ─────────
  let herald: Fig | null = null;

  // Where she stands: the summit's free right end, on a stage wide enough to
  // keep her crown clear of the last place there.
  function heraldSpot(): Spot | null {
    if (!CAST.gods[HERALD].rx.crown || !opts.crowns?.[HERALD]) return null;
    const x = plan.width - COURT.edge;
    const last = Math.max(plan.hearth, ...plan.zones.temple.slots.map((slot) => slot.x));
    return x - last >= HERALD_CLEAR ? { level: 2, x } : null;
  }

  // She is there for a finale whose crowned god is on the stage, and goes with either.
  function attend(t: number): void {
    const spot = finale && crowned !== null && figs.has(crowned) ? heraldSpot() : null;
    if (!spot) {
      const fig = herald;
      herald = null;
      if (!fig) return;
      if (reduced()) return drop(fig);
      fig.goneAt = t;
      leaving.add(fig);
      sim.at(t + FADE, () => drop(fig));
      return;
    }
    if (herald) {
      // Another width: she is put again by a cut, as everyone is.
      herald.spot = spot;
      return;
    }
    const she: CourtAgent = { key: "", god: HERALD, label: "", status: "idle", family: "think" };
    herald = makeFig(she, "temple", -1, t, spot);
    herald.showAt = reduced() ? -Infinity : t;
  }

  // The finale's moments, once the crowned god stands sealed in the temple:
  // when the laurel comes down on it, and the beats the herald's crown is up
  // for, if she stood there in time. Asked for less motion, the laurel is
  // simply on and nobody raises anything.
  interface Finale {
    readonly fig: Fig;
    readonly laurel: number;
    readonly raise: readonly [number, number] | null;
  }
  function finaleOf(): Finale | null {
    if (!finale || crowned === null) return null;
    const fig = figs.get(crowned);
    if (!fig || fig.sealAt === null || fig.zone !== "temple" || fig.trip) return null;
    if (reduced()) return { fig, laurel: -Infinity, raise: null };
    const from = Math.max(finale.at, fig.sealAt + SEAL_AT + PRESS, fig.showAt + FADE) + FADE;
    const crown = herald?.c.rx.crown;
    const up = herald && crown && herald.showAt + FADE <= from;
    return {
      fig,
      laurel: from + LAUREL_AT,
      raise: up ? [from, from + crown.beats * herald!.c.step] : null,
    };
  }

  // A name has the room its neighbours on its terrace leave it.
  function relabel(): void {
    const at = (fig: Fig): { level: Level; cx: number } => {
      const spot = spotOf(fig.zone, fig.slot);
      const [a, b] = fig.c.fp.stand;
      const mid = (a + b) / 2;
      return { level: spot.level, cx: spot.x - HEAD + (faceOf(fig) > 0 ? mid : AXIS - mid) };
    };
    const all = [...figs.values()].map((fig) => ({ fig, ...at(fig) }));
    for (const one of all) {
      let half = Math.min(one.cx - 4, plan.width - 4 - one.cx);
      for (const other of all)
        if (other !== one && other.level === one.level)
          half = Math.min(half, Math.abs(other.cx - one.cx) / 2 - 4);
      const max = `${Math.round(clamp(2 * half, 30, 150))}px`;
      put(one.fig, "max", max, (w) => (one.fig.label.style.maxWidth = w));
      put(
        one.fig,
        "at",
        `translate(calc(${one.cx.toFixed(1)}px - 50%), ${-one.level * COURT.terrace}px)`,
        (tx) => (one.fig.label.style.transform = tx),
      );
    }
  }

  function reconcile(
    agents: readonly CourtAgent[],
    state: HearthState,
    laurel: string | null,
  ): void {
    const t = sim.now();
    // The finale begins as the hearth is told of a finish, and again for another's laurel.
    if (state !== "finished") finale = null;
    else if (!finale || laurel !== crowned) finale = { at: t };
    crowned = finale ? laurel : null;
    hearth = state;
    const first = !opened;
    opened = true;
    const keys = new Set<string>();
    latest = agents.filter((a) => !keys.has(a.key) && keys.add(a.key));
    for (const fig of [...figs.values()]) if (!keys.has(fig.key)) leave(fig, t);
    // Of those that ended before the stage saw them, only the latest are shown.
    const unseen = latest.filter((a) => !figs.has(a.key) && !known.has(a.key));
    const last = (list: readonly CourtAgent[], n: number): CourtAgent[] =>
      n > 0 ? list.slice(-n) : [];
    const shownEnded = new Set(
      [
        ...last(
          unseen.filter((a) => a.status === "done"),
          plan.zones.temple.slots.length,
        ),
        ...last(
          unseen.filter((a) => a.status === "failed" || a.status === "stopped"),
          MOST_FAILED,
        ),
      ].map((a) => a.key),
    );
    for (const a of latest) {
      const fig = figs.get(a.key);
      if (fig) heed(fig, a, t);
      else if (!ended(a.status) || shownEnded.has(a.key)) admit(a, t, first);
      known.add(a.key);
    }
    for (const key of [...known]) if (!keys.has(key)) known.delete(key);
    // The stage shows only the latest to fail or be stopped.
    const failed = [...figs.values()]
      .filter((fig) => fig.dimAt !== null)
      .sort((a, b) => a.ended - b.ended);
    while (failed.length > MOST_FAILED) leave(failed.shift()!, t);
    retry(t);
  }

  // ───────── fidgets: a god alive at its work, as on the lane ─────────
  function dealt(fig: Fig, f: NonNullable<CastGod["fid"][Skill]>, n: number): Dealt | null {
    const held = `${fig.pose} ${fig.shownAt}`;
    const { deals } = fig;
    if (deals.held !== held || deals.bars.size > 64) deals.bars.clear();
    deals.held = held;
    let d = deals.bars.get(n);
    if (d === undefined) {
      const dice = rng(hash(`${fig.key} ${fig.pose} ${Math.round(fig.shownAt)} ${n}`));
      deals.bars.set(n, (d = deal(f, n, dice)));
    }
    return d;
  }

  const AT_REST = { s: null, wake: Infinity } as const;
  function fidget(fig: Fig, now: number): { readonly s: FidgetAt | null; readonly wake: number } {
    const at = fidgeting && !reduced() && fig.agent.status === "working";
    const f = at ? fig.c.fid[fig.pose as Skill] : undefined;
    if (!f) return AT_REST;
    const step = fig.c.step;
    const b = (now - fig.shownAt) / step;
    const deals = (n: number): Dealt | null => dealt(fig, f, n);
    let s = fidgetAt(f, b, step, liftOf(fig), deals);
    if (s && !fig.seconds.has(fig.pose)) s = { ...s, frame: "" };
    const next = nextAt(f, b, step, deals);
    return { s, wake: next <= b ? now : fig.shownAt + next * step };
  }

  // ───────── a frame ─────────
  function put<T>(fig: Fig, key: string, value: T, write: (value: T) => void): void {
    if (fig.out[key] === value) return;
    fig.out[key] = value;
    write(value);
  }

  function sample(fig: Fig, now: number, fin: Finale | null = finaleOf()): Vis {
    const quiet = reduced();
    // One fading from the stage may hold a slot the stage no longer has.
    const held = plan.zones[fig.zone].slots[fig.slot];
    const spot = fig.trip && held ? spotOf(fig.zone, fig.slot) : fig.spot;
    const v: Vis = {
      x: spot.x,
      lift: spot.level * COURT.terrace,
      y: 0,
      dir: faceOf(fig),
      pose: fig.pose,
      walking: false,
      fig: 1,
      name: 1,
      dim: 0,
      crack: 0,
      sealed: false,
      press: 1,
      laurel: false,
      wreath: 1,
      react: null,
      fid: STILL,
      moving: false,
      wake: Infinity,
    };
    const trip = fig.trip;
    const at = trip && !quiet ? routeAt(trip.legs, now - trip.t0) : null;
    if (trip && at) {
      const u = Math.max(0, now - trip.t0);
      v.x = at.x;
      v.lift = at.lift;
      v.dir = at.dir;
      v.name = 0;
      v.pose = "stand";
      if (!at.over) {
        const { bob, lift } = fig.c.move;
        v.walking = true;
        v.pose = Math.floor(u / fig.c.step) % 2 === 0 ? "stride" : "stand";
        if (bob && v.pose === "stride") v.y = bob; // a heavy tread dips on its footfall
        if (lift) v.y = -lift * clamp01(u / 140); // the one who flies skims the floor
        v.moving = true;
      }
    } else {
      const lift = liftOf(fig);
      const m = fidget(fig, now);
      v.fid = shown(m.s, lift);
      if (v.fid.turn) v.dir = -v.dir;
      const up = quiet ? 1 : outCubic(clamp01((now - fig.shownAt) / HOVER_UP));
      v.y = -(v.fid.lift ?? lift) * up;
      v.wake = m.wake;
      v.name = quiet ? 1 : clamp01((now - fig.restAt) / NAME);
      v.moving = m.wake <= now || (lift > 0 && up < 1) || v.name < 1;
    }
    if (now < fig.showAt) {
      v.fig = v.name = 0;
      v.wake = Math.min(v.wake, fig.showAt);
    } else if (!quiet && fig.showAt > -Infinity) {
      v.fig = clamp01((now - fig.showAt) / FADE);
      v.name = Math.min(v.name, v.fig);
      if (v.fig < 1) v.moving = true;
    }
    if (fig.goneAt !== null) {
      const k = 1 - clamp01((now - fig.goneAt) / FADE);
      v.fig *= k;
      v.name *= k;
      v.moving = k > 0;
      v.wake = Infinity;
    }
    if (fig.dimAt !== null) {
      v.dim = quiet ? 1 : clamp01((now - fig.dimAt) / DIM);
      // The crack is across its standing figure.
      if (fig.cracked && !v.walking && v.pose === "stand")
        v.crack = quiet ? 1 : clamp01((now - fig.dimAt) / CRACK);
      if (v.dim < 1) v.moving = true;
    }
    if (fig.sealAt !== null) {
      const u = quiet ? Infinity : now - fig.sealAt;
      v.sealed = u >= SEAL_AT;
      if (v.sealed) v.press = 1 + 0.7 * (1 - clamp01((u - SEAL_AT) / PRESS));
      if (!v.sealed) v.wake = Math.min(v.wake, fig.sealAt + SEAL_AT);
      else if (v.press > 1) v.moving = true;
    }
    // The laurel, for the one that did most: it waits until its god stands sealed in the temple.
    if (fin && fig === fin.fig && fig.goneAt === null) {
      const u = now - fin.laurel;
      v.laurel = u >= 0;
      if (v.laurel) v.wreath = 1 + 0.7 * (1 - clamp01(u / PRESS));
      if (!v.laurel) v.wake = Math.min(v.wake, fin.laurel);
      else if (v.wreath > 1) v.moving = true;
    }
    // While the herald's crown is up, the others sealed in the temple turn to the crowned one.
    const raise = fin?.raise;
    const turns = fig !== herald && fig !== fin?.fig && v.sealed && !trip && fig.zone === "temple";
    if (raise && fig.goneAt === null && (fig === herald || turns)) {
      const [from, to] = raise;
      if (now < from) v.wake = Math.min(v.wake, from);
      else if (now < to) {
        v.wake = Math.min(v.wake, to);
        if (fig === herald) v.react = "crown";
        else v.dir = Math.sign(fin.fig.spot.x - v.x) || v.dir;
      }
    }
    if (v.y === 0) v.y = 0; // never -0
    return v;
  }

  // An amount from 0 to 1 as a custom property: none at 1, where the stylesheet's own figure stands.
  function amount(el: HTMLElement, name: string, k: number): void {
    if (k > 0 && k < 1) el.style.setProperty(name, k.toFixed(3));
    else el.style.removeProperty(name);
  }

  // One god's frame. Whether the next will draw it otherwise.
  function renderFig(fig: Fig, now: number, fin: Finale | null): boolean {
    const v = sample(fig, now, fin);
    fig.vis = v;
    const el = fig.el;
    const tx = `translate3d(${(v.x - HEAD).toFixed(2)}px, ${Number((v.y - v.lift).toFixed(2))}px, 0)`;
    put(fig, "tx", tx, (value) => (el.style.transform = value));
    put(fig, "dir", v.dir < 0, (left) => el.classList.toggle("is-left", left));
    put(fig, "pose", v.pose, (value) => (el.dataset.pose = value));
    put(fig, "walking", v.walking, (on) => el.classList.toggle("is-walking", on));
    put(fig, "fig", v.fig, (k) => (fig.figEl.style.opacity = k === 1 ? "" : k.toFixed(3)));
    put(fig, "name", v.name, (k) => (fig.label.style.opacity = k === 1 ? "" : k.toFixed(3)));
    put(fig, "sealed", v.sealed, (on) => el.classList.toggle("is-sealed", on));
    put(
      fig,
      "press",
      v.press,
      (k) => (fig.sealEl.style.transform = k === 1 ? "" : `scale(${k.toFixed(3)})`),
    );
    put(fig, "react", v.react, (how) => {
      if (how) el.dataset.react = how;
      else delete el.dataset.react;
    });
    put(fig, "laurel", v.laurel, (on) => el.classList.toggle("is-laureled", on));
    put(
      fig,
      "wreath",
      v.wreath,
      (k) => (fig.laurelEl.style.transform = k === 1 ? "" : `scale(${k.toFixed(3)})`),
    );
    put(fig, "dim", v.dim, (k) => {
      el.classList.toggle("is-dim", k > 0);
      amount(el, "--oly-dim", k);
    });
    put(fig, "crack", v.crack, (k) => {
      el.classList.toggle("is-cracked", k > 0);
      amount(el, "--oly-crack", k);
    });
    const f = v.fid;
    put(fig, "fid", f.tx, (value) => (fig.posesEl.style.transform = value));
    put(fig, "frame", f.frame, (frame) => {
      if (frame) el.dataset.frame = frame;
      else delete el.dataset.frame;
    });
    put(fig, "part", f.part && `${v.pose} ${f.ptx}`, (on) => {
      if (fig.moved) fig.moved.style.transform = "";
      fig.moved = (on && fig.parts.get(v.pose)) || null;
      if (fig.moved) {
        fig.moved.style.transform = f.ptx;
        el.dataset.part = f.part;
      } else delete el.dataset.part;
    });
    return v.moving;
  }

  buildHearth();
  drawStairs();

  sim.view((now) => {
    if (disposed) return false;
    let moving = false;
    let wake = renderHearth(now);
    for (const t of terraces) moving = renderFloor(t, now) || moving;
    const fin = finaleOf();
    for (const fig of [...figs.values(), ...(herald ? [herald] : []), ...leaving]) {
      moving = renderFig(fig, now, fin) || moving;
      wake = Math.min(wake, fig.vis!.wake);
    }
    return moving || (wake < Infinity ? wake : false);
  });

  let synced = "";

  return {
    sync(agents, state, laurel = null) {
      if (disposed) return;
      const now = `${state} ${laurel ?? ""}\n${agents
        .map((a) => `${a.key} ${a.god} ${a.status} ${a.family} ${a.label}`)
        .join("\n")}`;
      if (now === synced) return;
      synced = now;
      const records = [...agents];
      sim.soon(() => reconcile(records, state, laurel));
    },
    resize() {
      if (disposed) return;
      sim.soon(() => {
        const next = planCourt(widthOf());
        if (next.width === plan.width) return;
        plan = next;
        drawStairs();
        // Everyone is put again, in the order they came, by cuts: whoever the
        // narrower stage has no place for is left to its row.
        const t = sim.now();
        const all = [...figs.values()];
        const held = all.map((fig) => fig.slot);
        for (const fig of all) fig.slot = -1;
        all.forEach((fig, i) => {
          const zone = plan.zones[fig.zone];
          const taken = takenIn(fig.zone);
          const slot = held[i]! < zone.slots.length && !taken.has(held[i]!) ? held[i]! : null;
          const place = slot ?? freeSlot(zone, taken);
          if (place === null) {
            // It goes from where it last stood, not along a way the old stage gave it.
            sim.cancel(fig.trip?.timer);
            fig.trip = null;
            return leave(fig, t);
          }
          fig.slot = place;
          settle(fig, t);
        });
        retry(t);
      });
    },
    mark(key) {
      if (disposed || key === marked) return;
      marked = key;
      for (const fig of figs.values()) fig.label.classList.toggle("is-marked", fig.key === key);
    },
    peek() {
      const now = sim.now();
      return {
        width: plan.width,
        hearth: { state: hearth, flame: flameAt(now) },
        floors: [...terraces].reverse().map((t) => t.phase),
        gods: [...figs.values()].map((fig) => {
          const v = sample(fig, now);
          return {
            key: fig.key,
            god: fig.gid,
            zone: fig.zone,
            slot: fig.slot,
            x: v.x,
            lift: v.lift - v.y,
            dir: v.dir,
            pose: v.pose,
            walking: v.walking,
            shown: v.fig,
            name: v.name,
            dim: v.dim,
            crack: v.crack,
            sealed: v.sealed,
            laurel: v.laurel,
            fidget: v.fid === STILL ? null : v.fid,
          };
        }),
        off: latest.filter((a) => !figs.has(a.key)).map((a) => a.key),
        herald: herald
          ? ((v): CourtPeek["herald"] => ({
              x: v.x,
              dir: v.dir,
              shown: v.fig,
              crown: v.react === "crown",
            }))(sample(herald, now))
          : null,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fig of figs.values()) {
        sim.cancel(fig.dwell);
        sim.cancel(fig.trip?.timer);
      }
      figs.clear();
      leaving.clear();
      herald = null;
      latest = [];
      known.clear();
      root.replaceChildren();
    },
  };
}
