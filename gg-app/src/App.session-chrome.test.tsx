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
