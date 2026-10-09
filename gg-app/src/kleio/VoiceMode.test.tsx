// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setHomeBackgroundEnabled } from "../home-background";
import type { CallState } from "./voiceCall";

const call = vi.hoisted(() => ({
  state: { phase: "idle", lines: [], muted: false, error: null, shown: null } as CallState,
  partial: [] as { who: "you" | "kleio"; text: string }[],
  endCall: vi.fn(),
  resetCall: vi.fn(),
  setMuted: vi.fn(),
  startCall: vi.fn(),
  closeShownFile: vi.fn(),
}));

vi.mock("./voiceCall", () => ({
  useCall: () => call.state,
  callLevels: () => ({ out: null, in: null }),
  partialLines: () => call.partial,
  endCall: call.endCall,
  resetCall: call.resetCall,
  setMuted: call.setMuted,
  startCall: call.startCall,
  closeShownFile: call.closeShownFile,
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
  call.state = { phase: "idle", lines: [], muted: false, error: null, shown: null };
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

  it("shows the file she pulls up over the call, which keeps going until you go back to it", () => {
    set({
      phase: "speaking",
      shown: {
        owner: { kind: "workspace", cwd: "/Users/me/Kleio" },
        path: "out/Q3 report.pdf",
        name: "Q3 report.pdf",
        whose: "Kleio",
        info: {
          name: "Q3 report.pdf",
          size: 245_760,
          mime: "application/pdf",
          thumbnail: "data:image/png;base64,AAAA",
        },
      },
    });
    render(<VoiceMode />);
    const viewer = screen.getByRole("dialog", { name: "Q3 report.pdf" });
    expect(viewer.querySelector("img")?.getAttribute("alt")).toBe("First page of Q3 report.pdf");
    expect(viewer.textContent).toContain("PDF document · 240 KB");
    // The call is still on, under the file: nothing ended or reset it.
    expect(screen.getByRole("button", { name: "Hang up" })).toBeTruthy();
    // Nothing hands it to another app, which on the iPhone would take over the screen.
    expect(screen.queryByRole("button", { name: /^Open|Save a copy/ })).toBeNull();
    // Esc closes the file, not the call; so does the button back.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Back to the call" }));
    expect(call.closeShownFile).toHaveBeenCalledTimes(2);
    expect(call.endCall).not.toHaveBeenCalled();
    expect(call.resetCall).not.toHaveBeenCalled();
  });

  it("explains what Kleio Voice can and can't do, without leaving the call", () => {
    set({ phase: "listening" });
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole("button", { name: "What Kleio Voice can do" }));
    const guide = screen.getByRole("dialog", { name: "What Kleio Voice can do" });
    expect(guide.textContent).toContain("Read and show your files");
    expect(guide.textContent).toContain("Run a job on her own");
    expect(guide.textContent).toContain("Runs on OpenAI");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "What Kleio Voice can do" })).toBeNull();
    expect(call.resetCall).not.toHaveBeenCalled();
  });

  it("ends the call if the voice screen goes away mid-call", () => {
    set({ phase: "listening" });
    const { unmount } = render(<VoiceMode />);
    expect(call.resetCall).not.toHaveBeenCalled();
    unmount();
    expect(call.resetCall).toHaveBeenCalledTimes(1);
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
    shown: null,
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
