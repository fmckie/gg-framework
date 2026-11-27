// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { updateGoal, type GoalStateInfo, type ModelOption } from "../agent";
import type { Item } from "../transcript-item";
import { GoalPanel } from "./GoalPanel";
import themeCss from "../kleio/kleio-theme.css?raw";

vi.mock("../agent", () => ({ updateGoal: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const GOAL: GoalStateInfo = {
  id: "api-latency",
  name: "API latency",
  needsKickoff: false,
  phase: "active",
  critterModel: null,
};
const MODELS: ModelOption[] = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "anthropic" },
  { id: "gpt-6", name: "GPT-6", provider: "openai" },
  {
    id: "claude-opus-5-5-fast",
    name: "Claude Opus 5.5 Fast",
    provider: "anthropic",
    billing: {
      label: "bills usage credits",
      detail: "",
      paid: true,
      standardModel: "claude-opus-5-5",
    },
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.classList.remove("platform-ios");
});

const base = {
  view: "workers" as const,
  onViewChange: vi.fn(),
  models: MODELS,
  onSelectWorkerModel: vi.fn(),
};

describe("GoalPanel", () => {
  it("switches between the chat and the workers once the goal is underway", () => {
    const onViewChange = vi.fn();
    render(
      <GoalPanel
        goal={GOAL}
        view="workers"
        onViewChange={onViewChange}
        needsAnswer
        models={MODELS}
        onSelectWorkerModel={vi.fn()}
      />,
    );
    expect(screen.getByText("Underway")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Workers" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat (waiting for you)" }));
    expect(onViewChange).toHaveBeenCalledWith("chat");
  });

  it("has no view switch while the goal is being briefed", () => {
    render(
      <GoalPanel
        goal={{ ...GOAL, phase: "briefing" }}
        view={null}
        onViewChange={vi.fn()}
        models={MODELS}
        onSelectWorkerModel={vi.fn()}
      />,
    );
    expect(screen.getByText("Briefing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Workers" })).toBeNull();
  });

  it("pins the workers' model, and clears it back to the coordinator's", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <GoalPanel
        goal={GOAL}
        view="chat"
        onViewChange={vi.fn()}
        models={MODELS}
        onSelectWorkerModel={onSelect}
      />,
    );
    const select = screen.getByLabelText("Workers' model") as HTMLSelectElement;
    expect(select.value).toBe("");
    // Paid tiers are only for the main chat.
    expect(screen.queryByRole("option", { name: "Claude Opus 5.5 Fast" })).toBeNull();
    fireEvent.change(select, { target: { value: "gpt-6" } });
    expect(onSelect).toHaveBeenLastCalledWith("gpt-6");

    rerender(
      <GoalPanel
        goal={{ ...GOAL, critterModel: "gpt-6" }}
        view="chat"
        onViewChange={vi.fn()}
        models={MODELS}
        onSelectWorkerModel={onSelect}
      />,
    );
    fireEvent.change(select, { target: { value: "" } });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("counts the workers and tasks, and pauses a running goal", () => {
    const onPauseChange = vi.fn();
    render(
      <GoalPanel
        {...base}
        goal={GOAL}
        running
        onPauseChange={onPauseChange}
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
      />,
    );
    expect(screen.getByText("1 working · 1 done · 1 failed")).toBeTruthy();
    // The status pill says what the coordinator is doing.
    expect(screen.getByText("Thinking")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause the goal" }));
    expect(onPauseChange).toHaveBeenCalledWith(true);
  });

  it("offers to resume a paused goal, and to carry on a stopped one", () => {
    const onPauseChange = vi.fn();
    const { rerender } = render(
      <GoalPanel {...base} goal={{ ...GOAL, paused: true }} onPauseChange={onPauseChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume the goal" }));
    expect(onPauseChange).toHaveBeenLastCalledWith(false);
    rerender(<GoalPanel {...base} goal={GOAL} onPauseChange={onPauseChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Not running. Carry the goal on" }));
    expect(onPauseChange).toHaveBeenLastCalledWith(false);
  });

  it("says what the coordinator is waiting on over the Workers view, until the chat is seen", () => {
    const onViewChange = vi.fn();
    const items = [
      {
        kind: "ask",
        id: 3,
        prompt: {
          id: "ask-1",
          questions: [
            { id: "q", kind: "confirm", question: "Ship it?" },
            { id: "r", kind: "confirm", question: "Tag it?" },
          ],
        },
      },
    ] as unknown as Item[];
    const { rerender } = render(
      <GoalPanel {...base} goal={GOAL} items={items} onViewChange={onViewChange} />,
    );
    expect(screen.getByText("Ship it?")).toBeTruthy();
    expect(screen.getByText(/And 1 more question/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Answer in Chat" }));
    expect(onViewChange).toHaveBeenCalledWith("chat");

    rerender(<GoalPanel {...base} view="chat" goal={GOAL} items={items} />);
    rerender(<GoalPanel {...base} goal={GOAL} items={items} />);
    expect(screen.queryByText("Ship it?")).toBeNull();
  });

  it("saves changed instructions, and holds changes while the goal works", async () => {
    vi.mocked(updateGoal).mockResolvedValue({ context: [], instructions: "Keep URLs." });
    const onSaved = vi.fn();
    const { rerender } = render(
      <GoalPanel {...base} goal={{ ...GOAL, instructions: "" }} running onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Goal settings" }));
    expect(screen.getByText(/Pause it to change its settings/)).toBeTruthy();
    expect((screen.getByLabelText(/Instructions/) as HTMLTextAreaElement).disabled).toBe(true);

    rerender(<GoalPanel {...base} goal={{ ...GOAL, instructions: "" }} onSaved={onSaved} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Instructions/), { target: { value: " Keep URLs. " } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({ context: [], instructions: "Keep URLs." }),
    );
    expect(updateGoal).toHaveBeenCalledWith({ context: [], instructions: "Keep URLs." });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows the finish card once a stretch of work has gone quiet", async () => {
    vi.useFakeTimers();
    try {
      const runs = [
        {
          goalId: GOAL.id,
          startedAt: 1000,
          endedAt: 5000,
          fromItemId: 0,
          turns: 4,
          outputTokens: 900,
          outcome: "done" as const,
        },
      ];
      const { rerender } = render(<GoalPanel {...base} goal={GOAL} running runs={runs} />);
      expect(screen.queryByRole("status", { name: "Job done" })).toBeNull();
      rerender(<GoalPanel {...base} goal={GOAL} runs={runs} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(screen.getByRole("status", { name: "Job done" })).toBeTruthy();
      // Work starting again takes it down.
      rerender(<GoalPanel {...base} goal={GOAL} running runs={runs} />);
      expect(screen.queryByRole("status", { name: "Job done" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the finish it shows to the Workers view, and null when it comes down", async () => {
    vi.useFakeTimers();
    try {
      const runs = [
        {
          goalId: GOAL.id,
          startedAt: 1000,
          endedAt: 5000,
          fromItemId: 7,
          turns: 4,
          outputTokens: 900,
          outcome: "done" as const,
        },
      ];
      const onFinish = vi.fn();
      const props = { ...base, goal: GOAL, runs, onFinish };
      const { rerender, unmount } = render(<GoalPanel {...props} running />);
      expect(onFinish).toHaveBeenLastCalledWith(null);
      rerender(<GoalPanel {...props} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(onFinish).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 5000, goalId: GOAL.id, outcome: "done", fromItemId: 7 }),
      );
      // Not over the chat: the card is only ever over the Workers view.
      rerender(<GoalPanel {...props} view="chat" />);
      expect(onFinish).toHaveBeenLastCalledWith(null);
      expect(onFinish.mock.calls.filter(([finish]) => finish !== null)).toHaveLength(1);

      // Closing the card takes the finale down with it.
      const again = [...runs, { ...runs[0]!, startedAt: 6000, endedAt: 9000 }];
      rerender(<GoalPanel {...props} runs={again} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(onFinish).toHaveBeenLastCalledWith(expect.objectContaining({ id: 9000 }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onFinish).toHaveBeenLastCalledWith(null);

      // Leaving the goal leaves no finish behind.
      onFinish.mockClear();
      unmount();
      expect(onFinish).toHaveBeenLastCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });
});

const PANEL = "html:not(.platform-ios) .app.app-session > .goal-panel";

/** The stylesheet's section for a goal's session, up to the next one. */
function goalCss(): string {
  const from = themeCss.indexOf("/* ── A goal's session ──");
  return themeCss.slice(from, themeCss.indexOf("/* ── A Chat's title ──", from));
}

describe("GoalPanel in a desktop session", () => {
  it("sets the goal out in two lines of the session's column: what it is beside the view switch, then its controls", () => {
    render(
      <div className="app app-session">
        <GoalPanel {...base} goal={GOAL} needsAnswer onPauseChange={vi.fn()} />
      </div>,
    );
    const bar = screen.getByRole("group", { name: "Goal" });
    expect(bar.matches(`${PANEL} > .goal-bar`)).toBe(true);
    expect([...bar.children].map((el) => el.className)).toEqual([
      "goal-bar-title",
      "goal-bar-views",
      "goal-bar-tools",
    ]);

    // The first line: name, phase and tally, and the switch.
    const title = screen.getByText("API latency").parentElement;
    expect(title?.matches(`${PANEL} .goal-bar-title`)).toBe(true);
    expect(title?.contains(screen.getByText("Underway"))).toBe(true);
    expect(title?.contains(screen.getByText("0 working · 0 done"))).toBe(true);
    expect(screen.getByRole("group", { name: "Goal view" }).parentElement).toBe(bar);
    // A question waiting in the chat marks its tab.
    const chat = screen.getByRole("button", { name: "Chat (waiting for you)" });
    expect(
      chat.matches(`${PANEL} .goal-bar-views > button:is(:hover, :focus-visible, [data-waiting])`),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Workers" }).hasAttribute("data-waiting")).toBe(
      false,
    );

    // The second: pause and settings together, the workers' model apart.
    const actions = screen.getByRole("button", {
      name: "Not running. Carry the goal on",
    }).parentElement;
    expect(actions?.className).toBe("goal-bar-actions");
    expect(screen.getByRole("button", { name: "Goal settings" }).parentElement).toBe(actions);
    const select = screen.getByLabelText("Workers' model");
    expect(select.matches(`${PANEL} .goal-bar-select > select`)).toBe(true);
    const model = select.closest(".goal-bar-model");
    expect(model?.contains(screen.getByText("Workers' model"))).toBe(true);
    expect([actions?.parentElement, model?.parentElement]).toEqual([
      bar.lastElementChild,
      bar.lastElementChild,
    ]);

    const css = goalCss();
    expect(css).toContain(
      `${PANEL} > .goal-bar {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 10px 16px;\n  padding: 14px var(--kleio-gutter) 12px;\n  border-bottom: 1px solid var(--kleio-rule);\n}`,
    );
    // A line that can't hold both groups starts each at the left.
    expect(css).toContain(
      `${PANEL} .goal-bar-tools {\n  grid-column: 1 / -1;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: space-between;`,
    );
    expect(css).toContain(
      `  > .goal-panel\n  :is(.goal-bar-actions, .goal-ask, .goal-finish-actions)\n  > button {\n  flex: none;\n  height: 28px;\n  padding: 0 12px;\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;\n  background: transparent;`,
    );
  });

  it("is flat: square corners, no glass, blur, gradient or amber", () => {
    const css = goalCss();
    expect(css.length).toBeGreaterThan(2000);
    expect([...css.matchAll(/border-radius: ([^;]+);/g)].map((m) => m[1])).toEqual(
      expect.arrayContaining(["3px", "2px"]),
    );
    expect(css).not.toMatch(/border-radius: (?!2px;|3px;)/);
    expect(css).not.toMatch(/blur\(|gradient\(|var\(--warning\)|animation|transition/);
    // Every rule is the desktop session's own.
    for (const rule of css.matchAll(/^(html[^{]*)\{/gm)) {
      expect(rule[1]).toMatch(
        /^html:not\(\.platform-ios\)\s+\.app\.app-session\s+> (\.goal-panel|\.goal-workers|:is\(\.goal-panel, \.goal-workers\))/,
      );
    }
  });

  it("says what the coordinator is doing and what it is waiting on in the column's own rows", () => {
    const items = [
      {
        kind: "ask",
        id: 3,
        prompt: { id: "ask-1", questions: [{ id: "q", kind: "confirm", question: "Ship it?" }] },
      },
    ] as unknown as Item[];
    render(
      <div className="app app-session">
        <GoalPanel {...base} goal={GOAL} items={items} needsAnswer />
      </div>,
    );
    const pill = screen.getByText("Waiting for you").closest('[role="status"]');
    expect(pill?.parentElement?.matches(`${PANEL} > .goal-status`)).toBe(true);
    const ask = screen.getByText("Ship it?").closest('[role="status"]');
    expect(ask?.matches(`${PANEL} > .goal-ask`)).toBe(true);
    expect(screen.getByRole("button", { name: "Answer in Chat" }).parentElement).toBe(ask);
    // Waiting on you is a lapis ring, never amber.
    expect(goalCss()).toContain(
      '  .placeholder-dot[data-tone="warning"] {\n  border-color: var(--kleio-lapis);\n}',
    );
  });

  it("opens the goal's settings as New goal's dialog", () => {
    render(<GoalPanel {...base} goal={{ ...GOAL, instructions: "" }} />);
    const button = screen.getByRole("button", { name: "Goal settings" });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Goal settings" });
    expect(dialog.classList.contains("goal-form-modal")).toBe(true);
    const form = within(dialog).getByRole("form", { name: "Goal settings" });
    expect(form.className).toBe("goal-form");
    expect(within(form).getByRole("button", { name: "Save" }).parentElement?.className).toBe(
      "goal-form-actions",
    );
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("GoalPanel on the iPhone", () => {
  it("keeps the plain bar, and the settings in the page", () => {
    document.documentElement.classList.add("platform-ios");
    render(
      <div className="app app-session">
        <GoalPanel {...base} goal={GOAL} onPauseChange={vi.fn()} />
      </div>,
    );
    const bar = screen.getByRole("group", { name: "Goal" });
    expect(bar.className).toBe("placeholder-bar");
    expect(bar.parentElement?.className).toBe("");
    expect([...bar.children].map((el) => el.tagName)).toEqual([
      "STRONG",
      "SPAN",
      "SPAN",
      "SPAN",
      "BUTTON",
      "BUTTON",
      "LABEL",
      "SELECT",
    ]);
    expect(bar.matches(`${PANEL} > *`)).toBe(false);

    const settings = screen.getByRole("button", { name: "Goal settings" });
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(settings);
    expect(settings.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("form", { name: "Goal settings" }).className).toBe("placeholder-form");
    fireEvent.keyDown(screen.getByLabelText(/Instructions/), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
  });
});
