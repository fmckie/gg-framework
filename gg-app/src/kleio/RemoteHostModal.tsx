// Remote host pane (⌘⇧K). Three faces:
//   not paired  → enter host URL + pair code → "Restart to connect"
//   paired      → where you are, forget host
//   paired admin→ + Devices tab: list / revoke / mint a code for another device
// Pairing and forgetting take effect on the next launch: the host base URL and
// auth headers are baked into the shared HTTP client at boot, the same way an
// update is applied — so the pane offers the same Restart button.

import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { Modal } from "../Modal";
import {
  explainError,
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
          <DevicesPanel selfId={active?.deviceId ?? ""} />
        ) : paired ? (
          <PairedPanel paired={paired} active={active} pending={pending} onForgot={refresh} />
        ) : (
          <PairPanel pending={pending} onPaired={refresh} />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- not paired

function PairPanel({
  pending,
  onPaired,
}: {
  pending: boolean;
  onPaired: () => Promise<void>;
}): React.ReactElement {
  const [baseUrl, setBaseUrl] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await kleio.pair(baseUrl, code, label);
      await onPaired();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }, [baseUrl, code, label, onPaired]);

  if (pending) return <RestartNotice what="You just forgot the host." />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="modal-hint">
        Run <code>kleio-host pair</code> on the host to get a 6-character code. Sessions will run
        there instead of on this Mac.
      </p>
      <label className="modal-label" htmlFor="kleio-url">
        Host URL
      </label>
      <input
        id="kleio-url"
        className="modal-input"
        data-modal-initial-focus
        placeholder="https://mac-mini-1.your-tailnet.ts.net:8443"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
        required
      />
      <div className="modal-row">
        <div>
          <label className="modal-label" htmlFor="kleio-code">
            Pair code
          </label>
          <input
            id="kleio-code"
            className="modal-input kleio-code"
            placeholder="ABC-DEF"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={7}
            disabled={busy}
            required
          />
        </div>
        <div>
          <label className="modal-label" htmlFor="kleio-label">
            This device&apos;s name
          </label>
          <input
            id="kleio-label"
            className="modal-input"
            placeholder="Laptop"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={64}
            disabled={busy}
          />
        </div>
      </div>
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
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forget = useCallback(async () => {
    setError(null);
    try {
      await kleio.forget();
      await onForgot();
    } catch (e) {
      setError(explainError(e));
    }
  }, [onForgot]);

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
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {confirm ? (
          <>
            <span className="modal-hint kleio-inline-hint">
              Sessions go back to running on this Mac after a restart. The host still lists this
              device until an admin revokes it.
            </span>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void forget()}>
              Forget host
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            Forget host…
          </button>
        )}
      </div>
    </>
  );
}

function RestartNotice({ what }: { what: string }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <div className="kleio-restart" role="status">
      <span>{what} Restart gg-app to apply — every window comes back where it was.</span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void relaunch();
        }}
      >
        {busy ? "Restarting…" : "Restart now"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ devices

function DevicesPanel({ selfId }: { selfId: string }): React.ReactElement {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [admin, setAdmin] = useState<AdminState | null>(null);
  const [offer, setOffer] = useState<PairOffer | null>(null);
  const [offerAdmin, setOfferAdmin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const loaded = useRef(false);

  const run = useCallback(async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
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
      }),
    [run],
  );

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    kleio.adminState().then(setAdmin, () => undefined);
    void load();
  }, [load]);

  const revoke = (id: string) =>
    run(`revoke:${id}`, async () => {
      setDevices(await kleio.revoke(id));
      setConfirmRevoke(null);
    });

  const mint = () =>
    run("offer", async () => {
      setOffer(await kleio.offer(offerAdmin));
    });

  const lock = () =>
    run("lock", async () => {
      await kleio.adminLock();
      setDevices(null);
      setOffer(null);
    });

  return (
    <>
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

      {devices === null ? (
        <p className="modal-hint">
          {busy === "load" ? "Loading devices…" : "Devices not loaded."}{" "}
          {busy !== "load" && (
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              Load
            </button>
          )}
        </p>
      ) : (
        <table className="kleio-devices">
          <thead>
            <tr>
              <th>Device</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const isSelf = d.deviceId === selfId;
              return (
                <tr key={d.deviceId} className={d.revoked ? "revoked" : undefined}>
                  <td>
                    {d.label}
                    {isSelf && <span className="kleio-tag">this Mac</span>}
                    {d.admin && <span className="kleio-tag">admin</span>}
                    {d.revoked && <span className="kleio-tag">revoked</span>}
                    <div className="kleio-devid">
                      <code>{d.deviceId}</code>
                    </div>
                  </td>
                  <td>{d.lastSeen ? relTime(d.lastSeen) : "never"}</td>
                  <td className="kleio-actions">
                    {d.revoked ? null : isSelf ? (
                      <span
                        className="modal-hint"
                        title="Use “Forget host” on the Host tab instead."
                      >
                        —
                      </span>
                    ) : confirmRevoke === d.deviceId ? (
                      <>
                        <button
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
                          onClick={() => void revoke(d.deviceId)}
                        >
                          {busy === `revoke:${d.deviceId}` ? "Revoking…" : "Revoke"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy !== null}
                        onClick={() => setConfirmRevoke(d.deviceId)}
                      >
                        Revoke…
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
        {offer && (
          <div className="kleio-offer-code" role="status">
            <code>{offer.display}</code>
            <span className="modal-hint">
              {offer.admin ? "admin · " : ""}expires {relTime(offer.expiresAt)}. Enter it on the
              other device with this host&apos;s URL.
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/** "3 min ago" / "in 4 min" — enough for last-seen and expiry. */
export function relTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  const unit =
    abs < 60
      ? `${abs}s`
      : abs < 3600
        ? `${Math.round(abs / 60)} min`
        : abs < 86_400
          ? `${Math.round(abs / 3600)} h`
          : `${Math.round(abs / 86_400)} d`;
  return s < 0 ? `${unit} ago` : `in ${unit}`;
}
