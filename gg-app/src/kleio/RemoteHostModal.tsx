// Remote host pane (⌘⇧K). Three faces:
//   not paired  → enter host URL + pair code → "Restart to connect"
//   paired      → where you are, forget host
//   paired admin→ + Devices tab: list (New marks a device paired this week) /
//                  Revoke this device / a pair code for another device, with its
//                  QR code and pairing text (PairingOffer.tsx)
// Pairing and forgetting take effect on the next launch: the host base URL and
// auth headers are baked into the shared HTTP client at boot, the same way an
// update is applied — so the pane offers the same Restart button. The iPhone
// cannot relaunch itself, so there a first pairing switches on in place and
// the pane just closes into the app.
//
// Kleio's link (Rust: kleio/link.rs, macOS and iOS): the iPhone scans the
// pairing QR code, the Mac takes its pairing text pasted in, and a link ticket
// pairs over the Kleio link instead, after a confirm step that shows the
// host's name, key, relay and the code. The iPhone's debug builds also take
// pasted pairing text, as the simulator has no camera. Windows and Linux
// builds, which have no link, show none of it.

import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopIcon, DeviceMobileIcon } from "@phosphor-icons/react";
import { Badge } from "../Badge";
import { Modal } from "../Modal";
import { isPhone } from "../platform";
import { theme } from "../theme";
import { kleioLink, useKleioLink, type TicketCheck } from "./kleioLink";
import { LinkConfirm, takesPairingText, TicketPaste, TicketScan } from "./LinkPairing";
import { ForgetHost } from "./ForgetHost";
import { PairingOffer } from "./PairingOffer";
import { readTicket } from "./pairTicket";
import { relTime } from "./relTime";
import { RestartNotice, UrlPairFields } from "./UrlPairing";
import {
  explainError,
  isNewDevice,
  kleio,
  useKleioRemote,
  type ActiveRemote,
  type AdminState,
  type Device,
  type HostRecord,
  type PairOffer,
} from "./useKleioRemote";

type Tab = "host" | "devices";

export function RemoteHostModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { status, refresh } = useKleioRemote();
  const [tab, setTab] = useState<Tab>("host");
  const paired = status?.paired ?? null;
  const active = status?.active ?? null;
  const canAdmin = Boolean(active?.admin);
  // A pending change is on disk but not what we booted with.
  const pending =
    status !== null &&
    ((paired === null) !== (active === null) ||
      (paired !== null && active !== null && paired.deviceId !== active.deviceId));

  return (
    <Modal
      title={
        <span className="kleio-title">
          <span>Kleio host</span>
          {canAdmin && (
            <span className="brain-tabs" role="tablist" aria-label="Kleio host sections">
              <button
                type="button"
                role="tab"
                id="kleio-tab-host"
                aria-selected={tab === "host"}
                aria-controls="kleio-panel"
                tabIndex={tab === "host" ? 0 : -1}
                onClick={() => setTab("host")}
              >
                Host
              </button>
              <button
                type="button"
                role="tab"
                id="kleio-tab-devices"
                aria-selected={tab === "devices"}
                aria-controls="kleio-panel"
                tabIndex={tab === "devices" ? 0 : -1}
                onClick={() => setTab("devices")}
              >
                Devices
              </button>
            </span>
          )}
        </span>
      }
      onClose={onClose}
      className="kleio-modal"
    >
      <div
        id="kleio-panel"
        role={canAdmin ? "tabpanel" : undefined}
        aria-labelledby={canAdmin ? `kleio-tab-${tab}` : undefined}
      >
        {status === null ? (
          <p className="modal-hint">Checking…</p>
        ) : tab === "devices" && canAdmin ? (
          <DevicesPanel selfId={active?.deviceId ?? ""} baseUrl={active?.base ?? null} />
        ) : paired ? (
          <PairedPanel paired={paired} active={active} pending={pending} onForgot={refresh} />
        ) : (
          <PairPanel pending={pending} onPaired={refresh} onActive={onClose} />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- not paired

function PairPanel({
  pending,
  onPaired,
  onActive,
}: {
  pending: boolean;
  onPaired: () => Promise<void>;
  /** The pairing switched on in place (iPhone): leave the pane for the app. */
  onActive: () => void;
}): React.ReactElement {
  const [baseUrl, setBaseUrl] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kleio's link, when this build has it (macOS and iOS).
  const { link } = useKleioLink();
  const [linkTicket, setLinkTicket] = useState<{ ticket: string; check: TicketCheck } | null>(null);

  // A scanned or pasted ticket: v2 fills the form, a link ticket asks to
  // confirm the host.
  const openTicket = useCallback(
    async (text: string) => {
      setError(null);
      const route = readTicket(text);
      if (route.kind === "invalid") {
        setError(route.error);
      } else if (route.kind === "v2") {
        setBaseUrl(route.baseUrl);
        setCode(route.code);
      } else if (!link) {
        setError("This build of Kleio can't pair over the Kleio link.");
      } else {
        setBusy(true);
        try {
          setLinkTicket({ ticket: route.ticket, check: await kleioLink.checkTicket(route.ticket) });
        } catch (e) {
          setError(explainError(e));
        } finally {
          setBusy(false);
        }
      }
    },
    [link],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await kleio.pair(baseUrl, code, label);
      const activation = await kleio.activatePairing();
      await onPaired();
      if (activation === "active") onActive();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }, [baseUrl, code, label, onPaired, onActive]);

  if (pending) return <RestartNotice what="You just forgot the host." />;
  if (linkTicket) {
    return (
      <LinkConfirm
        ticket={linkTicket.ticket}
        check={linkTicket.check}
        label={label}
        onLabel={setLabel}
        onBack={() => setLinkTicket(null)}
        onPaired={async (now) => {
          await onPaired();
          if (now?.active) onActive();
        }}
      />
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="modal-hint">
        Run <code>kleio-host pair</code> on the host to get a 6-character code. Sessions will run
        there instead of on this {thisDevice()}.
      </p>
      <UrlPairFields
        baseUrl={baseUrl}
        code={code}
        label={label}
        onBaseUrl={setBaseUrl}
        onCode={setCode}
        onLabel={setLabel}
        busy={busy}
        initialFocus
      />
      {link && isPhone() && <TicketScan busy={busy} onTicket={(text) => void openTicket(text)} />}
      {link && takesPairingText(link) && (
        <TicketPaste busy={busy} onTicket={(text) => void openTicket(text)} />
      )}
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !baseUrl || !code}>
          {busy ? "Pairing…" : "Pair"}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------- paired

function PairedPanel({
  paired,
  active,
  pending,
  onForgot,
}: {
  paired: HostRecord;
  active: ActiveRemote | null;
  pending: boolean;
  onForgot: () => Promise<void>;
}): React.ReactElement {
  return (
    <>
      {pending && <RestartNotice what="Paired." />}
      <dl className="kleio-facts">
        <dt>Host</dt>
        <dd>
          <code>{paired.baseUrl}</code>
        </dd>
        <dt>This device</dt>
        <dd>
          {paired.label}
          {paired.admin && <span className="kleio-tag">admin</span>}
        </dd>
        <dt>Device id</dt>
        <dd>
          <code>{paired.deviceId}</code>
        </dd>
        <dt>Paired</dt>
        <dd>{new Date(paired.pairedAt).toLocaleString()}</dd>
        <dt>Status</dt>
        <dd>{active ? "Connected — sessions run on the host" : "Not active until restart"}</dd>
      </dl>
      <ForgetHost onForgot={onForgot} />
    </>
  );
}

/** "Mac" or "iPhone" — the device Kleio is running on, for copy. */
function thisDevice(): string {
  return isPhone() ? "iPhone" : "Mac";
}

// ------------------------------------------------------------------ devices

function DevicesPanel({
  selfId,
  baseUrl,
}: {
  selfId: string;
  /** The address this device reaches the host at, for PairingOffer. */
  baseUrl: string | null;
}): React.ReactElement {
  const [devices, setDevices] = useState<Device[] | null>(null);
  /** When the list was loaded: what New is measured from. */
  const [readAt, setReadAt] = useState(0);
  const [admin, setAdmin] = useState<AdminState | null>(null);
  const [offer, setOffer] = useState<PairOffer | null>(null);
  const [offerAdmin, setOfferAdmin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const loaded = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  // The confirm replaces the focused Remove button: focus the safe choice.
  useEffect(() => {
    if (confirmRevoke) keepRef.current?.focus();
  }, [confirmRevoke]);

  // Removing, confirming or locking can take away the focused button. When
  // focus drops to the page, put it back on the dialog so it stays inside.
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    panelRef.current?.closest<HTMLElement>("[role='dialog']")?.focus();
  });

  const run = useCallback(async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setRemoved(null);
    try {
      await fn();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
      kleio.adminState().then(setAdmin, () => undefined);
    }
  }, []);

  const load = useCallback(
    () =>
      run("load", async () => {
        setDevices(await kleio.devices());
        setReadAt(Date.now());
      }),
    [run],
  );

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    kleio.adminState().then(setAdmin, () => undefined);
    void load();
  }, [load]);

  const revoke = (device: Device) =>
    run(`revoke:${device.deviceId}`, async () => {
      setDevices(await kleio.revoke(device.deviceId));
      setConfirmRevoke(null);
      setRemoved(`${device.label} revoked.`);
    });

  const mint = () =>
    run("offer", async () => {
      setOffer(await kleio.offer(offerAdmin));
    });
  const offerDone = useCallback(() => setOffer(null), []);

  const lock = () =>
    run("lock", async () => {
      await kleio.adminLock();
      setDevices(null);
      setOffer(null);
    });

  // Revoked devices can't connect again, so the list shows only live ones
  // (as Settings → Connection does).
  const live = (devices ?? []).filter((d) => !d.revoked);

  return (
    <div ref={panelRef}>
      <div className="kleio-admin-bar">
        {admin?.unlocked ? (
          <>
            <span className="modal-hint kleio-inline-hint">
              Admin unlocked until{" "}
              {admin.expiresAt ? new Date(admin.expiresAt).toLocaleTimeString() : "—"}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void lock()}
              disabled={busy !== null}
            >
              Lock
            </button>
          </>
        ) : (
          <span className="modal-hint kleio-inline-hint">
            {admin && !admin.available
              ? "Touch ID isn't available on this Mac; admin actions are locked."
              : "Admin actions ask for Touch ID, then stay unlocked for 15 minutes."}
          </span>
        )}
      </div>

      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {removed && (
        <p className="modal-hint" role="status">
          {removed}
        </p>
      )}

      {devices === null ? (
        <p className="modal-hint">
          {busy === "load" ? "Loading devices…" : "Devices not loaded."}{" "}
          {busy !== "load" && (
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              Load
            </button>
          )}
        </p>
      ) : live.length === 0 ? (
        <p className="modal-hint">No devices paired.</p>
      ) : (
        <ul className="conn-devices kleio-device-list">
          {live.map((d) => (
            <li key={d.deviceId} className="conn-device">
              <span className="conn-device-icon" aria-hidden="true">
                {/iphone|ipad|phone/i.test(d.label) ? (
                  <DeviceMobileIcon size={18} weight="duotone" />
                ) : (
                  <DesktopIcon size={18} weight="duotone" />
                )}
              </span>
              <span className="conn-device-main">
                <span className="conn-device-name">
                  {d.label}
                  {d.deviceId === selfId && <Badge className="conn-inline-badge">This Mac</Badge>}
                  {isNewDevice(d, selfId, readAt) && (
                    <Badge color={theme.info} className="conn-inline-badge">
                      New
                    </Badge>
                  )}
                  {d.admin && (
                    <Badge color={theme.warning} className="conn-inline-badge">
                      Admin
                    </Badge>
                  )}
                </span>
                <span className="conn-device-sub">
                  {d.lastSeen ? `Active ${relTime(d.lastSeen)}` : `Paired ${relTime(d.created)}`}
                </span>
              </span>
              {d.deviceId !== selfId &&
                (confirmRevoke === d.deviceId ? (
                  <span className="conn-inline-confirm">
                    <button
                      ref={keepRef}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setConfirmRevoke(null)}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy !== null}
                      onClick={() => void revoke(d)}
                    >
                      {busy === `revoke:${d.deviceId}` ? "Revoking…" : "Revoke"}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={`Revoke this device: ${d.label}`}
                    disabled={busy !== null}
                    onClick={() => setConfirmRevoke(d.deviceId)}
                  >
                    Revoke this device
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}

      <div className="kleio-offer">
        <div className="kleio-offer-row">
          <label className="modal-radio">
            <input
              type="checkbox"
              checked={offerAdmin}
              onChange={(e) => setOfferAdmin(e.target.checked)}
              disabled={busy !== null}
            />
            Make the new device an admin
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => void mint()}
          >
            {busy === "offer" ? "Minting…" : "New pair code"}
          </button>
        </div>
        {/* There before it speaks, so a screen reader hears a new code. The
            countdown below stays out of it, or it would speak every second. */}
        <p className="sr-only" role="status">
          {offer ? `Pair code ${offer.display} is ready.` : ""}
        </p>
        {offer && <PairingOffer offer={offer} baseUrl={baseUrl} onDone={offerDone} />}
      </div>
    </div>
  );
}
