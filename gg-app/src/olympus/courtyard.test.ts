// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAST, FRAME_URLS, POSE_URLS } from "./cast";
import { COURT, planCourt, route, routeMs } from "./court-plan";
import {
  createCourtyard,
  type CourtAgent,
  type CourtOptions,
  type CourtPeek,
  type Courtyard,
} from "./courtyard";
import { countingBrush, framedHost, type CountingBrush, type ManualHost } from "./fixtures";
import type { GodId } from "./gods";
import { SET_END } from "./mosaic";
import { createSim } from "./sim";

// jsdom draws nothing: the floors' canvases count what is drawn on them.
let brush: CountingBrush;
let canvas: { mockRestore(): void };
beforeEach(() => {
  brush = countingBrush();
  canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((() => brush.ctx) as unknown as HTMLCanvasElement["getContext"]);
});
afterEach(() => {
  canvas.mockRestore();
  document.body.replaceChildren();
});

interface Staged {
  readonly host: ManualHost;
  readonly root: HTMLElement;
  readonly court: Courtyard;
  readonly hovers: (string | null)[];
  width: number;
}

// A courtyard on a clock that moves only when told to; its gods hold still unless asked to fidget.
function staged(over: Partial<CourtOptions> = {}): Staged {
  const host = framedHost();
  const root = document.createElement("div");
  root.className = "oly-court";
  document.body.append(root);
  const stage: Staged = { host, root, court: null as unknown as Courtyard, hovers: [], width: 698 };
  (stage as { court: Courtyard }).court = createCourtyard(root, {
    sim: createSim(host),
    cast: CAST,
    poses: POSE_URLS,
    frames: FRAME_URLS,
    width: () => stage.width,
    reduced: () => false,
    fidget: false,
    onHover: (key) => stage.hovers.push(key),
    ...over,
  });
  return stage;
}

const A = (
  key: string,
  god: GodId,
  status: CourtAgent["status"],
  family: CourtAgent["family"],
  label = key,
): CourtAgent => ({ key, god, status, family, label });
type Peeked = CourtPeek["gods"][number];
const godOf = (court: Courtyard, key: string): Peeked =>
  court.peek().gods.find((g) => g.key === key)!;
const cellOf = (root: HTMLElement, key: string): HTMLElement =>
  root.querySelector<HTMLElement>(`.oly-cell[data-key="${key}"]`)!;
const names = (root: HTMLElement): string[] =>
  [...root.querySelectorAll(".oly-ins")].map((el) => el.textContent ?? "");

const OPEN = SET_END + 2 * 260 + 400; // every floor laid, and every god shown
const plan = planCourt(698);

describe("the stage", () => {
  it("is three terraces from the summit down, each a floor over a step, two flights and the hearth", () => {
    const { root, court, host } = staged();
    host.advance(0);
    const terraces = [...root.querySelectorAll<HTMLElement>(".oly-terrace")];
    expect(terraces.map((el) => el.dataset.scene)).toEqual(["temple", "grove", "agora"]);
    for (const el of terraces) {
      expect(el.querySelector("canvas.oly-court-floor")).not.toBeNull();
      expect(el.querySelector(".oly-stylobate .oly-marble")).not.toBeNull();
    }
    expect(root.querySelectorAll(".oly-court-stairs .oly-flight")).toHaveLength(2);
    // Nine steps a flight, each with its nosing.
    expect(
      root.querySelectorAll(".oly-flight:first-child .oly-flight-nose-1:not(.oly-flight-course)"),
    ).toHaveLength(COURT.stair.steps);
    const hearth = root.querySelector<HTMLElement>(".oly-hearth")!;
    expect(hearth.dataset.state).toBe("idle");
    expect(hearth.style.transform).toBe(`translate3d(${plan.hearth - 22}px, 0, 0)`);
    expect(root.querySelector(".oly-gods")?.childElementCount).toBe(0);
    expect(court.peek()).toMatchObject({ width: 698, gods: [], off: [] });
  });

  it("sets each floor stone by stone as it opens, from the ground up, and then draws no more", () => {
    const { court, host } = staged();
    host.advance(100);
    expect(court.peek().floors).toEqual(["set", "bare", "bare"]);
    host.advance(500);
    expect(court.peek().floors).toEqual(["set", "set", "set"]);
    expect(brush.filled).toBeGreaterThan(0);
    host.run(SET_END);
    expect(court.peek().floors).toEqual(["shown", "shown", "shown"]);
    // Nothing moves now: nothing is drawn, and nothing waits on the clock.
    const { filled } = brush;
    host.run(3000);
    expect(brush.filled).toBe(filled);
    expect(host.pending()).toBe(0);
  });

  it("is emptied when it is disposed of, and hears nothing after", () => {
    const { root, court, host } = staged();
    court.sync([A("w1", "athena", "working", "look")], "working");
    host.advance(OPEN);
    court.dispose();
    expect(root.childElementCount).toBe(0);
    court.sync([A("w2", "hermes", "working", "run")], "working");
    court.resize();
    host.run(2000);
    expect(root.childElementCount).toBe(0);
    expect(host.pending()).toBe(0);
  });
});

describe("as the stage opens", () => {
  const crew = [
    A("w1", "athena", "working", "look", "owl"),
    A("w2", "herodotus", "working", "web", "researcher"),
    A("w3", "hephaestus", "working", "make", "bee"),
    A("w4", "hermes", "working", "run", "worker"),
    A("w5", "themis", "working", "think", "skeptic"),
    A("w6", "nike", "idle", "run", "Agent 6"),
  ];

  it("each worker is where its kind of work is done, by a cut, in its tool's pose", () => {
    const { root, court, host } = staged();
    court.sync(crew, "working");
    host.advance(0);
    const at = court.peek().gods.map((g) => [g.key, g.zone, g.slot, g.x, g.lift, g.pose, g.dir]);
    expect(at).toEqual([
      ["w1", "look", 0, 258, 126, "look", 1],
      ["w2", "web", 0, 499, 126, "web", -1],
      ["w3", "make", 0, 170, 0, "make", 1],
      ["w4", "run", 0, 431, 0, "run", -1],
      // Thinking, with no tool yet: by the gate, with its scales.
      ["w5", "make", 1, 48, 0, "think-r", 1],
      // Idle: where its last tool's work is done, standing.
      ["w6", "run", 1, 309, 0, "stand", -1],
    ]);
    expect(court.peek().gods.some((g) => g.walking)).toBe(false);
    // Its worker's name is carved under it.
    expect(names(root)).toEqual(["owl", "researcher", "bee", "worker", "skeptic", "Agent 6"]);
    const cell = cellOf(root, "w1");
    expect(cell.dataset.pose).toBe("look");
    expect(cell.style.transform).toBe(`translate3d(${258 - 33}.00px, -126px, 0)`);
    expect(cellOf(root, "w2").classList.contains("is-left")).toBe(true);
  });

  it("each shows as its terrace's last stones go down", () => {
    const { court, host } = staged();
    court.sync(crew, "working");
    host.advance(0);
    expect(court.peek().gods.map((g) => g.shown)).toEqual([0, 0, 0, 0, 0, 0]);
    host.advance(SET_END - 160);
    // Half way in on the agora; the grove's are a floor's stagger behind.
    expect(godOf(court, "w3").shown).toBeCloseTo(0.5);
    expect(godOf(court, "w1").shown).toBe(0);
    host.advance(OPEN);
    expect(court.peek().gods.map((g) => [g.shown, g.name])).toEqual(Array(6).fill([1, 1]));
  });
});

describe("a worker whose kind of work changes", () => {
  it("walks along its terrace, over the stairs, and to where that work is done", () => {
    const { root, court, host } = staged();
    court.sync([A("w1", "athena", "working", "look")], "idle");
    host.advance(3000);
    court.sync([A("w1", "athena", "working", "make")], "idle");
    host.advance(0);
    const legs = route(
      plan,
      { level: 1, x: 258 },
      { level: 0, x: 170 },
      CAST.gods.athena.move.speed,
    );
    expect(legs.map((l) => l.kind)).toEqual(["walk", "stair", "walk"]);
    // It holds its new place from the start, and strides off to the right, toward the first flight.
    expect(godOf(court, "w1")).toMatchObject({ zone: "make", slot: 0, walking: true, dir: 1 });
    expect(cellOf(root, "w1").classList.contains("is-walking")).toBe(true);
    host.advance(260);
    expect(godOf(court, "w1")).toMatchObject({ pose: "stride", lift: 126, name: 0 });
    expect(godOf(court, "w1").x).toBeCloseTo(258 + 0.26 * 64 * COURT.pace);
    // On its own beat it strides and stands by turns.
    host.advance(CAST.gods.athena.step);
    expect(godOf(court, "w1").pose).toBe("stand");
    // Half way down the flight: between the floors, and going left.
    host.advance(legs[0]!.ms + legs[1]!.ms / 2 - 260 - CAST.gods.athena.step);
    const mid = godOf(court, "w1");
    expect(mid.dir).toBe(-1);
    expect(mid.lift).toBeGreaterThan(30);
    expect(mid.lift).toBeLessThan(96);
    expect(mid.x).toBeGreaterThan(plan.stairs[0].foot);
    // And there: on the agora, in the pose it has for that work, its name carved again.
    host.advance(routeMs(legs) - legs[0]!.ms - legs[1]!.ms / 2);
    expect(godOf(court, "w1")).toMatchObject({ x: 170, lift: 0, walking: false, pose: "think" });
    expect(cellOf(root, "w1").classList.contains("is-walking")).toBe(false);
    host.advance(400);
    expect(godOf(court, "w1").name).toBe(1);
    expect(host.pending()).toBe(0);
  });

  it("stays 2.5s at a place before it moves again; thinking keeps it there; the latest want wins", () => {
    const { court, host } = staged();
    court.sync([A("w1", "hermes", "working", "look")], "idle");
    host.advance(1000);
    court.sync([A("w1", "hermes", "working", "web")], "idle");
    host.advance(400);
    // Not yet: and about to leave, it keeps the pose it had.
    expect(godOf(court, "w1")).toMatchObject({ zone: "look", walking: false, pose: "look" });
    court.sync([A("w1", "hermes", "working", "think")], "idle");
    host.advance(400);
    court.sync([A("w1", "hermes", "working", "run")], "idle");
    host.advance(COURT.dwell - 1800 - 20);
    expect(godOf(court, "w1")).toMatchObject({ zone: "look", walking: false });
    host.advance(40);
    // The latest of them: to the agora, not to the web's half of the grove.
    expect(godOf(court, "w1")).toMatchObject({ zone: "run", walking: true });
    // Thinking between tools, it is left where it is going.
    court.sync([A("w1", "hermes", "working", "think")], "idle");
    host.advance(20_000);
    expect(godOf(court, "w1")).toMatchObject({
      zone: "run",
      walking: false,
      pose: "think",
      x: 431,
    });
    court.sync([A("w1", "hermes", "working", "run")], "idle");
    host.advance(0);
    expect(godOf(court, "w1")).toMatchObject({ zone: "run", walking: false, pose: "run" });
  });

  it("sent elsewhere on its way, it turns for the latest", () => {
    const { court, host } = staged();
    court.sync([A("w1", "hermes", "working", "make")], "idle");
    host.advance(3000);
    court.sync([A("w1", "hermes", "working", "run")], "idle");
    host.advance(300);
    const going = godOf(court, "w1");
    expect(going).toMatchObject({ zone: "run", walking: true, dir: 1, lift: 0 });
    court.sync([A("w1", "hermes", "working", "make")], "idle");
    host.advance(100);
    expect(godOf(court, "w1")).toMatchObject({ zone: "make", walking: true, dir: -1 });
    host.advance(5000);
    expect(godOf(court, "w1")).toMatchObject({
      zone: "make",
      x: 170,
      walking: false,
      pose: "make",
    });
  });
});

describe("a new worker", () => {
  it("comes in at the agora's gate and walks to its place; those sent together, one at a time", () => {
    const { court, host } = staged();
    court.sync([], "working");
    host.advance(OPEN);
    court.sync(
      [A("w1", "hephaestus", "working", "think"), A("w2", "athena", "working", "look")],
      "working",
    );
    host.advance(0);
    // On the agora's floor, out of sight; his heavy tread dips a px on its footfall.
    expect(godOf(court, "w1")).toMatchObject({
      zone: "make",
      x: COURT.gate,
      lift: -1,
      walking: true,
    });
    expect(godOf(court, "w2")).toMatchObject({ zone: "look", x: COURT.gate, lift: 0 });
    host.advance(600);
    expect(godOf(court, "w1").x).toBeGreaterThan(COURT.gate);
    expect(godOf(court, "w2").x).toBe(COURT.gate);
    host.advance(200);
    expect(godOf(court, "w2").x).toBeGreaterThan(COURT.gate);
    host.advance(30_000);
    expect(godOf(court, "w1")).toMatchObject({ x: 170, lift: 0, walking: false, pose: "think" });
    expect(godOf(court, "w2")).toMatchObject({ x: 258, lift: 126, walking: false, pose: "look" });
  });
});

describe("an ending", () => {
  it("done: it climbs to the temple and stands by the hearth with its scroll sealed", () => {
    const { root, court, host } = staged();
    court.sync([A("w1", "hermes", "working", "run")], "idle");
    host.advance(3000);
    court.sync([A("w1", "hermes", "done", "run")], "idle");
    host.advance(0);
    expect(godOf(court, "w1")).toMatchObject({ zone: "temple", slot: 0, walking: true });
    const legs = route(
      plan,
      { level: 0, x: 431 },
      { level: 2, x: 303 },
      CAST.gods.hermes.move.speed,
    );
    expect(legs.map((l) => l.kind)).toEqual(["walk", "stair", "walk", "stair", "walk"]);
    host.advance(routeMs(legs) + 10);
    expect(godOf(court, "w1")).toMatchObject({
      x: 303,
      lift: 252,
      walking: false,
      pose: "stand",
      dir: 1,
      sealed: false,
    });
    host.advance(320);
    expect(godOf(court, "w1").sealed).toBe(true);
    expect(cellOf(root, "w1").classList.contains("is-sealed")).toBe(true);
    host.advance(1000);
    expect(host.pending()).toBe(0);
  });

  it("the temple keeps the latest six to finish", () => {
    const { root, court, host } = staged();
    const gods: GodId[] = [
      "athena",
      "hermes",
      "argus",
      "themis",
      "nike",
      "herodotus",
      "hephaestus",
    ];
    const done = gods.map((god, i) => A(`d${i}`, god, "done", "look"));
    court.sync(done.slice(0, 6), "idle");
    host.advance(OPEN);
    // Already done as the stage opens: there, sealed, the first to finish nearest the hearth.
    expect(court.peek().gods.map((g) => [g.key, g.zone, g.x, g.sealed])).toEqual([
      ["d0", "temple", 303, true],
      ["d1", "temple", 395, true],
      ["d2", "temple", 251, true],
      ["d3", "temple", 447, true],
      ["d4", "temple", 199, true],
      ["d5", "temple", 499, true],
    ]);
    // A seventh finishes: the one sealed longest ago gives it its place.
    court.sync([...done.slice(0, 6), A("d6", "hephaestus", "working", "make")], "idle");
    host.advance(40_000);
    court.sync(done, "idle");
    host.advance(COURT.dwell);
    expect(court.peek().gods.map((g) => g.key)).not.toContain("d0");
    expect(godOf(court, "d6")).toMatchObject({ zone: "temple", slot: 0 });
    host.advance(60_000);
    expect(root.querySelectorAll(".oly-cell")).toHaveLength(6);
    expect(names(root)).not.toContain("d0");
    expect(court.peek().off).toEqual(["d0"]);
    // Ten done before the stage ever saw them: only the last six are built.
    const late = staged();
    late.court.sync(
      Array.from({ length: 10 }, (_, i) => A(`e${i}`, "nike", "done", "run")),
      "idle",
    );
    late.host.advance(OPEN);
    expect(late.court.peek().gods.map((g) => g.key)).toEqual(["e4", "e5", "e6", "e7", "e8", "e9"]);
    expect(late.root.querySelectorAll(".oly-cell")).toHaveLength(6);
  });

  it("failed: it dims and cracks where it stands; stopped, it only dims", () => {
    const { root, court, host } = staged();
    court.sync(
      [A("w1", "athena", "working", "look"), A("w2", "hermes", "working", "run")],
      "working",
    );
    host.advance(OPEN);
    court.sync([A("w1", "athena", "failed", "look"), A("w2", "hermes", "stopped", "run")], "idle");
    host.advance(450);
    expect(godOf(court, "w1")).toMatchObject({ zone: "look", x: 258, pose: "stand", crack: 1 });
    expect(godOf(court, "w1").dim).toBeCloseTo(0.5);
    expect(godOf(court, "w2")).toMatchObject({ zone: "run", x: 431, pose: "stand", crack: 0 });
    host.advance(600);
    expect(court.peek().gods.map((g) => [g.dim, g.crack, g.walking])).toEqual([
      [1, 1, false],
      [1, 0, false],
    ]);
    expect(cellOf(root, "w1").className).toBe("oly-cell is-dim is-cracked");
    expect(cellOf(root, "w2").className).toBe("oly-cell is-left is-dim");
    host.advance(30_000);
    expect(godOf(court, "w1")).toMatchObject({ zone: "look", x: 258 });
    expect(host.pending()).toBe(0);
    // Sent more work, it is itself again.
    court.sync([A("w1", "athena", "working", "look"), A("w2", "hermes", "stopped", "run")], "idle");
    host.advance(0);
    expect(godOf(court, "w1")).toMatchObject({ dim: 0, crack: 0, pose: "look" });
  });

  it("the stage shows the latest four to fail or be stopped", () => {
    const { root, court, host } = staged();
    const crew = (failed: number): CourtAgent[] =>
      Array.from({ length: 6 }, (_, i) =>
        A(`w${i}`, "argus", i < failed ? "failed" : "working", i % 2 ? "run" : "web"),
      );
    court.sync(crew(0), "working");
    host.advance(OPEN);
    court.sync(crew(4), "working");
    host.advance(2000);
    expect(
      court
        .peek()
        .gods.filter((g) => g.dim === 1)
        .map((g) => g.key),
    ).toEqual(["w0", "w1", "w2", "w3"]);
    court.sync(crew(5), "working");
    host.advance(2000);
    expect(court.peek().gods.map((g) => g.key)).toEqual(["w1", "w2", "w3", "w4", "w5"]);
    expect(root.querySelector('.oly-cell[data-key="w0"]')).toBeNull();
    expect(court.peek().off).toEqual(["w0"]);
  });

  it("a worker whose record is gone is taken off the stage", () => {
    const { root, court, host } = staged();
    court.sync([A("w1", "athena", "working", "look"), A("w2", "nike", "working", "run")], "idle");
    host.advance(OPEN);
    court.sync([A("w2", "nike", "working", "run")], "idle");
    host.advance(160);
    expect(court.peek().gods.map((g) => g.key)).toEqual(["w2"]);
    // Still going from it.
    expect(root.querySelectorAll(".oly-cell")).toHaveLength(2);
    host.advance(400);
    expect(root.querySelectorAll(".oly-cell")).toHaveLength(1);
    expect(names(root)).toEqual(["w2"]);
  });
});

describe("the hearth, the coordinator's", () => {
  it("burns while it works, its flame cut from shape to shape; embers idle; a lapis rim waiting on you", () => {
    const { root, court, host } = staged();
    const hearth = root.querySelector<HTMLElement>(".oly-hearth")!;
    court.sync([], "working");
    host.advance(OPEN);
    expect(hearth.dataset.state).toBe("working");
    const shapes = new Set<string>();
    for (let i = 0; i < 24; i++) {
      host.advance(170);
      shapes.add(hearth.dataset.flame!);
      expect(court.peek().hearth.flame).toBe(Number(hearth.dataset.flame));
    }
    expect([...shapes].sort()).toEqual(["0", "1", "2"]);
    court.sync([], "waiting");
    host.advance(0);
    expect(hearth.dataset.state).toBe("waiting");
    court.sync([], "idle");
    host.advance(0);
    expect(hearth.dataset.state).toBe("idle");
    // Out, it asks nothing more of the clock.
    host.advance(1000);
    expect(host.pending()).toBe(0);
  });
});

describe("a crowd", () => {
  it("more than five in a half-terrace: the rest are left to their rows, until a place is given up", () => {
    const { root, court, host } = staged();
    const readers = (n: number, first: CourtAgent["family"] = "look"): CourtAgent[] =>
      Array.from({ length: n }, (_, i) =>
        A(`r${i}`, "herodotus", "working", i === 0 ? first : "look"),
      );
    court.sync(readers(7), "working");
    host.advance(OPEN);
    expect(court.peek().gods.map((g) => [g.key, g.slot, g.x])).toEqual([
      ["r0", 0, 258],
      ["r1", 1, 145],
      ["r2", 2, 370],
      ["r3", 3, 201],
      ["r4", 4, 314],
    ]);
    expect(court.peek().off).toEqual(["r5", "r6"]);
    expect(root.querySelectorAll(".oly-cell")).toHaveLength(5);
    // The first goes to the web: the next in line comes in at the gate for its place.
    court.sync(readers(7, "web"), "working");
    host.advance(0);
    expect(godOf(court, "r0")).toMatchObject({ zone: "web", walking: true });
    expect(godOf(court, "r5")).toMatchObject({ zone: "look", slot: 0, x: COURT.gate });
    expect(court.peek().off).toEqual(["r6"]);
    host.advance(60_000);
    expect(godOf(court, "r5")).toMatchObject({ x: 258, lift: 126, walking: false, pose: "look" });
  });

  it("one let in when a place is given up on the clock has its name carved under it", () => {
    const { root, court, host } = staged();
    const readers = (first: CourtAgent["family"]): CourtAgent[] =>
      Array.from({ length: 6 }, (_, i) =>
        A(`r${i}`, "athena", "working", i === 0 ? first : "look"),
      );
    court.sync(readers("look"), "idle");
    host.advance(1000);
    // Too soon for the first to go: it gives up its place when its stay is over, with no record changing.
    court.sync(readers("web"), "idle");
    host.advance(500);
    expect(court.peek().off).toEqual(["r5"]);
    host.advance(COURT.dwell);
    expect(court.peek().off).toEqual([]);
    const label = [...root.querySelectorAll<HTMLElement>(".oly-ins")].find(
      (el) => el.textContent === "r5",
    )!;
    const [a, b] = CAST.gods.athena.fp.stand;
    expect(label.style.transform).toBe(
      `translate(calc(${(258 - 33 + (a + b) / 2).toFixed(1)}px - 50%), -126px)`,
    );
  });

  it("one taken off a narrower stage on its way goes from where it last stood", () => {
    const stage = staged();
    const { root, court, host } = stage;
    const crew = (web: number): CourtAgent[] =>
      Array.from({ length: 6 }, (_, i) =>
        A(`w${i}`, "athena", "working", i >= web ? "web" : "look"),
      ).slice(0, web === 6 ? 4 : 6);
    court.sync(crew(6), "idle");
    host.advance(OPEN);
    // Three are sent to the web, and the stage narrows while they walk there.
    court.sync(crew(3), "idle");
    host.advance(900);
    expect(
      court
        .peek()
        .gods.filter((g) => g.walking)
        .map((g) => g.key),
    ).toEqual(["w3", "w4", "w5"]);
    stage.width = 462;
    court.resize();
    host.advance(100);
    expect(court.peek().gods.map((g) => [g.key, g.zone, g.walking])).toEqual([
      ["w0", "look", false],
      ["w1", "look", false],
      ["w3", "web", false],
      ["w4", "web", false],
    ]);
    host.advance(1000);
    expect(root.querySelectorAll(".oly-cell")).toHaveLength(4);
  });

  it("no room where its work is done: it does that work where it stands, and goes when there is", () => {
    const { court, host } = staged();
    const crew = (w0: CourtAgent["family"], w5: CourtAgent["status"]): CourtAgent[] => [
      A("w0", "hermes", "working", w0),
      ...Array.from({ length: 5 }, (_, i) =>
        A(`r${i}`, "hephaestus", i === 4 ? w5 : "working", "run"),
      ),
    ];
    court.sync(crew("make", "working"), "working");
    host.advance(OPEN);
    court.sync(crew("run", "working"), "working");
    host.advance(0);
    expect(godOf(court, "w0")).toMatchObject({ zone: "make", walking: false, pose: "run" });
    court.sync(crew("run", "done"), "working");
    host.advance(0);
    expect(godOf(court, "r4")).toMatchObject({ zone: "temple", walking: true });
    expect(godOf(court, "w0")).toMatchObject({ zone: "run", slot: 4, walking: true });
  });

  it("names have the room their neighbours leave them", () => {
    const { root, court, host } = staged();
    court.sync([A("w1", "athena", "working", "look", "a-long-task-name")], "idle");
    host.advance(OPEN);
    const label = root.querySelector<HTMLElement>(".oly-ins")!;
    expect(label.style.maxWidth).toBe("150px");
    court.sync(
      [
        A("w1", "athena", "working", "look", "a-long-task-name"),
        A("w2", "athena", "working", "look"),
        A("w3", "athena", "working", "look"),
        A("w4", "athena", "working", "look"),
      ],
      "idle",
    );
    host.advance(0);
    // Its nearest neighbour is a slot away: 56px less the air between two names.
    expect(label.style.maxWidth).toBe("49px");
  });
});

describe("asked for less motion", () => {
  it("nothing travels: floors laid whole, gods placed by cuts, the flame still", () => {
    const { root, court, host } = staged({ reduced: () => true });
    court.sync(
      [A("w1", "athena", "working", "look"), A("w2", "themis", "failed", "web")],
      "working",
    );
    host.advance(0);
    expect(court.peek().floors).toEqual(["shown", "shown", "shown"]);
    expect(court.peek().gods.map((g) => [g.key, g.shown, g.name, g.dim, g.crack])).toEqual([
      ["w1", 1, 1, 0, 0],
      ["w2", 1, 1, 1, 1],
    ]);
    expect(host.pending()).toBe(0);
    // To the agora, and then done: there by a cut each time, after its stay, and sealed at once.
    court.sync([A("w1", "athena", "working", "run")], "working");
    host.advance(COURT.dwell - 10);
    expect(godOf(court, "w1")).toMatchObject({ zone: "look", x: 258 });
    host.advance(10);
    expect(godOf(court, "w1")).toMatchObject({ zone: "run", x: 431, lift: 0, walking: false });
    court.sync([A("w1", "athena", "done", "run"), A("w3", "nike", "working", "make")], "working");
    host.advance(COURT.dwell);
    expect(godOf(court, "w1")).toMatchObject({ zone: "temple", x: 303, lift: 252, sealed: true });
    // A newcomer is simply at its place.
    expect(godOf(court, "w3")).toMatchObject({ zone: "make", x: 170, walking: false, shown: 1 });
    const hearth = root.querySelector<HTMLElement>(".oly-hearth")!;
    expect([hearth.dataset.state, hearth.dataset.flame]).toEqual(["working", "0"]);
    host.advance(5000);
    expect(hearth.dataset.flame).toBe("0");
    expect(host.pending()).toBe(0);
    // One taken off is gone at once.
    court.sync([A("w3", "nike", "working", "make")], "working");
    host.advance(0);
    expect(root.querySelectorAll(".oly-cell")).toHaveLength(1);
  });
});

describe("at its place", () => {
  it("a god at its work fidgets, in its own beats; one not at work, and one asked for less motion, is still", () => {
    const moved = (over: Partial<CourtOptions>, status: CourtAgent["status"]): boolean => {
      const { court, host } = staged({ fidget: true, ...over });
      court.sync([A("w1", "hermes", status, "run")], "idle");
      host.advance(OPEN);
      let seen = false;
      for (let i = 0; i < 200; i++) {
        host.advance(50);
        seen ||= godOf(court, "w1").fidget !== null;
      }
      return seen;
    };
    expect(moved({}, "working")).toBe(true);
    expect(moved({}, "idle")).toBe(false);
    expect(moved({ reduced: () => true }, "working")).toBe(false);
  });
});

describe("the stage's width", () => {
  it("narrower: its slots are fewer, everyone is put again by a cut, and whoever has no place is left to its row", () => {
    const stage = staged();
    const { root, court, host } = stage;
    court.sync(
      Array.from({ length: 5 }, (_, i) => A(`w${i}`, "athena", "working", "look")),
      "idle",
    );
    host.advance(OPEN);
    expect(court.peek().gods).toHaveLength(5);
    stage.width = 462;
    court.resize();
    host.advance(0);
    const narrow = planCourt(462);
    expect(court.peek().width).toBe(462);
    expect(court.peek().gods.map((g) => [g.key, g.slot, g.x, g.walking])).toEqual([
      ["w0", 0, narrow.zones.look.slots[0]!.x, false],
      ["w1", 1, narrow.zones.look.slots[1]!.x, false],
    ]);
    expect(court.peek().off).toEqual(["w2", "w3", "w4"]);
    expect(root.querySelector(".oly-court-stairs")?.getAttribute("viewBox")).toBe("0 0 462 378");
    host.advance(1000);
    expect(root.querySelectorAll(".oly-cell")).toHaveLength(2);
    // Wide again: those left out come back in at the gate.
    stage.width = 698;
    court.resize();
    host.advance(60_000);
    expect(
      court
        .peek()
        .gods.map((g) => g.key)
        .sort(),
    ).toEqual(["w0", "w1", "w2", "w3", "w4"]);
    expect(court.peek().off).toEqual([]);
  });
});

describe("a god and its row", () => {
  it("the pointer on a god says whose row to mark; a row pointed at marks its god's name", () => {
    const { root, court, host, hovers } = staged();
    court.sync([A("w1", "athena", "working", "look"), A("w2", "nike", "working", "run")], "idle");
    host.advance(OPEN);
    cellOf(root, "w2").dispatchEvent(new Event("pointerenter"));
    cellOf(root, "w2").dispatchEvent(new Event("pointerleave"));
    expect(hovers).toEqual(["w2", null]);
    const marks = (): boolean[] =>
      [...root.querySelectorAll(".oly-ins")].map((el) => el.classList.contains("is-marked"));
    court.mark("w1");
    expect(marks()).toEqual([true, false]);
    court.mark("w2");
    expect(marks()).toEqual([false, true]);
    court.mark(null);
    expect(marks()).toEqual([false, false]);
  });
});

// What is drawn of the gods, their names and the hearth: each one's classes, its
// data and its styles, whatever order they were written in.
function drawn(root: HTMLElement): string {
  const parts = ".oly-cell, .oly-fig, .oly-poses, .oly-part, .oly-seal, .oly-ins, .oly-hearth";
  return [...root.querySelectorAll<HTMLElement>(parts)]
    .map((el) => {
      const data = Object.entries(el.dataset).sort();
      const style = [...el.style]
        .sort()
        .map((name) => `${name}:${el.style.getPropertyValue(name)}`);
      return `${el.getAttribute("class")} ${JSON.stringify(data)} ${style.join(";")} ${el.textContent}`;
    })
    .join("\n");
}

describe("a run", () => {
  it("plays the same however its frames fall", () => {
    const play = (tick: (host: ManualHost, ms: number) => void): string[] => {
      const { root, court, host } = staged({ fidget: true });
      const seen: string[] = [];
      const mark = (): void => {
        seen.push(JSON.stringify(court.peek()), drawn(root));
      };
      court.sync(
        [A("w1", "athena", "working", "look"), A("w2", "hermes", "working", "make")],
        "idle",
      );
      tick(host, 1200);
      mark();
      court.sync(
        [
          A("w1", "athena", "working", "run"),
          A("w2", "hermes", "working", "make"),
          A("w3", "nike", "working", "web"),
        ],
        "working",
      );
      tick(host, 4321);
      mark();
      court.sync(
        [
          A("w1", "athena", "working", "think"),
          A("w2", "hermes", "failed", "make"),
          A("w3", "nike", "done", "web"),
        ],
        "waiting",
      );
      tick(host, 777);
      mark();
      tick(host, 9000);
      mark();
      tick(host, 30_000);
      mark();
      return seen;
    };
    const smooth = play((host, ms) => host.run(ms));
    expect(play((host, ms) => host.run(ms, 50))).toEqual(smooth);
    expect(play((host, ms) => host.run(ms, 333))).toEqual(smooth);
    expect(play((host, ms) => host.advance(ms))).toEqual(smooth);
  });
});
