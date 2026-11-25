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
import { createSim } from "./sim";
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
  cells(): HTMLElement[];
  names(): string[];
  setWidth(width: number): void;
  resize(): void;
  dispose(): void;
}

/** A lane with a clock that moves only when told to; a letter is 5.5px wide. */
function stage({ seed = 7, width = 698, letter = 5.5, reduced = false } = {}): Stage {
  const lane = document.createElement("div");
  lane.className = "oly-lane is-shut";
  lane.innerHTML =
    '<div class="oly-gods"></div><div class="oly-stylobate"><div class="oly-names"></div></div>';
  document.body.append(lane);
  const host = manualHost();
  let w = width;
  const floor = createFloor(lane, {
    sim: createSim(host),
    cast: CAST,
    poses: POSE_URLS,
    random: rng(seed),
    width: () => w,
    measure: (el) => Math.round((el.textContent ?? "").length * letter) + 21,
    reduced: () => reduced,
  });
  const order = new Map<string, HTMLElement>();
  const cells = (): HTMLElement[] => [...lane.querySelectorAll<HTMLElement>(".oly-cell")];
  return {
    lane,
    host,
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

  it("builds each god from its pictures, its seal and its crack, and nothing to focus", () => {
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
    expect(s.lane.querySelectorAll("[role], [tabindex], button, a, input")).toHaveLength(0);
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
