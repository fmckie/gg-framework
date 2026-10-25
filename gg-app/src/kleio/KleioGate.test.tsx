// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { KleioGate } from "./KleioGate";
import type { LinkStatus } from "./kleioLink";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./LazyRemoteHostModal", () => ({
  RemoteHostModal: () => <div role="dialog" aria-label="Pair" />,
}));
const invokeMock = vi.mocked(invoke);

const ACTIVE = {
  base: "https://mini.test:8443",
  host: "mini.test",
  deviceId: "d1",
  label: "Laptop",
  admin: true,
};

function answer(status: unknown, health: () => Promise<unknown>): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "kleio_remote_status") return status;
    if (cmd === "kleio_api") return health();
    throw new Error(`unexpected ${cmd}`);
  });
}

/** As `answer`, for a launch on Kleio's link: `link` is what the link says. */
function answerOverLink(health: () => Promise<unknown>, link: Partial<LinkStatus>): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "kleio_remote_status")
      return { active: { ...ACTIVE, base: "http://link.kleio.invalid" }, paired: null };
    if (cmd === "kleio_api") return health();
    if (cmd === "kleio_link_status") return linkStatus(link);
    throw new Error(`unexpected ${cmd}`);
  });
}

/** The link in use, with no connection open; `over` replaces fields. */
function linkStatus(over: Partial<LinkStatus>): LinkStatus {
  return {
    paired: true,
    active: true,
    running: true,
    error: null,
    host: ACTIVE.host,
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
  };
}

const probes = (): number => invokeMock.mock.calls.filter(([cmd]) => cmd === "kleio_api").length;

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  localStorage.clear();
});

describe("KleioGate", () => {
  it("never opens the app unpaired: shows the connect screen", async () => {
    answer({ active: null, paired: null }, async () => ({ status: 200 }));
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByText("Connect to your host")).toBeDefined();
    // Over Kleio's link or Tailscale: it doesn't say which.
    expect(screen.queryByText(/Tailscale/)).toBeNull();
    expect(screen.queryByText("the app")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_api", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Pair with your host" }));
    expect(screen.getByRole("dialog", { name: "Pair" })).toBeDefined();
  });

  it("opens the app once paired and the Mac mini answers", async () => {
    answer({ active: ACTIVE, paired: null }, async () => ({ status: 200 }));
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByText("the app")).toBeDefined();
    expect(invokeMock).toHaveBeenCalledWith("kleio_api", {
      method: "GET",
      path: "/kleio/health",
    });
  });

  it("says when the Mac mini can't be reached, and retries", async () => {
    let up = false;
    answer({ active: ACTIVE, paired: null }, async () => {
      if (!up) throw new Error("offline");
      return { status: 200 };
    });
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByText("Can't reach your host")).toBeDefined();
    expect(screen.queryByText("the app")).toBeNull();
    up = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("the app")).toBeDefined());
  });
});

describe("KleioGate over Kleio's link", () => {
  it("says why it can't reach the host, and tries again by itself", async () => {
    let up = false;
    answerOverLink(
      async () => {
        if (!up) throw new Error("connection closed before message completed");
        return { status: 200 };
      },
      { unreached: { kind: "host-silent", relays: [] }, lastReachedMs: Date.now() - 3 * 60_000 },
    );
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByRole("heading", { name: "mini is asleep or offline" })).toBeDefined();
    expect(screen.getByText("Last reached 3 min ago.")).toBeDefined();
    expect(screen.queryByText(/Tailscale/)).toBeNull();
    // No tap needed: it checks again after a second.
    up = true;
    await waitFor(() => expect(screen.getByText("the app")).toBeDefined(), { timeout: 3_000 });
  });

  it("says Kleio isn't running when the host's link answers for it", async () => {
    answerOverLink(async () => ({ status: 502, body: { error: "kleio_down" } }), {
      connected: true,
      path: "relay",
      pathN0: true,
    });
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(
      await screen.findByRole("heading", { name: "Kleio on mini isn't running" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("asks a device the host removed to pair again, and doesn't keep trying", async () => {
    answerOverLink(
      async () => {
        throw new Error("connection closed before message completed");
      },
      {
        refusal: "revoked",
        refused: "This device was removed from your host. Pair it again to use it.",
      },
    );
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByRole("heading", { name: "mini removed this Mac" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    const before = probes();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(probes()).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Pair again" }));
    expect(screen.getByRole("dialog", { name: "Pair" })).toBeDefined();
  });
});
