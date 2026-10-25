// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
// The link's ticket vectors, which kleio-host's and the link's own tests read too.
import vectors from "../../../packages/kleio-link/tests/fixtures/tickets.json";
import { noTicketWords, offerShown, PairingOffer } from "./PairingOffer";
import { pairTicket } from "./pairTicket";
import { encodeQr, qrSvgPath, type QrCode } from "./qr";
import { toast } from "../toast";
import type { PairOffer } from "./useKleioRemote";

vi.mock("../toast", () => ({ toast: vi.fn() }));

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
  });

  it("is done on Done", () => {
    const onDone = vi.fn();
    render(<PairingOffer offer={offer()} baseUrl={null} onDone={onDone} />);
    expect(screen.getByText(/^Works once · expires in [45]:\d\d$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
