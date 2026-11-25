// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubAgentLine } from "../SubAgentFeed";
import { agentsAt, MOCK_EXTRAS, MOCK_RUN, RESUMED_AGENTS, STATE_AGENTS } from "./fixtures";
import { GODS } from "./gods";
import { clock, OlympusRows, rowState } from "./OlympusRows";
import rowsCss from "./olympus-rows.css?raw";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(12_000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function rows(agents: readonly SubAgentLine[], aborted = false): HTMLLIElement[] {
  const { container } = render(<OlympusRows agents={agents} aborted={aborted} />);
  return [...container.querySelectorAll<HTMLLIElement>("li.oly-row")];
}
const one = (agent: SubAgentLine, aborted = false): HTMLLIElement => rows([agent], aborted)[0]!;
const meta = (row: Element): string => row.querySelector(".oly-meta")?.textContent ?? "";

describe("a row's state", () => {
  it("starting: the working rim, no step yet, a ticking time", () => {
    const row = one(STATE_AGENTS.starting);
    expect(row.className).toBe("oly-row is-run");
    expect(meta(row)).toBe("Starting · 0:12");
    expect(row.querySelector(".oly-time")?.getAttribute("aria-hidden")).toBe("true");
    expect(row.querySelector(".oly-crack, .oly-check")).toBeNull();
  });

  it("running: its latest activity, the subject as code", () => {
    const row = one(STATE_AGENTS.running);
    expect(row.className).toBe("oly-row is-run");
    expect(meta(row)).toBe("Running · Searching for bcrypt.compare( · 0:12");
    expect(row.querySelector(".oly-now code")?.textContent).toBe("bcrypt.compare(");
  });

  it("done: the check, its result and the time it took, read out", () => {
    const row = one(STATE_AGENTS.done);
    expect(row.className).toBe("oly-row is-done");
    expect(row.querySelector(".oly-check")).not.toBeNull();
    expect(meta(row)).toBe("Done · One early return leaks timing; fix noted · 0:25");
    expect(row.querySelector(".oly-time")?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("failed: the crack, and its error with code in a chip", () => {
    const row = one(STATE_AGENTS.error);
    expect(row.className).toBe("oly-row is-fail");
    expect(row.querySelector(".oly-cameo > .oly-crack")).not.toBeNull();
    expect(meta(row)).toBe("Failed · Lost track of verifyPassword() · 0:09");
    expect(row.querySelector(".oly-now code")?.textContent).toBe("verifyPassword()");
  });

  it("idle: the done look, saying Idle, with its result", () => {
    const row = one(STATE_AGENTS.idle);
    expect(row.className).toBe("oly-row is-done");
    expect(row.querySelector(".oly-check")).not.toBeNull();
    expect(meta(row)).toBe("Idle · One early return leaks timing; fix noted · 1:01");
  });

  it("interrupted: dimmed without a crack, and no result", () => {
    const row = one(STATE_AGENTS.interrupted);
    expect(row.className).toBe("oly-row is-stop");
    expect(row.querySelector(".oly-crack, .oly-check")).toBeNull();
    expect(meta(row)).toBe("Interrupted · 0:07");
  });

  it("aborted: every agent that had not finished is interrupted; the finished keep it", () => {
    // run_end leaves a stopped run's working agents as "error".
    const stopped = { ...STATE_AGENTS.error, toolCallId: "x", durationMs: undefined };
    const [done, idle, running, starting, errored] = rows(
      [STATE_AGENTS.done, STATE_AGENTS.idle, STATE_AGENTS.running, STATE_AGENTS.starting, stopped],
      true,
    );
    expect(meta(done!)).toMatch(/^Done /);
    expect(meta(idle!)).toMatch(/^Idle /);
    for (const row of [running!, starting!, errored!]) {
      expect(row.className).toBe("oly-row is-stop");
      expect(row.querySelector(".oly-crack")).toBeNull();
    }
    // Stopped agents no longer tick, and one with no time shows none.
    expect(meta(running!)).toBe("Interrupted");
    expect(meta(errored!)).toBe("Interrupted");
  });

  it("maps every status, alone and in a stopped run", () => {
    const state = (status: SubAgentLine["status"], aborted = false) =>
      rowState(STATE_AGENTS[status], aborted);
    expect(state("starting")).toEqual({ look: "run", word: "Starting", live: true });
    expect(state("running")).toEqual({ look: "run", word: "Running", live: true });
    expect(state("done")).toEqual({ look: "done", word: "Done", live: false });
    expect(state("idle")).toEqual({ look: "done", word: "Idle", live: false });
    expect(state("error")).toEqual({ look: "fail", word: "Failed", live: false });
    expect(state("interrupted")).toEqual({ look: "stop", word: "Interrupted", live: false });
    for (const status of ["starting", "running", "error", "interrupted"] as const)
      expect(state(status, true)).toEqual({ look: "stop", word: "Interrupted", live: false });
    expect(state("done", true).word).toBe("Done");
    expect(state("idle", true).word).toBe("Idle");
  });
});

describe("a row's god", () => {
  it("shows the mockup's four as their gods, the unnamed one as Nike", () => {
    const list = rows(agentsAt(MOCK_RUN, 12_000, 12_000));
    expect(list.map((row) => row.querySelector(".oly-god")?.textContent)).toEqual([
      "Athena",
      "Hephaestus",
      "Argus",
      "Nike",
    ]);
    expect(list.map((row) => row.querySelector("img")?.getAttribute("src"))).toEqual([
      GODS.athena.cameo,
      GODS.hephaestus.cameo,
      GODS.argus.cameo,
      GODS.nike.cameo,
    ]);
    expect(list[0]!.querySelector(".oly-mark")?.getAttribute("aria-hidden")).toBe("true");
    expect(list[0]!.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("names the agent in the god's tooltip and in the row's words; Nike alone has neither", () => {
    const [athena, , , nike] = rows(agentsAt(MOCK_RUN, 12_000, 12_000));
    expect(athena!.querySelector(".oly-god")?.getAttribute("title")).toBe("owl");
    expect(athena!.querySelector(".oly-line")?.textContent).toBe(
      "Athena(owl) Survey how the other routes throttle requests",
    );
    expect(athena!.querySelector(".oly-line > .sr-only")?.textContent).toBe("(owl) ");
    expect(nike!.querySelector(".oly-god")?.hasAttribute("title")).toBe(false);
    expect(nike!.querySelector(".sr-only")).toBeNull();
    expect(nike!.querySelector(".oly-line")?.textContent).toBe("NikeRun the auth suite");
  });

  it("sets a task's code in chips", () => {
    const [, bee] = rows(agentsAt(MOCK_RUN, 12_000, 12_000));
    const chips = [...bee!.querySelectorAll(".oly-line code")].map((chip) => chip.textContent);
    expect(chips).toEqual(["createLimiter()", "src/http/limits.ts"]);
  });

  it("gives a spawned agent its type's god and its task name, and its raw activity whole", () => {
    const list = rows(agentsAt(MOCK_EXTRAS, 9_000, 12_000));
    expect(list.map((row) => row.querySelector(".oly-line")?.textContent)).toEqual([
      "Herodotus(researcher) lockout-survey",
      "Themis(skeptic) recheck-findings",
      "Hermes(worker) wire-login-limiter",
    ]);
    expect(meta(list[0]!)).toBe("Running · web_fetch: owasp.org/www-community/controls · 0:09");
    expect(list[0]!.querySelector(".oly-now code")).toBeNull();
  });

  it("shows a resumed chat's row with what it kept: its god and its state", () => {
    const [owl, unnamed] = rows(RESUMED_AGENTS);
    expect(owl!.querySelector(".oly-line")?.textContent).toBe("Athena(owl) ");
    expect(meta(owl!)).toBe("Done");
    expect(unnamed!.querySelector(".oly-god")?.textContent).toBe("Nike");
    expect(meta(unnamed!)).toBe("Failed");
  });

  it("draws nothing for no agents, and a labelled list otherwise", () => {
    const { container } = render(<OlympusRows agents={[]} />);
    expect(container.firstChild).toBeNull();
    cleanup();
    const filled = render(<OlympusRows agents={[STATE_AGENTS.done]} />);
    expect(filled.container.querySelector("ul.oly-rows")?.getAttribute("aria-label")).toBe(
      "Subagents",
    );
  });
});

describe("a row's time", () => {
  it("writes m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(59_999)).toBe("0:59");
    expect(clock(61_000)).toBe("1:01");
    expect(clock(-5)).toBe("0:00");
  });

  it("ticks once a second while an agent works, and stops when none does", () => {
    const view = render(<OlympusRows agents={[STATE_AGENTS.running]} />);
    const time = (): string => view.container.querySelector(".oly-time")?.textContent ?? "";
    expect(time()).toBe("0:12");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(time()).toBe("0:15");
    view.rerender(<OlympusRows agents={[STATE_AGENTS.done]} />);
    expect(time()).toBe("0:25");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no timer for agents that have all ended", () => {
    render(<OlympusRows agents={[STATE_AGENTS.done, STATE_AGENTS.error]} />);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the rows' CSS", () => {
  it("moves nothing, so it needs no reduced-motion rule", () => {
    expect(rowsCss).not.toMatch(/animation|transition|@keyframes/);
    expect(rowsCss).not.toMatch(/prefers-reduced-motion/);
  });

  it("keeps to its own class names", () => {
    const rules = rowsCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const classes = new Set([...rules.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]!));
    expect([...classes].filter((name) => !/^(oly-|is-)/.test(name))).toEqual([]);
  });

  it("dims a failed and a stopped cameo alike, and cracks neither by CSS", () => {
    expect(rowsCss).toMatch(/\.oly-row:is\(\.is-fail, \.is-stop\) \.oly-cameo img \{\n {2}filter:/);
  });
});
