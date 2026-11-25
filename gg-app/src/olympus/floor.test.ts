// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { CAST, CROWN_URLS, FRAME_URLS, POSE_URLS, START_URLS, type Skill } from "./cast";
import {
  agentsAt,
  type CountingBrush,
  countingBrush,
  framedHost,
  type ManualHost,
  MOCK_CROWD,
  MOCK_RUN,
  SENT_ON_AGAIN,
  STATE_AGENTS,
} from "./fixtures";
import { createFloor, rng, type FloorPeek, type LaneAgent, type LaneLook } from "./floor";
import { GODS, type GodId } from "./gods";
import { laneAgents } from "./OlympusLane";
import { createSim, type Sim } from "./sim";
import type { ToolFamily } from "./tool-family";

const GREETINGS: Readonly<Record<GodId | "any", readonly string[]>> = {
  any: ["At your service.", "Here, and listening."],
  athena: ["I have the brief."],
  herodotus: ["Tell me everything."],
  hermes: ["Already halfway there."],
  hephaestus: ["To the anvil, then."],
  argus: ["All eyes on it."],
  themis: ["Let it be weighed."],
  nike: ["This one is ours."],
};
const FAREWELLS: Readonly<Record<GodId | "any", readonly string[]>> = {
  any: ["It is written.", "I leave it with you."],
  athena: ["Sealed, and yours."],
  herodotus: ["There is more, another day."],
  hermes: ["Done before you asked."],
  hephaestus: ["Built to last."],
  argus: ["Nothing got past me."],
  themis: ["Weighed, and found true."],
  nike: ["Victory, as promised."],
};
const ALL: readonly GodId[] = [
  "athena",
  "herodotus",
  "hermes",
  "hephaestus",
  "argus",
  "themis",
  "nike",
];

const agent = (
  key: string,
  god: GodId,
  look: LaneLook = "run",
  family: ToolFamily = "think",
  tools = 0,
): LaneAgent => ({ key, god, look, family, tools });

interface Stage {
  readonly lane: HTMLElement;
  /** Its clock. Every advance ends with a frame drawn at the moment it ends on. */
  readonly host: ManualHost;
  /** Hand the floor its records, and let it see them. */
  sync(agents: readonly LaneAgent[]): void;
  peek(): FloorPeek;
  cell(key: string): HTMLElement | undefined;
  /** Its carved name. */
  label(key: string): HTMLElement | undefined;
  cells(): HTMLElement[];
  /** The card's frame, and whose card the floor said was up, in order. */
  readonly card: HTMLElement;
  readonly cards: (string | null)[];
  /** The composer's text box, after the lane. */
  readonly box: HTMLTextAreaElement;
  /** The tesserae's canvas, as a count of what the floor has drawn on it. */
  readonly fx: CountingBrush;
  /** The floor mosaic's canvas, counted the same way: a fill is a colour's stones at rest, or one on its way. */
  readonly bed: CountingBrush;
  /** How often the floor has put a step on the clock or woken it, and drawn its dice. */
  readonly asked: { clock: number; dice: number };
  /** How many of those were only a wake: no step. */
  readonly woken: { times: number };
  /** How many frames the floor has drawn. */
  readonly drawn: { frames: number };
  names(): string[];
  setWidth(width: number): void;
  resize(): void;
  /** The reader asks for less motion, or no longer does. */
  quiet(on: boolean): void;
  dispose(): void;
}

/** Every floor a test has made: each is taken down after it, with its listeners on the page. */
const stages: { dispose(): void }[] = [];

/**
 * A lane with a clock that moves only when told to, and draws a frame for the
 * moment each advance ends on (framedHost); a letter is 5.5px wide. Its
 * canvases count what is drawn on them, the gods' tesserae on one and the
 * floor's mosaic on the other: jsdom draws none. Its gods hold their poses
 * still unless it is asked for their fidgets, take no notice of each other
 * unless it is asked for their reactions, and cannot be startled unless it is
 * asked for that: the run is the same either way.
 */
function stage({
  seed = 7,
  width = 698,
  letter = 5.5,
  reduced = false,
  fidget = false,
  react = false,
  startle = false,
  medallions = true,
  starts = START_URLS as Partial<typeof START_URLS>,
  cast = CAST,
} = {}): Stage {
  const lane = document.createElement("div");
  lane.className = "oly-lane is-shut";
  lane.innerHTML =
    '<canvas class="oly-mosaic"></canvas><canvas class="oly-fx"></canvas><div class="oly-gods"></div><div class="oly-stylobate"><div class="oly-names"></div></div><span class="oly-anta is-l"></span><span class="oly-anta is-r"></span>';
  const fx = countingBrush();
  lane.querySelector<HTMLCanvasElement>("canvas.oly-fx")!.getContext = (() =>
    fx.ctx) as unknown as HTMLCanvasElement["getContext"];
  const bed = countingBrush();
  lane.querySelector<HTMLCanvasElement>("canvas.oly-mosaic")!.getContext = (() =>
    bed.ctx) as unknown as HTMLCanvasElement["getContext"];
  const card = document.createElement("div");
  card.className = "oly-card";
  const box = document.createElement("textarea");
  document.body.append(card, lane, box);
  const host = framedHost();
  let w = width;
  let quiet = reduced;
  const asked = { clock: 0, dice: 0 };
  const woken = { times: 0 };
  const drawn = { frames: 0 };
  const cards: (string | null)[] = [];
  const clock = createSim(host);
  const sim: Sim = {
    ...clock,
    view: (fn) => clock.view((now) => (drawn.frames++, fn(now))),
    at: (t, fn) => (asked.clock++, clock.at(t, fn)),
    after: (ms, fn) => (asked.clock++, clock.after(ms, fn)),
    soon: (fn) => (asked.clock++, clock.soon(fn)),
    wake: () => (asked.clock++, woken.times++, clock.wake()),
  };
  const dice = rng(seed);
  const floor = createFloor(lane, {
    sim,
    cast,
    poses: POSE_URLS,
    frames: FRAME_URLS,
    fidget,
    crowns: CROWN_URLS,
    react,
    starts,
    startle,
    medallions,
    random: () => (asked.dice++, dice()),
    width: () => w,
    measure: (el) => Math.round((el.textContent ?? "").length * letter) + 21,
    reduced: () => quiet,
    card,
    onCard: (key) => cards.push(key),
    describe: (key) => `row-${key}`,
    away: () => box,
    timer: host,
  });
  const order = new Map<string, HTMLElement>();
  const cells = (): HTMLElement[] => [...lane.querySelectorAll<HTMLElement>(".oly-cell")];
  stages.push(floor);
  return {
    lane,
    host,
    card,
    cards,
    box,
    fx,
    bed,
    asked,
    woken,
    drawn,
    label(key) {
      const i = floor.peek().gods.findIndex((god) => god.key === key);
      return i < 0 ? undefined : [...lane.querySelectorAll<HTMLElement>(".oly-ins")][i];
    },
    sync(agents) {
      floor.sync(agents);
      host.advance(0);
    },
    peek: () => floor.peek(),
    cell(key) {
      const i = floor.peek().gods.findIndex((god) => god.key === key);
      return i < 0 ? undefined : cells()[i];
    },
    cells,
    names: () => [...lane.querySelectorAll(".oly-ins")].map((name) => name.textContent ?? ""),
    setWidth(next) {
      w = next;
      order.clear();
    },
    resize() {
      floor.resize();
      host.advance(0);
    },
    quiet(on) {
      quiet = on;
    },
    dispose: () => floor.dispose(),
  };
}

const shut = (s: Stage): boolean => s.lane.classList.contains("is-shut");

// ── Part 5: a god's turn, ms ──
const LAND = 1000; // after the lane opens, as the floor's last courses go down
const LAND_STILL = 500; // under reduced motion: a beat
const PRISED = 1150; // the floor's stones are prised up, before the lane falls
const SET = 1150; // a god's tesserae are set, from the feet up
const REVEAL = 250; // and the carved figure shows through them
const SHOWN = SET + REVEAL; // from its landing to its greeting
const UNSET = 140; // going back to them, the figure gives way
const GONE = 1300; // and they are thrown off
const CRUMBLED = 1250; // or, failed, they fall and lie a moment
const UNFURL = 650;
const SAY = 1400;
const FURL = 280;
const LINE = UNFURL + SAY + FURL; // a ribbon, from first to last
const SEALED = 1000;
const FAIL_HOLD = 3000;

type Seen = FloorPeek["gods"][number];
const out = (s: Stage, key?: string): Seen =>
  key === undefined ? s.peek().gods[0]! : s.peek().gods.find((it) => it.key === key)!;
/** Where a god's cell stands at its place. */
function seatOf(seen: Seen): number {
  const [lo, hi] = CAST.gods[seen.god].env;
  return seen.place![0] - (seen.face > 0 ? lo : 66 - hi);
}
const figure = (cell: HTMLElement): HTMLElement => cell.querySelector<HTMLElement>(".oly-fig")!;
/** How many stones a god's pose is cut into. */
const stonesOf = (god: GodId, pose: "speak" | "stand"): number =>
  CAST.gods[god].tiles[pose].reduce((n, course) => n + course[4].replace(/-/g, "").length, 0);
const ribbon = (cell: HTMLElement): HTMLElement => cell.querySelector<HTMLElement>(".oly-ribbon")!;

/** Move the clock on, a ms at a time, until something is so. */
function until(s: Stage, done: () => boolean, limit = 60_000): void {
  for (let ms = 0; ms < limit; ms++) {
    if (done()) return;
    s.host.advance(1);
  }
  throw new Error("it never came");
}

/** Move the clock on, a ms at a time, until `n` gods are out and every one is at its work. */
function settle(s: Stage, n = 1): void {
  for (let ms = 0; ms < 60_000; ms++) {
    const { gods } = s.peek();
    if (gods.length === n && gods.every((god) => god.step === "work")) return;
    s.host.advance(1);
  }
  throw new Error(`${n} gods never came to their work`);
}
const ribbonOf = (cell: HTMLElement | undefined): string | null =>
  cell?.querySelector(".oly-ribbon")?.textContent ?? null;

/** Every place apart from the next by a gap, inside the lane; no figure on another. */
function expectApart(peek: FloorPeek): void {
  const sorted = (spans: (readonly [number, number])[]): (readonly [number, number])[] =>
    [...spans].sort((p, q) => p[0] - q[0]);
  const places = sorted(peek.gods.flatMap((god) => (god.place ? [god.place] : [])));
  places.forEach((place, i) => {
    expect(place[0]).toBeGreaterThanOrEqual(16 - 6 - 0.001);
    expect(place[1]).toBeLessThanOrEqual(peek.width - 16 + 6 + 0.001);
    if (i) expect(place[0] - places[i - 1]![1]).toBeGreaterThanOrEqual(4 - 0.001);
  });
  const figures = sorted(peek.gods.map((god) => god.figure));
  figures.forEach((figure, i) => {
    if (i) expect(figure[0]).toBeGreaterThan(figures[i - 1]![1]);
  });
}

afterEach(() => {
  for (const floor of stages.splice(0)) floor.dispose();
  document.body.replaceChildren();
});

describe("the lane opening and shutting", () => {
  it("is shut until an agent is sent, and opens at once when one is", () => {
    const s = stage();
    expect(shut(s)).toBe(true);
    s.sync([]);
    expect(shut(s)).toBe(true);
    s.sync([agent("a", "athena")]);
    expect(shut(s)).toBe(false);
    expect(s.peek().open).toBe(true);
    expect(s.cells()).toHaveLength(0); // open, and nobody on it yet
  });

  it("its floor is prised up a beat after the last god has gone, then it falls, and is shut once it is down; not while one is left", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "hermes")]);
    settle(s, 2);
    s.sync([agent("a", "athena", "fail"), agent("b", "hermes")]);
    s.host.advance(FAIL_HOLD + CRUMBLED); // the failed one has gone
    expect(s.cells()).toHaveLength(1);
    s.host.advance(5000);
    expect(shut(s)).toBe(false);
    s.sync([agent("a", "athena", "fail"), agent("b", "hermes", "stop")]);
    s.host.advance(FAIL_HOLD + GONE);
    expect(s.cells()).toHaveLength(0);
    expect(s.peek().lane).toEqual({ mode: "open", height: 125 });
    s.host.advance(599);
    expect(s.peek().lane.mode).toBe("open");
    s.host.advance(1);
    expect(s.peek().lane).toEqual({ mode: "lift", height: 125 });
    s.host.advance(PRISED - 1);
    expect(s.peek().lane).toEqual({ mode: "lift", height: 125 });
    s.host.advance(1);
    expect(s.peek().lane.mode).toBe("fall");
    s.host.advance(359);
    expect(shut(s)).toBe(false);
    expect(s.peek().open).toBe(true);
    s.host.advance(1);
    expect(shut(s)).toBe(true);
    expect(s.peek()).toMatchObject({ open: false, lane: { mode: "shut", height: 0 } });
    expect(s.host.pending()).toBe(0); // asleep
  });

  it("stays open if an agent is sent in that beat, and opens again after shutting", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.advance(3000);
    s.sync([]);
    s.host.advance(300);
    s.sync([agent("b", "argus")]);
    s.host.advance(2000);
    expect(s.peek().lane).toEqual({ mode: "open", height: 125 });
    expect(s.cells()).toHaveLength(1);
    s.sync([]);
    s.host.advance(600 + PRISED + 360);
    expect(shut(s)).toBe(true);
    s.sync([agent("c", "nike")]);
    expect(shut(s)).toBe(false);
    s.host.advance(LAND);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["nike"]);
  });

  it("rises as it opens: 420ms from nothing to its height, quick at first", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    expect(s.peek().lane).toEqual({ mode: "rise", height: 0 });
    expect(s.lane.style.height).toBe("0px");
    s.host.advance(105);
    const quarter = s.peek().lane.height;
    expect(quarter).toBeGreaterThan(125 / 2); // more than half way in a quarter of the time
    expect(s.lane.style.height).toBe(`${Math.round(quarter * 100) / 100}px`);
    s.host.advance(105);
    expect(s.peek().lane.height).toBeGreaterThan(quarter);
    expect(s.peek().lane.height).toBeLessThan(125);
    s.host.advance(209);
    expect(s.peek().lane.mode).toBe("rise");
    expect(s.peek().lane.height).toBeCloseTo(125, 1);
    s.host.advance(1);
    // Open: its height is the stylesheet's again. Its floor is still being set.
    expect(s.peek().lane).toEqual({ mode: "open", height: 125 });
    expect(s.lane.style.height).toBe("");
    expect(s.host.pending()).toBe(1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(LAND - 420);
    expect(s.cells()).toHaveLength(1); // 580ms after it is up, as the floor's last courses go down
  });

  it("falls as it shuts: 360ms, slow at first", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.advance(3000);
    s.sync([]);
    s.host.advance(600 + PRISED);
    expect(s.peek().lane).toEqual({ mode: "fall", height: 125 });
    s.host.advance(180);
    const half = s.peek().lane.height;
    expect(half).toBeGreaterThan(125 / 2); // less than half way down in half the time
    expect(half).toBeLessThan(125);
    expect(s.lane.style.height).toBe(`${Math.round(half * 100) / 100}px`);
    expect(shut(s)).toBe(false);
    s.host.advance(180);
    expect(shut(s)).toBe(true);
    expect(s.lane.style.height).toBe("");
  });

  it("an agent sent while it falls waits for it to be down; then it rises again", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.advance(3000);
    s.sync([]);
    s.host.advance(600 + PRISED + 100);
    s.sync([agent("b", "argus")]);
    expect(s.peek()).toMatchObject({ lane: { mode: "fall" }, queue: ["b"] });
    s.host.advance(259);
    expect(s.peek().lane.mode).toBe("fall");
    s.host.advance(1);
    // Down, and up again in the same moment: it was never left shut.
    expect(s.peek().lane).toEqual({ mode: "rise", height: 0 });
    expect(shut(s)).toBe(false);
    s.host.advance(LAND - 1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["argus"]);
    expect(s.peek().lane).toEqual({ mode: "open", height: 125 });
  });
});

describe("landing", () => {
  it("sets the first god a beat after the lane opens, beside its place, from its tesserae: from the feet up over 1150ms, and the carved figure shows through them over 250ms", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND - 1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    const cell = s.cell("a")!;
    expect(cell.dataset.god).toBe("hermes");
    expect(cell.dataset.pose).toBe("speak");
    expect(out(s)).toMatchObject({
      step: "assemble",
      shown: 0,
      line: null,
      tesserae: { mode: "set", dim: false },
    });
    expect(figure(cell).style.opacity).toBe("0");
    expect(s.label("a")!.style.opacity).toBe("0");
    expect(s.fx.stones).toBe(0); // none has begun its flight
    // Beside its place: 44 to 96px from it, where it will walk from.
    const from = out(s).x;
    const away = Math.abs(from - seatOf(out(s)));
    expect(away).toBeGreaterThanOrEqual(44 - 1e-6);
    expect(away).toBeLessThanOrEqual(96);
    expect(cell.style.transform).toBe(`translate3d(${from.toFixed(2)}px, 0, 0)`);
    // From the feet up: half way some are down, and all of them by the end, in
    // its own ivories. The figure isn't there yet.
    const all = stonesOf("hermes", "speak");
    s.host.advance(SET / 2);
    expect(s.fx.stones).toBeGreaterThan(0);
    expect(s.fx.stones).toBeLessThan(all);
    expect(figure(cell).style.opacity).toBe("0");
    s.host.advance(SET / 2);
    expect(s.fx.stones).toBe(all);
    expect([...s.fx.ivories].every((ivory) => CAST.gods.hermes.tiles.palette.includes(ivory))).toBe(
      true,
    );
    expect(out(s)).toMatchObject({ step: "assemble", shown: 0, tesserae: { mode: "rest" } });
    expect(cell.style.transform).toBe(`translate3d(${from.toFixed(2)}px, 0, 0)`);
    // Then the carved figure shows through them, and its name with it.
    s.host.advance(REVEAL / 2);
    expect(out(s).shown).toBeCloseTo(0.5, 6);
    expect(figure(cell).style.opacity).toBe("0.5");
    expect(s.label("a")!.style.opacity).toBe("0.5");
    expect(s.fx.stones).toBe(all);
    expect(ribbonOf(cell)).toBeNull();
    s.host.advance(REVEAL / 2);
    // There, and greeting, where it was set; the canvas is blank again.
    expect(s.fx.stones).toBe(0);
    expect(out(s).tesserae).toBeNull();
    expect(figure(cell).style.opacity).toBe("");
    expect(s.label("a")!.style.opacity).toBe("");
    expect(out(s)).toMatchObject({ step: "greet", pose: "speak", shown: 1, x: from });
    expect(cell.classList.contains("is-speaking")).toBe(true);
    expect([...GREETINGS.any, ...GREETINGS.hermes]).toContain(ribbonOf(cell));
    // Its initial is rubricated.
    expect(cell.querySelector(".oly-band b")?.textContent).toBe(out(s).line![0]);
    expect(s.names()).toEqual(["Hermes"]);
  });

  it("unrolls its greeting over 650ms, holds it whole 1.4s and furls it in 280ms; then it walks to its place", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND + SHOWN);
    const cell = s.cell("a")!;
    expect(ribbon(cell).style.getPropertyValue("--oly-u")).toBe("0.000");
    expect(ribbon(cell).querySelector(".oly-roll")).not.toBeNull();
    s.host.advance(UNFURL / 2);
    expect(out(s).unrolled).toBeCloseTo(1 - 0.5 ** 3, 6); // quick from the hand, easing out
    expect(ribbon(cell).style.getPropertyValue("--oly-u")).toBe("0.875");
    s.host.advance(UNFURL / 2);
    expect(out(s).unrolled).toBe(1);
    expect(ribbon(cell).style.getPropertyValue("--oly-u")).toBe("1.000");
    expect(s.host.pending()).toBe(1); // held whole: the clock sleeps until it is furled
    s.host.advance(SAY);
    expect(out(s).unrolled).toBe(1);
    s.host.advance(FURL / 2);
    expect(out(s).unrolled).toBeCloseTo(0.5, 6);
    expect(ribbon(cell).style.getPropertyValue("--oly-u")).toBe("0.500");
    s.host.advance(FURL / 2 - 1);
    expect(ribbonOf(cell)).not.toBeNull();
    s.host.advance(1);
    expect(ribbonOf(cell)).toBeNull();
    expect(cell.classList.contains("is-speaking")).toBe(false);
    expect(out(s).step).toBe("walk");
    settle(s);
    // At its place, in thought, facing the middle.
    expect(cell.dataset.pose).toBe("think");
    expect(out(s).x).toBe(seatOf(out(s)));
    const headLine = out(s).x + 33;
    expect(out(s).face).toBe(headLine < 698 / 2 ? 1 : -1);
    expect(out(s).dir).toBe(out(s).face);
    expect(cell.classList.contains("is-left")).toBe(out(s).face < 0);
    expect(s.host.pending()).toBe(0); // a still: nothing ticks while it holds its pose
  });

  it("lands a crowd one at a time, in the order they were sent, 850ms apart, each once there is room to set it", () => {
    const s = stage();
    const sent = [
      agent("a", "athena"),
      agent("b", "hephaestus"),
      agent("c", "argus"),
      agent("d", "nike"),
    ];
    s.sync(sent.slice(0, 1));
    s.host.advance(120);
    s.sync(sent.slice(0, 3));
    s.host.advance(120);
    s.sync(sent);
    expect(s.peek().queue).toEqual(["a", "b", "c", "d"]);
    s.host.advance(LAND - 240); // a second after the lane opened
    const landed = (): string[] => s.peek().gods.map((seen) => seen.key);
    expect(landed()).toEqual(["a"]);
    s.host.advance(849);
    expect(landed()).toEqual(["a"]);
    s.host.advance(1);
    expect(landed()).toEqual(["a", "b"]);
    s.host.advance(850);
    expect(landed()).toEqual(["a", "b", "c"]);
    // The fourth no sooner; where the others still stand beside its place, it waits for them to go on.
    s.host.advance(849);
    expect(landed()).toEqual(["a", "b", "c"]);
    until(s, () => landed().length === 4, 5000);
    expect(landed()).toEqual(["a", "b", "c", "d"]);
    expect(s.peek().queue).toEqual([]);
    expect(s.names().sort()).toEqual(["Argus", "Athena", "Hephaestus", "Nike"]);
  });

  it("places a crowd sent together all at once, so the first is not left in the middle", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "hermes"), agent("c", "argus")]);
    s.host.advance(LAND);
    const first = out(s, "a").place;
    settle(s, 3);
    expect(out(s, "a").place).toEqual(first); // nobody stepped aside
    expect(out(s, "a").x).toBe(seatOf(out(s, "a")));
  });

  it("never sets a god whose agent ended while it waited to land", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "hermes")]);
    s.host.advance(600);
    s.sync([agent("a", "athena"), agent("b", "hermes", "done")]);
    s.host.advance(5000);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["athena"]);
    expect(s.peek().queue).toEqual([]);
  });

  it("plays the same run the same way from the same seed", () => {
    const play = (seed: number): string => {
      const s = stage({ seed });
      const out: string[] = [];
      for (let ms = 0; ms <= 30_000; ms += 250) {
        s.sync(laneAgents([{ agents: agentsAt(MOCK_RUN, ms) }]));
        out.push(s.lane.innerHTML);
        s.host.advance(250);
      }
      s.dispose();
      return out.join("\n");
    };
    expect(play(11)).toBe(play(11));
    expect(play(11)).not.toBe(play(12));
  });
});

describe("a god's states, from its agent's record", () => {
  const one = (status: keyof typeof STATE_AGENTS, aborted = false): LaneAgent[] =>
    laneAgents([{ agents: [{ ...STATE_AGENTS[status], toolCallId: "it" }], aborted }]);

  /** A god at its place, at its work: landed, greeted, and walked there. */
  function atWork(): Stage {
    const s = stage();
    s.sync(one("running"));
    settle(s);
    return s;
  }

  it.each([
    ["starting", "think"],
    ["running", "look"],
  ] as const)("%s: a god is summoned, and is at its work", (status, pose) => {
    const s = stage();
    s.sync(one(status));
    settle(s);
    const cell = s.cell("it")!;
    expect(cell.dataset.god).toBe("argus");
    expect(cell.dataset.pose).toBe(pose);
    expect(cell.className).toBe("oly-cell" + (s.peek().gods[0]!.face < 0 ? " is-left" : ""));
    s.host.advance(60_000);
    expect(s.cells()).toHaveLength(1); // it stays for as long as its agent works
  });

  it.each(["done", "error", "idle", "interrupted"] as const)(
    "%s when first seen: nobody is summoned, and the lane stays shut",
    (status) => {
      const s = stage();
      s.sync(one(status));
      s.host.advance(10_000);
      expect(s.cells()).toHaveLength(0);
      expect(shut(s)).toBe(true);
    },
  );

  it("an unfinished agent of a stopped run, when first seen: nobody is summoned", () => {
    const s = stage();
    s.sync(one("running", true));
    s.host.advance(10_000);
    expect(s.cells()).toHaveLength(0);
    expect(shut(s)).toBe(true);
  });

  it.each(["done", "idle"] as const)(
    "%s: a farewell, the seal pressed on its scroll, and it walks off and goes back to tesserae, lifted and thrown off",
    (status) => {
      const s = atWork();
      s.sync(one(status));
      const cell = s.cell("it")!;
      expect([...FAREWELLS.any, ...FAREWELLS.argus]).toContain(ribbonOf(cell));
      expect(cell.dataset.pose).toBe("speak");
      expect(out(s).unrolled).toBe(0);
      s.host.advance(LINE - 1);
      expect(ribbonOf(cell)).not.toBeNull();
      s.host.advance(1);
      expect(ribbonOf(cell)).toBeNull();
      expect(cell.dataset.pose).toBe("stand");
      // The seal comes down at 300ms, pressed in from 1.7 times its size over 180ms.
      const seal = cell.querySelector<SVGElement>(".oly-seal")!;
      s.host.advance(299);
      expect(cell.classList.contains("is-sealed")).toBe(false);
      s.host.advance(1);
      expect(cell.classList.contains("is-sealed")).toBe(true);
      expect(seal.style.transform).toBe("scale(1.700)");
      s.host.advance(90);
      expect(out(s).press).toBeCloseTo(1.35, 6);
      expect(seal.style.transform).toBe("scale(1.350)");
      s.host.advance(90);
      expect(seal.style.transform).toBe("");
      expect(cell.classList.contains("is-dim")).toBe(false);
      const at = out(s).x;
      s.host.advance(SEALED - 480 - 1);
      expect(out(s)).toMatchObject({ step: "seal", x: at });
      expect(out(s).place).not.toBeNull();
      s.host.advance(1);
      // Its place is free, and it walks off toward the nearer end of the lane.
      expect(out(s)).toMatchObject({ step: "walk", place: null });
      until(s, () => out(s).step === "unset");
      const off = out(s).x - at;
      expect(Math.sign(off)).toBe(at + 33 < 698 / 2 ? -1 : 1);
      expect(Math.abs(off)).toBeGreaterThan(3 * 34 - 1e-6); // three or four of Argus's strides
      expect(Math.abs(off)).toBeLessThan(4 * 34 + 1e-6);
      // And it goes back to tesserae: the figure gives way to them over 140ms and
      // its name over 420; they are prised up and thrown off, in its own ivories.
      expect(out(s).tesserae).toEqual({ mode: "lift", dim: false });
      s.host.advance(UNSET / 2);
      expect(figure(cell).style.opacity).toBe("0.5");
      expect(s.label("it")!.style.opacity).toBe("0.833");
      s.host.advance(UNSET / 2);
      expect(figure(cell).style.opacity).toBe("0");
      expect(s.fx.stones).toBe(stonesOf("argus", "stand"));
      expect(
        [...s.fx.ivories].every((ivory) => CAST.gods.argus.tiles.palette.includes(ivory)),
      ).toBe(true);
      s.host.advance(420 - UNSET);
      expect(s.label("it")!.style.opacity).toBe("0");
      expect(out(s).x).toBe(at + off); // where it stood
      // The crown's go first: a second in, they have flown and the feet's are still on their way.
      s.host.advance(1000 - 420);
      expect(s.fx.stones).toBeGreaterThan(0);
      expect(s.fx.stones).toBeLessThan(stonesOf("argus", "stand"));
      s.host.advance(GONE - 1000 - 1);
      expect(s.cells()).toHaveLength(1);
      expect(s.fx.stones).toBe(0); // the last has flown
      s.host.advance(1);
      expect(s.cells()).toHaveLength(0);
      expect(s.names()).toEqual([]);
    },
  );

  it("failed: it stands, dims and cracks, 3s in all without a word, and crumbles: its dimmed tesserae fall where it stands", () => {
    const s = atWork();
    s.sync(one("error"));
    const cell = s.cell("it")!;
    expect(ribbonOf(cell)).toBeNull();
    expect(cell.dataset.pose).toBe("stand");
    // It stands a moment; then the crack comes in over 220ms and it dims over 900.
    s.host.advance(300);
    expect(cell.classList.contains("is-dim")).toBe(false);
    expect(cell.classList.contains("is-cracked")).toBe(false);
    s.host.advance(110);
    expect(cell.classList.contains("is-dim")).toBe(true);
    expect(cell.classList.contains("is-cracked")).toBe(true);
    expect(cell.style.getPropertyValue("--oly-crack")).toBe("0.500");
    expect(cell.style.getPropertyValue("--oly-dim")).toBe("0.122");
    s.host.advance(110);
    expect(cell.style.getPropertyValue("--oly-crack")).toBe(""); // all there
    s.host.advance(680);
    expect(out(s).dim).toBe(1);
    expect(cell.style.getPropertyValue("--oly-dim")).toBe("");
    expect(cell.classList.contains("is-sealed")).toBe(false);
    expect(s.host.pending()).toBe(1); // dimmed and still: the clock sleeps until it goes
    s.host.advance(FAIL_HOLD - 1200 - 1);
    expect(out(s)).toMatchObject({ step: "fail", shown: 1 });
    s.host.advance(1);
    expect(out(s)).toMatchObject({
      step: "unset",
      place: null,
      tesserae: { mode: "fall", dim: true },
    });
    s.host.advance(UNSET / 2);
    expect(figure(cell).style.opacity).toBe("0.5");
    expect(cell.classList.contains("is-cracked")).toBe(true); // dimmed and cracked as it gives way
    s.host.advance(UNSET / 2);
    // Every stone of its standing figure, in none of its own ivories: each is dimmed.
    expect(figure(cell).style.opacity).toBe("0");
    expect(s.fx.stones).toBe(stonesOf("argus", "stand"));
    expect([...s.fx.ivories].some((ivory) => CAST.gods.argus.tiles.palette.includes(ivory))).toBe(
      false,
    );
    s.host.advance(CRUMBLED - UNSET - 1);
    expect(s.cells()).toHaveLength(1);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(0);
    expect(s.fx.stones).toBe(0);
  });

  it.each([
    ["interrupted", one("interrupted")],
    ["unfinished in a stopped run", one("running", true)],
    ["failed in a stopped run", one("error", true)],
  ] as const)(
    "%s: it dims with no crack, 3s in all without a word, and goes where it stands, its dimmed tesserae lifted as a done god's are",
    (_, records) => {
      const s = atWork();
      s.sync(records);
      const cell = s.cell("it")!;
      const at = out(s).x;
      expect(ribbonOf(cell)).toBeNull();
      expect(cell.dataset.pose).toBe("stand");
      expect(cell.classList.contains("is-dim")).toBe(false);
      s.host.advance(300 + 450);
      expect(cell.style.getPropertyValue("--oly-dim")).toBe("0.500");
      s.host.advance(450);
      expect(cell.classList.contains("is-dim")).toBe(true);
      expect(cell.style.getPropertyValue("--oly-dim")).toBe("");
      expect(cell.classList.contains("is-cracked")).toBe(false);
      s.host.advance(FAIL_HOLD - 1200 - 1);
      expect(out(s).step).toBe("fail");
      s.host.advance(1);
      // Not broken: it goes as a done god does, but from where it stands. Only a failure crumbles.
      expect(out(s)).toMatchObject({
        step: "unset",
        x: at,
        place: null,
        tesserae: { mode: "lift", dim: true },
      });
      expect(cell.classList.contains("is-cracked")).toBe(false);
      s.host.advance(UNSET);
      expect(s.fx.stones).toBe(stonesOf("argus", "stand"));
      expect([...s.fx.ivories].some((ivory) => CAST.gods.argus.tiles.palette.includes(ivory))).toBe(
        false,
      );
      s.host.advance(GONE - UNSET - 1);
      expect(s.cells()).toHaveLength(1);
      s.host.advance(1);
      expect(s.cells()).toHaveLength(0);
    },
  );

  it("finished in a stopped run: it keeps its farewell and its seal", () => {
    const s = atWork();
    s.sync(one("done", true));
    expect(ribbonOf(s.cell("it"))).not.toBeNull();
    s.host.advance(LINE + 480);
    expect(s.cell("it")!.classList.contains("is-sealed")).toBe(true);
    expect(s.cell("it")!.classList.contains("is-dim")).toBe(false);
  });

  it("ended while it greets: the greeting is said out first", () => {
    const s = stage();
    s.sync(one("running"));
    s.host.advance(LAND + SHOWN + 400);
    const greeting = ribbonOf(s.cell("it"));
    expect(greeting).not.toBeNull();
    s.sync(one("error"));
    expect(ribbonOf(s.cell("it"))).toBe(greeting);
    s.host.advance(LINE - 400); // the greeting is over: it stands where it greeted
    expect(ribbonOf(s.cell("it"))).toBeNull();
    expect(out(s).step).toBe("fail");
    expect(s.cell("it")!.classList.contains("is-dim")).toBe(false);
    s.host.advance(1200);
    expect(s.cell("it")!.classList.contains("is-cracked")).toBe(true);
  });

  it("its ending is settled once: a later record doesn't change how it goes", () => {
    const s = atWork();
    s.sync(one("error"));
    s.sync(one("done"));
    expect(ribbonOf(s.cell("it"))).toBeNull();
    s.host.advance(1200);
    expect(ribbonOf(s.cell("it"))).toBeNull();
    expect(s.cell("it")!.classList.contains("is-cracked")).toBe(true);
  });

  it("gone from the records: its god goes at once, and the lane falls shut", () => {
    const s = atWork();
    s.sync([]);
    expect(s.cells()).toHaveLength(0);
    expect(s.names()).toEqual([]);
    s.host.advance(600 + PRISED + 360);
    expect(shut(s)).toBe(true);
  });

  it("sent on again after it has gone: it lands again, with a greeting", () => {
    const s = stage();
    const at = (i: number): LaneAgent[] => laneAgents([{ agents: [SENT_ON_AGAIN[i]!] }]);
    s.sync(at(0));
    settle(s);
    s.sync(at(1)); // idle
    until(s, () => s.cells().length === 0);
    s.host.advance(600 + PRISED + 360);
    expect(shut(s)).toBe(true);
    s.sync(at(2)); // sent on again
    expect(shut(s)).toBe(false);
    s.host.advance(LAND + SHOWN);
    expect(s.cell("s-again")!.dataset.pose).toBe("speak");
    expect([...GREETINGS.any, ...GREETINGS.nike]).toContain(ribbonOf(s.cell("s-again")));
    settle(s);
    s.sync(at(3)); // closed
    s.host.advance(180); // the one who flies comes down first
    expect([...FAREWELLS.any, ...FAREWELLS.nike]).toContain(ribbonOf(s.cell("s-again")));
  });

  it("sent on again while it is going: it goes, then lands again", () => {
    const s = stage();
    const at = (i: number): LaneAgent[] => laneAgents([{ agents: [SENT_ON_AGAIN[i]!] }]);
    s.sync(at(0));
    settle(s);
    s.sync(at(1));
    s.host.advance(1000);
    s.sync(at(2)); // at work again, its god still saying farewell
    expect(ribbonOf(s.cell("s-again"))).not.toBeNull();
    until(s, () => out(s).step === "seal");
    s.host.advance(480);
    expect(s.cell("s-again")!.classList.contains("is-sealed")).toBe(true);
    until(s, () => out(s).step === "unset");
    s.host.advance(GONE - 1);
    expect(out(s).step).toBe("unset");
    s.host.advance(1); // gone, and set again in the same moment
    expect(s.cells()).toHaveLength(1);
    expect(out(s)).toMatchObject({ step: "assemble", pose: "speak", shown: 0 });
    expect(s.cell("s-again")!.classList.contains("is-sealed")).toBe(false);
    s.host.advance(SHOWN);
    expect([...GREETINGS.any, ...GREETINGS.nike]).toContain(ribbonOf(s.cell("s-again")));
    expect(shut(s)).toBe(false);
  });
});

describe("places", () => {
  it("never puts two gods where their envelopes meet, for one to five, on a wide or narrow lane", () => {
    for (const width of [698, 602]) {
      for (let seed = 1; seed <= 24; seed++) {
        const dice = rng(seed * 977);
        const pick = (): GodId => ALL[Math.floor(dice() * ALL.length)]!;
        for (let n = 1; n <= 5; n++) {
          const s = stage({ seed, width });
          const crowd = Array.from({ length: n }, (_, i) => agent(`g${i}`, pick()));
          // Some together and the rest one by one, then one ends and another is sent.
          const together = 1 + Math.floor(dice() * n);
          let sent = crowd.slice(0, together);
          s.sync(sent);
          for (let ms = 0; ms < 24_000; ms += 100) {
            if (ms % 2000 === 1900 && sent.length < n) {
              sent = crowd.slice(0, sent.length + 1);
              s.sync(sent);
            }
            if (ms === 12_000) {
              sent = [{ ...sent[0]!, look: "done" }, ...sent.slice(1)];
              s.sync(sent);
            }
            s.host.advance(100);
            expectApart(s.peek());
          }
          const final = s.peek();
          expect(final.gods).toHaveLength(n - 1);
          expect(final.gods.every((god) => god.step === "work")).toBe(true);
          s.dispose();
          s.lane.remove();
        }
      }
    }
  }, 15_000); // 240 lanes, each with a floor to set: slow under a full run

  it("gives a later god the gap with most room, and nobody else moves if there is enough", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "herodotus")]);
    settle(s, 2);
    const before = s.peek().gods.map((seen) => seen.x);
    s.sync([agent("a", "athena"), agent("b", "herodotus"), agent("c", "hermes")]);
    for (let ms = 0; ms < 10_000; ms += 50) {
      s.host.advance(50);
      expect(
        s
          .peek()
          .gods.slice(0, 2)
          .map((seen) => [seen.x, seen.step]),
      ).toEqual(before.map((x) => [x, "work"]));
    }
    const after = s.peek();
    expect(after.gods.map((seen) => seen.step)).toEqual(["work", "work", "work"]);
    expectApart(after);
  });

  it("keeps the carved names apart and inside the step", () => {
    const s = stage();
    s.sync(
      ["hephaestus", "herodotus", "hephaestus", "herodotus", "hephaestus"].map((god, i) =>
        agent(`g${i}`, god as GodId),
      ),
    );
    s.host.advance(12_000);
    const spans = [...s.lane.querySelectorAll<HTMLElement>(".oly-ins")]
      .map((name) => {
        const left = Number(/translate3d\(([-\d.]+)px/.exec(name.style.transform)![1]);
        return [left, left + Math.round(name.textContent!.length * 5.5) + 21] as const;
      })
      .sort((p, q) => p[0] - q[0]);
    expect(spans).toHaveLength(5);
    spans.forEach((span, i) => {
      expect(span[0]).toBeGreaterThanOrEqual(14 - 0.01);
      expect(span[1]).toBeLessThanOrEqual(698 - 14 + 0.01);
      if (i) expect(span[0] - spans[i - 1]![1]).toBeGreaterThanOrEqual(12 - 0.02);
    });
  });

  it("re-plans the places at once when the lane's width changes, and everyone walks to its own", () => {
    const s = stage();
    s.sync(
      ["nike", "hephaestus", "themis", "argus", "hermes"].map((id, i) =>
        agent(`g${i}`, id as GodId),
      ),
    );
    settle(s, 5);
    expect(s.peek().width).toBe(698);
    const wide = s.peek().gods.map((seen) => seen.x);
    s.setWidth(602);
    s.resize();
    const narrow = s.peek();
    expect(narrow.width).toBe(602);
    // Its place is new at once; the god is still where it stood, and sets off.
    expect(narrow.gods.every((seen) => seen.place![1] <= 602 - 16 + 6)).toBe(true);
    expect(narrow.gods.map((seen) => seen.x)).toEqual(wide);
    const moved = narrow.gods.filter((seen) => Math.abs(seatOf(seen) - seen.x) >= 1.5);
    expect(moved.length).toBeGreaterThan(0);
    for (const seen of narrow.gods)
      expect(seen.step).toBe(moved.includes(seen) ? (seen.lift > 0 ? "alight" : "walk") : "work");
    // On the way nobody walks through anybody.
    for (let ms = 0; ms < 8000 && s.peek().gods.some((seen) => seen.step !== "work"); ms += 50) {
      s.host.advance(50);
      const figures = s
        .peek()
        .gods.map((seen) => seen.figure)
        .sort((p, q) => p[0] - q[0]);
      figures.forEach((span, i) => {
        if (i) expect(span[0]).toBeGreaterThan(figures[i - 1]![1]);
      });
    }
    const there = s.peek();
    expect(there.gods.map((seen) => seen.step)).toEqual(["work", "work", "work", "work", "work"]);
    expect(there.gods.every((seen) => seen.x === seatOf(seen))).toBe(true);
    expectApart(there);
  });
});

describe("more agents than the lane holds", () => {
  it("stands five, and the sixth and seventh wait unseen, oldest first", () => {
    const s = stage();
    const records = (ms: number): LaneAgent[] => laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]);
    for (let ms = 0; ms <= 400; ms += 40) {
      s.sync(records(ms));
      s.host.advance(40);
    }
    s.sync(records(1000)); // the three sent by spawn_agent are up
    until(s, () => s.peek().gods.length === 5);
    const peek = s.peek();
    expect(peek.queue).toEqual([]);
    expect(peek.waiting).toHaveLength(2);
    expectApart(peek);
    // A place is left: the oldest waiting lands, and the other waits on.
    const [oldest, other] = peek.waiting;
    const leaver = peek.gods[0]!;
    until(s, () => out(s, leaver.key).step === "work");
    const rest = records(1000);
    s.sync(rest.map((a) => (a.key === leaver.key ? { ...a, look: "fail" } : a)));
    s.host.advance(FAIL_HOLD + CRUMBLED - 1);
    expect(s.peek().gods.map((seen) => seen.key)).toContain(leaver.key);
    expect(s.peek().waiting).toEqual([oldest, other]);
    s.host.advance(1);
    expect(s.peek().gods.map((seen) => seen.key)).not.toContain(leaver.key);
    expect(s.peek().waiting).toEqual([other]);
    until(s, () => s.peek().gods.length === 5, 5000);
    expect(s.peek().gods.map((seen) => seen.key)).toContain(oldest);
    expect(s.peek().waiting).toEqual([other]);
    expectApart(s.peek());
  });

  it("never brings out one whose agent ended while it waited", () => {
    const s = stage();
    const six = ["athena", "hermes", "argus", "themis", "nike", "herodotus"].map((god, i) =>
      agent(`g${i}`, god as GodId),
    );
    s.sync(six);
    s.host.advance(9000);
    expect(s.peek().waiting).toEqual(["g5"]);
    s.sync(six.map((a) => (a.key === "g5" ? { ...a, look: "done" } : a)));
    expect(s.peek().waiting).toEqual([]);
    s.sync(six.map((a) => ({ ...a, look: "stop" })));
    s.host.advance(12_000); // whoever was still greeting says it out, dims and goes
    expect(s.cells()).toHaveLength(0);
    expect(shut(s)).toBe(true);
  });

  it("keeps the lane open while anyone is still waiting", () => {
    const s = stage();
    const six = ["athena", "hermes", "argus", "themis", "nike", "herodotus"].map((god, i) =>
      agent(`g${i}`, god as GodId),
    );
    s.sync(six);
    s.host.advance(9000);
    s.sync(six.map((a) => (a.key === "g5" ? a : { ...a, look: "stop" })));
    s.host.advance(FAIL_HOLD + GONE + 600 + 500);
    expect(shut(s)).toBe(false);
    expect(s.peek().gods.map((god) => god.key)).toEqual(["g5"]);
  });
});

describe("ribbons", () => {
  it("gives each of a crowd a line of its own or one anyone may say, no two alike", () => {
    const s = stage({ seed: 2 });
    const crowd = (["athena", "hephaestus", "argus", "nike"] as const).map((id, i) =>
      agent(`g${i}`, id),
    );
    s.sync(crowd);
    const said = new Map<string, string>();
    for (let ms = 0; ms < 8000; ms += 50) {
      s.host.advance(50);
      for (const seen of s.peek().gods) if (seen.line) said.set(seen.key, seen.line);
    }
    expect(said.size).toBe(4);
    expect(new Set(said.values()).size).toBe(4);
    for (const { key, god: id } of crowd)
      expect([...GREETINGS.any, ...GREETINGS[id]]).toContain(said.get(key));
  });

  it("holds a line out only inside the lane, and never across another god", () => {
    let lines = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = stage({ seed });
      const crowd = ALL.slice(0, 5).map((god, i) => agent(`g${i}`, god));
      s.sync(crowd);
      for (let ms = 0; ms < 16_000; ms += 100) {
        if (ms === 9000) s.sync(crowd.map((a) => ({ ...a, look: "done" })));
        s.host.advance(100);
        const peek = s.peek();
        for (const speaker of peek.gods) {
          if (!speaker.ribbon) continue;
          lines += 1;
          expect(speaker.ribbon[0]).toBeGreaterThanOrEqual(16);
          expect(speaker.ribbon[1]).toBeLessThanOrEqual(698 - 16);
          // A ribbon is too low to pass over a head: no other god stands under it.
          for (const other of peek.gods) {
            if (other === speaker) continue;
            const head = other.x + 33;
            expect(head > speaker.ribbon[0] && head < speaker.ribbon[1]).toBe(false);
          }
        }
      }
      s.dispose();
      s.lane.remove();
    }
    expect(lines).toBeGreaterThan(500); // and lines were said
  });

  it("ended while it waits for room to greet: it says nothing", () => {
    const s = stage({ letter: 40 });
    s.sync([agent("a", "athena")]);
    s.host.advance(LAND + SHOWN + 100);
    expect(out(s).step).toBe("hold");
    s.sync([agent("a", "athena", "stop")]);
    s.host.advance(200);
    expect(out(s).step).toBe("fail");
    expect(ribbonOf(s.cell("a"))).toBeNull();
    s.host.advance(1200);
    expect(s.cell("a")!.classList.contains("is-dim")).toBe(true);
  });

  it("with no room for any line, a god waits 1.5s and goes to its place without a word", () => {
    const s = stage({ letter: 40 }); // every line longer than the lane
    s.sync([agent("a", "athena")]);
    s.host.advance(LAND + SHOWN);
    expect(ribbonOf(s.cell("a"))).toBeNull();
    expect(s.cell("a")!.dataset.pose).toBe("stand");
    expect(out(s).step).toBe("hold");
    s.host.advance(1400);
    expect(out(s).step).toBe("hold");
    s.host.advance(200);
    expect(out(s).step).toBe("walk");
    settle(s);
    expect(out(s).x).toBe(seatOf(out(s)));
    expect(ribbonOf(s.cell("a"))).toBeNull();
  });

  it("with no room for a farewell, a god waits 3s at most, then seals its scroll and goes", () => {
    const s = stage({ letter: 40 });
    s.sync([agent("a", "athena"), agent("b", "hermes")]);
    settle(s, 2);
    s.sync([agent("a", "athena", "done"), agent("b", "hermes")]);
    const a = (): HTMLElement => s.cell("a")!;
    // Nobody else will move, so it has waited long enough after 1.2s.
    s.host.advance(1199);
    expect(out(s, "a").step).toBe("hold");
    s.host.advance(1);
    expect(out(s, "a").step).toBe("seal");
    expect(a().classList.contains("is-sealed")).toBe(false);
    s.host.advance(300);
    expect(a().classList.contains("is-sealed")).toBe(true);
    expect(ribbonOf(a())).toBeNull();
    until(s, () => s.cells().length === 1, 8000);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["hermes"]);
  });
});

describe("the floor's housekeeping", () => {
  it("does nothing when the records it is handed haven't changed", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    settle(s);
    expect(s.host.pending()).toBe(0);
    s.sync([agent("a", "athena")]);
    expect(s.host.pending()).toBe(0);
  });

  it("takes the first of two records with one key", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("a", "hermes")]);
    s.host.advance(4000);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["athena"]);
  });

  it("builds each god from its pictures, its seal and its crack, as a button of the toolbar", () => {
    const s = stage();
    s.sync([agent("a", "themis")]);
    s.host.advance(LAND);
    const cell = s.cell("a")!;
    expect([...cell.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
      POSE_URLS.themis.speak,
      POSE_URLS.themis.stand,
      POSE_URLS.themis.stride,
      POSE_URLS.themis.look,
      POSE_URLS.themis.web,
      POSE_URLS.themis.run,
      POSE_URLS.themis["think-r"],
      POSE_URLS.themis["think-l"],
    ]);
    // Its standing pictures and its stride fill the cell; a skill pose has a left and a width of its own.
    expect([...cell.querySelectorAll("img")].map((img) => img.getAttribute("style"))).toEqual([
      null,
      null,
      null,
      "left: 12.2px; width: 49px;",
      "left: 16.5px; width: 48px;",
      "left: 9.1px; width: 71px;",
      "left: 17px; width: 67px;",
      "left: 17px; width: 67px;",
    ]);
    expect([...cell.querySelectorAll("img")].every((img) => img.alt === "")).toBe(true);
    expect(cell.querySelector(".oly-seal")?.getAttribute("viewBox")).toBe("0 0 26 26");
    expect(cell.querySelectorAll(".oly-fissure path")).toHaveLength(3);
    expect(cell.style.getPropertyValue("--oly-ex")).toBe("43.5px");
    expect(cell.style.getPropertyValue("--oly-ey")).toBe("43px");
    // The god is all there is to focus, and its pictures say nothing.
    expect([...s.lane.querySelectorAll("[role], [tabindex], button, a, input")]).toEqual([cell]);
  });

  it("disposed: empty and shut, and it takes no more records", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "nike")]);
    s.host.advance(3000);
    s.dispose();
    expect(s.cells()).toHaveLength(0);
    expect(s.names()).toEqual([]);
    expect(shut(s)).toBe(true);
    s.sync([agent("c", "argus")]);
    s.host.advance(5000);
    expect(s.cells()).toHaveLength(0);
    expect(shut(s)).toBe(true);
  });
});

describe("skills: the pose a god acts its agent's tool in", () => {
  const FAMILIES: readonly ToolFamily[] = ["look", "web", "make", "run", "think"];
  /** Each god's pose for each family of tool: its own, or its thinking where it has none. */
  const ACTS: Readonly<Record<GodId, Readonly<Record<ToolFamily, Skill>>>> = {
    athena: { look: "look", web: "think", make: "think", run: "think", think: "think" },
    herodotus: { look: "look", web: "web", make: "think", run: "think", think: "think" },
    hermes: { look: "look", web: "think", make: "make", run: "run", think: "think" },
    hephaestus: { look: "look", web: "think", make: "make", run: "run", think: "think" },
    argus: { look: "look", web: "web", make: "think", run: "run", think: "think" },
    themis: { look: "look", web: "web", make: "think-r", run: "run", think: "think-r" },
    nike: { look: "look", web: "look", make: "make", run: "run", think: "think" },
  };

  const pose = (s: Stage, key = "a"): string | undefined => s.cell(key)?.dataset.pose;

  /**
   * One god at its place: landed, greeted and walked there. Its beat counts
   * from `t0`, the moment it took its place: 2200 under reduced motion.
   */
  function atWork(
    god: GodId,
    family: ToolFamily = "think",
    tools = 0,
    reduced = false,
  ): Stage & { t0: number } {
    const s = stage({ reduced });
    s.sync([agent("a", god, "run", family, tools)]);
    settle(s);
    return Object.assign(s, { t0: s.host.now() });
  }

  /** Hand the floor its records, and say when the pose of one god next changes, to the ms. */
  function cutAfter(s: Stage, records: readonly LaneAgent[], key = "a"): number {
    const was = pose(s, key);
    s.sync(records);
    for (let i = 0; i < 20_000 && pose(s, key) === was; i++) s.host.advance(1);
    return s.host.now();
  }

  /** The poses a god goes through, as the clock is moved on 10ms at a time. */
  function watch(s: Stage, ms: number, key = "a"): string[] {
    const seen = [pose(s, key) ?? ""];
    for (let t = 0; t < ms; t += 10) {
      s.host.advance(10);
      const now = pose(s, key) ?? "";
      if (now !== seen[seen.length - 1]) seen.push(now);
    }
    return seen;
  }

  it.each(ALL)(
    "%s acts each family of tool in its own pose, and thinks where it has none",
    (god) => {
      for (const family of FAMILIES) {
        const s = atWork(god, family, 1);
        s.host.advance(240); // the one who flies is up
        const cell = s.cell("a")!;
        const want = ACTS[god][family];
        expect(cell.dataset.pose).toBe(want);
        expect(s.peek().gods[0]).toMatchObject({ pose: want, want });
        // That pose's picture, where the cast data puts it in the cell.
        const img = cell.querySelector<HTMLImageElement>(`.oly-p-${want}`)!;
        const [left, width] = CAST.gods[god].at[want]!;
        expect(img.getAttribute("src")).toBe(POSE_URLS[god][want]);
        expect(img.style.left).toBe(`${left}px`);
        expect(img.style.width).toBe(`${width}px`);
        // Only the one who flies is off the floor, and only at her look.
        expect(s.peek().gods[0]!.lift).toBe(god === "nike" && want === "look" ? 8 : 0);
        expect(s.host.pending()).toBe(0); // a still: nothing ticks while it holds its pose
        s.dispose();
      }
    },
  );

  it("thinks while its agent's record has no activity yet", () => {
    const [starting] = laneAgents([{ agents: [STATE_AGENTS.starting] }]);
    expect(starting).toMatchObject({ god: "argus", look: "run", family: "think" });
    const s = stage();
    s.sync([starting!]);
    settle(s);
    expect(pose(s, "s-starting")).toBe("think");
    s.host.advance(60_000);
    expect(pose(s, "s-starting")).toBe("think"); // and goes on thinking until a tool begins
  });

  it("reaches its place already acting the tool its agent is on, with no pose but its walk between", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND + SHOWN + 400); // in the middle of its greeting
    s.sync([agent("a", "hermes", "run", "run", 1)]);
    expect(pose(s)).toBe("speak"); // the greeting is said out first
    const seen = watch(s, 6000);
    expect(seen[0]).toBe("speak");
    expect(seen[1]).toBe("stride");
    expect(seen.slice(1, -1).every((it) => it === "stride" || it === "stand")).toBe(true);
    expect(seen[seen.length - 1]).toBe("run");
    expect(s.peek().gods[0]!.step).toBe("work");
  });

  it("holds a pose for its dwell: 900ms, or two of the god's own steps if that is longer", () => {
    // From when it took its place to the first of its beats after its dwell.
    const first: Readonly<Record<GodId, number>> = {
      athena: 2 * 520,
      herodotus: 2 * 600,
      hermes: 3 * 300,
      hephaestus: 2 * 560,
      argus: 2 * 500,
      themis: 2 * 640,
      nike: 3 * 360, // 900ms is two and a half of her steps: the cut waits for the third
    };
    for (const god of ALL) {
      const s = atWork(god);
      const was = pose(s);
      s.sync([agent("a", god, "run", "look", 1)]);
      s.host.advance(first[god] - 1);
      expect(pose(s)).toBe(was);
      s.host.advance(1);
      expect(pose(s)).toBe("look");
      s.host.advance(240); // the one who flies rises with it
      expect(s.host.pending()).toBe(0);
      s.dispose();
    }
  });

  it("cuts on the god's own beat, counted from when it took its place", () => {
    for (const god of ALL) {
      const s = atWork(god);
      s.host.advance(2040); // long past its dwell, and between two beats
      const step = CAST.gods[god].step;
      const at = cutAfter(s, [agent("a", god, "run", "look", 1)]);
      expect(at).toBeGreaterThan(s.t0 + 2040);
      expect(at).toBe(s.t0 + Math.ceil(2040 / step) * step);
      s.dispose();
    }
  });

  it("the latest want wins: what came and went inside a dwell is never shown", () => {
    const s = atWork("hephaestus");
    s.host.advance(100);
    s.sync([agent("a", "hephaestus", "run", "make", 1)]);
    s.host.advance(200);
    s.sync([agent("a", "hephaestus", "run", "run", 2)]);
    s.host.advance(200);
    s.sync([agent("a", "hephaestus", "run", "look", 3)]);
    expect(watch(s, 3000)).toEqual(["think", "look"]);
    // One cut, at the second of its 560ms steps.
    expect(s.peek().gods[0]).toMatchObject({ pose: "look", want: "look" });
  });

  it("a tool that began and ended inside a dwell leaves no cut on the clock", () => {
    const s = atWork("hermes");
    s.host.advance(100);
    s.sync([agent("a", "hermes", "run", "look", 1)]);
    expect(s.host.pending()).toBe(1);
    s.host.advance(300);
    s.sync([agent("a", "hermes", "run", "think", 2)]); // a tool with no family
    expect(watch(s, 5000)).toEqual(["think"]);
    expect(s.host.pending()).toBe(0);
  });

  it("a new tool of the same family, or of the same pose, is no cut", () => {
    const athena = atWork("athena", "look", 1);
    athena.sync([agent("a", "athena", "run", "look", 2)]); // a read, then a grep
    expect(athena.host.pending()).toBe(0);
    expect(watch(athena, 5000)).toEqual(["look"]);
    const nike = atWork("nike", "look", 1);
    nike.host.advance(240); // she is up
    nike.sync([agent("a", "nike", "run", "web", 2)]); // her look and her web are one pose
    expect(nike.host.pending()).toBe(0);
    expect(watch(nike, 5000)).toEqual(["look"]);
  });

  it("three cuts in six seconds are a storm: the dwell is doubled until a pose has held 3s", () => {
    const s = atWork("hermes"); // steps of 300ms, a dwell of 900ms
    let tools = 0;
    const next = (family: ToolFamily): number =>
      cutAfter(s, [agent("a", "hermes", "run", family, ++tools)]);
    expect(next("look")).toBe(s.t0 + 900);
    expect(next("run")).toBe(s.t0 + 1800);
    expect(next("look")).toBe(s.t0 + 2700); // the third: a storm
    expect(next("run")).toBe(s.t0 + 2700 + 1800);
    expect(next("look")).toBe(s.t0 + 4500 + 1800);
    // Calm: this pose is left alone for 3s and more.
    s.host.advance(3100);
    expect(next("run")).toBe(s.t0 + 9600); // its next beat
    expect(next("look")).toBe(s.t0 + 9600 + 900);
  });

  it("three cuts further apart are no storm", () => {
    const s = atWork("hermes");
    let tools = 0;
    const next = (family: ToolFamily): number =>
      cutAfter(s, [agent("a", "hermes", "run", family, ++tools)]);
    expect(next("look")).toBe(s.t0 + 900);
    s.host.advance(2900);
    expect(next("run")).toBe(s.t0 + 3900);
    s.host.advance(3100);
    expect(next("look")).toBe(s.t0 + 7200); // the first is more than six seconds back
    expect(next("run")).toBe(s.t0 + 7200 + 900);
  });

  it("Themis tips her scales the other way each time she comes back to them", () => {
    const s = atWork("themis");
    let tools = 0;
    const next = (family: ToolFamily): string | undefined => {
      cutAfter(s, [agent("a", "themis", "run", family, ++tools)]);
      return pose(s);
    };
    expect(pose(s)).toBe("think-r");
    expect(next("look")).toBe("look");
    expect(next("think")).toBe("think-l");
    // At them, they stay as they are: another tool with no family is no cut.
    s.sync([agent("a", "themis", "run", "think", ++tools)]);
    expect(s.host.pending()).toBe(0);
    expect(watch(s, 4000)).toEqual(["think-l"]);
    expect(next("run")).toBe("run");
    expect(next("make")).toBe("think-r"); // she has no pose for making: the scales again
    expect(next("web")).toBe("web");
    expect(next("think")).toBe("think-l");
    // On her way back to them, they are not tipped again by a second record.
    expect(next("look")).toBe("look");
    s.sync([agent("a", "themis", "run", "think", ++tools)]);
    s.sync([agent("a", "themis", "run", "make", ++tools)]);
    expect(s.peek().gods[0]!.want).toBe("think-r");
    expect(watch(s, 4000)).toEqual(["look", "think-r"]);
  });

  it("Nike rises 8px over 240ms as her look cuts in and comes down over 180ms before the next cut; her name is not lifted", () => {
    const s = atWork("nike", "look", 1);
    const cell = s.cell("a")!;
    const x = (): string => s.peek().gods[0]!.x.toFixed(2);
    const lift = (): number => s.peek().gods[0]!.lift;
    // Her look cuts in as she takes her place: on the floor, and rising.
    expect(cell.dataset.pose).toBe("look");
    expect(cell.style.transform).toBe(`translate3d(${x()}px, 0, 0)`);
    s.host.advance(120);
    expect(lift()).toBeCloseTo(8 * (1 - 0.5 ** 3), 6); // quick off the floor, easing out
    expect(cell.style.transform).toBe(`translate3d(${x()}px, -7px, 0)`);
    s.host.advance(120);
    expect(lift()).toBe(8);
    expect(cell.style.transform).toBe(`translate3d(${x()}px, -8px, 0)`);
    expect(s.host.pending()).toBe(0); // up, and still
    expect(s.lane.querySelector<HTMLElement>(".oly-ins")!.style.transform).toMatch(/px, 0, 0\)$/);
    // Her next cut is given the time she needs to be down for it: 180ms and her beat, 360ms.
    s.host.advance(2000);
    s.sync([agent("a", "nike", "run", "run", 2)]);
    const cut = s.t0 + Math.ceil((2240 + 180) / 360) * 360;
    s.host.advance(cut - 180 - s.host.now());
    expect(lift()).toBe(8);
    s.host.advance(90);
    expect(lift()).toBeCloseTo(4, 6);
    expect(cell.dataset.pose).toBe("look");
    s.host.advance(89);
    expect(cell.dataset.pose).toBe("look");
    s.host.advance(1);
    expect(cell.dataset.pose).toBe("run");
    expect(cell.style.transform).toBe(`translate3d(${x()}px, 0, 0)`);
    // Her web is her look: up again.
    cutAfter(s, [agent("a", "nike", "run", "web", 3)]);
    s.host.advance(240);
    expect(cell.style.transform).toBe(`translate3d(${x()}px, -8px, 0)`);
    // Ended while she is up: she comes down first, 180ms, and then says her farewell.
    s.sync([agent("a", "nike", "done", "web", 3)]);
    expect(s.peek().gods[0]).toMatchObject({ step: "alight", pose: "look", lift: 8 });
    s.host.advance(90);
    expect(lift()).toBeCloseTo(4, 6);
    s.host.advance(90);
    expect(cell.dataset.pose).toBe("speak");
    expect(cell.style.transform).toBe(`translate3d(${x()}px, 0, 0)`);
  });

  it("Nike, told of a cut that never comes, is down for it and rises again", () => {
    const s = atWork("nike", "look", 1);
    s.host.advance(2000);
    s.sync([agent("a", "nike", "run", "run", 2)]);
    const cut = s.t0 + Math.ceil((2000 + 180) / 360) * 360;
    s.host.advance(cut - 100 - s.host.now()); // on her way down
    expect(s.peek().gods[0]!.lift).toBeLessThan(8);
    s.sync([agent("a", "nike", "run", "look", 3)]); // her look again, after all
    s.host.advance(100);
    expect(s.peek().gods[0]).toMatchObject({ pose: "look", lift: 0 });
    s.host.advance(240);
    expect(s.peek().gods[0]).toMatchObject({ pose: "look", lift: 8 });
    expect(s.host.pending()).toBe(0);
  });

  it("an ending never waits for a dwell: the cut that was coming is dropped", () => {
    const s = atWork("hermes");
    s.host.advance(100);
    s.sync([agent("a", "hermes", "run", "look", 1)]); // a cut due 900ms after it took its place
    s.host.advance(200);
    s.sync([agent("a", "hermes", "done", "look", 1)]);
    const cell = s.cell("a")!;
    expect(cell.dataset.pose).toBe("speak");
    expect([...FAREWELLS.any, ...FAREWELLS.hermes]).toContain(ribbonOf(cell));
    // Its farewell, the seal, its walk off, and gone: never the pose it was going to.
    const seen = watch(s, 8000);
    expect(seen.slice(0, 3)).toEqual(["speak", "stand", "stride"]);
    expect(seen).not.toContain("look");
    expect(seen[seen.length - 1]).toBe("");
    expect(cell.classList.contains("is-sealed")).toBe(true);
    expect(s.cells()).toHaveLength(0);
  });

  it("failed in the middle of a dwell: it stands at once, dims, and is never cut again", () => {
    const s = atWork("hephaestus", "make", 1);
    s.host.advance(100);
    s.sync([agent("a", "hephaestus", "run", "run", 2)]);
    s.host.advance(200);
    s.sync([agent("a", "hephaestus", "fail", "run", 2)]);
    const cell = s.cell("a")!;
    expect(cell.dataset.pose).toBe("stand");
    expect(watch(s, FAIL_HOLD + CRUMBLED - 10)).toEqual(["stand"]);
    expect(cell.classList.contains("is-cracked")).toBe(true);
    s.host.advance(10);
    expect(s.cells()).toHaveLength(0);
  });

  it("asked to step aside in the middle of a dwell: it stands at once, walks, and is in the pose wanted at its new place, its beat begun again", () => {
    const s = stage();
    s.sync([agent("a", "hermes"), agent("b", "hermes")]);
    settle(s, 2);
    const right = along(s)[1]!;
    const records = (family: ToolFamily, tools: number): LaneAgent[] =>
      ["a", "b"].map((key) =>
        key === right ? agent(key, "hermes", "run", family, tools) : agent(key, "hermes"),
      );
    const it = (): FloorPeek["gods"][number] => s.peek().gods.find((seen) => seen.key === right)!;
    cutAfter(s, records("look", 1), right);
    s.sync(records("run", 2)); // a cut due 900ms on
    s.host.advance(100);
    expect(pose(s, right)).toBe("look");
    // The lane narrows by 60px under it: everyone is given a place again.
    const from = it().x;
    const narrow = Math.round(it().place![1] + 16 - 60);
    expect(narrow).toBeGreaterThan(300);
    s.setWidth(narrow);
    s.resize();
    const to = seatOf(it());
    expect(from - to).toBeGreaterThan(50);
    // The cut that was coming is dropped: it sets off at once, in its stride, facing where it goes.
    expect(it()).toMatchObject({ step: "walk", pose: "stride", want: "run", x: from, dir: -1 });
    const ms = Math.round(((from - to) / CAST.gods.hermes.move.speed) * 1000);
    s.host.advance(Math.round(ms / 2));
    expect(it().x).toBeGreaterThan(to);
    expect(it().x).toBeLessThan(from);
    expect(["stride", "stand"]).toContain(pose(s, right));
    // A record that comes on the way is only noted.
    s.sync(records("make", 3));
    expect(it()).toMatchObject({ step: "walk", want: "make" });
    s.host.advance(ms - Math.round(ms / 2) - 1);
    expect(it().step).toBe("walk");
    s.host.advance(1);
    const t0 = s.host.now();
    expect(it()).toMatchObject({ step: "work", pose: "make", want: "make", x: to });
    expect(it().dir).toBe(it().face);
    expectApart(s.peek());
    // Its dwell and its beat count from when it took its new place, not from its old beats.
    expect(cutAfter(s, records("run", 4), right)).toBe(t0 + 900);
  });

  it("under reduced motion a pose is held twice as long, and it takes its place when the stills did", () => {
    const s = atWork("hermes", "think", 0, true);
    expect(s.t0).toBe(2200); // 500ms to land and 1.7s of greeting, with no walk
    let tools = 0;
    const next = (family: ToolFamily): number =>
      cutAfter(s, [agent("a", "hermes", "run", family, ++tools)]);
    expect(next("look")).toBe(2200 + 1800);
    expect(next("run")).toBe(4000 + 1800);
    expect(next("look")).toBe(5800 + 1800); // the third in six seconds: a storm, doubled again
    expect(next("run")).toBe(7600 + 3600);
    // The one who flies is simply up.
    const nike = atWork("nike", "look", 1, true);
    expect(nike.t0).toBe(2200);
    expect(nike.cell("a")!.style.transform).toMatch(/px, -8px, 0\)$/);
    expect(nike.host.pending()).toBe(0);
  });

  describe("an agent sent on again", () => {
    const again = (i: number, more: Partial<(typeof SENT_ON_AGAIN)[number]> = {}): LaneAgent[] =>
      laneAgents([{ agents: [{ ...SENT_ON_AGAIN[i]!, ...more }] }]);

    it("thinks until it starts another tool: its record still names its last turn's", () => {
      const s = stage();
      s.sync(again(0));
      settle(s);
      expect(pose(s, "s-again")).toBe("look"); // its first turn: the search its record ends with
      s.sync(again(1)); // idle
      until(s, () => s.cells().length === 0);
      s.host.advance(600 + PRISED + 360);
      expect(shut(s)).toBe(true);
      expect(again(2)[0]).toMatchObject({ look: "run", family: "look", tools: 2 });
      s.sync(again(2)); // sent on again, with the same last activity
      // Set, its greeting, its walk, and at its place it thinks.
      const walk = (it: string): boolean => it === "stride" || it === "stand";
      expect(watch(s, 8000, "s-again").filter((it) => !walk(it))).toEqual(["", "speak", "think"]);
      // Its next tool, whatever its family: the record is fresh again.
      const more = { toolUseCount: 3, activities: ["Running pnpm test auth"] };
      expect(again(2, more)[0]).toMatchObject({ family: "run", tools: 3 });
      cutAfter(s, again(2, more), "s-again");
      expect(pose(s, "s-again")).toBe("run");
    });

    it("thinks when its god is set again in the moment it leaves", () => {
      const s = stage();
      s.sync(again(0));
      settle(s);
      s.sync(again(1));
      s.host.advance(1000);
      s.sync(again(2)); // at work again, its god still saying farewell
      until(s, () => s.peek().gods[0]!.step === "assemble");
      settle(s);
      expect(s.peek().gods[0]).toMatchObject({ step: "work", pose: "think" });
      cutAfter(s, again(2, { toolUseCount: 3 }), "s-again"); // the same search, run again
      expect(pose(s, "s-again")).toBe("look");
    });

    it("thinks when the floor first saw it idle", () => {
      const s = stage();
      s.sync(again(1));
      s.host.advance(1000);
      expect(s.cells()).toHaveLength(0);
      s.sync(again(2));
      settle(s);
      expect(pose(s, "s-again")).toBe("think");
    });
  });

  it("plays the same run of tools the same way from the same seed", () => {
    const play = (seed: number): string => {
      const s = stage({ seed });
      const out: string[] = [];
      for (let ms = 0; ms <= 30_000; ms += 100) {
        s.sync(laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]));
        out.push(s.lane.innerHTML);
        s.host.advance(100);
      }
      s.dispose();
      return out.join("\n");
    };
    const run = play(5);
    expect(play(5)).toBe(run);
    // Every agent of this run is on a tool before its god reaches its place: nobody thinks.
    for (const skill of ["look", "web", "make", "run"])
      expect(run).toContain(`data-pose="${skill}"`);
    expect(run).not.toContain('data-pose="think');
  });

  it("gone from the records with a cut coming: nothing is cut later", () => {
    const s = atWork("hermes");
    s.sync([agent("a", "hermes", "run", "look", 1)]);
    s.sync([]);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(5000);
    expect(shut(s)).toBe(true);
    expect(s.host.pending()).toBe(0);
  });
});

// ── Part 5: travel ──
describe("walking", () => {
  /** A god alone, at the moment it sets off for its place: from, to, and how long it will take. */
  function settingOff(id: GodId, seed = 7): Stage & { from: number; to: number; ms: number } {
    const s = stage({ seed });
    s.sync([agent("a", id)]);
    s.host.advance(LAND + SHOWN + LINE);
    const from = out(s).x;
    const to = seatOf(out(s));
    const ms = Math.round((Math.abs(to - from) / CAST.gods[id].move.speed) * 1000);
    expect(out(s)).toMatchObject({ step: "walk", x: from });
    return Object.assign(s, { from, to, ms });
  }
  const nameAt = (s: Stage): number =>
    Number(/translate3d\(([-\d.]+)px/.exec(s.label("a")!.style.transform)![1]);

  it("glides to its place at its own pace, in steps of stride and stand on its own beat, facing where it goes", () => {
    const s = settingOff("athena");
    const cell = s.cell("a")!;
    const way = Math.sign(s.to - s.from);
    expect(s.ms).toBeGreaterThan(520); // more than one of her steps
    expect(out(s)).toMatchObject({ pose: "stride", dir: way });
    expect(cell.dataset.pose).toBe("stride");
    expect(cell.classList.contains("is-left")).toBe(way < 0);
    const name = nameAt(s);
    s.host.advance(260);
    // 64px a second, evenly: a quarter of a second in, 16.64px on.
    expect(out(s).x).toBeCloseTo(s.from + way * 64 * 0.26, 1);
    expect(cell.style.transform).toBe(`translate3d(${out(s).x.toFixed(2)}px, 0, 0)`);
    expect(Math.sign(nameAt(s) - name)).toBe(way); // its name goes with it
    s.host.advance(259);
    expect(cell.dataset.pose).toBe("stride");
    s.host.advance(1);
    expect(cell.dataset.pose).toBe("stand"); // her step is 520ms
    expect(out(s).x).toBeCloseTo(s.from + (s.to - s.from) * (520 / s.ms), 6);
    s.host.advance(s.ms - 520 - 1);
    expect(out(s).step).toBe("walk");
    s.host.advance(1);
    // There: at its place, turned to the middle, at its work.
    expect(out(s)).toMatchObject({ step: "work", x: s.to, pose: "think" });
    expect(out(s).dir).toBe(out(s).face);
    expect(cell.style.transform).toBe(`translate3d(${s.to.toFixed(2)}px, 0, 0)`);
    expect(s.host.pending()).toBe(0);
  });

  it("each walks in its own way: Hermes sets off and pulls up, Hephaestus dips on each footfall, Nike skims the floor and settles", () => {
    const hermes = settingOff("hermes");
    const part = (s: typeof hermes): number => (out(s).x - s.from) / (s.to - s.from);
    hermes.host.advance(Math.round(hermes.ms / 4));
    expect(part(hermes)).toBeLessThan(0.1); // slow away
    hermes.host.advance(Math.round(hermes.ms / 2) - Math.round(hermes.ms / 4));
    expect(part(hermes)).toBeCloseTo(0.5, 1);
    hermes.host.advance(Math.round(hermes.ms / 4));
    expect(part(hermes)).toBeGreaterThan(0.9); // and slowing in

    const smith = settingOff("hephaestus");
    expect(smith.ms).toBeGreaterThan(560);
    smith.host.advance(100);
    expect(smith.cell("a")!.dataset.pose).toBe("stride");
    expect(out(smith).lift).toBe(-1); // down on the footfall
    expect(smith.cell("a")!.style.transform).toMatch(/px, 1px, 0\)$/);
    smith.host.advance(460);
    expect(smith.cell("a")!.dataset.pose).toBe("stand");
    expect(out(smith).lift).toBe(0);

    const nike = settingOff("nike");
    nike.host.advance(70);
    expect(out(nike).lift).toBeCloseTo(1, 6); // up 2px in her first 140ms
    nike.host.advance(70);
    expect(out(nike).lift).toBe(2);
    expect(nike.cell("a")!.style.transform).toMatch(/px, -2px, 0\)$/);
    nike.host.advance(Math.round(nike.ms * 0.85) - 140);
    expect(out(nike).lift).toBeGreaterThan(0);
    expect(out(nike).lift).toBeLessThan(2); // settling over the last of it
    until(nike, () => out(nike).step === "work");
    expect(out(nike).lift).toBe(0);
    expect(nike.host.now()).toBe(LAND + SHOWN + LINE + nike.ms);
  });

  it("an ambler may stop a whole number of strides in, look back, and go on; another time it walks straight there", () => {
    const stride = (47.5 * 600) / 1000;
    const s = settingOff("herodotus", 1);
    const way = Math.sign(s.to - s.from);
    until(s, () => out(s).step !== "walk");
    const at = out(s).x;
    const strides = Math.abs(at - s.from) / stride;
    expect(out(s)).toMatchObject({ step: "glance", pose: "stand", dir: way });
    expect(strides).toBeCloseTo(Math.round(strides), 6);
    expect(strides).toBeGreaterThanOrEqual(1);
    expect(Math.abs(s.to - at)).toBeGreaterThan(1.5); // not there yet
    s.host.advance(221);
    expect(out(s)).toMatchObject({ step: "glance", dir: -way, x: at }); // it looks back
    expect(s.cell("a")!.classList.contains("is-left")).toBe(-way < 0);
    s.host.advance(1050 - 260 - 221);
    expect(out(s).dir).toBe(way);
    s.host.advance(259);
    expect(out(s).step).toBe("glance");
    s.host.advance(1);
    expect(out(s)).toMatchObject({ step: "walk", pose: "stride", x: at }); // and on, without another stop
    until(s, () => out(s).step !== "walk");
    expect(out(s)).toMatchObject({ step: "work", x: s.to });

    const straight = settingOff("herodotus", 2);
    until(straight, () => out(straight).step !== "walk");
    expect(out(straight)).toMatchObject({ step: "work", x: straight.to });
    expect(straight.host.now()).toBe(LAND + SHOWN + LINE + straight.ms);
  });

  it("never walks into a line held out across its way: it waits until that is furled", () => {
    const s = stage({ seed: 5 });
    s.sync([agent("a", "athena")]);
    settle(s);
    s.sync([agent("a", "athena"), agent("b", "hermes")]);
    until(s, () => s.peek().gods.length === 2 && out(s, "b").step === "greet");
    const line = out(s, "b").ribbon!;
    // B's line runs toward A. The lane narrows until A's new place is hard by B's.
    expect(line[1]).toBeLessThan(out(s, "a").place![0]);
    expect(line[1]).toBeGreaterThan(out(s, "b").place![1]);
    s.setWidth(Math.round(out(s, "b").place![1] + 10 + 64 + 16));
    s.resize();
    const from = out(s, "a").x;
    expect(seatOf(out(s, "a"))).toBeLessThan(from - 50);
    expect(out(s, "a")).toMatchObject({ step: "hold", pose: "stand", x: from });
    until(s, () => out(s, "b").step !== "greet");
    expect(out(s, "a")).toMatchObject({ step: "hold", x: from }); // all through the line
    s.host.advance(200);
    expect(out(s, "a")).toMatchObject({ step: "walk", dir: -1 });
    settle(s, 2);
    expect(out(s, "a").x).toBe(seatOf(out(s, "a")));
    expectApart(s.peek());
  });

  it("asked aside again on its way, it turns to its new place from where it has got to", () => {
    const s = stage();
    s.sync([agent("a", "hermes"), agent("b", "hermes")]);
    settle(s, 2);
    const right = along(s)[1]!;
    const wide = Math.round(out(s, right).place![1] + 16);
    s.setWidth(wide - 80);
    s.resize();
    expect(out(s, right).step).toBe("walk");
    s.host.advance(200);
    const at = out(s, right).x;
    const first = seatOf(out(s, right));
    expect(at).toBeGreaterThan(first);
    s.setWidth(wide - 140);
    s.resize();
    expect(seatOf(out(s, right))).toBeLessThan(first - 50);
    expect(out(s, right)).toMatchObject({ step: "walk", x: at, pose: "stride" }); // no jump
    settle(s, 2);
    expect(out(s, right).x).toBe(seatOf(out(s, right)));
    expectApart(s.peek());
  });

  it("hemmed in when it is done, it goes where it stands", () => {
    const s = stage({ seed: 1, width: 602 });
    const five = (["nike", "hephaestus", "themis", "argus", "hermes"] as const).map((id, i) =>
      agent(`g${i}`, id),
    );
    s.sync(five);
    settle(s, 5);
    const middle = along(s)[2]!;
    const at = out(s, middle).x;
    s.sync(five.map((a) => (a.key === middle ? { ...a, look: "done" as const } : a)));
    const steps: string[] = [];
    until(s, () => {
      const seen = s.peek().gods.find((it) => it.key === middle);
      if (seen && steps[steps.length - 1] !== seen.step) steps.push(seen.step);
      if (seen) expect(seen.x).toBe(at);
      return !seen;
    });
    expect(steps).not.toContain("walk");
    expect(steps.slice(-2)).toEqual(["seal", "unset"]);
  });
});

// ── Part 5b: the tesserae ──
describe("the tesserae", () => {
  /** All the floor a god's stones may fly over: its figure facing either way, and `pad` beyond. */
  function flight(seen: Seen, pose: "speak" | "stand", pad: number): readonly [number, number] {
    const [a, b] = CAST.gods[seen.god].fp[pose];
    return [seen.x + Math.min(a, 66 - b) - pad, seen.x + Math.max(b, 66 - a) + pad];
  }
  /** Whether anyone else holds a line out within 3px of that. */
  const crossed = (s: Stage, key: string, [lo, hi]: readonly [number, number]): boolean =>
    s
      .peek()
      .gods.some(
        (it) => it.key !== key && it.ribbon && it.ribbon[1] + 3 > lo && it.ribbon[0] - 3 < hi,
      );

  it("are drawn from the time alone: a setting throws none of the floor's dice and puts nothing on its clock", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND);
    const asked = { ...s.asked };
    const wipes = s.fx.wipes;
    s.host.run(SET); // a frame every 60th of a second, as a window draws them
    expect(s.fx.wipes - wipes).toBeGreaterThan(60); // each frame wipes the canvas once, and draws it again
    expect(s.fx.filled).toBeGreaterThan(30 * stonesOf("hermes", "speak"));
    expect(s.fx.stones).toBe(stonesOf("hermes", "speak"));
    expect(s.asked).toEqual(asked);
  });

  it("keep the clock awake only while they fly: the canvas is wiped once when the last has, and never touched until the next", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND + SHOWN - 1);
    expect(s.fx.stones).toBe(stonesOf("hermes", "speak"));
    s.host.advance(1);
    expect(s.fx.stones).toBe(0);
    const { wipes, filled } = s.fx;
    settle(s);
    s.host.advance(10_000);
    expect(out(s)).toMatchObject({ step: "work", tesserae: null });
    expect(s.fx).toMatchObject({ wipes, filled, stones: 0 });
    expect(s.host.pending()).toBe(0); // asleep
  });

  it("two gods being set at once share the one canvas: both are drawn on each frame", () => {
    const s = stage();
    s.sync([agent("a", "hermes"), agent("b", "athena")]);
    s.host.advance(LAND + SET);
    expect(out(s, "a")).toMatchObject({ step: "assemble", tesserae: { mode: "rest" } });
    expect(out(s, "b")).toMatchObject({ step: "assemble", tesserae: { mode: "set" } }); // 300ms in
    expect(s.fx.stones).toBeGreaterThan(stonesOf("hermes", "speak"));
    expect(s.fx.stones).toBeLessThan(stonesOf("hermes", "speak") + stonesOf("athena", "speak"));
    const both = new Set([...CAST.gods.hermes.tiles.palette, ...CAST.gods.athena.tiles.palette]);
    expect([...s.fx.ivories].every((ivory) => both.has(ivory))).toBe(true);
    expect([...s.fx.ivories].some((ivory) => !CAST.gods.hermes.tiles.palette.includes(ivory))).toBe(
      true,
    );
  });

  it("the canvas keeps to the lane's width: at a narrower one it is sized again before it is drawn", () => {
    const s = stage({ width: 602 });
    const canvas = s.lane.querySelector("canvas")!;
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND);
    expect([canvas.width, canvas.height]).toEqual([602, 104]);
  });

  it("gone from the records in the middle of its setting, or taken down: the canvas is wiped at once", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND + SET / 2);
    expect(s.fx.stones).toBeGreaterThan(0);
    s.sync([]);
    expect(s.cells()).toHaveLength(0);
    expect(s.fx.stones).toBe(0);
    const t = stage();
    t.sync([agent("a", "hermes")]);
    t.host.advance(LAND + SET / 2);
    expect(t.fx.stones).toBeGreaterThan(0);
    t.dispose();
    expect(t.fx.stones).toBe(0);
  });

  /** Herodotus is stopped, or fails, 800ms before the two beside him are done and say their farewells. */
  function besideFarewells(look: "stop" | "fail"): Stage {
    const s = stage({ seed: 1 });
    const three = [agent("a", "herodotus"), agent("b", "argus"), agent("c", "hermes")];
    s.sync(three);
    settle(s, 3);
    enter(s.cell("a"));
    s.sync([{ ...three[0]!, look }, three[1]!, three[2]!]);
    s.host.advance(800);
    s.sync(three.map((it, i) => ({ ...it, look: i ? ("done" as const) : look })));
    s.host.advance(FAIL_HOLD - 800 - 1);
    expect(out(s, "a")).toMatchObject({ step: "fail", tesserae: null });
    expect(crossed(s, "a", flight(out(s, "a"), "stand", 40))).toBe(true);
    s.host.advance(1);
    return s;
  }

  it("stopped, it waits to go back to them while a line is held out across their flight, and goes once that is furled; its card stays until it does", () => {
    const s = besideFarewells("stop");
    const due = s.host.now();
    // It stands as it is, dimmed, and looks again every 200ms.
    expect(out(s, "a")).toMatchObject({ step: "hold", pose: "stand", dim: 1, shown: 1 });
    expect(out(s, "a").tesserae).toBeNull();
    expect(s.fx.stones).toBe(0);
    expect(s.peek().card?.key).toBe("a");
    until(s, () => out(s, "a").step !== "hold");
    expect(out(s, "a")).toMatchObject({ step: "unset", tesserae: { mode: "lift", dim: true } });
    expect(crossed(s, "a", flight(out(s, "a"), "stand", 40))).toBe(false);
    expect(s.host.now() - due).toBeGreaterThan(0);
    expect((s.host.now() - due) % 200).toBe(0);
    expect(s.peek().card).toBeNull();
  });

  it("failed, it never waits: its tesserae fall where it stands, under whatever is held out", () => {
    const s = besideFarewells("fail");
    expect(out(s, "a")).toMatchObject({ step: "unset", tesserae: { mode: "fall", dim: true } });
    expect(crossed(s, "a", flight(out(s, "a"), "stand", 40))).toBe(true);
  });

  it("no line is ever held out into a god's tesserae: within 16px of one being set, or 40px of one being lifted", () => {
    let flying = 0;
    let beside = 0;
    for (const width of [698, 602]) {
      for (let seed = 1; seed <= 10; seed++) {
        const dice = rng(seed * 977);
        const pick = (): GodId => ALL[Math.floor(dice() * ALL.length)]!;
        for (const n of [3, 4, 5]) {
          const s = stage({ seed, width });
          const crowd = Array.from({ length: n }, (_, i) => agent(`g${i}`, pick()));
          // One is stopped and the rest are done, a little apart: farewells beside gods that go.
          const ends = crowd.map(() => 12_000 + Math.floor(dice() * 30) * 100);
          s.sync(crowd);
          for (let ms = 0; ms < 30_000; ms += 50) {
            if (ends.includes(ms))
              s.sync(
                crowd.map((it, i) =>
                  ends[i]! > ms ? it : { ...it, look: i ? ("done" as const) : ("stop" as const) },
                ),
              );
            s.host.advance(50);
            for (const seen of s.peek().gods) {
              const mode = seen.tesserae?.mode;
              if (!mode || mode === "fall") continue;
              flying += 1;
              const over = mode === "lift" ? flight(seen, "stand", 40) : flight(seen, "speak", 16);
              expect(crossed(s, seen.key, over)).toBe(false);
              if (crossed(s, seen.key, [over[0] - 60, over[1] + 60])) beside += 1;
            }
          }
          expect(s.cells()).toHaveLength(0);
          s.dispose();
          s.lane.remove();
        }
      }
    }
    // And lines were held out near them, clear of their flight.
    expect(flying).toBeGreaterThan(10_000);
    expect(beside).toBeGreaterThan(500);
  });
});

// ── Part 5: reduced motion ──
describe("reduced motion: nothing travels, and the lane is as parts 2 to 4 had it", () => {
  const still = (opts: Parameters<typeof stage>[0] = {}): Stage =>
    stage({ ...opts, reduced: true });

  it("the lane opens and shuts at once", () => {
    const s = still();
    s.sync([agent("a", "athena")]);
    expect(s.peek().lane).toEqual({ mode: "open", height: 125 });
    expect(s.lane.getAttribute("style")).toBeNull();
    s.host.advance(3000);
    s.sync([]);
    s.host.advance(599);
    expect(shut(s)).toBe(false);
    s.host.advance(1);
    expect(shut(s)).toBe(true);
    expect(s.peek().lane).toEqual({ mode: "shut", height: 0 });
    expect(s.host.pending()).toBe(0);
  });

  it("a god is set at its place 500ms after the lane opens, whole and greeting; the line is whole for 1.7s; then it is at its work", () => {
    const s = still();
    s.sync([agent("a", "hermes")]);
    s.host.advance(499);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    const cell = s.cell("a")!;
    expect(out(s)).toMatchObject({ step: "greet", pose: "speak", shown: 1, unrolled: 1 });
    expect(out(s).x).toBe(seatOf(out(s))); // at its place from the first: no dice for where it is set
    expect(figure(cell).getAttribute("style")).toBeNull();
    expect(ribbon(cell).style.getPropertyValue("--oly-u")).toBe("1.000");
    expect(s.host.pending()).toBe(1); // and still: the clock sleeps until the line is over
    s.host.advance(1699);
    expect(ribbonOf(cell)).not.toBeNull();
    expect(ribbon(cell).style.getPropertyValue("--oly-u")).toBe("1.000");
    s.host.advance(1);
    expect(ribbonOf(cell)).toBeNull();
    expect(out(s)).toMatchObject({ step: "work", pose: "think" });
    expect(s.host.pending()).toBe(0);
  });

  it("done: its farewell for 1.7s, the seal on for 1.2s, and it is gone; failed and stopped: dimmed at once, 3s, gone", () => {
    const s = still();
    s.sync([agent("a", "argus"), agent("b", "athena"), agent("c", "hermes")]);
    s.host.advance(12_000);
    expect(s.peek().gods.map((seen) => seen.step)).toEqual(["work", "work", "work"]);
    s.sync([
      agent("a", "argus", "done"),
      agent("b", "athena", "fail"),
      agent("c", "hermes", "stop"),
    ]);
    const [a, b, c] = ["a", "b", "c"].map((key) => s.cell(key)!);
    expect(a!.dataset.pose).toBe("speak");
    expect(out(s, "a").unrolled).toBe(1);
    expect(b!.className).toContain("is-dim is-cracked");
    expect(c!.classList.contains("is-dim")).toBe(true);
    expect(c!.classList.contains("is-cracked")).toBe(false);
    expect(b!.getAttribute("style")).not.toMatch(/--oly-(dim|crack)/);
    s.host.advance(1699);
    expect(ribbonOf(a)).not.toBeNull();
    s.host.advance(1);
    expect(a!.classList.contains("is-sealed")).toBe(true); // on, with no press
    expect(a!.querySelector(".oly-seal")!.getAttribute("style")).toBeNull();
    s.host.advance(1199);
    expect(s.cells()).toHaveLength(3);
    s.host.advance(1);
    expect(s.peek().gods.map((seen) => seen.key)).toEqual(["b", "c"]); // no walk off, no fade
    s.host.advance(99);
    expect(s.cells()).toHaveLength(2);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(0);
  });

  it("asked to step aside, it is at its new place at once, in the pose wanted, its beat begun again", () => {
    const s = still();
    const records = (family: ToolFamily, tools: number): LaneAgent[] => [
      agent("a", "hermes", "run", family, tools),
      agent("b", "athena"),
    ];
    s.sync(records("think", 0));
    s.host.advance(6000);
    expect(s.peek().gods.map((seen) => seen.step)).toEqual(["work", "work"]);
    s.sync(records("look", 1));
    until(s, () => out(s, "a").pose === "look");
    const shown = s.host.now();
    s.sync(records("run", 2)); // a cut due 1.8s on
    s.host.advance(100);
    s.setWidth(602);
    s.resize();
    expect(out(s, "a")).toMatchObject({ step: "work", pose: "run", want: "run" });
    expect(s.peek().gods.every((seen) => seen.x === seatOf(seen))).toBe(true);
    expectApart(s.peek());
    s.sync(records("make", 3));
    until(s, () => out(s, "a").pose === "make");
    expect(s.host.now()).toBe(shown + 100 + 1800);
  });

  it("through a whole run nothing is ever part way: no height, no fade, no unrolling, no dimming, no press, no stride, and every god with a place is at it", () => {
    const s = still({ seed: 5 });
    let gods = 0;
    for (let ms = 0; ms <= 30_000; ms += 50) {
      s.sync(laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]));
      const html = s.lane.outerHTML;
      expect(html).not.toMatch(
        /style="[^"]*(?:height|opacity|scale\(|--oly-dim|--oly-crack)|data-pose="stride"/,
      );
      expect(html.match(/--oly-u: [^;]*/g) ?? []).toEqual(
        (html.match(/--oly-u/g) ?? []).map(() => "--oly-u: 1.000"),
      );
      for (const seen of s.peek().gods) {
        gods += 1;
        if (seen.place) expect(seen.x).toBe(seatOf(seen));
        expect(seen).toMatchObject({ shown: 1, press: 1 });
        expect([0, 1]).toContain(seen.dim);
        expect([0, 8]).toContain(seen.lift);
      }
      s.host.advance(50);
    }
    expect(gods).toBeGreaterThan(1000);
    expect(shut(s)).toBe(true);
  });

  it("no tessera is ever drawn: through a whole run nobody is being set or unset, and the canvas is never touched", () => {
    const s = still({ seed: 5 });
    let gods = 0;
    for (let ms = 0; ms <= 30_000; ms += 50) {
      s.sync(laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]));
      for (const seen of s.peek().gods) {
        gods += 1;
        expect(["assemble", "unset"]).not.toContain(seen.step);
        expect(seen.tesserae).toBeNull();
      }
      s.host.advance(50);
    }
    expect(gods).toBeGreaterThan(1000);
    expect(shut(s)).toBe(true);
    expect(s.fx).toMatchObject({ wipes: 0, filled: 0, stones: 0 });
  });

  it("asked for in the middle of a setting: the stones are wiped and the figure is whole, and it greets when it would have, its line whole", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND + SET / 2);
    const cell = s.cell("a")!;
    expect(s.fx.stones).toBeGreaterThan(0);
    expect(figure(cell).style.opacity).toBe("0");
    s.quiet(true);
    s.host.advance(16);
    expect(s.fx.stones).toBe(0);
    expect(out(s)).toMatchObject({ step: "assemble", shown: 1, tesserae: null });
    expect(figure(cell).style.opacity).toBe("");
    expect(s.label("a")!.style.opacity).toBe("");
    const { wipes, filled } = s.fx;
    expect(s.host.pending()).toBe(1); // a still: the clock sleeps until the step is over
    s.host.advance(SHOWN - SET / 2 - 16 - 1);
    expect(out(s).step).toBe("assemble");
    s.host.advance(1);
    expect(out(s)).toMatchObject({ step: "greet", unrolled: 1 });
    expect(s.fx).toMatchObject({ wipes, filled, stones: 0 });
  });

  it.each([
    ["fail", CRUMBLED],
    ["stop", GONE],
    ["done", GONE],
  ] as const)(
    "asked for in the middle of an unsetting (%s): the stones are wiped and the figure is gone, and it is taken off when it would have been",
    (look, whole) => {
      const s = crowd(["argus"]);
      const cell = s.cell("argus")!;
      s.sync([agent("argus", "argus", look)]);
      until(s, () => out(s).step === "unset");
      s.host.advance(300);
      expect(s.fx.stones).toBeGreaterThan(0);
      s.quiet(true);
      s.host.advance(16);
      expect(s.fx.stones).toBe(0);
      expect(out(s)).toMatchObject({ step: "unset", shown: 0, tesserae: null });
      expect(figure(cell).style.opacity).toBe("0");
      expect(s.label("argus")!.style.opacity).toBe("0");
      const { wipes, filled } = s.fx;
      s.host.advance(whole - 300 - 16 - 1);
      expect(s.cells()).toHaveLength(1);
      s.host.advance(1);
      expect(s.cells()).toHaveLength(0);
      expect(s.fx).toMatchObject({ wipes, filled, stones: 0 });
    },
  );
});

// ── Part 4: the card and the keyboard ──
const TIP_W = 272;
const HEAD = 33;
const CELL_Y = 3;
const CARD_AIR = 10;

const enter = (el: Element | undefined): void => void el!.dispatchEvent(new Event("pointerenter"));
const leave = (el: Element | undefined): void => void el!.dispatchEvent(new Event("pointerleave"));
/** A press of the pointer, anywhere: the keyboard is no longer in use. */
const press = (): void =>
  void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
function keydown(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

/** Gods at their places, at their work, each under its own name as its key. */
function crowd(ids: readonly GodId[], opts: Parameters<typeof stage>[0] = {}): Stage {
  const s = stage(opts);
  s.sync(ids.map((god) => agent(god, god)));
  settle(s, ids.length);
  return s;
}

/** Where a god's card stands, with its foot over `top` in the god's cell. */
function placeOf(s: Stage, key: string, top: number): NonNullable<FloorPeek["card"]> {
  const { gods, width } = s.peek();
  const head = gods.find((god) => god.key === key)!.x + HEAD;
  const left = Math.min(Math.max(head - 30, 6), width - 6 - TIP_W);
  return {
    key,
    left,
    foot: CELL_Y + top - CARD_AIR,
    caret: Math.min(Math.max(head - left, 16), TIP_W - 16),
  };
}

/** The keys along the lane, left to right. */
const along = (s: Stage): string[] =>
  [...s.peek().gods].sort((a, b) => a.x - b.x).map((god) => god.key);

describe("the card: where it stands", () => {
  it("is nobody's until a god is pointed at; then it is up at once, and the caller is told whose", () => {
    const s = crowd(["athena", "nike"]);
    expect(s.peek().card).toBeNull();
    expect(s.cards).toEqual([]);
    enter(s.cell("nike"));
    expect(s.peek().card?.key).toBe("nike");
    expect(s.cards).toEqual(["nike"]);
  });

  it.each(ALL)(
    "%s at its work: one height, over the highest it reaches, whatever it does there",
    (god) => {
      const s = crowd([god]);
      enter(s.cell(god));
      const at = placeOf(s, god, CAST.gods[god].card);
      expect(s.peek().card).toEqual(at);
      // Its left a little before its god's head line, and its caret on that line.
      expect(at.left + at.caret).toBeCloseTo(s.peek().gods[0]!.x + HEAD, 6);
      expect(s.card.style.transform).toContain(`translate3d(${at.left.toFixed(2)}px,`);
      expect(s.card.style.getPropertyValue("--oly-ty")).toBe(`${at.foot.toFixed(1)}px`);
      expect(s.card.style.getPropertyValue("--oly-caret")).toBe(`${at.caret.toFixed(1)}px`);
      const families: ToolFamily[] = ["look", "web", "make", "run", "think"];
      families.forEach((family, i) => {
        s.sync([agent(god, god, "run", family, i + 1)]);
        s.host.advance(4000);
        expect(s.peek().card).toEqual(at);
      });
      expect(s.cards).toEqual([god]); // told once: it never went down
    },
  );

  it("the one who flies: her card is over her lift, so her rise and her coming down never move it", () => {
    const s = crowd(["nike"]);
    enter(s.cell("nike"));
    const at = s.peek().card;
    expect(at?.foot).toBe(CELL_Y - 2 - CARD_AIR);
    s.sync([agent("nike", "nike", "run", "look", 1)]);
    until(s, () => s.peek().gods[0]!.pose === "look");
    for (let ms = 0; ms < 240; ms += 40) {
      expect(s.peek().card).toEqual(at); // as she rises
      s.host.advance(40);
    }
    expect(s.peek().gods[0]).toMatchObject({ pose: "look", lift: 8 });
    expect(s.peek().card).toEqual(at);
    // 2px over the top of her look, lifted.
    expect(CAST.gods.nike.top.look! - 8 - CAST.gods.nike.card).toBeCloseTo(1.9, 6);
    // Ended while she is up: it holds that height while she comes down.
    s.sync([agent("nike", "nike", "done", "look", 1)]);
    s.host.advance(90);
    expect(s.peek().gods[0]).toMatchObject({ step: "alight" });
    expect(s.peek().card).toEqual(at);
  });

  it("not at its work, it stands over the pose shown, and over its standing top as it walks", () => {
    const s = stage();
    const top = CAST.gods.hermes.top;
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND);
    expect(out(s)).toMatchObject({ step: "assemble", pose: "speak" });
    enter(s.cell("a"));
    expect(s.peek().card).toEqual(placeOf(s, "a", top.speak)); // up while it is set
    s.host.advance(SHOWN);
    expect(out(s)).toMatchObject({ step: "greet", pose: "speak" });
    expect(s.peek().card).toEqual(placeOf(s, "a", top.speak));
    s.host.advance(LINE);
    expect(out(s)).toMatchObject({ step: "walk", pose: "stride" });
    expect(s.peek().card).toEqual(placeOf(s, "a", top.stand));
    settle(s);
    expect(s.peek().card).toEqual(placeOf(s, "a", CAST.gods.hermes.card));
    s.sync([agent("a", "hermes", "done")]);
    expect(out(s)).toMatchObject({ step: "report", pose: "speak" });
    expect(s.peek().card).toEqual(placeOf(s, "a", top.speak));
    s.host.advance(LINE);
    expect(out(s)).toMatchObject({ step: "seal", pose: "stand" });
    expect(s.peek().card).toEqual(placeOf(s, "a", top.stand));
    s.host.advance(SEALED);
    expect(out(s)).toMatchObject({ step: "walk" });
    expect(s.peek().card).toEqual(placeOf(s, "a", top.stand)); // and with it as it walks off
    expect(s.cards).toEqual(["a"]); // up all the while
  });

  it.each([698, 602])(
    "on a %ipx lane every card is inside the lane, at both ends, its caret on its god's head line",
    (width) => {
      const s = crowd(["athena", "hermes", "hephaestus", "argus", "nike"], { width });
      const order = along(s);
      const seen = order.map((key) => {
        enter(s.cell(key));
        const at = s.peek().card!;
        expect(at).toEqual(placeOf(s, key, CAST.gods[key as GodId].card));
        expect(at.left).toBeGreaterThanOrEqual(6);
        expect(at.left + TIP_W).toBeLessThanOrEqual(width - 6);
        expect(at.caret).toBeGreaterThanOrEqual(16);
        expect(at.caret).toBeLessThanOrEqual(TIP_W - 16);
        expect(at.left + at.caret).toBeCloseTo(
          s.peek().gods.find((god) => god.key === key)!.x + HEAD,
          6,
        );
        leave(s.cell(key));
        return at;
      });
      // The first stands where its god's head asks; the last is flush with the lane's end.
      expect(seen[0]!.caret).toBe(30);
      expect(seen[4]!.left).toBe(width - 6 - TIP_W);
      expect(seen[4]!.caret).toBeGreaterThan(30);
    },
  );

  it("goes with its god as it walks, when the lane's width changes and the god steps aside", () => {
    const s = crowd(["athena", "hermes", "hephaestus", "argus"]);
    const last = along(s)[3]!;
    const cast = CAST.gods[last as GodId];
    enter(s.cell(last));
    const wide = s.peek().card!;
    const from = out(s, last).x;
    s.setWidth(602);
    s.resize();
    expect(out(s, last)).toMatchObject({ step: "walk", x: from });
    // Over its standing top from its first step, and over its head line at every frame of the walk.
    const carets: number[] = [];
    while (out(s, last).step === "walk") {
      const at = s.peek().card!;
      expect(at).toEqual(placeOf(s, last, cast.top.stand - cast.move.lift));
      carets.push(at.left + at.caret);
      s.host.run(16, 16);
    }
    expect(carets.length).toBeGreaterThan(10);
    expect(carets.every((x, i) => i === 0 || x <= carets[i - 1]!)).toBe(true); // leftward, with it
    expect(carets[carets.length - 1]).toBeLessThan(carets[0]!);
    expect(out(s, last).x).toBeLessThan(from);
    const narrow = s.peek().card!;
    expect(narrow).toEqual(placeOf(s, last, cast.card));
    expect(narrow.left).toBe(602 - 6 - TIP_W);
    expect(narrow.left).toBeLessThan(wide.left);
    expect(s.cards).toEqual([last]); // the same card, moved
  });

  it("stays through its god's ending, and is down once the god begins to go", () => {
    const s = crowd(["argus", "athena"]);
    enter(s.cell("argus"));
    s.sync([agent("argus", "argus", "fail"), agent("athena", "athena")]);
    s.host.advance(FAIL_HOLD - 1);
    expect(out(s, "argus")).toMatchObject({ step: "fail" });
    expect(s.peek().card).toEqual(placeOf(s, "argus", CAST.gods.argus.top.stand));
    s.host.advance(1);
    // It begins to go: its card is down for all its tesserae's fall, 1250ms before it is gone.
    expect(out(s, "argus")).toMatchObject({ step: "unset" });
    expect(s.peek().card).toBeNull();
    expect(s.cards).toEqual(["argus", null]);
    s.host.advance(CRUMBLED - 1);
    expect(s.peek().gods.map((seen) => seen.key)).toEqual(["argus", "athena"]);
    expect(s.cards).toEqual(["argus", null]);
    s.host.advance(1);
    expect(s.peek().gods.map((seen) => seen.key)).toEqual(["athena"]);
    // Nothing is left waiting for it: the pointer that was on it holds nothing up.
    s.host.advance(1000);
    expect(s.cards).toEqual(["argus", null]);
  });

  it("is down when its agent is gone from the records, and when the floor is taken down", () => {
    const s = crowd(["argus", "athena"]);
    enter(s.cell("argus"));
    s.sync([agent("athena", "athena")]);
    expect(s.peek().card).toBeNull();
    enter(s.cell("athena"));
    expect(s.peek().card?.key).toBe("athena");
    s.dispose();
    expect(s.peek().card).toBeNull();
    expect(s.cards).toEqual(["argus", null, "athena", null]);
  });

  it("an agent sent on again while the pointer rests where its god was: no card until it is pointed at", () => {
    const s = stage();
    const [, idle, again] = SENT_ON_AGAIN;
    s.sync(laneAgents([{ agents: [SENT_ON_AGAIN[0]!] }]));
    settle(s);
    enter(s.cell("s-again"));
    s.sync(laneAgents([{ agents: [idle!] }]));
    until(s, () => s.cells().length === 0);
    s.sync(laneAgents([{ agents: [again!] }]));
    settle(s);
    expect(s.cells()).toHaveLength(1);
    expect(s.peek().card).toBeNull();
  });

  it("stands the same over a god at its work with reduced motion asked for", () => {
    const at = (reduced: boolean): FloorPeek["card"] => {
      const s = crowd(["hephaestus"], { reduced });
      enter(s.cell("hephaestus"));
      return s.peek().card;
    };
    expect(at(true)).toEqual(at(false));
    expect(at(true)).not.toBeNull();
  });
});

describe("the card: the pointer", () => {
  it("stays while the pointer is on the god, its name or the card, and 150ms after", () => {
    const s = crowd(["athena", "nike"]);
    enter(s.label("athena"));
    expect(s.peek().card?.key).toBe("athena");
    leave(s.label("athena"));
    s.host.advance(149);
    expect(s.peek().card?.key).toBe("athena");
    enter(s.card); // across the gap, onto the card
    s.host.advance(5000);
    expect(s.peek().card?.key).toBe("athena");
    leave(s.card);
    s.host.advance(149);
    expect(s.peek().card?.key).toBe("athena");
    s.host.advance(1);
    expect(s.peek().card).toBeNull();
    expect(s.cards).toEqual(["athena", null]);
  });

  it("from the god to its name, or back inside the grace, it never goes down", () => {
    const s = crowd(["athena"]);
    enter(s.cell("athena"));
    leave(s.cell("athena"));
    enter(s.label("athena"));
    s.host.advance(1000);
    leave(s.label("athena"));
    s.host.advance(100);
    enter(s.cell("athena"));
    s.host.advance(1000);
    expect(s.cards).toEqual(["athena"]);
  });

  it("goes from one god's to the next's at once", () => {
    const s = crowd(["athena", "nike"]);
    enter(s.cell("athena"));
    leave(s.cell("athena"));
    enter(s.cell("nike"));
    expect(s.cards).toEqual(["athena", "nike"]);
    s.host.advance(1000); // the first god's grace is over: the second's card is not taken down
    expect(s.cards).toEqual(["athena", "nike"]);
  });

  it("is not opened by a picture: only a god's cell and its name listen", () => {
    const s = crowd(["hermes"]);
    const cell = s.cell("hermes")!;
    expect(cell.dataset.pose).toBe("think");
    for (const picture of cell.querySelectorAll(".oly-pose"))
      picture.dispatchEvent(new Event("pointerenter"));
    expect(s.peek().card).toBeNull();
    expect(s.cards).toEqual([]);
  });

  it("a press on a god or its name does nothing, and never takes focus", () => {
    const s = crowd(["athena"]);
    s.box.focus();
    for (const el of [s.cell("athena")!, s.label("athena")!]) {
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      el.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(document.activeElement).toBe(s.box);
    expect(s.peek().gods[0]).toMatchObject({ step: "work", pose: "think" });
  });
});

describe("the card: Esc", () => {
  /** What the composer's own handler hears, as it stops a run on Esc. */
  function runHears(s: Stage): { escapes: number } {
    const heard = { escapes: 0 };
    s.box.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) heard.escapes += 1;
    });
    s.box.focus();
    return heard;
  }

  it("with no card up, Esc is not the lane's: it reaches the run", () => {
    const s = crowd(["athena", "nike"]);
    const run = runHears(s);
    expect(keydown(s.box, "Escape").defaultPrevented).toBe(false);
    expect(run.escapes).toBe(1);
  });

  it("hides a card the pointer holds up, and still reaches the run", () => {
    const s = crowd(["athena"]);
    const run = runHears(s);
    enter(s.cell("athena"));
    const e = keydown(s.box, "Escape");
    expect(e.defaultPrevented).toBe(false);
    expect(run.escapes).toBe(1);
    expect(s.peek().card).toBeNull();
    // Hidden for as long as the pointer rests on its god, with no grace to flash it back.
    s.host.advance(1000);
    leave(s.cell("athena"));
    s.host.advance(1000);
    expect(s.cards).toEqual(["athena", null]);
    enter(s.cell("athena"));
    expect(s.peek().card?.key).toBe("athena");
  });

  it("hides a card only the grace or the card itself holds up, and lets go of it", () => {
    const s = crowd(["athena"]);
    const run = runHears(s);
    enter(s.cell("athena"));
    leave(s.cell("athena"));
    enter(s.card);
    keydown(s.box, "Escape");
    expect(run.escapes).toBe(1);
    expect(s.peek().card).toBeNull();
    s.host.advance(1000);
    expect(s.host.pending()).toBe(0); // no grace is left waiting
    enter(s.cell("athena"));
    expect(s.peek().card?.key).toBe("athena");
  });

  it("hides a card shown for the keyboard and is used up; the card shows again when focus moves", () => {
    const s = crowd(["athena", "nike"]);
    let heard = 0;
    const onKey = (e: KeyboardEvent): void => void (e.key === "Escape" && heard++);
    document.addEventListener("keydown", onKey);
    keydown(document.body, "Tab");
    s.cell("athena")!.focus();
    expect(s.peek().card?.key).toBe("athena");
    const e = keydown(s.cell("athena")!, "Escape");
    document.removeEventListener("keydown", onKey);
    expect(e.defaultPrevented).toBe(true);
    expect(heard).toBe(0);
    expect(s.peek().card).toBeNull();
    keydown(s.cell("athena")!, "Escape"); // nothing is up: this one is not the lane's
    s.cell("nike")!.focus();
    expect(s.peek().card?.key).toBe("nike");
    s.cell("athena")!.focus();
    expect(s.peek().card?.key).toBe("athena");
  });
});

describe("the keyboard: the gods are one toolbar", () => {
  const tabStops = (s: Stage): string[] =>
    s
      .peek()
      .gods.filter((god) => s.cell(god.key)!.tabIndex === 0)
      .map((god) => god.key);

  it("is hidden while it is empty, and not once a god is on the lane", () => {
    const s = stage();
    const toolbar = s.lane.querySelector(".oly-gods")!;
    expect(toolbar.getAttribute("aria-hidden")).toBe("true");
    s.sync([agent("a", "athena")]);
    expect(toolbar.getAttribute("aria-hidden")).toBe("true"); // the lane is open, and nobody is on it yet
    s.host.advance(LAND);
    expect(toolbar.hasAttribute("aria-hidden")).toBe(false);
    s.sync([]);
    expect(toolbar.getAttribute("aria-hidden")).toBe("true");
  });

  it("names each god by its own name, describes it by its row, and says it has nothing to press", () => {
    const s = crowd(["athena", "nike"]);
    for (const [key, name] of [
      ["athena", "Athena"],
      ["nike", "Nike"],
    ] as const) {
      const cell = s.cell(key)!;
      expect(cell.getAttribute("role")).toBe("button");
      expect(cell.getAttribute("aria-label")).toBe(name);
      expect(cell.getAttribute("aria-describedby")).toBe(`row-${key}`);
      expect(cell.getAttribute("aria-disabled")).toBe("true");
      expect(cell.hasAttribute("title")).toBe(false);
    }
  });

  it("has one tab stop: the first god to land, until the arrows move it", () => {
    const s = stage();
    s.sync(ALL.slice(0, 4).map((god) => agent(god, god)));
    s.host.advance(LAND);
    expect(tabStops(s)).toEqual(["athena"]);
    s.host.advance(12_000);
    expect(s.cells()).toHaveLength(4);
    expect(tabStops(s)).toEqual(["athena"]);
    expect(
      s
        .cells()
        .map((cell) => cell.tabIndex)
        .sort(),
    ).toEqual([-1, -1, -1, 0]);
  });

  it("ArrowLeft, ArrowRight, Home and End go along the lane in floor order, and stop at its ends", () => {
    const s = crowd(["athena", "hermes", "hephaestus", "argus"]);
    const order = along(s);
    const focused = (): string | undefined =>
      s.peek().gods.find((god) => s.cell(god.key) === document.activeElement)?.key;
    keydown(document.body, "Tab");
    s.cell(order[1]!)!.focus();
    expect(tabStops(s)).toEqual([order[1]]);
    const walk: [string, number][] = [
      ["ArrowRight", 2],
      ["ArrowRight", 3],
      ["ArrowRight", 3],
      ["Home", 0],
      ["ArrowLeft", 0],
      ["End", 3],
      ["ArrowLeft", 2],
    ];
    for (const [key, to] of walk) {
      const e = keydown(document.activeElement!, key);
      expect(e.defaultPrevented).toBe(true);
      expect(focused()).toBe(order[to]);
      expect(tabStops(s)).toEqual([order[to]]);
      // The card follows focus, and the cartouche is round that god's name alone.
      expect(s.peek().card?.key).toBe(order[to]);
      expect(order.filter((k) => s.label(k)!.classList.contains("is-focus"))).toEqual([order[to]]);
    }
    // With a modifier a key is not the lane's; nor is any other key.
    expect(keydown(document.activeElement!, "ArrowLeft", { metaKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(keydown(document.activeElement!, "a").defaultPrevented).toBe(false);
    expect(focused()).toBe(order[2]);
  });

  it("Enter and Space are taken and do nothing: a god has nothing to press yet", () => {
    const s = crowd(["hermes"]);
    const before = s.lane.innerHTML;
    keydown(document.body, "Tab");
    s.cell("hermes")!.focus();
    const focusedMarkup = s.lane.innerHTML;
    const { clock, dice } = s.asked;
    for (const key of ["Enter", " "])
      expect(keydown(s.cell("hermes")!, key).defaultPrevented).toBe(true);
    s.host.advance(5000);
    expect(s.lane.innerHTML).toBe(focusedMarkup);
    expect(focusedMarkup).not.toBe(before); // only its tab stop and its cartouche came with focus
    expect(s.asked).toEqual({ clock, dice });
  });

  it("the card follows focus only while the keyboard is in use: from a key until the next press", () => {
    const s = crowd(["athena", "nike"]);
    s.cell("athena")!.focus(); // not from the keyboard
    expect(s.peek().card).toBeNull();
    expect(s.label("athena")!.classList.contains("is-focus")).toBe(false);
    keydown(s.cell("athena")!, "Shift");
    expect(s.peek().card?.key).toBe("athena");
    expect(s.label("athena")!.classList.contains("is-focus")).toBe(true);
    press();
    expect(s.peek().card).toBeNull();
    expect(s.label("athena")!.classList.contains("is-focus")).toBe(false);
    // The pointer's own card comes first.
    keydown(s.cell("athena")!, "Shift");
    enter(s.cell("nike"));
    expect(s.peek().card?.key).toBe("nike");
    leave(s.cell("nike"));
    s.host.advance(150);
    expect(s.peek().card?.key).toBe("athena");
    s.box.focus();
    expect(s.peek().card).toBeNull();
  });

  it("when the focused god goes, focus goes to the nearest along the lane, and the card with it", () => {
    const s = crowd(["athena", "hermes", "hephaestus", "argus"]);
    const order = along(s);
    const gods = s.peek().gods;
    const xOf = (key: string): number => gods.find((god) => god.key === key)!.x;
    const going = order[1]!;
    const nearest = [order[0]!, order[2]!, order[3]!].sort(
      (a, b) => Math.abs(xOf(a) - xOf(going)) - Math.abs(xOf(b) - xOf(going)),
    )[0]!;
    keydown(document.body, "Tab");
    s.cell(going)!.focus();
    s.sync(order.filter((key) => key !== going).map((key) => agent(key, key as GodId)));
    expect(s.peek().gods.map((god) => god.key)).not.toContain(going);
    expect(document.activeElement).toBe(s.cell(nearest));
    expect(tabStops(s)).toEqual([nearest]);
    expect(s.peek().card?.key).toBe(nearest);
    expect(s.label(nearest)!.classList.contains("is-focus")).toBe(true);
  });

  it("when the last god goes with focus, focus goes to the composer", () => {
    const s = crowd(["athena"]);
    keydown(document.body, "Tab");
    s.cell("athena")!.focus();
    s.sync([agent("athena", "athena", "fail")]);
    s.host.advance(FAIL_HOLD + CRUMBLED - 1);
    expect(document.activeElement).toBe(s.cell("athena")); // it is going, and still there
    s.host.advance(1);
    expect(s.cells()).toHaveLength(0);
    expect(document.activeElement).toBe(s.box);
    expect(s.peek().card).toBeNull();
    expect(s.lane.querySelector(".oly-gods")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("a god leaving never moves focus that is anywhere else: not while you type", () => {
    const s = crowd(["athena", "nike"]);
    s.box.focus();
    s.box.value = "half a sentence";
    s.sync([agent("nike", "nike")]);
    expect(s.cells()).toHaveLength(1);
    expect(document.activeElement).toBe(s.box);
    s.sync([]);
    expect(s.cells()).toHaveLength(0);
    expect(document.activeElement).toBe(s.box);
    const other = document.createElement("button");
    document.body.append(other);
    const t = crowd(["argus"]);
    other.focus();
    t.sync([]);
    expect(document.activeElement).toBe(other);
  });

  it("the tab stop moves to a god still there when its own goes, without taking focus", () => {
    const s = crowd(["athena", "nike"]);
    expect(tabStops(s)).toEqual(["athena"]);
    s.box.focus();
    s.sync([agent("nike", "nike")]);
    expect(tabStops(s)).toEqual(["nike"]);
    expect(document.activeElement).toBe(s.box);
  });

  it("floor order is where each god is drawn: the arrows go along the lane as it is, walkers and all", () => {
    const s = crowd(["athena", "hermes", "argus"]);
    s.setWidth(480);
    s.resize();
    s.host.advance(150);
    expect(s.peek().gods.some((seen) => seen.step === "walk")).toBe(true);
    const order = along(s); // by where each is now, part way
    keydown(document.body, "Tab");
    s.cell(order[0]!)!.focus();
    keydown(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(s.cell(order[1]!));
    keydown(document.activeElement!, "End");
    expect(document.activeElement).toBe(s.cell(order[2]!));
    expect(s.peek().card?.key).toBe(order[2]);
  });

  it("a god that is going keeps focus until it has gone, its card down and its cartouche going with its name; then focus goes to the nearest", () => {
    const s = crowd(["athena", "nike"]);
    keydown(document.body, "Tab");
    const cell = s.cell("nike")!;
    const label = s.label("nike")!;
    cell.focus();
    expect(s.peek().card?.key).toBe("nike");
    s.sync([agent("athena", "athena"), agent("nike", "nike", "stop")]);
    s.host.advance(FAIL_HOLD);
    expect(out(s, "nike").step).toBe("unset");
    expect(s.peek().card).toBeNull();
    expect(document.activeElement).toBe(cell);
    s.host.advance(420 / 2); // its name goes over 420ms
    expect(label.classList.contains("is-focus")).toBe(true);
    expect(label.style.opacity).toBe("0.5");
    expect(document.activeElement).toBe(cell);
    s.host.advance(GONE - 420 / 2 - 1);
    expect(document.activeElement).toBe(cell); // until its last tessera has flown
    expect(s.peek().card).toBeNull();
    s.host.advance(1);
    expect(document.activeElement).toBe(s.cell("athena"));
    expect(s.peek().card?.key).toBe("athena");
  });

  it("taken down with focus on a god: focus goes to the composer, and its listeners are gone", () => {
    const s = crowd(["athena"]);
    keydown(document.body, "Tab");
    s.cell("athena")!.focus();
    s.dispose();
    expect(document.activeElement).toBe(s.box);
    expect(s.cards).toEqual(["athena", null]);
    keydown(document.body, "Escape");
    press();
    expect(s.cards).toEqual(["athena", null]);
  });
});

describe("the card and the keys are no part of the run", () => {
  /** The mockup's crowd from a seed, frame by frame, with someone at the lane or nobody. */
  function play(meddle: ((s: Stage, ms: number) => void) | null): {
    frames: string;
    peeks: string;
    asked: Stage["asked"];
    cards: number;
  } {
    const s = stage({ seed: 5 });
    const frames: string[] = [];
    const peeks: string[] = [];
    for (let ms = 0; ms <= 30_000; ms += 100) {
      s.sync(laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]));
      meddle?.(s, ms);
      // The tab stop and the cartouche are the keyboard's own marks on the lane.
      frames.push(
        s.lane.innerHTML
          .replace(/ tabindex="-?\d"/g, "")
          .replace(/oly-ins is-focus/g, "oly-ins")
          .replace(/oly-medal is-focus/g, "oly-medal"),
      );
      const { card: _card, ...run } = s.peek();
      peeks.push(JSON.stringify(run));
      s.host.advance(100);
    }
    const out = {
      frames: frames.join("\n"),
      peeks: peeks.join("\n"),
      asked: { ...s.asked },
      cards: s.cards.length,
    };
    s.dispose();
    return out;
  }

  it("the same run from the same seed plays the same with the card shown, hidden, or never asked for", () => {
    const alone = play(null);
    // A pointer that wanders over every god, its name and the card, and an Esc now and then.
    const hovered = play((s, ms) => {
      const cells = s.cells();
      const names = [...s.lane.querySelectorAll(".oly-ins")];
      const i = (ms / 100) % 7;
      if (cells.length === 0) return;
      const at = Math.floor(ms / 700) % cells.length;
      if (i === 0) enter(cells[at]);
      if (i === 2) leave(cells[at]);
      if (i === 3) enter(names[at]);
      if (i === 4) leave(names[at]);
      if (i === 5) enter(s.card);
      if (i === 6) leave(s.card);
      if (ms % 1900 === 0) keydown(document.body, "Escape");
    });
    // A keyboard that walks the toolbar end to end, with Enter, Space and Esc on the way.
    const keyed = play((s, ms) => {
      const cells = s.cells();
      if (cells.length === 0) return;
      if (!s.lane.contains(document.activeElement)) cells[0]!.focus();
      const keys = ["ArrowRight", "Enter", "End", " ", "ArrowLeft", "Escape", "Home", "Tab"];
      keydown(document.activeElement!, keys[(ms / 100) % keys.length]!);
      if (ms % 2300 === 0) press();
    });
    expect(hovered.cards).toBeGreaterThan(20);
    expect(keyed.cards).toBeGreaterThan(20);
    for (const run of [hovered, keyed]) {
      expect(run.frames).toBe(alone.frames);
      expect(run.peeks).toBe(alone.peeks);
      // Not one more step on the clock, wake of it, or throw of the dice.
      expect(run.asked).toEqual(alone.asked);
    }
    expect(alone.cards).toBe(0);
    expect(alone.asked.clock).toBeGreaterThan(50);
    expect(alone.asked.dice).toBeGreaterThan(10);
  });

  it("the grace waits on the window's clock, and never on the run's", () => {
    const s = crowd(["athena"]);
    const { clock, dice } = s.asked;
    const idle = s.host.pending();
    enter(s.cell("athena"));
    leave(s.cell("athena"));
    expect(s.host.pending()).toBe(idle + 1); // the grace, a wait of its own
    s.host.advance(150);
    expect(s.host.pending()).toBe(idle);
    expect(s.peek().card).toBeNull();
    expect(s.asked).toEqual({ clock, dice });
  });

  it("plays the same however the frames fall: every 7, 16, 33 or 100ms, or none between one look and the next", () => {
    /** The crowd's run, looked at every 250ms, with the frames between as a window might give them. */
    function paced(every: number | null, pointer = false): ReturnType<typeof play> {
      const s = stage({ seed: 5 });
      const frames: string[] = [];
      const peeks: string[] = [];
      for (let ms = 0; ms <= 30_000; ms += 250) {
        s.sync(laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]));
        const cells = s.cells();
        if (pointer && cells.length) enter(cells[(ms / 250) % cells.length]);
        // A style set and taken off again leaves an empty attribute: nothing to see.
        frames.push(`${s.lane.style.height} ${s.lane.innerHTML}`.replace(/ style=""/g, ""));
        const { card: _card, ...run } = s.peek();
        peeks.push(JSON.stringify(run));
        if (every === null) s.host.advance(250);
        else s.host.run(250, every);
      }
      const run = {
        frames: frames.join("\n"),
        peeks: peeks.join("\n"),
        asked: { ...s.asked },
        cards: s.cards.length,
      };
      s.dispose();
      return run;
    }
    const none = paced(null);
    // What was looked at was on its way: walking, showing, unrolling, rising.
    expect(none.frames).toMatch(/data-pose="stride"/);
    expect(none.frames).toMatch(/opacity: 0\.\d/);
    expect(none.frames).toMatch(/--oly-u: 0\.\d*[1-9]/);
    expect(none.frames).toMatch(/^\d+(\.\d+)?px /m);
    for (const every of [7, 16, 1000 / 60, 33, 100]) {
      const run = paced(every);
      expect(run.peeks).toBe(none.peeks);
      expect(run.frames).toBe(none.frames);
      expect(run.asked).toEqual(none.asked); // not a step, a wake or a throw of the dice more
    }
    // And with the pointer on one god after another, a card up over walkers and all.
    const pointed = paced(16, true);
    expect(pointed.cards).toBeGreaterThan(20);
    expect(pointed.peeks).toBe(none.peeks);
    expect(pointed.frames).toBe(none.frames);
    expect(pointed.asked).toEqual(none.asked);
  });

  it("the card over a walker moves on the walk's own frames: over its head at each, at one height, and nothing more on the clock", () => {
    const walk = (pointer: boolean): { asked: Stage["asked"]; run: string; seen: number } => {
      const s = stage({ seed: 3 });
      s.sync([agent("a", "nike")]);
      s.host.advance(LAND + SHOWN + 400);
      if (pointer) enter(s.cell("a"));
      const run: string[] = [];
      let seen = 0;
      for (let ms = 0; ms < 5000; ms += 16) {
        s.host.run(16, 16);
        const { card, ...rest } = s.peek();
        run.push(JSON.stringify(rest));
        if (!pointer || out(s).step !== "walk") continue;
        seen += 1;
        // Over her standing top less her skim, whichever of stride and stand shows.
        expect(card).toEqual(placeOf(s, "a", CAST.gods.nike.top.stand - 2));
        expect(s.card.style.transform).toBe(`translate3d(${card!.left.toFixed(2)}px, 0, 0)`);
      }
      expect(out(s).step).toBe("work");
      return { asked: { ...s.asked }, run: run.join("\n"), seen };
    };
    const alone = walk(false);
    const pointed = walk(true);
    expect(pointed.seen).toBeGreaterThan(20);
    expect(pointed.run).toBe(alone.run);
    expect(pointed.asked).toEqual(alone.asked);
  });
});

// ── Part 6: the floor's mosaic ──
const LAID = 1580; // its last stone is down
const FEW = 30; // at rest: a fill for each colour of joint and of stone, six stones in four tones at most
const mosaicOf = (s: Stage): HTMLCanvasElement =>
  s.lane.querySelector<HTMLCanvasElement>("canvas.oly-mosaic")!;
/** A lane opened for one god and left empty: its floor laid, and the beat after its god has gone over. */
function emptied(opts: Parameters<typeof stage>[0] = {}): Stage {
  const s = stage(opts);
  s.sync([agent("a", "athena")]);
  s.host.advance(3000);
  s.sync([]);
  s.host.advance(600);
  return s;
}

describe("the floor's mosaic", () => {
  it("is set as the lane opens, from the bed up, 1580ms in all; the first god lands as its last courses go down", () => {
    const s = stage();
    expect(s.peek().floor).toBeNull();
    expect(s.bed.wipes).toBe(0);
    s.sync([agent("a", "athena")]);
    expect(s.peek().floor).toEqual({ scene: "temple", phase: "set" });
    expect(s.bed.stones).toBe(0); // the bed is bare: no stone is down yet
    s.host.run(420);
    expect(s.peek().lane.mode).toBe("open");
    expect(s.bed.stones).toBeGreaterThan(FEW); // stones on their way, each a fill of its own
    s.host.run(LAND - 420 - 1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(1);
    expect(s.peek().floor).toEqual({ scene: "temple", phase: "set" });
    s.host.run(LAID - LAND - 1);
    expect(s.peek().floor!.phase).toBe("set");
    s.host.advance(1);
    expect(s.peek().floor).toEqual({ scene: "temple", phase: "shown" });
    // Every stone at rest, in a few fills.
    expect(s.bed.stones).toBeGreaterThan(6);
    expect(s.bed.stones).toBeLessThanOrEqual(FEW);
    expect([mosaicOf(s).width, mosaicOf(s).height]).toEqual([698, 104]);
    expect(mosaicOf(s).getAttribute("style")).toBeNull();
  });

  it("at rest costs nothing: it is drawn once when its last stone is down, and not again while gods land, work and go", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.run(LAID);
    const { wipes, filled } = s.bed;
    s.sync([agent("a", "athena"), agent("b", "hermes"), agent("c", "nike")]);
    s.host.run(12_000);
    expect(s.peek().gods.map((god) => god.step)).toEqual(["work", "work", "work"]);
    s.sync([agent("a", "athena", "done"), agent("b", "hermes", "fail"), agent("c", "nike")]);
    s.host.run(9000);
    expect(s.cells()).toHaveLength(1);
    expect(s.bed).toMatchObject({ wipes, filled });
    expect(s.fx.filled).toBeGreaterThan(1000); // the gods' own stones flew over it meanwhile
    expect(s.peek().floor).toEqual({ scene: "temple", phase: "shown" });
  });

  it("is prised up a beat after the last god has gone, 1150ms in all; then the bed is bare, and the lane falls", () => {
    const s = emptied();
    expect(s.peek()).toMatchObject({
      lane: { mode: "lift", height: 125 },
      floor: { scene: "temple", phase: "lift" },
    });
    expect(s.bed.stones).toBeLessThanOrEqual(FEW); // all of it still down
    const gods = { wipes: s.fx.wipes, filled: s.fx.filled };
    s.host.run(PRISED / 2);
    expect(s.bed.stones).toBeGreaterThan(FEW); // stones on their way
    s.host.run(PRISED / 2 - 1);
    expect(s.peek().floor).toEqual({ scene: "temple", phase: "lift" });
    s.host.advance(1);
    expect(s.peek()).toMatchObject({ lane: { mode: "fall", height: 125 }, floor: null });
    expect(s.bed.stones).toBe(0);
    const { wipes, filled } = s.bed;
    s.host.run(360);
    expect(shut(s)).toBe(true);
    expect(s.bed).toMatchObject({ wipes, filled }); // wiped once, and not touched as the lane falls
    expect(s.fx).toMatchObject(gods); // nor was the gods' canvas, all the while
    expect(s.host.pending()).toBe(0); // asleep
  });

  it("each opening lays the next scene in turn: temple, grove, agora, and the temple again", () => {
    const s = stage();
    const seen: string[] = [];
    for (const key of ["a", "b", "c", "d"]) {
      s.sync([agent(key, "athena")]);
      seen.push(s.peek().floor!.scene);
      s.host.advance(3000);
      s.sync([]);
      s.host.advance(600 + PRISED + 360);
      expect(shut(s)).toBe(true);
      expect(s.peek().floor).toBeNull();
    }
    expect(seen).toEqual(["temple", "grove", "agora", "temple"]);
  });

  it("an agent sent while it is prised up waits for the lane to be down; then the lane rises again, on the next scene", () => {
    const s = emptied();
    s.host.advance(300);
    s.sync([agent("b", "argus")]);
    expect(s.peek()).toMatchObject({
      lane: { mode: "lift" },
      floor: { scene: "temple", phase: "lift" },
      queue: ["b"],
    });
    s.host.advance(PRISED - 300);
    expect(s.peek()).toMatchObject({ lane: { mode: "fall" }, floor: null, queue: ["b"] });
    s.host.advance(359);
    expect(s.peek().lane.mode).toBe("fall");
    s.host.advance(1);
    // Down, and up again in the same moment.
    expect(s.peek()).toMatchObject({
      lane: { mode: "rise", height: 0 },
      floor: { scene: "grove", phase: "set" },
    });
    expect(shut(s)).toBe(false);
    s.host.advance(LAND - 1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["argus"]);
  });

  it("is never prised up before its last stone is down: with nobody left, the lane waits for it", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.advance(100);
    s.sync([]); // gone before it had landed
    s.host.advance(600);
    expect(s.peek()).toMatchObject({ lane: { mode: "open" }, floor: { phase: "set" } });
    s.host.advance(LAID - 700 - 1);
    expect(s.peek()).toMatchObject({ lane: { mode: "open" }, floor: { phase: "set" } });
    s.host.advance(1);
    expect(s.peek()).toMatchObject({
      lane: { mode: "lift" },
      floor: { scene: "temple", phase: "lift" },
    });
    s.host.advance(PRISED + 360);
    expect(shut(s)).toBe(true);
  });

  it("a narrower lane shows the scene's middle: its canvas is the lane's width, and what lies beyond is not drawn", () => {
    const laid = (width: number): { s: Stage; moved: number[][] } => {
      const s = stage({ width });
      const moved: number[][] = [];
      (s.bed.ctx as { setTransform: unknown }).setTransform = (...m: number[]) =>
        void moved.push(m);
      s.sync([agent("a", "athena")]);
      s.host.advance(700); // in the middle of its setting
      return { s, moved };
    };
    const wide = laid(698);
    const narrow = laid(602);
    expect([mosaicOf(narrow.s).width, mosaicOf(narrow.s).height]).toEqual([602, 104]);
    expect(wide.moved[wide.moved.length - 1]).toEqual([1, 0, 0, 1, 0, 0]);
    expect(narrow.moved[narrow.moved.length - 1]).toEqual([1, 0, 0, 1, -48, 0]); // 48px lost each side
    expect(wide.s.bed.stones).toBeGreaterThan(500);
    expect(narrow.s.bed.stones).toBeLessThan(wide.s.bed.stones);
    expect(narrow.s.bed.stones).toBeGreaterThan(wide.s.bed.stones * 0.8);
  });

  it("at rest, a change of the lane's width: it is drawn once more, at the new width", () => {
    const s = crowd(["athena", "hermes", "nike"]);
    const { wipes, filled } = s.bed;
    s.host.run(1000);
    expect(s.bed).toMatchObject({ wipes, filled });
    const last = Math.max(...s.peek().gods.map((god) => god.x));
    s.setWidth(602);
    s.resize();
    expect(s.bed.wipes).toBe(wipes + 1);
    expect(mosaicOf(s).width).toBe(602);
    const drawn = s.bed.filled;
    expect(drawn - filled).toBeLessThanOrEqual(FEW);
    // The gods walk to their new places over it, frame after frame, and it is not drawn again.
    until(s, () => s.peek().gods.some((god) => god.step === "walk"), 3000);
    s.host.run(8000);
    expect(s.peek().gods.every((god) => god.step === "work")).toBe(true);
    expect(Math.max(...s.peek().gods.map((god) => god.x))).toBeLessThan(last);
    expect(s.bed).toMatchObject({ wipes: wipes + 1, filled: drawn });
  });

  it("at rest, a change of the screen's density: it is drawn once more with the next frame, as fine as the screen", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    settle(s);
    const { wipes } = s.bed;
    const was = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    try {
      s.sync([agent("a", "athena", "run", "look", 1)]); // a record, and a frame for it
      expect([mosaicOf(s).width, mosaicOf(s).height]).toEqual([1396, 208]);
      expect(s.bed.wipes).toBe(wipes + 1);
      s.host.run(3000);
      expect(s.bed.wipes).toBe(wipes + 1);
    } finally {
      if (was) Object.defineProperty(window, "devicePixelRatio", was);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
  });

  it("is drawn from the time alone, from dice of its scene's own: its setting and its lifting throw none of the floor's dice and put nothing on its clock, and it is the same floor whatever the seed", () => {
    const drawn = (seed: number): number[] => {
      const s = stage({ seed });
      s.sync([agent("a", "athena")]);
      const opening = { ...s.asked };
      s.host.run(LAND - 1);
      expect(s.asked).toEqual(opening);
      const set = s.bed.filled;
      s.host.advance(3000);
      s.sync([]);
      s.host.advance(600);
      const shutting = { ...s.asked };
      const before = s.bed.filled;
      s.host.run(PRISED - 1);
      expect(s.asked).toEqual(shutting);
      return [set, s.bed.filled - before];
    };
    const one = drawn(1);
    expect(one[0]).toBeGreaterThan(10_000);
    expect(one[1]).toBeGreaterThan(10_000);
    expect(drawn(2)).toEqual(one);
  });

  it("disposed while it is laid: its floor is gone, and its canvas blank", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.run(LAID);
    expect(s.bed.stones).toBeGreaterThan(0);
    s.dispose();
    expect(s.peek().floor).toBeNull();
    expect(s.bed.stones).toBe(0);
  });
});

describe("reduced motion: the floor is a still", () => {
  it("is laid whole as the lane opens and drawn once, and gone as the lane shuts; the lane's times are as they were", () => {
    const s = stage({ reduced: true });
    s.sync([agent("a", "hermes")]);
    expect(s.peek()).toMatchObject({
      lane: { mode: "open", height: 125 },
      floor: { scene: "temple", phase: "shown" },
    });
    expect(s.bed.wipes).toBe(1);
    const { filled } = s.bed;
    expect(filled).toBeGreaterThan(6);
    expect(filled).toBeLessThanOrEqual(FEW);
    expect(mosaicOf(s).getAttribute("style")).toBeNull(); // no fade: it is there
    s.host.advance(LAND_STILL - 1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(1);
    s.host.run(5000);
    expect(s.bed).toMatchObject({ wipes: 1, filled });
    s.sync([]);
    s.host.advance(599);
    expect(s.peek()).toMatchObject({ lane: { mode: "open" }, floor: { phase: "shown" } });
    s.host.advance(1);
    // Shut by a cut: it is never prised up.
    expect(shut(s)).toBe(true);
    expect(s.peek()).toMatchObject({ lane: { mode: "shut", height: 0 }, floor: null });
    expect(s.bed).toMatchObject({ wipes: 2, filled, stones: 0 });
    expect(mosaicOf(s).getAttribute("style")).toBeNull();
    expect(s.fx).toMatchObject({ wipes: 0, filled: 0 }); // and the gods' canvas was never touched
    expect(s.host.pending()).toBe(0);
  });

  it("each opening still lays the next scene in turn", () => {
    const s = stage({ reduced: true });
    const seen: string[] = [];
    for (const key of ["a", "b"]) {
      s.sync([agent(key, "athena")]);
      seen.push(s.peek().floor!.scene);
      s.host.advance(3000);
      s.sync([]);
      s.host.advance(600);
      expect(shut(s)).toBe(true);
    }
    expect(seen).toEqual(["temple", "grove"]);
  });

  it("asked for while it is being set: it is whole at once and drawn once, and the first god lands when it would have", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.run(700);
    expect(s.peek().floor!.phase).toBe("set");
    expect(s.bed.stones).toBeGreaterThan(FEW);
    s.quiet(true);
    s.host.advance(16);
    expect(s.peek().floor).toEqual({ scene: "temple", phase: "shown" });
    expect(s.bed.stones).toBeLessThanOrEqual(FEW);
    const { wipes, filled } = s.bed;
    s.host.run(200);
    expect(s.bed).toMatchObject({ wipes, filled });
    s.host.advance(LAND - 700 - 16 - 200 - 1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(1);
    expect(s.bed).toMatchObject({ wipes, filled });
  });

  it("asked for while it is prised up: it stays whole, and the lane shuts by a cut when its stones would have been off", () => {
    const s = emptied();
    s.host.run(300);
    expect(s.peek().floor!.phase).toBe("lift");
    expect(s.bed.stones).toBeGreaterThan(FEW);
    s.quiet(true);
    s.host.advance(16);
    expect(s.peek()).toMatchObject({
      lane: { mode: "lift", height: 125 },
      floor: { scene: "temple", phase: "shown" },
    });
    expect(s.bed.stones).toBeLessThanOrEqual(FEW);
    const { wipes, filled } = s.bed;
    s.host.run(PRISED - 300 - 16 - 1);
    expect(shut(s)).toBe(false);
    expect(s.bed).toMatchObject({ wipes, filled });
    s.host.advance(1);
    // No fall: it is shut.
    expect(shut(s)).toBe(true);
    expect(s.peek()).toMatchObject({ lane: { mode: "shut", height: 0 }, floor: null });
    expect(s.lane.style.height).toBe("");
    expect(s.bed.stones).toBe(0);
    expect(s.host.pending()).toBe(0);
  });
});

// ── Part 6b: fidgets ──
describe("fidgets: a god alive at its work", () => {
  type Opts = Parameters<typeof stage>[0];
  const posesOf = (cell: HTMLElement): HTMLElement =>
    cell.querySelector<HTMLElement>(".oly-poses")!;
  const turnOf = (pivot: readonly [number, number], deg: number): string =>
    `translate(${pivot[0]}px, ${pivot[1]}px) rotate(${deg.toFixed(3)}deg) translate(${-pivot[0]}px, ${-pivot[1]}px)`;

  /**
   * One god at its work in the pose it acts a family of tool in, its fidgets
   * on unless told otherwise. `t0` is the cut that showed the pose: the moment
   * it took its place.
   */
  function alive(
    god: GodId,
    family: ToolFamily,
    opts: Opts = {},
    key = "a",
  ): Stage & { t0: number; to(ms: number): void } {
    const s = stage({ fidget: true, ...opts });
    s.sync([agent(key, god, "run", family, 1)]);
    settle(s);
    const t0 = s.host.now();
    /** On to so long after that cut. */
    const to = (ms: number): void => s.host.advance(t0 + ms - s.host.now());
    return Object.assign(s, { t0, to });
  }

  /** The lane narrows by 60px under its one god: it must step aside. */
  function narrow(s: Stage): void {
    s.setWidth(Math.round(s.peek().gods[0]!.place![1] + 16 - 60));
    s.resize();
  }

  /** Hand one god another tool, and say when its pose changes, to the ms. */
  function cutTo(s: Stage, god: GodId, family: ToolFamily, tools: number): number {
    const was = s.cell("a")!.dataset.pose;
    s.sync([agent("a", god, "run", family, tools)]);
    for (let i = 0; i < 20_000 && s.cell("a")!.dataset.pose === was; i++) s.host.advance(1);
    return s.host.now();
  }

  it("a gesture is in the god's own beats, counted from the cut that showed the pose: the smith's hammer falls on his", () => {
    // His beat is 560ms. Three blows a bar of four beats, the hammer down for a quarter of a beat.
    const s = alive("hephaestus", "make");
    const cell = s.cell("a")!;
    const frame = (ms: number): string => (s.to(ms), cell.dataset.frame ?? "");
    expect(cell.dataset.pose).toBe("make");
    expect(frame(0)).toBe("b"); // down as the pose cuts in
    expect(frame(139)).toBe("b");
    expect(frame(140)).toBe("");
    expect(frame(559)).toBe("");
    expect(frame(560)).toBe("b");
    expect(frame(700)).toBe("");
    expect(frame(1120)).toBe("b");
    expect(frame(1260)).toBe("");
    expect(frame(2239)).toBe(""); // a beat's rest, and the bar comes round
    expect(frame(2240)).toBe("b");
    expect(frame(2380)).toBe("");
    // The second frame is a picture of its own, where the first is; the pose is still his make.
    const [first, second] = [...cell.querySelectorAll<HTMLImageElement>(".oly-p-make")];
    expect(second!.className).toBe("oly-pose oly-p-make oly-f-b");
    expect(second!.getAttribute("src")).toBe(FRAME_URLS.hephaestus!.make);
    expect(second!.getAttribute("style")).toBe(first!.getAttribute("style"));
    expect(s.peek().gods[0]).toMatchObject({ pose: "make", want: "make", step: "work" });
    // A cut to the bellows: that pose's own gesture, from that cut. He leans on them, eased.
    const cut = cutTo(s, "hephaestus", "run", 2);
    const pivot = CAST.gods.hephaestus.fid.run!.moves[0]!.pivot!;
    const lean = (ms: number): string => (
      s.host.advance(cut + ms - s.host.now()),
      posesOf(cell).style.transform
    );
    expect(cell.dataset.frame).toBeUndefined();
    expect(lean(0)).toBe("");
    expect(lean(140)).toBe(turnOf(pivot, 0.5));
    expect(lean(280)).toBe(turnOf(pivot, 1));
    expect(lean(559)).toBe(turnOf(pivot, 1));
    expect(lean(700)).toBe(turnOf(pivot, 0.5));
    expect(lean(840)).toBe("");
    expect(lean(1119)).toBe("");
    expect(lean(1260)).toBe(turnOf(pivot, 0.5)); // his bar is two beats: again
    // And back to the anvil: the hammer is down on the cut, wherever his old bar had got to.
    const back = cutTo(s, "hephaestus", "make", 3);
    expect(cell.dataset.frame).toBe("b");
    expect(posesOf(cell).style.transform).toBe("");
    s.host.advance(140);
    expect(cell.dataset.frame).toBeUndefined();
    expect((back - s.t0) % 560).toBe(0); // the cut fell on his beat, as cuts do
  });

  it("the whole figure may ease a little; a limb only ever changes by a cut to another frame", () => {
    // Athena inclines to her owl: a turn of 1.5° about the floor under her front, eased in and out.
    const athena = alive("athena", "look");
    const poses = posesOf(athena.cell("a")!);
    const pivot = CAST.gods.athena.fid.look!.moves[0]!.pivot!;
    const turns: number[] = [];
    for (let ms = 0; ms < 60_000; ms += 20) {
      athena.host.advance(20);
      const tx = poses.style.transform;
      const deg = tx === "" ? 0 : Number(/rotate\(([\d.]+)deg\)/.exec(tx)![1]);
      expect(tx).toBe(deg ? turnOf(pivot, deg) : "");
      expect(athena.cell("a")!.dataset.frame).toBeUndefined();
      turns.push(deg);
    }
    expect(Math.max(...turns)).toBe(1.5);
    // Eased: no frame is far from the last. And a gesture: she is still most of the time.
    turns.forEach((deg, i) => i && expect(Math.abs(deg - turns[i - 1]!)).toBeLessThan(0.1));
    expect(turns.filter((deg) => deg === 0).length).toBeGreaterThan(turns.length / 2);
    expect(turns.filter((deg, i) => deg > 0 && turns[i - 1] === 0).length).toBeGreaterThan(3);
    // Hermes runs on the spot: his other stride for a beat of 300ms, two px back, and no frame between.
    const hermes = alive("hermes", "run");
    const cell = hermes.cell("a")!;
    for (let ms = 0; ms < 3000; ms += 10) {
      hermes.to(ms);
      const striding = Math.floor(ms / 300) % 2 === 0;
      expect(cell.dataset.frame).toBe(striding ? "b" : undefined);
      expect(posesOf(cell).style.transform).toBe(striding ? "translate(-2.00px, 0.00px)" : "");
      expect(cell.dataset.pose).toBe("run");
    }
  });

  it("a thing that hangs free is the pose's own picture again, cut out and moved: the scales swing once on the cut, and settle", () => {
    const s = alive("themis", "think");
    const cell = s.cell("a")!;
    const pose = cell.dataset.pose as "think-l" | "think-r";
    const { cut, hole } = CAST.gods.themis.parts[pose]!;
    const pivot = CAST.gods.themis.fid[pose]!.cut!.pivot!;
    const [left, width] = CAST.gods.themis.at[pose]!;
    const px = (points: readonly (readonly [number, number])[]): string =>
      points.map(([x, y]) => `${x}px ${y}px`).join(",");
    // Built with her: the pose's picture twice, the second clipped to the scales; the first knows their hole.
    const part = cell.querySelector<HTMLImageElement>(`.oly-part[data-of="${pose}"]`)!;
    const whole = cell.querySelector<HTMLImageElement>(`.oly-pose.oly-p-${pose}`)!;
    expect(part.getAttribute("src")).toBe(POSE_URLS.themis[pose]);
    expect(part.style.left).toBe(`${left}px`);
    expect(part.style.width).toBe(`${width}px`);
    expect(part.style.getPropertyValue("--oly-clip")).toBe(`polygon(${px(cut)})`);
    expect(whole.style.getPropertyValue("--oly-hole")).toBe(
      `polygon(evenodd,0px 0px,${width}px 0px,${width}px 100px,0px 100px,0px 0px,${px(hole)},${px(hole.slice(0, 1))})`,
    );
    expect(cell.querySelectorAll(".oly-part")).toHaveLength(3); // her scales either way, and her pebble
    // Her beat is 640ms: tipped 5°, back past true to −3°, 1.5°, and still; each eased over a beat.
    const swing = (ms: number): string => (s.to(ms), part.style.transform);
    expect(swing(0)).toBe("");
    expect(cell.dataset.part).toBeUndefined(); // not yet moved: only the pose is shown
    expect(swing(320)).toBe(turnOf(pivot, 2.5));
    expect(cell.dataset.part).toBe("scales");
    expect(swing(640)).toBe(turnOf(pivot, 5));
    expect(swing(960)).toBe(turnOf(pivot, 1));
    expect(swing(1280)).toBe(turnOf(pivot, -3));
    expect(swing(1600)).toBe(turnOf(pivot, -0.75));
    expect(swing(1920)).toBe(turnOf(pivot, 1.5));
    expect(swing(2240)).toBe(turnOf(pivot, 0.75));
    expect(posesOf(cell).style.transform).toBe(""); // the figure itself never moved
    expect(swing(2560)).toBe("");
    expect(cell.dataset.part).toBeUndefined();
    // Played once: it doesn't come back, and nothing ticks while she holds them.
    const { frames } = s.drawn;
    s.host.run(20_000);
    expect(part.style.transform).toBe("");
    expect(s.drawn.frames).toBe(frames);
    expect(s.host.pending()).toBe(0);
  });

  it("a part moved by steps: the watchman's flame gutters, and the pebble is tossed and caught", () => {
    // Argus's beat is 500ms, his bar five beats: the flame leans at beat 2, the other way, and is back at 3.
    const argus = alive("argus", "web");
    const flame = argus.cell("a")!.querySelector<HTMLElement>('.oly-part[data-of="web"]')!;
    const pivot = CAST.gods.argus.fid.web!.moves[0]!.pivot!;
    const gutter = (ms: number): string => (argus.to(ms), flame.style.transform);
    expect(flame.style.getPropertyValue("--oly-clip")).toBe(
      "polygon(49.5px 8.8px,66px 8.8px,66px 17.5px,63.6px 20.1px,56px 20.1px,49.5px 14.5px)",
    );
    expect(
      argus
        .cell("a")!
        .querySelector<HTMLElement>(".oly-pose.oly-p-web")!
        .style.getPropertyValue("--oly-hole"),
    ).toBe(
      "polygon(evenodd,0px 0px,67px 0px,67px 100px,0px 100px,0px 0px,49.5px 8.8px,66px 8.8px,66px 17.2px,63.4px 19.5px,56.4px 19.5px,49.5px 14.2px,49.5px 8.8px)",
    );
    expect(gutter(999)).toBe("");
    expect(argus.cell("a")!.dataset.part).toBeUndefined();
    expect(gutter(1000)).toBe(turnOf(pivot, -6));
    expect(argus.cell("a")!.dataset.part).toBe("flame");
    expect(gutter(1249)).toBe(turnOf(pivot, -6)); // a cut, not a sway
    expect(gutter(1250)).toBe(turnOf(pivot, 4));
    expect(gutter(1500)).toBe("");
    expect(argus.cell("a")!.dataset.part).toBeUndefined();
    expect(gutter(3499)).toBe("");
    expect(gutter(3500)).toBe(turnOf(pivot, -6)); // every bar: a rhythm
    // Themis's beat is 640ms, her bar three: the pebble up, in her hand, dropped, gone, and up again.
    const themis = alive("themis", "run");
    const pebble = themis.cell("a")!.querySelector<HTMLElement>('.oly-part[data-of="run"]')!;
    const toss = (ms: number): string => (themis.to(ms), pebble.style.transform);
    expect(toss(0)).toBe("translate(0.00px, -1.20px)");
    expect(themis.cell("a")!.dataset.part).toBe("pebble");
    expect(toss(640)).toBe("");
    expect(themis.cell("a")!.dataset.part).toBeUndefined();
    expect(toss(800)).toBe("translate(0.00px, 2.20px)");
    expect(toss(960)).toBe("scale(0)");
    expect(themis.cell("a")!.dataset.part).toBe("pebble");
    expect(toss(1600)).toBe("translate(0.00px, -1.20px)");
    expect(toss(1920)).toBe("translate(0.00px, -1.20px)"); // the bar comes round as it was left
    expect(toss(1920 + 640)).toBe("");
  });

  it("an about-face is the mirror the walk's look round uses: the watchman looks back along the lane, and his name stays", () => {
    // Argus at his run: his bar is six beats of 500ms, turned from beat 2 to beat 3.
    const s = alive("argus", "run");
    const cell = s.cell("a")!;
    const { face } = s.peek().gods[0]!;
    const name = s.label("a")!.style.transform;
    const turned = (ms: number): boolean => (s.to(ms), cell.classList.contains("is-left"));
    expect(turned(999)).toBe(face < 0);
    expect(turned(1000)).toBe(face > 0);
    expect(s.peek().gods[0]).toMatchObject({ dir: -face, face, fidget: { turn: true, tx: "" } });
    expect(s.label("a")!.style.transform).toBe(name);
    expect(turned(1499)).toBe(face > 0);
    expect(turned(1500)).toBe(face < 0);
    expect(s.peek().gods[0]).toMatchObject({ dir: face, fidget: null });
    expect(turned(3999)).toBe(face < 0);
    expect(turned(4000)).toBe(face > 0);
    expect(s.label("a")!.style.transform).toBe(name);
  });

  it("an idling god's gestures are dealt by dice of its own: never the floor's, and nothing is put on its clock", () => {
    // Five who idle, each in its own time: a minute of it.
    const s = stage({ fidget: true });
    s.sync([
      agent("a", "athena", "run", "look", 1),
      agent("b", "herodotus", "run", "look", 1),
      agent("c", "hermes", "run", "look", 1),
      agent("d", "themis", "run", "look", 1),
      agent("e", "nike", "run", "run", 1),
    ]);
    settle(s, 5);
    const { clock, dice } = s.asked;
    const gestures = new Map<string, number>();
    const was = new Map<string, boolean>();
    for (let ms = 0; ms < 60_000; ms += 20) {
      s.host.run(20);
      for (const god of s.peek().gods) {
        const on = god.fidget !== null;
        if (on && !was.get(god.key)) gestures.set(god.key, (gestures.get(god.key) ?? 0) + 1);
        was.set(god.key, on);
      }
    }
    expect([...gestures.keys()].sort()).toEqual(["a", "b", "c", "d", "e"]);
    for (const n of gestures.values()) expect(n).toBeGreaterThanOrEqual(3);
    // Not one step, one wake or one throw of the floor's dice for any of it.
    expect(s.asked).toEqual({ clock, dice });
    expect(s.peek().gods.every((god) => god.step === "work")).toBe(true);
  });

  it("deals by the agent, the pose, the cut and the bar: the same agent the same way, another agent of the same god another", () => {
    /** When each of Athena's gestures at her look begins, in her first two minutes. */
    function gestures(key: string): number[] {
      const s = alive("athena", "look", {}, key);
      const begun: number[] = [];
      let was = false;
      for (let ms = 0; ms < 120_000; ms += 40) {
        s.host.advance(40);
        const on = s.peek().gods[0]!.fidget !== null;
        if (on && !was) begun.push(ms);
        was = on;
      }
      return begun;
    }
    const one = gestures("a");
    expect(one.length).toBeGreaterThan(8);
    expect(gestures("a")).toEqual(one);
    expect(gestures("b")).not.toEqual(one);
  });

  it("frames sleep between gestures: one for a cut key, at its moment, and none for the floor", () => {
    const s = alive("hephaestus", "make");
    s.to(1); // into his bar: the hammer is down
    const { frames } = s.drawn;
    const bed = { wipes: s.bed.wipes, filled: s.bed.filled };
    const fx = { wipes: s.fx.wipes, filled: s.fx.filled };
    expect(s.host.pending()).toBe(1); // a wait for the hammer to come up
    // A bar of four beats, 2240ms: up, down, up, down, up, and down again as the next begins.
    s.host.run(2240);
    expect(s.drawn.frames - frames).toBe(6);
    s.host.run(10 * 2240);
    expect(s.drawn.frames - frames).toBe(66);
    // The floor at rest was not drawn again, nor the gods' canvas touched.
    expect(s.bed).toMatchObject(bed);
    expect(s.fx).toMatchObject(fx);
  });

  it("frames run only while a figure eases, and sleep for good when nothing more is to come", () => {
    // The smith at his thinking: a beat after the cut he leans in, over 400ms, and stays so.
    const s = alive("hephaestus", "think");
    const cell = s.cell("a")!;
    const pivot = CAST.gods.hephaestus.fid.think!.cut!.pivot!;
    const { frames } = s.drawn;
    expect(s.host.pending()).toBe(1); // a wait, not a frame
    s.host.run(559);
    expect(s.drawn.frames).toBe(frames); // asleep until his beat
    expect(posesOf(cell).style.transform).toBe("");
    s.host.run(1);
    s.host.run(200);
    expect(posesOf(cell).style.transform).toBe(turnOf(pivot, 0.5));
    const easing = s.drawn.frames - frames;
    expect(easing).toBeGreaterThan(8); // frame by frame, as the window gives them
    s.host.run(200);
    expect(posesOf(cell).style.transform).toBe(turnOf(pivot, 1));
    s.host.run(100);
    const done = s.drawn.frames;
    expect(s.host.pending()).toBe(0); // asleep, with nothing to wake for
    s.host.run(60_000);
    expect(s.drawn.frames).toBe(done);
    expect(posesOf(cell).style.transform).toBe(turnOf(pivot, 1));
  });

  it("a lane of five whose gestures are all cuts draws a frame a key, not sixty a second", () => {
    const s = stage({ fidget: true });
    s.sync([
      agent("a", "hermes", "run", "run", 1),
      agent("b", "hephaestus", "run", "make", 1),
      agent("c", "argus", "run", "web", 1),
      agent("d", "themis", "run", "run", 1),
      agent("e", "nike", "run", "make", 1),
    ]);
    settle(s, 5);
    s.host.run(3000); // the last to arrive has settled
    const { frames } = s.drawn;
    const { clock, dice } = s.asked;
    s.host.run(10_000);
    const drawn = s.drawn.frames - frames;
    // Hermes's stride 33, the hammer 27, the flame 12, the pebble 26, and Nike's hops: no more than their keys.
    expect(drawn).toBeGreaterThan(90);
    expect(drawn).toBeLessThan(130);
    expect(s.asked).toEqual({ clock, dice });
  });

  it("the one who flies rides on her fidget: up as her look cuts in, between 6 and 8px as her wings beat", () => {
    // Nike's beat is 360ms, her bar two: wings down as she rises to 8, up as she sinks to 6, eased over 300ms.
    const s = alive("nike", "look");
    const cell = s.cell("a")!;
    const at = (ms: number): [string, number] => (
      s.to(ms),
      [cell.dataset.frame ?? "", Number(s.peek().gods[0]!.lift.toFixed(4))]
    );
    expect(at(0)).toEqual(["b", 0]); // on the floor as her pose cuts in, wings down
    expect(at(120)).toEqual(["b", 7]); // rising as she did, 240ms, easing out
    expect(at(240)).toEqual(["b", 8]);
    expect(at(359)).toEqual(["b", 8]);
    expect(at(360)).toEqual(["", 8]); // her wings come up, and she begins to sink
    expect(at(510)).toEqual(["", 7]);
    expect(at(660)).toEqual(["", 6]);
    expect(at(719)).toEqual(["", 6]);
    expect(at(720)).toEqual(["b", 6]); // the bar comes round: down, and she rises
    expect(at(870)).toEqual(["b", 7]);
    expect(at(1020)).toEqual(["b", 8]);
    expect(at(1080)).toEqual(["", 8]);
    expect(cell.style.transform).toMatch(/px, -8px, 0\)$/);
    expect(posesOf(cell).style.transform).toBe(""); // her height is her cell's, as her lift is
    expect(s.label("a")!.style.transform).toMatch(/px, 0, 0\)$/); // and her name is not lifted
    // Never over her lift, so never out of her envelope; her card holds its one height.
    enter(cell);
    const { foot } = s.peek().card!;
    expect(foot).toBe(CELL_Y + CAST.gods.nike.card - CARD_AIR);
    for (let ms = 1100; ms < 4000; ms += 10) {
      const [, lift] = at(ms);
      expect(lift).toBeGreaterThanOrEqual(6);
      expect(lift).toBeLessThanOrEqual(8);
      expect(s.peek().card!.foot).toBe(foot);
    }
  });

  it("she comes down before a cut from the height she had, her wings still, and the cut falls when it would with no fidget", () => {
    /** Her look, then a tool of another family 1500ms in: when she is cut to it, and how she came down. */
    function cutFrom(fidget: boolean): { cut: number; down: [string, number][]; s: Stage } {
      const s = alive("nike", "look", { fidget });
      s.to(1500);
      s.sync([agent("a", "nike", "run", "run", 2)]);
      const down: [string, number][] = [];
      const cell = s.cell("a")!;
      while (cell.dataset.pose === "look") {
        down.push([cell.dataset.frame ?? "", s.peek().gods[0]!.lift]);
        s.host.advance(10);
      }
      return { cut: s.host.now() - s.t0, down: down.slice(-18), s };
    }
    const still = cutFrom(false);
    const alive180 = cutFrom(true);
    expect(alive180.cut).toBe(still.cut);
    expect(still.cut % 360).toBe(0);
    // The last 180ms before the cut: no wingbeat, and down from where she was, as she came down before.
    const from = alive180.down[0]![1];
    expect(from).toBeGreaterThanOrEqual(6);
    expect(from).toBeLessThan(8); // she was riding, under her lift
    alive180.down.forEach(([frame, lift], i) => {
      expect(frame).toBe("");
      expect(lift).toBeCloseTo((from / 8) * still.down[i]![1], 9);
      if (i) expect(lift).toBeLessThan(alive180.down[i - 1]![1]);
    });
    expect(alive180.s.peek().gods[0]).toMatchObject({ pose: "run", lift: 0 });
    expect(still.s.peek().gods[0]).toMatchObject({ pose: "run", lift: 0, fidget: null });
  });

  it("she comes down first for an ending and for a step aside, from the height she had, and each falls when it would with no fidget", () => {
    function ended(fidget: boolean, how: "done" | "aside"): { said: number; from: number } {
      const s = alive("nike", "look", { fidget });
      s.to(1440 + 510); // sinking: 7px up, if she rides
      const from = s.peek().gods[0]!.lift;
      if (how === "done") s.sync([agent("a", "nike", "done", "look", 1)]);
      else narrow(s);
      const seen = s.peek().gods[0]!;
      expect(seen).toMatchObject({ step: "alight", pose: "look", fidget: null });
      expect(seen.lift).toBe(from); // from where she is: nothing jumps
      expect(s.cell("a")!.dataset.frame).toBeUndefined();
      s.host.advance(90);
      expect(s.peek().gods[0]!.lift).toBeCloseTo(from / 2, 9);
      until(s, () => s.peek().gods[0]!.step !== "alight");
      expect(s.peek().gods[0]!.lift).toBe(0);
      expect(s.peek().gods[0]!.step).toBe(how === "done" ? "report" : "walk");
      return { said: s.host.now() - s.t0, from };
    }
    for (const how of ["done", "aside"] as const) {
      const still = ended(false, how);
      const riding = ended(true, how);
      expect(still.from).toBe(8);
      expect(riding.from).toBeCloseTo(7, 9);
      expect(riding.said).toBe(still.said);
      expect(still.said).toBe(1440 + 510 + 180);
    }
  });

  it("a cut ends a gesture at once, and never waits for one: it falls on the beat it would with no fidget", () => {
    function cutFrom(fidget: boolean): { cut: number; s: Stage & { t0: number } } {
      const s = alive("themis", "think", { fidget });
      s.to(320); // her scales are swinging
      s.sync([agent("a", "themis", "run", "look", 2)]);
      until(s, () => s.cell("a")!.dataset.pose === "look");
      return { cut: s.host.now() - s.t0, s };
    }
    const still = cutFrom(false);
    const { cut, s } = cutFrom(true);
    expect(cut).toBe(still.cut);
    expect(cut).toBe(1280); // her dwell is two of her beats
    const cell = s.cell("a")!;
    // On the cut, in the same frame: the scales are whole and still, though their swing had 1280ms to run.
    expect(cell.dataset.part).toBeUndefined();
    expect(cell.querySelectorAll('.oly-part[style*="transform"]')).toHaveLength(0);
    expect(s.peek().gods[0]).toMatchObject({ pose: "look", fidget: null });
    // A ms before, they were swinging yet.
    const again = alive("themis", "think");
    again.to(320);
    again.sync([agent("a", "themis", "run", "look", 2)]);
    again.to(1279);
    expect(again.cell("a")!.dataset.part).toBe("scales");
    expect(again.peek().gods[0]!.fidget!.ptx).toMatch(/rotate\(-3\.000deg\)/);
  });

  it("a step aside, a change of width and an ending drop a gesture at once: it stands as it stood", () => {
    // The smith at his bellows is leaning nearly all the time.
    for (const how of ["fail", "done", "stop", "width"] as const) {
      const s = alive("hephaestus", "run");
      const cell = s.cell("a")!;
      s.to(200);
      expect(posesOf(cell).style.transform).toMatch(/rotate\(0\.\d+deg\)/);
      if (how === "width") narrow(s);
      else s.sync([agent("a", "hephaestus", how, "run", 1)]);
      expect(s.peek().gods[0]!.step).not.toBe("work");
      expect(s.peek().gods[0]!.fidget).toBeNull();
      expect(posesOf(cell).style.transform).toBe("");
      // And nothing of it comes back while he walks, speaks, dims or goes.
      for (let ms = 0; ms < 6000 && s.cells().length; ms += 50) {
        s.host.advance(50);
        if (s.peek().gods[0]?.step === "work") break;
        expect(posesOf(cell).style.transform).toBe("");
        expect(cell.dataset.frame).toBeUndefined();
      }
    }
    // Back at his work after stepping aside, his gesture counts from there.
    const s = alive("hephaestus", "run");
    s.to(200);
    narrow(s);
    settle(s);
    const pivot = CAST.gods.hephaestus.fid.run!.moves[0]!.pivot!;
    expect(posesOf(s.cell("a")!).style.transform).toBe("");
    s.host.advance(140);
    expect(posesOf(s.cell("a")!).style.transform).toBe(turnOf(pivot, 0.5));
  });

  /**
   * A lane as it stood, with what only a fidget writes taken off: the second
   * frames and the parts it was built with, a figure's and a part's transform,
   * the frame and the part shown; the facing of a god that `alive`, the same
   * look at the run with fidgets on, has about-faced; and the height of the
   * one who flies, which rides on hers.
   */
  function untouched(page: HTMLElement, height: string, alive: FloorPeek): string {
    const lane = page.cloneNode(true) as HTMLElement;
    for (const extra of lane.querySelectorAll(".oly-f-b, .oly-part")) extra.remove();
    for (const pose of lane.querySelectorAll<HTMLElement>(".oly-pose"))
      pose.style.removeProperty("--oly-hole");
    for (const poses of lane.querySelectorAll(".oly-poses")) poses.removeAttribute("style");
    [...lane.querySelectorAll<HTMLElement>(".oly-cell")].forEach((cell, i) => {
      const { god, pose } = cell.dataset as { god: GodId; pose: Skill };
      delete cell.dataset.frame;
      delete cell.dataset.part;
      if (alive.gods[i]?.fidget?.turn) cell.classList.remove("is-left");
      if (CAST.gods[god].lift[pose])
        cell.style.transform = cell.style.transform.replace(/, [^,]+, 0\)$/, ", 0, 0)");
    });
    return `${height} ${lane.innerHTML}`.replace(/ style=""/g, "");
  }

  interface Played {
    readonly peeks: FloorPeek[];
    /** Each look's page, with what the fidgets of the run `alive` wrote taken off. */
    pages(alive: readonly FloorPeek[]): string[];
    readonly asked: { clock: number; dice: number };
    readonly cards: (string | null)[];
    readonly frames: number;
    /** How many looks found something a fidget had written. */
    readonly writes: number;
  }

  /**
   * A run of records, looked at every 250ms, with the frames between as a
   * window gives them, and the pointer on one god after another.
   */
  function played(records: (ms: number) => LaneAgent[], fidget: boolean, reduced = false): Played {
    const s = stage({ seed: 5, fidget, reduced });
    const peeks: FloorPeek[] = [];
    const looks: { page: HTMLElement; height: string }[] = [];
    let writes = 0;
    for (let ms = 0; ms <= 30_000; ms += 250) {
      s.sync(records(ms));
      const cells = s.cells();
      if (cells.length) enter(cells[(ms / 250) % cells.length]);
      peeks.push(s.peek());
      looks.push({ page: s.lane.cloneNode(true) as HTMLElement, height: s.lane.style.height });
      writes += s.lane.querySelector(
        '[data-frame], [data-part], .oly-poses[style*="transform"], .oly-part[style*="transform"]',
      )
        ? 1
        : 0;
      s.host.run(250, 16);
    }
    const run: Played = {
      peeks,
      pages: (alive) => looks.map(({ page, height }, i) => untouched(page, height, alive[i]!)),
      asked: { ...s.asked },
      cards: [...s.cards],
      frames: s.drawn.frames,
      writes,
    };
    s.dispose();
    return run;
  }
  /** The mockup's run and its three extras: six gods, a failure, a crowd. */
  const crowdRun = (ms: number): LaneAgent[] => laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]);
  /**
   * The five whose fidgets differ most, the one who flies among them, each
   * through a tool of every family, three seconds a tool, each a little after
   * the last; then one is done and one fails.
   */
  const FIVE: readonly GodId[] = ["nike", "hermes", "themis", "argus", "hephaestus"];
  const FAMILIES: readonly ToolFamily[] = ["look", "run", "make", "web", "think"];
  const fiveRun = (ms: number): LaneAgent[] =>
    FIVE.map((god, i) => {
      const tools = Math.max(0, Math.floor((ms - 300 * i) / 3000));
      const look = i === 1 && ms >= 21_000 ? "done" : i === 3 && ms >= 24_000 ? "fail" : "run";
      return agent(god, god, look, tools ? FAMILIES[(tools + i) % 5]! : "think", tools);
    });

  /**
   * A look at the lane with each god's fidget taken off: as it faces if
   * `alive`, the same look with fidgets on, has it about-faced; and the one
   * who flies simply aloft, at whatever height.
   */
  function bare(peek: FloorPeek, alive: FloorPeek): unknown {
    return {
      ...peek,
      gods: peek.gods.map((god, i) => {
        const turned = alive.gods[i]?.fidget?.turn === true;
        const { fidget, ...rest } = god;
        return {
          ...rest,
          dir: turned && fidget ? -god.dir : god.dir,
          figure: turned ? null : god.figure,
          lift: CAST.gods[god.god].lift[god.pose as Skill] ? "aloft" : god.lift,
        };
      }),
    };
  }

  it.each([
    ["the crowd's run", crowdRun],
    ["five through every family of tool", fiveRun],
  ] as const)(
    "the same seeded run plays the same with fidgets on and off: every step, cut, place, line, card and throw of the dice; only the fidget differs (%s)",
    (_name, records) => {
      const off = played(records, false);
      const on = played(records, true);
      // The run with fidgets on did fidget, in every way there is.
      expect(on.writes).toBeGreaterThan(20);
      expect(off.writes).toBe(0);
      const fidgets = on.peeks.flatMap((peek) => peek.gods.flatMap((god) => god.fidget ?? []));
      expect(fidgets.some((f) => f.tx !== "")).toBe(true);
      expect(fidgets.some((f) => f.frame === "b")).toBe(true);
      if (records === crowdRun) {
        // An about-face and a part moved: Argus and Themis are in the crowd.
        expect(fidgets.some((f) => f.turn)).toBe(true);
        expect(fidgets.some((f) => f.part !== "")).toBe(true);
      } else {
        // The one who flies, riding under her lift.
        expect(fidgets.some((f) => f.lift !== null && f.lift < 8)).toBe(true);
      }
      expect(off.peeks.every((peek) => peek.gods.every((god) => god.fidget === null))).toBe(true);
      // And everything else is the same, look for look: what the floor holds, and the page.
      on.peeks.forEach((peek, i) =>
        expect(JSON.stringify(bare(peek, peek))).toBe(JSON.stringify(bare(off.peeks[i]!, peek))),
      );
      expect(on.pages(on.peeks)).toEqual(off.pages(on.peeks));
      expect(on.pages(on.peeks).join("")).toMatch(/data-pose="(look|make|run|web|think)"/);
      expect(on.cards).toEqual(off.cards);
      expect(on.cards.length).toBeGreaterThan(20);
      // Not a step, a wake or a throw of the floor's dice more.
      expect(on.asked).toEqual(off.asked);
      expect(on.asked.dice).toBeGreaterThan(10);
      expect(on.frames).toBeGreaterThan(off.frames); // only frames: the gestures' own
    },
  );

  it("under reduced motion nobody fidgets: the lane is the stills it was, to the frame", () => {
    for (const records of [crowdRun, fiveRun]) {
      const off = played(records, false, true);
      const on = played(records, true, true);
      expect(on.writes).toBe(0);
      expect(on.peeks.every((peek) => peek.gods.every((god) => god.fidget === null))).toBe(true);
      expect(JSON.stringify(on.peeks)).toBe(JSON.stringify(off.peeks));
      // The page, but for the pictures a fidgeting god was built with, which nothing shows.
      expect(on.pages(on.peeks)).toEqual(off.pages(off.peeks));
      expect(on.asked).toEqual(off.asked);
      expect(on.cards).toEqual(off.cards);
      expect(on.frames).toBe(off.frames); // not one frame drawn for a fidget
    }
    // The one who flies is simply up, her wings as they were carved; and the clock is asleep.
    const nike = alive("nike", "look", { reduced: true });
    nike.host.run(5000);
    expect(nike.peek().gods[0]).toMatchObject({ lift: 8, fidget: null, step: "work" });
    expect(nike.cell("a")!.dataset.frame).toBeUndefined();
    expect(nike.cell("a")!.style.transform).toMatch(/px, -8px, 0\)$/);
    expect(nike.host.pending()).toBe(0);
  });

  it("reduced motion asked for in the middle of a gesture is a cut to rest, at the next frame drawn", () => {
    // While a figure eases, frames are running: the very next one.
    const smith = alive("hephaestus", "run");
    smith.to(200);
    expect(posesOf(smith.cell("a")!).style.transform).not.toBe("");
    smith.quiet(true);
    smith.host.advance(16);
    expect(posesOf(smith.cell("a")!).style.transform).toBe("");
    expect(smith.peek().gods[0]!.fidget).toBeNull();
    expect(smith.host.pending()).toBe(0); // and asleep: nothing more is asked for
    smith.host.run(5000);
    expect(posesOf(smith.cell("a")!).style.transform).toBe("");
    // The one who flies: simply up, her wings as they were carved.
    const nike = alive("nike", "look");
    nike.to(1440 + 510);
    expect(nike.peek().gods[0]!.lift).toBeCloseTo(7, 9);
    nike.quiet(true);
    nike.host.advance(16);
    expect(nike.peek().gods[0]).toMatchObject({ lift: 8, fidget: null });
    expect(nike.cell("a")!.dataset.frame).toBeUndefined();
    expect(nike.cell("a")!.style.transform).toMatch(/px, -8px, 0\)$/);
    expect(nike.host.pending()).toBe(0);
    // Held on a cut, with no frame until its next key: then, and no later.
    const argus = alive("argus", "run");
    const { face } = argus.peek().gods[0]!;
    argus.to(1100); // turned about, until 1500
    expect(argus.cell("a")!.classList.contains("is-left")).toBe(face > 0);
    argus.quiet(true);
    argus.to(1499);
    expect(argus.cell("a")!.classList.contains("is-left")).toBe(face > 0);
    argus.to(1500);
    expect(argus.cell("a")!.classList.contains("is-left")).toBe(face < 0);
    expect(argus.host.pending()).toBe(0);
    argus.host.run(6000); // and no turn in his next bar
    expect(argus.cell("a")!.classList.contains("is-left")).toBe(face < 0);
  });

  it("the card and the keys over fidgeting gods put nothing on the clock, wake it never, and throw no dice", () => {
    function run(look: boolean): { asked: { clock: number; dice: number }; peeks: string } {
      const s = crowd(["hephaestus", "nike", "themis"], { fidget: true });
      const peeks: string[] = [];
      for (let ms = 0; ms < 8000; ms += 100) {
        if (look) {
          const cells = s.cells();
          if (ms % 600 === 0) enter(cells[(ms / 600) % cells.length]);
          if (ms % 600 === 300) leave(cells[((ms - 300) / 600) % cells.length]);
          if (ms % 1000 === 500) keydown(document.body, "Tab");
          if (ms % 1000 === 700) keydown(cells[0]!, "ArrowRight");
          if (ms === 4000) keydown(document.body, "Escape");
        }
        s.host.run(100);
        const { card: _card, ...rest } = s.peek();
        peeks.push(JSON.stringify(rest));
      }
      return { asked: { ...s.asked }, peeks: peeks.join("\n") };
    }
    const alone = run(false);
    const looked = run(true);
    expect(looked.asked).toEqual(alone.asked);
    expect(looked.peeks).toBe(alone.peeks);
    expect(alone.peeks).toMatch(/"fidget":\{/);
  });

  it("with its fidgets off a god is built as it was: no second frame, no part, no hole", () => {
    const s = alive("themis", "run", { fidget: false });
    const cell = s.cell("a")!;
    expect(cell.querySelectorAll(".oly-part, .oly-f-b")).toHaveLength(0);
    expect(cell.querySelector<HTMLElement>(".oly-p-run")!.getAttribute("style")).not.toMatch(
      /hole/,
    );
    s.host.run(5000);
    expect(s.peek().gods[0]!.fidget).toBeNull();
    expect(cell.dataset.part).toBeUndefined();
    expect(s.host.pending()).toBe(0);
  });
});

describe("notices and the crown: the gods notice each other", () => {
  type Opts = Parameters<typeof stage>[0];
  type Spec = readonly [god: GodId, family?: ToolFamily];
  const posesOf = (cell: HTMLElement): HTMLElement =>
    cell.querySelector<HTMLElement>(".oly-poses")!;
  const turnOf = (pivot: readonly [number, number], deg: number): string =>
    `translate(${pivot[0]}px, ${pivot[1]}px) rotate(${deg.toFixed(3)}deg) translate(${-pivot[0]}px, ${-pivot[1]}px)`;

  interface Lane extends Stage {
    /** When each god took its place: its beats count from then. */
    readonly at: Readonly<Record<string, number>>;
    /** Change one agent's record, and hand them all over. */
    set(key: string, change: Partial<LaneAgent>): void;
    seen(key: string): Seen;
    /** On to so long after `key` took its place. */
    to(key: string, ms: number): void;
    /** Their keys along the lane, left to right. */
    order(): string[];
  }

  /**
   * Gods sent together, k0, k1 and so on, each at its work in the pose it
   * acts a family of tool in (its look, unless told), and noticing each other.
   * Of three sent together, the first is on the right, the second on the left
   * and the third in the middle, facing left: the left one is in front of it;
   * it is the last to its place, some 3.3s after the others.
   */
  function lane(specs: readonly Spec[], opts: Opts = {}): Lane {
    const s = stage({ react: true, ...opts });
    let agents = specs.map(([god, family = "look"], i) => agent(`k${i}`, god, "run", family, 1));
    s.sync(agents);
    const at: Record<string, number> = {};
    for (let ms = 0; ; ms++) {
      const { gods } = s.peek();
      for (const god of gods) if (god.step === "work") at[god.key] ??= s.host.now();
      if (gods.length === specs.length && gods.every((god) => god.step === "work")) break;
      if (ms > 60_000) throw new Error("they never came to their work");
      s.host.advance(1);
    }
    return Object.assign(s, {
      at,
      set(key: string, change: Partial<LaneAgent>): void {
        agents = agents.map((a) => (a.key === key ? { ...a, ...change } : a));
        s.sync(agents);
      },
      seen: (key: string): Seen => out(s, key),
      to(key: string, ms: number): void {
        const on = at[key]! + ms - s.host.now();
        if (on < 0) throw new Error(`${key} took its place more than ${ms}ms ago`);
        s.host.advance(on);
      },
      order: (): string[] => along(s),
    });
  }

  /** The clock moved on a ms at a time: from when to when `key` next shows a reaction, counted from now. */
  function shows(
    s: Lane,
    key: string,
    within = 4000,
  ): { from: number; to: number; how: string; of: string } | null {
    let found: { from: number; how: string; of: string } | null = null;
    for (let ms = 0; ms <= within; ms++) {
      const r = s.seen(key).react;
      if (r && !found) found = { from: ms, ...r };
      if (!r && found) return { ...found, to: ms };
      s.host.advance(1);
    }
    return found && { ...found, to: Infinity };
  }

  /** Athena on the right, Hermes on the left, and Herodotus, who misses nothing, between them. */
  const three = (opts: Opts = {}): Lane => lane([["athena"], ["hermes"], ["herodotus"]], opts);

  it("a god in front is glanced at by the nearest god at its work that side: on its own quarter-beat, a lean about the floor under its front, eased in and out over half a beat", () => {
    const s = three();
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    expect(s.seen("k2")).toMatchObject({ god: "herodotus", face: -1, pose: "look" });
    expect(s.seen("k2").x - s.seen("k1").x).toBeLessThan(200);
    const cell = s.cell("k2")!;
    // His beat is 600ms. Hermes, in front of him, is done a second after he took his place.
    s.to("k2", 1000);
    s.set("k1", { look: "done" });
    expect(s.seen("k2").react).toBeNull(); // not at once: a quarter-beat after, on his quarter-beat
    s.to("k2", 1199);
    expect(s.seen("k2").react).toBeNull();
    expect(cell.dataset.react).toBeUndefined();
    s.to("k2", 1200);
    expect(s.seen("k2").react).toEqual({ how: "glance", of: "k1" });
    expect(cell.dataset.react).toBe("glance");
    const { front } = CAST.gods.herodotus.nt.look!;
    const lean = (ms: number): string => (s.to("k2", 1200 + ms), posesOf(cell).style.transform);
    expect(lean(0)).toBe("");
    expect(lean(150)).toBe(turnOf(front, 0.75));
    expect(lean(300)).toBe(turnOf(front, 1.5));
    expect(lean(899)).toBe(turnOf(front, 1.5));
    expect(lean(1050)).toBe(turnOf(front, 0.75));
    // The pose is the record's all the while, and he still faces as he did.
    expect(cell.dataset.pose).toBe("look");
    expect(s.seen("k2")).toMatchObject({ pose: "look", want: "look", dir: -1, step: "work" });
    expect(lean(1150)).not.toBe("");
    s.to("k2", 2399);
    expect(s.seen("k2").react).toEqual({ how: "glance", of: "k1" });
    // Two of his beats, and he is back at his work.
    expect(lean(1200)).toBe("");
    expect(s.seen("k2").react).toBeNull();
    expect(cell.dataset.react).toBeUndefined();
    // Athena, beyond him, is not the nearest that side: she saw nothing.
    const s2 = three();
    s2.to("k2", 1000);
    s2.set("k1", { look: "done" });
    expect(shows(s2, "k0", 2500)).toBeNull();
  });

  it("one behind is turned to, where the pose may turn: a cut, held its beats, and a cut back", () => {
    const s = three();
    const cell = s.cell("k2")!;
    expect(CAST.gods.herodotus.nt.look!.turn).toBe(true);
    s.to("k2", 1000);
    s.set("k0", { look: "done" }); // Athena, on his right: behind him
    s.to("k2", 1199);
    expect(cell.classList.contains("is-left")).toBe(true);
    s.to("k2", 1200);
    expect(s.seen("k2")).toMatchObject({ react: { how: "turn", of: "k0" }, dir: 1, pose: "look" });
    expect(s.seen("k2").fidget).toMatchObject({ tx: "", turn: true });
    expect(cell.classList.contains("is-left")).toBe(false);
    expect(cell.dataset.react).toBe("turn");
    expect(posesOf(cell).style.transform).toBe(""); // no lean: a cut
    s.to("k2", 2399);
    expect(cell.classList.contains("is-left")).toBe(false);
    s.to("k2", 2400);
    expect(s.seen("k2")).toMatchObject({ react: null, dir: -1 });
    expect(cell.classList.contains("is-left")).toBe(true);
    expect(cell.dataset.react).toBeUndefined();
  });

  it("where the pose may not turn, one behind gets a glance back: a lean the other way, about the floor under its heel", () => {
    // Argus at his look holds his lamp out: he cannot turn. He sees every failure.
    const s = lane([["athena"], ["hermes"], ["argus"]]);
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    const { back, turn, lean } = CAST.gods.argus.nt.look!;
    expect(turn).toBe(false);
    expect(CAST.gods.argus.chance.fail).toBe(1);
    const face = s.seen("k2").face;
    const behind = face < 0 ? "k0" : "k1";
    s.to("k2", 1000);
    s.set(behind, { look: "fail" });
    const cell = s.cell("k2")!;
    const seen = shows(s, "k2", 1900)!;
    // Three of his beats of 500ms for a failure, begun a quarter-beat or two after it.
    expect(seen).toMatchObject({ how: "back", of: behind });
    expect(seen.from).toBeGreaterThanOrEqual(125);
    expect(seen.from).toBeLessThanOrEqual(250);
    expect(seen.to - seen.from).toBe(1500);
    const s2 = lane([["athena"], ["hermes"], ["argus"]]);
    s2.to("k2", 1000);
    s2.set(behind, { look: "fail" });
    s2.host.advance(seen.from + 250);
    expect(posesOf(s2.cell("k2")!).style.transform).toBe(turnOf(back, -lean));
    expect(s2.seen("k2").dir).toBe(face); // not turned
    expect(cell.dataset.react).toBeUndefined();
  });

  it("a god arriving is noticed as it lands, by the nearest god at its work", () => {
    const s = lane([["herodotus"]]);
    s.to("k0", 2000);
    s.sync([agent("k0", "herodotus", "run", "look", 1), agent("k1", "athena", "run", "look", 1)]);
    // The lane is open: she lands at once, beside him, and is set from her stones.
    expect(s.seen("k1")).toMatchObject({ god: "athena", step: "assemble" });
    expect(Math.abs(s.seen("k1").x - s.seen("k0").x)).toBeLessThan(200);
    const ahead = Math.sign(s.seen("k1").x - s.seen("k0").x) === s.seen("k0").face;
    const seen = shows(s, "k0", 2000)!;
    expect(seen).toMatchObject({ how: ahead ? "glance" : "turn", of: "k1" });
    expect(seen.from).toBeGreaterThanOrEqual(150);
    expect(seen.from).toBeLessThanOrEqual(300);
    expect(seen.to - seen.from).toBe(1200); // two of his beats
    expect(s.seen("k0").step).toBe("work"); // and he never left his work for her
  });

  it("a crown that cannot begin in time is dropped, and she gives no glance in its place", () => {
    // A cast whose crown must begin within a millisecond of the record: it never can.
    const nike = CAST.gods.nike;
    const hasty = {
      ...CAST,
      gods: { ...CAST.gods, nike: { ...nike, rx: { crown: { ...nike.rx.crown!, late: 1 } } } },
    };
    const s = lane([["herodotus"], ["nike", "make"], ["athena"]], { cast: hasty });
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    s.set("k2", { look: "done" });
    expect(shows(s, "k1", 2500)).toBeNull();
    expect(s.cell("k1")!.dataset.react).toBeUndefined();
    // With the cast's own crown she raised it.
    const patient = lane([["herodotus"], ["nike", "make"], ["athena"]]);
    patient.set("k2", { look: "done" });
    expect(shows(patient, "k1", 2500)).toMatchObject({ how: "crown", of: "k2" });
  });

  it("a stop is noticed as a failure is: by the same chance, for the same three beats", () => {
    const s = lane([["athena"], ["hermes"], ["argus"]]);
    const behind = s.order()[s.seen("k2").face < 0 ? 2 : 0]!;
    s.to("k2", 1000);
    s.set(behind, { look: "stop" });
    const seen = shows(s, "k2", 1900)!;
    expect(seen).toMatchObject({ how: "back", of: behind });
    expect(seen.to - seen.from).toBe(1500);
  });

  /** Whether the smith, who is absorbed, looked up when `key` beside him finished; and the dice the floor threw as it did. */
  function smith(key: string, seed: number, react = true): { looked: boolean; thrown: number } {
    const s = stage({ seed, react });
    const agents = [
      agent("smith", "hephaestus", "run", "look", 1),
      agent(key, "athena", "run", "look", 1),
    ];
    s.sync(agents);
    s.host.advance(14_000);
    const [a, b] = s.peek().gods;
    expect([a!.step, b!.step]).toEqual(["work", "work"]);
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(200);
    const { dice } = s.asked;
    s.sync([agents[0]!, { ...agents[1]!, look: "done" }]);
    let looked = false;
    for (let ms = 0; ms < 800; ms += 20) {
      s.host.advance(20);
      looked ||= out(s, "smith").react !== null;
    }
    const thrown = s.asked.dice - dice;
    s.dispose();
    return { looked, thrown };
  }

  it("whether it notices is thrown on dice of its own, by its nature: the same for the same two agents and event whatever the floor's dice, and not a throw of the floor's", () => {
    expect(CAST.gods.hephaestus.chance.done).toBe(0.2);
    const keys = Array.from({ length: 40 }, (_, i) => `owl-${i}`);
    const looks = keys.map((key) => smith(key, 7));
    // One finish in five, give or take: by the agents' keys, so these forty are always the same forty.
    const looked = looks.filter((it) => it.looked).length;
    expect(looked).toBeGreaterThan(3);
    expect(looked).toBeLessThan(14);
    // Another seed for the floor's dice: other lines, other strides, the same answers.
    keys.slice(0, 12).forEach((key, i) => expect(smith(key, 31).looked).toBe(looks[i]!.looked));
    // And the floor threw its dice as it does with nobody noticing anything.
    keys.slice(0, 12).forEach((key, i) => {
      const still = smith(key, 7, false);
      expect(still.looked).toBe(false);
      expect(still.thrown).toBe(looks[i]!.thrown);
    });
    expect(looks.some((it) => it.thrown > 0)).toBe(true); // the farewell's line is the floor's to pick
  });

  /** Herodotus on the right, Nike on the left at her making, on the floor, and Athena between them. */
  const withNike = (family: ToolFamily = "make", opts: Opts = {}): Lane =>
    lane([["herodotus"], ["nike", family], ["athena"]], opts);

  it("when a god finishes, Nike at her work raises her crown toward it: its picture in place of her pose, for four of her beats, and data-pose stays the record's", () => {
    const s = withNike();
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    expect(s.seen("k1")).toMatchObject({ god: "nike", face: 1, pose: "make", lift: 0 });
    const cell = s.cell("k1")!;
    // Built with her: the crown's picture, sat in her cell as a skill pose is.
    const crown = cell.querySelector<HTMLImageElement>(".oly-pose.oly-p-crown")!;
    expect(crown.getAttribute("src")).toBe(CROWN_URLS.nike);
    expect(crown.style.left).toBe("11px");
    expect(crown.style.width).toBe("67px");
    expect(CAST.gods.nike.rx.crown).toEqual({ late: 3000, beats: 4, at: [11, 67] });
    // Her beat is 360ms. Athena, in front of her, is done half way between two of her quarter-beats.
    const to = (ms: number): void => s.to("k1", 3600 + ms);
    to(945);
    s.set("k2", { look: "done" });
    to(1079);
    expect(s.seen("k1").react).toBeNull();
    to(1080); // a quarter-beat after, on her next quarter-beat
    expect(s.seen("k1")).toMatchObject({ react: { how: "crown", of: "k2" }, dir: 1, lift: 0 });
    expect(s.seen("k1").fidget).toBeNull(); // she faces it already
    expect(cell.dataset.react).toBe("crown");
    expect(cell.dataset.pose).toBe("make");
    expect(s.seen("k1")).toMatchObject({ pose: "make", want: "make", step: "work" });
    to(1080 + 1439);
    expect(cell.dataset.react).toBe("crown");
    to(1080 + 1440);
    expect(s.seen("k1").react).toBeNull();
    expect(cell.dataset.react).toBeUndefined();
    expect(cell.dataset.pose).toBe("make");
    // Herodotus, on Athena's other side, glanced at her; Nike gave her crown instead of a glance.
    const s2 = withNike();
    s2.set("k2", { look: "done" });
    expect(shows(s2, "k0", 1000)).toMatchObject({ how: "glance", of: "k2" });
  });

  it("she turns about for one behind her, whatever her pose; never crowns a failure, a stop, or her own finish", () => {
    // Nike between them, facing left: Athena on the right is behind her.
    const s = lane([["athena"], ["herodotus"], ["nike", "run"]]);
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    expect(s.seen("k2")).toMatchObject({ god: "nike", face: -1 });
    const cell = s.cell("k2")!;
    s.to("k2", 945);
    s.set("k0", { look: "done" });
    s.to("k2", 1080);
    expect(s.seen("k2")).toMatchObject({ react: { how: "crown", of: "k0" }, dir: 1 });
    expect(s.seen("k2").fidget).toMatchObject({ tx: "", turn: true });
    expect(cell.classList.contains("is-left")).toBe(false);
    expect(cell.dataset.react).toBe("crown");
    s.to("k2", 1080 + 1440);
    expect(s.seen("k2")).toMatchObject({ react: null, dir: -1 });
    expect(cell.classList.contains("is-left")).toBe(true);
    // A failure and a stop are noticed, if at all, as any god notices: never crowned.
    for (const look of ["fail", "stop"] as const) {
      const sad = withNike();
      sad.set("k2", { look });
      const seen = shows(sad, "k1", 2500);
      if (seen) expect(seen.how).toBe("glance");
      expect(sad.cell("k1")!.dataset.react).toBeUndefined();
    }
    // Her own finish: nobody crowns it, and she is not at her work to.
    const own = withNike();
    own.set("k1", { look: "done" });
    for (let ms = 0; ms < 2500; ms += 10) {
      own.host.advance(10);
      expect(own.peek().gods.every((god) => god.react?.how !== "crown")).toBe(true);
    }
  });

  it("the one who flies comes down for her crown as for a cut, her wings still, and rises after it; her wingbeat waits for its next bar, and begins it from rest", () => {
    const s = withNike("look", { fidget: true });
    const cell = s.cell("k1")!;
    const lift = (): number => Number(s.seen("k1").lift.toFixed(3));
    // Ten of her beats after she took her place, five of her bars: Athena is last to hers.
    const to = (ms: number): void => s.to("k1", 3600 + ms);
    to(2000);
    expect(lift()).toBeGreaterThanOrEqual(6); // riding on her wings
    s.set("k2", { look: "done" });
    // A quarter-beat after, and 180ms to come down: her crown begins on her quarter-beat at 2340.
    const start = 2340;
    to(start - 180);
    let last = lift();
    expect(last).toBeGreaterThanOrEqual(6);
    for (let ms = start - 170; ms < start; ms += 10) {
      to(ms);
      expect(lift()).toBeLessThan(last); // down, eased, from the height she had
      last = lift();
      expect(cell.dataset.frame).toBeUndefined(); // her wings as they were carved
      expect(s.seen("k1").react).toBeNull();
      expect(cell.dataset.react).toBeUndefined();
    }
    to(start);
    expect(s.seen("k1")).toMatchObject({
      react: { how: "crown", of: "k2" },
      lift: 0,
      pose: "look",
    });
    expect(cell.style.transform).toMatch(/px, 0, 0\)$/); // on the floor
    expect(cell.dataset.pose).toBe("look");
    to(start + 1439);
    expect(s.seen("k1")).toMatchObject({ react: { how: "crown", of: "k2" }, lift: 0 });
    // Her look cuts back in, and she rises over 240ms, to her lift.
    to(start + 1440);
    expect(s.seen("k1")).toMatchObject({ react: null, lift: 0 });
    to(start + 1440 + 120);
    expect(lift()).toBe(7);
    to(start + 1440 + 240);
    expect(lift()).toBe(8);
    // Her bars are 720ms from her cut: the crown ended at 3780, so her wings wait for 4320.
    for (let ms = start + 1440 + 250; ms < 4320; ms += 10) {
      to(ms);
      expect(cell.dataset.frame).toBeUndefined();
      expect(s.seen("k1").fidget).toBeNull();
      expect(lift()).toBe(8);
    }
    to(4320);
    expect(cell.dataset.frame).toBe("b"); // down
    expect(lift()).toBe(8); // from rest: she does not drop to 6 to rise again
    to(4320 + 180);
    expect(lift()).toBe(8);
    to(4320 + 360 + 150);
    expect(lift()).toBe(7); // and sinks as her wings come up, as ever
    to(4320 + 720 + 150);
    expect(lift()).toBe(7); // come round: rising from 6
    // Her card held its one height throughout, over her lift.
    const carded = withNike("look", { fidget: true });
    enter(carded.cell("k1"));
    carded.host.advance(100);
    const foot = carded.peek().card!.foot;
    expect(carded.peek().card).toEqual(placeOf(carded, "k1", CAST.gods.nike.card));
    carded.set("k2", { look: "done" });
    for (let ms = 0; ms < 2400; ms += 20) {
      carded.host.advance(20);
      expect(carded.peek().card).toMatchObject({ key: "k1", foot });
    }
  });

  it("with several Nikes at their work, the nearest who is free crowns; she may crown another Nike", () => {
    // Two Nikes and Athena between them: the nearer to Athena crowns her, and the other does not.
    const s = lane([["nike", "make"], ["nike", "make"], ["athena"]]);
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    const far = (key: string): number => Math.abs(s.seen(key).x - s.seen("k2").x);
    const [near, other] = far("k0") < far("k1") ? ["k0", "k1"] : ["k1", "k0"];
    s.to("k2", 500);
    s.set("k2", { look: "done" });
    const crowns: Record<string, boolean> = { k0: false, k1: false };
    for (let ms = 0; ms < 2500; ms += 10) {
      s.host.advance(10);
      for (const key of ["k0", "k1"]) crowns[key] ||= s.seen(key).react?.how === "crown";
    }
    expect(crowns).toEqual({ [near!]: true, [other!]: false });
    // Whichever was sent first: of four, left to right a Nike, Herodotus, Athena, a Nike.
    const four = (): Lane => lane([["nike", "make"], ["herodotus"], ["nike", "make"], ["athena"]]);
    const crowner = (ended: string): string[] => {
      const it = four();
      expect(it.order()).toEqual(["k2", "k1", "k3", "k0"]);
      it.host.advance(500);
      it.set(ended, { look: "done" });
      const who = new Set<string>();
      for (let ms = 0; ms < 2500; ms += 10) {
        it.host.advance(10);
        for (const god of it.peek().gods) if (god.react?.how === "crown") who.add(god.key);
      }
      return [...who];
    };
    expect(crowner("k3")).toEqual(["k0"]); // Athena: the Nike on her right, the first sent
    expect(crowner("k1")).toEqual(["k2"]); // Herodotus: the Nike on his left, sent after her
    // Two Nikes alone: one finishes, and the other crowns her.
    const two = lane([
      ["nike", "make"],
      ["nike", "make"],
    ]);
    two.host.advance(500);
    two.set("k1", { look: "done" });
    expect(shows(two, "k0", 1000)).toMatchObject({ how: "crown", of: "k1" });
  });

  it("a finish while the nearest Nike is crowning goes to the next who is free; two finishing together are crowned by two", () => {
    // Left to right: Athena, Herodotus, a Nike, a Nike.
    const four = (): Lane => {
      const s = lane([["nike", "make"], ["herodotus"], ["athena"], ["nike", "make"]]);
      expect(s.order().map((key) => s.seen(key).god)).toEqual([
        "athena",
        "herodotus",
        "nike",
        "nike",
      ]);
      return s;
    };
    const s = four();
    const [athena, herodotus, inner, outer] = s.order() as [string, string, string, string];
    s.host.advance(1000);
    s.set(herodotus, { look: "done" });
    s.host.advance(400);
    expect(s.seen(inner).react).toEqual({ how: "crown", of: herodotus });
    s.set(athena, { look: "done" }); // the nearer Nike is taken
    const crowned: Record<string, string> = {};
    for (let ms = 0; ms < 2500; ms += 10) {
      s.host.advance(10);
      for (const key of [inner, outer]) {
        const r = s.seen(key).react;
        if (r?.how === "crown") crowned[key] = r.of;
      }
    }
    expect(crowned).toEqual({ [inner]: herodotus, [outer]: athena });
    // Both in one look at the records: each gets a crown.
    const twice: Record<string, string> = {};
    const together = four();
    together.host.advance(1000);
    together.sync(
      together.order().map((key, i) => {
        const seen = together.seen(key);
        return agent(key, seen.god, i < 2 ? "done" : "run", i < 2 ? "look" : "make", 1);
      }),
    );
    for (let ms = 0; ms < 2500; ms += 10) {
      together.host.advance(10);
      for (const key of [inner, outer]) {
        const r = together.seen(key).react;
        if (r?.how === "crown") twice[key] = r.of;
      }
    }
    expect(Object.values(twice).sort()).toEqual([athena, herodotus].sort());
  });

  it("two finishing together with one Nike: she crowns the nearer", () => {
    // Nike on the right; Hermes far off on the left, Athena beside her.
    const s = lane([["nike", "make"], ["hermes"], ["athena"]]);
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    s.host.advance(1000);
    s.sync([
      agent("k0", "nike", "run", "make", 1),
      agent("k1", "hermes", "done", "look", 1), // the farther, and the first the floor hears of
      agent("k2", "athena", "done", "look", 1),
    ]);
    expect(shows(s, "k0", 1000)).toMatchObject({ how: "crown", of: "k2" });
  });

  it("a cut of the god's own already coming goes first: the notice begins after it has landed, in the pose it cut to", () => {
    const s = three();
    const cell = s.cell("k2")!;
    // Herodotus is handed a search: his cut to it falls on his beat once his look has had its dwell, at 1200.
    s.to("k2", 100);
    s.set("k2", { family: "web", tools: 2 });
    s.to("k2", 200);
    s.set("k1", { look: "done" });
    for (let ms = 200; ms < 1200; ms += 10) {
      s.to("k2", ms);
      expect(s.seen("k2").react).toBeNull(); // it waits for the cut
      expect(cell.dataset.pose).toBe("look");
    }
    s.to("k2", 1200);
    expect(cell.dataset.pose).toBe("web"); // the cut, when it was always going to fall
    expect(s.seen("k2").react).toBeNull();
    s.to("k2", 1349);
    expect(s.seen("k2").react).toBeNull();
    s.to("k2", 1350); // a quarter-beat after the cut
    expect(s.seen("k2")).toMatchObject({ react: { how: "glance", of: "k1" }, pose: "web" });
    s.to("k2", 1650);
    expect(posesOf(cell).style.transform).toBe(turnOf(CAST.gods.herodotus.nt.web!.front, 1.5));
    s.to("k2", 1350 + 1200);
    expect(s.seen("k2").react).toBeNull();
    // With no frame asked for but the lane's own, the clock wakes for its start: to the ms.
    const asleep = three();
    asleep.to("k2", 100);
    asleep.set("k2", { family: "web", tools: 2 });
    asleep.to("k2", 200);
    asleep.set("k1", { look: "done" });
    asleep.host.run(1149); // through the cut, and Hermes's line held out, still
    expect(asleep.cell("k2")!.dataset.pose).toBe("web");
    expect(asleep.cell("k2")!.dataset.react).toBeUndefined();
    const { frames } = asleep.drawn;
    asleep.host.run(1);
    expect(asleep.cell("k2")!.dataset.react).toBe("glance");
    expect(asleep.drawn.frames).toBeGreaterThan(frames); // a frame of its own, and the lean's after it
  });

  it("a cut landing ends a notice at once, and falls when it would have with nobody noticing", () => {
    const cutAt = (react: boolean): number => {
      const s = three({ react });
      const cell = s.cell("k2")!;
      s.to("k2", 1300);
      s.set("k1", { look: "done" }); // noticed from 1500, for two beats: until 2700
      s.to("k2", 1600);
      if (react) expect(s.seen("k2").react).toEqual({ how: "glance", of: "k1" });
      s.set("k2", { family: "web", tools: 2 });
      let at = 1600;
      while (cell.dataset.pose === "look") s.to("k2", ++at);
      expect(cell.dataset.pose).toBe("web");
      // The lean is gone with the pose it was in.
      expect(s.seen("k2").react).toBeNull();
      expect(cell.dataset.react).toBeUndefined();
      expect(posesOf(cell).style.transform).toBe("");
      s.to("k2", at + 600);
      expect(s.seen("k2").react).toBeNull(); // and it does not come back
      return at;
    };
    expect(cutAt(true)).toBe(1800);
    expect(cutAt(false)).toBe(1800);
  });

  it("a notice that cannot begin in time is dropped: its cut landed too late", () => {
    // Asked for less motion, a pose is held twice as long: the cut to his search falls at 2400.
    const s = three({ reduced: true });
    const face = s.seen("k2").face;
    const behind = s.order()[face < 0 ? 2 : 0]!;
    s.to("k2", 100);
    s.set("k2", { family: "web", tools: 2 });
    s.to("k2", 200);
    s.set(behind, { look: "done" });
    expect(shows(s, "k2", 6000)).toBeNull(); // 1.5s after the record, it is too late
    expect(s.cell("k2")!.dataset.pose).toBe("web");
    // With no cut in the way, he turned to face it.
    const free = three({ reduced: true });
    free.to("k2", 200);
    free.set(behind, { look: "done" });
    expect(shows(free, "k2", 6000)).toMatchObject({ how: "turn", of: behind });
  });

  it("leaving its work ends a notice at once: a step aside, or its own ending; and one not begun never plays", () => {
    // The lane narrows under them in the middle of a glance: he sets off for his new place, as he would have.
    const s = three();
    s.to("k2", 1000);
    s.set("k1", { look: "done" });
    s.to("k2", 1600);
    expect(s.seen("k2").react).toEqual({ how: "glance", of: "k1" });
    expect(posesOf(s.cell("k2")!).style.transform).not.toBe("");
    s.setWidth(460);
    s.resize();
    // He has left his work: he waits for Hermes's line to be furled, and then walks.
    expect(s.seen("k2")).toMatchObject({ react: null, step: "hold" });
    expect(s.cell("k2")!.dataset.react).toBeUndefined();
    expect(posesOf(s.cell("k2")!).style.transform).toBe("");
    until(s, () => s.seen("k2").step === "work");
    expect(shows(s, "k2", 3000)).toBeNull(); // back at his work, it does not come back
    // His own record ends in the middle of a turn: he is turned back, and stands for his farewell
    // (he waits his turn to say it: Athena's line is still out).
    const done = three();
    done.to("k2", 1000);
    done.set("k0", { look: "done" });
    done.to("k2", 1600);
    expect(done.seen("k2")).toMatchObject({ react: { how: "turn", of: "k0" }, dir: 1 });
    done.set("k2", { look: "done" });
    expect(done.seen("k2")).toMatchObject({ react: null, step: "hold", pose: "stand", dir: -1 });
    expect(done.cell("k2")!.dataset.react).toBeUndefined();
    // A notice that never began does not use up his rest: back at his work, he turns to the next.
    const again = three();
    again.to("k2", 1000);
    again.set("k1", { look: "done" }); // due at 1200
    again.to("k2", 1100);
    again.setWidth(460);
    again.resize(); // and he has left his work before it
    until(again, () => again.seen("k2").step === "work");
    expect(again.host.now() - again.at.k2!).toBeLessThan(8000);
    again.set("k0", { look: "done" });
    expect(shows(again, "k2", 1000)).toMatchObject({ how: "turn", of: "k0" });
    // Ended before his notice began: it never does.
    const early = three();
    early.to("k2", 1000);
    early.set("k1", { look: "done" });
    early.to("k2", 1100);
    early.set("k2", { look: "fail" });
    for (let ms = 1100; ms < 4000; ms += 20) {
      early.to("k2", ms);
      expect(early.seen("k2").react).toBeNull();
      expect(posesOf(early.cell("k2")!).style.transform).toBe("");
    }
  });

  it("only a god at its work notices, and only within reach; a god that noticed rests eight seconds before it notices again", () => {
    // Herodotus is still walking to his place when Hermes is done: he does not look up, then or later.
    const s = stage({ react: true });
    const agents = [agent("k0", "athena"), agent("k1", "hermes"), agent("k2", "herodotus")];
    s.sync(agents);
    until(s, () => s.peek().gods.length === 3 && out(s, "k1").step === "work");
    expect(out(s, "k2").step).not.toBe("work");
    s.sync([agents[0]!, { ...agents[1]!, look: "done" }, agents[2]!]);
    for (let ms = 0; ms < 8000; ms += 20) {
      s.host.advance(20);
      expect(s.peek().gods.every((god) => god.react === null)).toBe(true);
    }
    // Beyond his reach: Athena is done 329px away, with nobody between them.
    const far = lane([["athena"], ["herodotus"], ["hermes"]]);
    expect(far.order()).toEqual(["k1", "k2", "k0"]);
    far.set("k2", { look: "done" });
    until(far, () => far.peek().gods.length === 2);
    far.host.advance(9000); // and he has had his rest since he glanced at Hermes
    expect(far.seen("k1")).toMatchObject({ god: "herodotus", step: "work" });
    expect(far.seen("k0").x - far.seen("k1").x).toBeGreaterThan(200);
    far.set("k0", { look: "done" });
    expect(shows(far, "k1", 3000)).toBeNull();
    // His rest: he glanced at Hermes; Athena is done 7.9s after that glance began, and he does not turn.
    const rested = (ms: number): ReturnType<typeof shows> => {
      const it = three();
      it.to("k2", 1000);
      it.set("k1", { look: "done" });
      it.to("k2", 1200);
      expect(it.seen("k2").react).toEqual({ how: "glance", of: "k1" });
      it.to("k2", 1200 + ms);
      it.set("k0", { look: "done" });
      return shows(it, "k2", 2000);
    };
    expect(rested(7900)).toBeNull();
    expect(rested(8000)).toMatchObject({ how: "turn", of: "k0" });
  });

  it("puts nothing on the clock, wakes it never and throws no dice: the clock sleeps until a notice begins, through a turn, and while a lean is held", () => {
    function run(react: boolean, behind: boolean): { s: Lane; frames: number[] } {
      const s = three({ react });
      s.to("k2", 1000);
      s.set(behind ? "k0" : "k1", { look: "done" });
      // Its farewell unrolls for 650ms, with frames of its own; then it is held out, still, for
      // 1400. The frames drawn in each 50ms, as a window gives them: one that falls on a
      // moment is in the 50ms that ends there.
      const frames: number[] = [];
      for (let ms = 0; ms < 2000; ms += 50) {
        const { frames: was } = s.drawn;
        s.host.run(50, 16);
        frames.push(s.drawn.frames - was);
      }
      return { s, frames };
    }
    const count = (frames: number[], from: number, to: number): number =>
      frames.slice(from / 50, to / 50).reduce((sum, n) => sum + n, 0);
    // A turn, from 200 to 1400: one frame for its end, and not one more than with nobody noticing.
    const turn = run(true, true);
    const still = run(false, true);
    expect(count(still.frames, 650, 2000)).toBe(0);
    expect(count(turn.frames, 650, 1350)).toBe(0);
    expect(count(turn.frames, 1350, 1400)).toBe(1);
    expect(count(turn.frames, 1400, 2000)).toBe(0);
    expect(count(turn.frames, 0, 650)).toBe(count(still.frames, 0, 650)); // its start fell on a frame that ran anyway
    expect(turn.s.asked).toEqual(still.s.asked);
    // A glance, from 200: it eases in until 500, is held until 1100, and eases back until 1400.
    const glance = run(true, false);
    const calm = run(false, false);
    expect(count(calm.frames, 650, 2000)).toBe(0);
    expect(count(glance.frames, 650, 1050)).toBe(0);
    expect(count(glance.frames, 1050, 1400)).toBeGreaterThan(25); // frame by frame, as the window gives them
    expect(count(glance.frames, 1050, 1400)).toBeLessThan(40);
    expect(count(glance.frames, 1400, 2000)).toBe(0);
    expect(glance.s.asked).toEqual(calm.s.asked);
    expect(glance.s.asked.dice).toBeGreaterThan(0);
    // The floor at rest was not drawn again for any of it.
    expect(glance.s.bed.wipes).toBe(calm.s.bed.wipes);
    expect(glance.s.bed.filled).toBe(calm.s.bed.filled);
    expect(glance.s.fx.wipes).toBe(calm.s.fx.wipes);
  });

  it("its fidget rests from a notice's start until the first bar after it, and a glance leans in from wherever the fidget had the figure", () => {
    // The smith at his bellows, between the others: a bar of two beats of 560ms, leaning in and back.
    const s = lane([["athena"], ["hermes"], ["hephaestus", "run"]], { fidget: true });
    expect(s.order()).toEqual(["k1", "k2", "k0"]);
    const cell = s.cell("k2")!;
    const bellows = CAST.gods.hephaestus.fid.run!.moves[0]!.pivot!;
    const { front, lean } = CAST.gods.hephaestus.nt.run!;
    const face = s.seen("k2").face;
    const ahead = s.order()[face < 0 ? 0 : 2]!;
    expect(CAST.gods.hephaestus.chance.fail).toBe(0.98);
    // Into his fourth bar, the one in front of him fails; half a beat in, leant right over the bellows, he looks up.
    s.to("k2", 3430);
    s.set(ahead, { look: "fail" });
    const seen = shows(s, "k2", 210)!;
    expect(seen).toMatchObject({ how: "glance", of: ahead, to: Infinity });
    const start = 3430 + seen.from;
    expect(start).toBe(3640); // a quarter-beat after, on his quarter-beat
    const at = (ms: number): string => (s.to("k2", start + ms), posesOf(cell).style.transform);
    // As it begins, where the bellows had him, and no jump; then the one eases out as the other eases in.
    const turns = (tx: string): number[] =>
      [...tx.matchAll(/rotate\((-?[\d.]+)deg\)/g)].map((m) => Number(m[1]));
    const first = at(10);
    expect(first).toContain(`translate(${bellows[0]}px, ${bellows[1]}px)`);
    expect(turns(first)[0]).toBeGreaterThan(0.95); // all but a whole degree, as the bellows had him
    const half = at(140);
    expect(half).toContain(`translate(${front[0]}px, ${front[1]}px)`);
    expect(turns(half)).toEqual([0.5, lean / 2]); // half of the one, half of the other
    // Half a beat in, only the lean; and so it stays, the bellows at rest, for three beats in all.
    expect(at(280)).toBe(turnOf(front, lean));
    expect(at(1000)).toBe(turnOf(front, lean));
    expect(at(3 * 560)).toBe("");
    expect(s.seen("k2").react).toBeNull();
    // It ended 5320ms after his cut; his bars fall every 1120: he waits for the one at 5600.
    for (let ms = 5320; ms < 5600; ms += 20) {
      s.to("k2", ms);
      expect(posesOf(cell).style.transform).toBe("");
      expect(s.seen("k2").fidget).toBeNull();
    }
    s.to("k2", 5600 + 140);
    expect(posesOf(cell).style.transform).toBe(turnOf(bellows, 0.5)); // and leans in again, as ever
    // The hammer: no blow falls from the notice's start until the bar after it.
    const hammer = lane([["athena"], ["hermes"], ["hephaestus", "make"]], { fidget: true });
    const anvil = hammer.cell("k2")!;
    hammer.to("k2", 4000);
    hammer.set(ahead, { look: "fail" });
    const struck = shows(hammer, "k2", 200)!;
    expect(struck).toMatchObject({ how: "glance", of: ahead });
    const began = 4000 + struck.from;
    expect(began).toBe(4200);
    // His bars are 2240ms: the notice ends at 5880, in the bar that began at 4480: he waits for 6720.
    for (let ms = began + 20; ms < 6720; ms += 20) {
      hammer.to("k2", ms);
      expect(anvil.dataset.frame).toBeUndefined();
    }
    hammer.to("k2", 6720);
    expect(anvil.dataset.frame).toBe("b"); // down, as the bar begins
  });

  it("under reduced motion a notice is only a turn to face, and the crown a still, each a cut held twice as long; a lean shows nothing; the one who flies is simply down for her crown", () => {
    // Behind him: a turn, for four of his beats, not two.
    const s = three({ reduced: true });
    const cell = s.cell("k2")!;
    s.to("k2", 1000);
    s.set("k0", { look: "done" });
    s.to("k2", 1199);
    expect(s.seen("k2").react).toBeNull();
    s.to("k2", 1200);
    expect(s.seen("k2")).toMatchObject({ react: { how: "turn", of: "k0" }, dir: 1 });
    s.to("k2", 1200 + 2399);
    expect(s.seen("k2")).toMatchObject({ react: { how: "turn", of: "k0" }, dir: 1 });
    expect(cell.dataset.react).toBe("turn");
    s.to("k2", 1200 + 2400);
    expect(s.seen("k2")).toMatchObject({ react: null, dir: -1 });
    // In front of him: a glance is motion, so nothing shows.
    const front = three({ reduced: true });
    front.to("k2", 1000);
    front.set("k1", { look: "done" });
    for (let ms = 1000; ms < 4000; ms += 20) {
      front.to("k2", ms);
      expect(front.seen("k2").react).toBeNull();
      expect(posesOf(front.cell("k2")!).style.transform).toBe("");
      expect(front.cell("k2")!.dataset.react).toBeUndefined();
    }
    // The crown from the air: up, down for eight of her beats, and up, with nothing between.
    const air = withNike("look", { reduced: true, fidget: true });
    expect(air.seen("k1")).toMatchObject({ lift: 8, fidget: null });
    air.host.advance(945 - ((air.host.now() - air.at.k1!) % 90)); // half way between two of her quarter-beats
    const t = air.host.now() - air.at.k1!;
    air.set("k2", { look: "done" });
    const begins = t + 135; // no time to come down: a quarter-beat after, on her quarter-beat
    const { frames } = air.drawn;
    const lifts = new Set<number>();
    for (let ms = t; ms < begins + 2880 + 400; ms += 5) {
      air.to("k1", ms);
      const seen = air.seen("k1");
      lifts.add(seen.lift);
      const crowning = ms >= begins && ms < begins + 2880;
      expect(seen.react).toEqual(crowning ? { how: "crown", of: "k2" } : null);
      expect(seen.lift).toBe(crowning ? 0 : 8);
      expect(air.cell("k1")!.dataset.frame).toBeUndefined();
    }
    expect([...lifts].sort()).toEqual([0, 8]);
    expect(air.cell("k1")!.style.transform).toMatch(/px, -8px, 0\)$/);
    void frames;
  });

  it("reduced motion asked for in the middle of a reaction: a lean is a cut to rest at the next frame drawn, and a turn is held to twice its beats", () => {
    // While the lean eases, frames are running: the very next one.
    const s = three();
    const cell = s.cell("k2")!;
    s.to("k2", 1000);
    s.set("k1", { look: "done" });
    s.to("k2", 1300);
    expect(posesOf(cell).style.transform).not.toBe("");
    s.quiet(true);
    s.host.advance(16);
    expect(posesOf(cell).style.transform).toBe("");
    expect(s.seen("k2").react).toBeNull();
    expect(cell.dataset.react).toBeUndefined();
    // A turn under way is held twice as long, from when it began.
    const turn = three();
    turn.to("k2", 1000);
    turn.set("k0", { look: "done" });
    turn.to("k2", 1500);
    expect(turn.seen("k2").react).toEqual({ how: "turn", of: "k0" });
    turn.quiet(true);
    turn.to("k2", 1200 + 2399);
    expect(turn.seen("k2")).toMatchObject({ react: { how: "turn", of: "k0" }, dir: 1 });
    turn.to("k2", 1200 + 2400);
    expect(turn.seen("k2")).toMatchObject({ react: null, dir: -1 });
    // And asked for no longer, one held past its own beats ends at the next frame drawn.
    const back = three({ reduced: true });
    back.to("k2", 1000);
    back.set("k0", { look: "done" });
    back.to("k2", 1200 + 1500);
    expect(back.seen("k2").react).toEqual({ how: "turn", of: "k0" });
    back.quiet(false);
    back.host.advance(16);
    expect(back.seen("k2")).toMatchObject({ react: null, dir: -1 });
  });

  it("an ending falls when it would have with nobody crowning: she holds her crown while she comes down, and then says her farewell", () => {
    function run(react: boolean): { steps: string[]; crowned: number[]; lifts: number[] } {
      const s = withNike("look", { react });
      const cell = s.cell("k1")!;
      const to = (ms: number): void => s.to("k1", 3600 + ms);
      to(2000);
      s.set("k2", { look: "done" }); // her crown, from 2340
      to(2700);
      s.set("k1", { look: "done" }); // and her own record ends in the middle of it
      const steps: string[] = [];
      const crowned: number[] = [];
      const lifts: number[] = [];
      for (let ms = 2700; ms < 3200; ms += 10) {
        to(ms);
        steps.push(s.seen("k1").step);
        if (cell.dataset.react === "crown") crowned.push(ms);
        lifts.push(Number(s.seen("k1").lift.toFixed(2)));
        expect(cell.dataset.pose).toBe(s.seen("k1").step === "alight" ? "look" : "speak");
      }
      return { steps, crowned, lifts };
    }
    const on = run(true);
    const off = run(false);
    // With nobody crowning she was aloft, and took 180ms to come down before her farewell: so she does here.
    expect(off.steps.slice(0, 18).every((step) => step === "alight")).toBe(true);
    expect(off.steps[18]).toBe("report");
    expect(on.steps).toEqual(off.steps);
    expect(off.lifts[0]).toBe(8);
    expect(off.crowned).toEqual([]);
    // On the floor already, she holds the crown for those 180ms, and no longer.
    expect(on.lifts.every((lift) => lift === 0)).toBe(true);
    expect(on.crowned).toEqual(Array.from({ length: 18 }, (_, i) => 2700 + 10 * i));
  });

  it("with its reactions off a lane is built and held as it was: no crown's picture, and nobody notices anything", () => {
    const s = lane([["herodotus"], ["nike", "make"], ["athena"]], { react: false });
    expect(s.lane.querySelectorAll(".oly-p-crown")).toHaveLength(0);
    s.set("k2", { look: "done" });
    for (let ms = 0; ms < 3000; ms += 20) {
      s.host.advance(20);
      expect(s.peek().gods.every((god) => god.react === null)).toBe(true);
      expect(s.lane.querySelector("[data-react]")).toBeNull();
    }
    // On, only the god that gives a crown has its picture.
    const on = lane([["herodotus"], ["nike", "make"], ["athena"]]);
    expect(on.lane.querySelectorAll(".oly-p-crown")).toHaveLength(1);
    expect(on.cell("k1")!.querySelectorAll(".oly-p-crown")).toHaveLength(1);
  });

  it("the card and the keys over reacting gods put nothing on the clock, wake it never, and throw no dice", () => {
    function run(look: boolean): { asked: { clock: number; dice: number }; peeks: string } {
      const s = withNike("look", { fidget: true });
      const peeks: string[] = [];
      for (let ms = 0; ms < 7000; ms += 100) {
        if (ms === 500) s.set("k2", { look: "done" });
        if (look) {
          const cells = s.cells();
          if (ms % 600 === 0) enter(cells[(ms / 600) % cells.length]);
          if (ms % 600 === 300) leave(cells[((ms - 300) / 600) % cells.length]);
          if (ms % 1000 === 500) keydown(document.body, "Tab");
          if (ms % 1000 === 700) keydown(cells[0]!, "ArrowRight");
          if (ms === 4000) keydown(document.body, "Escape");
        }
        s.host.run(100);
        const { card: _card, ...rest } = s.peek();
        peeks.push(JSON.stringify(rest));
      }
      return { asked: { ...s.asked }, peeks: peeks.join("\n") };
    }
    const alone = run(false);
    const looked = run(true);
    expect(looked.asked).toEqual(alone.asked);
    expect(looked.peeks).toBe(alone.peeks);
    expect(alone.peeks).toMatch(/"how":"crown"/);
    expect(alone.peeks).toMatch(/"how":"glance"/);
  });

  interface Ran {
    readonly peeks: FloorPeek[];
    readonly looks: { page: HTMLElement; height: string }[];
    readonly asked: { clock: number; dice: number };
    readonly cards: (string | null)[];
  }

  /**
   * A run of records, their gods alive at their work, looked at every 250ms,
   * with the frames between as a window gives them, and the pointer on one
   * god after another.
   */
  function ran(records: (ms: number) => LaneAgent[], react: boolean, reduced = false): Ran {
    const s = stage({ seed: 5, fidget: true, react, reduced });
    const peeks: FloorPeek[] = [];
    const looks: Ran["looks"] = [];
    for (let ms = 0; ms <= 32_000; ms += 250) {
      s.sync(records(ms));
      const cells = s.cells();
      if (cells.length) enter(cells[(ms / 250) % cells.length]);
      peeks.push(s.peek());
      looks.push({ page: s.lane.cloneNode(true) as HTMLElement, height: s.lane.style.height });
      s.host.run(250, 16);
    }
    const run: Ran = { peeks, looks, asked: { ...s.asked }, cards: [...s.cards] };
    s.dispose();
    return run;
  }

  /** The mockup's run and its three extras: six gods, a failure, a crowd. */
  const crowdRun = (ms: number): LaneAgent[] => laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]);
  /** Five through a tool of every family, three seconds a tool; then one is done and one fails. */
  const FIVE: readonly GodId[] = ["nike", "hermes", "themis", "argus", "hephaestus"];
  const FAMILIES: readonly ToolFamily[] = ["look", "run", "make", "web", "think"];
  const fiveRun = (ms: number): LaneAgent[] =>
    FIVE.map((god, i) => {
      const tools = Math.max(0, Math.floor((ms - 300 * i) / 3000));
      const look = i === 1 && ms >= 21_000 ? "done" : i === 3 && ms >= 24_000 ? "fail" : "run";
      return agent(god, god, look, tools ? FAMILIES[(tools + i) % 5]! : "think", tools);
    });
  /**
   * A run of notices: three at their work, Nike aloft among them, each holding
   * its tool; one fails, one is handed another tool, one finishes, one is
   * stopped, and two more are sent.
   */
  const noticesRun = (ms: number): LaneAgent[] => [
    agent("a", "athena", ms >= 19_000 ? "done" : "run", "look", 1),
    agent("b", "nike", ms >= 28_000 ? "stop" : "run", "look", 1),
    agent("c", "herodotus", "run", ms >= 16_000 ? "web" : "look", ms >= 16_000 ? 2 : 1),
    ...(ms >= 3000 ? [agent("d", "hermes", ms >= 13_000 ? "fail" : "run", "look", 1)] : []),
    ...(ms >= 21_000 ? [agent("e", "argus", "run", "look", 1)] : []),
    ...(ms >= 23_000 ? [agent("f", "themis", ms >= 30_000 ? "done" : "run", "think", 0)] : []),
  ];

  /**
   * Whether a reaction has a god in hand at a look: it shows one then, or did
   * within the three seconds before, while its fidget may still be resting
   * for it; or it is about to, the one who flies already coming down.
   */
  function touched(on: readonly FloorPeek[], i: number, key: string): boolean {
    for (let j = Math.max(0, i - 12); j <= Math.min(on.length - 1, i + 1); j++)
      if (on[j]!.gods.some((god) => god.key === key && god.react)) return true;
    return false;
  }

  /**
   * A look at the lane with what only a reaction writes taken off: the
   * reaction itself; of a god one has in hand, its facing and its fidget; and
   * the height of the one who flies, who comes down for her crown.
   */
  function plain(peek: FloorPeek, on: readonly FloorPeek[], i: number): unknown {
    return {
      ...peek,
      gods: peek.gods.map((god) => {
        const { react: _react, ...rest } = god;
        const held = touched(on, i, god.key);
        return {
          ...rest,
          fidget: held ? null : god.fidget,
          dir: held ? 0 : god.dir,
          figure: held ? null : god.figure,
          lift: CAST.gods[god.god].lift[god.pose as Skill] ? "aloft" : god.lift,
        };
      }),
    };
  }

  /** The page at a look, with the same taken off, and the crown's picture a reacting lane is built with. */
  function sheet(run: Ran, on: readonly FloorPeek[], i: number): string {
    const lane = run.looks[i]!.page.cloneNode(true) as HTMLElement;
    for (const crown of lane.querySelectorAll(".oly-p-crown")) crown.remove();
    [...lane.querySelectorAll<HTMLElement>(".oly-cell")].forEach((cell, n) => {
      const { god, pose } = cell.dataset as { god: GodId; pose: Skill };
      delete cell.dataset.react;
      if (touched(on, i, run.peeks[i]!.gods[n]!.key)) {
        delete cell.dataset.frame;
        delete cell.dataset.part;
        cell.classList.remove("is-left");
        cell.querySelector(".oly-poses")!.removeAttribute("style");
        for (const part of cell.querySelectorAll<HTMLElement>(".oly-part"))
          part.style.transform = "";
      }
      if (CAST.gods[god].lift[pose])
        cell.style.transform = cell.style.transform.replace(/, [^,]+, 0\)$/, ", 0, 0)");
    });
    return `${run.looks[i]!.height} ${lane.innerHTML}`.replace(/ style=""/g, "");
  }

  it.each([
    ["the crowd's run", crowdRun],
    ["five through every family of tool", fiveRun],
    ["a run of notices", noticesRun],
  ] as const)(
    "the same seeded run plays the same with reactions on and off: every step, cut, place, line, card and throw of the dice; only the reaction differs (%s)",
    (name, records) => {
      const off = ran(records, false);
      const on = ran(records, true);
      // The run with reactions on did react.
      const hows = on.peeks.flatMap((peek) => peek.gods.flatMap((god) => god.react?.how ?? []));
      expect(off.peeks.every((peek) => peek.gods.every((god) => god.react === null))).toBe(true);
      expect(off.looks.every(({ page }) => !page.querySelector("[data-react], .oly-p-crown"))).toBe(
        true,
      );
      expect(new Set(hows).size).toBeGreaterThan(0);
      if (name === "a run of notices")
        expect([...new Set(hows)].sort()).toEqual(["crown", "glance", "turn"]);
      if (name !== "the crowd's run") expect(hows).toContain("crown");
      expect(on.looks.some(({ page }) => page.querySelector("[data-react]"))).toBe(true);
      // And everything else is the same, look for look: what the floor holds, and the page.
      on.peeks.forEach((peek, i) => {
        expect(JSON.stringify(plain(peek, on.peeks, i))).toBe(
          JSON.stringify(plain(off.peeks[i]!, on.peeks, i)),
        );
        expect(sheet(on, on.peeks, i)).toBe(sheet(off, on.peeks, i));
      });
      // A god no reaction has in hand is compared whole, its fidget and its facing too: most of them, most of the time.
      const all = on.peeks.flatMap((peek, i) =>
        peek.gods.map((god) => touched(on.peeks, i, god.key)),
      );
      expect(all.filter((held) => !held).length).toBeGreaterThan(all.length / 2);
      expect(on.peeks.flatMap((peek) => peek.gods).some((god) => god.fidget)).toBe(true);
      expect(on.cards).toEqual(off.cards);
      expect(on.cards.length).toBeGreaterThan(20);
      // Not a step, a wake or a throw of the floor's dice more.
      expect(on.asked).toEqual(off.asked);
      expect(on.asked.dice).toBeGreaterThan(10);
    },
  );

  it("under reduced motion the same runs play the same with reactions on and off, but for a turn or a crown held as a still", () => {
    const seen = new Set<string>();
    for (const records of [crowdRun, fiveRun, noticesRun]) {
      const off = ran(records, false, true);
      const on = ran(records, true, true);
      for (const peek of on.peeks)
        for (const god of peek.gods) if (god.react) seen.add(god.react.how);
      on.peeks.forEach((peek, i) => {
        expect(JSON.stringify(plain(peek, on.peeks, i))).toBe(
          JSON.stringify(plain(off.peeks[i]!, on.peeks, i)),
        );
        expect(sheet(on, on.peeks, i)).toBe(sheet(off, on.peeks, i));
        // Nothing eases: no figure is ever leant, no frame flipped, no part moved.
        for (const god of peek.gods)
          if (god.fidget)
            expect(god.fidget).toEqual({
              ...god.fidget,
              tx: "",
              frame: "",
              part: "",
              ptx: "",
              turn: true,
            });
      });
      expect(on.asked).toEqual(off.asked);
      expect(on.cards).toEqual(off.cards);
    }
    expect([...seen].sort()).toEqual(["crown", "turn"]);
  });
});

describe("startles: the reader presses a god at its work", () => {
  type Opts = Parameters<typeof stage>[0];
  type Spec = readonly [god: GodId, family?: ToolFamily];
  const posesOf = (cell: HTMLElement): HTMLElement =>
    cell.querySelector<HTMLElement>(".oly-poses")!;
  const hopOf = (cell: HTMLElement): string => posesOf(cell).style.transform;
  const up = (px: number): string => `translate(0.00px, ${(-px).toFixed(2)}px)`;
  /** A click, as the reader's: the frame that follows it is drawn. */
  function click(s: Stage, el: Element | undefined): void {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    s.host.advance(0);
  }

  interface Lane extends Stage {
    /** When each god took its place: its beats count from then. */
    readonly at: Readonly<Record<string, number>>;
    /** Change one agent's record, and hand them all over. */
    set(key: string, change: Partial<LaneAgent>): void;
    seen(key: string): Seen;
    /** On to so long after `key` took its place. */
    to(key: string, ms: number): void;
    /** How long after `key` took its place it is now. */
    since(key: string): number;
  }

  /**
   * Gods sent together, k0, k1 and so on, each at its work in the pose it
   * acts a family of tool in (its look, unless told), on a lane where a press
   * startles. Of three sent together, the first is on the right, the second
   * on the left and the third in the middle.
   */
  function lane(specs: readonly Spec[], opts: Opts = {}): Lane {
    const s = stage({ startle: true, ...opts });
    let agents = specs.map(([god, family = "look"], i) => agent(`k${i}`, god, "run", family, 1));
    s.sync(agents);
    const at: Record<string, number> = {};
    for (let ms = 0; ; ms++) {
      const { gods } = s.peek();
      for (const god of gods) if (god.step === "work") at[god.key] ??= s.host.now();
      if (gods.length === specs.length && gods.every((god) => god.step === "work")) break;
      if (ms > 60_000) throw new Error("they never came to their work");
      s.host.advance(1);
    }
    return Object.assign(s, {
      at,
      set(key: string, change: Partial<LaneAgent>): void {
        agents = agents.map((a) => (a.key === key ? { ...a, ...change } : a));
        s.sync(agents);
      },
      seen: (key: string): Seen => out(s, key),
      to(key: string, ms: number): void {
        const on = at[key]! + ms - s.host.now();
        if (on < 0) throw new Error(`${key} took its place more than ${ms}ms ago`);
        s.host.advance(on);
      },
      since: (key: string): number => s.host.now() - at[key]!,
    });
  }

  /** The clock moved on a ms at a time: from when to when `key` next shows a start, counted from now. */
  function starts(
    s: Lane,
    key: string,
    within = 4000,
  ): { from: number; to: number; small: boolean } | null {
    let found: { from: number; small: boolean } | null = null;
    for (let ms = 0; ms <= within; ms++) {
      const start = s.peek().gods.find((god) => god.key === key)?.start ?? null;
      if (start && !found) found = { from: ms, ...start };
      if (!start && found) return { ...found, to: ms };
      s.host.advance(1);
    }
    return found && { ...found, to: Infinity };
  }

  it("a click on a god at its work startles it: on its own quarter-beat at or after the press, a cut to its start picture and a hop of its nature's height, the whole figure easing back to the floor over half a beat; held for its beats; then a cut back, and data-pose is the record's throughout", () => {
    // Hermes, the restless: a hop of 4px, five of his beats of 300ms.
    const s = lane([["hermes"]]);
    const cell = s.cell("k0")!;
    expect(CAST.gods.hermes.st).toMatchObject({ hop: 4, beats: 5 });
    // Built with him: his start's picture, sat in his cell as a skill pose is.
    const picture = cell.querySelector<HTMLImageElement>(".oly-pose.oly-p-start")!;
    expect(picture.getAttribute("src")).toBe(START_URLS.hermes);
    expect(picture.style.left).toBe("-2px");
    expect(picture.style.width).toBe("65px");
    expect(cell.querySelectorAll(".oly-p-start")).toHaveLength(1);
    // Pressed 10ms after a quarter-beat: he starts on the next, 65ms on.
    s.to("k0", 1210);
    const place = cell.style.transform;
    click(s, cell);
    expect(s.seen("k0").start).toBeNull();
    expect(cell.dataset.react).toBeUndefined();
    s.to("k0", 1274);
    expect(s.seen("k0").start).toBeNull();
    s.to("k0", 1275);
    expect(s.seen("k0")).toMatchObject({ start: { small: false }, pose: "look", step: "work" });
    expect(cell.dataset.react).toBe("start");
    expect(cell.dataset.pose).toBe("look");
    expect(hopOf(cell)).toBe(up(4));
    // The whole figure eases back down over half a beat: the cell itself never moves.
    s.to("k0", 1275 + 75);
    expect(hopOf(cell)).toBe(up(2));
    expect(cell.style.transform).toBe(place);
    let last = 2;
    for (let ms = 80; ms < 150; ms += 10) {
      s.to("k0", 1275 + ms);
      const now = -Number(/, (-?[\d.]+)px\)$/.exec(hopOf(cell))![1]);
      expect(now).toBeLessThan(last);
      last = now;
    }
    s.to("k0", 1275 + 150);
    expect(hopOf(cell)).toBe("");
    // Held, on the floor, for the rest of his five beats; then his look again.
    for (let ms = 150; ms < 1500; ms += 50) {
      s.to("k0", 1275 + ms);
      expect(cell.dataset.react).toBe("start");
      expect(cell.dataset.pose).toBe("look");
      expect(hopOf(cell)).toBe("");
      expect(s.seen("k0")).toMatchObject({ pose: "look", want: "look", react: null, fidget: null });
    }
    s.to("k0", 1275 + 1499);
    expect(cell.dataset.react).toBe("start");
    s.to("k0", 1275 + 1500);
    expect(cell.dataset.react).toBeUndefined();
    expect(s.seen("k0")).toMatchObject({ start: null, pose: "look", step: "work" });
    expect(cell.style.transform).toBe(place);
  });

  it.each(ALL)(
    "%s starts in its own way: its hop and its beats are its nature's, and its picture sits where the cast data says",
    (god) => {
      const s = lane([[god, "think"]]);
      const cell = s.cell("k0")!;
      const { hop, beats, at } = CAST.gods[god].st;
      const step = CAST.gods[god].step;
      const picture = cell.querySelector<HTMLImageElement>(".oly-pose.oly-p-start")!;
      expect(picture.getAttribute("src")).toBe(START_URLS[god]);
      expect(picture.style.left).toBe(`${at[0]}px`);
      expect(picture.style.width).toBe(`${at[1]}px`);
      const pose = cell.dataset.pose;
      s.to("k0", 4 * step); // on a beat: it starts at once
      click(s, cell);
      expect(cell.dataset.react).toBe("start");
      expect(hopOf(cell)).toBe(up(hop));
      s.to("k0", 4 * step + beats * step - 1);
      expect(cell.dataset.react).toBe("start");
      expect(hopOf(cell)).toBe("");
      expect(cell.dataset.pose).toBe(pose);
      s.to("k0", 4 * step + beats * step);
      expect(cell.dataset.react).toBeUndefined();
    },
  );

  it("Enter or Space on the god with focus startles it as a click does: the key is taken, and a key held down is one press", () => {
    const s = lane([["hermes"], ["athena"]]);
    keydown(document.body, "Tab");
    const [hermes, athena] = [s.cell("k0")!, s.cell("k1")!];
    hermes.focus();
    s.to("k1", 1040); // on a quarter-beat of hers
    const woken = s.woken.times;
    expect(keydown(hermes, "Enter").defaultPrevented).toBe(true);
    expect(s.woken.times).toBe(woken + 1);
    // Held: its repeats are taken too, and are no press.
    for (let i = 0; i < 5; i++)
      expect(keydown(hermes, "Enter", { repeat: true }).defaultPrevented).toBe(true);
    expect(s.woken.times).toBe(woken + 1);
    const began = starts(s, "k0", 200)!;
    expect(began).toMatchObject({ small: false });
    expect(began.from).toBeLessThanOrEqual(75);
    expect(hermes.dataset.react).toBe("start");
    athena.focus();
    expect(keydown(athena, " ").defaultPrevented).toBe(true);
    expect(s.woken.times).toBe(woken + 2);
    expect(starts(s, "k1", 200)).toMatchObject({ small: false });
    expect(athena.dataset.react).toBe("start");
    // With Alt, Ctrl or Cmd the key is not the lane's.
    const other = lane([["hermes"]]);
    other.cell("k0")!.focus();
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }])
      expect(keydown(other.cell("k0")!, "Enter", init).defaultPrevented).toBe(false);
    other.host.advance(500);
    expect(other.seen("k0").start).toBeNull();
    expect(other.woken.times).toBe(0);
  });

  it("only a god at its work has something to press, and says so: being set, greeting, walking, saying its farewell, sealed or going, a press starts nothing", () => {
    const s = stage({ startle: true, seed: 3 });
    s.sync([agent("a", "hermes", "run", "look", 1)]);
    const steps = new Set<string>();
    const pressed = new Set<string>();
    for (let ms = 0; ms < 20_000; ms += 10) {
      if (ms === 9000) s.sync([agent("a", "hermes", "done", "look", 1)]);
      const cell = s.cell("a");
      const god = s.peek().gods[0];
      if (cell && god) {
        steps.add(god.step);
        const can = god.step === "work" && !god.ending;
        expect(cell.classList.contains("is-startable")).toBe(can);
        expect(cell.getAttribute("aria-disabled")).toBe(can ? null : "true");
        expect(cell.getAttribute("role")).toBe("button");
        // Pressed in every step but its work: never a start.
        if (!can && ms % 50 === 0) {
          cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          keydown(cell, "Enter");
          pressed.add(god.step);
        }
        expect(god.start).toBeNull();
        expect(cell.dataset.react).toBeUndefined();
      }
      s.host.advance(10);
    }
    expect([...steps].sort()).toEqual(
      ["assemble", "greet", "report", "seal", "unset", "walk", "work"].sort(),
    );
    expect([...pressed].sort()).toEqual(
      ["assemble", "greet", "report", "seal", "unset", "walk"].sort(),
    );
    expect(s.peek().gods).toHaveLength(0);
    // And a press on its carved name is no press on the god: the name only holds its card up.
    const named = lane([["hermes"]]);
    const woken = named.woken.times;
    click(named, named.label("k0"));
    named.host.advance(500);
    expect(named.seen("k0").start).toBeNull();
    expect(named.woken.times).toBe(woken);
  });

  it("startled again within six seconds of its last start, it starts smaller: no hop, two beats; after that, in full again; and a press on a god already starting does nothing more", () => {
    const s = lane([["hermes"]]);
    const cell = s.cell("k0")!;
    expect(CAST.startle).toEqual({ down: 0.5, again: 6000, againBeats: 2, line: 3 });
    s.to("k0", 1200);
    click(s, cell);
    expect(s.seen("k0").start).toEqual({ small: false });
    expect(hopOf(cell)).toBe(up(4));
    // Pressed again in the middle of it: it is neither begun again nor made longer.
    s.to("k0", 1200 + 60);
    const hop = hopOf(cell);
    click(s, cell);
    expect(hopOf(cell)).toBe(hop);
    s.to("k0", 1200 + 900);
    click(s, cell);
    s.to("k0", 1200 + 1499);
    expect(s.seen("k0").start).toEqual({ small: false });
    s.to("k0", 2700);
    expect(s.seen("k0").start).toBeNull();
    // Begun 5925ms after it ended: smaller. No hop, and two of his beats.
    s.to("k0", 2700 + 5925 - 50);
    click(s, cell); // 50ms before his quarter-beat
    s.to("k0", 2700 + 5925 - 1);
    expect(s.seen("k0").start).toBeNull();
    s.to("k0", 8625);
    expect(s.seen("k0").start).toEqual({ small: true });
    expect(cell.dataset.react).toBe("start");
    expect(hopOf(cell)).toBe("");
    s.to("k0", 8625 + 599);
    expect(cell.dataset.react).toBe("start");
    expect(hopOf(cell)).toBe("");
    s.to("k0", 8625 + 600);
    expect(cell.dataset.react).toBeUndefined();
    // Begun six seconds to the ms after that one ended: in full again.
    s.to("k0", 9225 + 6000);
    click(s, cell);
    expect(s.seen("k0").start).toEqual({ small: false });
    expect(hopOf(cell)).toBe(up(4));
    s.to("k0", 15_225 + 1500);
    expect(s.seen("k0").start).toBeNull();
    // And a quarter-beat short of six seconds: smaller.
    s.to("k0", 16_725 + 5925 - 74);
    click(s, cell);
    s.to("k0", 16_725 + 5925);
    expect(s.seen("k0").start).toEqual({ small: true });
  });

  it("a cut of its own ends it at once, and falls when it would have with nobody pressing; one that lands before it has begun drops it; and pressed again after, it starts", () => {
    /** Hermes handed a run 400ms after he took his place: when his cut to it lands. */
    function cutAt(pressAt: number | null): { s: Lane; cut: number } {
      const s = lane([["hermes"]]);
      s.to("k0", 400);
      s.set("k0", { family: "run", tools: 2 });
      let cut = -1;
      for (let ms = 400; ms < 4000 && cut < 0; ms += 5) {
        s.to("k0", ms);
        if (ms === pressAt) click(s, s.cell("k0"));
        if (s.cell("k0")!.dataset.pose === "run") cut = ms;
      }
      return { s, cut };
    }
    const alone = cutAt(null);
    expect(alone.cut).toBe(900); // his look has had its dwell, on his beat
    // Pressed 400ms before the cut: his start is under way when it lands, and ends there.
    const s = lane([["hermes"]]);
    const cell = s.cell("k0")!;
    s.to("k0", 400);
    s.set("k0", { family: "run", tools: 2 });
    s.to("k0", alone.cut - 400);
    click(s, cell);
    s.to("k0", alone.cut - 1);
    expect(cell.dataset.react).toBe("start");
    expect(cell.dataset.pose).toBe("look");
    expect(s.seen("k0").start).toEqual({ small: false });
    s.to("k0", alone.cut);
    expect(cell.dataset.react).toBeUndefined();
    expect(cell.dataset.pose).toBe("run");
    expect(s.seen("k0")).toMatchObject({ start: null, pose: "run" });
    // It doesn't come back: its five beats would have run 1100ms more.
    for (let ms = 10; ms < 1200; ms += 10) {
      s.to("k0", alone.cut + ms);
      expect(cell.dataset.react).toBeUndefined();
    }
    // Pressed after the cut ended it, he starts again, at once, and smaller: it was just now.
    click(s, cell);
    expect(s.seen("k0").start).toBeNull();
    expect(starts(s, "k0", 100)).toMatchObject({ small: true });
    // The cut fell when it would have, to the ms, whenever he was pressed.
    for (const before of [400, 150, 10, 5]) expect(cutAt(alone.cut - before).cut).toBe(alone.cut);
    // Pressed 10ms before the cut: his start would begin on the beat the cut lands on. It never does.
    const late = cutAt(alone.cut - 10);
    for (let ms = 0; ms < 2000; ms += 5) {
      late.s.to("k0", alone.cut + ms);
      expect(late.s.seen("k0").start).toBeNull();
      expect(late.s.cell("k0")!.dataset.react).toBeUndefined();
    }
    // And a start that never began is not his last: pressed again, he starts in full.
    click(late.s, late.s.cell("k0"));
    expect(starts(late.s, "k0", 100)).toMatchObject({ small: false });
  });

  it("its ending, or a step aside, ends it at once; and neither waits for it", () => {
    // Done in the middle of a start: at once his look is gone with it, and he says his farewell.
    const done = lane([["hermes"]]);
    done.to("k0", 1200);
    click(done, done.cell("k0"));
    done.to("k0", 1500);
    expect(done.cell("k0")!.dataset.react).toBe("start");
    done.set("k0", { look: "done" });
    expect(done.cell("k0")!.dataset.react).toBeUndefined();
    expect(done.seen("k0")).toMatchObject({ start: null, step: "report", pose: "speak" });
    for (let ms = 0; ms < 3000; ms += 10) {
      done.host.advance(10);
      expect(done.lane.querySelector("[data-react]")).toBeNull();
    }
    // Failed, the same; and it dims as it would have.
    const failed = lane([["athena"]]);
    failed.to("k0", 1040);
    click(failed, failed.cell("k0"));
    failed.to("k0", 1300);
    expect(failed.seen("k0").start).toEqual({ small: false });
    failed.set("k0", { look: "fail" });
    expect(failed.seen("k0")).toMatchObject({ start: null, step: "fail", pose: "stand" });
    expect(failed.cell("k0")!.dataset.react).toBeUndefined();
    // Asked to step aside in the middle of one: it stands at once, and walks.
    const aside = lane([["hermes"]]);
    aside.to("k0", 1200);
    click(aside, aside.cell("k0"));
    aside.to("k0", 1500);
    expect(aside.seen("k0").start).toEqual({ small: false });
    aside.setWidth(Math.round(aside.peek().gods[0]!.place![1] + 16 - 60));
    aside.resize();
    expect(aside.seen("k0")).toMatchObject({ start: null, step: "walk" });
    expect(aside.cell("k0")!.dataset.react).toBeUndefined();
    expect(posesOf(aside.cell("k0")!).style.transform).toBe("");
    // It is over for good: back at his work inside its five beats, he is at his look, and stays so.
    const walked = aside.host.now();
    until(aside, () => aside.seen("k0").step === "work");
    expect(aside.host.now() - walked).toBeLessThan(1000);
    for (let ms = 0; ms < 2000; ms += 10) {
      expect(aside.seen("k0").start).toBeNull();
      expect(aside.cell("k0")!.dataset.react).toBeUndefined();
      aside.host.advance(10);
    }
    // Pressed, and done before the start has begun: it never plays.
    const never = lane([["athena"]]);
    never.to("k0", 1050); // 120ms before her quarter-beat
    click(never, never.cell("k0"));
    never.to("k0", 1100);
    never.set("k0", { look: "done" });
    for (let ms = 0; ms < 3000; ms += 10) {
      never.host.advance(10);
      expect(never.peek().gods.every((god) => god.start === null)).toBe(true);
      expect(never.lane.querySelector("[data-react]")).toBeNull();
    }
  });

  it("the one who flies starts where she is, at the height she has, with no hop; on the floor she hops as the others do", () => {
    const s = lane([["nike", "look"]], { fidget: true });
    const cell = s.cell("k0")!;
    const lift = (): number => s.seen("k0").lift;
    // Riding on her wings, between 6 and 8px: pressed as she sinks.
    s.to("k0", 3600 + 360 + 130);
    const had = lift();
    expect(had).toBeGreaterThan(6);
    expect(had).toBeLessThan(8);
    const pressed = s.since("k0");
    click(s, cell);
    const began = starts(s, "k0", 100)!;
    expect(began).toMatchObject({ small: false });
    const from = pressed + began.from;
    expect(from % 90).toBe(0); // on her quarter-beat
    const at = lift();
    expect(Math.abs(at - had)).toBeLessThan(0.5); // where she was, a moment on
    // Four of her beats: her start's picture, no hop, her wings still, and she neither rises nor sinks.
    for (let ms = s.since("k0") - from; ms < 4 * 360; ms += 20) {
      s.to("k0", from + ms);
      expect(cell.dataset.react).toBe("start");
      expect(cell.dataset.pose).toBe("look");
      expect(cell.dataset.frame).toBeUndefined();
      expect(hopOf(cell)).toBe("");
      expect(lift()).toBe(at);
    }
    s.to("k0", from + 4 * 360);
    expect(cell.dataset.react).toBeUndefined();
    expect(s.seen("k0").start).toBeNull();
    // Her wings wait for their next bar, and until then she is simply at her lift.
    expect(lift()).toBe(8);
    // At her making she stands on the floor, and hops 2.7px like anyone.
    const made = lane([["nike", "make"]]);
    made.to("k0", 1080);
    click(made, made.cell("k0"));
    expect(made.cell("k0")!.dataset.react).toBe("start");
    expect(hopOf(made.cell("k0")!)).toBe(up(2.7));
    expect(made.seen("k0").lift).toBe(0);
    // With her wings held still she starts at her lift, and stays there.
    const still = lane([["nike", "look"]]);
    still.to("k0", 1080);
    click(still, still.cell("k0"));
    for (let ms = 0; ms < 1440; ms += 40) {
      still.to("k0", 1080 + ms);
      expect(still.cell("k0")!.dataset.react).toBe("start");
      expect(still.seen("k0").lift).toBe(8);
      expect(hopOf(still.cell("k0")!)).toBe("");
    }
  });

  it("its fidget rests from the start until the first bar after it: the bellows stop as he starts, and lean in again with their next bar", () => {
    const turnOf = (pivot: readonly [number, number], deg: number): string =>
      `translate(${pivot[0]}px, ${pivot[1]}px) rotate(${deg.toFixed(3)}deg) translate(${-pivot[0]}px, ${-pivot[1]}px)`;
    // The smith at his bellows: a bar of two beats of 560ms, leaning in and back.
    const s = lane([["hephaestus", "run"]], { fidget: true });
    const cell = s.cell("k0")!;
    const bellows = CAST.gods.hephaestus.fid.run!.moves[0]!.pivot!;
    expect(CAST.gods.hephaestus.st).toMatchObject({ hop: 1.8, beats: 3 });
    // Pressed 40ms before a quarter-beat in his third bar: until it he is at them, as if unpressed.
    const calm = lane([["hephaestus", "run"]], { fidget: true });
    const leans = (it: Lane): boolean => /rotate\(/.test(hopOf(it.cell("k0")!));
    s.to("k0", 2900);
    click(s, cell);
    for (const ms of [2900, 2920, 2939]) {
      s.to("k0", ms);
      calm.to("k0", ms);
      expect(hopOf(cell)).toBe(hopOf(calm.cell("k0")!));
    }
    s.to("k0", 2940);
    expect(cell.dataset.react).toBe("start");
    expect(hopOf(cell)).toBe(up(1.8)); // the hop alone: no lean
    s.to("k0", 2940 + 280);
    expect(hopOf(cell)).toBe("");
    // Three of his beats: it ends 4620ms after his cut, 140ms into a bar. Unpressed, he leans in
    // and back through that bar; startled, he waits it out, for the bar at 5600.
    let leant = 0;
    for (let ms = 2940 + 280; ms < 5600; ms += 20) {
      s.to("k0", ms);
      calm.to("k0", ms);
      expect(cell.dataset.react).toBe(ms < 4620 ? "start" : undefined);
      expect(hopOf(cell)).toBe("");
      expect(s.seen("k0").fidget).toBeNull();
      leant += ms >= 4620 && leans(calm) ? 1 : 0;
    }
    expect(leant).toBeGreaterThan(10);
    s.to("k0", 5600 + 140);
    calm.to("k0", 5600 + 140);
    expect(hopOf(cell)).toBe(turnOf(bellows, 0.5)); // and leans in again, as ever
    expect(hopOf(cell)).toBe(hopOf(calm.cell("k0")!));
    // A cut ends the start and its rest with it: the pose cut to fidgets as it would have, to
    // the frame. Themis is handed a finding at her running; her scales swing once as they cut in.
    const cut = [0, 1].map(() => lane([["themis", "run"]], { fidget: true }));
    for (const it of cut) {
      it.to("k0", 400);
      it.set("k0", { family: "think", tools: 2 });
    }
    cut[0]!.to("k0", 900);
    click(cut[0]!, cut[0]!.cell("k0"));
    cut[0]!.to("k0", 1100);
    expect(cut[0]!.cell("k0")!.dataset.react).toBe("start");
    let swung = 0;
    for (let ms = 1100; ms < 6000; ms += 20) {
      for (const it of cut) it.to("k0", ms);
      const [mine, hers] = [cut[0]!.cell("k0")!, cut[1]!.cell("k0")!];
      if (hers.dataset.pose === "run") continue;
      expect(mine.dataset.pose).toBe(hers.dataset.pose);
      expect(mine.dataset.react).toBeUndefined();
      expect(mine.dataset.part).toBe(hers.dataset.part);
      expect(mine.querySelector<HTMLElement>(".oly-part[data-of^='think']")?.style.transform).toBe(
        hers.querySelector<HTMLElement>(".oly-part[data-of^='think']")?.style.transform,
      );
      swung += hers.dataset.part ? 1 : 0;
    }
    expect(swung).toBeGreaterThan(10);
    // A move played once on the cut doesn't come back after a start: Themis's scales have settled.
    const scales = lane([["themis", "think"]], { fidget: true });
    scales.to("k0", 640);
    click(scales, scales.cell("k0"));
    expect(scales.cell("k0")!.dataset.react).toBe("start");
    expect(scales.cell("k0")!.dataset.part).toBeUndefined(); // her scales are in her start's picture
    for (let ms = 640; ms < 9000; ms += 40) {
      scales.to("k0", ms);
      expect(scales.cell("k0")!.dataset.part).toBeUndefined();
    }
  });

  it("under reduced motion a start is its picture as a still: no hop, held twice its beats; the one who flies is simply up", () => {
    const s = lane([["hermes"]], { reduced: true });
    const cell = s.cell("k0")!;
    s.to("k0", 1210);
    click(s, cell);
    s.to("k0", 1274);
    expect(cell.dataset.react).toBeUndefined();
    const { frames } = s.drawn;
    for (let ms = 0; ms < 3000; ms += 10) {
      s.to("k0", 1275 + ms);
      expect(cell.dataset.react).toBe("start");
      expect(cell.dataset.pose).toBe("look");
      expect(hopOf(cell)).toBe("");
    }
    s.to("k0", 1275 + 3000);
    expect(cell.dataset.react).toBeUndefined();
    expect(s.seen("k0").start).toBeNull();
    // Two frames in all: the cut to it, and the cut back.
    s.host.run(2000);
    expect(s.drawn.frames - frames).toBe(2);
    expect(s.host.pending()).toBe(0);
    // Again within six seconds: smaller is only shorter, twice its two beats.
    click(s, cell);
    const again = starts(s, "k0", 2000)!;
    expect(again).toMatchObject({ small: true });
    expect(again.to - again.from).toBe(1200);
    // The one who flies, aloft: her start as a still at her lift.
    const nike = lane([["nike", "look"]], { reduced: true, fidget: true });
    nike.to("k0", 1080);
    click(nike, nike.cell("k0"));
    for (let ms = 0; ms < 2 * 1440; ms += 40) {
      nike.to("k0", 1080 + ms);
      expect(nike.cell("k0")!.dataset.react).toBe("start");
      expect(nike.seen("k0").lift).toBe(8);
      expect(hopOf(nike.cell("k0")!)).toBe("");
    }
    nike.to("k0", 1080 + 2 * 1440);
    expect(nike.cell("k0")!.dataset.react).toBeUndefined();
    expect(nike.seen("k0").lift).toBe(8);
  });

  it("reduced motion asked for in the middle of a hop: a cut to the floor at the next frame drawn, and the start is held to twice its beats", () => {
    const s = lane([["hermes"]]);
    const cell = s.cell("k0")!;
    s.to("k0", 1200);
    click(s, cell);
    s.to("k0", 1200 + 40);
    expect(hopOf(cell)).toMatch(/^translate\(0\.00px, -[23]\.\d\dpx\)$/);
    s.quiet(true);
    s.host.run(16, 16);
    expect(hopOf(cell)).toBe("");
    expect(cell.dataset.react).toBe("start");
    s.to("k0", 1200 + 2999);
    expect(cell.dataset.react).toBe("start");
    s.to("k0", 1200 + 3000);
    expect(cell.dataset.react).toBeUndefined();
  });

  it("the card holds its one height through a start: its foot 10px and more over the figure, hopped", () => {
    for (const god of ALL) {
      const s = lane([[god, "think"]]);
      const cell = s.cell("k0")!;
      const { hop, top } = CAST.gods[god].st;
      enter(cell);
      const before = s.peek().card!;
      expect(before).toEqual(placeOf(s, "k0", CAST.gods[god].card));
      s.to("k0", 4 * CAST.gods[god].step);
      click(s, cell);
      expect(cell.dataset.react).toBe("start");
      for (let ms = 0; ms < 3000; ms += 20) {
        s.host.advance(20);
        expect(s.peek().card).toEqual(before);
      }
      // The top of its start at the height of its hop, in the lane, against the card's foot.
      expect(CELL_Y + top - hop - before.foot).toBeGreaterThanOrEqual(CARD_AIR);
      expect(s.cards).toEqual(["k0"]);
    }
    // The one who flies, startled aloft: her start's top at her lift is still under it.
    const nike = CAST.gods.nike;
    expect(
      CELL_Y + nike.st.top - nike.lift.look! - (CELL_Y + nike.card - CARD_AIR),
    ).toBeGreaterThanOrEqual(CARD_AIR);
  });

  it("with startles off a lane is built and held as it was: no start's picture, nothing to press, and a press wakes nothing", () => {
    const s = stage(); // as every earlier test's lane
    s.sync([agent("a", "hermes", "run", "look", 1)]);
    settle(s);
    const cell = s.cell("a")!;
    expect(s.lane.querySelectorAll(".oly-p-start")).toHaveLength(0);
    expect(cell.classList.contains("is-startable")).toBe(false);
    expect(cell.getAttribute("aria-disabled")).toBe("true");
    const { clock, dice } = s.asked;
    const page = s.lane.innerHTML;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    cell.focus();
    for (const key of ["Enter", " "]) expect(keydown(cell, key).defaultPrevented).toBe(true);
    s.host.advance(3000);
    expect(s.peek().gods[0]!.start).toBeNull();
    expect(s.lane.querySelector("[data-react]")).toBeNull();
    expect(s.asked).toEqual({ clock, dice });
    expect(s.woken.times).toBe(0);
    // Only its tab stop and its cartouche came with focus.
    const plain = (markup: string): string =>
      markup.replace(/ tabindex="-?\d"/g, "").replace(/oly-ins is-focus/g, "oly-ins");
    expect(plain(s.lane.innerHTML)).toBe(plain(page));
    // On, only a god handed its start's picture has one, and only it can be startled.
    const some = lane([["hermes"], ["athena"]], { starts: { athena: START_URLS.athena } });
    expect(some.lane.querySelectorAll(".oly-p-start")).toHaveLength(1);
    expect(some.cell("k1")!.querySelectorAll(".oly-p-start")).toHaveLength(1);
    expect(some.cell("k0")!.classList.contains("is-startable")).toBe(false);
    expect(some.cell("k0")!.getAttribute("aria-disabled")).toBe("true");
    expect(some.cell("k1")!.classList.contains("is-startable")).toBe(true);
    click(some, some.cell("k0"));
    click(some, some.cell("k1"));
    some.host.advance(140);
    expect(some.seen("k0").start).toBeNull();
    expect(some.seen("k1").start).toEqual({ small: false });
    expect(some.woken.times).toBe(1);
  });

  it("taken down: a press on what is left wakes nothing", () => {
    const s = lane([["hermes"]]);
    const cell = s.cell("k0")!;
    s.dispose();
    const { clock } = s.asked;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    keydown(cell, "Enter");
    expect(s.asked.clock).toBe(clock);
    expect(s.host.pending()).toBe(0);
  });

  /** Athena on the right, Hermes on the left, and Herodotus, who misses nothing, between them: they notice each other. */
  const three = (opts: Opts = {}): Lane =>
    lane([["athena"], ["hermes"], ["herodotus"]], { react: true, ...opts });
  /** Herodotus on the right, Nike on the left at her making, and Athena between them. */
  const withNike = (opts: Opts = {}): Lane =>
    lane([["herodotus"], ["nike", "make"], ["athena"]], { react: true, ...opts });
  /** Every reaction `key` shows over so long, a ms at a time: how, and from when to when, counted from now. */
  function reactions(s: Lane, key: string, over: number): string[] {
    const seen: string[] = [];
    let how: string | null = null;
    for (let ms = 0; ms <= over; ms++) {
      const now = s.seen(key).react?.how ?? null;
      if (now !== how) seen.push(`${ms} ${now}`);
      how = now;
      s.host.advance(1);
    }
    return seen;
  }

  it("a notice armed for it ends its start at once, and begins when it would have; while it notices, a press starts nothing", () => {
    // Nobody pressing: Herodotus turns to face Hermes's finish.
    const calm = three();
    calm.to("k2", 1000);
    calm.set("k1", { look: "done" });
    const noticed = reactions(calm, "k2", 2500);
    expect(noticed).toHaveLength(2); // a notice begins, and ends
    expect(noticed[0]).toMatch(/^\d+ (turn|glance|back)$/);
    expect(noticed[1]).toMatch(/^\d+ null$/);
    const [from, to] = [Number(noticed[0]!.split(" ")[0]), Number(noticed[1]!.split(" ")[0])];
    // Pressed 250ms before: his start is under way when the record changes, and ends there.
    const s = three();
    const cell = s.cell("k2")!;
    s.to("k2", 750);
    click(s, cell);
    s.to("k2", 999);
    expect(cell.dataset.react).toBe("start");
    s.to("k2", 1000);
    expect(cell.dataset.react).toBe("start"); // four of his beats: it would run to 3150
    s.set("k1", { look: "done" });
    expect(s.seen("k2")).toMatchObject({ start: null, react: null });
    expect(cell.dataset.react).toBeUndefined();
    // The notice is the same one, to the ms; and through it every press is ignored.
    const seen: string[] = [];
    let how: string | null = null;
    for (let ms = 0; ms <= 2500; ms++) {
      const now = s.seen("k2").react?.how ?? null;
      if (now !== how) seen.push(`${ms} ${now}`);
      how = now;
      if (ms < to && ms % 20 === 0) click(s, cell);
      expect(s.seen("k2").start).toBeNull();
      expect(cell.dataset.react).toBe(now ?? undefined);
      s.host.advance(1);
    }
    expect(seen).toEqual(noticed);
    expect(from).toBeGreaterThan(0);
    // Once it is over he can be startled again.
    click(s, cell);
    expect(starts(s, "k2", 200)).toMatchObject({ small: true });
    // Pressed, and the record changes before the start has begun: it never plays, and the notice does.
    const never = three();
    never.to("k2", 1000 - 20); // 20ms on, 130 before his quarter-beat
    click(never, never.cell("k2"));
    never.to("k2", 1000);
    never.set("k1", { look: "done" });
    const after: string[] = [];
    let last: string | null = null;
    for (let ms = 0; ms <= 2500; ms++) {
      expect(never.seen("k2").start).toBeNull();
      const now = never.seen("k2").react?.how ?? null;
      if (now !== last) after.push(`${ms} ${now}`);
      last = now;
      never.host.advance(1);
    }
    expect(after).toEqual(noticed);
  });

  it("the crown armed for her ends Nike's start at once, and she crowns when she would have; a god the event is not for keeps its start", () => {
    const calm = withNike();
    calm.to("k2", 1000);
    calm.set("k2", { look: "done" });
    const crowned = reactions(calm, "k1", 3000);
    expect(crowned.map((it) => it.split(" ")[1])).toEqual(["crown", "null"]);
    const over = Number(crowned[1]!.split(" ")[0]);
    const s = withNike();
    const nike = s.cell("k1")!;
    s.to("k2", 700);
    click(s, nike);
    s.to("k2", 1000);
    expect(nike.dataset.react).toBe("start");
    s.set("k2", { look: "done" });
    expect(s.seen("k1")).toMatchObject({ start: null, react: null });
    expect(nike.dataset.react).toBeUndefined();
    // Her crown is the same one, to the ms, and no press comes between her and it.
    const seen: string[] = [];
    let how: string | null = null;
    for (let ms = 0; ms <= 3000; ms++) {
      const now = s.seen("k1").react?.how ?? null;
      if (now !== how) seen.push(`${ms} ${now}`);
      how = now;
      if (ms < over && ms % 20 === 0) click(s, nike);
      expect(s.seen("k1").start).toBeNull();
      s.host.advance(1);
    }
    expect(seen).toEqual(crowned);
    // Hermes finishes on the left: Herodotus, next to him, notices; Athena, beyond, is not asked.
    const far = three();
    far.to("k2", 800);
    click(far, far.cell("k2"));
    click(far, far.cell("k0"));
    const begun = Math.ceil(far.since("k0") / 130) * 130; // her quarter-beat
    far.to("k2", 1000);
    expect(far.seen("k2").start).toEqual({ small: false });
    expect(far.seen("k0").start).toEqual({ small: false });
    far.set("k1", { look: "done" });
    expect(far.seen("k2").start).toBeNull();
    expect(far.seen("k0").start).toEqual({ small: false });
    // Hers runs its three beats of 520ms from her quarter-beat, and not a ms less.
    expect(starts(far, "k0", 3000)).toMatchObject({ small: false });
    expect(far.since("k0")).toBe(begun + 3 * 520);
    expect(far.seen("k0").react).toBeNull();
  });

  describe("a line near it", () => {
    // With the cast's own art no line comes within the 3px a start is kept from one: a line is
    // already held clear of the god's whole envelope, and its start stands barely outside that.
    // So the rule is played here with a start kept 12px from a line, on a lane where one then is:
    // Herodotus and Athena on a narrow lane; he finishes at 12s, and Hermes is sent at 17s.
    const wary = { ...CAST, startle: { ...CAST.startle, line: 12 } };
    function narrow(
      cast: typeof CAST,
    ): Stage & { at(ms: number): void; done(): void; hermes(): void } {
      const s = stage({ seed: 154, width: 431, startle: true, cast });
      let records = [
        agent("herodotus", "herodotus", "run", "look", 1),
        agent("athena", "athena", "run", "look", 1),
      ];
      s.sync(records);
      return Object.assign(s, {
        at: (ms: number): void => s.host.advance(ms - s.host.now()),
        done: (): void =>
          s.sync((records = [agent("herodotus", "herodotus", "done", "look", 1), records[1]!])),
        hermes: (): void => s.sync([...records, agent("hermes", "hermes", "run", "look", 1)]),
      });
    }
    const athena = (s: Stage): Seen => out(s, "athena");

    it("a line put out near it ends its start at once", () => {
      const [s, plain] = [narrow(wary), narrow(CAST)];
      for (const lane of [s, plain]) {
        lane.at(11_600);
        expect(lane.peek().gods.map((god) => god.step)).toEqual(["work", "work"]);
        click(lane, lane.cell("athena"));
        lane.at(11_999);
        expect(athena(lane).start).toEqual({ small: false }); // three of her beats: it would run past 13s
        lane.at(12_000);
        expect(athena(lane).start).toEqual({ small: false });
        lane.done();
        // His farewell is held out at once, the same line in the same place.
        expect(out(lane, "herodotus")).toMatchObject({ step: "report" });
        expect(out(lane, "herodotus").line).not.toBeNull();
      }
      expect(out(s, "herodotus").ribbon).toEqual(out(plain, "herodotus").ribbon);
      // 12px is too near for her start; 3px is not.
      expect(athena(s).start).toBeNull();
      expect(s.cell("athena")!.dataset.react).toBeUndefined();
      expect(athena(plain).start).toEqual({ small: false });
      expect(plain.cell("athena")!.dataset.react).toBe("start");
      // The line is not moved, nor cut short, for her start or for its ending.
      for (let ms = 12_000; ms < 12_000 + LINE; ms += 20) {
        s.at(ms);
        plain.at(ms);
        expect(out(s, "herodotus").ribbon).toEqual(out(plain, "herodotus").ribbon);
        expect(out(s, "herodotus").unrolled).toBe(out(plain, "herodotus").unrolled);
        expect(athena(s).start).toBeNull();
      }
    });

    it("it is never begun where a line is near: while one is held out, a press starts nothing; once it is furled, it starts", () => {
      const [s, plain] = [narrow(wary), narrow(CAST)];
      for (const lane of [s, plain]) {
        lane.at(12_000);
        lane.done();
      }
      let started = 0;
      for (let ms = 12_000; ms < 12_000 + LINE; ms += 20) {
        for (const lane of [s, plain]) {
          lane.at(ms);
          if (ms % 100 === 0) click(lane, lane.cell("athena"));
        }
        expect(out(s, "herodotus").line).not.toBeNull();
        expect(athena(s).start).toBeNull();
        expect(s.cell("athena")!.dataset.react).toBeUndefined();
        started += athena(plain).start ? 1 : 0;
      }
      expect(started).toBeGreaterThan(50); // kept only 3px from it, she was startled all the while
      // Furled: she can be startled again, in full, having not been.
      s.at(12_000 + LINE);
      expect(out(s, "herodotus").line).toBeNull();
      click(s, s.cell("athena"));
      s.host.advance(130);
      expect(athena(s).start).toEqual({ small: false });
    });

    it("a line put out before it has begun drops it; and the room kept for a greeting, as a god lands, ends one as a line does", () => {
      const [s, plain] = [narrow(wary), narrow(CAST)];
      for (const lane of [s, plain]) {
        lane.at(11_990);
        click(lane, lane.cell("athena")); // her quarter-beat is still to come
        expect(athena(lane).start).toBeNull();
        lane.at(12_000);
        expect(athena(lane).start).toBeNull();
        lane.done();
      }
      let began = 0;
      for (let ms = 12_000; ms < 12_000 + LINE; ms += 10) {
        s.at(ms);
        plain.at(ms);
        expect(athena(s).start).toBeNull();
        began += athena(plain).start ? 1 : 0;
      }
      expect(began).toBeGreaterThan(100); // 3px from the line, it began on her quarter-beat and ran its beats
      // Hermes is sent at 17s: he is set at once, and the room for his greeting is kept from then.
      for (const lane of [s, plain]) {
        lane.at(16_800);
        click(lane, lane.cell("athena"));
        lane.at(17_000);
        expect(athena(lane).start).not.toBeNull();
        lane.hermes();
        expect(out(lane, "hermes")).toMatchObject({ step: "assemble", line: null }); // not a word yet
      }
      expect(athena(s).start).toBeNull();
      expect(athena(plain).start).not.toBeNull();
    });
  });

  it("puts no step on the clock and throws no dice: a press wakes it once, the frames are the hop's own and one for its end, and the floor is not drawn again", () => {
    function run(pressed: boolean): { s: Lane; frames: number[] } {
      const s = lane([["hermes"]]);
      s.to("k0", 1200);
      s.host.run(400, 16); // whatever was still moving has stopped
      if (pressed) s.cell("k0")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // The frames drawn in each 50ms, as a window gives them.
      const frames: number[] = [];
      for (let ms = 0; ms < 2500; ms += 50) {
        const { frames: was } = s.drawn;
        s.host.run(50, 16);
        frames.push(s.drawn.frames - was);
      }
      return { s, frames };
    }
    const count = (frames: number[], from: number, to: number): number =>
      frames.slice(from / 50, to / 50).reduce((sum, n) => sum + n, 0);
    const calm = run(false);
    const start = run(true);
    expect(count(calm.frames, 0, 2500)).toBe(0); // asleep
    // Pressed at 1600, 25ms past his quarter-beat: a frame for the press, and the clock sleeps
    // until he begins at 1650, the moment the first 50ms ends on. He hops for half a beat, frame
    // by frame as the window gives them, is held with none, and ends at 3150 with one.
    expect(count(start.frames, 0, 50)).toBeGreaterThanOrEqual(2);
    expect(count(start.frames, 0, 50)).toBeLessThanOrEqual(3);
    expect(count(start.frames, 50, 200)).toBeGreaterThan(9);
    expect(count(start.frames, 50, 200)).toBeLessThan(17);
    expect(count(start.frames, 200, 1500)).toBe(0);
    expect(count(start.frames, 1500, 1550)).toBe(1);
    expect(count(start.frames, 1550, 2500)).toBe(0);
    expect(start.s.host.pending()).toBe(0); // asleep again, for good
    // One wake, and nothing else: not a step, not a throw of the dice.
    expect(start.s.woken.times).toBe(1);
    expect(calm.s.woken.times).toBe(0);
    expect(start.s.asked).toEqual({ ...calm.s.asked, clock: calm.s.asked.clock + 1 });
    // The floor at rest was not drawn again for it, nor the tesserae's canvas touched.
    expect(start.s.bed.wipes).toBe(calm.s.bed.wipes);
    expect(start.s.bed.filled).toBe(calm.s.bed.filled);
    expect(start.s.fx.wipes).toBe(calm.s.fx.wipes);
    expect(start.s.fx.filled).toBe(calm.s.fx.filled);
  });

  it("the card and the keys over gods that can be startled put nothing on the clock and never wake it; only a press on a god does, once, with no step and no dice", () => {
    function run(look: boolean, presses: boolean): { s: Stage; peeks: string; pressed: number } {
      const s = lane([["hephaestus", "make"], ["nike"], ["themis", "run"]], { fidget: true });
      const peeks: string[] = [];
      let pressed = 0;
      for (let ms = 0; ms < 8000; ms += 100) {
        const cells = s.cells();
        if (look) {
          if (ms % 600 === 0) enter(cells[(ms / 600) % cells.length]);
          if (ms % 600 === 300) leave(cells[((ms - 300) / 600) % cells.length]);
          if (ms % 1000 === 500) keydown(document.body, "Tab");
          if (ms % 1000 === 700) keydown(cells[0]!, "ArrowRight");
          if (ms % 1000 === 800) keydown(cells[1]!, "Home");
          if (ms % 1000 === 900) keydown(cells[0]!, "End");
          if (ms === 4000) keydown(document.body, "Escape");
        }
        if (presses && ms % 700 === 0) {
          const cell = cells[(ms / 700) % cells.length]!;
          if (ms % 1400 === 0) cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          else keydown(cell, ms % 2100 === 0 ? "Enter" : " ");
          pressed += 1;
        }
        s.host.run(100);
        const { card: _card, ...rest } = s.peek();
        peeks.push(JSON.stringify(rest));
      }
      return { s, peeks: peeks.join("\n"), pressed };
    }
    const alone = run(false, false);
    const looked = run(true, false);
    expect(looked.s.asked).toEqual(alone.s.asked);
    expect(looked.s.woken.times).toBe(0);
    expect(looked.peeks).toBe(alone.peeks);
    expect(looked.s.cards.length).toBeGreaterThan(10);
    // Pressed, with the pointer and the keys at it too: a wake a press, and no more.
    const pressed = run(true, true);
    expect(pressed.pressed).toBe(12);
    expect(pressed.s.woken.times).toBe(12);
    expect(pressed.s.asked).toEqual({ ...alone.s.asked, clock: alone.s.asked.clock + 12 });
    expect(pressed.peeks).toMatch(/"start":\{"small":false\}/);
    expect(pressed.peeks).toMatch(/"start":\{"small":true\}/);
    expect(alone.peeks).not.toMatch(/"start":\{/);
  });

  describe("the same seeded run, pressed or not, startles on or off", () => {
    interface Ran {
      readonly peeks: FloorPeek[];
      readonly looks: { page: HTMLElement; height: string }[];
      /** At each look, the gods a press has in hand: pressed at their work, in the pose they still hold. */
      readonly held: ReadonlySet<string>[];
      readonly asked: { clock: number; dice: number };
      readonly woken: number;
      readonly presses: number;
      readonly cards: (string | null)[];
    }

    /**
     * A run of records, their gods alive at their work and noticing each
     * other, looked at every 250ms, with the frames between as a window gives
     * them and the pointer on one god after another; and, if `press`, a click,
     * Enter or Space on one god after another, twice in three looks.
     */
    function ran(
      records: (ms: number) => LaneAgent[],
      startle: boolean,
      press: boolean,
      reduced = false,
    ): Ran {
      const s = stage({ seed: 5, fidget: true, react: true, startle, reduced });
      const peeks: FloorPeek[] = [];
      const looks: Ran["looks"] = [];
      const held: Set<string>[] = [];
      const hand = new Map<string, string>();
      let presses = 0;
      for (let ms = 0; ms <= 32_000; ms += 250) {
        s.sync(records(ms));
        const cells = s.cells();
        const i = ms / 250;
        if (cells.length) enter(cells[i % cells.length]);
        const peek = s.peek();
        for (const [key, pose] of hand) {
          const god = peek.gods.find((it) => it.key === key);
          if (!god || god.step !== "work" || god.pose !== pose) hand.delete(key);
        }
        peeks.push(peek);
        held.push(new Set(hand.keys()));
        looks.push({ page: s.lane.cloneNode(true) as HTMLElement, height: s.lane.style.height });
        if (press && cells.length && i % 3 !== 2) {
          const n = (i * 7) % cells.length;
          const cell = cells[n]!;
          if (i % 4 === 1) keydown(cell, "Enter");
          else if (i % 4 === 3) keydown(cell, " ");
          else cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          presses += 1;
          const god = peek.gods[n]!;
          if (god.step === "work" && !hand.has(god.key)) hand.set(god.key, god.pose);
        }
        s.host.run(250, 16);
      }
      const run: Ran = {
        peeks,
        looks,
        held,
        asked: { ...s.asked },
        woken: s.woken.times,
        presses,
        cards: [...s.cards],
      };
      s.dispose();
      return run;
    }

    const crowdRun = (ms: number): LaneAgent[] =>
      laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]);
    const FIVE: readonly GodId[] = ["nike", "hermes", "themis", "argus", "hephaestus"];
    const FAMILIES: readonly ToolFamily[] = ["look", "run", "make", "web", "think"];
    const fiveRun = (ms: number): LaneAgent[] =>
      FIVE.map((god, i) => {
        const tools = Math.max(0, Math.floor((ms - 300 * i) / 3000));
        const look = i === 1 && ms >= 21_000 ? "done" : i === 3 && ms >= 24_000 ? "fail" : "run";
        return agent(god, god, look, tools ? FAMILIES[(tools + i) % 5]! : "think", tools);
      });
    const noticesRun = (ms: number): LaneAgent[] => [
      agent("a", "athena", ms >= 19_000 ? "done" : "run", "look", 1),
      agent("b", "nike", ms >= 28_000 ? "stop" : "run", "look", 1),
      agent("c", "herodotus", "run", ms >= 16_000 ? "web" : "look", ms >= 16_000 ? 2 : 1),
      ...(ms >= 3000 ? [agent("d", "hermes", ms >= 13_000 ? "fail" : "run", "look", 1)] : []),
      ...(ms >= 21_000 ? [agent("e", "argus", "run", "look", 1)] : []),
      ...(ms >= 23_000 ? [agent("f", "themis", ms >= 30_000 ? "done" : "run", "think", 0)] : []),
    ];

    /**
     * A look at the lane with what only a start writes taken off: the start
     * itself; of a god a press has in hand, its fidget, which rests for it,
     * and so the about-face a fidget may be; and the height of the one who
     * flies, who holds hers through it.
     */
    function plain(peek: FloorPeek, held: ReadonlySet<string>): unknown {
      return {
        ...peek,
        gods: peek.gods.map((god) => {
          const { start: _start, ...rest } = god;
          const mine = held.has(god.key);
          return {
            ...rest,
            fidget: mine ? null : god.fidget,
            dir: mine ? 0 : god.dir,
            figure: mine ? null : god.figure,
            lift: CAST.gods[god.god].lift[god.pose as Skill] ? "aloft" : god.lift,
          };
        }),
      };
    }

    /** The page at a look, with the same taken off, and what a lane that can be startled is built and marked with. */
    function sheet(run: Ran, held: ReadonlySet<string>, i: number): string {
      const lane = run.looks[i]!.page.cloneNode(true) as HTMLElement;
      for (const picture of lane.querySelectorAll(".oly-p-start")) picture.remove();
      for (const hung of lane.querySelectorAll(".oly-medal")) {
        hung.classList.remove("is-startable");
        hung.removeAttribute("aria-disabled");
      }
      [...lane.querySelectorAll<HTMLElement>(".oly-cell")].forEach((cell, n) => {
        const { god, pose } = cell.dataset as { god: GodId; pose: Skill };
        cell.classList.remove("is-startable");
        cell.removeAttribute("aria-disabled");
        if (cell.dataset.react === "start") delete cell.dataset.react;
        if (held.has(run.peeks[i]!.gods[n]!.key)) {
          delete cell.dataset.frame;
          delete cell.dataset.part;
          cell.classList.remove("is-left");
          cell.querySelector(".oly-poses")!.removeAttribute("style");
          for (const part of cell.querySelectorAll<HTMLElement>(".oly-part"))
            part.style.transform = "";
        }
        if (CAST.gods[god].lift[pose])
          cell.style.transform = cell.style.transform.replace(/, [^,]+, 0\)$/, ", 0, 0)");
      });
      return `${run.looks[i]!.height} ${lane.innerHTML}`.replace(/ style=""/g, "");
    }

    /** Every look of two runs the same, but for what a start writes on the gods `held`. */
    function same(a: Ran, b: Ran, held: readonly ReadonlySet<string>[]): void {
      expect(a.peeks).toHaveLength(b.peeks.length);
      a.peeks.forEach((peek, i) => {
        expect(JSON.stringify(plain(peek, held[i]!))).toBe(
          JSON.stringify(plain(b.peeks[i]!, held[i]!)),
        );
        expect(sheet(a, held[i]!, i)).toBe(sheet(b, held[i]!, i));
      });
      expect(a.cards).toEqual(b.cards);
      // Not a step or a throw of the floor's dice more: only a wake a press.
      expect(a.asked.dice).toBe(b.asked.dice);
      expect(a.asked.clock - a.woken).toBe(b.asked.clock - b.woken);
    }

    it.each([
      ["the crowd's run", crowdRun],
      ["five through every family of tool", fiveRun],
      ["a run of notices", noticesRun],
    ] as const)(
      "plays the same: every step, cut, place, line, notice, crown, card and throw of the dice; only the start differs (%s)",
      (name, records) => {
        const off = ran(records, false, true); // pressed, and nothing to press
        const unpressed = ran(records, true, false);
        const on = ran(records, true, true);
        // The pressed run did start, in full and smaller, on the floor and off it.
        const started = on.peeks.flatMap((peek) => peek.gods.flatMap((god) => god.start ?? []));
        expect(started.filter((it) => !it.small).length).toBeGreaterThan(10);
        expect(started.filter((it) => it.small).length).toBeGreaterThan(10);
        expect(on.looks.some(({ page }) => page.querySelector('[data-react="start"]'))).toBe(true);
        expect(
          on.looks.some(({ page }) =>
            page.querySelector('[data-react="start"] .oly-poses[style*="translate(0.00px, -"]'),
          ),
        ).toBe(true);
        if (name !== "the crowd's run")
          expect(
            on.peeks.some((peek) => peek.gods.some((god) => god.god === "nike" && god.start)),
          ).toBe(true);
        for (const run of [off, unpressed]) {
          expect(run.peeks.every((peek) => peek.gods.every((god) => god.start === null))).toBe(
            true,
          );
          expect(run.looks.every(({ page }) => !page.querySelector('[data-react="start"]'))).toBe(
            true,
          );
        }
        expect(off.looks.every(({ page }) => !page.querySelector(".oly-p-start"))).toBe(true);
        // The gods noticed each other all the same.
        const hows = (run: Ran): string[] =>
          run.peeks.flatMap((peek) => peek.gods.flatMap((god) => god.react?.how ?? []));
        if (name === "a run of notices")
          expect([...new Set(hows(unpressed))].sort()).toEqual(["crown", "glance", "turn"]);
        // And everything else is the same, look for look: what the floor holds, and the page.
        const nobody = on.held.map(() => new Set<string>());
        same(off, unpressed, nobody); // startles off, against on with nobody pressing: whole
        same(on, unpressed, on.held);
        same(on, off, on.held);
        // A god no press has in hand is compared whole, its fidget too: most of them, most of the time.
        const all = on.peeks.flatMap((peek, i) => peek.gods.map((god) => on.held[i]!.has(god.key)));
        expect(all.filter((it) => !it).length).toBeGreaterThan(all.length / 3);
        expect(all.filter((it) => it).length).toBeGreaterThan(20);
        expect(on.cards.length).toBeGreaterThan(20);
        expect(on.asked.dice).toBeGreaterThan(10);
        // A wake for each press, where there is something to press; none without.
        expect(on.presses).toBeGreaterThan(60);
        expect(on.woken).toBe(on.presses);
        expect(off.presses).toBe(on.presses);
        expect(off.woken).toBe(0);
        expect(unpressed.woken).toBe(0);
      },
    );

    it("under reduced motion the same runs play the same, pressed or not, startles on or off, but for a start held as a still", () => {
      let stills = 0;
      for (const records of [crowdRun, fiveRun, noticesRun]) {
        const off = ran(records, false, true, true);
        const unpressed = ran(records, true, false, true);
        const on = ran(records, true, true, true);
        const nobody = on.held.map(() => new Set<string>());
        same(off, unpressed, nobody);
        same(on, unpressed, on.held);
        same(on, off, on.held);
        for (const { page } of on.looks) {
          // Nothing hops: a start is its picture, and no figure is ever shifted.
          for (const cell of page.querySelectorAll<HTMLElement>('[data-react="start"]')) {
            stills += 1;
            expect(cell.querySelector<HTMLElement>(".oly-poses")!.style.transform).toBe("");
          }
        }
        expect(on.woken).toBe(on.presses);
        expect(off.woken + unpressed.woken).toBe(0);
      }
      expect(stills).toBeGreaterThan(60);
    });
  });
});

/** What the unpressed run below asks of its clock and dice, and its wakes: read off the engine as it was at ffd08552. */
const UNPRESSED_ASKED = '[{"clock":59,"dice":51},{"times":0}]';

describe("the pool's medallions: a god waiting for a place is seen", () => {
  const CROWD: readonly GodId[] = [
    "athena",
    "hermes",
    "argus",
    "themis",
    "nike",
    "herodotus",
    "hephaestus",
    "athena",
    "hermes",
    "argus",
    "themis",
    "nike",
    "herodotus",
    "hephaestus",
  ];
  const sent = (n: number): LaneAgent[] => CROWD.slice(0, n).map((god, i) => agent(`g${i}`, god));
  const medals = (s: Stage): HTMLElement[] => [
    ...s.lane.querySelectorAll<HTMLElement>(".oly-medal"),
  ];
  const medal = (s: Stage, key: string): HTMLElement | undefined =>
    medals(s).find((el) => el.dataset.key === key);
  const hung = (s: Stage): string[] =>
    s.peek().medallions.map((m) => `${m.key} ${m.side < 0 ? "left" : "right"} ${m.slot}`);
  const POOL = CAST.pool;
  /** `n` sent at once, five at their work and the rest waiting; then the first on the floor fails, and the clock stops as the oldest waiting is set. */
  function oldestSet(s: Stage, n: number): void {
    s.sync(sent(n));
    settle(s, 5);
    s.sync(sent(n).map((a) => (a.key === "g0" ? { ...a, look: "fail" } : a)));
    until(s, () => s.peek().gods.some((god) => god.key === "g5"));
  }

  it("shows each waiting god as its row's cameo, named, with nothing to press and saying so, described by its row; a god on the floor has none", () => {
    const s = stage();
    s.sync(sent(7));
    expect(s.peek().waiting).toEqual(["g5", "g6"]);
    s.host.advance(POOL.widen); // the piers are wide
    expect(medals(s).map((el) => el.dataset.key)).toEqual(["g5", "g6"]);
    const el = medal(s, "g5")!;
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("aria-label")).toBe("Herodotus");
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("aria-describedby")).toBe("row-g5");
    // In the toolbar: the first hung has its tab stop while no god is on the lane yet.
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(medal(s, "g6")!.getAttribute("tabindex")).toBe("-1");
    expect(el.hasAttribute("aria-hidden")).toBe(false);
    expect(el.querySelector("img")!.getAttribute("src")).toBe(GODS.herodotus.cameo);
    expect(el.querySelector("img")!.alt).toBe("");
    expect(el.parentElement).toBe(s.lane.querySelector(".oly-gods"));
    s.host.advance(12_000); // the floor is narrower between the piers: the fifth lands later
    expect(s.peek().gods).toHaveLength(5);
    expect(medals(s).map((el2) => el2.dataset.key)).toEqual(["g5", "g6"]);
  });

  it("hangs the oldest on the right and the next on the left, each in the top slot, and the third under the oldest: where the mockup hangs them", () => {
    const s = stage();
    s.sync(sent(8));
    s.host.advance(POOL.widen);
    expect(hung(s)).toEqual(["g5 right 0", "g6 left 0", "g7 right 1"]);
    expect(medal(s, "g5")!.style.transform).toBe("translate(674.50px,4.50px)");
    expect(medal(s, "g6")!.style.transform).toBe("translate(6.50px,4.50px)");
    expect(medal(s, "g7")!.style.transform).toBe("translate(674.50px,29.50px)");
    // On a narrower lane the right one hangs as far from its own end.
    const narrow = stage({ width: 602 });
    narrow.sync(sent(8));
    narrow.host.advance(POOL.widen);
    const right = narrow.peek().medallions.find((m) => m.side > 0)!;
    expect(medal(narrow, right.key)!.style.transform).toMatch(/^translate\(578\.50px,/);
  });

  it("shows nothing of one while it is set, 600 ms, and then lets it through over 150 ms", () => {
    const s = stage();
    s.sync(sent(6));
    s.host.advance(POOL.widen);
    const el = medal(s, "g5")!;
    expect(el.style.opacity).toBe("0");
    s.host.advance(POOL.set);
    expect(el.style.opacity).toBe("0");
    s.host.advance(POOL.reveal / 2);
    expect(el.style.opacity).toBe("0.5");
    s.host.advance(POOL.reveal / 2);
    expect(el.style.opacity).toBe("");
    expect(s.peek().medallions[0]).toMatchObject({ shown: 1, going: false, y: POOL.y });
  });

  it("is taken down as its god is set: out of sight in 140 ms and out of a screen reader's at once, its slot kept 700 ms, and then the one under it moves up over 300 ms", () => {
    const s = stage();
    oldestSet(s, 8);
    expect(out(s, "g5").step).toBe("assemble");
    expect(s.peek().waiting).toEqual(["g6", "g7"]);
    expect(s.peek().medallions[0]).toMatchObject({ key: "g5", going: true });
    expect(medal(s, "g5")!.getAttribute("aria-hidden")).toBe("true");
    expect(medal(s, "g6")!.hasAttribute("aria-hidden")).toBe(false);
    s.host.advance(UNSET / 2);
    expect(Number(medal(s, "g5")!.style.opacity)).toBeGreaterThan(0.4);
    expect(Number(medal(s, "g5")!.style.opacity)).toBeLessThanOrEqual(0.5);
    s.host.advance(UNSET / 2);
    expect(medal(s, "g5")!.style.opacity).toBe("0");
    s.host.advance(POOL.scatter - UNSET - 2);
    expect(hung(s)).toEqual(["g5 right 0", "g6 left 0", "g7 right 1"]);
    s.host.advance(2);
    expect(hung(s)).toEqual(["g6 left 0", "g7 right 0"]);
    expect(medal(s, "g5")).toBeUndefined();
    s.host.advance(POOL.slide / 2);
    const mid = s.peek().medallions[1]!.y;
    expect(mid).toBeGreaterThan(POOL.y + POOL.pitch / 2 - 0.5);
    expect(mid).toBeLessThan(POOL.y + POOL.pitch / 2 + 0.5);
    s.host.advance(POOL.slide / 2);
    expect(medal(s, "g7")!.style.transform).toBe("translate(674.50px,4.50px)");
    expect(medal(s, "g6")!.style.transform).toBe("translate(6.50px,4.50px)");
  });

  it("is taken down the same way when its record ends while it waits, and its god never comes out", () => {
    const s = stage();
    s.sync(sent(6));
    s.host.advance(9000);
    s.sync(sent(6).map((a) => (a.key === "g5" ? { ...a, look: "done" } : a)));
    expect(s.peek().waiting).toEqual([]);
    expect(s.peek().medallions).toMatchObject([{ key: "g5", going: true }]);
    s.host.advance(POOL.scatter - 1);
    expect(medals(s)).toHaveLength(1);
    s.host.advance(1);
    expect(medals(s)).toHaveLength(0);
    s.host.advance(5000);
    expect(s.peek().gods.map((god) => god.key)).not.toContain("g5");
  });

  it("hangs eight, four a side, oldest highest; a ninth waits unseen until a slot is freed, and takes the lowest", () => {
    const s = stage();
    s.sync(sent(14));
    expect(s.peek().waiting).toHaveLength(9);
    s.host.advance(POOL.widen);
    expect(hung(s)).toEqual([
      "g5 right 0",
      "g6 left 0",
      "g7 right 1",
      "g8 left 1",
      "g9 right 2",
      "g10 left 2",
      "g11 right 3",
      "g12 left 3",
    ]);
    s.host.advance(9000);
    s.sync(sent(14).map((a) => (a.key === "g6" ? { ...a, look: "done" } : a)));
    s.host.advance(POOL.scatter - 1);
    expect(medal(s, "g13")).toBeUndefined();
    s.host.advance(1);
    expect(hung(s)).toEqual([
      "g5 right 0",
      "g7 right 1",
      "g8 left 0",
      "g9 right 2",
      "g10 left 1",
      "g11 right 3",
      "g12 left 2",
      "g13 left 3",
    ]);
    expect(medal(s, "g13")!.style.opacity).toBe("0");
  });

  /** The crowd's run, a frame every 16 ms: every look at the floor with the medallions left out, and what it asked of its clock and dice. */
  function crowd(
    medallions: boolean,
    reduced: boolean,
  ): { looks: string[]; pooled: number; most: number } {
    const s = stage({ seed: 5, medallions, reduced });
    const looks: string[] = [];
    let most = 0;
    let pooled = -1;
    for (let ms = 0; ms <= 30_000; ms += 250) {
      // What it had asked of its clock and dice before this look: the piers begin in it.
      const asked = `${s.asked.clock} ${s.asked.dice} ${s.woken.times}`;
      s.sync(laneAgents([{ agents: agentsAt(MOCK_CROWD, ms) }]));
      const { medallions: seen, ...rest } = s.peek();
      most = Math.max(most, seen.length);
      if (pooled < 0 && rest.waiting.length) pooled = looks.length;
      const page = s.lane.cloneNode(true) as HTMLElement;
      for (const el of page.querySelectorAll(".oly-medal")) el.remove();
      looks.push(`${JSON.stringify(rest)} ${s.lane.style.height} ${page.innerHTML} ${asked}`);
      s.host.run(250, 16);
    }
    return { looks, pooled, most };
  }

  it("puts nothing on the clock and throws no dice: hung, shown, taken down and moved up, the floor asks for not a step, a wake or a throw more for eight medallions and one unseen than for three", () => {
    // The pool is seen in both, so the piers and the floor are the same: only the medallions differ.
    const run = (n: number): Stage => {
      const s = stage();
      oldestSet(s, n);
      s.host.run(3000, 16);
      return s;
    };
    const few = run(8);
    const many = run(14);
    expect(few.peek().medallions.map((m) => m.key)).toEqual(["g6", "g7"]);
    expect(many.peek().medallions).toHaveLength(8);
    expect(many.peek().waiting).toHaveLength(8);
    expect(many.asked).toEqual(few.asked);
    expect(many.woken).toEqual(few.woken);
  });

  it("a seeded run plays the same with the pool shown as with it unseen until the first god is pooled: every step, place, line, card and throw of the dice (the crowd's run)", () => {
    const shown = crowd(true, false);
    const unseen = crowd(false, false);
    expect(shown.most).toBe(2);
    expect(unseen.most).toBe(0);
    expect(shown.pooled).toBe(1); // the crowd is sent nearly at once
    expect(unseen.pooled).toBe(shown.pooled);
    expect(shown.looks.slice(0, shown.pooled)).toEqual(unseen.looks.slice(0, shown.pooled));
    // From then the piers are part of the run: the floor's edges are in.
    expect(shown.looks[shown.pooled]).not.toBe(unseen.looks[shown.pooled]);
  });

  it("under reduced motion the same run plays the same, shown or unseen, until the first god is pooled", () => {
    const shown = crowd(true, true);
    const unseen = crowd(false, true);
    expect(shown.most).toBe(2);
    expect(shown.pooled).toBe(1); // the crowd is sent nearly at once
    expect(unseen.pooled).toBe(shown.pooled);
    expect(shown.looks.slice(0, shown.pooled)).toEqual(unseen.looks.slice(0, shown.pooled));
  });

  it("under reduced motion a medallion is there or it isn't: no opacity is ever written, it is gone the moment its god is set, and the one under it moves up by a cut", () => {
    const s = stage({ reduced: true });
    s.sync(sent(8));
    for (const el of medals(s)) expect(el.style.opacity).toBe("");
    expect(s.peek().medallions.map((m) => m.shown)).toEqual([1, 1, 1]);
    const frames = s.drawn.frames;
    s.host.run(400, 16);
    expect(s.drawn.frames - frames).toBeLessThanOrEqual(2); // it keeps no frame coming
    oldestSet(s, 8);
    expect(hung(s)).toEqual(["g6 left 0", "g7 right 0"]);
    expect(medal(s, "g7")!.style.transform).toBe("translate(674.50px,4.50px)");
    expect(s.lane.innerHTML).not.toMatch(/oly-medal[^>]*opacity/);
  });

  it("with medallions off the pool waits unseen, as it did; and a lane taken down leaves none hung", () => {
    const off = stage({ medallions: false });
    off.sync(sent(8));
    off.host.advance(2000);
    expect(off.peek().waiting).toEqual(["g5", "g6", "g7"]);
    expect(medals(off)).toEqual([]);
    expect(off.peek().medallions).toEqual([]);
    const on = stage();
    on.sync(sent(8));
    on.host.advance(POOL.widen);
    expect(medals(on)).toHaveLength(3);
    on.dispose();
    expect(medals(on)).toEqual([]);
    expect(on.peek().medallions).toEqual([]);
  });

  // ── O8c: a medallion is a control ──
  const failing = (n: number, key: string): LaneAgent[] =>
    sent(n).map((a) => (a.key === key ? { ...a, look: "fail" } : a));
  const tiltOf = (el: HTMLElement): number =>
    Number(/rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)?.[1] ?? 0);
  const asked = (s: Stage): string => JSON.stringify([s.asked, s.woken]);
  /** Eight sent, five at their work, three hung and through: g6 on the left pier, g5 over g7 on the right. */
  function hungStill(options: Parameters<typeof stage>[0] = {}): Stage {
    const s = stage(options);
    s.sync(sent(8));
    settle(s, 5);
    s.host.advance(POOL.widen + POOL.set + POOL.reveal);
    expect(hung(s)).toEqual(["g5 right 0", "g6 left 0", "g7 right 1"]);
    return s;
  }

  it("a hung medallion is in the gods' one toolbar: the left pier's, the gods along the lane, then the right pier's top to bottom, and it takes the tab stop and the ring as a god does", () => {
    const s = hungStill();
    const stops = (): Element[] => [...s.lane.querySelectorAll('[tabindex="0"]')];
    expect(stops()).toHaveLength(1);
    // The first hung took it, the lane being empty yet, and keeps it.
    expect(stops()).toEqual([medal(s, "g5")]);
    const byX = [...s.peek().gods].sort((a, b) => a.x - b.x).map((god) => s.cell(god.key)!);
    const order = [medal(s, "g6")!, ...byX, medal(s, "g5")!, medal(s, "g7")!];
    keydown(byX[2]!, "Home");
    const walked: (Element | null)[] = [document.activeElement];
    for (let i = 1; i < order.length; i++) {
      keydown(document.activeElement!, "ArrowRight");
      walked.push(document.activeElement);
    }
    expect(walked).toEqual(order);
    keydown(document.activeElement!, "ArrowRight"); // the end: it stays
    expect(document.activeElement).toBe(medal(s, "g7"));
    expect(stops()).toEqual([medal(s, "g7")]);
    expect(medal(s, "g7")!.classList.contains("is-focus")).toBe(true);
    expect(medal(s, "g5")!.classList.contains("is-focus")).toBe(false);
    keydown(document.activeElement!, "Home");
    expect(document.activeElement).toBe(medal(s, "g6"));
    expect(stops()).toEqual([medal(s, "g6")]);
    keydown(document.activeElement!, "End");
    expect(document.activeElement).toBe(medal(s, "g7"));
    // The ring is the keyboard's: a press of the pointer puts it away.
    press();
    expect(s.lane.querySelector(".oly-medal.is-focus")).toBeNull();
    s.dispose();
  });

  it("a medallion leaves the toolbar the moment it is taken down: focus on it goes to its god as that is set, and from one that ended waiting to the nearest left in the toolbar", () => {
    const s = hungStill();
    const m5 = medal(s, "g5")!;
    keydown(s.cells()[0]!, "End");
    keydown(document.activeElement!, "ArrowLeft");
    expect(document.activeElement).toBe(m5);
    s.sync(failing(8, "g0"));
    until(s, () => s.peek().gods.some((god) => god.key === "g5"));
    expect(m5.isConnected).toBe(true); // still going
    expect(m5.getAttribute("aria-hidden")).toBe("true");
    expect(m5.getAttribute("tabindex")).toBe("-1");
    expect(m5.classList.contains("is-focus")).toBe(false);
    expect(document.activeElement).toBe(s.cell("g5"));
    expect(s.cell("g5")!.getAttribute("tabindex")).toBe("0");
    // It is no longer reached: the end of the toolbar is the one that hung under it.
    keydown(document.activeElement!, "End");
    const m7 = medal(s, "g7")!;
    expect(document.activeElement).toBe(m7);
    keydown(m7, "ArrowLeft");
    expect(document.activeElement!.classList.contains("oly-cell")).toBe(true);
    // One that ends while it waits: focus goes to the nearest left, the god furthest right.
    keydown(document.activeElement!, "End");
    expect(document.activeElement).toBe(m7);
    s.sync(failing(8, "g0").filter((a) => a.key !== "g7"));
    s.host.advance(0);
    expect(m7.getAttribute("aria-hidden")).toBe("true");
    const last = [...s.peek().gods].sort((a, b) => b.x - a.x)[0]!;
    expect(document.activeElement).toBe(s.cell(last.key));
    expect(s.lane.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    s.dispose();
  });

  it("a medallion's card is its row's, as a god's is: on the pointer and on focus, its foot over the peg and its caret on the medallion, Esc hiding it, and not a step, wake or throw asked for it", () => {
    const s = hungStill();
    const before = asked(s);
    const foot = CELL_Y + POOL.y - POOL.peg - 4 - CARD_AIR; // the cell's top is 4px down the floor
    enter(medal(s, "g6"));
    expect(s.peek().card).toEqual({ key: "g6", left: 6, foot, caret: 16 });
    expect(s.cards[s.cards.length - 1]).toBe("g6");
    expect(s.card.style.transform).toBe("translate3d(6.00px, 0, 0)");
    expect(s.card.style.getPropertyValue("--oly-ty")).toBe(`${foot.toFixed(1)}px`);
    expect(s.card.style.getPropertyValue("--oly-caret")).toBe("16.0px");
    // Esc hides the one the pointer holds up, and lets the key go on.
    expect(keydown(document.body, "Escape").defaultPrevented).toBe(false);
    expect(s.peek().card).toBeNull();
    leave(medal(s, "g6"));
    press();
    // On focus, from the keyboard: the lower one on the right pier, its card as far right as it goes.
    keydown(s.cells()[0]!, "End");
    expect(document.activeElement).toBe(medal(s, "g7"));
    expect(s.peek().card).toEqual({
      key: "g7",
      left: 698 - 6 - TIP_W,
      foot: foot + POOL.pitch,
      caret: TIP_W - 16,
    });
    // Esc hides the one shown for the keyboard, and uses the key up; it shows again as focus moves.
    expect(keydown(document.activeElement!, "Escape").defaultPrevented).toBe(true);
    expect(s.peek().card).toBeNull();
    keydown(document.activeElement!, "ArrowLeft");
    expect(s.peek().card?.key).toBe("g5");
    expect(s.peek().card?.foot).toBe(foot);
    expect(asked(s)).toBe(before);
    s.dispose();
  });

  it("a press, Enter or Space rocks a medallion on its peg: cut to its god's tilt, the bottom toward the lane, back through a third of it to rest; a second press soon rocks it half as far; a wake for each press, none without", () => {
    const s = hungStill({ startle: true });
    const el = medal(s, "g5")!; // Herodotus, on the right pier
    expect(el.classList.contains("is-startable")).toBe(true);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
    const { tilt } = CAST.gods.herodotus.medal;
    const step = CAST.gods.herodotus.step;
    const wakes = s.woken.times;
    const steps = s.asked.clock - wakes;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.woken.times).toBe(wakes + 1);
    until(s, () => tiltOf(el) !== 0, step / 4 + 1);
    expect(tiltOf(el)).toBeCloseTo(tilt, 1); // the cut, on its quarter-beat
    expect(el.style.transformOrigin).toBe(`50% -${POOL.peg}px`);
    expect(el.style.transform).toMatch(/^translate\(674\.50px,4\.50px\) rotate\(/);
    // Pressed again while it rocks: nothing more than the wake.
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const half = (CAST.gods.herodotus.st.beats * step) / 2;
    s.host.advance(half);
    expect(tiltOf(el)).toBeCloseTo(-tilt * POOL.back, 1);
    s.host.advance(half);
    expect(el.style.transform).toBe("translate(674.50px,4.50px)");
    expect(el.style.transformOrigin).toBe("");
    // Again soon, by Enter: half the tilt, for the startle's shorter beats.
    expect(keydown(el, "Enter").defaultPrevented).toBe(true);
    keydown(el, "Enter", { repeat: true }); // held: once
    let most = 0;
    const again = CAST.startle.againBeats * step;
    for (let ms = 0; ms < again + step / 4; ms++) {
      s.host.advance(1);
      most = Math.max(most, Math.abs(tiltOf(el)));
    }
    expect(most).toBeCloseTo(tilt * POOL.again, 1);
    expect(tiltOf(el)).toBe(0);
    // Space, on the left pier: the other way, its bottom toward the lane too.
    const left = medal(s, "g6")!; // Hephaestus
    expect(keydown(left, " ").defaultPrevented).toBe(true);
    until(s, () => tiltOf(left) !== 0, CAST.gods.hephaestus.step / 4 + 1);
    expect(tiltOf(left)).toBeCloseTo(-CAST.gods.hephaestus.medal.tilt, 1);
    // A wake for each press, the held key apart; and not a step or a throw.
    expect(s.woken.times).toBe(wakes + 4);
    expect(s.asked.clock - s.woken.times).toBe(steps);
    // With startles off it has nothing to press, says so, and a press wakes nothing.
    const off = hungStill();
    const still = medal(off, "g5")!;
    expect(still.classList.contains("is-startable")).toBe(false);
    expect(still.getAttribute("aria-disabled")).toBe("true");
    const quiet = asked(off);
    still.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    keydown(still, "Enter");
    off.host.advance(1000);
    expect(tiltOf(still)).toBe(0);
    expect(asked(off)).toBe(quiet);
    s.dispose();
    off.dispose();
  });

  it("one being set, or taken down, is not rocked; and a rock is over the moment its medallion is taken down", () => {
    const s = stage({ startle: true });
    s.sync(sent(8));
    s.host.advance(POOL.widen + POOL.set); // hung, and not yet through
    const el = medal(s, "g5")!;
    expect(el.classList.contains("is-startable")).toBe(false);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    s.host.advance(POOL.reveal);
    expect(el.classList.contains("is-startable")).toBe(true);
    settle(s, 5);
    expect(tiltOf(el)).toBe(0);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    until(s, () => tiltOf(el) !== 0, 200);
    s.sync(failing(8, "g0"));
    until(s, () => s.peek().gods.some((god) => god.key === "g5"));
    expect(tiltOf(el)).toBe(0);
    expect(el.classList.contains("is-startable")).toBe(false);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    s.host.advance(200);
    expect(tiltOf(el)).toBe(0);
    s.dispose();
  });

  it("under reduced motion a rock is a still: the whole tilt, held twice its beats, then at rest, and nothing is ever part way", () => {
    const s = hungStill({ reduced: true, startle: true });
    const el = medal(s, "g5")!;
    const { tilt } = CAST.gods.herodotus.medal;
    const held = 2 * CAST.gods.herodotus.st.beats * CAST.gods.herodotus.step;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const seen = new Set<number>();
    let ms = 0;
    for (let t = 0; t < held + 400; t += 10) {
      s.host.advance(10);
      seen.add(tiltOf(el));
      if (tiltOf(el) !== 0) ms += 10;
      expect(el.style.cssText).not.toMatch(/opacity|scale\(|height/);
    }
    expect([...seen].sort()).toEqual([0, tilt]);
    expect(ms).toBe(held);
    expect(el.style.transform).toBe("translate(674.50px,4.50px)");
    s.dispose();
  });

  it("a run nobody presses asks what it did at ffd08552, before a medallion was a control: every step, wake and throw; and pointing at the medallions and tabbing through them asks nothing more", () => {
    const run = (meddle: boolean): string => {
      const s = stage({ startle: true });
      oldestSet(s, 8);
      for (let ms = 0; ms < 3000; ms += 100) {
        if (meddle) {
          const els = medals(s);
          const el = els[(ms / 100) % els.length]!;
          enter(el);
          keydown(s.cells()[0]!, ms % 200 ? "End" : "Home");
          keydown(document.activeElement!, "ArrowLeft");
          leave(el);
          if (ms % 700 === 0) keydown(document.body, "Escape");
        }
        s.host.run(100, 16);
      }
      const out = asked(s);
      s.dispose();
      return out;
    };
    expect(run(false)).toBe(UNPRESSED_ASKED);
    expect(run(true)).toBe(UNPRESSED_ASKED);
  });
});

/** What the no-pool run below asks of its clock and dice, and its wakes: the same at 5385559c, before the piers. */
const NO_POOL_ASKED = '[{"clock":56,"dice":41},{"times":0}]';

describe("the piers: the antae widen for the pool's medallions, and the floor's edges move in", () => {
  const CROWD: readonly GodId[] = [
    "athena",
    "hermes",
    "argus",
    "themis",
    "nike",
    "herodotus",
    "hephaestus",
  ];
  const sent = (n: number, tag = "g"): LaneAgent[] =>
    CROWD.slice(0, n).map((god, i) => agent(`${tag}${i}`, god));
  const POOL = CAST.pool;
  const W = 698;
  const NARROW = { width: POOL.anta, wide: false, edges: [16, W - 16] };
  const widths = (s: Stage): string[] =>
    [...s.lane.querySelectorAll<HTMLElement>(".oly-anta")].map((el) => el.style.width);
  const medals = (s: Stage): HTMLElement[] => [
    ...s.lane.querySelectorAll<HTMLElement>(".oly-medal"),
  ];
  /** Five at their work on the whole floor, two of them at its ends; then a sixth is sent, the first pooled. */
  function sixth(s: Stage): void {
    s.sync(sent(5));
    settle(s, 5);
    s.sync(sent(6));
  }

  it("moves the floor's edges in to 34 px a side as the first god is pooled, and a god whose place would cross one steps in, the least it can: to the edge; nobody else moves", () => {
    const s = stage();
    s.sync(sent(5));
    settle(s, 5);
    expect(s.peek().piers).toEqual(NARROW);
    const before = new Map(s.peek().gods.map((god) => [god.key, god.place!]));
    const outside = [...before].filter(([, [a, b]]) => a < POOL.edge || b > W - POOL.edge);
    expect(outside.map(([key]) => key)).toEqual(["g0", "g3"]);
    s.sync(sent(6));
    expect(s.peek().waiting).toEqual(["g5"]);
    expect(s.peek().piers.edges).toEqual([POOL.edge, W - POOL.edge]);
    for (const god of s.peek().gods) {
      if (god.key === "g0") expect(god.place![1]).toBeCloseTo(W - POOL.edge, 6);
      else if (god.key === "g3") expect(god.place![0]).toBeCloseTo(POOL.edge, 6);
      else expect(god.place).toEqual(before.get(god.key));
    }
    expect(out(s, "g0").step).toBe("walk");
    settle(s, 5);
    for (const god of s.peek().gods) {
      expect(god.figure[0]).toBeGreaterThanOrEqual(POOL.edge);
      expect(god.figure[1]).toBeLessThanOrEqual(W - POOL.edge);
    }
  });

  it("the piers wait while a god is in their way, and widen once it has stepped in: they never come over anyone, and no medallion hangs before", () => {
    const s = stage();
    sixth(s);
    const inWay = (): boolean =>
      s.peek().gods.some((god) => god.figure[0] < POOL.pier || god.figure[1] > W - POOL.pier);
    expect(inWay()).toBe(true);
    expect(widths(s)).toEqual(["", ""]);
    let began = -1;
    for (let ms = 0; ms <= 2000; ms += 10) {
      const { piers } = s.peek();
      if (piers.width > POOL.anta) {
        if (began < 0) began = ms;
        expect(inWay()).toBe(false);
      } else expect(medals(s)).toHaveLength(0);
      if (!piers.wide) expect(medals(s)).toHaveLength(0);
      s.host.advance(10);
    }
    expect(began).toBeGreaterThan(100);
    expect(s.peek().piers).toMatchObject({ width: POOL.pier, wide: true });
    expect(widths(s)).toEqual(["30px", "30px"]);
    expect(medals(s).map((el) => el.dataset.key)).toEqual(["g5"]);
  });

  it("both widen together from 12 to 30 px over 300 ms, eased, and stay wide while the lane is open; once wide they keep no frame coming", () => {
    const s = stage();
    s.sync(sent(6)); // nobody has landed yet: nothing is in their way
    expect(widths(s)).toEqual(["", ""]);
    expect(s.peek().piers).toEqual({ ...NARROW, edges: [POOL.edge, W - POOL.edge] });
    s.host.advance(POOL.widen / 4);
    expect(widths(s)).toEqual(["14.81px", "14.81px"]);
    s.host.advance(POOL.widen / 4);
    expect(widths(s)).toEqual(["21px", "21px"]);
    s.host.advance(POOL.widen / 2 - 1);
    expect(s.peek().piers.wide).toBe(false);
    s.host.advance(1);
    expect(widths(s)).toEqual(["30px", "30px"]);
    expect(s.peek().piers).toMatchObject({ width: POOL.pier, wide: true });
    settle(s, 5);
    s.host.advance(9000);
    expect(widths(s)).toEqual(["30px", "30px"]);
    for (const god of s.peek().gods) {
      expect(god.place![0]).toBeGreaterThanOrEqual(POOL.edge - 1e-6);
      expect(god.place![1]).toBeLessThanOrEqual(W - POOL.edge + 1e-6);
    }
  });

  it("a medallion hangs only once the piers are wide, and is set from then; one pooled later hangs at once; whatever frames fall", () => {
    const s = stage();
    s.sync(sent(6));
    expect(s.peek().waiting).toEqual(["g5"]);
    expect(medals(s)).toHaveLength(0);
    s.host.advance(POOL.widen - 1);
    expect(medals(s)).toHaveLength(0);
    s.host.advance(1);
    expect(medals(s).map((el) => el.dataset.key)).toEqual(["g5"]);
    expect(medals(s)[0]!.style.opacity).toBe("0");
    s.host.advance(POOL.set + POOL.reveal / 2);
    expect(medals(s)[0]!.style.opacity).toBe("0.5");
    const asked = { ...s.asked };
    s.sync(sent(7));
    expect(medals(s).map((el) => el.dataset.key)).toEqual(["g5", "g6"]);
    for (const every of [7, 16, 33, 100]) {
      const paced = stage();
      paced.sync(sent(6));
      paced.host.run(POOL.widen + POOL.set + POOL.reveal / 2, every);
      expect(medals(paced)[0]!.style.opacity).toBe("0.5");
      expect(paced.asked).toEqual(asked);
    }
  });

  it("under reduced motion the piers are wide at once, or the moment nothing is in their way: a width is only ever the anta's or the pier's", () => {
    const s = stage({ reduced: true });
    s.sync(sent(6));
    expect(widths(s)).toEqual(["30px", "30px"]);
    expect(s.peek().piers).toMatchObject({ width: POOL.pier, wide: true });
    expect(medals(s).map((el) => el.dataset.key)).toEqual(["g5"]);
    const late = stage({ reduced: true });
    sixth(late);
    const seen = new Set<string>();
    for (let ms = 0; ms <= 3000; ms += 16) {
      seen.add(widths(late).join());
      if (!late.peek().piers.wide) expect(medals(late)).toHaveLength(0);
      late.host.advance(16);
    }
    for (const w of seen) expect([",", "30px,30px"]).toContain(w);
    expect(widths(late)).toEqual(["30px", "30px"]);
    expect(medals(late)).toHaveLength(1);
  });

  it("a run with no pool in it plays as it did, the piers held off or not: every look, step, wake and throw; the antae are never written and the edges stay out", () => {
    const run = (medallions: boolean): { looks: string[]; asked: string; widths: string[] } => {
      const s = stage({ seed: 5, medallions, fidget: true, react: true });
      const looks: string[] = [];
      for (let ms = 0; ms <= 24_000; ms += 250) {
        const done = ms >= 14_000 ? "g1" : "";
        s.sync(sent(5).map((a) => (a.key === done ? { ...a, look: "done" as const } : a)));
        expect(s.peek().piers).toEqual(NARROW);
        looks.push(`${JSON.stringify(s.peek())} ${s.lane.style.height} ${s.lane.innerHTML}`);
        s.host.run(250, 16);
      }
      expect(s.peek().waiting).toEqual([]);
      return { looks, asked: JSON.stringify([s.asked, s.woken]), widths: widths(s) };
    };
    const on = run(true);
    const off = run(false);
    expect(on.widths).toEqual(["", ""]);
    expect(on.looks).toEqual(off.looks);
    expect(on.asked).toBe(off.asked);
    expect(on.asked).toBe(NO_POOL_ASKED);
  });

  it("is 12 px again when the lane shuts, its edges out; stays so through an opening with no pool; and widens anew at the next with one", () => {
    const s = stage();
    s.sync(sent(6));
    s.host.advance(POOL.widen);
    expect(widths(s)).toEqual(["30px", "30px"]);
    s.sync(sent(6).map((a) => ({ ...a, look: "done" as const })));
    until(s, () => !s.peek().open);
    expect(widths(s)).toEqual(["", ""]);
    expect(s.peek().piers).toEqual(NARROW);
    expect(medals(s)).toHaveLength(0);
    s.sync(sent(2, "h"));
    settle(s, 2);
    expect(widths(s)).toEqual(["", ""]);
    expect(s.peek().piers).toEqual(NARROW);
    s.sync(sent(2, "h").map((a) => ({ ...a, look: "done" as const })));
    until(s, () => !s.peek().open);
    s.sync(sent(6, "k"));
    expect(widths(s)).toEqual(["", ""]);
    expect(medals(s)).toHaveLength(0);
    s.host.advance(POOL.widen / 2);
    expect(widths(s)).toEqual(["21px", "21px"]);
    s.host.advance(POOL.widen / 2);
    expect(widths(s)).toEqual(["30px", "30px"]);
    expect(medals(s).map((el) => el.dataset.key)).toEqual(["k5"]);
  });
});
