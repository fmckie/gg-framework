// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState, RestoreTarget } from "./agent";
import { SETUP_SEEN_KEY } from "./app-entry-view";

mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("./App");
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

const STATE: AgentState = {
  cwd: "/workspaces/chrome",
  mode: "code",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  running: false,
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  // Setup already seen, so a window with no session opens on Home.
  localStorage.setItem(SETUP_SEEN_KEY, "1");
});
afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  if (scrollToDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

function open(restore: RestoreTarget | null, history: unknown[] = []): HTMLElement {
  mockWindows("main");
  mockIPC((command) => {
    switch (command) {
      case "window_restore_target":
        return restore;
      case "sidecar_port":
        return 12345;
      case "agent_state":
        return STATE;
      case "agent_models":
        return { models: [{ id: STATE.model, provider: STATE.provider }] };
      case "agent_commands":
        return { commands: [] };
      case "agent_tasks":
        return { tasks: [] };
      case "agent_history":
        return { history };
      case "plugin:log|log":
        return null;
      default:
        return new Promise(() => {});
    }
  });
  return render(<App />).container;
}

const root = (container: HTMLElement): HTMLElement => {
  const app = container.querySelector<HTMLElement>(".app");
  if (!app) throw new Error("no .app root");
  return app;
};

// kleio-theme.css scopes the session chrome and surface under `.app.app-session`.
describe("session chrome scope", () => {
  it("marks the session root, and not the picker reopened over it", async () => {
    const container = open({ mode: "code", cwd: STATE.cwd, sessionPath: null });
    const back = await screen.findByRole("button", { name: "Back to this project's sessions" });
    expect(root(container).classList.contains("app-session")).toBe(true);

    fireEvent.click(back);
    await waitFor(() => expect(container.querySelector(".chat-head")).toBeNull());
    expect(root(container).classList.contains("app-session")).toBe(false);
  });

  it("does not mark Home", async () => {
    const container = open(null);
    await waitFor(() => expect(container.querySelector(".kleio-home")).toBeTruthy());
    expect(root(container).classList.contains("app-session")).toBe(false);
  });
});

describe("a Chat's title", () => {
  it("reads Chats / Untitled chat before a first message, and Chats opens the browser", async () => {
    const container = open({ mode: "chat", cwd: STATE.cwd, sessionPath: null });
    const chats = await screen.findByRole("button", { name: "Chats" });
    expect(screen.getByRole("navigation", { name: "Chat identity" }).textContent).toBe(
      "Chats/Untitled chat",
    );

    fireEvent.click(chats);
    await waitFor(() => expect(container.querySelector(".chat-browser")).toBeTruthy());
    expect(container.querySelector(".chat-head")).toBeNull();
  });

  it("takes the title from the chat's first message", async () => {
    open({ mode: "chat", cwd: STATE.cwd, sessionPath: "/sessions/a.jsonl" }, [
      { role: "user", text: "Plan my week" },
      { role: "assistant", text: "Gladly." },
      { role: "user", text: "And the weekend" },
    ]);
    expect(await screen.findByRole("heading", { name: "Plan my week" })).toBeDefined();
  });

  it("leaves a Code session's title as its folder", async () => {
    open({ mode: "code", cwd: STATE.cwd, sessionPath: null });
    await screen.findByRole("button", { name: "Back to this project's sessions" });
    expect(screen.queryByRole("button", { name: "Chats" })).toBeNull();
    expect(screen.getByText("chrome")).toBeDefined();
  });
});

describe("the composer's trigger row and More", () => {
  const openCode = async (): Promise<HTMLElement> => {
    const container = open({ mode: "code", cwd: STATE.cwd, sessionPath: null });
    await screen.findByRole("button", { name: "Back to this project's sessions" });
    return container;
  };

  it("ends the composer of a Code session with one trigger, More", async () => {
    const container = await openCode();
    const row = screen.getByRole("navigation", { name: "Composer panel entries" });
    expect(container.querySelector(".inputwrap")?.lastElementChild).toBe(row);
    expect([...row.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "More ···",
    ]);
    expect(container.querySelector(".more-panel")).toBeNull();
  });

  it("puts More in the composer's place with the draft kept, and Escape gives it back", async () => {
    const container = await openCode();
    const draft = container.querySelector<HTMLTextAreaElement>(".inputwrap textarea")!;
    fireEvent.change(draft, { target: { value: "half a thought" } });
    const more = screen.getByRole("button", { name: "More" });

    fireEvent.click(more);
    const panel = screen.getByRole("region", { name: "More" });
    // The same mechanism as the Model panel: a sibling just above the composer.
    expect(panel.nextElementSibling).toBe(container.querySelector(".inputwrap"));
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.getAttribute("aria-controls")).toBe(panel.id);
    expect(screen.queryByText("Project Health")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".more-panel")).toBeNull();
    expect(container.querySelector(".inputwrap textarea")).toBe(draft);
    expect(draft.value).toBe("half a thought");
    expect(document.activeElement).toBe(more);

    fireEvent.click(more);
    fireEvent.click(more);
    expect(container.querySelector(".more-panel")).toBeNull();
    expect(draft.value).toBe("half a thought");
  });

  it("opens the app's checklist from More, and is closed on the way back", async () => {
    const container = await openCode();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const panel = screen.getByRole("region", { name: "More" });
    fireEvent.click(panel.querySelector<HTMLButtonElement>(".priority-action")!);
    await screen.findByRole("button", { name: "Back to chat" });
    expect(container.querySelector(".more-panel")).toBeNull();
  });

  it("shows no trigger row in a Chat, where More would hold nothing", async () => {
    open({ mode: "chat", cwd: STATE.cwd, sessionPath: null });
    await screen.findByRole("button", { name: "Chats" });
    expect(screen.queryByRole("navigation", { name: "Composer panel entries" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("shows one panel at a time: Model puts More away, and More puts Model away", async () => {
    const container = await openCode();
    const more = screen.getByRole("button", { name: "More" });
    const model = await waitFor(() => {
      const trigger = container.querySelector<HTMLButtonElement>(".model-trigger:not(:disabled)");
      if (!trigger) throw new Error("no model trigger yet");
      return trigger;
    });
    fireEvent.click(more);
    fireEvent.click(model);
    expect(container.querySelector(".more-panel")).toBeNull();
    expect(container.querySelector(".model-panel")).not.toBeNull();
    fireEvent.click(more);
    expect(container.querySelector(".model-panel")).toBeNull();
    expect(container.querySelector(".more-panel")).not.toBeNull();
  });
});
