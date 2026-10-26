// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "./agent";

// Install native mocks before importing the real app. Keep its module loading in
// collection, outside the hook timeout: cold Windows imports can exceed 10s.
mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("./App");
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

const REF = "ab".repeat(32);

beforeEach(() => {
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

/** Opens a resumed chat with one screenshot, from a sidecar that does (or
 *  doesn't) list images by ref. The calls to `agent_history`, and to
 *  `agent_history_images`. */
async function openChat(byRef: boolean): Promise<{
  history: ReturnType<typeof vi.fn>;
  images: ReturnType<typeof vi.fn>;
}> {
  const history = vi.fn();
  const images = vi.fn();
  const state: AgentState = {
    cwd: "/workspaces/posters",
    mode: "code",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    running: false,
    ...(byRef ? { historyImageRefs: true } : {}),
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
        history(payload);
        return {
          history: [
            { role: "user", text: "Make a poster" },
            {
              role: "assistant",
              text: "",
              toolImages: byRef
                ? [{ ref: REF, width: 480, height: 309, path: "/posters/a.png" }]
                : [{ src: "data:image/webp;base64,AA", path: "/posters/a.png" }],
            },
          ],
        };
      case "agent_history_images":
        images(payload);
        return { images: { [REF]: "data:image/webp;base64,BB" } };
      case "plugin:log|log":
        return null;
      default:
        return new Promise(() => {});
    }
  });
  render(<App />);
  await screen.findByText("Make a poster");
  return { history, images };
}

describe("a resumed chat's images", () => {
  it("are asked for by ref from a sidecar that can, and each loads as it's scrolled to", async () => {
    // jsdom has no IntersectionObserver: an image counts as near at once.
    const { history, images } = await openChat(true);
    expect(history).toHaveBeenCalledWith({ imagesByRef: true });
    await waitFor(() => expect(images).toHaveBeenCalledWith({ refs: [REF] }));
    const img = await screen.findByRole("img", { name: "/posters/a.png" });
    await waitFor(() => expect(img.getAttribute("src")).toBe("data:image/webp;base64,BB"));
  });

  it("come with the history from an older sidecar, as before", async () => {
    const { history, images } = await openChat(false);
    expect(history).toHaveBeenCalledWith({ imagesByRef: false });
    const img = await screen.findByRole("img", { name: "/posters/a.png" });
    expect(img.getAttribute("src")).toBe("data:image/webp;base64,AA");
    expect(images).not.toHaveBeenCalled();
  });
});
