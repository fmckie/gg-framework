// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Recorder from "./dictation-recorder";

vi.mock("./agent", () => ({ transcribeDictation: vi.fn() }));
vi.mock("./toast", () => ({ toast: vi.fn() }));
vi.mock("./dictation-recorder", async (importOriginal) => ({
  ...(await importOriginal<typeof Recorder>()),
  startRecording: vi.fn(),
}));
vi.mock("./kleio/kleioApi", () => ({ getDictationSetup: vi.fn() }));

import { transcribeDictation } from "./agent";
import { startRecording } from "./dictation-recorder";
import { DictationSession } from "./DictationSession";
import { getDictationSetup } from "./kleio/kleioApi";
import { toast } from "./toast";
import { READINESS_DELAY_MS, type UseDictation } from "./useDictation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The Chat/Code composer's side: a draft, and the last state reported up. */
function mount(initialDraft = "") {
  let draft = initialDraft;
  const setDraft = vi.fn((next: React.SetStateAction<string>) => {
    draft = typeof next === "function" ? next(draft) : next;
  });
  const onDictated = vi.fn();
  const states: (UseDictation | null)[] = [];
  const onChange = (d: UseDictation | null): void => {
    states.push(d);
  };
  const view = render(
    <DictationSession setDraft={setDraft} onDictated={onDictated} onChange={onChange} />,
  );
  return {
    view,
    draft: () => draft,
    onDictated,
    states,
    last: () => states[states.length - 1] ?? null,
  };
}

describe("DictationSession (Chat and Code composer)", () => {
  it("reports idle on mount, and adds the transcript to the end of the draft", async () => {
    vi.mocked(startRecording).mockResolvedValue({
      ok: true,
      value: { stop: vi.fn(async () => "AAAA"), cancel: vi.fn() },
    });
    vi.mocked(transcribeDictation).mockResolvedValue("then ship it.");
    const s = mount("Check the build.");
    expect(s.last()?.phase).toBe("idle");

    await act(async () => s.last()?.toggle());
    expect(s.last()?.phase).toBe("recording");
    await act(async () => s.last()?.toggle());

    expect(transcribeDictation).toHaveBeenCalledWith("AAAA");
    expect(s.draft()).toBe("Check the build. then ship it.");
    expect(s.onDictated).toHaveBeenCalledOnce();
    expect(s.last()?.phase).toBe("idle");
  });

  it("shows a failure as a toast and leaves the draft alone", async () => {
    vi.mocked(startRecording).mockResolvedValue({ ok: false, error: "denied" });
    const s = mount("Keep me.");
    await act(async () => s.last()?.toggle());
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/microphone/i), "error");
    expect(s.draft()).toBe("Keep me.");
    expect(s.onDictated).not.toHaveBeenCalled();
  });

  it("passes the host's preparing state up, for the composer's pill", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getDictationSetup).mockResolvedValue({
        state: "downloading",
        loaded: 37_000_000,
        bytes: 138_853_314,
      });
      vi.mocked(startRecording).mockResolvedValue({
        ok: true,
        value: { stop: vi.fn(async () => "AAAA"), cancel: vi.fn() },
      });
      let finish: (text: string) => void = () => undefined;
      vi.mocked(transcribeDictation).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const s = mount();
      await act(async () => s.last()?.toggle());
      await act(async () => s.last()?.toggle());
      expect(s.last()?.preparing).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(READINESS_DELAY_MS);
      });
      expect(s.last()).toMatchObject({ phase: "transcribing", preparing: { percent: 26 } });

      await act(async () => finish("then ship it."));
      expect(s.last()).toMatchObject({ phase: "idle", preparing: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports null when it goes away, so the composer hides the mic", () => {
    const s = mount();
    s.view.unmount();
    expect(s.last()).toBeNull();
  });
});
