// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {} from "vitest/jsdom";
import { getVersion } from "@tauri-apps/api/app";
import { openWhatsNewWindow } from "./agent";
import { WhatsNewModal } from "./WhatsNewModal";

const windowState = vi.hoisted(() => ({ label: "main" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn() }));
vi.mock("./agent", () => ({
  get windowLabel() {
    return windowState.label;
  },
  openWhatsNewWindow: vi.fn().mockResolvedValue(undefined),
}));

const key = "gg-app:whatsNewVersion";

beforeEach(() => {
  // Node 25's global storage can shadow jsdom's browser implementation.
  vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
  vi.clearAllMocks();
  windowState.label = "main";
  vi.mocked(getVersion).mockResolvedValue("0.62.0");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("release-notes trigger", () => {
  it("remembers a fresh install without opening notes", async () => {
    render(<WhatsNewModal />);
    await waitFor(() => expect(localStorage.getItem(key)).toBe("0.62.0"));
    expect(openWhatsNewWindow).not.toHaveBeenCalled();
  });

  it("does nothing for an unchanged version", async () => {
    localStorage.setItem(key, "0.62.0");
    await act(async () => {
      render(<WhatsNewModal />);
    });
    expect(openWhatsNewWindow).not.toHaveBeenCalled();
  });

  it("loads the real history and opens notes once after an upgrade", async () => {
    localStorage.setItem(key, "0.61.0");
    const view = render(<WhatsNewModal />);
    await waitFor(() => expect(openWhatsNewWindow).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(key)).toBe("0.62.0");
    view.unmount();
    await act(async () => {
      render(<WhatsNewModal />);
    });
    expect(openWhatsNewWindow).toHaveBeenCalledTimes(1);
  });

  it("ignores a late version result after unmount", async () => {
    let resolveVersion!: (version: string) => void;
    vi.mocked(getVersion).mockReturnValue(
      new Promise((resolve) => {
        resolveVersion = resolve;
      }),
    );
    localStorage.setItem(key, "0.61.0");
    const view = render(<WhatsNewModal />);
    view.unmount();
    await act(async () => resolveVersion("0.62.0"));
    expect(localStorage.getItem(key)).toBe("0.61.0");
    expect(openWhatsNewWindow).not.toHaveBeenCalled();
  });

  it("does not run the version check in secondary windows", () => {
    windowState.label = "project-2";
    render(<WhatsNewModal />);
    expect(getVersion).not.toHaveBeenCalled();
    expect(openWhatsNewWindow).not.toHaveBeenCalled();
  });
});
