// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  authStatusWithError,
  getLocalModels,
  listJiwa,
  listMemories,
  type AuthStatusResult,
  type JiwaSnapshot,
  type LocalModelsState,
  type MemorySnapshot,
  type SidecarEvent,
} from "../agent";
import { toast } from "../toast";
import { BrainCard, brainCountText } from "./BrainCard";

let eventHandler: ((event: SidecarEvent) => void) | undefined;

vi.mock("../agent", () => ({
  authStatusWithError: vi.fn(),
  getLocalModels: vi.fn(),
  listJiwa: vi.fn(),
  listMemories: vi.fn(),
  subscribe: vi.fn((handler: (event: SidecarEvent) => void) => {
    eventHandler = handler;
    return vi.fn();
  }),
  isJiwaChangeEvent: (event: SidecarEvent) => event.type === "jiwa_change",
  isMemoryChangeEvent: (event: SidecarEvent) => event.type === "memory_change",
}));
vi.mock("../toast", () => ({ toast: vi.fn() }));
// The Brain window, standing in: all the card needs is a way to close it.
vi.mock("../LazyMemoryModal", () => ({
  MemoryModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Brain window">
      <button type="button" onClick={onClose}>
        Close Brain
      </button>
    </div>
  ),
}));

const EMPTY_TEXT =
  "Nothing yet. Introduce yourself: Kleio asks a few short questions and saves your answers.";

function memories(count: number): MemorySnapshot {
  return {
    softLimit: 60,
    hardLimit: 90,
    memories: Array.from({ length: count }, (_, index) => ({
      id: `memory-${index}`,
      text: `Memory ${index}`,
      category: "other" as const,
      importance: 3,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    })),
  };
}

function jiwa(count: number): JiwaSnapshot {
  return {
    softLimit: 60,
    hardLimit: 90,
    jiwa: Array.from({ length: count }, (_, index) => ({
      id: `jiwa-${index}`,
      text: `Instruction ${index}`,
      category: "voice" as const,
      importance: 3,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    })),
  };
}

function auth(connected: boolean, error: string | null = null): AuthStatusResult {
  return {
    providers: [
      {
        value: "anthropic",
        label: "Anthropic",
        description: "",
        methods: [],
        connected,
        connectedMethods: [],
      },
    ],
    error,
  };
}

/** Ollama on the host, running a model that can use tools (or not). */
function ollama(supportsTools: boolean): LocalModelsState {
  return {
    endpoints: [
      {
        id: "ollama",
        label: "Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        kind: "ollama",
        custom: false,
        reachable: true,
        models: [
          {
            id: "local/ollama/qwen3",
            rawId: "qwen3",
            contextWindow: 32_768,
            contextWindowKnown: true,
            supportsTools,
            supportsImages: false,
            supportsThinking: false,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  eventHandler = undefined;
  vi.mocked(listMemories).mockResolvedValue(memories(0));
  vi.mocked(listJiwa).mockResolvedValue(jiwa(0));
  vi.mocked(authStatusWithError).mockResolvedValue(auth(true));
  vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type CardProps = Parameters<typeof BrainCard>[0];

async function renderCard(
  props: Partial<CardProps> = {},
): Promise<CardProps & { card: HTMLElement }> {
  const onIntroduce = props.onIntroduce ?? vi.fn(async () => {});
  const onOpenTab = props.onOpenTab ?? vi.fn();
  await act(async () => {
    render(<BrainCard onIntroduce={onIntroduce} onOpenTab={onOpenTab} />);
  });
  return { onIntroduce, onOpenTab, card: screen.getByRole("region", { name: "Brain" }) };
}

async function click(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(button);
  });
}

describe("BrainCard", () => {
  it("says it's checking, with nothing to press, until the counts arrive", async () => {
    vi.mocked(listMemories).mockReturnValue(new Promise(() => {}));
    const { card } = await renderCard();

    expect(within(card).getByText("Checking…")).toBeTruthy();
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("puts Introduce yourself first while Brain is empty", async () => {
    const { card } = await renderCard();

    expect(within(card).getByText("Not set up")).toBeTruthy();
    expect(within(card).getByText(EMPTY_TEXT)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Introduce yourself" }).className).toContain(
      "btn-primary",
    );
    expect(within(card).getByRole("button", { name: "Open Brain" }).className).toContain(
      "btn-ghost",
    );
  });

  it("counts what Brain holds, with both buttons plain", async () => {
    vi.mocked(listMemories).mockResolvedValue(memories(12));
    vi.mocked(listJiwa).mockResolvedValue(jiwa(3));
    const { card } = await renderCard();

    expect(within(card).getByText("Done")).toBeTruthy();
    expect(within(card).getByText("12 memories and 3 Jiwa instructions.")).toBeTruthy();
    const introduce = within(card).getByRole("button", { name: "Introduce yourself" });
    expect(introduce.className).toContain("btn-ghost");
    expect(introduce.className).not.toContain("btn-primary");
  });

  it("uses the singular for one of each", () => {
    expect(brainCountText(1, 1)).toBe("1 memory and 1 Jiwa instruction.");
    expect(brainCountText(0, 2)).toBe("0 memories and 2 Jiwa instructions.");
    expect(brainCountText(5, 0)).toBe("5 memories and 0 Jiwa instructions.");
  });

  it("says why it couldn't check, and checks again on Try again", async () => {
    vi.mocked(listJiwa).mockRejectedValueOnce(
      "Still connecting to your host — try again in a moment.",
    );
    const { card } = await renderCard();

    expect(within(card).getByText("Can't check")).toBeTruthy();
    expect(
      within(card).getByText(
        "Couldn't check Brain: Still connecting to your host — try again in a moment.",
      ),
    ).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Introduce yourself" })).toBeNull();

    await click(within(card).getByRole("button", { name: "Try again" }));

    expect(within(card).getByText("Not set up")).toBeTruthy();
    expect(listJiwa).toHaveBeenCalledTimes(2);
  });

  it("counts again on each Brain change, and only then", async () => {
    const { card } = await renderCard();

    vi.mocked(listMemories).mockResolvedValue(memories(1));
    await act(async () => eventHandler?.({ type: "memory_change", data: { count: 1 } }));
    expect(within(card).getByText("1 memory and 0 Jiwa instructions.")).toBeTruthy();

    vi.mocked(listJiwa).mockResolvedValue(jiwa(2));
    await act(async () => eventHandler?.({ type: "jiwa_change", data: { count: 2 } }));
    expect(within(card).getByText("1 memory and 2 Jiwa instructions.")).toBeTruthy();

    const asked = vi.mocked(listMemories).mock.calls.length;
    await act(async () => eventHandler?.({ type: "agent_end", data: {} }));
    expect(listMemories).toHaveBeenCalledTimes(asked);
  });

  it("opens the Brain window, then counts again and returns focus to Open Brain", async () => {
    const { card } = await renderCard();
    await click(within(card).getByRole("button", { name: "Open Brain" }));
    expect(screen.getByRole("dialog", { name: "Brain window" })).toBeTruthy();

    // Kleio's window added two memories while it was open.
    vi.mocked(listMemories).mockResolvedValue(memories(2));
    await click(screen.getByRole("button", { name: "Close Brain" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card).getByText("2 memories and 0 Jiwa instructions.")).toBeTruthy();
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Open Brain" }));
  });

  it("starts the chat when there's a model, saying Starting… meanwhile", async () => {
    let finish: () => void = () => {};
    const onIntroduce = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { card } = await renderCard({ onIntroduce });

    await click(within(card).getByRole("button", { name: "Introduce yourself" }));

    expect(onIntroduce).toHaveBeenCalledOnce();
    expect(within(card).getByRole("button", { name: "Starting…" })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => finish());
    expect(within(card).getByRole("button", { name: "Introduce yourself" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it("asks for a model first, and opens AI Providers, when there's none", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(auth(false));
    vi.mocked(getLocalModels).mockResolvedValue(ollama(false));
    const { card, onIntroduce, onOpenTab } = await renderCard();

    await click(within(card).getByRole("button", { name: "Introduce yourself" }));

    expect(toast).toHaveBeenCalledWith("Connect an AI model first.", "warning");
    expect(onOpenTab).toHaveBeenCalledWith("providers");
    expect(onIntroduce).not.toHaveBeenCalled();
  });

  it("counts a running private model, and an unknown sign-in, as a model", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(auth(false));
    vi.mocked(getLocalModels).mockResolvedValue(ollama(true));
    const first = await renderCard();
    await click(within(first.card).getByRole("button", { name: "Introduce yourself" }));
    expect(first.onIntroduce).toHaveBeenCalledOnce();
    cleanup();

    // The host didn't say who is signed in: that doesn't block.
    vi.mocked(authStatusWithError).mockResolvedValue({ providers: [], error: "not answering" });
    vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
    const second = await renderCard();
    await click(within(second.card).getByRole("button", { name: "Introduce yourself" }));
    expect(second.onIntroduce).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it("shows why the chat couldn't start", async () => {
    const onIntroduce = vi.fn(async () => {
      throw new Error("Choose a projects folder in Settings first.");
    });
    const { card } = await renderCard({ onIntroduce });

    await click(within(card).getByRole("button", { name: "Introduce yourself" }));

    expect(within(card).getByRole("alert").textContent).toBe(
      "Couldn't start the chat: Choose a projects folder in Settings first.",
    );
    expect(within(card).getByRole("button", { name: "Introduce yourself" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
