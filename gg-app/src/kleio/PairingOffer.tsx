// The admin's "Pair a device": a pair code just minted, shown for the device
// that's to pair, in Settings → Connection and in the ⌘⇧K pane's Devices tab.
//
// Over Kleio's link it's the host's ticket for the code (POST
// /kleio/pair/offer's `ticket`), drawn as the QR code an iPhone scans and
// given as the pairing text a Mac pastes. The device's confirm step shows
// the code, so the person can check it's this one. Only a ticket a device
// would read as a link ticket is drawn (readTicket).
//
// A host without the link, or whose link can't pair now, gives no ticket.
// Then the view says why. A device that reaches the host at a tailnet address
// draws today's Tailscale ticket instead (pairTicket), for a device on the
// tailnet; anything else shows the code, for pairing by the host's address.

import { useEffect, useId, useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { toast } from "../toast";
import { pairTicket, readTicket } from "./pairTicket";
import { encodeQr, qrSvgPath, type QrCode } from "./qr";
import type { PairOffer } from "./useKleioRemote";

/** The light margin round a QR code that scanners need. */
const QR_QUIET_ZONE = 4;

/** How an offer is shown. */
export type OfferShown =
  /** Kleio's link: an iPhone scans the QR code, and a Mac pastes the ticket. */
  | { kind: "link"; ticket: string; qr: QrCode }
  /** No link ticket, and this device reaches the host at a tailnet address:
   *  today's Tailscale ticket, for a device on the tailnet. */
  | { kind: "tailscale"; why: string; baseUrl: string; qr: QrCode }
  /** No QR code: the code, for pairing by the host's address. */
  | { kind: "code"; why: string };

/** Why an offer has no link ticket (its `ticketError`), in plain words. */
export function noTicketWords(ticketError: string | null): string {
  switch (ticketError) {
    case null:
    case "no_link":
      return "Your host doesn't run Kleio's link, so there's no QR code for it.";
    case "link_down":
      return "Kleio's link isn't running on your host, or isn't on a relay yet, so there's no QR code for it. Give it a moment, then show a new one.";
    case "config":
      return "Your host can't read its list of relays, so there's no QR code for Kleio's link. Its log says why.";
    default:
      return "Your host couldn't make a QR code for Kleio's link. Its log says why.";
  }
}

/**
 * How to show `offer`: the link's ticket when the host gave one a device
 * would take; else today's Tailscale ticket when `baseUrl`, the address this
 * device reaches the host at, is a tailnet one; else the code alone.
 */
export function offerShown(offer: PairOffer, baseUrl: string | null): OfferShown {
  if (offer.ticket !== null && readTicket(offer.ticket).kind === "link") {
    const qr = encodeQr(offer.ticket);
    if (qr.ok) return { kind: "link", ticket: offer.ticket, qr: qr.value };
  }
  // A ticket that came but can't be drawn is the host's to explain.
  const why = noTicketWords(offer.ticket === null ? offer.ticketError : "ticket");
  if (baseUrl !== null) {
    const v2 = pairTicket(baseUrl, offer.display);
    const qr = v2.ok ? encodeQr(v2.value) : null;
    if (qr?.ok) return { kind: "tailscale", why, baseUrl, qr: qr.value };
  }
  return { kind: "code", why };
}

/** "4:59": the minutes and seconds left of `ms`. */
function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A minted offer, shown until Done or until it expires, `onDone` either way.
 * `baseUrl` is as for `offerShown`.
 */
export function PairingOffer({
  offer,
  baseUrl,
  onDone,
}: {
  offer: PairOffer;
  baseUrl: string | null;
  onDone: () => void;
}): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const expired = offer.expiresAt <= now;
  useEffect(() => {
    if (expired) onDone();
  }, [expired, onDone]);

  const shown = useMemo(() => offerShown(offer, baseUrl), [offer, baseUrl]);
  return (
    <div className="conn-pair">
      {shown.kind !== "code" && <OfferQr qr={shown.qr} code={offer.display} />}
      <div className="conn-pair-text">
        {shown.kind === "link" ? (
          <>
            <ul className="conn-pair-how">
              <li>
                <strong>iPhone:</strong> open Kleio, tap <strong>Pair with your host</strong>, then{" "}
                <strong>Scan QR code</strong>.
              </li>
              <li>
                <strong>Mac:</strong> copy the pairing text, then paste it into Kleio under{" "}
                <strong>Paste pairing text</strong>.
              </li>
            </ul>
            <PairingText ticket={shown.ticket} />
            <PairCode code={offer.display} />
            <p className="conn-pair-note">
              The device shows this code before it pairs. Check it matches.
            </p>
          </>
        ) : (
          <>
            <p className="conn-pair-note is-why">{shown.why}</p>
            {shown.kind === "tailscale" ? (
              <>
                <p className="conn-pair-note">
                  This QR code pairs over Tailscale instead, so the other device needs Tailscale
                  too.
                </p>
                <ol className="conn-steps">
                  <li>
                    Open Kleio on the other device and tap <strong>Pair with your host</strong>. An
                    iPhone can scan this QR code to fill in the rest.
                  </li>
                  <li>
                    Host URL: <code className="conn-code">{shown.baseUrl}</code>
                  </li>
                  <li>
                    Pair code: <code className="conn-pair-code">{offer.display}</code>, then tap{" "}
                    <strong>Pair</strong>.
                  </li>
                </ol>
              </>
            ) : (
              <>
                <p className="conn-pair-note">
                  On the other device, tap <strong>Pair with your host</strong>, then enter your
                  host&apos;s address and this code.
                </p>
                <PairCode code={offer.display} />
              </>
            )}
          </>
        )}
        <p className="conn-expiry">
          Works once{offer.admin ? " · pairs an admin" : ""} · expires in{" "}
          {countdown(offer.expiresAt - now)}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** The code on a line of its own, large enough to compare at a glance. */
function PairCode({ code }: { code: string }): React.ReactElement {
  return (
    <p className="conn-pair-codeline">
      <span className="conn-pair-label">Pair code</span>{" "}
      <code className="conn-pair-code">{code}</code>
    </p>
  );
}

function OfferQr({ qr, code }: { qr: QrCode; code: string }): React.ReactElement {
  const side = qr.size + QR_QUIET_ZONE * 2;
  return (
    <svg
      className="conn-qr"
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={`Pairing QR code for pair code ${code}`}
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="#fff" />
      <path d={qrSvgPath(qr, QR_QUIET_ZONE)} fill="#000" />
    </svg>
  );
}

/** The ticket as text, for a Mac to paste, with a button that copies it. */
function PairingText({ ticket }: { ticket: string }): React.ReactElement {
  const id = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <div className="conn-pair-ticket">
      <label className="conn-pair-label" htmlFor={id}>
        Pairing text, for a Mac
      </label>
      <textarea
        id={id}
        className="modal-input kleio-ticket"
        readOnly
        rows={2}
        value={ticket}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          navigator.clipboard.writeText(ticket).then(
            () => setCopied(true),
            () => toast("Couldn't copy. Select the pairing text and copy it instead.", "error"),
          );
        }}
      >
        {copied ? (
          <CheckIcon size={13} weight="bold" aria-hidden="true" />
        ) : (
          <CopyIcon size={13} weight="bold" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy pairing text"}
      </button>
    </div>
  );
}
