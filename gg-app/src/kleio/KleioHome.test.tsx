// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { authStatus, getSettings } from "../agent";
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
}));

function renderHome() {
  const props = {
    onKleio: vi.fn(),
    onCode: vi.fn(),
    onSettings: vi.fn(),
    onConnection: vi.fn(),
  };
  render(<KleioHome {...props} />);
  return props;
}

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue({
    projectsRoot: "/Users/me/gg-projects",
    configured: true,
  });
  vi.mocked(authStatus).mockResolvedValue([{ provider: "openai", connected: true }] as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KleioHome", () => {
  it("is Kleio's: the mark, the credit, none of Ken's links", async () => {
    renderHome();
    expect(screen.getByRole("img", { name: "Kleio" })).toBeDefined();
    expect(screen.getByText("Built on GG Coder by Ken Kai")).toBeDefined();
    expect(screen.queryByText("Skool")).toBeNull();
    expect(screen.queryByText("YouTube")).toBeNull();
    expect(screen.queryByText(/piss me off/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Motion/ })).toBeNull();
    expect(await screen.findByText("v0.73.2")).toBeDefined();
  });

  it("opens the Kleio pane at the right tab", () => {
    const p = renderHome();
    fireEvent.click(screen.getByRole("button", { name: /Kleio/ }));
    fireEvent.click(screen.getByRole("button", { name: /Blobs/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apps/ }));
    expect(p.onKleio.mock.calls).toEqual([["kleio"], ["blobs"], ["apps"]]);
  });

  it("shows the Mac mini and opens the connection settings", () => {
    const p = renderHome();
    fireEvent.click(screen.getByRole("button", { name: /Connected to mac-mini-1/ }));
    expect(p.onConnection).toHaveBeenCalledOnce();
  });

  it("Code goes to the projects when the Mac mini is set up", async () => {
    const p = renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /Code/ }));
      expect(p.onCode).toHaveBeenCalled();
    });
  });

  it("Code without a provider points to Settings instead", async () => {
    vi.mocked(authStatus).mockResolvedValue([{ provider: "openai", connected: false }] as never);
    const p = renderHome();
    const code = screen.getByRole("button", { name: /Code/ });
    await waitFor(() => expect(code.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(code);
    expect(p.onCode).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Connect an AI provider first.", "warning");
    expect(p.onSettings).toHaveBeenCalledWith("providers");
  });

  it("shortens the tailnet host", () => {
    expect(shortHost("mac-mini-1.taila6c237.ts.net")).toBe("mac-mini-1");
    expect(shortHost("mini")).toBe("mini");
  });
});
