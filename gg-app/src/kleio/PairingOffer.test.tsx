// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
// The link's ticket vectors, which kleio-host's and the link's own tests read too.
import vectors from "../../../packages/kleio-link/tests/fixtures/tickets.json";
import {
  noTicketWords,
  offerShown,
  PAIR_STATE_POLL_MS,
  PairingOffer,
  useWithdrawOnClose,
  withdrawOffer,
} from "./PairingOffer";
import { pairTicket } from "./pairTicket";
import { encodeQr, qrSvgPath, type QrCode } from "./qr";
import { toast } from "../toast";
import type { AdminState, PairClaim, PairOffer, PairState } from "./useKleioRemote";

vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const [VECTOR] = vectors.good;
if (VECTOR === undefined) throw new Error("no ticket vectors");
/** A v4 ticket as kleio-host builds it, for pair code ABC-DEF. */
const TICKET = VECTOR.ticket;
const TAILNET = "https://mac-mini-1.tail0000.ts.net:8443";
/** What a link pairing's base is (LINK_BASE in kleio/mod.rs). */
const OVER_LINK = "http://link.kleio.invalid";

function offer(over: Partial<PairOffer> = {}): PairOffer {
  return {
    display: "ABC-DEF",
    expiresAt: Date.now() + 5 * 60_000,
    admin: false,
    ticket: TICKET,
    ticketError: null,
    ...over,
  };
}

function qrOf(text: string): QrCode {
  const qr = encodeQr(text);
  if (!qr.ok) throw new Error(qr.error);
  return qr.value;
}

function v2Ticket(baseUrl: string, code: string): string {
  const t = pairTicket(baseUrl, code);
  if (!t.ok) throw new Error(t.error);
  return t.value;
}

/** Answers the admin commands from `map`; any other is a test's mistake. */
function routes(map: Record<string, (args?: Record<string, unknown>) => unknown>): void {
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const fn = map[cmd];
    if (!fn) throw new Error(`unexpected invoke ${cmd}`);
    return fn(args as Record<string, unknown> | undefined);
  });
}

/** An admin command's error, as Rust's `AdminError` arrives. */
function refusal(kind: string, message: string): Promise<never> {
  return Promise.reject({ kind, message });
}

const UNLOCKED: AdminState = {
  unlocked: true,
  expiresAt: Date.now() + 15 * 60_000,
  available: true,
};
const IDLE: PairState = {
  active: false,
  expiresAt: null,
  redeemed: false,
  admin: false,
  claim: null,
};
const IPHONE: PairClaim = {
  label: "iPhone",
  deviceCode: "3F9 AC2",
  at: 1_000,
  contested: false,
  allowed: false,
};

/** What the host says of `shown` while it's the live code, `over` on top. */
function live(shown: PairOffer, over: Partial<PairState> = {}): PairState {
  return {
    active: true,
    expiresAt: shown.expiresAt,
    redeemed: false,
    admin: shown.admin,
    claim: null,
    ...over,
  };
}

/** Runs the view's timers `ms` on (fake timers), and what they asked. */
async function tick(ms: number = PAIR_STATE_POLL_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  // A host that hasn't answered yet, unless a test says what it answers.
  routes({
    kleio_admin_state: () => UNLOCKED,
    kleio_pair_state: () => new Promise(() => {}),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("offerShown", () => {
  it("draws the host's link ticket, whatever address this device has", () => {
    for (const base of [TAILNET, OVER_LINK, null]) {
      expect(offerShown(offer(), base)).toEqual({
        kind: "link",
        ticket: TICKET,
        qr: qrOf(TICKET),
      });
    }
  });

  it("with no link ticket, says why, and draws today's Tailscale ticket for a device on the tailnet", () => {
    expect(offerShown(offer({ ticket: null, ticketError: "link_down" }), TAILNET)).toEqual({
      kind: "tailscale",
      why: noTicketWords("link_down"),
      baseUrl: TAILNET,
      qr: qrOf(v2Ticket(TAILNET, "ABC-DEF")),
    });
  });

  it("with no link ticket and no tailnet address, shows the code alone, and why", () => {
    for (const base of [OVER_LINK, "https://kleio.example.com", null]) {
      expect(offerShown(offer({ ticket: null, ticketError: "no_link" }), base)).toEqual({
        kind: "code",
        why: noTicketWords("no_link"),
      });
    }
  });

  it("never draws a ticket a device wouldn't take as a link ticket", () => {
    const tooLong = JSON.stringify({ v: 4, type: "kleio-pair", name: "x".repeat(600) });
    for (const ticket of ["not a ticket", v2Ticket(TAILNET, "ABC-DEF"), tooLong]) {
      expect(offerShown(offer({ ticket }), null)).toEqual({
        kind: "code",
        why: noTicketWords("ticket"),
      });
    }
  });
});

describe("noTicketWords", () => {
  it("says why for each reason the host gives, and no two the same", () => {
    const reasons = ["no_link", "link_down", "config", "ticket"];
    expect(new Set(reasons.map(noTicketWords)).size).toBe(reasons.length);
    // A host from before the link gives no reason: it has no link.
    expect(noTicketWords(null)).toBe(noTicketWords("no_link"));
    // A reason this app doesn't know yet is the host's to explain.
    expect(noTicketWords("a_new_reason")).toBe(noTicketWords("ticket"));
  });
});

describe("PairingOffer", () => {
  it("over the link: the QR code an iPhone scans, the text a Mac pastes, and the code to check", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PairingOffer offer={offer()} baseUrl={TAILNET} onDone={() => {}} />);
    const qr = screen.getByRole("img", { name: "Pairing QR code for pair code ABC-DEF" });
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(qrSvgPath(qrOf(TICKET), 4));
    expect(screen.getByLabelText("Pairing text, for a Mac")).toHaveProperty("value", TICKET);
    // In the iPhone's and the Mac's own words for where to go.
    expect(screen.getByText("Scan QR code")).toBeTruthy();
    expect(screen.getByText("Paste pairing text")).toBeTruthy();
    // The code the device's confirm step shows; the address is no part of it.
    expect(screen.getByText("ABC-DEF")).toBeTruthy();
    expect(screen.queryByText(TAILNET)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy pairing text" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith(TICKET);
  });

  it("says so when the pairing text can't be copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("not allowed"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PairingOffer offer={offer()} baseUrl={null} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy pairing text" }));
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Couldn't copy. Select the pairing text and copy it instead.",
        "error",
      ),
    );
    expect(screen.getByRole("button", { name: "Copy pairing text" })).toBeTruthy();
  });

  it("with no link ticket on the tailnet: why, today's QR code, and the address and code to type", () => {
    render(
      <PairingOffer
        offer={offer({ ticket: null, ticketError: "link_down" })}
        baseUrl={TAILNET}
        onDone={() => {}}
      />,
    );
    expect(screen.getByText(noTicketWords("link_down"))).toBeTruthy();
    const qr = screen.getByRole("img", { name: "Pairing QR code for pair code ABC-DEF" });
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(
      qrSvgPath(qrOf(v2Ticket(TAILNET, "ABC-DEF")), 4),
    );
    expect(screen.getByText(TAILNET)).toBeTruthy();
    expect(screen.getByText("ABC-DEF")).toBeTruthy();
    expect(screen.queryByLabelText("Pairing text, for a Mac")).toBeNull();
  });

  it("with no QR code at all: why, and the code to type with the host's address", () => {
    render(
      <PairingOffer
        offer={offer({ ticket: null, ticketError: "no_link" })}
        baseUrl={OVER_LINK}
        onDone={() => {}}
      />,
    );
    expect(screen.getByText(noTicketWords("no_link"))).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("ABC-DEF")).toBeTruthy();
    expect(screen.queryByText(OVER_LINK)).toBeNull();
  });

  it("counts down, and is done when the code expires", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(
      <PairingOffer
        offer={offer({ expiresAt: Date.now() + 62_000, admin: true })}
        baseUrl={null}
        onDone={onDone}
      />,
    );
    expect(screen.getByText("Works once · pairs an admin · expires in 1:02")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("Works once · pairs an admin · expires in 1:00")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("expired");
  });

  it("is done on Done, and takes the code away", async () => {
    const shown = offer();
    let cancels = 0;
    routes({
      kleio_admin_state: () => UNLOCKED,
      kleio_pair_state: () => live(shown),
      kleio_pair_cancel: () => {
        cancels += 1;
        return null;
      },
    });
    const onDone = vi.fn();
    render(<PairingOffer offer={shown} baseUrl={null} onDone={onDone} />);
    expect(screen.getByText(/^Works once · expires in [45]:\d\d$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("done");
    await vi.waitFor(() => expect(cancels).toBe(1));
  });
});

describe("PairingOffer, with a device waiting on the code", () => {
  it("puts the device and its device code in the QR code's place, and Allow lets in that device alone", async () => {
    vi.useFakeTimers();
    const shown = offer();
    let state = live(shown);
    const decided: unknown[] = [];
    routes({
      kleio_pair_state: () => state,
      kleio_pair_decide: (args) => {
        decided.push(args);
        state = live(shown, { claim: { ...IPHONE, allowed: true } });
        return { label: "iPhone", deviceCode: "3F9 AC2" };
      },
    });
    const onDone = vi.fn();
    render(<PairingOffer offer={shown} baseUrl={null} onDone={onDone} />);
    await tick();
    // Nobody yet: the QR code stays.
    expect(screen.getByRole("img", { name: "Pairing QR code for pair code ABC-DEF" })).toBeTruthy();
    state = live(shown, { claim: IPHONE });
    await tick();
    expect(screen.queryByRole("img", { name: /^Pairing QR code/ })).toBeNull();
    const ask = screen.getByRole("group", { name: "iPhone wants to pair." });
    expect(within(ask).getByText("3F9 AC2")).toBeTruthy();
    expect(within(ask).getByText("Allow it only if the device shows the same code.")).toBeTruthy();
    expect(within(ask).queryByText("Another device also tried this code.")).toBeNull();
    // A screen reader hears who it is, and the code to check.
    expect(
      screen.getByText("iPhone wants to pair. Device code 3F9 AC2.").getAttribute("role"),
    ).toBe("status");
    fireEvent.click(within(ask).getByRole("button", { name: "Allow" }));
    await tick(0);
    expect(decided).toEqual([{ allow: true, deviceCode: "3F9 AC2" }]);
    expect(screen.getByText("Allowed iPhone. Finishing on the device…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    // Done once the device has its token.
    state = live(shown, { redeemed: true, claim: { ...IPHONE, allowed: true } });
    await tick();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("paired");
    expect(toast).toHaveBeenCalledWith("iPhone is paired.", "success");
  });

  it("Deny turns the device down, and the view closes", async () => {
    vi.useFakeTimers();
    const shown = offer();
    const decided: unknown[] = [];
    routes({
      kleio_pair_state: () => live(shown, { claim: IPHONE }),
      kleio_pair_decide: (args) => {
        decided.push(args);
        return { label: "iPhone", deviceCode: "3F9 AC2" };
      },
    });
    const onDone = vi.fn();
    render(<PairingOffer offer={shown} baseUrl={null} onDone={onDone} />);
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await tick(0);
    expect(decided).toEqual([{ allow: false, deviceCode: "3F9 AC2" }]);
    expect(onDone).toHaveBeenCalledWith("denied");
    expect(toast).toHaveBeenCalledWith("iPhone was denied.", "info");
  });

  it("says when the device would be an admin, and when another device also tried the code", async () => {
    vi.useFakeTimers();
    const shown = offer({ admin: true });
    routes({
      kleio_pair_state: () => live(shown, { claim: { ...IPHONE, label: null, contested: true } }),
    });
    render(<PairingOffer offer={shown} baseUrl={null} onDone={() => {}} />);
    await tick();
    const ask = screen.getByRole("group", { name: "A device wants to pair as an admin." });
    expect(within(ask).getByText("Another device also tried this code.")).toBeTruthy();
    expect(within(ask).getByText("3F9 AC2")).toBeTruthy();
  });

  it("a decision for a device no longer waiting says why, and shows who's waiting now", async () => {
    vi.useFakeTimers();
    const shown = offer();
    const IPAD: PairClaim = { ...IPHONE, label: "iPad", deviceCode: "9C0 1DE", contested: true };
    let state = live(shown, { claim: IPHONE });
    routes({
      kleio_pair_state: () => state,
      kleio_pair_decide: () => {
        state = live(shown, { claim: IPAD });
        return refusal(
          "changed",
          "Another device is waiting on this code now. Check its device code, then decide again.",
        );
      },
    });
    const onDone = vi.fn();
    render(<PairingOffer offer={shown} baseUrl={null} onDone={onDone} />);
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await tick(0);
    await tick(0);
    expect(screen.getByRole("alert").textContent).toBe(
      "Another device is waiting on this code now. Check its device code, then decide again.",
    );
    const ask = screen.getByRole("group", { name: "iPad wants to pair." });
    expect(within(ask).getByText("9C0 1DE")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("closes when the code is gone from the host, or a newer one replaced it", async () => {
    vi.useFakeTimers();
    const shown = offer();
    for (const state of [IDLE, live(shown, { expiresAt: shown.expiresAt + 60_000 })]) {
      routes({ kleio_pair_state: () => state });
      const onDone = vi.fn();
      const view = render(<PairingOffer offer={shown} baseUrl={null} onDone={onDone} />);
      await tick();
      expect(onDone).toHaveBeenCalledWith("gone");
      expect(toast).toHaveBeenCalledWith("This pair code no longer works.", "info");
      view.unmount();
    }
  });

  it("a cancelled Touch ID stops the checks until Check again; a network error doesn't", async () => {
    vi.useFakeTimers();
    const shown = offer();
    let asks = 0;
    let answer = (): Promise<PairState> =>
      refusal("denied", "Touch ID was cancelled or didn't match.");
    routes({
      kleio_pair_state: () => {
        asks += 1;
        return answer();
      },
    });
    render(<PairingOffer offer={shown} baseUrl={null} onDone={() => {}} />);
    await tick();
    expect(asks).toBe(1);
    expect(
      screen.getByText(
        "Kleio can't see who's using this code. Touch ID was cancelled or didn't match.",
      ),
    ).toBeTruthy();
    await tick(10 * PAIR_STATE_POLL_MS);
    expect(asks).toBe(1);
    answer = () => refusal("network", "connection refused");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await tick(0);
    expect(asks).toBe(2);
    expect(
      screen.getByText("Kleio can't see who's using this code. connection refused"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    // Still asking, and the device shows as soon as the host answers.
    answer = async () => live(shown, { claim: IPHONE });
    await tick();
    expect(asks).toBe(3);
    expect(screen.getByRole("group", { name: "iPhone wants to pair." })).toBeTruthy();
    expect(screen.queryByText(/^Kleio can't see who's using this code/)).toBeNull();
  });
});

describe("withdrawOffer", () => {
  it("takes the live code away, and a device waiting on it with it", async () => {
    const shown = offer();
    let cancels = 0;
    routes({
      kleio_admin_state: () => UNLOCKED,
      kleio_pair_state: () => live(shown, { claim: IPHONE }),
      kleio_pair_cancel: () => {
        cancels += 1;
        return null;
      },
    });
    await withdrawOffer(shown);
    expect(cancels).toBe(1);
  });

  it("leaves alone a code that isn't live, a used one, one a device allowed is finishing with, and all without the admin unlock", async () => {
    const shown = offer();
    const cases: [AdminState, PairState][] = [
      [{ ...UNLOCKED, unlocked: false, expiresAt: null }, live(shown, { claim: IPHONE })],
      [UNLOCKED, live(shown, { claim: { ...IPHONE, allowed: true } })],
      [UNLOCKED, live(shown, { redeemed: true })],
      [UNLOCKED, live(shown, { expiresAt: shown.expiresAt + 60_000 })],
      [UNLOCKED, IDLE],
    ];
    for (const [admin, state] of cases) {
      // No kleio_pair_cancel: asking it would throw, and say so in a toast.
      routes({ kleio_admin_state: () => admin, kleio_pair_state: () => state });
      await withdrawOffer(shown);
    }
    expect(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)).not.toContain("kleio_pair_cancel");
    expect(toast).not.toHaveBeenCalled();
  });

  it("says so when the code couldn't be taken away", async () => {
    const shown = offer();
    routes({
      kleio_admin_state: () => UNLOCKED,
      kleio_pair_state: () => live(shown),
      kleio_pair_cancel: () => refusal("network", "connection refused"),
    });
    await withdrawOffer(shown);
    expect(toast).toHaveBeenCalledWith(
      "Couldn't take the pair code away, so it works until it expires. connection refused",
      "error",
    );
  });
});

describe("useWithdrawOnClose", () => {
  function Shown({ offer }: { offer: PairOffer | null }): null {
    useWithdrawOnClose(offer);
    return null;
  }

  it("takes away the code on show when the view goes away: the newest, and none if none shows", async () => {
    const first = offer();
    const newer = offer({ display: "XYZ-UVW", expiresAt: first.expiresAt + 30_000 });
    let cancels = 0;
    routes({
      kleio_admin_state: () => UNLOCKED,
      // The host's live code is the newer one: taking the first away would do nothing.
      kleio_pair_state: () => live(newer),
      kleio_pair_cancel: () => {
        cancels += 1;
        return null;
      },
    });
    render(<Shown offer={null} />).unmount();
    const view = render(<Shown offer={first} />);
    view.rerender(<Shown offer={newer} />);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    view.unmount();
    await vi.waitFor(() => expect(cancels).toBe(1));
  });
});
