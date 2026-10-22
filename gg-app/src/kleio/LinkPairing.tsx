// The connection prototype's pairing steps (Rust feature `kleio-link`),
// shared by the pairing form (RemoteHostModal) and the Link card on the
// Connection page: scanning the pairing QR code on the iPhone, a pasted ticket
// in debug builds, and a v3 ticket's confirm step, which pairs over the Kleio
// link.

import { QrCodeIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isPhone } from "../platform";
import { kleioLink, type LinkStatus, type TicketCheck } from "./kleioLink";
import { cancelScan, usePairingScan } from "./qrScan";
import { explainError } from "./useKleioRemote";

/**
 * The iPhone: Scan QR code, for the ticket `kleio-link-host qr` shows. The
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

/** Debug builds: a pasted ticket, for a device without a camera. */
export function TicketPaste({
  busy,
  onTicket,
}: {
  busy: boolean;
  onTicket: (text: string) => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  return (
    <div className="kleio-ticket-paste">
      <label className="modal-label" htmlFor="kleio-ticket">
        Pairing ticket
        <span className="kleio-tag">debug build</span>
      </label>
      <textarea
        id="kleio-ticket"
        className="modal-input kleio-ticket"
        rows={3}
        placeholder='{"v":3,"type":"kleio-pair",…}'
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
      />
      <div className="modal-row">
        <span className="modal-hint kleio-inline-hint">
          The JSON <code>kleio-link-host qr</code> prints, in place of scanning its QR code.
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || text.trim() === ""}
          onClick={() => onTicket(text)}
        >
          Use ticket
        </button>
      </div>
    </div>
  );
}

/**
 * A v3 ticket's confirm step: the host it names, then Pair over the link.
 * `onPaired` gets the link's status after pairing (`null` if it couldn't be
 * read): `active` says the pairing switched on in place.
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
  const [error, setError] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  // The step replaces the focused button: focus the safe choice.
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const pair = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Pairs and switches the pairing on, as pair + activatePairing do.
      await kleioLink.pair(ticket, label);
      await onPaired(await kleioLink.status().catch(() => null));
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }, [ticket, label, onPaired]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void pair();
      }}
    >
      <p className="modal-hint">
        Pair over the Kleio link with this host? Check it matches what{" "}
        <code>kleio-link-host qr</code> printed there.
      </p>
      <dl className="kleio-facts">
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
      <div className="modal-actions">
        <button ref={backRef} type="button" className="btn" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Pairing…" : "Pair"}
        </button>
      </div>
    </form>
  );
}
