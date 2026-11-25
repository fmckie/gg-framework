// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { CAST, POSE_URLS, type Skill } from "./cast";
import {
  agentsAt,
  manualHost,
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
  readonly host: ReturnType<typeof manualHost>;
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

/** A lane with a clock that moves only when told to; a letter is 5.5px wide. */
function stage({ seed = 7, width = 698, letter = 5.5, reduced = false } = {}): Stage {
  const lane = document.createElement("div");
  lane.className = "oly-lane is-shut";
  lane.innerHTML =
    '<div class="oly-gods"></div><div class="oly-stylobate"><div class="oly-names"></div></div>';
  const card = document.createElement("div");
  card.className = "oly-card";
  const box = document.createElement("textarea");
  document.body.append(card, lane, box);
  const host = manualHost();
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

  it("shuts a beat after the last god has gone, and not while one is left", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "hermes")]);
    s.host.advance(5000);
    s.sync([agent("a", "athena", "fail"), agent("b", "hermes")]);
    s.host.advance(3000); // the failed one has gone
    expect(s.cells()).toHaveLength(1);
    s.host.advance(5000);
    expect(shut(s)).toBe(false);
    s.sync([agent("a", "athena", "fail"), agent("b", "hermes", "stop")]);
    s.host.advance(3000);
    expect(s.cells()).toHaveLength(0);
    expect(shut(s)).toBe(false);
    s.host.advance(599);
    expect(shut(s)).toBe(false);
    s.host.advance(1);
    expect(shut(s)).toBe(true);
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
    expect(shut(s)).toBe(false);
    expect(s.cells()).toHaveLength(1);
    s.sync([]);
    s.host.advance(600);
    expect(shut(s)).toBe(true);
    s.sync([agent("c", "nike")]);
    expect(shut(s)).toBe(false);
    s.host.advance(500);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["nike"]);
  });
});

describe("landing", () => {
  it("sets the first god a beat after the lane opens, at its place, with a greeting", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(499);
    expect(s.cells()).toHaveLength(0);
    s.host.advance(1);
    const [god] = s.peek().gods;
    const cell = s.cell("a")!;
    expect(cell.dataset.god).toBe("hermes");
    expect(cell.dataset.pose).toBe("speak");
    expect(cell.classList.contains("is-speaking")).toBe(true);
    expect([...GREETINGS.any, ...GREETINGS.hermes]).toContain(ribbonOf(cell));
    // The line is whole, its initial rubricated.
    expect(cell.querySelector(".oly-band b")?.textContent).toBe(god!.line![0]);
    // At its place from the first: nothing travels.
    const [lo, hi] = CAST.gods.hermes.env;
    const env = god!.face > 0 ? [lo, hi] : [66 - hi, 66 - lo];
    expect(god!.place![0]).toBeCloseTo(god!.x + env[0]!, 5);
    expect(god!.place![1]).toBeCloseTo(god!.x + env[1]!, 5);
    expect(cell.style.transform).toBe(`translate3d(${god!.x.toFixed(2)}px, 0, 0)`);
    expect(s.names()).toEqual(["Hermes"]);
  });

  it("holds the line 1.7s, then the god is at its place, in thought, facing the middle", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(500 + 1699);
    expect(ribbonOf(s.cell("a"))).not.toBeNull();
    s.host.advance(1);
    const cell = s.cell("a")!;
    const [god] = s.peek().gods;
    expect(ribbonOf(cell)).toBeNull();
    expect(cell.dataset.pose).toBe("think");
    expect(cell.classList.contains("is-speaking")).toBe(false);
    expect(god!.step).toBe("work");
    const headLine = god!.x + 33;
    expect(god!.face).toBe(headLine < 698 / 2 ? 1 : -1);
    expect(cell.classList.contains("is-left")).toBe(god!.face < 0);
    expect(s.host.pending()).toBe(0); // a still: nothing ticks while it holds its pose
  });

  it("lands a crowd one at a time, in the order they were sent, 850ms apart", () => {
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
    const landed = (): string[] => s.peek().gods.map((god) => god.key);
    expect(landed()).toEqual(["a"]);
    s.host.advance(849);
    expect(landed()).toEqual(["a"]);
    s.host.advance(1);
    expect(landed()).toEqual(["a", "b"]);
    s.host.advance(850);
    expect(landed()).toEqual(["a", "b", "c"]);
    s.host.advance(850);
    expect(landed()).toEqual(["a", "b", "c", "d"]);
    expect(s.peek().queue).toEqual([]);
    expect(s.names().sort()).toEqual(["Argus", "Athena", "Hephaestus", "Nike"]);
  });

  it("places a crowd sent together all at once, so the first is not left in the middle", () => {
    const s = stage();
    s.sync([agent("a", "athena"), agent("b", "hermes"), agent("c", "argus")]);
    s.host.advance(500);
    const first = s.peek().gods[0]!.x;
    s.host.advance(4000);
    expect(s.peek().gods.find((god) => god.key === "a")!.x).toBe(first); // nobody stepped aside
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

  /** A god at its place, standing: 500ms to land, 1.7s of greeting. */
  function atWork(): Stage {
    const s = stage();
    s.sync(one("running"));
    s.host.advance(2200);
    expect(s.peek().gods[0]!.step).toBe("work");
    return s;
  }

  it.each([
    ["starting", "think"],
    ["running", "look"],
  ] as const)("%s: a god is summoned, and is at its work", (status, pose) => {
    const s = stage();
    s.sync(one(status));
    s.host.advance(2200);
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

  it.each(["done", "idle"] as const)("%s: a farewell, the seal, and it goes", (status) => {
    const s = atWork();
    s.sync(one(status));
    const cell = s.cell("it")!;
    expect([...FAREWELLS.any, ...FAREWELLS.argus]).toContain(ribbonOf(cell));
    expect(cell.dataset.pose).toBe("speak");
    expect(cell.classList.contains("is-sealed")).toBe(false);
    s.host.advance(1700);
    expect(ribbonOf(cell)).toBeNull();
    expect(cell.dataset.pose).toBe("stand");
    expect(cell.classList.contains("is-sealed")).toBe(true);
    expect(cell.classList.contains("is-dim")).toBe(false);
    s.host.advance(1199);
    expect(s.cells()).toHaveLength(1);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(0);
    expect(s.names()).toEqual([]);
  });

  it("failed: it stands dimmed and cracked for 3s, without a word, and goes", () => {
    const s = atWork();
    s.sync(one("error"));
    const cell = s.cell("it")!;
    expect(ribbonOf(cell)).toBeNull();
    expect(cell.dataset.pose).toBe("stand");
    expect(cell.classList.contains("is-dim")).toBe(true);
    expect(cell.classList.contains("is-cracked")).toBe(true);
    expect(cell.classList.contains("is-sealed")).toBe(false);
    s.host.advance(2999);
    expect(s.cells()).toHaveLength(1);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(0);
  });

  it.each([
    ["interrupted", one("interrupted")],
    ["unfinished in a stopped run", one("running", true)],
    ["failed in a stopped run", one("error", true)],
  ] as const)("%s: dimmed with no crack for 3s, without a word, and goes", (_, records) => {
    const s = atWork();
    s.sync(records);
    const cell = s.cell("it")!;
    expect(ribbonOf(cell)).toBeNull();
    expect(cell.dataset.pose).toBe("stand");
    expect(cell.classList.contains("is-dim")).toBe(true);
    expect(cell.classList.contains("is-cracked")).toBe(false);
    s.host.advance(2999);
    expect(s.cells()).toHaveLength(1);
    s.host.advance(1);
    expect(s.cells()).toHaveLength(0);
  });

  it("finished in a stopped run: it keeps its farewell and its seal", () => {
    const s = atWork();
    s.sync(one("done", true));
    expect(ribbonOf(s.cell("it"))).not.toBeNull();
    s.host.advance(1700);
    expect(s.cell("it")!.classList.contains("is-sealed")).toBe(true);
    expect(s.cell("it")!.classList.contains("is-dim")).toBe(false);
  });

  it("ended while it greets: the greeting is said out first", () => {
    const s = stage();
    s.sync(one("running"));
    s.host.advance(900);
    const greeting = ribbonOf(s.cell("it"));
    s.sync(one("error"));
    expect(ribbonOf(s.cell("it"))).toBe(greeting);
    expect(s.cell("it")!.classList.contains("is-dim")).toBe(false);
    s.host.advance(1300); // 2200ms: the greeting is over
    expect(ribbonOf(s.cell("it"))).toBeNull();
    expect(s.cell("it")!.classList.contains("is-cracked")).toBe(true);
  });

  it("its ending is settled once: a later record doesn't change how it goes", () => {
    const s = atWork();
    s.sync(one("error"));
    s.sync(one("done"));
    expect(ribbonOf(s.cell("it"))).toBeNull();
    expect(s.cell("it")!.classList.contains("is-cracked")).toBe(true);
  });

  it("gone from the records: its god goes at once, and the lane shuts", () => {
    const s = atWork();
    s.sync([]);
    expect(s.cells()).toHaveLength(0);
    expect(s.names()).toEqual([]);
    s.host.advance(600);
    expect(shut(s)).toBe(true);
  });

  it("sent on again after it has gone: it lands again, with a greeting", () => {
    const s = stage();
    const at = (i: number): LaneAgent[] => laneAgents([{ agents: [SENT_ON_AGAIN[i]!] }]);
    s.sync(at(0));
    s.host.advance(2200);
    s.sync(at(1)); // idle
    s.host.advance(2900 + 600);
    expect(s.cells()).toHaveLength(0);
    expect(shut(s)).toBe(true);
    s.sync(at(2)); // sent on again
    expect(shut(s)).toBe(false);
    s.host.advance(500);
    expect(s.cell("s-again")!.dataset.pose).toBe("speak");
    expect([...GREETINGS.any, ...GREETINGS.nike]).toContain(ribbonOf(s.cell("s-again")));
    s.host.advance(1700);
    s.sync(at(3)); // closed
    expect([...FAREWELLS.any, ...FAREWELLS.nike]).toContain(ribbonOf(s.cell("s-again")));
  });

  it("sent on again while it is going: it goes, then lands again", () => {
    const s = stage();
    const at = (i: number): LaneAgent[] => laneAgents([{ agents: [SENT_ON_AGAIN[i]!] }]);
    s.sync(at(0));
    s.host.advance(2200);
    s.sync(at(1));
    s.host.advance(1000);
    s.sync(at(2)); // at work again, its god still saying farewell
    expect(ribbonOf(s.cell("s-again"))).not.toBeNull();
    s.host.advance(1899);
    expect(s.cell("s-again")!.classList.contains("is-sealed")).toBe(true);
    s.host.advance(1); // gone, and set again in the same moment
    expect(s.cells()).toHaveLength(1);
    expect(s.cell("s-again")!.dataset.pose).toBe("speak");
    expect(s.cell("s-again")!.classList.contains("is-sealed")).toBe(false);
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
          for (let ms = 0; ms < 16_000; ms += 100) {
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
    s.host.advance(4000);
    const before = s.peek().gods.map((god) => god.x);
    s.sync([agent("a", "athena"), agent("b", "herodotus"), agent("c", "hermes")]);
    s.host.advance(4000);
    const after = s.peek();
    expect(after.gods.slice(0, 2).map((god) => god.x)).toEqual(before);
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

  it("re-plans the places at once when the lane's width changes", () => {
    const s = stage();
    s.sync(
      ["nike", "hephaestus", "themis", "argus", "hermes"].map((god, i) =>
        agent(`g${i}`, god as GodId),
      ),
    );
    s.host.advance(8000);
    expect(s.peek().width).toBe(698);
    s.setWidth(602);
    s.resize();
    const narrow = s.peek();
    expect(narrow.width).toBe(602);
    expectApart(narrow);
    expect(narrow.gods.every((god) => god.place![1] <= 602 - 16 + 6)).toBe(true);
    expect(narrow.gods.every((god) => god.x === god.place![0] - (god.place![0] - god.x))).toBe(
      true,
    );
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
    s.host.advance(6000);
    const peek = s.peek();
    expect(peek.gods).toHaveLength(5);
    expect(peek.queue).toEqual([]);
    expect(peek.waiting).toHaveLength(2);
    expectApart(peek);
    // A place is left: the oldest waiting lands, and the other waits on.
    const [oldest, other] = peek.waiting;
    const leaver = peek.gods[0]!;
    const rest = records(1000);
    s.sync(rest.map((a) => (a.key === leaver.key ? { ...a, look: "fail" } : a)));
    s.host.advance(2999);
    expect(s.peek().gods.map((god) => god.key)).toContain(leaver.key);
    expect(s.peek().waiting).toEqual([oldest, other]);
    s.host.advance(1);
    expect(s.peek().gods.map((god) => god.key)).not.toContain(leaver.key);
    expect(s.peek().gods.map((god) => god.key)).toContain(oldest);
    expect(s.peek().waiting).toEqual([other]);
    expect(s.peek().gods).toHaveLength(5);
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
    s.host.advance(3600);
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
    const s = stage();
    const crowd = (["athena", "hephaestus", "argus", "nike"] as const).map((god, i) =>
      agent(`g${i}`, god),
    );
    s.sync(crowd);
    const said = new Map<string, string>();
    for (let ms = 0; ms < 6000; ms += 50) {
      s.host.advance(50);
      for (const god of s.peek().gods) if (god.line) said.set(god.key, god.line);
    }
    expect(said.size).toBe(4);
    expect(new Set(said.values()).size).toBe(4);
    for (const { key, god } of crowd)
      expect([...GREETINGS.any, ...GREETINGS[god]]).toContain(said.get(key));
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
    s.host.advance(700);
    expect(s.peek().gods[0]!.step).toBe("hold");
    s.sync([agent("a", "athena", "stop")]);
    s.host.advance(200);
    expect(s.cell("a")!.classList.contains("is-dim")).toBe(true);
    expect(s.peek().gods[0]!.step).toBe("fail");
  });

  it("with no room for any line, a god waits 1.5s and goes to its place without a word", () => {
    const s = stage({ letter: 40 }); // every line longer than the lane
    s.sync([agent("a", "athena")]);
    s.host.advance(500);
    expect(ribbonOf(s.cell("a"))).toBeNull();
    expect(s.cell("a")!.dataset.pose).toBe("stand");
    expect(s.peek().gods[0]!.step).toBe("hold");
    s.host.advance(1400);
    expect(s.peek().gods[0]!.step).toBe("hold");
    s.host.advance(200);
    expect(s.peek().gods[0]!.step).toBe("work");
    expect(ribbonOf(s.cell("a"))).toBeNull();
  });

  it("with no room for a farewell, a god waits 3s at most, then seals its scroll and goes", () => {
    const s = stage({ letter: 40 });
    s.sync([agent("a", "athena"), agent("b", "hermes")]);
    s.host.advance(6000);
    s.sync([agent("a", "athena", "done"), agent("b", "hermes")]);
    const a = (): HTMLElement => s.cell("a")!;
    expect(a().classList.contains("is-sealed")).toBe(false);
    // Nobody else will move, so it has waited long enough after 1.2s.
    s.host.advance(1199);
    expect(a().classList.contains("is-sealed")).toBe(false);
    s.host.advance(1);
    expect(a().classList.contains("is-sealed")).toBe(true);
    expect(ribbonOf(a())).toBeNull();
    s.host.advance(1200);
    expect(s.cells().map((cell) => cell.dataset.god)).toEqual(["hermes"]);
  });
});

describe("the floor's housekeeping", () => {
  it("does nothing when the records it is handed haven't changed", () => {
    const s = stage();
    s.sync([agent("a", "athena")]);
    s.host.advance(4000);
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
      POSE_URLS.themis.look,
      POSE_URLS.themis.web,
      POSE_URLS.themis.run,
      POSE_URLS.themis["think-r"],
      POSE_URLS.themis["think-l"],
    ]);
    // Its two standing pictures fill the cell; a skill pose has a left and a width of its own.
    expect([...cell.querySelectorAll("img")].map((img) => img.getAttribute("style"))).toEqual([
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

  /** One god at its place: 500ms to land, 1.7s of greeting. Its beat counts from 2200. */
  function atWork(god: GodId, family: ToolFamily = "think", tools = 0, reduced = false): Stage {
    const s = stage({ reduced });
    s.sync([agent("a", god, "run", family, tools)]);
    s.host.advance(2200);
    expect(s.peek().gods[0]!.step).toBe("work");
    return s;
  }

  /** Hand the floor its records, and say when the pose of one god next changes. */
  function cutAfter(s: Stage, records: readonly LaneAgent[], key = "a"): number {
    const was = pose(s, key);
    s.sync(records);
    for (let i = 0; i < 2000 && pose(s, key) === was; i++) s.host.advance(10);
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
    s.host.advance(2200);
    expect(pose(s, "s-starting")).toBe("think");
    s.host.advance(60_000);
    expect(pose(s, "s-starting")).toBe("think"); // and goes on thinking until a tool begins
  });

  it("reaches its place already acting the tool its agent is on, with no pose between", () => {
    const s = stage();
    s.sync([agent("a", "hermes")]);
    s.host.advance(900); // in the middle of its greeting
    s.sync([agent("a", "hermes", "run", "run", 1)]);
    expect(pose(s)).toBe("speak"); // the greeting is said out first
    expect(watch(s, 3000)).toEqual(["speak", "run"]);
    expect(s.peek().gods[0]!.step).toBe("work");
  });

  it("holds a pose for its dwell: 900ms, or two of the god's own steps if that is longer", () => {
    // From 2200, when it took its place, to the first of its beats after its dwell.
    const first: Readonly<Record<GodId, number>> = {
      athena: 2200 + 2 * 520,
      herodotus: 2200 + 2 * 600,
      hermes: 2200 + 3 * 300,
      hephaestus: 2200 + 2 * 560,
      argus: 2200 + 2 * 500,
      themis: 2200 + 2 * 640,
      nike: 2200 + 3 * 360, // 900ms is two and a half of her steps: the cut waits for the third
    };
    for (const god of ALL) {
      const s = atWork(god);
      const was = pose(s);
      s.sync([agent("a", god, "run", "look", 1)]);
      s.host.advance(first[god] - 2200 - 1);
      expect(pose(s)).toBe(was);
      s.host.advance(1);
      expect(pose(s)).toBe("look");
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
      expect(at).toBeGreaterThan(2200 + 2040);
      expect(at).toBe(2200 + Math.ceil(2040 / step) * step);
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
    nike.sync([agent("a", "nike", "run", "web", 2)]); // her look and her web are one pose
    expect(nike.host.pending()).toBe(0);
    expect(watch(nike, 5000)).toEqual(["look"]);
  });

  it("three cuts in six seconds are a storm: the dwell is doubled until a pose has held 3s", () => {
    const s = atWork("hermes"); // steps of 300ms, a dwell of 900ms
    let tools = 0;
    const next = (family: ToolFamily): number =>
      cutAfter(s, [agent("a", "hermes", "run", family, ++tools)]);
    expect(next("look")).toBe(3100);
    expect(next("run")).toBe(4000);
    expect(next("look")).toBe(4900); // the third: a storm
    expect(next("run")).toBe(4900 + 1800);
    expect(next("look")).toBe(6700 + 1800);
    // Calm: this pose is left alone for 3s and more.
    s.host.advance(3100);
    expect(next("run")).toBe(11_800); // its next beat
    expect(next("look")).toBe(11_800 + 900);
  });

  it("three cuts further apart are no storm", () => {
    const s = atWork("hermes");
    let tools = 0;
    const next = (family: ToolFamily): number =>
      cutAfter(s, [agent("a", "hermes", "run", family, ++tools)]);
    expect(next("look")).toBe(3100);
    s.host.advance(2900);
    expect(next("run")).toBe(6100);
    s.host.advance(3100);
    expect(next("look")).toBe(9400); // the first is more than six seconds back
    expect(next("run")).toBe(9400 + 900);
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

  it("Nike is lifted 8px while her look is shown at her place, by a cut, and her name is not", () => {
    const s = stage();
    s.sync([agent("a", "nike", "run", "look", 1)]);
    s.host.advance(600); // greeting: on the floor
    const cell = s.cell("a")!;
    const x = (): string => s.peek().gods[0]!.x.toFixed(2);
    expect(cell.style.transform).toBe(`translate3d(${x()}px, 0, 0)`);
    s.host.advance(1600);
    expect(cell.dataset.pose).toBe("look");
    expect(cell.style.transform).toBe(`translate3d(${x()}px, -8px, 0)`);
    expect(s.peek().gods[0]!.lift).toBe(8);
    expect(s.lane.querySelector<HTMLElement>(".oly-ins")!.style.transform).toMatch(/px, 0, 0\)$/);
    cutAfter(s, [agent("a", "nike", "run", "run", 2)]);
    expect(cell.dataset.pose).toBe("run");
    expect(cell.style.transform).toBe(`translate3d(${x()}px, 0, 0)`);
    cutAfter(s, [agent("a", "nike", "run", "web", 3)]);
    expect(cell.style.transform).toBe(`translate3d(${x()}px, -8px, 0)`);
    // Ended while she is up: she is down in the same moment.
    s.sync([agent("a", "nike", "done", "web", 3)]);
    expect(cell.dataset.pose).toBe("speak");
    expect(cell.style.transform).toBe(`translate3d(${x()}px, 0, 0)`);
  });

  it("an ending never waits for a dwell: the cut that was coming is dropped", () => {
    const s = atWork("hermes");
    s.host.advance(100);
    s.sync([agent("a", "hermes", "run", "look", 1)]); // a cut due at 3100
    s.host.advance(200);
    s.sync([agent("a", "hermes", "done", "look", 1)]);
    const cell = s.cell("a")!;
    expect(cell.dataset.pose).toBe("speak");
    expect([...FAREWELLS.any, ...FAREWELLS.hermes]).toContain(ribbonOf(cell));
    // Farewell for 1.7s, the seal for 1.2s, and never the pose it was going to.
    expect(watch(s, 2890)).toEqual(["speak", "stand"]);
    expect(cell.classList.contains("is-sealed")).toBe(true);
    s.host.advance(10);
    expect(s.cells()).toHaveLength(0);
  });

  it("failed in the middle of a dwell: it stands dimmed at once, and is never cut again", () => {
    const s = atWork("hephaestus", "make", 1);
    s.host.advance(100);
    s.sync([agent("a", "hephaestus", "run", "run", 2)]);
    s.host.advance(200);
    s.sync([agent("a", "hephaestus", "fail", "run", 2)]);
    const cell = s.cell("a")!;
    expect(cell.dataset.pose).toBe("stand");
    expect(cell.classList.contains("is-cracked")).toBe(true);
    expect(watch(s, 2990)).toEqual(["stand"]);
    s.host.advance(10);
    expect(s.cells()).toHaveLength(0);
  });

  it("asked to step aside in the middle of a dwell: at once in the pose wanted, its beat begun again", () => {
    const s = stage();
    const records = (family: ToolFamily, tools: number): LaneAgent[] => [
      agent("a", "hermes", "run", family, tools),
      agent("b", "athena"),
    ];
    s.sync(records("think", 0));
    s.host.advance(6000);
    expect(s.peek().gods.map((god) => god.step)).toEqual(["work", "work"]);
    const shown = cutAfter(s, records("look", 1));
    s.sync(records("run", 2)); // a cut due 900ms on
    s.host.advance(100);
    expect(pose(s)).toBe("look");
    // The lane narrows: everyone is given a place again.
    s.setWidth(602);
    s.resize();
    expect(pose(s)).toBe("run");
    expect(s.peek().gods[0]).toMatchObject({ step: "work", want: "run" });
    expectApart(s.peek());
    // Its dwell and its beat count from the step aside, not from its old beats.
    expect(cutAfter(s, records("make", 3))).toBe(shown + 100 + 900);
  });

  it("under reduced motion a pose is held twice as long, and nothing else differs", () => {
    const s = atWork("hermes", "think", 0, true); // landed and greeted in the usual 2200ms
    let tools = 0;
    const next = (family: ToolFamily): number =>
      cutAfter(s, [agent("a", "hermes", "run", family, ++tools)]);
    expect(next("look")).toBe(2200 + 1800);
    expect(next("run")).toBe(4000 + 1800);
    expect(next("look")).toBe(5800 + 1800); // the third in six seconds: a storm, doubled again
    expect(next("run")).toBe(7600 + 3600);
    const nike = atWork("nike", "look", 1, true);
    expect(nike.cell("a")!.style.transform).toMatch(/px, -8px, 0\)$/);
  });

  describe("an agent sent on again", () => {
    const again = (i: number, more: Partial<(typeof SENT_ON_AGAIN)[number]> = {}): LaneAgent[] =>
      laneAgents([{ agents: [{ ...SENT_ON_AGAIN[i]!, ...more }] }]);

    it("thinks until it starts another tool: its record still names its last turn's", () => {
      const s = stage();
      s.sync(again(0));
      s.host.advance(2200);
      expect(pose(s, "s-again")).toBe("look"); // its first turn: the search its record ends with
      s.sync(again(1)); // idle
      s.host.advance(2900 + 600);
      expect(s.cells()).toHaveLength(0);
      expect(again(2)[0]).toMatchObject({ look: "run", family: "look", tools: 2 });
      s.sync(again(2)); // sent on again, with the same last activity
      expect(watch(s, 6000, "s-again")).toEqual(["", "speak", "think"]);
      // Its next tool, whatever its family: the record is fresh again.
      const more = { toolUseCount: 3, activities: ["Running pnpm test auth"] };
      expect(again(2, more)[0]).toMatchObject({ family: "run", tools: 3 });
      cutAfter(s, again(2, more), "s-again");
      expect(pose(s, "s-again")).toBe("run");
    });

    it("thinks when its god is set again in the moment it leaves", () => {
      const s = stage();
      s.sync(again(0));
      s.host.advance(2200);
      s.sync(again(1));
      s.host.advance(1000);
      s.sync(again(2)); // at work again, its god still saying farewell
      s.host.advance(1900 + 2200);
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
      s.host.advance(2200);
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

/** Gods at their places, each under its own name as its key. */
function crowd(ids: readonly GodId[], opts: Parameters<typeof stage>[0] = {}): Stage {
  const s = stage(opts);
  s.sync(ids.map((god) => agent(god, god)));
  s.host.advance(12_000);
  expect(s.peek().gods.map((god) => god.step)).toEqual(ids.map(() => "work"));
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

  it("the one who flies: her card is over her lift, so her cut up and down never moves it", () => {
    const s = crowd(["nike"]);
    enter(s.cell("nike"));
    const at = s.peek().card;
    expect(at?.foot).toBe(CELL_Y - 2 - CARD_AIR);
    s.sync([agent("nike", "nike", "run", "look", 1)]);
    s.host.advance(4000);
    expect(s.peek().gods[0]).toMatchObject({ pose: "look", lift: 8 });
    expect(s.peek().card).toEqual(at);
    // 2px over the top of her look, lifted.
    expect(CAST.gods.nike.top.look! - 8 - CAST.gods.nike.card).toBeCloseTo(1.9, 6);
  });

  it("not at its work, it stands over the pose shown: the greeting, then the work, then the ending", () => {
    const s = stage();
    const top = CAST.gods.hermes.top;
    s.sync([agent("a", "hermes")]);
    s.host.advance(500);
    expect(s.peek().gods[0]).toMatchObject({ step: "greet", pose: "speak" });
    enter(s.cell("a"));
    expect(s.peek().card).toEqual(placeOf(s, "a", top.speak));
    s.host.advance(1700);
    expect(s.peek().gods[0]!.step).toBe("work");
    expect(s.peek().card).toEqual(placeOf(s, "a", CAST.gods.hermes.card));
    s.sync([agent("a", "hermes", "done")]);
    s.host.advance(0);
    expect(s.peek().gods[0]).toMatchObject({ step: "report", pose: "speak" });
    expect(s.peek().card).toEqual(placeOf(s, "a", top.speak));
    s.host.advance(1700);
    expect(s.peek().gods[0]).toMatchObject({ step: "seal", pose: "stand" });
    expect(s.peek().card).toEqual(placeOf(s, "a", top.stand));
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

  it("cuts with its god when the lane's width changes and the god steps aside", () => {
    const s = crowd(["athena", "hermes", "hephaestus", "argus"]);
    const last = along(s)[3]!;
    enter(s.cell(last));
    const wide = s.peek().card!;
    const x = s.peek().gods.find((god) => god.key === last)!.x;
    s.setWidth(602);
    s.resize();
    expect(s.peek().gods.find((god) => god.key === last)!.x).toBeLessThan(x);
    const narrow = s.peek().card!;
    expect(narrow).toEqual(placeOf(s, last, CAST.gods[last as GodId].card));
    expect(narrow.left).toBe(602 - 6 - TIP_W);
    expect(narrow.left).toBeLessThan(wide.left);
    expect(s.cards).toEqual([last]); // the same card, moved
  });

  it("stays through its god's ending, and is down at once when the god goes", () => {
    const s = crowd(["argus", "athena"]);
    enter(s.cell("argus"));
    s.sync([agent("argus", "argus", "fail"), agent("athena", "athena")]);
    s.host.advance(2999);
    expect(s.peek().gods.find((god) => god.key === "argus")).toMatchObject({ step: "fail" });
    expect(s.peek().card).toEqual(placeOf(s, "argus", CAST.gods.argus.top.stand));
    s.host.advance(1);
    expect(s.peek().gods.map((god) => god.key)).toEqual(["athena"]);
    expect(s.peek().card).toBeNull();
    expect(s.cards).toEqual(["argus", null]);
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
    s.host.advance(2200);
    enter(s.cell("s-again"));
    s.sync(laneAgents([{ agents: [idle!] }]));
    s.host.advance(4000);
    expect(s.cells()).toHaveLength(0);
    s.sync(laneAgents([{ agents: [again!] }]));
    s.host.advance(3000);
    expect(s.cells()).toHaveLength(1);
    expect(s.peek().card).toBeNull();
  });

  it("stands the same with reduced motion asked for: it was a cut already", () => {
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
    s.host.advance(2999);
    expect(document.activeElement).toBe(s.cell("athena")); // it is ending, and still there
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
});
