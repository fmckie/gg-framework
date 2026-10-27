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
import {
  LinkConfirm,
  PAIR_STAGE_TEXT,
  pairingOffline,
  pairStageText,
  takesPairingText,
} from "./LinkPairing";
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

function renderConfirm(
  onPaired: (now: LinkStatus | null) => void = () => {},
  onBack: () => void = () => {},
): void {
  render(
    <LinkConfirm
      ticket={TICKET}
      check={CHECKED}
      label=""
      onLabel={() => {}}
      onBack={onBack}
      onPaired={onPaired}
    />,
  );
}

/** A Channel's handler for the stages, as kleio_link_pair gets it. */
type Stages = { onmessage: (stage: PairStage) => void };

/**
 * kleio_link_pair under way until `finish` or `fail`, and the stages it was
 * given; kleio_link_pair_cancel fails it as the link does, with what it
 * fails with.
 */
function pairing(): {
  stages: () => Stages | undefined;
  finish: (record: unknown) => void;
  fail: (error: string) => void;
} {
  let stages: Stages | undefined;
  let finish: (record: unknown) => void = () => {};
  let fail: (error: string) => void = () => {};
  invokeMock.mockImplementation(async (cmd, args) => {
    if (cmd === "kleio_link_status") return null;
    if (cmd === "kleio_link_pair_cancel") {
      fail("Pairing was cancelled.");
      return null;
    }
    if (cmd !== "kleio_link_pair") throw new Error(`unexpected invoke ${cmd}`);
    stages = (args as { onStage: Stages }).onStage;
    return new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  return { stages: () => stages, finish: (record) => finish(record), fail: (e) => fail(e) };
}

const WAITING: PairStage = { waiting: { deviceCode: "3F9 AC2" } };

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
    "denied",
    "claimed",
    "not-allowed-in-time",
    "update-required",
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

  it("has the steps pairing shows, then its wait for an Allow, in the link's order", () => {
    expect(Object.keys(table.stages)).toEqual(["relay", "host", "pairing", "waiting"]);
    for (const device of ["iPhone", "Mac"] as const) {
      const shown = {
        ...Object.fromEntries(
          (["relay", "host", "pairing"] as const).map((step) => [
            step,
            pairStageText(step, device),
          ]),
        ),
        waiting: pairStageText(WAITING, device),
      };
      const said = Object.fromEntries(
        Object.entries(table.stages).map(([step, text]) => [step, fill(text, device)]),
      );
      expect(shown, device).toEqual(said);
    }
  });
});

describe("LinkConfirm", () => {
  it("shows each step as the link begins it, for the eye and for a screen reader", async () => {
    const run = pairing();
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
      act(() => run.stages()?.onmessage(stage));
      expect(button.textContent).toBe(PAIR_STAGE_TEXT[stage]);
      expect(spoken.textContent).toBe(PAIR_STAGE_TEXT[stage]);
    }
    await act(async () => run.finish({}));
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith(null));
    expect(spoken.textContent).toBe("");
  });

  it("waits for an Allow showing this device's code, for the eye and for a screen reader", async () => {
    document.documentElement.classList.add("platform-ios");
    const run = pairing();
    const onPaired = vi.fn();
    renderConfirm(onPaired);
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByRole("button", { name: "Reaching the relay…" });
    act(() => run.stages()?.onmessage(WAITING));
    // The table's words for this device, and the code the admin is asked about.
    const waiting = fill(table.stages.waiting, "iPhone");
    expect(screen.getByText(waiting)).toBeTruthy();
    expect(screen.getByText("3F9 AC2").tagName).toBe("CODE");
    expect(screen.getByRole("status").textContent).toBe(`${waiting} Device code 3F9 AC2.`);
    // Pair is gone, and its way out has focus.
    expect(screen.queryByRole("button", { name: /^Pair|^Waiting/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => run.finish({}));
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith(null));
  });

  it("Cancel on the wait stops it and goes back, with nothing to say", async () => {
    pairing();
    const onPaired = vi.fn();
    const onBack = vi.fn();
    renderConfirm(onPaired, onBack);
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByRole("button", { name: "Reaching the relay…" });
    const stages = (invokeMock.mock.calls[0]?.[1] as { onStage: Stages }).onStage;
    act(() => stages.onmessage(WAITING));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
      "kleio_link_pair",
      "kleio_link_pair_cancel",
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("a refusal on the wait says why, and Pair is back", async () => {
    const run = pairing();
    const onBack = vi.fn();
    renderConfirm(() => {}, onBack);
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByRole("button", { name: "Reaching the relay…" });
    act(() => run.stages()?.onmessage(WAITING));
    await act(async () => run.fail(words("denied", "Mac")));
    expect((await screen.findByRole("alert")).textContent).toBe(words("denied", "Mac"));
    expect(screen.queryByText("3F9 AC2")).toBeNull();
    expect((screen.getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(onBack).not.toHaveBeenCalled();
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
