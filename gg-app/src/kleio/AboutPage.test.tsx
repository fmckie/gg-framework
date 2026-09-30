// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { getVersion } from "@tauri-apps/api/app";
import { AboutPage } from "./AboutPage";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.73.2") }));
vi.mock("./assets/kleio-mark.png", () => ({ default: "kleio-mark.png" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AboutPage", () => {
  it("shows the mark, the version and the credit", async () => {
    render(<AboutPage />);
    expect(screen.getByRole("img", { name: "Kleio" })).toBeDefined();
    expect(await screen.findByText("Version 0.73.2")).toBeDefined();
    expect(screen.getByText("Built on GG Coder by Ken Kai")).toBeDefined();
  });

  it("keeps the credit and drops the version when it can't be read", async () => {
    vi.mocked(getVersion).mockRejectedValueOnce(new Error("not in the desktop app"));
    render(<AboutPage />);
    // A macrotask runs only after the failed lookup and its catch have settled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getVersion).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "Kleio" })).toBeDefined();
    expect(screen.queryByText(/^Version/)).toBeNull();
    expect(screen.getByText(/^Built on/)).toBeDefined();
  });
});
