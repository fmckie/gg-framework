// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useDictation, type UseDictation, type UseDictationOptions } from "../useDictation";
import { DICTATION_POLL_MS, DictationCard } from "./DictationCard";
import {
  getDictationSetup,
  KleioApiError,
  startDictationSetup,
  type DictationFailure,
  type DictationSetup,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";

vi.mock("../useDictation", () => ({ useDictation: vi.fn() }));
vi.mock("./kleioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof KleioApi>();
  return {
    // The real error type; only the calls to the host are fakes.
    KleioApiError: actual.KleioApiError,
    getDictationSetup: vi.fn(),
    startDictationSetup: vi.fn(),
  };
});

const BYTES = 138_853_314;
const absent: DictationSetup = { state: "absent", bytes: BYTES };
const ready: DictationSetup = { state: "ready", bytes: BYTES };
const loading: DictationSetup = { state: "loading", bytes: BYTES };
const downloading = (mb: number): DictationSetup => ({
  state: "downloading",
  loaded: mb * 1_000_000,
  bytes: BYTES,
});
const failed = (reason: DictationFailure): DictationSetup => ({
  state: "failed",
  reason,
  bytes: BYTES,
});

/** What the Try it mic was given, so a test can play the recorder's part. */
let mic: UseDictationOptions | null = null;
const toggle = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.className = "";
  mic = null;
  vi.mocked(useDictation).mockImplementation((options): UseDictation => {
    mic = options;
    return { phase: "idle", elapsedMs: 0, toggle, preparing: null };
  });
  vi.mocked(getDictationSetup).mockResolvedValue(absent);
  vi.mocked(startDictationSetup).mockResolvedValue(downloading(0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function renderCard(canTry?: boolean): Promise<void> {
  await act(async () => {
    render(canTry === undefined ? <DictationCard /> : <DictationCard canTry={canTry} />);
  });
}

/** Let the card's next poll (or `ms` of them) happen. */
async function wait(ms = DICTATION_POLL_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

const card = (): HTMLElement => screen.getByRole("region", { name: "Dictation" });
const badge = (text: string): HTMLElement => within(card()).getByText(text);
/** The card's own announcements: a change of state, never each percent. */
const announced = (): string =>
  card().querySelector('.sr-only[role="status"]')?.textContent ?? "missing";

describe("DictationCard", () => {
  it("says it's checking until the host answers, with nothing to do yet", async () => {
    vi.mocked(getDictationSetup).mockReturnValue(new Promise(() => undefined));
    await renderCard();
    expect(badge("Checking…")).toBeTruthy();
    expect(within(card()).queryByRole("button")).toBeNull();
  });

  it("offers the download with its exact size when the host doesn't have the model", async () => {
    await renderCard();
    expect(badge("Not set up")).toBeTruthy();
    expect(within(card()).getByText("Whisper, on your host")).toBeTruthy();
    expect(
      within(card()).getByText(/Needs a one-time download of 139 MB on the host\.$/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download speech model (139 MB)" })).toBeTruthy();
  });

  it("starts the download, follows it to ready, then stops asking", async () => {
    let resolveStart: (s: DictationSetup) => void = () => undefined;
    vi.mocked(startDictationSetup).mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    await renderCard(true);
    await click("Download speech model (139 MB)");
    const starting = screen.getByRole("button", { name: "Starting…" });
    expect(starting.hasAttribute("disabled")).toBe(true);

    await act(async () => resolveStart(downloading(0)));
    expect(startDictationSetup).toHaveBeenCalledOnce();
    expect(badge("In progress")).toBeTruthy();
    expect(announced()).toBe("Downloading the speech model.");
    expect(
      within(card()).getByText("You can leave this page; your host keeps downloading."),
    ).toBeTruthy();

    vi.mocked(getDictationSetup).mockResolvedValue(downloading(37));
    await wait();
    const bar = screen.getByRole("progressbar", { name: "Downloading the speech model…" });
    expect(bar.getAttribute("aria-valuenow")).toBe("26");
    expect(bar.getAttribute("aria-valuetext")).toBe("37 of 139 MB");
    expect(within(card()).getByText("37 of 139 MB")).toBeTruthy();
    // Each percent changes the bar, never what's announced.
    expect(announced()).toBe("Downloading the speech model.");

    vi.mocked(getDictationSetup).mockResolvedValue(loading);
    await wait();
    expect(badge("In progress")).toBeTruthy();
    expect(within(card()).getByText("Getting dictation ready…")).toBeTruthy();
    expect(announced()).toBe("Getting dictation ready.");

    vi.mocked(getDictationSetup).mockResolvedValue(ready);
    await wait();
    expect(badge("Done")).toBeTruthy();
    expect(within(card()).getByText("Ready. Tap the mic in any chat box.")).toBeTruthy();
    expect(announced()).toBe("Dictation is ready.");

    const asked = vi.mocked(getDictationSetup).mock.calls.length;
    await wait(10 * DICTATION_POLL_MS);
    expect(getDictationSetup).toHaveBeenCalledTimes(asked);
  });

  it("never lets a slow check undo a download just started", async () => {
    await renderCard();
    let resolveCheck: (s: DictationSetup) => void = () => undefined;
    vi.mocked(getDictationSetup).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await click("Download speech model (139 MB)");
    expect(badge("In progress")).toBeTruthy();

    // The check began before the download did; what it says is old news.
    await act(async () => resolveCheck(absent));
    expect(badge("In progress")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Download speech model/ })).toBeNull();
  });

  it("never moves the bar back", async () => {
    vi.mocked(getDictationSetup).mockResolvedValue(downloading(50));
    await renderCard();
    vi.mocked(getDictationSetup).mockResolvedValue(downloading(40));
    await wait();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("50 of 139 MB");
  });

  it("announces nothing for the state it opened on", async () => {
    vi.mocked(getDictationSetup).mockResolvedValue(ready);
    await renderCard(false);
    expect(announced()).toBe("");
  });

  it.each([
    ["offline", "Your host couldn't reach Hugging Face, where the speech model comes from."],
    ["server", "Hugging Face had a problem. Try again in a few minutes."],
    ["missing", "no longer available. Update Kleio on your host."],
    ["storage", "Your host couldn't save the speech model. It needs 139 MB free"],
    ["integrity", "The download didn't match what Kleio expects, so it was thrown away."],
    ["load", "Your host couldn't start dictation. Its log says why."],
  ] as const)(
    "says why in plain words when it failed (%s), and tries again",
    async (reason, words) => {
      vi.mocked(getDictationSetup).mockResolvedValue(failed(reason));
      await renderCard();
      expect(badge("Not set up")).toBeTruthy();
      expect(within(card()).getByText((text) => text.includes(words))).toBeTruthy();
      await click("Try again");
      expect(startDictationSetup).toHaveBeenCalledOnce();
      expect(badge("In progress")).toBeTruthy();
    },
  );

  it.each([
    ["darwin", "x64", "a Mac with an Intel chip"],
    ["linux", "arm64", "this Linux computer"],
    ["win32", "x64", "this Windows PC"],
  ])("says a %s %s host can't run dictation, with nothing to do", async (os, arch, machine) => {
    vi.mocked(getDictationSetup).mockResolvedValue({
      state: "unsupported",
      os,
      arch,
      bytes: BYTES,
    });
    await renderCard();
    expect(badge("Not available")).toBeTruthy();
    expect(
      within(card()).getByText(
        `Your host can't run dictation: the speech engine doesn't work on ${machine}.`,
      ),
    ).toBeTruthy();
    expect(within(card()).queryByRole("button")).toBeNull();
  });

  it.each([403, 404])(
    "tells an older host (%i) to update, and that dictation still works",
    async (status) => {
      vi.mocked(getDictationSetup).mockRejectedValue(new KleioApiError(status, "not found"));
      await renderCard();
      expect(badge("Can't check")).toBeTruthy();
      expect(
        within(card()).getByText(
          "Your host needs the latest Kleio to set up dictation here. Dictation still works: the first recording downloads what it needs.",
        ),
      ).toBeTruthy();
      expect(within(card()).queryByRole("button")).toBeNull();
    },
  );

  it.each([
    [new KleioApiError(503, "engine_unavailable"), "Couldn't reach the engine on your host."],
    [
      new KleioApiError(0, "kleio_api: request timed out"),
      "Couldn't check dictation on your host.",
    ],
    [
      new KleioApiError(502, "unexpected reply from the host"),
      "Couldn't check dictation on your host.",
    ],
  ])("can't check (%s): says so, and checks again on request", async (error, words) => {
    vi.mocked(getDictationSetup).mockRejectedValueOnce(error);
    await renderCard();
    expect(badge("Can't check")).toBeTruthy();
    expect(within(card()).getByText(words)).toBeTruthy();
    await click("Try again");
    expect(getDictationSetup).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Download speech model (139 MB)" })).toBeTruthy();
  });

  it("keeps the bar through one missed check, and says so after two", async () => {
    vi.mocked(getDictationSetup).mockResolvedValueOnce(downloading(10));
    await renderCard();
    vi.mocked(getDictationSetup).mockRejectedValue(new KleioApiError(0, "timed out"));
    await wait();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("10 of 139 MB");
    await wait();
    expect(within(card()).getByText("Couldn't check dictation on your host.")).toBeTruthy();
    // Nothing is in progress that it knows of, so it stops asking.
    const asked = vi.mocked(getDictationSetup).mock.calls.length;
    await wait(5 * DICTATION_POLL_MS);
    expect(getDictationSetup).toHaveBeenCalledTimes(asked);
  });

  it("asks only while the host works, again on focus, and nothing while hidden", async () => {
    await renderCard();
    await wait(5 * DICTATION_POLL_MS);
    expect(getDictationSetup).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getDictationSetup).toHaveBeenCalledTimes(2);

    vi.mocked(getDictationSetup).mockResolvedValue(downloading(1));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getDictationSetup).toHaveBeenCalledTimes(3);
    await wait();
    expect(getDictationSetup).toHaveBeenCalledTimes(4);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await wait(5 * DICTATION_POLL_MS);
    expect(getDictationSetup).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["platform-ios", true],
    ["platform-macos", true],
    ["platform-windows", false],
    ["platform-linux", false],
  ])("offers Try it on %s: %s", async (platform, offered) => {
    document.documentElement.className = platform;
    vi.mocked(getDictationSetup).mockResolvedValue(ready);
    await renderCard();
    expect(badge("Done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dictate" }) !== null).toBe(offered);
    expect(
      within(card()).queryByText("Ready. Dictation is in Kleio on iPhone and Mac.") !== null,
    ).toBe(!offered);
  });

  it("Try it records with the chat box's mic and shows what it heard, or why not", async () => {
    vi.mocked(getDictationSetup).mockResolvedValue(ready);
    await renderCard(true);
    expect(
      within(card()).getByText("Try it: tap the mic, say something, then tap it again."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    expect(toggle).toHaveBeenCalledOnce();

    await act(async () => mic?.onText("Run the tests."));
    expect(within(card()).getByText("Heard: “Run the tests.”")).toBeTruthy();

    const denied = "Kleio needs the microphone. Turn it on in Settings, then Kleio.";
    await act(async () => mic?.onError(denied));
    expect(within(card()).getByRole("alert").textContent).toBe(denied);
    expect(within(card()).queryByText(/^Heard:/)).toBeNull();
  });

  it("Try it says what the mic is doing while it works", async () => {
    vi.mocked(useDictation).mockReturnValue({
      phase: "recording",
      elapsedMs: 3_000,
      toggle,
      preparing: null,
    });
    vi.mocked(getDictationSetup).mockResolvedValue(ready);
    await renderCard(true);
    expect(screen.getByRole("button", { name: "Stop dictating" })).toBeTruthy();
    expect(within(card()).getByText("Listening… Tap the mic again when you're done.")).toBeTruthy();
  });
});
