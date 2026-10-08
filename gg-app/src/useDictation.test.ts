// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Recorder from "./dictation-recorder";

vi.mock("./agent", () => ({ transcribeDictation: vi.fn() }));
vi.mock("./dictation-recorder", async (importOriginal) => ({
  ...(await importOriginal<typeof Recorder>()),
  startRecording: vi.fn(),
}));

import { transcribeDictation } from "./agent";
import { DICTATION_MAX_MS, startRecording, type Recording } from "./dictation-recorder";
import { useDictation } from "./useDictation";

function fakeRecording(): Recording {
  return { stop: vi.fn(async () => "AAAA"), cancel: vi.fn() };
}

function setup() {
  const onText = vi.fn();
  const onError = vi.fn();
  let clock = 1_000;
  const hook = renderHook(() => useDictation({ onText, onError, now: () => clock }));
  return { hook, onText, onError, advanceClock: (ms: number) => (clock += ms) };
}

describe("useDictation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(startRecording).mockReset();
    vi.mocked(transcribeDictation).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records, then transcribes on the second tap and hands over the text", async () => {
    const recording = fakeRecording();
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: recording });
    vi.mocked(transcribeDictation).mockResolvedValue("  Fix the padding.  ");
    const { hook, onText, onError, advanceClock } = setup();

    await act(async () => hook.result.current.toggle());
    expect(hook.result.current.phase).toBe("recording");

    advanceClock(7_400);
    await act(async () => vi.advanceTimersByTime(250));
    expect(hook.result.current.elapsedMs).toBe(7_400);

    await act(async () => hook.result.current.toggle());
    expect(transcribeDictation).toHaveBeenCalledWith("AAAA");
    expect(onText).toHaveBeenCalledWith("Fix the padding.");
    expect(onError).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.elapsedMs).toBe(0);
  });

  it("reports a clip with no speech instead of inserting nothing", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    vi.mocked(transcribeDictation).mockResolvedValue("");
    const { hook, onText, onError } = setup();

    await act(async () => hook.result.current.toggle());
    await act(async () => hook.result.current.toggle());
    expect(onText).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Didn't catch any speech. Try again.");
  });

  it("explains a denied microphone and returns to idle", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: false, error: "denied" });
    const { hook, onError } = setup();

    await act(async () => hook.result.current.toggle());
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Settings"));
    expect(hook.result.current.phase).toBe("idle");
  });

  it("points a denied microphone at the iPhone's Settings on the phone", async () => {
    document.documentElement.classList.add("platform-ios");
    try {
      vi.mocked(startRecording).mockResolvedValue({ ok: false, error: "denied" });
      const { hook, onError } = setup();

      await act(async () => hook.result.current.toggle());
      expect(onError).toHaveBeenCalledWith(
        "Kleio needs the microphone. Turn it on in Settings, then Kleio.",
      );
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });

  it("points a denied microphone at macOS's privacy settings on the Mac", async () => {
    document.documentElement.classList.add("platform-macos");
    try {
      vi.mocked(startRecording).mockResolvedValue({ ok: false, error: "denied" });
      const { hook, onError } = setup();

      await act(async () => hook.result.current.toggle());
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("System Settings > Privacy & Security > Microphone"),
      );
    } finally {
      document.documentElement.classList.remove("platform-macos");
    }
  });

  it("surfaces a transcription failure and returns to idle", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    vi.mocked(transcribeDictation).mockRejectedValue("Couldn't reach your Mac to transcribe.");
    const { hook, onError } = setup();

    await act(async () => hook.result.current.toggle());
    await act(async () => hook.result.current.toggle());
    expect(onError).toHaveBeenCalledWith("Couldn't reach your Mac to transcribe.");
    expect(hook.result.current.phase).toBe("idle");
  });

  it("stops by itself at the length limit", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    vi.mocked(transcribeDictation).mockResolvedValue("Long note.");
    const { hook, onText } = setup();

    await act(async () => hook.result.current.toggle());
    await act(async () => vi.advanceTimersByTime(DICTATION_MAX_MS));
    expect(onText).toHaveBeenCalledWith("Long note.");
  });

  it("transcribes what was said when the app leaves the screen", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    vi.mocked(transcribeDictation).mockResolvedValue("Before I switched apps.");
    const { hook, onText } = setup();
    await act(async () => hook.result.current.toggle());

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    visibility.mockRestore();
    expect(onText).toHaveBeenCalledWith("Before I switched apps.");
  });

  it("releases the microphone when the composer unmounts mid-recording", async () => {
    const recording = fakeRecording();
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: recording });
    const { hook } = setup();

    await act(async () => hook.result.current.toggle());
    hook.unmount();
    expect(recording.cancel).toHaveBeenCalled();
    expect(transcribeDictation).not.toHaveBeenCalled();
  });
});
