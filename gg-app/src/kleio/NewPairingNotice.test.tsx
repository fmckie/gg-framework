// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { NewPairingNotice, PAIRINGS_RECHECK_MS, SEEN_PAIRINGS_KEY } from "./NewPairingNotice";
import type { ActiveRemote, RecentPairing } from "./useKleioRemote";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// Review devices opens the Kleio host pane: a stand-in that says on which tab.
vi.mock("./LazyRemoteHostModal", () => ({
  RemoteHostModal: ({ initialTab, onClose }: { initialTab?: string; onClose: () => void }) => (
    <div role="dialog" aria-label={`Kleio host: ${initialTab ?? "host"}`}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

const HOST = "mac-mini-1.tail0000.ts.net";
const ADMIN: ActiveRemote = {
  base: "http://link.kleio.invalid",
  host: HOST,
  deviceId: "dev-self",
  label: "Laptop",
  admin: true,
};
const T0 = Date.parse("2026-10-27T12:00:00Z");
const MIN = 60_000;

function paired(deviceId: string, label: string, at: number, admin = false): RecentPairing {
  return { deviceId, label, created: new Date(at).toISOString(), admin };
}

/** The host's recent pairings, as `kleio_recent_pairings` answers; set per test. */
let recent: RecentPairing[] | Error = [];
/** The test's clock. */
let t = T0;
const now = (): number => t;

function lookCount(): number {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "kleio_recent_pairings").length;
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(SEEN_PAIRINGS_KEY) ?? "null");
}

/** The window coming back, `ms` after the clock's last reading. */
async function comeBack(ms: number): Promise<void> {
  t += ms;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

function notice(): HTMLElement | null {
  return screen.queryByRole("region", { name: /New devices? paired/ });
}

beforeEach(() => {
  localStorage.clear();
  t = T0;
  recent = [];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd !== "kleio_recent_pairings") throw new Error(`unexpected invoke ${cmd}`);
    if (recent instanceof Error) throw recent;
    return recent;
  });
});
afterEach(cleanup);

describe("NewPairingNotice", () => {
  it("counts the devices already paired as seen, then shows one paired later until Got it", async () => {
    recent = [paired("dev-ipad", "iPad", T0 - 2 * 24 * 60 * MIN)];
    const { unmount } = render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() => expect(lookCount()).toBe(1));
    expect(notice()).toBeNull();
    expect(stored()).toEqual({ [HOST]: ["dev-ipad"] });

    recent = [paired("dev-phone", "iPhone", T0 - 2 * MIN), ...recent];
    await comeBack(PAIRINGS_RECHECK_MS);
    const card = await screen.findByRole("region", { name: "New device paired" });
    expect(card.textContent).toContain("iPhone was paired with mac-mini-1 3 min ago.");
    expect(card.textContent).toContain("Not one of yours?");
    expect(card.textContent).not.toContain("iPad");
    // Said once to a screen reader, without the time, which moves.
    expect(screen.getByRole("status").textContent).toBe(
      "New device paired with mac-mini-1: iPhone.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(notice()).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(stored()).toEqual({ [HOST]: ["dev-ipad", "dev-phone"] });

    // Remembered: the next launch says nothing.
    unmount();
    render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() => expect(lookCount()).toBe(3));
    expect(notice()).toBeNull();
  });

  it("looks again when the window comes back, at most once a minute", async () => {
    render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() => expect(lookCount()).toBe(1));
    await comeBack(PAIRINGS_RECHECK_MS - 1);
    expect(lookCount()).toBe(1);
    await comeBack(1);
    await waitFor(() => expect(lookCount()).toBe(2));
    // The iPhone app coming back to the front counts too.
    t += PAIRINGS_RECHECK_MS;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(lookCount()).toBe(3));
  });

  it("never looks from a device that isn't an admin, or isn't paired", async () => {
    const { rerender } = render(<NewPairingNotice active={{ ...ADMIN, admin: false }} now={now} />);
    rerender(<NewPairingNotice active={null} now={now} />);
    await comeBack(PAIRINGS_RECHECK_MS);
    expect(lookCount()).toBe(0);
    expect(localStorage.getItem(SEEN_PAIRINGS_KEY)).toBeNull();
  });

  it("names an admin and up to three devices, newest first, and counts the rest", async () => {
    render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() => expect(stored()).toEqual({ [HOST]: [] }));
    t += PAIRINGS_RECHECK_MS;
    recent = [
      paired("dev-5", "Sam's iPhone", t - 20_000, true),
      paired("dev-4", "iPad", t - 5 * MIN),
      paired("dev-3", "Laptop", t - 3 * 60 * MIN),
      paired("dev-2", "Studio", t - 2 * 24 * 60 * MIN),
      paired("dev-1", "Old Mac", t - 6 * 24 * 60 * MIN),
    ];
    await comeBack(0);
    const card = await screen.findByRole("region", { name: "New devices paired" });
    const lines = [...card.querySelectorAll("p.pairing-notice-text")].map((p) => p.textContent);
    expect(lines).toEqual([
      "Sam's iPhone was paired with mac-mini-1 as an admin just now.",
      "iPad was paired with mac-mini-1 5 min ago.",
      "Laptop was paired with mac-mini-1 3 h ago.",
      "And 2 more.",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(stored()).toEqual({ [HOST]: ["dev-1", "dev-2", "dev-3", "dev-4", "dev-5"] });
  });

  it("Review devices opens the host pane on Devices; one revoked there is gone after", async () => {
    render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() => expect(lookCount()).toBe(1));
    recent = [paired("dev-phone", "iPhone", T0)];
    await comeBack(PAIRINGS_RECHECK_MS);
    await screen.findByRole("region", { name: "New device paired" });

    fireEvent.click(screen.getByRole("button", { name: "Review devices" }));
    screen.getByRole("dialog", { name: "Kleio host: devices" });
    // Revoked there, so the host no longer lists it.
    recent = [];
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // It looks again straight away, not a minute later.
    await waitFor(() => expect(lookCount()).toBe(3));
    await waitFor(() => expect(notice()).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    // Forgotten, as it can't come back.
    expect(stored()).toEqual({ [HOST]: [] });
  });

  it("Got it in another window hides it here too", async () => {
    render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() => expect(lookCount()).toBe(1));
    recent = [paired("dev-phone", "iPhone", T0)];
    await comeBack(PAIRINGS_RECHECK_MS);
    await screen.findByRole("region", { name: "New device paired" });
    localStorage.setItem(SEEN_PAIRINGS_KEY, JSON.stringify({ [HOST]: ["dev-phone"] }));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: SEEN_PAIRINGS_KEY }));
    });
    expect(notice()).toBeNull();
  });

  it("keeps each host apart: the first look at another host announces nothing", async () => {
    localStorage.setItem(SEEN_PAIRINGS_KEY, JSON.stringify({ "studio.tail0000.ts.net": [] }));
    recent = [paired("dev-phone", "iPhone", T0)];
    render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() =>
      expect(stored()).toEqual({ [HOST]: ["dev-phone"], "studio.tail0000.ts.net": [] }),
    );
    expect(notice()).toBeNull();
  });

  it("says nothing while the host can't be reached", async () => {
    recent = new Error("Couldn't reach your host");
    render(<NewPairingNotice active={ADMIN} now={now} />);
    await waitFor(() => expect(lookCount()).toBe(1));
    expect(notice()).toBeNull();
    expect(localStorage.getItem(SEEN_PAIRINGS_KEY)).toBeNull();
  });
});
