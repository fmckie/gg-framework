// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { hostHealth, KleioApiError } from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { HostReachProvider, REACH_INTERVAL_MS, REACH_TIMEOUT_MS, useHostReach } from "./hostReach";

vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  hostHealth: vi.fn(),
}));

const up = (): KleioApi.HostHealth => ({ sidecar: "up", devices: 1, latencyMs: 20 });

function Pill(): React.ReactElement {
  return <p data-testid="reach">{useHostReach()}</p>;
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
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
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
