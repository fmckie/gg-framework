// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentsAt,
  manualHost,
  MOCK_EXTRAS,
  MOCK_RUN,
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

  it("is the same lane with the setting on or off: every state is already a still", () => {
    const off = play(false);
    const on = play(true);
    expect(off.frames).toContain("oly-ribbon");
    expect(on.frames).toBe(off.frames);
    // The engine never asks: there is no motion for the setting to take away.
    expect(on.asked + off.asked).toBe(0);
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
