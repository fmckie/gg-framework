// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./agent", () => ({
  cycleThinking: vi.fn(),
  killTask: vi.fn(),
  workspaceProductName: () => "Kleio",
}));
import { AppFooter } from "./AppFooter";
import type { AgentState, ModelOption } from "./agent";

afterEach(cleanup);

const LEVELS = ["low", "medium", "high", "xhigh", "max"];

function renderFooter(
  thinkingLevel: string | null,
  running = false,
  contextPct = 0,
  modelPanel?: Parameters<typeof AppFooter>[0]["modelPanel"],
  models: ModelOption[] = [],
) {
  const state = {
    mode: "code",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    thinkingLevel,
    supportedThinkingLevels: LEVELS,
  } as unknown as AgentState;
  return render(
    <AppFooter
      workspaceMode="code"
      hydrated
      state={state}
      runningTaskCount={0}
      tasks={[]}
      schedules={[]}
      stopSchedule={vi.fn()}
      contextPct={contextPct}
      running={running}
      models={models}
      onSelectModel={vi.fn()}
      onSelectKenModel={vi.fn()}
      kenRunning={false}
      autopilotReviewing={false}
      modelPanel={modelPanel}
    />,
  );
}

describe("AppFooter thinking toggle", () => {
  it.each(LEVELS)("carries the %s level in data-level", (level) => {
    const { container } = renderFooter(level);
    const button = container.querySelector<HTMLButtonElement>(".thinking-toggle");
    expect(button?.dataset.level).toBe(level);
    expect(button?.textContent).toBe(`Thinking ${level}`);
  });

  it.each([
    ["low", 1],
    ["medium", 2],
    ["high", 3],
    ["xhigh", 4],
    ["max", 5],
  ])("draws the %s level's effort as %i bars, hidden from a screen reader", (level, bars) => {
    const { container } = renderFooter(level);
    const mark = container.querySelector(".thinking-toggle > .effort-mark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelectorAll("i")).toHaveLength(bars);
    expect(mark?.textContent).toBe("");
    expect(mark?.parentElement?.textContent).toBe(`Thinking ${level}`);
  });

  it("draws no effort bars for off or for Ultra", () => {
    expect(renderFooter(null).container.querySelector(".effort-mark")).toBeNull();
    expect(renderFooter("ultra").container.querySelector(".effort-mark")).toBeNull();
  });

  it("uses off when thinking is off", () => {
    const { container } = renderFooter(null);
    expect(container.querySelector<HTMLButtonElement>(".thinking-toggle")?.dataset.level).toBe(
      "off",
    );
  });

  it("keeps the level while the run locks the control", () => {
    const { container } = renderFooter("high", true);
    const button = container.querySelector<HTMLButtonElement>(".thinking-toggle");
    expect(button?.disabled).toBe(true);
    expect(button?.dataset.level).toBe("high");
  });
});

describe("AppFooter context reading", () => {
  it("is a Context button, and reads 0% in an empty chat", () => {
    const { container } = renderFooter("low");
    const button = container.querySelector<HTMLButtonElement>(".footer-right .ctx-button");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.textContent).toBe("Context0%");
    expect(container.querySelector(".ctx-meter-pct")).toBeNull();
  });

  it("carries the reading into the button", () => {
    const { container } = renderFooter("low", false, 42);
    expect(container.querySelector(".ctx-button")?.textContent).toBe("Context42%");
  });
});

describe("AppFooter model control", () => {
  const MODELS: ModelOption[] = [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  ];
  const panel = (open: boolean, previewLevel?: string | null) => ({
    open,
    panelId: "model-panel",
    onToggle: vi.fn(),
    triggerRef: { current: null },
    previewLevel,
  });

  it("opens the Model panel from the Kleio control, and keeps Helper's picker", () => {
    const modelPanel = panel(false);
    const { container } = renderFooter("low", false, 0, modelPanel, MODELS);
    const anchors = container.querySelectorAll(".model-anchor");
    const trigger = anchors[0]!.querySelector<HTMLButtonElement>(".model-trigger")!;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.textContent).toBe("Claude Sonnet 4.6");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(anchors[0]!.querySelector("select, [aria-haspopup='menu']")).toBeNull();
    fireEvent.click(trigger);
    expect(modelPanel.onToggle).toHaveBeenCalledTimes(1);
    expect(anchors[1]!.querySelector(".model-trigger")).toBeNull();
    expect(anchors[1]!.querySelector("select, [aria-haspopup='menu']")).not.toBeNull();
  });

  it("holds the lower thinking control on the level being tried while the panel is open", () => {
    const { container } = renderFooter("low", false, 0, panel(true, "high"), MODELS);
    const button = container.querySelector<HTMLButtonElement>(".thinking-toggle")!;
    expect(button.disabled).toBe(true);
    expect(button.dataset.level).toBe("high");
    expect(button.textContent).toBe("Thinking high");
    expect(button.hasAttribute("data-preview")).toBe(true);
    expect(container.querySelector(".model-trigger")?.getAttribute("aria-controls")).toBe(
      "model-panel",
    );
  });

  it("leaves the lower thinking control cycling when the panel is closed", () => {
    const { container } = renderFooter("low", false, 0, panel(false, "high"), MODELS);
    const button = container.querySelector<HTMLButtonElement>(".thinking-toggle")!;
    expect(button.disabled).toBe(false);
    expect(button.dataset.level).toBe("low");
    expect(button.hasAttribute("data-preview")).toBe(false);
  });
});

// One status row for both: the phone's old plain reading, bare label and
// native pickers are gone, and kleio-phone.css wraps the row to its width.
describe("AppFooter on the iPhone", () => {
  it("is the desktop's status row: effort bars, the Context button and the Model trigger", () => {
    document.documentElement.classList.add("platform-ios");
    try {
      const { container } = renderFooter(
        "high",
        false,
        0,
        { open: false, panelId: "model-panel", onToggle: vi.fn(), triggerRef: { current: null } },
        [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" }],
      );
      expect(container.querySelectorAll(".thinking-toggle > .effort-mark > i")).toHaveLength(3);
      expect(container.querySelector(".ctx-button")?.textContent).toBe("Context0%");
      expect(container.querySelector(".ctx-meter-pct")).toBeNull();
      // The whole name: the phone's short form went with its picker.
      expect(container.querySelector(".model-trigger")?.textContent).toBe("Claude Sonnet 4.6");
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });

  it("leaves the Helper's model to the Model panel, so the row is one line", () => {
    const desktop = renderFooter("medium");
    expect(desktop.getByText("Helper")).toBeDefined();
    desktop.unmount();
    document.documentElement.classList.add("platform-ios");
    try {
      const { container, queryByText } = renderFooter("medium");
      expect(queryByText("Helper")).toBeNull();
      expect(container.querySelectorAll(".model-anchor")).toHaveLength(1);
      // The words stay in the names, which the phone's sheet hides from sight only.
      expect(container.querySelector(".ctx-word")?.textContent).toBe("Context");
      expect(container.querySelector(".thinking-toggle .thinking-word")?.textContent).toBe(
        "Thinking ",
      );
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });
});
