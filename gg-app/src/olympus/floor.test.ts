// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { CAST, POSE_URLS, type Skill } from "./cast";
import {
  agentsAt,
  framedHost,
  type ManualHost,
  MOCK_CROWD,
  MOCK_RUN,
  SENT_ON_AGAIN,
  STATE_AGENTS,
} from "./fixtures";
import { createFloor, rng, type FloorPeek, type LaneAgent, type LaneLook } from "./floor";
import type { GodId } from "./gods";
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
  /** How often the floor has put a step on the clock or woken it, and drawn its dice. */
  readonly asked: { clock: number; dice: number };
  names(): string[];
  setWidth(width: number): void;
  resize(): void;
  dispose(): void;
}

/** Every floor a test has made: each is taken down after it, with its listeners on the page. */
const stages: { dispose(): void }[] = [];

/**
 * A lane with a clock that moves only when told to, and draws a frame for the
 * moment each advance ends on (framedHost); a letter is 5.5px wide.
 */
function stage({ seed = 7, width = 698, letter = 5.5, reduced = false } = {}): Stage {
  const lane = document.createElement("div");
  lane.className = "oly-lane is-shut";
  lane.innerHTML =
    '<div class="oly-gods"></div><div class="oly-stylobate"><div class="oly-names"></div></div>';
  const card = document.createElement("div");
  card.className = "oly-card";
  const box = document.createElement("textarea");
  document.body.append(card, lane, box);
  const host = framedHost();
  let w = width;
  const asked = { clock: 0, dice: 0 };
  const cards: (string | null)[] = [];
  const clock = createSim(host);
  const sim: Sim = {
    ...clock,
    at: (t, fn) => (asked.clock++, clock.at(t, fn)),
    after: (ms, fn) => (asked.clock++, clock.after(ms, fn)),
    soon: (fn) => (asked.clock++, clock.soon(fn)),
    wake: () => (asked.clock++, clock.wake()),
  };
  const dice = rng(seed);
  const floor = createFloor(lane, {
    sim,
    cast: CAST,
    poses: POSE_URLS,
    random: () => (asked.dice++, dice()),
    width: () => w,
    measure: (el) => Math.round((el.textContent ?? "").length * letter) + 21,
    reduced: () => reduced,
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
    asked,
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
    dispose: () => floor.dispose(),
  };
}

const shut = (s: Stage): boolean => s.lane.classList.contains("is-shut");

// ── Part 5: a god's turn, ms ──
const LAND = 500; // after the lane opens
const FADE = 240; // a god shows as it is set, and goes
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

  it("falls a beat after the last god has gone, and is shut once it is down; not while one is left", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "hermes")]);
    settle(s, 2);
    s.sync([agent("a", "athena", "fail"), agent("b", "hermes")]);
    s.host.advance(FAIL_HOLD + FADE); // the failed one has gone
    expect(s.cells()).toHaveLength(1);
    s.host.advance(5000);
    expect(shut(s)).toBe(false);
    s.sync([agent("a", "athena", "fail"), agent("b", "hermes", "stop")]);
    s.host.advance(FAIL_HOLD + FADE);
    expect(s.cells()).toHaveLength(0);
    expect(s.peek().lane).toEqual({ mode: "open", height: 125 });
    s.host.advance(599);
    expect(s.peek().lane.mode).toBe("open");
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
    s.host.advance(600 + 360);
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
    // Open: its height is the stylesheet's again, and it sleeps until the first god lands.
    expect(s.peek().lane).toEqual({ mode: "open", height: 125 });
    expect(s.lane.style.height).toBe("");
    expect(s.host.pending()).toBe(1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(LAND - 420);
    expect(s.cells()).toHaveLength(1); // 80ms after it is up
  });

  it("falls as it shuts: 360ms, slow at first", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.advance(3000);
    s.sync([]);
    s.host.advance(600);
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
    s.host.advance(600 + 100);
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
  it("sets the first god a beat after the lane opens, beside its place, and it shows over 240ms", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(LAND - 1);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    const cell = s.cell("a")!;
    expect(cell.dataset.god).toBe("hermes");
    expect(cell.dataset.pose).toBe("speak");
    expect(out(s)).toMatchObject({ step: "appear", shown: 0, line: null });
    expect(figure(cell).style.opacity).toBe("0");
    expect(s.label("a")!.style.opacity).toBe("0");
    // Beside its place: 44 to 96px from it, where it will walk from.
    const from = out(s).x;
    const away = Math.abs(from - seatOf(out(s)));
    expect(away).toBeGreaterThanOrEqual(44 - 1e-6);
    expect(away).toBeLessThanOrEqual(96);
    expect(cell.style.transform).toBe(`translate3d(${from.toFixed(2)}px, 0, 0)`);
    s.host.advance(FADE / 2);
    expect(out(s).shown).toBeCloseTo(0.5, 6);
    expect(figure(cell).style.opacity).toBe("0.5");
    expect(s.label("a")!.style.opacity).toBe("0.5");
    expect(ribbonOf(cell)).toBeNull();
    s.host.advance(FADE / 2);
    // There, and greeting, where it was set.
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
    s.host.advance(LAND + FADE);
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
    s.host.advance(260); // 500ms after the lane opened
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
    "%s: a farewell, the seal pressed on its scroll, and it walks off and goes",
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
      until(s, () => out(s).step === "fade");
      const off = out(s).x - at;
      expect(Math.sign(off)).toBe(at + 33 < 698 / 2 ? -1 : 1);
      expect(Math.abs(off)).toBeGreaterThan(3 * 34 - 1e-6); // three or four of Argus's strides
      expect(Math.abs(off)).toBeLessThan(4 * 34 + 1e-6);
      // And it goes, over 240ms, its name with it.
      s.host.advance(FADE / 2);
      expect(figure(cell).style.opacity).toBe("0.5");
      expect(s.label("it")!.style.opacity).toBe("0.5");
      s.host.advance(FADE / 2 - 1);
      expect(s.cells()).toHaveLength(1);
      s.host.advance(1);
      expect(s.cells()).toHaveLength(0);
      expect(s.names()).toEqual([]);
    },
  );

  it("failed: it stands, dims and cracks, 3s in all without a word, and goes over 240ms", () => {
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
    expect(out(s)).toMatchObject({ step: "fade", place: null });
    s.host.advance(FADE / 2);
    expect(figure(cell).style.opacity).toBe("0.5");
    expect(cell.classList.contains("is-cracked")).toBe(true); // dimmed and cracked as it goes
    s.host.advance(FADE / 2 - 1);
    expect(s.cells()).toHaveLength(1);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(0);
  });

  it.each([
    ["interrupted", one("interrupted")],
    ["unfinished in a stopped run", one("running", true)],
    ["failed in a stopped run", one("error", true)],
  ] as const)(
    "%s: it dims with no crack, 3s in all without a word, and goes where it stands",
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
      // Not broken: it goes as a done god does, but from where it stands.
      expect(out(s)).toMatchObject({ step: "fade", x: at, place: null });
      expect(cell.classList.contains("is-cracked")).toBe(false);
      s.host.advance(FADE - 1);
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
    s.host.advance(LAND + FADE + 400);
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
    s.host.advance(600 + 360);
    expect(shut(s)).toBe(true);
  });

  it("sent on again after it has gone: it lands again, with a greeting", () => {
    const s = stage();
    const at = (i: number): LaneAgent[] => laneAgents([{ agents: [SENT_ON_AGAIN[i]!] }]);
    s.sync(at(0));
    settle(s);
    s.sync(at(1)); // idle
    until(s, () => s.cells().length === 0);
    s.host.advance(600 + 360);
    expect(shut(s)).toBe(true);
    s.sync(at(2)); // sent on again
    expect(shut(s)).toBe(false);
    s.host.advance(LAND + FADE);
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
    until(s, () => out(s).step === "fade");
    s.host.advance(FADE - 1);
    expect(out(s).step).toBe("fade");
    s.host.advance(1); // gone, and set again in the same moment
    expect(s.cells()).toHaveLength(1);
    expect(out(s)).toMatchObject({ step: "appear", pose: "speak", shown: 0 });
    expect(s.cell("s-again")!.classList.contains("is-sealed")).toBe(false);
    s.host.advance(FADE);
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
  });

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
    s.host.advance(FAIL_HOLD + FADE - 1);
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
    s.host.advance(3000 + 600 + 500);
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
    s.host.advance(LAND + FADE + 100);
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
    s.host.advance(LAND + FADE);
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
    s.host.advance(500);
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
    s.host.advance(LAND + FADE + 400); // in the middle of its greeting
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
    expect(watch(s, FAIL_HOLD + FADE - 10)).toEqual(["stand"]);
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
      s.host.advance(600 + 360);
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
      until(s, () => s.peek().gods[0]!.step === "appear");
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
    s.host.advance(LAND + FADE + LINE);
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
    expect(nike.host.now()).toBe(LAND + FADE + LINE + nike.ms);
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
    expect(straight.host.now()).toBe(LAND + FADE + LINE + straight.ms);
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
    expect(steps.slice(-2)).toEqual(["seal", "fade"]);
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
    expect(out(s)).toMatchObject({ step: "appear", pose: "speak" });
    enter(s.cell("a"));
    expect(s.peek().card).toEqual(placeOf(s, "a", top.speak)); // up while it is set
    s.host.advance(FADE);
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
    // It begins to go: its card is down, 240ms before it is gone.
    expect(out(s, "argus")).toMatchObject({ step: "fade" });
    expect(s.peek().card).toBeNull();
    expect(s.cards).toEqual(["argus", null]);
    s.host.advance(FADE);
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
    s.host.advance(500);
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
    s.host.advance(500);
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
    s.host.advance(FAIL_HOLD + FADE - 1);
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
    expect(out(s, "nike").step).toBe("fade");
    expect(s.peek().card).toBeNull();
    expect(document.activeElement).toBe(cell);
    s.host.advance(FADE / 2);
    expect(label.classList.contains("is-focus")).toBe(true);
    expect(label.style.opacity).toBe("0.5");
    expect(document.activeElement).toBe(cell);
    s.host.advance(FADE / 2);
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
        s.lane.innerHTML.replace(/ tabindex="-?\d"/g, "").replace(/oly-ins is-focus/g, "oly-ins"),
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
      s.host.advance(LAND + FADE + 400);
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
