// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Recorder from "./dictation-recorder";

vi.mock("./agent", () => ({ transcribeDictation: vi.fn() }));
vi.mock("./dictation-recorder", async (importOriginal) => ({
  ...(await importOriginal<typeof Recorder>()),
  startRecording: vi.fn(),
}));
vi.mock("./kleio/kleioApi", () => ({ getDictationSetup: vi.fn() }));

import { transcribeDictation } from "./agent";
import { DICTATION_MAX_MS, startRecording, type Recording } from "./dictation-recorder";
import { getDictationSetup } from "./kleio/kleioApi";
import {
  hostDictationReadiness,
  READINESS_DELAY_MS,
  READINESS_POLL_MS,
  useDictation,
  type DictationPreparing,
} from "./useDictation";

function fakeRecording(): Recording {
  return { stop: vi.fn(async () => "AAAA"), cancel: vi.fn() };
}

function setup(readiness?: () => Promise<DictationPreparing | null>) {
  const onText = vi.fn();
  const onError = vi.fn();
  let clock = 1_000;
  const hook = renderHook(() =>
    useDictation({ onText, onError, now: () => clock, ...(readiness ? { readiness } : {}) }),
  );
  return { hook, onText, onError, advanceClock: (ms: number) => (clock += ms) };
}

/** A transcription that takes as long as the test says. */
function slowTranscript(): { done: (text: string) => Promise<void> } {
  let finish: (text: string) => void = () => undefined;
  vi.mocked(transcribeDictation).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  return { done: async (text) => act(async () => finish(text)) };
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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
    vi.mocked(transcribeDictation).mockRejectedValue("Couldn't reach your host to transcribe.");
    const { hook, onError } = setup();

    await act(async () => hook.result.current.toggle());
    await act(async () => hook.result.current.toggle());
    expect(onError).toHaveBeenCalledWith("Couldn't reach your host to transcribe.");
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

  it("asks the host after a moment of transcribing, and says how far its model is", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    const clip = slowTranscript();
    const answers: (DictationPreparing | null)[] = [
      { percent: 37 },
      { percent: 30 },
      { percent: null },
      null,
    ];
    const readiness = vi.fn(async () => answers.shift() ?? null);
    const { hook, onText } = setup(readiness);

    await act(async () => hook.result.current.toggle());
    await act(async () => hook.result.current.toggle());
    expect(hook.result.current.phase).toBe("transcribing");
    await wait(READINESS_DELAY_MS - 1);
    expect(readiness).not.toHaveBeenCalled();
    expect(hook.result.current.preparing).toBeNull();

    await wait(1);
    expect(readiness).toHaveBeenCalledOnce();
    expect(hook.result.current.preparing).toEqual({ percent: 37 });
    // A lower answer never moves it back.
    await wait(READINESS_POLL_MS);
    expect(hook.result.current.preparing).toEqual({ percent: 37 });
    // Downloaded; now loading, with nothing to count.
    await wait(READINESS_POLL_MS);
    expect(hook.result.current.preparing).toEqual({ percent: null });
    // Ready: it stops asking, and says "Transcribing…" again.
    await wait(READINESS_POLL_MS);
    expect(hook.result.current.preparing).toBeNull();
    await wait(5 * READINESS_POLL_MS);
    expect(readiness).toHaveBeenCalledTimes(4);

    await clip.done("First words.");
    expect(onText).toHaveBeenCalledWith("First words.");
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.preparing).toBeNull();
  });

  it("never asks about a clip that comes back quickly", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    vi.mocked(transcribeDictation).mockResolvedValue("Quick.");
    const readiness = vi.fn(async () => ({ percent: 10 }));
    const { hook } = setup(readiness);

    await act(async () => hook.result.current.toggle());
    await act(async () => hook.result.current.toggle());
    await wait(5 * READINESS_DELAY_MS);
    expect(readiness).not.toHaveBeenCalled();
  });

  it("stops asking, and keeps Transcribing, when the host can't say", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    const clip = slowTranscript();
    const readiness = vi.fn(async (): Promise<DictationPreparing | null> => {
      throw new Error("not found");
    });
    const { hook } = setup(readiness);

    await act(async () => hook.result.current.toggle());
    await act(async () => hook.result.current.toggle());
    await wait(READINESS_DELAY_MS + 5 * READINESS_POLL_MS);
    expect(readiness).toHaveBeenCalledOnce();
    expect(hook.result.current.preparing).toBeNull();
    await clip.done("Still works.");
  });

  it("forgets the preparing state when the clip fails", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
    let fail: (e: unknown) => void = () => undefined;
    vi.mocked(transcribeDictation).mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const readiness = vi.fn(async () => ({ percent: 5 }));
    const { hook, onError } = setup(readiness);

    await act(async () => hook.result.current.toggle());
    await act(async () => hook.result.current.toggle());
    await wait(READINESS_DELAY_MS);
    expect(hook.result.current.preparing).toEqual({ percent: 5 });

    const words = "Your host couldn't download the speech model.";
    await act(async () => fail(new Error(words)));
    expect(onError).toHaveBeenCalledWith(words);
    expect(hook.result.current.preparing).toBeNull();
    await wait(5 * READINESS_POLL_MS);
    expect(readiness).toHaveBeenCalledOnce();
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

describe("hostDictationReadiness", () => {
  const BYTES = 138_853_314;

  it.each([
    [{ state: "downloading", loaded: 37_000_000, bytes: BYTES }, { percent: 26 }],
    [{ state: "downloading", loaded: BYTES, bytes: BYTES }, { percent: 100 }],
    [{ state: "downloading", loaded: 0, bytes: 0 }, { percent: 0 }],
    [{ state: "loading", bytes: BYTES }, { percent: null }],
    [{ state: "ready", bytes: BYTES }, null],
    [{ state: "absent", bytes: BYTES }, null],
    [{ state: "failed", reason: "offline", bytes: BYTES }, null],
    [{ state: "unsupported", os: "darwin", arch: "x64", bytes: BYTES }, null],
  ] as const)("reads the host's %j as %j", async (status, expected) => {
    vi.mocked(getDictationSetup).mockResolvedValueOnce(status);
    expect(await hostDictationReadiness()).toEqual(expected);
  });

  it("is what useDictation asks by default", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getDictationSetup).mockResolvedValue({
        state: "downloading",
        loaded: 69_426_657,
        bytes: BYTES,
      });
      vi.mocked(startRecording).mockResolvedValue({ ok: true, value: fakeRecording() });
      const clip = slowTranscript();
      const { hook } = setup();
      await act(async () => hook.result.current.toggle());
      await act(async () => hook.result.current.toggle());
      await wait(READINESS_DELAY_MS);
      expect(getDictationSetup).toHaveBeenCalled();
      expect(hook.result.current.preparing).toEqual({ percent: 50 });
      await clip.done("Done.");
    } finally {
      vi.useRealTimers();
    }
  });
});
