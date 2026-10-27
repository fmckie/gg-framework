// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { NewPairingNotice } from "./LazyNewPairingNotice";
import { SEEN_PAIRINGS_KEY } from "./NewPairingNotice";
import type { ActiveRemote, RecentPairing } from "./useKleioRemote";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const HOST = "mac-mini-1.tail0000.ts.net";
const ADMIN: ActiveRemote = {
  base: "http://link.kleio.invalid",
  host: HOST,
  deviceId: "dev-self",
  label: "Laptop",
  admin: true,
};
const PHONE: RecentPairing = {
  deviceId: "dev-phone",
  label: "iPhone",
  created: new Date().toISOString(),
  admin: false,
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd !== "kleio_recent_pairings") throw new Error(`unexpected invoke ${cmd}`);
    return [PHONE];
  });
});
afterEach(cleanup);

describe("NewPairingNotice, loaded on demand", () => {
  it("loads the notice on an admin device, which then says what's new", async () => {
    // This device has looked before, and the phone paired since.
    localStorage.setItem(SEEN_PAIRINGS_KEY, JSON.stringify({ [HOST]: [] }));
    render(<NewPairingNotice active={ADMIN} />);
    expect(await screen.findByRole("region", { name: "New device paired" })).toBeTruthy();
    expect(screen.getByText(/^iPhone was paired with mac-mini-1 /)).toBeTruthy();
  });

  it("shows nothing on an ordinary device, or with no host, and asks the host nothing", async () => {
    for (const active of [{ ...ADMIN, admin: false }, null]) {
      const { container, unmount } = render(<NewPairingNotice active={active} />);
      await Promise.resolve();
      expect(container.innerHTML).toBe("");
      unmount();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
