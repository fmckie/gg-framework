// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "./agent";

// Install native mocks before importing the real app. Keep its module loading in
// collection, outside the hook timeout: cold Windows imports can exceed 10s.
mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("./App");
const notifications = await import("./toast");
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.spyOn(notifications, "toast").mockReturnValue(1);
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

/** Render the app against a ready agent. `answerPrompt` settles each `agent_prompt`. */
async function setup(answerPrompt: () => unknown = () => null): Promise<{
  input: HTMLTextAreaElement;
  sends: ReturnType<typeof vi.fn>;
}> {
  const sends = vi.fn();
  const state: AgentState = {
    cwd: "/workspaces/attachments",
    mode: "code",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    running: false,
  };
  mockWindows("main");
  mockIPC((command, payload) => {
    switch (command) {
      case "window_restore_target":
        return { mode: "code", cwd: state.cwd, sessionPath: null };
      case "sidecar_port":
        return 12345;
      case "agent_state":
        return state;
      case "agent_models":
        return { models: [{ id: state.model, provider: state.provider }] };
      case "agent_commands":
        return { commands: [] };
      case "agent_tasks":
        return { tasks: [] };
      case "agent_history":
        return { history: [] };
      case "agent_prompt":
        sends(payload);
        return answerPrompt();
      case "plugin:log|log":
        return null;
      default:
        return new Promise(() => {});
    }
  });
  render(<App />);
  const input = await screen.findByRole<HTMLTextAreaElement>("textbox");
  return { input, sends };
}

describe("composer attachments", () => {
  it("refuses attachments too large for one message and keeps the draft", async () => {
    const { input, sends } = await setup();
    fireEvent.change(input, { target: { value: "Transcribe this recording" } });
    // Over the 6 MB of attachments one message can carry.
    const recording = new File([new Uint8Array(6_500_000)], "Pearscroft Road.m4a", {
      type: "audio/mp4",
    });
    fireEvent.paste(input, { clipboardData: { files: [recording] } });
    await screen.findByRole("button", { name: "Remove Pearscroft Road.m4a" });

    fireEvent.click(screen.getByTitle("Send"));

    expect(notifications.toast).toHaveBeenCalledWith(
      "Pearscroft Road.m4a is too large to send (6.5 MB; a message can carry up to 6 MB). " +
        "Remove it and mention the file's path in your message instead.",
      "error",
    );
    expect(sends).not.toHaveBeenCalled();
    expect(input.value).toBe("Transcribe this recording");

    // Swapped for a file that fits, the same draft sends.
    fireEvent.click(screen.getByRole("button", { name: "Remove Pearscroft Road.m4a" }));
    const notes = new File(["site visit notes"], "notes.txt", { type: "text/plain" });
    fireEvent.paste(input, { clipboardData: { files: [notes] } });
    await screen.findByRole("button", { name: "Remove notes.txt" });
    fireEvent.click(screen.getByTitle("Send"));

    await waitFor(() =>
      expect(sends).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          text: "Transcribe this recording",
          attachments: [expect.objectContaining({ name: "notes.txt" })],
        }),
      ),
    );
  });

  it("says a message wasn't sent when the agent refuses it", async () => {
    const { input, sends } = await setup(() => Promise.reject("request body too large"));
    fireEvent.change(input, { target: { value: "Refactor the parser" } });

    fireEvent.click(screen.getByTitle("Send"));

    expect(await screen.findByText("Your message wasn't sent")).toBeTruthy();
    expect(screen.getByText("request body too large")).toBeTruthy();
    expect(sends).toHaveBeenCalledOnce();
  });
});
