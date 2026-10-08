// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConnectionPage, formatLatency } from "./ConnectionPage";
import { RESTART_HOST } from "./connectionDiagnosis";
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
  document.documentElement.classList.remove("platform-ios");
});

/** The verdict under the map, and its checklist rows as "label: text". */
function verdict(): { box: HTMLElement; checks: string[] } {
  const box = screen.getByRole("region", { name: "Connection check" });
  const list = within(box).getByRole("list", { name: "What was checked" });
  const checks = within(list)
    .getAllByRole("listitem")
    .map((li) => [...li.querySelectorAll("span")].map((s) => s.textContent).join(": "));
  return { box, checks };
}

describe("ConnectionPage", () => {
  it("says it's connected, what it checked, and how quick the Mac mini is", async () => {
    await renderPage();
    const { box, checks } = verdict();
    expect(within(box).getByRole("heading", { name: "Connected to mac-mini-1" })).toBeTruthy();
    expect(checks).toEqual([
      "Tailscale on this Mac: On, as laptop",
      "mac-mini-1 on Tailscale: Online, direct link",
      "Kleio on mac-mini-1: Running",
    ]);
    expect(within(box).queryByText("How to fix it")).toBeNull();
    const mini = screen.getByRole("region", { name: "Mac mini" });
    expect(within(mini).getByText("https://mac-mini-1.tail0000.ts.net:8443")).toBeTruthy();
    expect(within(mini).getByText("38 ms")).toBeTruthy();
    const ts = screen.getByRole("region", { name: "Tailscale" });
    expect(within(ts).getByText("me@example.com")).toBeTruthy();
    expect(within(ts).getByText("100.64.0.9")).toBeTruthy();
    expect(within(ts).getByText("1.90.1")).toBeTruthy();
    // Only a short wait: a Mac mini that dropped off Tailscale never answers.
    expect(hostHealth).toHaveBeenCalledWith(6000);
  });

  it("when Tailscale is off on this Mac, says so in plain words and how to fix it", async () => {
    vi.mocked(hostHealth).mockRejectedValue(
      new Error("failed to lookup address information: nodename nor servname provided"),
    );
    vi.mocked(kleio.tailscale).mockResolvedValue(
      net({
        running: false,
        backendState: "Stopped",
        host: null,
        self: null,
        error: "Tailscale is turned off on this Mac.",
      }),
    );
    await renderPage();
    const { box, checks } = verdict();
    expect(
      within(box).getByRole("heading", { name: "Tailscale is turned off on this Mac" }),
    ).toBeTruthy();
    expect(checks).toEqual([
      "Tailscale on this Mac: Turned off",
      "Kleio on mac-mini-1: Can't find it",
    ]);
    const steps = within(box)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(steps).toContain("Click the Tailscale icon in the menu bar and turn it on.");
    expect(steps).toContain("Then click Check again.");
    // No raw network error anywhere on the page.
    expect(screen.queryByText(/lookup address/)).toBeNull();
  });

  it("when Kleio on the Mac mini isn't answering, gives the command to restart it, ready to copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.mocked(hostHealth).mockRejectedValue(
      Object.assign(new Error("Bad gateway"), { status: 502 }),
    );
    await renderPage();
    const { box } = verdict();
    expect(
      within(box).getByRole("heading", { name: "Kleio on mac-mini-1 isn't answering" }),
    ).toBeTruthy();
    // The whole command, as one line of text to read or copy.
    expect(box.querySelector(".conn-command code")?.textContent).toBe(RESTART_HOST);
    await act(async () => {
      fireEvent.click(within(box).getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledWith(RESTART_HOST);
    expect(within(box).getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("on the iPhone, doesn't read Tailscale and says what to check in the Tailscale app", async () => {
    document.documentElement.classList.add("platform-ios");
    vi.mocked(hostHealth).mockRejectedValue(new Error("dns error: failed to lookup address"));
    await renderPage();
    const { box, checks } = verdict();
    expect(
      within(box).getByRole("heading", { name: "This iPhone can't find mac-mini-1" }),
    ).toBeTruthy();
    expect(checks[0]).toBe("Tailscale on this iPhone: Check the Tailscale app");
    expect(within(box).getByText("Then tap Check again.")).toBeTruthy();
    expect(kleio.tailscale).not.toHaveBeenCalled();
    // Its Tailscale card would have nothing true to say.
    expect(screen.queryByRole("region", { name: "Tailscale" })).toBeNull();
  });

  it("shows a one-time pair code and the address to type into the iPhone app", async () => {
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
    // The iPhone app pairs by typing: it needs the host's address too.
    const steps = within(screen.getByRole("region", { name: "iPhone" })).getByRole("list");
    expect(within(steps).getByText("https://mac-mini-1.tail0000.ts.net:8443")).toBeTruthy();
    expect(within(steps).getByText("Pair with your Mac mini")).toBeTruthy();
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
  it("reads latency in plain words", () => {
    expect(formatLatency(38)).toBe("38 ms");
    expect(formatLatency(1250)).toBe("1.3 s");
  });
});
