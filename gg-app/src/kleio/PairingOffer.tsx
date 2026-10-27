// The admin's "Pair a device": a pair code just minted, shown for the device
// that's to pair, in Settings → Connection and in the ⌘⇧K pane's Devices tab.
//
// Over Kleio's link it's the host's ticket for the code (POST
// /kleio/pair/offer's `ticket`), drawn as the QR code an iPhone scans and
// given as the pairing text a Mac pastes. The device's confirm step shows
// the code, so the person can check it's this one. Only a ticket a device
// would read as a link ticket is drawn (readTicket).
//
// A device that pairs with it over the link waits for an admin's Allow (ADR
// 0003). While the code shows, the view asks the host who's waiting (GET
// /kleio/pair) and puts that device's name and device code, which the device
// shows too, in the QR code's place, with Allow and Deny. It closes once the
// device has paired, the admin denied it, or the code is gone. Done takes
// the code away (withdrawOffer), and so does the view going away first
// (useWithdrawOnClose), so no device waits on a code nobody is watching:
// never one a device the admin allowed is finishing with, though.
//
// A host without the link, or whose link can't pair now, gives no ticket.
// Then the view says why. A device that reaches the host at a tailnet address
// draws today's Tailscale ticket instead (pairTicket), for a device on the
// tailnet; anything else shows the code, for pairing by the host's address.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { toast } from "../toast";
import { pairTicket, readTicket } from "./pairTicket";
import { encodeQr, qrSvgPath, type QrCode } from "./qr";
import {
  explainError,
  kleio,
  type PairClaim,
  type PairOffer,
  type PairState,
} from "./useKleioRemote";

/** The light margin round a QR code that scanners need. */
const QR_QUIET_ZONE = 4;

/** How often a shown code's view asks the host who's waiting on it. */
export const PAIR_STATE_POLL_MS = 1_500;

/**
 * Why a shown code's view closed. Only after `done`, Done, may the code still
 * work, so whoever shows it takes it away (`withdrawOffer`). The rest settled
 * on the host: a device paired with it, the admin denied the device waiting
 * on it, it expired, or it's gone (taken away, or replaced by a newer code,
 * elsewhere).
 */
export type OfferEnd = "done" | "paired" | "denied" | "expired" | "gone";

/** The admin errors after which asking again would only fail again, or ask
 *  for Touch ID again: the view stops asking until Check again. */
const STOPS_CHECKING: ReadonlySet<string> = new Set([
  "denied",
  "unavailable",
  "forbidden",
  "unauthorized",
  "not_remote",
]);

/** The kind of an admin command's error (Rust `AdminError`), if it is one. */
function errorKind(e: unknown): string | null {
  return typeof e === "object" && e !== null && "kind" in e && typeof e.kind === "string"
    ? e.kind
    : null;
}

/**
 * Takes `offer` away on the host (`kleio.cancelOffer`), so a device waiting
 * on it is denied, and says so if it couldn't. Not if it's no longer the
 * live code (used, gone, or replaced by a newer one, which taking it away
 * would take), nor while a device the admin allowed is finishing with it.
 * Nor without the admin unlock: it would ask for Touch ID out of the blue,
 * and the code lets no device in without an Allow anyway, until it expires.
 */
export async function withdrawOffer(offer: PairOffer): Promise<void> {
  try {
    if (!(await kleio.adminState()).unlocked) return;
    const state = await kleio.pairState();
    if (!state.active || state.redeemed || state.expiresAt !== offer.expiresAt) return;
    if (state.claim?.allowed) return;
    await kleio.cancelOffer();
  } catch (e) {
    toast(
      `Couldn't take the pair code away, so it works until it expires. ${explainError(e)}`,
      "error",
    );
  }
}

/**
 * Takes the pair code on show away when the view showing it goes away (a
 * page left, a pane closed), as Done does (`withdrawOffer`). `offer` is the
 * one on show, null if none: the latest when the view goes away counts.
 */
export function useWithdrawOnClose(offer: PairOffer | null): void {
  const shown = useRef(offer);
  useEffect(() => {
    shown.current = offer;
  }, [offer]);
  useEffect(() => {
    // The ref itself, read in the cleanup: the code on show when the view
    // goes away, not the one when it came.
    const latest = shown;
    return () => {
      if (latest.current) void withdrawOffer(latest.current);
    };
  }, []);
}

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

interface OfferProps {
  offer: PairOffer;
  /** As for `offerShown`. */
  baseUrl: string | null;
  /** Once, with why the view closed. */
  onDone: (end: OfferEnd) => void;
}

/**
 * A minted offer, shown until Done, until it expires, or until it settles on
 * the host: a device paired with it, the admin denied the device waiting on
 * it, or it's gone. `onDone` says which.
 */
export function PairingOffer(props: OfferProps): React.ReactElement {
  // A new code is a new view: nothing about the last one's device carries over.
  return <ShownOffer key={`${props.offer.display}@${props.offer.expiresAt}`} {...props} />;
}

function ShownOffer({ offer, baseUrl, onDone }: OfferProps): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // onDone once, however the view ends, and the latest one: the checks below
  // outlive a render.
  const latestOnDone = useRef(onDone);
  useEffect(() => {
    latestOnDone.current = onDone;
  }, [onDone]);
  const ended = useRef(false);
  const end = useCallback((how: OfferEnd, said?: string) => {
    if (ended.current) return;
    ended.current = true;
    if (said) toast(said, how === "paired" ? "success" : "info");
    latestOnDone.current(how);
  }, []);

  const expired = offer.expiresAt <= now;
  useEffect(() => {
    if (expired) end("expired");
  }, [expired, end]);

  // Who's waiting on the code, as the host last said.
  const [claim, setClaim] = useState<PairClaim | null>(null);
  const [trouble, setTrouble] = useState<{ message: string; stopped: boolean } | null>(null);
  const [checks, setChecks] = useState(0);
  // Bumped as a decision starts and ends: a check that spans one may answer
  // from before it, so it's asked again.
  const decisions = useRef(0);
  useEffect(() => {
    let closed = false;
    let timer: number | undefined;
    const next = (ms: number): void => {
      timer = window.setTimeout(() => void check(), ms);
    };
    const check = async (): Promise<void> => {
      const asked = decisions.current;
      let state: PairState;
      try {
        state = await kleio.pairState();
      } catch (e) {
        if (closed) return;
        const stopped = STOPS_CHECKING.has(errorKind(e) ?? "");
        setTrouble({ message: explainError(e), stopped });
        if (!stopped) next(PAIR_STATE_POLL_MS);
        return;
      }
      if (closed) return;
      setTrouble(null);
      if (asked !== decisions.current) {
        next(0);
      } else if (!state.active || state.expiresAt !== offer.expiresAt) {
        end("gone", "This pair code no longer works.");
      } else if (state.redeemed) {
        end("paired", `${state.claim?.label ?? "A device"} is paired.`);
      } else {
        setClaim(state.claim);
        next(PAIR_STATE_POLL_MS);
      }
    };
    // The first check waits a beat: no device has had time to use a new code.
    next(checks === 0 ? PAIR_STATE_POLL_MS : 0);
    return () => {
      closed = true;
      window.clearTimeout(timer);
    };
  }, [offer.expiresAt, checks, end]);

  const [deciding, setDeciding] = useState<"allow" | "deny" | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const decide = async (allow: boolean, waiting: PairClaim): Promise<void> => {
    decisions.current += 1;
    setDeciding(allow ? "allow" : "deny");
    setRefused(null);
    try {
      // This device and no other: one in its place isn't let in by mistake.
      const decided = await kleio.decide(allow, waiting.deviceCode);
      if (allow) setClaim({ ...waiting, allowed: true });
      else end("denied", `${decided.label ?? "The device"} was denied.`);
    } catch (e) {
      setRefused(explainError(e));
      const kind = errorKind(e);
      // Another device in its place, or none: see who's waiting now.
      if (kind === "changed" || kind === "none_waiting") setChecks((n) => n + 1);
    } finally {
      decisions.current += 1;
      setDeciding(null);
    }
  };

  const shown = useMemo(() => offerShown(offer, baseUrl), [offer, baseUrl]);
  return (
    <div className="conn-pair">
      {claim === null && shown.kind !== "code" && <OfferQr qr={shown.qr} code={offer.display} />}
      <div className="conn-pair-text">
        {claim !== null ? (
          claim.allowed ? (
            <p className="conn-pair-note">
              Allowed {claim.label ?? "the device"}. Finishing on the device…
            </p>
          ) : (
            <AllowAsk
              claim={claim}
              admin={offer.admin}
              deciding={deciding}
              onDecide={(allow) => void decide(allow, claim)}
            />
          )
        ) : shown.kind === "link" ? (
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
        {refused && (
          <p className="conn-pair-note is-why" role="alert">
            {refused}
          </p>
        )}
        {trouble && (
          <p className="conn-pair-note is-why" role="status">
            Kleio can't see who's using this code. {trouble.message}
          </p>
        )}
        {trouble?.stopped && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setTrouble(null);
              setChecks((n) => n + 1);
            }}
          >
            Check again
          </button>
        )}
        <p className="conn-expiry">
          Works once{offer.admin ? " · pairs an admin" : ""} · expires in{" "}
          {countdown(offer.expiresAt - now)}
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void withdrawOffer(offer);
            end("done");
          }}
        >
          Done
        </button>
      </div>
      {/* There before it speaks, so a screen reader hears a device arrive. */}
      <p className="sr-only" role="status">
        {claim === null
          ? ""
          : claim.allowed
            ? `Allowed ${claim.label ?? "the device"}. Finishing on the device.`
            : `${claim.label ?? "A device"} wants to pair. Device code ${claim.deviceCode}.`}
      </p>
    </div>
  );
}

/**
 * A device waiting on the code: who it says it is, whether it would be an
 * admin, its device code to check against the one it shows, and Allow or
 * Deny. A name can be copied, so the device code is what to go by.
 */
function AllowAsk({
  claim,
  admin,
  deciding,
  onDecide,
}: {
  claim: PairClaim;
  admin: boolean;
  deciding: "allow" | "deny" | null;
  onDecide: (allow: boolean) => void;
}): React.ReactElement {
  const titleId = useId();
  return (
    <div className="conn-pair-ask" role="group" aria-labelledby={titleId}>
      <p id={titleId} className="conn-pair-ask-title">
        {claim.label === null ? "A device" : <strong>{claim.label}</strong>} wants to pair
        {admin ? " as an admin" : ""}.
      </p>
      <p className="conn-pair-codeline">
        <span className="conn-pair-label">Device code</span>{" "}
        <code className="conn-pair-code">{claim.deviceCode}</code>
      </p>
      <p className="conn-pair-note">Allow it only if the device shows the same code.</p>
      {claim.contested && (
        <p className="conn-pair-note is-why">Another device also tried this code.</p>
      )}
      <div className="conn-inline-confirm">
        <button
          type="button"
          className="btn btn-sm"
          disabled={deciding !== null}
          onClick={() => onDecide(false)}
        >
          {deciding === "deny" ? "Denying…" : "Deny"}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={deciding !== null}
          onClick={() => onDecide(true)}
        >
          {deciding === "allow" ? "Allowing…" : "Allow"}
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
