// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GoalStateInfo, ModelOption } from "../agent";
import { GoalPanel } from "./GoalPanel";

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
];

afterEach(cleanup);

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
});
