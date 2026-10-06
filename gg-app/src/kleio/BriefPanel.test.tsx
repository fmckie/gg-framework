// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as KleioApi from "./kleioApi";
import { getBrief, KleioApiError } from "./kleioApi";
import { speak, stopSpeaking } from "./kleioVoice";
import { BriefPanel, briefError, briefMe, closeBrief } from "./BriefPanel";

vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  getBrief: vi.fn(),
}));
vi.mock("./kleioVoice", () => ({
  canSpeak: () => true,
  primeSpeech: vi.fn(),
  speak: vi.fn(async () => true),
  stopSpeaking: vi.fn(),
  useSpeaking: () => false,
}));

const BRIEF = {
  spoken: "Nothing needs you right now. Chef finished. Three dinner ideas.",
  items: [],
  since: 0,
  at: 1,
};

afterEach(() => {
  act(() => closeBrief());
  cleanup();
  vi.clearAllMocks();
});

describe("BriefPanel", () => {
  it("shows nothing until asked, then reads the briefing aloud with it on screen", async () => {
    vi.mocked(getBrief).mockResolvedValue(BRIEF);
    const { container } = render(<BriefPanel />);
    expect(container.innerHTML).toBe("");
    await act(() => briefMe());
    expect(getBrief).toHaveBeenCalledWith(false);
    expect(screen.getByText(BRIEF.spoken)).toBeTruthy();
    expect(speak).toHaveBeenCalledWith(BRIEF.spoken);
  });

  it("repeats the last day's news on request, and closes with Escape", async () => {
    vi.mocked(getBrief).mockResolvedValue(BRIEF);
    render(<BriefPanel />);
    await act(() => briefMe());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Last 24 hours/ }));
    });
    expect(getBrief).toHaveBeenLastCalledWith(true);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("region", { name: "Kleio's briefing" })).toBeNull();
    expect(stopSpeaking).toHaveBeenCalled();
  });

  it("says plainly what went wrong, without speaking", async () => {
    vi.mocked(getBrief).mockRejectedValue(new KleioApiError(0, "offline"));
    render(<BriefPanel />);
    await act(() => briefMe());
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't reach your Mac mini/);
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("briefError", () => {
  it("explains each failure in plain words", () => {
    expect(briefError(new KleioApiError(404, "not_found"))).toMatch(/needs the latest Kleio/);
    expect(briefError(new KleioApiError(401, "unauthorized"))).toMatch(/isn't connected/);
    expect(briefError(new Error("boom"))).toMatch(/Try again/);
  });
});
