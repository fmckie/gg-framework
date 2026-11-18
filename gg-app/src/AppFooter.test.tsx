// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./agent", () => ({
  cycleThinking: vi.fn(),
  killTask: vi.fn(),
  workspaceProductName: () => "Kleio",
}));
import { AppFooter } from "./AppFooter";
import type { AgentState } from "./agent";

afterEach(cleanup);

const LEVELS = ["low", "medium", "high", "xhigh", "max"];

function renderFooter(thinkingLevel: string | null, running = false) {
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
      phoneHeader={false}
      state={state}
      runningTaskCount={0}
      tasks={[]}
      schedules={[]}
      stopSchedule={vi.fn()}
      contextPct={0}
      running={running}
      models={[]}
      onSelectModel={vi.fn()}
      onSelectKenModel={vi.fn()}
      kenRunning={false}
      autopilotReviewing={false}
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
