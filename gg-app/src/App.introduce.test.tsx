// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState, HistoryEntry, RestoreTarget } from "./agent";
import { INTRODUCE_LABEL, INTRODUCE_PROMPT } from "./kleio/introduce";

// Setup, standing in: one button that does what the Brain card's Introduce
// yourself does once it knows there's a model, and says why if that fails.
vi.mock("./kleio/SetupPage", async () => {
  const { useState } = await import("react");
  return {
    SetupPage: ({ onIntroduce }: { onIntroduce: () => Promise<void> }) => {
      const [error, setError] = useState<string | null>(null);
      const start = (): void => {
        onIntroduce().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
      };
      return (
        <>
          <button type="button" onClick={start}>
            Start the introduction
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      );
    },
  };
});

// Install native mocks before importing the real app. Keep its module loading in
// collection, outside the hook timeout: cold Windows imports can exceed 10s.
mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("./App");
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

const ROOT = "/synthetic/projects";
const STATE: AgentState = {
  cwd: ROOT,
  mode: "chat",
  chatAgent: "general",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  running: false,
};
const GREETING = "Hello, I'm Kleio. What should I call you?";

beforeEach(() => {
  // A fresh device: Setup opens by itself.
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  if (scrollToDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

/**
 * The app against a ready agent. With no `restore` it opens on Setup, as a new
 * device does; `selects` and `sends` record `select_project` and `agent_prompt`.
 */
function setup({
  restore = null,
  history = [],
  projectsRoot = ROOT,
}: {
  restore?: RestoreTarget | null;
  history?: HistoryEntry[];
  projectsRoot?: string;
} = {}): { selects: ReturnType<typeof vi.fn>; sends: ReturnType<typeof vi.fn> } {
  const selects = vi.fn();
  const sends = vi.fn();
  mockWindows("main");
  mockIPC((command, payload) => {
    switch (command) {
      case "window_restore_target":
        return restore;
      case "app_settings_get":
        return { projectsRoot, configured: projectsRoot !== "" };
      case "select_project":
        selects(payload);
        return null;
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
      case "agent_prompt":
        sends(payload);
        return null;
      case "plugin:log|log":
        return null;
      default:
        return new Promise(() => {});
    }
  });
  render(<App />);
  return { selects, sends };
}

async function startIntroduction(): Promise<void> {
  // Settings is its own chunk: allow for a cold import under a full run.
  const start = await screen.findByRole(
    "button",
    { name: "Start the introduction" },
    { timeout: 5000 },
  );
  fireEvent.click(start);
}

describe("Introduce yourself", () => {
  it("opens a new chat with Kleio and sends the introduction once, as its chip", async () => {
    const { selects, sends } = setup();

    await startIntroduction();

    await waitFor(() => expect(sends).toHaveBeenCalledOnce());
    expect(selects).toHaveBeenCalledExactlyOnceWith({
      mode: "chat",
      chatAgent: "general",
      cwd: ROOT,
      sessionPath: null,
    });
    expect(sends).toHaveBeenCalledWith(expect.objectContaining({ text: INTRODUCE_PROMPT }));
    expect(await screen.findByText(INTRODUCE_LABEL)).toBeTruthy();
    expect(screen.queryByText(INTRODUCE_PROMPT)).toBeNull();

    // Nothing that happens next (renders, a later re-read) sends it again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(sends).toHaveBeenCalledOnce();
  });

  it("shows a reopened introduction as its chip and sends nothing", async () => {
    const { sends } = setup({
      restore: {
        mode: "chat",
        chatAgent: "general",
        cwd: ROOT,
        sessionPath: "/synthetic/sessions/introduction.jsonl",
      },
      history: [
        { role: "user", text: INTRODUCE_PROMPT },
        { role: "assistant", text: GREETING },
      ],
    });

    expect(await screen.findByText(INTRODUCE_LABEL, {}, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText(GREETING)).toBeTruthy();
    expect(screen.queryByText(INTRODUCE_PROMPT)).toBeNull();
    expect(sends).not.toHaveBeenCalled();
  });

  it("asks for a projects folder first, opening nothing", async () => {
    const { selects, sends } = setup({ projectsRoot: "" });

    await startIntroduction();

    // By its words: the app shell has an alert region of its own.
    const reason = await screen.findByText("Choose a projects folder in Settings first.");
    expect(reason.getAttribute("role")).toBe("alert");
    expect(selects).not.toHaveBeenCalled();
    expect(sends).not.toHaveBeenCalled();
  });
});
