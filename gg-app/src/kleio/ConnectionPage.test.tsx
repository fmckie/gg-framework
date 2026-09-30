// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConnectionPage, describeRoute, formatLatency } from "./ConnectionPage";
import { hostHealth } from "./kleioApi";
import { kleio, type TailscaleNode, type TailscaleStatus } from "./useKleioRemote";
import type * as KleioRemote from "./useKleioRemote";

vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("./kleioApi", () => ({ hostHealth: vi.fn() }));
vi.mock("./useKleioRemote", async (importOriginal) => {
  const real = await importOriginal<typeof KleioRemote>();
  return {
    ...real,
    useKleioRemote: () => ({
      status: {
        active: {
          base: "https://mac-mini-1.tail0000.ts.net:8443",
          host: "mac-mini-1.tail0000.ts.net",
          deviceId: "self",
          label: "Laptop",
          admin: true,
        },
        paired: null,
      },
      refresh: vi.fn(),
    }),
    kleio: {
      tailscale: vi.fn(),
      offer: vi.fn(),
      devices: vi.fn(),
      revoke: vi.fn(),
    },
  };
});

const MINI: TailscaleNode = {
  name: "mac-mini-1",
  dnsName: "mac-mini-1.tail0000.ts.net",
  ip: "100.64.0.9",
  os: "macOS",
  online: true,
  lastSeen: null,
  direct: true,
  relay: "lhr",
};

function net(over: Partial<TailscaleStatus> = {}): TailscaleStatus {
  return {
    installed: true,
    running: true,
    backendState: "Running",
    tailnet: "me@example.com",
    magicDnsSuffix: "tail0000.ts.net",
    version: "1.90.1-t1",
    health: [],
    self: { ...MINI, name: "laptop", dnsName: "laptop.tail0000.ts.net" },
    host: MINI,
    error: null,
    ...over,
  };
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<ConnectionPage />);
  });
}

beforeEach(() => {
  vi.mocked(hostHealth).mockResolvedValue({ sidecar: "up", devices: 2, latencyMs: 38 });
  vi.mocked(kleio.tailscale).mockResolvedValue(net());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectionPage", () => {
  it("shows the Mac mini, the Tailscale link and how quick it is", async () => {
    await renderPage();
    const mini = screen.getByRole("region", { name: "Mac mini" });
    expect(within(mini).getByText("https://mac-mini-1.tail0000.ts.net:8443")).toBeTruthy();
    expect(within(mini).getByText("Online and ready")).toBeTruthy();
    expect(within(mini).getByText("38 ms")).toBeTruthy();
    const ts = screen.getByRole("region", { name: "Tailscale" });
    expect(within(ts).getByText("Connected as laptop")).toBeTruthy();
    expect(within(ts).getByText("Online · direct connection")).toBeTruthy();
    expect(within(ts).getByText("100.64.0.9")).toBeTruthy();
    expect(within(ts).getByText("1.90.1")).toBeTruthy();
  });

  it("says when Tailscale is off on this Mac", async () => {
    vi.mocked(kleio.tailscale).mockResolvedValue(
      net({
        running: false,
        backendState: "Stopped",
        host: null,
        error: "Tailscale is turned off on this Mac.",
      }),
    );
    await renderPage();
    const ts = screen.getByRole("region", { name: "Tailscale" });
    expect(within(ts).getByText("Tailscale is turned off on this Mac.")).toBeTruthy();
  });

  it("says when the Mac mini can't be reached", async () => {
    vi.mocked(hostHealth).mockRejectedValue(new Error("Can't reach your Mac mini."));
    await renderPage();
    const mini = screen.getByRole("region", { name: "Mac mini" });
    expect(within(mini).getByText("Can't reach your Mac mini.")).toBeTruthy();
    expect(within(mini).queryByText("Online and ready")).toBeNull();
  });

  it("draws a one-time pairing QR the iPhone app can scan", async () => {
    vi.mocked(kleio.offer).mockResolvedValue({
      display: "ABC-DEF",
      expiresAt: Date.now() + 5 * 60_000,
      admin: false,
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Show pairing QR" }));
    const qr = await screen.findByRole("img", { name: "Pairing QR code for pair code ABC-DEF" });
    // A phone pair code, never an admin one.
    expect(kleio.offer).toHaveBeenCalledWith(false);
    expect(qr.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(screen.getByText("ABC-DEF")).toBeTruthy();
    expect(screen.getByText(/expires in [45]:\d\d/)).toBeTruthy();
  });

  it("lists devices after Touch ID and asks before removing one", async () => {
    vi.mocked(kleio.devices).mockResolvedValue([
      {
        deviceId: "self",
        label: "Laptop",
        createdAt: "2026-09-01T00:00:00Z",
        lastSeen: null,
        revoked: false,
        admin: true,
      },
      {
        deviceId: "p1",
        label: "Sam's iPhone",
        createdAt: "2026-09-02T00:00:00Z",
        lastSeen: null,
        revoked: false,
        admin: false,
      },
    ]);
    vi.mocked(kleio.revoke).mockResolvedValue([]);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Show devices" }));
    const devices = screen.getByRole("region", { name: "Devices" });
    await within(devices).findByText("Sam's iPhone");
    // This Mac can't remove itself.
    expect(within(devices).queryByRole("button", { name: "Remove Laptop" })).toBeNull();
    fireEvent.click(within(devices).getByRole("button", { name: "Remove Sam's iPhone" }));
    expect(kleio.revoke).not.toHaveBeenCalled();
    fireEvent.click(within(devices).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(kleio.revoke).toHaveBeenCalledWith("p1"));
  });
});

describe("wording", () => {
  it("reads latency and routes in plain words", () => {
    expect(formatLatency(38)).toBe("38 ms");
    expect(formatLatency(1250)).toBe("1.3 s");
    expect(describeRoute(MINI)).toBe("Online · direct connection");
    expect(describeRoute({ ...MINI, direct: false })).toBe("Online · via relay (LHR)");
    expect(describeRoute({ ...MINI, direct: false, relay: null })).toBe("Online");
    expect(describeRoute({ ...MINI, online: false })).toBe("Offline");
  });
});
