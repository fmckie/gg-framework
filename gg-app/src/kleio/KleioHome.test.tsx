// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { authStatus, getLocalModels, getSettings } from "../agent";
import { toast } from "../toast";
import { KleioHome, shortHost } from "./KleioHome";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.73.2") }));
vi.mock("../HomeDither", () => ({ HomeDither: () => null }));
vi.mock("../update", () => ({ useAppUpdate: () => ({ phase: "idle" }) }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("./assets/kleio-mark.png", () => ({ default: "kleio-mark.png" }));
vi.mock("./useKleioRemote", () => ({
  useKleioRemote: () => ({
    status: {
      active: {
        base: "https://mac-mini-1.x.ts.net:8443",
        host: "mac-mini-1.x.ts.net",
        deviceId: "d1",
        label: "Laptop",
        admin: true,
      },
      paired: null,
    },
    refresh: vi.fn(),
  }),
}));
vi.mock("../agent", () => ({
  waitForReady: vi.fn(async () => undefined),
  getSettings: vi.fn(),
  authStatus: vi.fn(),
  getLocalModels: vi.fn(),
}));

const TOOL_MODEL = {
  id: "local/tinfoil/kimi-k3",
  rawId: "kimi-k3",
  contextWindow: 128_000,
  contextWindowKnown: true,
  supportsTools: true,
  supportsImages: false,
  supportsThinking: false,
};

function renderHome() {
  const props = {
    onChat: vi.fn(),
    onCode: vi.fn(),
    onBlobs: vi.fn(),
    onSettings: vi.fn(),
  };
  render(<KleioHome {...props} />);
  return props;
}

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue({
    projectsRoot: "/Users/me/kleio-projects",
    configured: true,
  });
  vi.mocked(authStatus).mockResolvedValue([{ provider: "openai", connected: true }] as never);
  vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KleioHome", () => {
  it("is Kleio's: the mark, none of Ken's links, and the credit moved to Settings", async () => {
    renderHome();
    expect(screen.getByRole("img", { name: "Kleio" })).toBeDefined();
    // The credit lives on Settings → About now (AboutPage), not under the buttons.
    expect(screen.queryByText(/Ken Kai/)).toBeNull();
    expect(screen.queryByText("Skool")).toBeNull();
    expect(screen.queryByText("YouTube")).toBeNull();
    expect(screen.queryByText(/piss me off/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Motion/ })).toBeNull();
    expect(await screen.findByText("v0.73.2")).toBeDefined();
  });

  it("Kleio opens the chat and Agents opens the agents; Apps is in Settings", async () => {
    const p = renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Kleio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(p.onChat).toHaveBeenCalledOnce();
    expect(p.onBlobs).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Blobs/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apps/ })).toBeNull();
  });

  it("shows the Mac mini and opens the Connection settings", async () => {
    const p = renderHome();
    fireEvent.click(screen.getByRole("button", { name: /Connected to mac-mini-1/ }));
    expect(p.onSettings).toHaveBeenCalledWith("connection");
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
  });

  it("Code goes to the projects when the Mac mini is set up", async () => {
    const p = renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /Code/ }));
      expect(p.onCode).toHaveBeenCalled();
    });
  });

  it("counts a running private model (Tinfoil) as ready, with no provider signed in", async () => {
    vi.mocked(authStatus).mockResolvedValue([{ provider: "openai", connected: false }] as never);
    vi.mocked(getLocalModels).mockResolvedValue({
      endpoints: [
        {
          id: "tinfoil",
          label: "Tinfoil",
          baseUrl: "http://127.0.0.1:3301/v1",
          kind: "custom",
          custom: true,
          reachable: true,
          models: [TOOL_MODEL],
        },
      ],
    });
    const p = renderHome();
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /Code/ }));
      expect(p.onCode).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Kleio/ }));
    expect(p.onChat).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it("without any model, Kleio and Code point to AI Providers instead", async () => {
    vi.mocked(authStatus).mockResolvedValue([{ provider: "openai", connected: false }] as never);
    const p = renderHome();
    const code = screen.getByRole("button", { name: /Code/ });
    await waitFor(() => expect(code.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(code);
    fireEvent.click(screen.getByRole("button", { name: /Kleio/ }));
    expect(p.onCode).not.toHaveBeenCalled();
    expect(p.onChat).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Connect an AI model first.", "warning");
    expect(p.onSettings.mock.calls).toEqual([["providers"], ["providers"]]);
  });

  it("Code without a projects folder points to General", async () => {
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: "", configured: false });
    const p = renderHome();
    const code = screen.getByRole("button", { name: /Code/ });
    await waitFor(() => expect(code.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(code);
    expect(p.onCode).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Set a projects folder on your Mac mini first.", "warning");
    expect(p.onSettings).toHaveBeenCalledWith("general");
  });

  it("shortens the tailnet host", () => {
    expect(shortHost("mac-mini-1.taila6c237.ts.net")).toBe("mac-mini-1");
    expect(shortHost("mini")).toBe("mini");
  });
});
