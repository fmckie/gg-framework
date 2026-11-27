// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CourtProps } from "../olympus/OlympusCourt";
import { GODS } from "../olympus/gods";
import type { GoalFinish } from "./goal-finish";
import themeCss from "../kleio/kleio-theme.css?raw";

// The courtyard's mount, as what it is given each time it is drawn.
const court = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("../olympus/CourtMount", () => ({
  CourtMount: (props: unknown) => {
    court.props.push(props);
    return <div data-testid="court" />;
  },
}));
const given = (): Omit<CourtProps, "stage"> =>
  court.props[court.props.length - 1] as Omit<CourtProps, "stage">;
vi.mock("./stele-image", () => ({ copyStele: vi.fn() }));

const { WorkerList } = await import("./WorkerList");

afterEach(() => {
  cleanup();
  court.props.length = 0;
  document.documentElement.classList.remove("platform-ios");
});

describe("WorkerList", () => {
  it("lists the coordinator, then each worker with its state and activity", () => {
    render(
      <WorkerList
        running
        waitingOnUser={false}
        liveTools={[{ toolCallId: "a", name: "spawn_agent", args: {}, status: "running" }]}
        groups={[
          {
            id: 1,
            agents: [
              {
                toolCallId: "t1",
                agentName: "researcher",
                status: "running",
                activities: ["Reading src/app.ts"],
                toolUseCount: 1,
              },
              { toolCallId: "t2", status: "error", activities: [], toolUseCount: 0 },
            ],
          },
        ]}
      />,
    );
    const rows = within(screen.getByRole("region", { name: "Workers" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent?.trim())).toEqual([
      "Kleio Goals WorkingBringing in help",
      "researcher WorkingReading src/app.ts",
      "Agent 2 StoppedStopped",
    ]);
    expect(screen.getAllByRole("img", { name: "Working" })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Stopped" })).toBeTruthy();
  });

  it("says when no workers have been brought in yet", () => {
    render(<WorkerList running={false} waitingOnUser liveTools={[]} groups={[]} />);
    expect(screen.getByRole("img", { name: "Waiting for you" })).toBeTruthy();
    expect(screen.getByText(/No workers yet/)).toBeTruthy();
  });

  it("gives each agent a hairline row of a desktop session, its mark by its state", () => {
    const view = "html:not(.platform-ios) .app.app-session > .goal-workers";
    const draw = (): void => {
      render(
        <div className="app app-session">
          <WorkerList
            running={false}
            waitingOnUser={false}
            liveTools={[]}
            groups={[
              {
                id: 1,
                agents: [
                  { toolCallId: "a", status: "running", activities: [], toolUseCount: 0 },
                  { toolCallId: "b", status: "done", activities: [], toolUseCount: 0 },
                  { toolCallId: "c", status: "error", activities: [], toolUseCount: 0 },
                ],
              },
            ]}
          />
        </div>,
      );
    };
    draw();
    const region = screen.getByRole("region", { name: "Workers" });
    expect(region.matches(view)).toBe(true);
    const rows = within(region).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual([
      "idle",
      "working",
      "done",
      "error",
    ]);
    expect(rows.every((row) => row.matches(`${view} .placeholder-row`))).toBe(true);

    expect(themeCss).toContain(
      `${view} .placeholder-row {\n  gap: 16px;\n  padding: 11px 0;\n  border-top: 1px solid var(--kleio-rule);\n}`,
    );
    // Hollow until it works; lapis at work; verdigris once done.
    expect(themeCss).toContain(
      " .placeholder-dot {\n  box-sizing: border-box;\n  width: 9px;\n  height: 9px;\n  border: 1.5px solid var(--kleio-muted);\n  background: none;\n}",
    );
    expect(themeCss).toContain(
      '  .placeholder-dot[data-tone="active"] {\n  border-color: var(--kleio-lapis);\n  background: var(--kleio-lapis);\n}',
    );
    expect(themeCss).toContain(
      '  :is([data-tone="done"], [data-status="done"])\n  .placeholder-dot {\n  border-color: var(--kleio-done);\n  background: var(--kleio-done);\n}',
    );

    // The iPhone keeps the plain list.
    cleanup();
    document.documentElement.classList.add("platform-ios");
    draw();
    expect(screen.getByRole("region", { name: "Workers" }).matches(view)).toBe(false);
  });
});

describe("the courtyard over the rows", () => {
  const groups = [
    {
      id: 1,
      agents: [
        {
          toolCallId: "t1",
          agentName: "researcher",
          status: "running" as const,
          activities: ["Reading src/app.ts", "Searching web for vitest"],
          toolUseCount: 2,
        },
        {
          toolCallId: "t2",
          agentName: "fix-the-tests",
          agentType: "bee",
          async: true,
          status: "done" as const,
          activities: ["Running pnpm test"],
          toolUseCount: 4,
        },
        { toolCallId: "t3", status: "error" as const, activities: [], toolUseCount: 0 },
      ],
    },
    {
      id: 2,
      aborted: true,
      agents: [
        {
          toolCallId: "t1",
          agentName: "owl",
          status: "running" as const,
          activities: ["Editing a.ts"],
          toolUseCount: 1,
        },
        {
          toolCallId: "t4",
          agentName: "worker",
          status: "idle" as const,
          activities: [],
          toolUseCount: 0,
        },
      ],
    },
  ];
  const draw = (running: boolean, waitingOnUser: boolean): React.ReactElement => (
    <div className="app app-session">
      <WorkerList running={running} waitingOnUser={waitingOnUser} liveTools={[]} groups={groups} />
    </div>
  );

  it("is given each worker as its god, with its row's name, how it stands and its latest tool's family", () => {
    render(draw(true, false));
    // Over the rows, in their scroll.
    const scroll = screen.getByRole("region", { name: "Workers" }).firstElementChild!;
    expect([...scroll.children].map((el) => el.tagName)).toEqual(["DIV", "UL"]);
    expect(scroll.firstElementChild).toBe(screen.getByTestId("court"));
    expect(given().agents).toEqual([
      { key: "1:t1", god: "herodotus", label: "researcher", status: "working", family: "web" },
      // A spawned agent's name is its task's: its god is the agent it runs as.
      { key: "1:t2", god: "hephaestus", label: "fix-the-tests", status: "done", family: "run" },
      { key: "1:t3", god: "nike", label: "Agent 3", status: "failed", family: "think" },
      // A stopped run: whoever was still at work was stopped, not failed.
      { key: "2:t1", god: "athena", label: "owl", status: "stopped", family: "make" },
      { key: "2:t4", god: "hermes", label: "worker", status: "idle", family: "think" },
    ]);
  });

  it("is given the coordinator's state for its hearth: at work, waiting on you, or idle", () => {
    const { rerender } = render(draw(true, false));
    expect(given().hearth).toBe("working");
    rerender(draw(true, true));
    expect(given().hearth).toBe("waiting");
    rerender(draw(false, false));
    expect(given().hearth).toBe("idle");
  });

  it("each worker's row opens with its god's cameo, the coordinator's with its hearth, and says whose it is", () => {
    render(draw(true, false));
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-key"))).toEqual([
      "coordinator",
      "1:t1",
      "1:t2",
      "1:t3",
      "2:t1",
      "2:t4",
    ]);
    expect(
      rows.slice(1).map((row) => row.querySelector("img.goal-worker-cameo")?.getAttribute("src")),
    ).toEqual(
      (["herodotus", "hephaestus", "nike", "athena", "hermes"] as const).map(
        (id) => GODS[id].cameo,
      ),
    );
    // Decoration: the row's words are the record.
    expect(rows[1]!.querySelector("img.goal-worker-cameo")?.getAttribute("alt")).toBe("");
    expect(rows[0]!.querySelector("svg.goal-worker-hearth")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(rows[0]!.querySelector("img")).toBeNull();
    expect(rows[1]!.querySelector(".goal-worker-hearth")).toBeNull();
    const view = "html:not(.platform-ios) .app.app-session > .goal-workers";
    expect(themeCss).toContain(`${view} .oly-court {\n  margin-bottom: 18px;\n}`);
    expect(themeCss).toContain(
      `${view} .goal-worker-cameo {\n  flex: none;\n  align-self: center;\n  width: 24px;\n  height: 32px;\n  margin: -6px 2px -6px 0;\n}`,
    );
    expect(themeCss).toContain(
      `${view} .placeholder-row.is-marked strong {\n  color: var(--kleio-lapis);\n}`,
    );
  });

  it("a row pointed at marks its god's name; a god pointed at marks its row", () => {
    render(draw(true, false));
    const rows = screen.getAllByRole("listitem");
    expect(given().marked).toBeNull();
    fireEvent.pointerEnter(rows[2]!);
    expect(given().marked).toBe("1:t2");
    fireEvent.pointerLeave(rows[2]!);
    expect(given().marked).toBeNull();
    const marks = (): boolean[] => rows.map((row) => row.classList.contains("is-marked"));
    act(() => given().onHover?.("2:t1"));
    expect(marks()).toEqual([false, false, false, false, true, false]);
    act(() => given().onHover?.(null));
    expect(marks()).toEqual([false, false, false, false, false, false]);
  });

  it("the iPhone keeps the plain rows: no cameo and no hearth", () => {
    document.documentElement.classList.add("platform-ios");
    render(draw(true, false));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(document.querySelector(".goal-worker-cameo, .goal-worker-hearth")).toBeNull();
  });
});

describe("the finale: a finished stretch on the stage and its stele", () => {
  const groups = [
    {
      id: 4,
      agents: [{ toolCallId: "old", status: "done" as const, activities: [], toolUseCount: 50 }],
    },
    {
      id: 12,
      agents: [
        {
          toolCallId: "a",
          agentName: "survey",
          agentType: "owl",
          async: true,
          status: "done" as const,
          activities: [],
          toolUseCount: 3,
          durationMs: 65_000,
        },
        {
          toolCallId: "b",
          agentName: "bee",
          status: "done" as const,
          activities: [],
          toolUseCount: 7,
          durationMs: 4000,
        },
        { toolCallId: "c", status: "error" as const, activities: [], toolUseCount: 30 },
      ],
    },
  ];
  const finish = (outcome: GoalFinish["outcome"] = "done"): GoalFinish => ({
    id: 8000,
    goalId: "g",
    outcome,
    fromItemId: 10,
    elapsedMs: 70_000,
    turns: 5,
    workers: 3,
    failedWorkers: 1,
    outputTokens: 1500,
    line: "",
  });
  const draw = (
    over: Partial<React.ComponentProps<typeof WorkerList>> = {},
  ): React.ReactElement => (
    <div className="app app-session">
      <WorkerList
        running={false}
        waitingOnUser={false}
        liveTools={[]}
        groups={groups}
        finish={finish()}
        {...over}
      />
    </div>
  );

  it("stands the stele between the stage and the rows, with the stretch's own workers", () => {
    render(draw());
    const scroll = screen.getByRole("region", { name: "Workers" }).firstElementChild!;
    expect([...scroll.children].map((el) => el.tagName)).toEqual(["DIV", "SECTION", "UL"]);
    const stele = screen.getByRole("region", { name: "Job done: each worker's account" });
    expect(
      stele.matches("html:not(.platform-ios) .app.app-session > .goal-workers .goal-stele"),
    ).toBe(true);
    // Not the worker from before the stretch, however much it did.
    const lines = within(stele).getAllByRole("row").slice(1);
    expect(lines.map((line) => line.getAttribute("data-key"))).toEqual(["12:a", "12:b", "12:c"]);
    expect(lines.map((line) => line.querySelector("img")?.getAttribute("src"))).toEqual([
      GODS.athena.cameo,
      GODS.hephaestus.cameo,
      GODS.nike.cameo,
    ]);
    expect(within(lines[1]!).getByText("Laurels: most tools used")).toBeTruthy();
    expect(within(stele).getByText("3 (1 failed)")).toBeTruthy();
    // Each line says of its worker what that worker's row says, and carries the row's status.
    const rows = within(scroll.lastElementChild as HTMLElement).getAllByRole("listitem");
    const rowOf = (key: string | null): HTMLElement => rows.find((row) => row.dataset.key === key)!;
    const said = lines.map((line) => line.children[1]!.textContent);
    expect(said).toEqual(["Done", "Done", "Stopped"]);
    expect(said).toEqual(
      lines.map(
        (line) =>
          rowOf(line.getAttribute("data-key")).querySelector(
            ":scope > span:first-child > .placeholder-muted",
          )?.textContent,
      ),
    );
    expect(lines.map((line) => line.getAttribute("data-status"))).toEqual(
      lines.map((line) => rowOf(line.getAttribute("data-key")).dataset.status),
    );

    // A bounded panel of the session; its cap the stylobate's marble, in flat bands.
    const view = "html:not(.platform-ios) .app.app-session > .goal-workers";
    expect(themeCss).toContain(
      `${view} .goal-stele {\n  margin-bottom: 18px;\n  overflow: hidden;\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;\n  background: var(--kleio-surface);\n  font-variant-numeric: tabular-nums;\n}`,
    );
    expect(themeCss).toContain(
      `${view} .goal-stele-cap {\n  padding: 13px 14px 9px;\n  background: #c3b9af;\n  box-shadow:\n    inset 0 1px 0 #e9e2da,\n    inset 0 3px 0 #d2c9bf,\n    inset 0 4px 0 #aca298,\n    inset 0 -1px 0 #8f857c;\n}`,
    );
    expect(themeCss).toContain(
      `${view} .goal-stele-mark {\n  flex: none;\n  fill: var(--kleio-done);\n}`,
    );
    // The rows' own rule dims the cameo of a stopped worker's line.
    expect(
      lines.map((line) =>
        line.querySelector("img")!.matches(`${view} [data-status="error"] img.goal-worker-cameo`),
      ),
    ).toEqual([false, false, true]);
  });

  it("ends the stage on it: a finished hearth, and the laurel for the worker that did most", () => {
    const { rerender } = render(draw());
    expect(given().hearth).toBe("finished");
    expect(given().laurel).toBe("12:b");
    rerender(draw({ finish: finish("unverified") }));
    expect(given().hearth).toBe("finished");
    expect(given().laurel).toBe("12:b");
    // The finale ends with the finish: closed, or work started again.
    rerender(draw({ finish: null }));
    expect(given().hearth).toBe("idle");
    expect(given().laurel).toBeNull();
    expect(screen.queryByRole("region", { name: /each worker's account/ })).toBeNull();
    rerender(draw({ running: true }));
    expect(given().hearth).toBe("working");
  });

  it("leaves the hearth in embers and crowns nobody when the stretch couldn't finish", () => {
    render(draw({ finish: finish("failed") }));
    expect(given().hearth).toBe("idle");
    expect(given().laurel).toBeNull();
    const stele = screen.getByRole("region", { name: "Couldn't finish: each worker's account" });
    expect(stele.querySelector(".goal-stele-mark, .goal-stele-laurel")).toBeNull();
    expect(within(stele).getAllByRole("row")).toHaveLength(4);
  });

  it("has no finale without a finish", () => {
    render(draw({ finish: undefined }));
    expect(given().hearth).toBe("idle");
    expect(given().laurel).toBeNull();
    expect(document.querySelector(".goal-stele")).toBeNull();
  });

  it("the iPhone keeps the plain list: no stele", () => {
    document.documentElement.classList.add("platform-ios");
    render(draw());
    expect(document.querySelector(".goal-stele")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });
});
