// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentsAt,
  framedHost,
  type ManualHost,
  MOCK_EXTRAS,
  MOCK_RUN,
  MOCK_SKILLS,
  RESUMED_AGENTS,
  STATE_AGENTS,
} from "./fixtures";
import type { Floor } from "./floor";
import laneCss from "./olympus-lane.css?raw";
import rowsCss from "./olympus-rows.css?raw";
import { cardAgent, laneAgents, OlympusLane, type LaneGroup, type LaneStage } from "./OlympusLane";
import { OlympusRows } from "./OlympusRows";
import type { SubAgentLine } from "../SubAgentFeed";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A lane on a clock that moves only when told to, and draws a frame for the moment each advance ends on. */
function staged(seed = 7): LaneStage & { host: ManualHost; floors: (Floor | null)[] } {
  const host = framedHost();
  const floors: (Floor | null)[] = [];
  return {
    host,
    floors,
    seed,
    width: () => 698,
    measure: (el) => Math.round((el.textContent ?? "").length * 5.5) + 21,
    onFloor: (floor) => floors.push(floor),
  };
}

/** Long enough for one god to land, greet and walk to its place, and for a second after it. */
const AT_WORK = 9000;
const run = (ms: number): LaneGroup[] => [{ agents: agentsAt(MOCK_RUN, ms) }];
const gods = (container: HTMLElement): (string | undefined)[] =>
  [...container.querySelectorAll<HTMLElement>(".oly-cell")].map((cell) => cell.dataset.god);

describe("the records the lane is given", () => {
  it("reads each agent as its row does", () => {
    const looks = (aborted: boolean): Record<string, string> =>
      Object.fromEntries(
        laneAgents([{ agents: Object.values(STATE_AGENTS), aborted }]).map((a) => [a.key, a.look]),
      );
    expect(looks(false)).toEqual({
      "s-starting": "run",
      "s-running": "run",
      "s-done": "done",
      "s-error": "fail",
      "s-idle": "done",
      "s-interrupted": "stop",
    });
    // A stopped run: whoever had finished keeps that, and everyone else was interrupted.
    expect(looks(true)).toEqual({
      "s-starting": "stop",
      "s-running": "stop",
      "s-done": "done",
      "s-error": "stop",
      "s-idle": "done",
      "s-interrupted": "stop",
    });
  });

  it("casts each agent as its row's god, a spawned one by the agent it runs as", () => {
    const cast = (agents: LaneGroup["agents"]): string[] =>
      laneAgents([{ agents }]).map((a) => `${a.key} ${a.god}`);
    expect(cast(agentsAt(MOCK_RUN, 1000))).toEqual([
      "owl-1 athena",
      "bee-1 hephaestus",
      "auditor-1 argus",
      "unnamed-1 nike",
    ]);
    expect(cast(agentsAt(MOCK_EXTRAS, 1000))).toEqual([
      "agent-r1 herodotus",
      "agent-s1 themis",
      "agent-w1 hermes",
    ]);
  });

  it("gives each agent the family of its latest tool, humanized or raw, and its tool count", () => {
    const tools = (agents: LaneGroup["agents"]): string[] =>
      laneAgents([{ agents }]).map((a) => `${a.key} ${a.family} ${a.tools}`);
    expect(tools(agentsAt(MOCK_RUN, 9000))).toEqual([
      "owl-1 look 6",
      "bee-1 run 6",
      "auditor-1 run 3",
      "unnamed-1 web 3",
    ]);
    expect(tools(agentsAt(MOCK_EXTRAS, 6000))).toEqual([
      "agent-r1 look 2",
      "agent-s1 run 3",
      "agent-w1 make 2",
    ]);
    // No activity yet, and a tool with no family: thinking.
    expect(tools(agentsAt(MOCK_EXTRAS, 300))).toEqual([
      "agent-r1 think 0",
      "agent-s1 think 0",
      "agent-w1 think 0",
    ]);
    expect(tools([STATE_AGENTS.starting])).toEqual(["s-starting think 2"]);
    expect(tools(agentsAt(MOCK_SKILLS.slice(0, 1), 18_000))).toEqual(["skills-owl think 5"]);
  });

  it("takes every group's agents, in the transcript's order", () => {
    const groups = [{ agents: agentsAt(MOCK_RUN, 1000) }, { agents: agentsAt(MOCK_EXTRAS, 1000) }];
    expect(laneAgents(groups).map((a) => a.key)).toEqual([
      "owl-1",
      "bee-1",
      "auditor-1",
      "unnamed-1",
      "agent-r1",
      "agent-s1",
      "agent-w1",
    ]);
  });

  it("leaves out a resumed chat's rows, which kept no start time", () => {
    expect(laneAgents([{ agents: RESUMED_AGENTS }])).toEqual([]);
    const running = { ...RESUMED_AGENTS[0]!, status: "running" as const };
    expect(laneAgents([{ agents: [running] }])).toEqual([]);
  });
});

describe("the lane", () => {
  it("is a shut frame round an empty toolbar: every part hidden from assistive technology, nothing to focus", () => {
    const stage = staged();
    const { container } = render(<OlympusLane groups={[]} stage={stage} />);
    const lane = container.querySelector(".oly-lane")!;
    expect(lane.className).toBe("oly-lane is-shut");
    // The toolbar is hidden while it is empty; the step and the antae always.
    expect(lane.hasAttribute("aria-hidden")).toBe(false);
    expect([...lane.children].map((el) => [el.className, el.getAttribute("aria-hidden")])).toEqual([
      ["oly-gods", "true"],
      ["oly-stylobate", "true"],
      ["oly-anta is-l", "true"],
      ["oly-anta is-r", "true"],
    ]);
    const toolbar = lane.querySelector(".oly-gods")!;
    expect(toolbar.getAttribute("role")).toBe("toolbar");
    expect(toolbar.getAttribute("aria-label")).toBe("Subagents on the lane");
    expect(lane.querySelector(".oly-stylobate .oly-names")).not.toBeNull();
    expect([...container.querySelectorAll("[role]")]).toEqual([toolbar]);
    expect(container.querySelectorAll("[tabindex], button, a, input")).toHaveLength(0);
    // Before the lane, the card's frame: hidden too, with nobody's card in it.
    const anchor = container.firstElementChild!;
    expect(anchor.className).toBe("oly-card-anchor");
    expect(anchor.getAttribute("aria-hidden")).toBe("true");
    expect(anchor.nextElementSibling).toBe(lane);
    expect(container.children).toHaveLength(2);
    expect(anchor.innerHTML).toBe('<div class="oly-card"></div>');
  });

  it("stands the run's agents as their gods, in the order they were sent", () => {
    const stage = staged();
    const { container } = render(<OlympusLane groups={run(600)} stage={stage} />);
    stage.host.advance(0);
    expect(container.querySelector(".oly-lane")!.classList.contains("is-shut")).toBe(false);
    // One at a time, 850ms apart or as soon after as there is room to set the next.
    for (let ms = 0; ms < 8000 && gods(container).length < 4; ms += 50) stage.host.advance(50);
    expect(gods(container)).toEqual(["athena", "hephaestus", "argus", "nike"]);
    expect([...container.querySelectorAll(".oly-ins")].map((name) => name.textContent)).toEqual([
      "Athena",
      "Hephaestus",
      "Argus",
      "Nike",
    ]);
    // The gods are the toolbar's buttons, each under its own name and described by its agent's
    // row, with nothing to press yet; one of them is the lane's tab stop.
    const cells = [...container.querySelectorAll<HTMLElement>(".oly-cell")];
    expect([...container.querySelectorAll("[role='button']")]).toEqual(cells);
    expect(cells.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "Athena",
      "Hephaestus",
      "Argus",
      "Nike",
    ]);
    expect(cells.map((cell) => cell.getAttribute("aria-describedby"))).toEqual([
      "oly-row-owl-1",
      "oly-row-bee-1",
      "oly-row-auditor-1",
      "oly-row-unnamed-1",
    ]);
    expect(cells.every((cell) => cell.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(cells.map((cell) => cell.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(container.querySelectorAll("button, a, input")).toHaveLength(0);
    // The toolbar is no longer hidden; the card's frame, the step and the antae still are.
    expect(container.querySelector(".oly-gods")!.hasAttribute("aria-hidden")).toBe(false);
    expect(
      [...container.querySelectorAll("[aria-hidden]")].map((el) => el.className.split(" ")[0]),
    ).toEqual(["oly-card-anchor", "oly-stylobate", "oly-anta", "oly-anta"]);
  });

  it("follows the records as they change, and shuts when the run is over", () => {
    const stage = staged();
    const view = render(<OlympusLane groups={run(600)} stage={stage} />);
    const lane = view.container.querySelector(".oly-lane")!;
    const seen = new Set<string>();
    let ms = 600;
    const step = (to: number): void => {
      for (; ms < to; ms += 100) {
        view.rerender(<OlympusLane groups={run(ms)} stage={stage} />);
        stage.host.advance(100);
        for (const cell of lane.querySelectorAll<HTMLElement>(".oly-cell")) {
          const line = cell.querySelector(".oly-ribbon")?.textContent;
          if (line) seen.add(line);
          for (const state of ["is-sealed", "is-dim", "is-cracked"])
            if (cell.classList.contains(state)) seen.add(`${cell.dataset.god} ${state}`);
        }
      }
    };
    step(12_900);
    expect(gods(view.container)).toEqual(["athena", "hephaestus", "argus", "nike"]);
    expect([...seen].filter((what) => / is-/.test(what))).toEqual([]);
    step(18_000); // the owl has finished: its god sealed its scroll, walked off and went
    expect(gods(view.container)).toEqual(["hephaestus", "argus", "nike"]);
    expect(seen).toContain("athena is-sealed");
    step(21_500); // the bee's god is sealed and on its way; the agent with no name failed 20.14s after it was sent
    expect(seen).toContain("hephaestus is-sealed");
    expect(lane.querySelector('.oly-cell[data-god="nike"]')!.className).toContain("is-cracked");
    step(26_000); // both have gone, and the auditor works on
    expect(gods(view.container)).toEqual(["argus"]);
    step(36_000);
    expect(gods(view.container)).toEqual([]);
    expect(lane.classList.contains("is-shut")).toBe(true);
    expect(seen).toContain("argus is-sealed");
    expect([...seen].filter((what) => what.endsWith("is-dim"))).toEqual(["nike is-dim"]);
    // Farewells were said on the way, by those who had room for one.
    const farewells = [
      "It is written.",
      "I leave it with you.",
      "Sealed, and yours.",
      "Built to last.",
      "Nothing got past me.",
    ];
    expect([...seen].some((line) => farewells.includes(line))).toBe(true);
  });

  it("shows each god acting its agent's tools through a whole turn, in its own poses", () => {
    /** The poses one god is cut through at its place, its agent alone on the lane. */
    const worked = (def: (typeof MOCK_SKILLS)[number]): string[] => {
      const stage = staged();
      const at = (ms: number): LaneGroup[] => [{ agents: agentsAt([def], ms) }];
      const view = render(<OlympusLane groups={at(0)} stage={stage} />);
      const seen: string[] = [];
      for (let ms = 0; ms < 30_000; ms += 100) {
        view.rerender(<OlympusLane groups={at(ms)} stage={stage} />);
        stage.host.advance(100);
        const pose = view.container.querySelector<HTMLElement>(".oly-cell")?.dataset.pose;
        // Its greeting and its walk to its place aside.
        if (!pose || ["speak", "stride", "stand"].includes(pose)) continue;
        if (pose !== seen[seen.length - 1]) seen.push(pose);
      }
      view.unmount();
      return seen;
    };
    // The tools: look, web, make, run, none, look, none.
    expect(Object.fromEntries(MOCK_SKILLS.map((def) => [def.id, worked(def)]))).toEqual({
      "skills-owl": ["look", "think", "look", "think"],
      "skills-researcher": ["look", "web", "think", "look", "think"],
      "skills-worker": ["look", "think", "make", "run", "think", "look", "think"],
      "skills-bee": ["look", "think", "make", "run", "think", "look", "think"],
      "skills-auditor": ["look", "web", "think", "run", "think", "look", "think"],
      "skills-skeptic": ["look", "web", "think-r", "run", "think-l", "look", "think-r"],
      "skills-unnamed": ["look", "make", "run", "think", "look", "think"],
    });
  });

  it("a stopped run: finished agents' gods have gone, the rest dim without a crack", () => {
    const stage = staged();
    const view = render(<OlympusLane groups={run(600)} stage={stage} />);
    stage.host.advance(10_000); // all four at their work
    view.rerender(
      <OlympusLane
        groups={[{ agents: agentsAt(MOCK_RUN, 10_600), aborted: true }]}
        stage={stage}
      />,
    );
    stage.host.advance(0);
    const cells = [...view.container.querySelectorAll(".oly-cell")];
    expect(cells).toHaveLength(4);
    expect(cells.some((cell) => cell.classList.contains("is-dim"))).toBe(false); // they stand a moment
    stage.host.advance(1200);
    expect(cells.every((cell) => cell.classList.contains("is-dim"))).toBe(true);
    expect(cells.some((cell) => cell.classList.contains("is-cracked"))).toBe(false);
    stage.host.advance(1800 + 240); // 3s in all, and they go
    expect(view.container.querySelectorAll(".oly-cell")).toHaveLength(0);
    stage.host.advance(600 + 360);
    expect(view.container.querySelector(".oly-lane")!.classList.contains("is-shut")).toBe(true);
  });

  it("summons nobody for a resumed chat's rows", () => {
    const stage = staged();
    const running = { ...RESUMED_AGENTS[0]!, status: "running" as const };
    const { container } = render(
      <OlympusLane groups={[{ agents: [...RESUMED_AGENTS, running] }]} stage={stage} />,
    );
    stage.host.advance(10_000);
    expect(gods(container)).toEqual([]);
    expect(container.querySelector(".oly-lane")!.classList.contains("is-shut")).toBe(true);
  });

  it("unmounted: its engine is taken down, and nothing is left on the clock", () => {
    const stage = staged();
    const view = render(<OlympusLane groups={run(600)} stage={stage} />);
    stage.host.advance(2000);
    expect(stage.floors).toHaveLength(1);
    view.unmount();
    expect(stage.floors).toEqual([expect.anything(), null]);
    expect(stage.host.pending()).toBe(0);
  });
});

describe("reduced motion", () => {
  /** The lane's markup every 250ms through the mockup's run. */
  function play(reduce: boolean): { frames: string; asked: number } {
    const matchMedia = vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    const stage = staged(11);
    const view = render(<OlympusLane groups={run(0)} stage={stage} />);
    const frames: string[] = [];
    for (let ms = 0; ms <= 30_000; ms += 250) {
      view.rerender(<OlympusLane groups={run(ms)} stage={stage} />);
      stage.host.advance(250);
      frames.push(view.container.innerHTML);
    }
    view.unmount();
    return { frames: frames.join("\n"), asked: matchMedia.mock.calls.length };
  }

  it("with the setting on nothing travels, and each pose is held twice as long; with it off the lane moves", () => {
    const off = play(false);
    const on = play(true);
    expect(off.frames).toContain("oly-ribbon");
    expect(on.frames).toContain("oly-ribbon");
    // The engine asks the window, each time it has something to decide.
    expect(off.asked).toBeGreaterThan(0);
    expect(on.asked).toBeGreaterThan(0);
    // Off: a walk, a god showing, a ribbon unrolling and the lane rising were all caught on the way.
    expect(off.frames).toMatch(/data-pose="stride"/);
    expect(off.frames).toMatch(/class="oly-fig" style="opacity: 0\.\d/);
    expect(off.frames).toMatch(/--oly-u: 0\.\d*[1-9]/);
    expect(off.frames).toMatch(/class="oly-lane" style="height: \d/);
    // On: never. Every ribbon is whole, nothing is part shown, part dimmed or
    // pressed, nobody strides, and the lane's height is never the engine's.
    expect(on.frames).not.toMatch(
      /data-pose="stride"|style="[^"]*(?:opacity|height|scale\(|--oly-dim|--oly-crack)/,
    );
    expect(new Set(on.frames.match(/--oly-u: [^;]*/g))).toEqual(new Set(["--oly-u: 1.000"]));
    // The bee edits, tests and edits again inside a second: Hephaestus is cut to
    // his test run, and holds it twice as long before the cut back to his
    // making: in the frame the stills had it in.
    const first = (frames: string): number =>
      frames
        .split("\n")
        .findIndex((frame) => /data-god="hephaestus"[^>]*data-pose="make"/.test(frame));
    expect(first(on.frames)).toBe(43); // 250ms a frame
  });
});

describe("the lane's CSS", () => {
  const rules = laneCss.replace(/\/\*[\s\S]*?\*\//g, "");

  it("animates nothing itself: every move is the engine's, so it needs no reduced-motion rule", () => {
    expect(laneCss).not.toMatch(/animation|transition|@keyframes/);
    expect(laneCss).not.toMatch(/prefers-reduced-motion/);
    expect(rules).not.toMatch(/will-change/);
  });

  it("keeps to its own class names, and takes none of the rows'", () => {
    const names = (css: string): Set<string> =>
      new Set([...css.matchAll(/\.((?:oly|is)-[\w-]*)/g)].map((m) => m[1]!));
    const mine = names(rules);
    // Outside its own: only the session's regions it is fitted into.
    const all = new Set([...rules.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]!));
    expect([...all].filter((name) => !/^(oly-|is-)/.test(name)).sort()).toEqual([
      "app",
      "app-session",
      "dragover",
      "inputwrap",
      "liveregion",
      "platform-ios",
      "task-activity",
    ]);
    const rows = names(rowsCss.replace(/\/\*[\s\S]*?\*\//g, ""));
    expect([...mine].filter((name) => name.startsWith("oly-") && rows.has(name))).toEqual([]);
  });

  it("takes no pointer on its frame; a god's cell and its name do, and a hidden pose is not there to point at", () => {
    expect(rules).toMatch(/\.oly-lane \{[^}]*pointer-events: none;/);
    expect(rules).toContain(".oly-cell,\n.oly-ins {\n  pointer-events: auto;\n}");
    // Nothing else is given the pointer back, and a pose not shown is hidden outright.
    expect(rules.match(/pointer-events/g)).toHaveLength(2);
    expect(rules).toMatch(/\.oly-pose \{\n {2}display: block;\n {2}visibility: hidden;\n\}/);
    expect(rules).not.toMatch(/cursor/); // nothing to press yet
  });

  it("shows focus on a god by a cartouche round its carved name, not by an outline on its cell", () => {
    expect(rules).toContain(".oly-cell:focus {\n  outline: none;\n}");
    expect(rules).toContain(
      ".oly-ins.is-focus {\n  outline: 2px solid #3b3133;\n  outline-offset: 2px;\n  border-radius: 2px;\n}",
    );
  });

  it("shows the card by a cut, in a frame of no height before the lane", () => {
    expect(rules).toMatch(/\.oly-card \{[^}]*display: none;[^}]*width: 272px;/);
    expect(rules).toContain(".oly-card.is-shown {\n  display: block;\n}");
    expect(rules).toMatch(
      /\.oly-card-anchor \{\n {2}position: relative;\n {2}display: flow-root;[^}]*\n {2}height: 0;\n {2}margin: 0 var\(--kleio-gutter\);/,
    );
    // Its foot is the engine's, counted from the lane's inner top: under an 8px margin and a 1px rule.
    expect(rules).toMatch(/\.oly-card \{[^}]*bottom: calc\(-9px - var\(--oly-ty, 0px\)\);/);
    expect(rules).toMatch(
      /\.oly-lane \{[^}]*margin: 8px var\(--kleio-gutter\) 0;[^}]*border: 1px solid/,
    );
    expect(rules).toMatch(/\.oly-card::after \{[^}]*left: var\(--oly-caret, 28px\);/);
  });

  it("shows one pose at a time, by a cut", () => {
    expect(rules).toMatch(/\.oly-pose \{\n {2}display: block;\n {2}visibility: hidden;\n\}/);
    expect(rules).toContain(
      '.oly-cell[data-pose="stand"] .oly-p-stand,\n.oly-cell[data-pose="speak"] .oly-p-speak,\n.oly-cell[data-pose="stride"] .oly-p-stride {\n  visibility: visible;',
    );
  });

  it("shows a skill pose by the same cut, one rule for the seven of them", () => {
    const skills = ["look", "web", "make", "run", "think", "think-l", "think-r"];
    expect(rules).toContain(
      `${skills.map((pose) => `.oly-cell[data-pose="${pose}"] .oly-p-${pose}`).join(",\n")} {\n  visibility: visible;\n}`,
    );
    // Where a pose's picture sits is the engine's: no rule here places one.
    expect(rules).not.toMatch(/\.oly-p-[\w-]+[^{]*\{[^}]*(?:left|width|transform)/);
  });

  it("dims a failed and a stopped god alike, and cracks only where the engine says; how far, on the way, is the engine's", () => {
    // All the way with nothing said: 0.6, 0.74 and 0.92, as the stills had it.
    expect(rules).toContain(
      ".oly-cell.is-dim .oly-poses {\n  filter: grayscale(calc(0.6 * var(--oly-dim, 1))) brightness(calc(1 - 0.26 * var(--oly-dim, 1)))\n    contrast(calc(1 - 0.08 * var(--oly-dim, 1)));\n}",
    );
    expect(rules).toMatch(
      /\.oly-fissure \{\n {2}display: none;[^}]*opacity: var\(--oly-crack, 1\);/,
    );
    expect(rules).toMatch(/\.oly-cell\.is-cracked \.oly-fissure \{\n {2}display: block;/);
  });

  it("unrolls a ribbon as far as the engine says, behind its rolled end; whole with nothing said", () => {
    expect(rules).toContain(
      ".oly-ribbon.is-r {\n  transform-origin: 0 50%;\n  clip-path: inset(-6px calc((1 - var(--oly-u, 1)) * (100% - 5px)) -6px -6px);\n}",
    );
    expect(rules).toContain(
      ".oly-ribbon.is-l {\n  transform-origin: 100% 50%;\n  clip-path: inset(-6px -6px -6px calc((1 - var(--oly-u, 1)) * (100% - 5px)));\n}",
    );
    // The roll rides the band's end, and is gone once the ribbon is whole.
    expect(rules).toMatch(
      /\.oly-roll \{[^}]*width: 5px;[^}]*opacity: clamp\(0, \(1 - var\(--oly-u, 1\)\) \* 14, 1\);/,
    );
    expect(rules).toContain(
      ".oly-ribbon.is-r .oly-roll {\n  left: calc(var(--oly-u, 1) * (100% - 5px));\n}",
    );
    expect(rules).toContain(
      ".oly-ribbon.is-l .oly-roll {\n  right: calc(var(--oly-u, 1) * (100% - 5px));\n}",
    );
  });

  it("reads from the engine only what it is handed: a place for the seal and the card, and three amounts", () => {
    const read = new Set([...rules.matchAll(/var\((--oly-[\w-]+)/g)].map((m) => m[1]!));
    const own = new Set([...rules.matchAll(/^\s*(--oly-[\w-]+):/gm)].map((m) => m[1]!));
    expect([...read].filter((name) => !own.has(name)).sort()).toEqual([
      "--oly-caret",
      "--oly-crack",
      "--oly-dim",
      "--oly-ex",
      "--oly-ey",
      "--oly-ty",
      "--oly-u",
    ]);
    // The lane's height is the stylesheet's when it is open and when it is shut; between, the engine's.
    expect(rules.match(/^\s*height: \d+px;/gm)).toEqual(
      expect.arrayContaining(["  height: 125px;"]),
    );
  });

  it("joins the lane to the activity line only while it is open, and only on the desktop", () => {
    expect(rules).toMatch(
      /html:not\(\.platform-ios\)\n {2}\.app\.app-session\n {2}> \.liveregion:has\(> \.oly-lane:not\(\.is-shut\)\)\n {2}> \.oly-lane\n {2}\+ \.task-activity:last-child \{/,
    );
    expect(rules).toMatch(
      /\.oly-lane\.is-shut \{\n {2}height: 0;\n {2}margin-top: 0;\n {2}border-width: 0;/,
    );
  });
});

describe("the card's words", () => {
  const KEY = "it";
  const record = (
    status: keyof typeof STATE_AGENTS,
    over: Partial<SubAgentLine> = {},
  ): SubAgentLine => ({
    ...STATE_AGENTS[status],
    toolCallId: KEY,
    ...over,
  });

  /** A turn's rows, its lane and the composer's text box, as a session has them. */
  function Session({
    agents,
    aborted = false,
    stage,
    onEscape,
  }: {
    agents: readonly SubAgentLine[];
    aborted?: boolean;
    stage: LaneStage;
    onEscape?: () => void;
  }): React.ReactElement {
    return (
      <>
        <OlympusRows agents={agents} aborted={aborted} />
        <OlympusLane groups={[{ agents, aborted }]} stage={stage} />
        <textarea
          data-composer-input=""
          onKeyDown={(e) => {
            if (e.key === "Escape") onEscape?.();
          }}
        />
      </>
    );
  }

  /** The mockup's clock for a row: twelve seconds after its agent was sent. */
  function pinned(): ReturnType<typeof staged> {
    vi.useFakeTimers();
    vi.setSystemTime(12_000);
    return staged();
  }

  /** A god at its work with the pointer on it, then its agent's record as it is now. */
  function pointedAt(now: SubAgentLine, aborted = false): HTMLElement {
    const stage = pinned();
    const first = now.status === "starting" ? now : record("running");
    const view = render(<Session agents={[first]} stage={stage} />);
    act(() => stage.host.advance(AT_WORK));
    const cell = view.container.querySelector(".oly-cell")!;
    expect(cell.getAttribute("data-pose")).not.toBe("speak");
    act(() => void cell.dispatchEvent(new Event("pointerenter")));
    view.rerender(<Session agents={[now]} aborted={aborted} stage={stage} />);
    act(() => stage.host.advance(0));
    return view.container;
  }

  const text = (el: Element | null | undefined): string => el?.textContent ?? "";
  /** What a row says, piece by piece. */
  function rowSays(container: HTMLElement): Record<string, unknown> {
    const row = container.querySelector("li.oly-row")!;
    const line = row.querySelector(".oly-line")!.cloneNode(true) as HTMLElement;
    for (const el of line.querySelectorAll(".oly-god, .sr-only")) el.remove();
    return {
      look: row.className.replace("oly-row is-", ""),
      god: text(row.querySelector(".oly-god")),
      state: text(row.querySelector(".oly-state")),
      tick: row.querySelector(".oly-check") !== null,
      task: text(line),
      now: [...row.querySelectorAll(".oly-now")].map((el) => text(el).replace(/^ · /, "")),
      time: text(row.querySelector(".oly-time")),
      chips: [...row.querySelectorAll("code")].map(text),
    };
  }
  /** And what the card says of the same. */
  function cardSays(container: HTMLElement): Record<string, unknown> {
    const card = container.querySelector(".oly-card")!;
    expect(card.className).toBe("oly-card is-shown");
    const state = card.querySelector(".oly-card-state")!;
    return {
      look: state.className.replace("oly-card-state is-", ""),
      god: text(card.querySelector(".oly-card-god")),
      state: text(state),
      tick: card.querySelector(".oly-card-tick") !== null,
      task: text(card.querySelector(".oly-card-task")),
      now: [...card.querySelectorAll(".oly-card-now")].map(text),
      // A time the row has none of is a dash in the card's own slot for it.
      time: text(card.querySelectorAll(".oly-card-stats dd")[2]).replace("\u2013", ""),
      chips: [...card.querySelectorAll("code")].map(text),
    };
  }
  const stats = (container: HTMLElement): string[] =>
    [...container.querySelectorAll(".oly-card-stats > div")].map(text);

  it.each([
    ["starting", false, "Starting", [], "0:12"],
    ["running", false, "Running", ["Searching for bcrypt.compare("], "0:12"],
    ["done", false, "Done", ["One early return leaks timing; fix noted"], "0:25"],
    ["error", false, "Failed", ["Lost track of verifyPassword()"], "0:09"],
    ["idle", false, "Idle", ["One early return leaks timing; fix noted"], "1:01"],
    ["interrupted", false, "Interrupted", [], "0:07"],
    ["running", true, "Interrupted", [], ""],
  ] as const)("%s (run stopped: %s): the row's words, %s", (status, aborted, word, now, time) => {
    const container = pointedAt(record(status), aborted);
    const card = cardSays(container);
    expect(card).toEqual(rowSays(container));
    expect(card).toMatchObject({
      god: "Argus",
      state: word,
      now,
      tick: word === "Done" || word === "Idle",
    });
    // Then what only the card has: its tokens, its tools and its time.
    expect(stats(container)).toEqual(["Tokens4.7k", "Tools2", `Time${time || "–"}`]);
  });

  it("a god whose agent has no activity yet: no line for what it is doing, as in its row", () => {
    const container = pointedAt(record("running", { activities: [], toolUseCount: 0 }));
    expect(cardSays(container)).toEqual(rowSays(container));
    expect(cardSays(container)).toMatchObject({ state: "Running", now: [] });
    expect(container.querySelector(".oly-card-now")).toBeNull();
    expect(stats(container)[1]).toBe("Tools0");
  });

  it("a spawned agent: its task name for a task; an agent with neither: no task line", () => {
    const spawned = pointedAt(
      record("running", { async: true, agentName: "audit-login", task: undefined }),
    );
    expect(cardSays(spawned)).toEqual(rowSays(spawned));
    expect(cardSays(spawned)).toMatchObject({ god: "Argus", task: "audit-login" });
    cleanup();
    const bare = pointedAt(
      record("running", { agentName: undefined, agentType: undefined, task: undefined }),
    );
    expect(cardSays(bare)).toEqual(rowSays(bare));
    expect(cardSays(bare)).toMatchObject({ god: "Nike", task: "" });
    expect(bare.querySelector(".oly-card-task")).toBeNull();
  });

  it("sets code in chips as the row does, and counts tokens as one figure", () => {
    const container = pointedAt(record("done"));
    expect(cardSays(container).chips).toEqual(["login.ts"]);
    cleanup();
    const usage = (input: number, output: number, cached = 0): SubAgentLine =>
      record("running", { tokenUsage: { input, output, cacheRead: cached, cacheWrite: 100 } });
    expect(stats(pointedAt(usage(0, 0)))[0]).toBe("Tokens100");
    cleanup();
    // What it re-read from the cache is left out: it would swamp the rest.
    expect(stats(pointedAt(usage(19_800, 2_200, 480_000)))[0]).toBe("Tokens22.1k");
    cleanup();
    expect(stats(pointedAt(record("running", { tokenUsage: { input: 0, output: 0 } })))[0]).toBe(
      "Tokens0",
    );
  });

  it("its time ticks once a second while its agent works, on a clock of its own", () => {
    const stage = pinned();
    const view = render(<Session agents={[record("running")]} stage={stage} />);
    act(() => stage.host.advance(AT_WORK));
    act(
      () =>
        void view.container.querySelector(".oly-cell")!.dispatchEvent(new Event("pointerenter")),
    );
    expect(stats(view.container)[2]).toBe("Time0:12");
    const waiting = stage.host.pending();
    act(() => void vi.advanceTimersByTime(3000));
    expect(stats(view.container)[2]).toBe("Time0:15");
    expect(cardSays(view.container)).toEqual(rowSays(view.container));
    expect(stage.host.pending()).toBe(waiting); // nothing of it on the lane's clock
  });

  it("is empty until a god is pointed at, and again 150ms after the pointer has gone", () => {
    const stage = pinned();
    const { container } = render(<Session agents={[record("running")]} stage={stage} />);
    act(() => stage.host.advance(AT_WORK));
    const card = container.querySelector(".oly-card")!;
    expect(card.outerHTML).toBe('<div class="oly-card"></div>');
    const cell = container.querySelector(".oly-cell")!;
    act(() => void cell.dispatchEvent(new Event("pointerenter")));
    expect(card.className).toBe("oly-card is-shown");
    expect(card.getAttribute("style")).toMatch(
      /^transform: translate3d\([\d.]+px, 0(px)?, 0(px)?\); --oly-ty: -1\.0px; --oly-caret: 30\.0px;$/,
    );
    act(() => void cell.dispatchEvent(new Event("pointerleave")));
    act(() => stage.host.advance(149));
    expect(card.className).toBe("oly-card is-shown");
    act(() => stage.host.advance(1));
    expect(card.className).toBe("oly-card");
    expect(card.innerHTML).toBe("");
  });

  it("two agents as one god: each god's card is its own agent's", () => {
    const stage = pinned();
    const two = [
      record("running", {
        toolCallId: "a",
        agentName: undefined,
        agentType: undefined,
        task: "First",
      }),
      record("running", {
        toolCallId: "b",
        agentName: undefined,
        agentType: undefined,
        task: "Second",
      }),
    ];
    const { container } = render(<Session agents={two} stage={stage} />);
    act(() => stage.host.advance(AT_WORK));
    const cells = [...container.querySelectorAll(".oly-cell")];
    expect(cells.map((cell) => cell.getAttribute("aria-label"))).toEqual(["Nike", "Nike"]);
    expect(cells.map((cell) => cell.getAttribute("aria-describedby"))).toEqual([
      "oly-row-a",
      "oly-row-b",
    ]);
    for (const [i, task] of ["First", "Second"].entries()) {
      act(() => void cells[i]!.dispatchEvent(new Event("pointerenter")));
      expect(text(container.querySelector(".oly-card-task"))).toBe(task);
      // The row that describes it is there, under that id, and says the same.
      const row = document.getElementById(cells[i]!.getAttribute("aria-describedby")!)!;
      expect(text(row.querySelector(".oly-line"))).toContain(task);
    }
  });

  it("finds a card's record as the lane takes its records: live ones, the first with its key", () => {
    const live = record("running");
    const groups: LaneGroup[] = [
      { agents: [...RESUMED_AGENTS] },
      { agents: [live], aborted: true },
      { agents: [record("done")] },
    ];
    expect(cardAgent(groups, KEY)).toEqual({ agent: live, aborted: true });
    expect(cardAgent(groups, "history-0")).toBeNull();
    expect(cardAgent(groups, "nobody")).toBeNull();
    expect(cardAgent(groups, null)).toBeNull();
  });

  it("Esc with the pointer on a god hides its card and still reaches the composer; with no card, it only reaches it", () => {
    const stage = pinned();
    const onEscape = vi.fn();
    const { container } = render(
      <Session agents={[record("running")]} stage={stage} onEscape={onEscape} />,
    );
    act(() => stage.host.advance(AT_WORK));
    const box = container.querySelector("textarea")!;
    box.focus();
    act(() => void fireEvent.keyDown(box, { key: "Escape" }));
    expect(onEscape).toHaveBeenCalledTimes(1);
    act(() => void container.querySelector(".oly-cell")!.dispatchEvent(new Event("pointerenter")));
    expect(container.querySelector(".oly-card")!.className).toBe("oly-card is-shown");
    act(() => void fireEvent.keyDown(box, { key: "Escape" }));
    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".oly-card")!.className).toBe("oly-card");
  });

  it("when the last god leaves with focus, focus goes to the composer's text box", () => {
    const stage = pinned();
    const view = render(<Session agents={[record("running")]} stage={stage} />);
    act(() => stage.host.advance(AT_WORK));
    const cell = view.container.querySelector<HTMLElement>(".oly-cell")!;
    act(() => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      cell.focus();
    });
    expect(view.container.querySelector(".oly-card")!.className).toBe("oly-card is-shown");
    expect(view.container.querySelector(".oly-ins")!.className).toBe("oly-ins is-focus");
    view.rerender(<Session agents={[]} stage={stage} />);
    act(() => stage.host.advance(0));
    expect(view.container.querySelectorAll(".oly-cell")).toHaveLength(0);
    expect(document.activeElement).toBe(view.container.querySelector("textarea"));
    expect(view.container.querySelector(".oly-card")!.className).toBe("oly-card");
  });

  it("unmounted with a card up: nothing is left on the clock, and its keys are no longer heard", () => {
    const stage = pinned();
    const view = render(<Session agents={[record("running")]} stage={stage} />);
    act(() => stage.host.advance(AT_WORK));
    const cell = view.container.querySelector(".oly-cell")!;
    act(() => void cell.dispatchEvent(new Event("pointerenter")));
    act(() => void cell.dispatchEvent(new Event("pointerleave"))); // a grace is waiting
    view.unmount();
    expect(stage.host.pending()).toBe(0);
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
