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
  phoneHeader = false,
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
      phoneHeader={phoneHeader}
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
  it("is a Context button on the desktop, and reads 0% in an empty chat", () => {
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

  it("keeps the iPhone's plain reading, hidden at 0", () => {
    expect(
      renderFooter("low", false, 0, true).container.querySelector(".ctx-meter-pct"),
    ).toBeNull();
    cleanup();
    const { container } = renderFooter("low", false, 42, true);
    const reading = container.querySelector(".ctx-meter-pct");
    expect(reading?.tagName).toBe("SPAN");
    expect(reading?.textContent).toBe("42%");
    expect(container.querySelector(".ctx-button")).toBeNull();
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

  it("opens the Model panel from the Kleio control on the desktop, and keeps Helper's picker", () => {
    const modelPanel = panel(false);
    const { container } = renderFooter("low", false, 0, false, modelPanel, MODELS);
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

  it("keeps today's model control on the iPhone", () => {
    const { container } = renderFooter("low", false, 0, true, panel(false), MODELS);
    expect(container.querySelector(".model-trigger")).toBeNull();
    expect(
      container.querySelectorAll(".model-anchor select, .model-anchor [aria-haspopup='menu']"),
    ).toHaveLength(2);
  });

  it("holds the lower thinking control on the level being tried while the panel is open", () => {
    const { container } = renderFooter("low", false, 0, false, panel(true, "high"), MODELS);
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
    const { container } = renderFooter("low", false, 0, false, panel(false, "high"), MODELS);
    const button = container.querySelector<HTMLButtonElement>(".thinking-toggle")!;
    expect(button.disabled).toBe(false);
    expect(button.dataset.level).toBe("low");
    expect(button.hasAttribute("data-preview")).toBe(false);
  });
});
