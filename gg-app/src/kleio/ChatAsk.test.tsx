// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as KleioApi from "./kleioApi";
import { threadAnswerAsk, threadHistory, threadPrompt, threadState } from "./kleioApi";
import { ThreadChat } from "./ThreadChat";

vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  threadState: vi.fn(),
  threadHistory: vi.fn(),
  threadPrompt: vi.fn(),
  threadCancel: vi.fn(),
  threadAnswerAsk: vi.fn(),
}));
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../useDictation", () => ({
  useDictation: () => ({ state: "idle", start: vi.fn(), stop: vi.fn() }),
}));

const ASK = {
  id: "ask-1",
  questions: [
    {
      id: "q1",
      question: "Fish or veg?",
      kind: "choice",
      options: [{ label: "Fish" }, { label: "Veg" }],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderChat(): void {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(
    <ThreadChat
      label="Chef"
      resolve={async () => ({ sessionId: "s1", sessionPath: null, created: false })}
    />,
  );
}

describe("a specialist's question in its chat", () => {
  it("shows the options as buttons and sends the one you pick", async () => {
    vi.mocked(threadHistory).mockResolvedValue([{ role: "user", text: "Plan dinner" }]);
    vi.mocked(threadState).mockResolvedValue({ running: true, pendingAsks: [ASK] });
    vi.mocked(threadAnswerAsk).mockResolvedValue(undefined);
    renderChat();

    const log = await screen.findByRole("log", { name: "Conversation with Chef" });
    await within(log).findByText("Fish or veg?");
    // While it waits on you, the band replaces the "is replying" dots.
    expect(within(log).queryByLabelText("Chef is replying")).toBeNull();

    fireEvent.click(within(log).getByRole("button", { name: /Veg/ }));
    await waitFor(() =>
      expect(threadAnswerAsk).toHaveBeenCalledWith("s1", "ask-1", "answer", { q1: "Veg" }),
    );
  });

  it("a message typed while it waits is the answer, not a new message", async () => {
    vi.mocked(threadHistory).mockResolvedValue([]);
    vi.mocked(threadState).mockResolvedValue({ running: true, pendingAsks: [ASK] });
    vi.mocked(threadAnswerAsk).mockResolvedValue(undefined);
    renderChat();

    const log = await screen.findByRole("log", { name: "Conversation with Chef" });
    await within(log).findByText("Fish or veg?");
    expect(within(log).getByText("Or type your own answer below.")).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Message Chef" });
    fireEvent.change(box, { target: { value: "Pasta" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(threadAnswerAsk).toHaveBeenCalledWith("s1", "ask-1", "answer", { q1: "Pasta" }),
    );
    expect(threadPrompt).not.toHaveBeenCalled();
  });

  it("says so when the answer doesn't arrive, and lets you pick again", async () => {
    vi.mocked(threadHistory).mockResolvedValue([]);
    vi.mocked(threadState).mockResolvedValue({ running: true, pendingAsks: [ASK] });
    vi.mocked(threadAnswerAsk).mockRejectedValue(new Error("offline"));
    renderChat();

    const log = await screen.findByRole("log", { name: "Conversation with Chef" });
    await within(log).findByText("Fish or veg?");
    fireEvent.click(within(log).getByRole("button", { name: /Fish/ }));
    expect(await within(log).findByRole("alert")).toBeTruthy();
    expect(within(log).getByRole("button", { name: /Veg/ })).toBeTruthy();
  });
});
