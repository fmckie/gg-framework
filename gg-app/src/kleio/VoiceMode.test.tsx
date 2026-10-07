// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setHomeBackgroundEnabled } from "../home-background";
import type { CallState } from "./voiceCall";

const call = vi.hoisted(() => ({
  state: { phase: "idle", lines: [], muted: false, error: null } as CallState,
  partial: [] as { who: "you" | "kleio"; text: string }[],
  endCall: vi.fn(),
  resetCall: vi.fn(),
  setMuted: vi.fn(),
  startCall: vi.fn(),
}));

vi.mock("./voiceCall", () => ({
  useCall: () => call.state,
  callLevels: () => ({ out: null, in: null }),
  partialLines: () => call.partial,
  endCall: call.endCall,
  resetCall: call.resetCall,
  setMuted: call.setMuted,
  startCall: call.startCall,
}));
// The orb and the waves are WebGL: not something jsdom can draw.
vi.mock("./VoiceOrb", () => ({ VoiceOrb: () => <div data-testid="orb" /> }));
vi.mock("../HomeDither", () => ({
  HomeDither: ({ className }: { className?: string }) => (
    <div data-testid="waves" className={className} />
  ),
}));
vi.mock("./kleioApi", () => ({ getVoiceStatus: vi.fn() }));
vi.mock("./BriefPanel", () => ({ briefMe: vi.fn() }));

const { VoiceMode, latestCaption, CAPTION_HOLD_MS } = await import("./VoiceMode");

function set(state: Partial<CallState>): void {
  call.state = { ...call.state, ...state };
}

beforeEach(() => {
  call.state = { phase: "idle", lines: [], muted: false, error: null };
  call.partial = [];
  setHomeBackgroundEnabled(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("VoiceMode", () => {
  it("shows nothing until you talk to Kleio", () => {
    const { container } = render(<VoiceMode />);
    expect(container.innerHTML).toBe("");
  });

  it("fills the window with her orb, who's talking and her words as she says them", async () => {
    set({ phase: "speaking" });
    call.partial = [{ who: "kleio", text: "Morning. Nothing needs you." }];
    render(<VoiceMode />);
    expect(screen.getByRole("dialog", { name: "Talking to Kleio" })).toBeTruthy();
    expect(await screen.findByTestId("orb")).toBeTruthy();
    expect(screen.getByText("Speaking")).toBeTruthy();
    expect(screen.getByText("Morning. Nothing needs you.")).toBeTruthy();
  });

  it("moves the home screen's waves behind her, unless the background is switched off", () => {
    set({ phase: "listening" });
    render(<VoiceMode />);
    expect(screen.getByTestId("waves").className).toBe("voice-dither");
    cleanup();
    setHomeBackgroundEnabled(false);
    render(<VoiceMode />);
    expect(screen.queryByTestId("waves")).toBeNull();
    expect(screen.getByText("Listening")).toBeTruthy();
  });

  it("quotes your words while she thinks, so you know she heard you", () => {
    set({ phase: "thinking", lines: [{ who: "you", text: "What did Chef make?" }] });
    render(<VoiceMode />);
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("“What did Chef make?”")).toBeTruthy();
  });

  it("mutes, unmutes and hangs up", () => {
    set({ phase: "listening" });
    const { rerender } = render(<VoiceMode />);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(call.setMuted).toHaveBeenLastCalledWith(true);
    set({ muted: true });
    rerender(<VoiceMode />);
    expect(screen.getByText("Muted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(call.setMuted).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Hang up" }));
    expect(call.endCall).toHaveBeenCalledTimes(1);
  });

  it("leaves with Escape or the close button", () => {
    set({ phase: "listening" });
    render(<VoiceMode />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(call.resetCall).toHaveBeenCalledTimes(2);
  });

  it("says why a call ended, and offers to talk again", () => {
    set({ phase: "ended", error: "Your Mac mini couldn't reach OpenAI." });
    render(<VoiceMode />);
    expect(screen.getByText("Call ended")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Your Mac mini couldn't reach OpenAI.");
    fireEvent.click(screen.getByRole("button", { name: "Talk again" }));
    expect(call.startCall).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Hang up" })).toBeNull();
  });

  it("clears the words after a quiet spell, so the screen rests", () => {
    vi.useFakeTimers();
    set({ phase: "listening", lines: [{ who: "kleio", text: "Anything else?" }] });
    render(<VoiceMode />);
    expect(screen.getByText("Anything else?")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(CAPTION_HOLD_MS + 500);
    });
    expect(screen.queryByText("Anything else?")).toBeNull();
    expect(screen.getByText("Listening")).toBeTruthy();
  });
});

describe("latestCaption", () => {
  const state = (lines: CallState["lines"]): CallState => ({
    phase: "listening",
    lines,
    muted: false,
    error: null,
  });

  it("prefers her words as she says them, else whoever spoke last", () => {
    const s = state([
      { who: "kleio", text: "Morning." },
      { who: "you", text: "Anything new?" },
    ]);
    expect(latestCaption(s, [])).toEqual({ who: "you", text: "Anything new?" });
    expect(latestCaption(s, [{ who: "kleio", text: "Chef finished." }])).toEqual({
      who: "kleio",
      text: "Chef finished.",
    });
    expect(latestCaption(state([]), [])).toBeNull();
  });

  it("keeps the newest words of a long reply, from a word boundary", () => {
    const long = `${"word ".repeat(120)}the end.`;
    const shown = latestCaption(state([]), [{ who: "kleio", text: long }]);
    expect(shown?.text.endsWith("the end.")).toBe(true);
    expect(shown?.text.startsWith("word")).toBe(true);
    expect(shown?.text.length).toBeLessThanOrEqual(360);
  });
});
