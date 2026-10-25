// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { diagnosisText } from "./connectionDiagnosis";
import { getHostKind, hostHealth, KleioApiError } from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { kleioLink, type LinkStatus } from "./kleioLink";
import {
  HostReachProvider,
  REACH_INTERVAL_MS,
  REACH_TIMEOUT_MS,
  useHostReach,
  useHostReachWords,
} from "./hostReach";

vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  hostHealth: vi.fn(),
  getHostKind: vi.fn(),
}));
// A build without the link turns its commands away, as a Windows build does.
vi.mock("./kleioLink", () => ({ kleioLink: { status: vi.fn() } }));

const up = (): KleioApi.HostHealth => ({ sidecar: "up", devices: 1, latencyMs: 20 });

function Pill(): React.ReactElement {
  const words = useHostReachWords();
  return (
    <>
      <p data-testid="reach">{useHostReach()}</p>
      <p data-testid="words">{words ? diagnosisText(words) : ""}</p>
    </>
  );
}

function renderPill(): void {
  render(
    <HostReachProvider>
      <Pill />
    </HostReachProvider>,
  );
}

/** What the pill says now. */
const reach = (): string | null => screen.getByTestId("reach").textContent;
/** Over the link, why: diagnoseLink's words, as one line. */
const words = (): string | null => screen.getByTestId("words").textContent;

/**
 * Runs the next scheduled check. The Mac mini answers; or Tailscale has
 * dropped and nothing replies (status 0); or Tailscale's proxy replies for a
 * Kleio that didn't (502).
 */
async function nextCheck(outcome: "answers" | "no reply" | "502"): Promise<void> {
  if (outcome === "answers") {
    vi.mocked(hostHealth).mockResolvedValueOnce(up());
  } else {
    const status = outcome === "502" ? 502 : 0;
    vi.mocked(hostHealth).mockRejectedValueOnce(new KleioApiError(status, outcome));
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(REACH_INTERVAL_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Answers unless a test says otherwise, with no queued outcome carried over.
  vi.mocked(hostHealth).mockReset();
  vi.mocked(hostHealth).mockResolvedValue(up());
  vi.mocked(kleioLink.status).mockReset();
  vi.mocked(kleioLink.status).mockRejectedValue(new Error("no link in this build"));
  vi.mocked(getHostKind).mockReset();
  vi.mocked(getHostKind).mockResolvedValue({ os: "darwin", laptop: false });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("HostReachProvider", () => {
  it("starts connected (the gate only opens once it reached the Mac mini) and stays connected through one missed check", async () => {
    renderPill();
    expect(reach()).toBe("connected");

    // One miss could be a blip: a slow reply, the network changing.
    await nextCheck("no reply");
    expect(hostHealth).toHaveBeenCalledTimes(1);
    // A dropped Mac mini never answers, so each check gives up in seconds.
    expect(hostHealth).toHaveBeenLastCalledWith(REACH_TIMEOUT_MS);
    expect(reach()).toBe("connected");
  });

  it("says disconnected after two missed checks in a row, and connected again at the first answer", async () => {
    renderPill();
    await nextCheck("no reply");
    await nextCheck("no reply");
    expect(hostHealth).toHaveBeenCalledTimes(2);
    expect(reach()).toBe("disconnected");

    // Over Tailscale there are no words: Connection says why.
    expect(words()).toBe("");
    // Back on Tailscale: one answer is enough.
    await nextCheck("answers");
    expect(reach()).toBe("connected");
  });

  it("starts counting again after an answer, so only misses in a row count", async () => {
    renderPill();
    await nextCheck("no reply");
    await nextCheck("answers");
    await nextCheck("no reply");
    expect(hostHealth).toHaveBeenCalledTimes(3);
    expect(reach()).toBe("connected");

    // The second miss in a row since that answer.
    await nextCheck("no reply");
    expect(reach()).toBe("disconnected");
  });

  it("counts a reply that isn't Kleio's (Tailscale's 502) as a miss", async () => {
    renderPill();
    await nextCheck("502");
    expect(reach()).toBe("connected");
    await nextCheck("502");
    expect(reach()).toBe("disconnected");
  });

  it("says disconnected the moment the device goes offline, without waiting for a second miss", async () => {
    renderPill();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(reach()).toBe("disconnected");
    expect(hostHealth).not.toHaveBeenCalled();

    // Back online it checks straight away. One miss doesn't undo Disconnected…
    vi.mocked(hostHealth).mockRejectedValueOnce(new KleioApiError(0, "no reply"));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(hostHealth).toHaveBeenCalledOnce();
    expect(reach()).toBe("disconnected");

    // …and the first answer brings it back.
    await nextCheck("answers");
    expect(reach()).toBe("connected");
  });

  it("claims nothing outside the provider", () => {
    render(<Pill />);
    expect(reach()).toBe("checking");
  });
});

describe("HostReachProvider over Kleio's link", () => {
  const NOW = Date.parse("2026-10-23T12:00:00Z");
  const HOST = "mac-mini-1.tail0000.ts.net";

  /** This launch's link: in use, with no connection open; `over` replaces fields. */
  function onTheLink(over: Partial<LinkStatus> = {}): void {
    vi.mocked(kleioLink.status).mockResolvedValue({
      paired: true,
      active: true,
      running: true,
      error: null,
      host: HOST,
      hostKey: "ab".repeat(32),
      relay: "https://euc1-1.relay.n0.iroh.link./",
      relayN0: true,
      refused: null,
      refusal: null,
      connected: false,
      dialling: false,
      unreached: null,
      lastReachedMs: null,
      path: null,
      pathAddr: null,
      pathN0: false,
      rateLimited: false,
      rttMs: null,
      connectedSinceMs: null,
      redials: 0,
      lastResumeMs: null,
      events: [],
      debugBuild: false,
      ...over,
    });
  }

  const ASLEEP = { unreached: { kind: "host-silent" as const, relays: [] } };

  async function wait(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => vi.setSystemTime(NOW));

  it("says why at once when a relay answered and the host didn't, then checks again after 1, 2, 5, 10, and every 30 s", async () => {
    onTheLink({ ...ASLEEP, lastReachedMs: NOW - 3 * 60_000 });
    renderPill();
    vi.mocked(hostHealth).mockRejectedValue(new KleioApiError(0, "no reply"));
    await wait(REACH_INTERVAL_MS);
    // No waiting for a second miss: the link knows.
    expect(reach()).toBe("disconnected");
    expect(words()).toBe("mac-mini-1 is asleep or offline. Last reached 3 min ago.");

    for (const after of [1_000, 2_000, 5_000, 10_000, 30_000, 30_000]) {
      const before = vi.mocked(hostHealth).mock.calls.length;
      await wait(after - 1);
      expect(hostHealth, `not before ${after} ms`).toHaveBeenCalledTimes(before);
      await wait(1);
      expect(hostHealth, `after ${after} ms`).toHaveBeenCalledTimes(before + 1);
    }

    // It answers: connected, no words, and back to every 10 s.
    vi.mocked(hostHealth).mockResolvedValue(up());
    await wait(30_000);
    expect(reach()).toBe("connected");
    expect(words()).toBe("");
    const before = vi.mocked(hostHealth).mock.calls.length;
    await wait(REACH_INTERVAL_MS);
    expect(hostHealth).toHaveBeenCalledTimes(before + 1);
  });

  it("says Reconnecting while the link redials after one miss, and disconnected after the second", async () => {
    onTheLink({ dialling: true });
    renderPill();
    await nextCheck("no reply");
    expect(reach()).toBe("checking");
    expect(words()).toBe("Reconnecting to mac-mini-1… Kleio is looking for it through its relays.");
    vi.mocked(hostHealth).mockRejectedValueOnce(new KleioApiError(0, "no reply"));
    await wait(1_000);
    expect(reach()).toBe("disconnected");
  });

  it("says at once that Kleio isn't running when the host's link answers for it", async () => {
    onTheLink({ connected: true, path: "relay", pathN0: true });
    renderPill();
    vi.mocked(hostHealth).mockRejectedValueOnce(new KleioApiError(502, "kleio_down"));
    await wait(REACH_INTERVAL_MS);
    expect(reach()).toBe("disconnected");
    expect(words()).toBe(
      "Kleio on mac-mini-1 isn't running. mac-mini-1 is online and its link answered, but Kleio itself didn't.",
    );
  });

  it("once the host answers, asks once what it is, and keeps when it last answered", async () => {
    onTheLink({ connected: true });
    vi.mocked(getHostKind).mockResolvedValue({ os: "darwin", laptop: true });
    renderPill();
    await nextCheck("answers");
    await nextCheck("answers");
    expect(getHostKind).toHaveBeenCalledOnce();

    // It sleeps: the words know it's a laptop, and when it last answered,
    // though this launch's link heard nothing since.
    onTheLink(ASLEEP);
    await nextCheck("no reply");
    expect(words()).toBe(
      "mac-mini-1 is asleep or offline. Last reached 10s ago. mac-mini-1 is a laptop: open it and keep it on power.",
    );

    // Kept for the next launch, for this host only.
    cleanup();
    vi.setSystemTime(NOW + 2 * 60 * 60_000);
    renderPill();
    await nextCheck("no reply");
    expect(words()).toMatch(/^mac-mini-1 is asleep or offline\. Last reached 2 h ago\./);
    expect(getHostKind).toHaveBeenCalledOnce();
  });

  it("says this device is offline the moment it goes offline", async () => {
    onTheLink({ connected: true });
    renderPill();
    await wait(0);
    const offline = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      await act(async () => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(reach()).toBe("disconnected");
      expect(words()).toBe(
        "This Mac is offline. It isn't connected to the internet, so it can't reach mac-mini-1.",
      );
    } finally {
      offline.mockRestore();
    }
  });

  it("checks nothing in the background, and at once when it's back on screen", async () => {
    onTheLink(ASLEEP);
    vi.mocked(hostHealth).mockRejectedValue(new KleioApiError(0, "no reply"));
    renderPill();
    let state: DocumentVisibilityState = "hidden";
    const visibility = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    try {
      await wait(5 * 60_000);
      expect(hostHealth).not.toHaveBeenCalled();
      state = "visible";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(hostHealth).toHaveBeenCalledOnce();
      expect(reach()).toBe("disconnected");
    } finally {
      visibility.mockRestore();
    }
  });
});
