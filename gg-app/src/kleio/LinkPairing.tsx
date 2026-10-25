// Kleio link pairing (Rust: kleio/link.rs, macOS and iOS), shared by the pairing form
// (RemoteHostModal) and the Link card on the Connection page: scanning the
// pairing QR code on the iPhone, pasted pairing text on the Mac (and in the
// iPhone's debug builds), and a link ticket's confirm step, which pairs over
// the Kleio link and shows each step as it begins.
//
// What pairing says when it fails is the pairing messages table's
// (packages/kleio-link/tests/fixtures/pairing-messages.json): the link's own
// words for most cases, this device being offline here, and a ticket that
// isn't one in readTicket. LinkPairing.test.tsx checks no two are the same.

import { QrCodeIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isPhone } from "../platform";
import { kleioLink, type LinkStatus, type PairStage, type TicketCheck } from "./kleioLink";
import { cancelScan, usePairingScan } from "./qrScan";
import { explainError } from "./useKleioRemote";

/**
 * The iPhone: Scan QR code, for the ticket `kleio-host pair` shows. The
 * scanned text goes to `onTicket`, as a pasted ticket does. A failed or
 * denied scan says why here, and the rest of the form stays as it was.
 */
export function TicketScan({
  busy,
  onTicket,
}: {
  busy: boolean;
  onTicket: (text: string) => void;
}): React.ReactElement {
  const { scanning, error, start } = usePairingScan(onTicket);
  return (
    <div className="kleio-ticket-scan">
      <button
        type="button"
        className="btn kleio-scan-btn"
        disabled={busy || scanning}
        onClick={() => void start()}
      >
        <QrCodeIcon size={18} aria-hidden="true" />
        {scanning ? "Scanning…" : "Scan QR code"}
      </button>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {scanning && <ScanOverlay />}
    </div>
  );
}

/**
 * Over the camera while a scan runs: the page goes see-through so the
 * camera shows, with a frame to aim at and a way out.
 */
function ScanOverlay(): React.ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("kleio-scanning");
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") cancelScan();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.classList.remove("kleio-scanning");
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return createPortal(
    <div className="kleio-scan-overlay" role="dialog" aria-modal="true" aria-label="Scan QR code">
      <p className="kleio-scan-title">Point the camera at the pairing QR code.</p>
      <div className="kleio-scan-frame" aria-hidden="true" />
      <button
        ref={cancelRef}
        type="button"
        className="btn kleio-scan-cancel"
        onClick={() => cancelScan()}
      >
        <XIcon size={16} aria-hidden="true" />
        Cancel
      </button>
    </div>,
    document.body,
  );
}

/** What each pairing step shows while it runs (PairStage::text in pair.rs). */
export const PAIR_STAGE_TEXT: Record<PairStage, string> = {
  relay: "Reaching the relay…",
  host: "Finding your host…",
  pairing: "Pairing…",
};

/** What pairing says on a device with no network at all. */
export function pairingOffline(device: "iPhone" | "Mac"): string {
  return `This ${device} is offline. Connect it to the internet, then try again.`;
}

/**
 * Whether the pairing form takes pasted pairing text: always on the Mac,
 * which has no camera to scan with, and in the iPhone's debug builds, as the
 * simulator has none either.
 */
export function takesPairingText(link: LinkStatus): boolean {
  return !isPhone() || link.debugBuild;
}

/**
 * Paste pairing text: the ticket that `kleio-host pair`, and an admin's Pair a
 * device (PairingOffer.tsx), give as text beside its QR code. Where
 * `takesPairingText` says.
 */
export function TicketPaste({
  busy,
  onTicket,
}: {
  busy: boolean;
  onTicket: (text: string) => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  // On the iPhone, only a debug build has it.
  const phone = isPhone();
  return (
    <div className="kleio-ticket-paste">
      <label className="modal-label" htmlFor="kleio-ticket">
        Paste pairing text
        {phone && <span className="kleio-tag">debug build</span>}
      </label>
      <textarea
        id="kleio-ticket"
        className="modal-input kleio-ticket"
        rows={3}
        placeholder='{"v":4,"type":"kleio-pair",…}'
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
      />
      <div className="modal-row">
        <span className="modal-hint kleio-inline-hint">
          {phone ? (
            <>
              The pairing text <code>kleio-host pair</code> prints, in place of scanning its QR
              code.
            </>
          ) : (
            <>
              Copy it from Pair a device, in Settings → Connection on your admin device, or from
              what <code>kleio-host pair</code> prints on your host. It pairs over Kleio&apos;s
              link, with no Tailscale needed.
            </>
          )}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || text.trim() === ""}
          onClick={() => onTicket(text)}
        >
          Use pairing text
        </button>
      </div>
    </div>
  );
}

/**
 * A link ticket's confirm step: the host it names, then Pair over the link,
 * which shows each step as it begins and says why if it fails. A device with
 * no network at all doesn't dial. `onPaired` gets the link's status after
 * pairing (`null` if it couldn't be read): `active` says the pairing switched
 * on in place.
 */
export function LinkConfirm({
  ticket,
  check,
  label,
  onLabel,
  onBack,
  onPaired,
}: {
  ticket: string;
  check: TicketCheck;
  label: string;
  onLabel: (label: string) => void;
  onBack: () => void;
  onPaired: (now: LinkStatus | null) => Promise<void> | void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<PairStage>("relay");
  const [error, setError] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const device = isPhone() ? "iPhone" : "Mac";

  // The step replaces the focused button: focus the safe choice.
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const pair = useCallback(async () => {
    setError(null);
    // With no network at all, nothing would answer: say so, not why a dial failed.
    if (!navigator.onLine) {
      setError(pairingOffline(device));
      return;
    }
    setBusy(true);
    setStage("relay");
    try {
      // Pairs and switches the pairing on, as pair + activatePairing do.
      await kleioLink.pair(ticket, label, setStage);
      await onPaired(await kleioLink.status().catch(() => null));
    } catch (e) {
      // Gone offline on the way: that's why it failed, whatever the link saw.
      setError(navigator.onLine ? explainError(e) : pairingOffline(device));
    } finally {
      setBusy(false);
    }
  }, [ticket, label, onPaired, device]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void pair();
      }}
    >
      <p className="modal-hint">
        Pair over the Kleio link with this host? Check the pair code matches the one shown with the
        QR code or pairing text.
      </p>
      <dl className="kleio-facts">
        <dt>Host</dt>
        <dd>{check.name}</dd>
        <dt>Host key</dt>
        <dd>
          <code>{check.keyPrefix}…</code>
        </dd>
        <dt>Relay</dt>
        <dd>
          <code>{check.relayHost}</code>
        </dd>
        <dt>Pair code</dt>
        <dd>
          <code className="kleio-code">{check.code}</code>
        </dd>
      </dl>
      <label className="modal-label" htmlFor="kleio-link-label">
        This device&apos;s name
      </label>
      <input
        id="kleio-link-label"
        className="modal-input"
        placeholder={isPhone() ? "iPhone" : "Laptop"}
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        maxLength={64}
        disabled={busy}
      />
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {/* There before it speaks, so a screen reader hears each step. */}
      <p className="sr-only" role="status">
        {busy ? PAIR_STAGE_TEXT[stage] : ""}
      </p>
      <div className="modal-actions">
        <button ref={backRef} type="button" className="btn" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? PAIR_STAGE_TEXT[stage] : "Pair"}
        </button>
      </div>
    </form>
  );
}
