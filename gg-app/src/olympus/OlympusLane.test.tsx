// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentsAt,
  manualHost,
  MOCK_EXTRAS,
  MOCK_RUN,
  MOCK_SKILLS,
  RESUMED_AGENTS,
  STATE_AGENTS,
} from "./fixtures";
import type { Floor } from "./floor";
import laneCss from "./olympus-lane.css?raw";
import rowsCss from "./olympus-rows.css?raw";
import { laneAgents, OlympusLane, type LaneGroup, type LaneStage } from "./OlympusLane";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A lane on a clock that moves only when told to. */
function staged(
  seed = 7,
): LaneStage & { host: ReturnType<typeof manualHost>; floors: (Floor | null)[] } {
  const host = manualHost();
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
  it("is a shut frame, hidden from assistive technology, with nothing to focus", () => {
    const stage = staged();
    const { container } = render(<OlympusLane groups={[]} stage={stage} />);
    const lane = container.querySelector(".oly-lane")!;
    expect(lane.className).toBe("oly-lane is-shut");
    expect(lane.getAttribute("aria-hidden")).toBe("true");
    expect(lane.querySelector(".oly-stylobate .oly-names")).not.toBeNull();
    expect(lane.querySelectorAll(".oly-anta")).toHaveLength(2);
    expect(container.querySelectorAll("[role], [tabindex], button, a, input")).toHaveLength(0);
  });

  it("stands the run's agents as their gods, in the order they were sent", () => {
    const stage = staged();
    const { container } = render(<OlympusLane groups={run(600)} stage={stage} />);
    stage.host.advance(0);
    expect(container.querySelector(".oly-lane")!.classList.contains("is-shut")).toBe(false);
    stage.host.advance(500 + 3 * 850 + 400);
    expect(gods(container)).toEqual(["athena", "hephaestus", "argus", "nike"]);
    expect([...container.querySelectorAll(".oly-ins")].map((name) => name.textContent)).toEqual([
      "Athena",
      "Hephaestus",
      "Argus",
      "Nike",
    ]);
    // With gods on it, it is still hidden and has nothing to focus.
    expect(container.querySelectorAll("[role], [tabindex], button, a, input")).toHaveLength(0);
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(1);
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
    step(20_100); // the owl and the bee have finished and gone; the others work on
    expect(gods(view.container)).toEqual(["argus", "nike"]);
    expect(seen).toContain("athena is-sealed");
    expect(seen).toContain("hephaestus is-sealed");
    step(20_700); // the agent with no name has failed, 20.14s after it was sent
    expect(lane.querySelector('.oly-cell[data-god="nike"]')!.className).toContain("is-cracked");
    step(32_000);
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
        if (pose && pose !== "speak" && pose !== seen[seen.length - 1]) seen.push(pose);
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
    stage.host.advance(8000);
    view.rerender(
      <OlympusLane groups={[{ agents: agentsAt(MOCK_RUN, 9000), aborted: true }]} stage={stage} />,
    );
    stage.host.advance(0);
    const cells = [...view.container.querySelectorAll(".oly-cell")];
    expect(cells).toHaveLength(4);
    expect(cells.every((cell) => cell.classList.contains("is-dim"))).toBe(true);
    expect(cells.some((cell) => cell.classList.contains("is-cracked"))).toBe(false);
    stage.host.advance(3600);
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

  it("holds each pose twice as long with the setting on, and nothing else differs", () => {
    const off = play(false);
    const on = play(true);
    expect(off.frames).toContain("oly-ribbon");
    // The engine asks the window, each time it works out a dwell.
    expect(off.asked).toBeGreaterThan(0);
    expect(on.asked).toBeGreaterThan(0);
    expect(on.frames).not.toBe(off.frames);
    // The bee edits, tests and edits again inside a second: Hephaestus is cut to
    // his test run, and holds it twice as long before the cut back to his making.
    const first = (frames: string): number =>
      frames
        .split("\n")
        .findIndex((frame) => /data-god="hephaestus"[^>]*data-pose="make"/.test(frame));
    expect(first(off.frames)).toBe(39); // 250ms a frame
    expect(first(on.frames)).toBe(43);
    // Which skill pose shows, and how high Nike is, aside: the same lane, frame for frame.
    const still = (frames: string): string =>
      frames
        .replace(/data-pose="(?:look|web|make|run|think|think-l|think-r)"/g, 'data-pose="work"')
        .replace(/px, -8px, 0\)/g, "px, 0, 0)");
    expect(still(on.frames)).toBe(still(off.frames));
  });
});

describe("the lane's CSS", () => {
  const rules = laneCss.replace(/\/\*[\s\S]*?\*\//g, "");

  it("moves nothing, so it needs no reduced-motion rule", () => {
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

  it("takes no pointer, so nothing on it can be pressed or hovered yet", () => {
    expect(rules).toMatch(/\.oly-lane \{[^}]*pointer-events: none;/);
  });

  it("shows one pose at a time, by a cut", () => {
    expect(rules).toMatch(/\.oly-pose \{\n {2}display: block;\n {2}visibility: hidden;\n\}/);
    expect(rules).toContain(
      '.oly-cell[data-pose="stand"] .oly-p-stand,\n.oly-cell[data-pose="speak"] .oly-p-speak {\n  visibility: visible;',
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

  it("dims a failed and a stopped god alike, and cracks only where the engine says", () => {
    expect(rules).toMatch(
      /\.oly-cell\.is-dim \.oly-poses \{\n {2}filter: grayscale\(0\.6\) brightness\(0\.74\) contrast\(0\.92\);/,
    );
    expect(rules).toMatch(/\.oly-fissure \{\n {2}display: none;/);
    expect(rules).toMatch(/\.oly-cell\.is-cracked \.oly-fissure \{\n {2}display: block;/);
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
