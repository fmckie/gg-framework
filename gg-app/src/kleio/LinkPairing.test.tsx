// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
// What pairing says when it fails, case by case: the link's own tests read
// this table too, and check their words against it.
import table from "../../../packages/kleio-link/tests/fixtures/pairing-messages.json";
import vectors from "../../../packages/kleio-link/tests/fixtures/tickets.json";
import { diagnoseLink } from "./connectionDiagnosis";
import type { LinkStatus, PairStage, TicketCheck } from "./kleioLink";
import { LinkConfirm, PAIR_STAGE_TEXT, pairingOffline, takesPairingText } from "./LinkPairing";
import { readTicket } from "./pairTicket";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  // The real one needs the Tauri bridge. This keeps its handler, for a test to call.
  Channel: class {
    onmessage: (message: unknown) => void;
    constructor(onmessage: (message: unknown) => void = () => {}) {
      this.onmessage = onmessage;
    }
  },
}));
vi.mock("@tauri-apps/plugin-barcode-scanner", () => ({
  Format: { QRCode: "QR_CODE" },
  scan: vi.fn(),
  cancel: vi.fn(async () => undefined),
  checkPermissions: vi.fn(async () => "granted"),
  requestPermissions: vi.fn(async () => "granted"),
}));

const invokeMock = vi.mocked(invoke);

type Device = "iPhone" | "Mac";

/** A message from the table with its stand-ins filled, as the tests below give them. */
function fill(message: string, device: Device): string {
  return message
    .replace(/\{host\}/g, "mac-mini-1")
    .replace(/\{device\}/g, device)
    .replace(/\{relay\}/g, "example.com");
}

/** The table's words for case `id`, filled in. */
function words(id: string, device: Device = "iPhone"): string {
  const row = table.cases.find((c) => c.id === id);
  if (row === undefined) throw new Error(`no case ${id} in the table`);
  return fill(row.message, device);
}

/** No link pairing yet: a link status with `over` replacing fields. */
function status(over: Partial<LinkStatus> = {}): LinkStatus {
  return {
    paired: false,
    active: false,
    running: false,
    error: null,
    host: null,
    hostKey: null,
    relay: null,
    relayN0: false,
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

const [FIRST_VECTOR] = vectors.good;
if (FIRST_VECTOR === undefined) throw new Error("no ticket vectors");
const TICKET = FIRST_VECTOR.ticket;
const CHECKED: TicketCheck = {
  name: "mac-mini-1",
  keyPrefix: "ea4a6c63e2",
  relayHost: "euc1-1.relay.n0.iroh.link.",
  code: "ABC-DEF",
};

function renderConfirm(onPaired: (now: LinkStatus | null) => void = () => {}): void {
  render(
    <LinkConfirm
      ticket={TICKET}
      check={CHECKED}
      label=""
      onLabel={() => {}}
      onBack={() => {}}
      onPaired={onPaired}
    />,
  );
}

beforeEach(() => {
  invokeMock.mockReset();
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("platform-ios");
  vi.restoreAllMocks();
});

describe("the pairing messages table", () => {
  // The nine cases the plan tested on the phone, then the further ones.
  const CASES = [
    "used",
    "unauthorized",
    "host-missing",
    "host-elsewhere",
    "not-a-relay",
    "tailscale",
    "not-kleio",
    "expired",
    "not-paired",
    "revoked",
    "not-found",
    "locked",
    "replaced",
    "busy",
    "relay-unreachable",
    "prototype",
    "offline",
  ];

  it("has every case, and no two say the same", () => {
    expect(table.cases.map((c) => c.id)).toEqual(CASES);
    for (const device of ["iPhone", "Mac"] as const) {
      const said = new Set(table.cases.map((c) => fill(c.message, device)));
      expect(said.size).toBe(CASES.length);
    }
  });

  it("names what says each case: the link's tests check its own, these the app's", () => {
    for (const c of table.cases) expect(c.from.length, c.id).toBeGreaterThan(0);
    const apps = table.cases.filter((c) => c.from.some((f) => !f.endsWith(".rs")));
    expect(apps.map((c) => c.id)).toEqual([
      "tailscale",
      "not-kleio",
      "not-paired",
      "revoked",
      "offline",
    ]);
  });

  it("is what readTicket says of a broken Tailscale ticket and a ticket of another type", () => {
    const v4 = JSON.parse(TICKET) as Record<string, unknown>;
    expect(readTicket(JSON.stringify({ ...v4, v: 2 }))).toEqual({
      kind: "invalid",
      error: words("tailscale"),
    });
    expect(readTicket(JSON.stringify({ ...v4, type: "wifi" }))).toEqual({
      kind: "invalid",
      error: words("not-kleio"),
    });
  });

  it("is what the verdict says when the host doesn't know this device, or removed it", () => {
    for (const device of ["iPhone", "Mac"] as const) {
      for (const refusal of ["not-paired", "revoked"] as const) {
        const said = diagnoseLink({
          link: status({ paired: true, active: true, running: true, refusal }),
          health: { state: "error", kleioDown: false },
          host: null,
          hostLabel: "mac-mini-1",
          device,
          online: true,
        });
        expect(`${said.headline}. ${said.detail}`, `${refusal} on the ${device}`).toBe(
          words(refusal, device),
        );
      }
    }
  });

  it("is what pairing says on a device that's offline", () => {
    expect(pairingOffline("iPhone")).toBe(words("offline", "iPhone"));
    expect(pairingOffline("Mac")).toBe(words("offline", "Mac"));
  });

  it("has the steps pairing shows, in the link's order", () => {
    expect(PAIR_STAGE_TEXT).toEqual(table.stages);
    expect(Object.keys(table.stages)).toEqual(["relay", "host", "pairing"]);
  });
});

describe("LinkConfirm", () => {
  it("shows each step as the link begins it, for the eye and for a screen reader", async () => {
    let onStage: { onmessage: (stage: PairStage) => void } | undefined;
    let finish: (record: unknown) => void = () => {};
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "kleio_link_status") return null;
      if (cmd !== "kleio_link_pair") throw new Error(`unexpected invoke ${cmd}`);
      onStage = (args as { onStage: { onmessage: (stage: PairStage) => void } }).onStage;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const onPaired = vi.fn();
    renderConfirm(onPaired);
    const spoken = screen.getByRole("status");
    expect(spoken.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    // The relay first, before the link has said anything.
    const button = await screen.findByRole("button", { name: "Reaching the relay…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(spoken.textContent).toBe("Reaching the relay…");
    for (const stage of ["host", "pairing"] as const) {
      act(() => onStage?.onmessage(stage));
      expect(button.textContent).toBe(PAIR_STAGE_TEXT[stage]);
      expect(spoken.textContent).toBe(PAIR_STAGE_TEXT[stage]);
    }
    await act(async () => finish({}));
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith(null));
    expect(spoken.textContent).toBe("");
  });

  it("on a Mac with no network, says so in the table's words and dials nothing", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect((await screen.findByRole("alert")).textContent).toBe(words("offline", "Mac"));
    expect(invokeMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("on an iPhone gone offline on the way, says that rather than what the link saw", async () => {
    document.documentElement.classList.add("platform-ios");
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd !== "kleio_link_pair") throw new Error(`unexpected invoke ${cmd}`);
      online = false;
      throw words("relay-unreachable");
    });
    renderConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect((await screen.findByRole("alert")).textContent).toBe(words("offline", "iPhone"));
  });

  it("online, says what the link saw, in its own words", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd !== "kleio_link_pair") throw new Error(`unexpected invoke ${cmd}`);
      throw words("relay-unreachable");
    });
    renderConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect((await screen.findByRole("alert")).textContent).toBe(words("relay-unreachable"));
  });
});

describe("takesPairingText", () => {
  it("is always so on the Mac, and on the iPhone only in a debug build", () => {
    expect(takesPairingText(status({ debugBuild: false }))).toBe(true);
    document.documentElement.classList.add("platform-ios");
    expect(takesPairingText(status({ debugBuild: false }))).toBe(false);
    expect(takesPairingText(status({ debugBuild: true }))).toBe(true);
  });
});
