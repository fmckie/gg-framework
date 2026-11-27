// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("./agent", () => ({ cycleThinking: vi.fn() }));
import { ModelPanel, ModelTrigger, applyThinkingLevel, thinkingChoices } from "./ModelPanel";
import type { ModelOption } from "./agent";

const MODELS: ModelOption[] = [
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic" },
  {
    id: "claude-opus-5-fast",
    name: "Claude Opus 5 Fast",
    provider: "anthropic",
    billing: {
      label: "bills usage credits",
      detail: "Fast mode bills your Claude usage credits, never your plan's included usage.",
      paid: true,
    },
  },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "openai" },
  {
    id: "local/ollama/gemma4:e2b",
    name: "gemma4:e2b",
    provider: "local",
    local: true,
    endpoint: "Ollama",
    supportsTools: true,
  },
  {
    id: "local/ollama/tiny",
    name: "tiny",
    provider: "local",
    local: true,
    endpoint: "Ollama",
    supportsTools: false,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open(overrides: Partial<Parameters<typeof ModelPanel>[0]> = {}) {
  const props = {
    id: "model-panel",
    models: MODELS,
    currentModel: "claude-sonnet-5",
    thinkingLevel: "low" as string | null,
    thinkingLevels: ["low", "medium", "high"] as readonly string[],
    onUseModel: vi.fn(),
    onApplyThinking: vi.fn(),
    onPreviewThinking: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<ModelPanel {...props} />);
  const panel = view.container.querySelector<HTMLElement>(".model-panel")!;
  const row = (id: string) =>
    panel.querySelector<HTMLButtonElement>(`.model-option[data-model="${id}"]`)!;
  const use = () => panel.querySelector<HTMLButtonElement>(".model-use")!;
  const review = () => panel.querySelector(".model-review-copy")!;
  const search = () => panel.querySelector<HTMLInputElement>(".model-search input")!;
  return { ...view, props, panel, row, use, review, search };
}

describe("ModelPanel — the list", () => {
  it("lists only the app's models, grouped by provider with a count, local last", () => {
    const { panel } = open();
    expect(panel.getAttribute("aria-label")).toBe("Model");
    const headings = [...panel.querySelectorAll(".model-group h4")].map((h) => h.textContent);
    expect(headings).toEqual(["Anthropic · 2", "OpenAI · 1", "Local · Ollama · 2"]);
    expect(panel.querySelectorAll(".model-option")).toHaveLength(MODELS.length);
    expect(panel.querySelector(".model-search output")?.textContent).toBe("5 models");
    expect(panel.querySelector(".model-summary strong")?.textContent).toBe(
      "Current · Claude Sonnet 5 · Anthropic",
    );
  });

  it("opens on the search box, with the current model marked and nothing to apply", () => {
    const { row, use, review, search } = open();
    expect(document.activeElement).toBe(search());
    expect(row("claude-sonnet-5").querySelector("small")?.textContent).toBe("✓ Current");
    expect(row("claude-sonnet-5").getAttribute("aria-pressed")).toBe("true");
    expect(review().textContent).toBe("Current · Claude Sonnet 5");
    expect(use().disabled).toBe(true);
  });

  it("searches model and provider names, and says when nothing matches", () => {
    const { panel, search } = open();
    fireEvent.change(search(), { target: { value: "ollama" } });
    expect([...panel.querySelectorAll(".model-option span")].map((s) => s.textContent)).toEqual([
      "gemma4:e2b",
      "tiny",
    ]);
    expect(panel.querySelector(".model-search output")?.textContent).toBe("2 models");
    fireEvent.change(search(), { target: { value: "sol" } });
    expect(panel.querySelector(".model-search output")?.textContent).toBe("1 model");
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(panel.querySelectorAll(".model-option")).toHaveLength(0);
    expect(panel.querySelector(".model-empty")?.textContent).toBe(
      "No matching models. Try another name or provider.",
    );
  });

  it("moves through the rows with the arrow keys, past a model that can't run the agent", () => {
    const { panel, row, search } = open();
    expect(row("local/ollama/tiny").disabled).toBe(true);
    expect(row("local/ollama/tiny").querySelector("small")?.textContent).toBe("No tool calling");
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("claude-sonnet-5"));
    fireEvent.keyDown(panel.querySelector(".model-list")!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("local/ollama/gemma4:e2b"));
  });
});

describe("ModelPanel — review, then Cancel or Use model", () => {
  it("stages a candidate against the current model without switching", () => {
    const { props, row, use, review } = open();
    fireEvent.click(row("gpt-6.1-sol"));
    expect(row("gpt-6.1-sol").getAttribute("aria-pressed")).toBe("true");
    expect(row("claude-sonnet-5").getAttribute("aria-pressed")).toBe("false");
    expect(row("claude-sonnet-5").querySelector("small")?.textContent).toBe("✓ Current");
    expect(review().textContent).toBe("Candidate · GPT-6.1 Sol");
    expect(use().textContent).toBe("Use model");
    expect(use().disabled).toBe(false);
    expect(props.onUseModel).not.toHaveBeenCalled();
  });

  it("switches on Use model, then closes", () => {
    const { props, row, use } = open();
    fireEvent.click(row("gpt-6.1-sol"));
    fireEvent.click(use());
    expect(props.onUseModel).toHaveBeenCalledWith("gpt-6.1-sol");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Cancel", (panel: HTMLElement) => fireEvent.click(panel.querySelector(".model-cancel")!)],
    [
      "the close button",
      (panel: HTMLElement) => fireEvent.click(panel.querySelector(".model-close")!),
    ],
    ["Escape", () => fireEvent.keyDown(document.body, { key: "Escape" })],
  ])("closes on %s with nothing switched", (_name, act) => {
    const { props, panel, row } = open();
    fireEvent.click(row("gpt-6.1-sol"));
    act(panel);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onUseModel).not.toHaveBeenCalled();
    expect(props.onApplyThinking).not.toHaveBeenCalled();
  });

  it("shows a billing note only for a model the app holds one for", () => {
    const { row, review } = open();
    fireEvent.click(row("gpt-6.1-sol"));
    expect(review().querySelector("p")).toBeNull();
    fireEvent.click(row("claude-opus-5-fast"));
    expect(review().querySelector("p")?.textContent).toBe(
      "Fast mode bills your Claude usage credits, never your plan's included usage.",
    );
    expect(row("claude-opus-5-fast").querySelector("small")?.textContent).toBe(
      "bills usage credits",
    );
  });

  it("asks before a model that spends real money, and Cancel is the way back", () => {
    const { props, panel, row, use } = open();
    fireEvent.click(row("claude-opus-5-fast"));
    fireEvent.click(use());
    expect(props.onUseModel).not.toHaveBeenCalled();
    const buttons = () => panel.querySelectorAll<HTMLButtonElement>(".placeholder-notice button");
    expect(buttons()).toHaveLength(2);
    fireEvent.click(buttons()[0]!);
    expect(panel.querySelector(".placeholder-notice")).toBeNull();
    expect(props.onUseModel).not.toHaveBeenCalled();
    fireEvent.click(use());
    fireEvent.click(buttons()[1]!);
    expect(props.onUseModel).toHaveBeenCalledWith("claude-opus-5-fast", { confirmPaid: true });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ModelPanel — thinking", () => {
  const radios = (panel: HTMLElement) => [
    ...panel.querySelectorAll<HTMLInputElement>(".thinking-choice input"),
  ];

  it("offers only the levels this model has, in the mockup's order and labels", () => {
    expect(thinkingChoices(["max", "low", "xhigh", "ultra"]).map(([, label]) => label)).toEqual([
      "Off",
      "Low",
      "X-High",
      "Max",
      "Ultra",
    ]);
    expect(thinkingChoices([])).toEqual([]);
    const { panel } = open();
    expect(panel.querySelector(".thinking-levels")?.getAttribute("role")).toBe("radiogroup");
    expect(radios(panel).map((r) => r.getAttribute("aria-label"))).toEqual([
      "Off",
      "Low",
      "Medium",
      "High",
    ]);
    expect(radios(panel).map((r) => r.type)).toEqual(["radio", "radio", "radio", "radio"]);
    expect(
      radios(panel)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["low"]);
    expect(panel.querySelector('.thinking-choice[data-level="xhigh"]')).toBeNull();
  });

  it("marks Off when thinking is off, and shows no radios for a model with no levels", () => {
    const off = open({ thinkingLevel: null });
    expect(
      radios(off.panel)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["off"]);
    cleanup();
    const none = open({ thinkingLevels: [] });
    expect(none.panel.querySelector(".model-thinking")).toBeNull();
  });

  it("tries a level, then applies it on confirmation without switching the model", () => {
    const { props, panel, use } = open();
    fireEvent.click(radios(panel)[3]!);
    expect(
      radios(panel)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["high"]);
    expect(props.onPreviewThinking).toHaveBeenLastCalledWith("high");
    expect(props.onApplyThinking).not.toHaveBeenCalled();
    expect(use().textContent).toBe("Apply thinking");
    fireEvent.click(use());
    expect(props.onApplyThinking).toHaveBeenCalledWith("high");
    expect(props.onUseModel).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("applies Off as no level, and going back to the saved level leaves nothing to apply", () => {
    const { props, panel, use } = open();
    fireEvent.click(radios(panel)[0]!);
    expect(props.onPreviewThinking).toHaveBeenLastCalledWith(null);
    fireEvent.click(radios(panel)[1]!);
    expect(props.onPreviewThinking).toHaveBeenLastCalledWith(undefined);
    expect(use().disabled).toBe(true);
    fireEvent.click(radios(panel)[0]!);
    fireEvent.click(use());
    expect(props.onApplyThinking).toHaveBeenCalledWith(null);
  });

  it("shows no levels for another model, whose levels the app does not hold yet", () => {
    const { props, panel, row } = open();
    fireEvent.click(radios(panel)[3]!);
    fireEvent.click(row("gpt-6.1-sol"));
    expect(radios(panel)).toHaveLength(0);
    expect(panel.querySelector(".model-thinking small")?.textContent).toBe(
      "Levels are listed for the model in use.",
    );
    expect(props.onPreviewThinking).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(row("claude-sonnet-5"));
    expect(
      radios(panel)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["low"]);
  });
});

describe("applyThinkingLevel", () => {
  const cycleFrom = (order: (string | null)[], start: string | null) => {
    let at = order.indexOf(start);
    return vi.fn(async () => {
      at = (at + 1) % order.length;
      return { thinkingLevel: order[at]!, supportedThinkingLevels: [] };
    });
  };

  it("steps the app's cycle until the level is reached", async () => {
    const cycle = cycleFrom(["low", "medium", "high", null], "low");
    expect(await applyThinkingLevel("high", "low", cycle)).toBe(true);
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(await applyThinkingLevel("high", "high", cycle)).toBe(true);
    expect(cycle).toHaveBeenCalledTimes(2);
  });

  it("stops back where it started when the cycle never reaches the level", async () => {
    const cycle = cycleFrom(["high", null], "high");
    expect(await applyThinkingLevel("low", "high", cycle)).toBe(false);
    expect(cycle).toHaveBeenCalledTimes(2);
  });

  it("stops when the app refuses the change", async () => {
    const cycle = vi.fn(async () => null);
    expect(await applyThinkingLevel("high", "low", cycle)).toBe(false);
    expect(cycle).toHaveBeenCalledTimes(1);
  });
});

describe("ModelTrigger", () => {
  const renderTrigger = (overrides: Partial<Parameters<typeof ModelTrigger>[0]> = {}) => {
    const onToggle = vi.fn();
    const { container } = render(
      <ModelTrigger
        models={MODELS}
        currentModel="claude-sonnet-5"
        disabled={false}
        title="Switch Kleio's model"
        open={false}
        panelId="model-panel"
        onToggle={onToggle}
        {...overrides}
      />,
    );
    return { button: container.querySelector<HTMLButtonElement>(".model-trigger")!, onToggle };
  };

  it("is a button naming the model, which opens the panel", () => {
    const { button, onToggle } = renderTrigger();
    expect(button.textContent).toBe("Claude Sonnet 5");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("points at the panel while it is open", () => {
    const { button } = renderTrigger({ open: true });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe("model-panel");
  });

  it("says why it is locked during a run, and says paid while a paid model is active", () => {
    const locked = renderTrigger({ disabled: true });
    expect(locked.button.disabled).toBe(true);
    expect(locked.button.title).toContain("Can't switch models while the agent is running");
    cleanup();
    expect(renderTrigger({ currentModel: "claude-opus-5-fast" }).button.textContent).toBe(
      "Claude Opus 5 Fast · paid",
    );
  });
});
