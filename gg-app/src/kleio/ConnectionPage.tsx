// Settings → Connection: how this Mac, the Mac mini (the Kleio host) and the
// Kleio iPhone app reach each other. Everything runs on the Mac mini; this Mac
// and the phone are windows onto it, joined privately over Tailscale.
//
// - Mac mini: is the host answering, how fast, is its engine up.
// - Tailscale: is the private network up here, and can it see the Mac mini.
// - iPhone: a one-time pairing QR the Kleio iPhone app scans (admin).
// - Devices: every paired device, with revoke (admin).
//
// Replaces upstream's Telegram "Remote" page: the iPhone app is Kleio's remote.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  DesktopIcon,
  DeviceMobileIcon,
  HardDrivesIcon,
  LockSimpleIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { Badge } from "../Badge";
import { SettingsCard } from "../settings-section";
import { SettingsHeaderAction, SettingsHeaderStatus } from "../settings-header";
import { theme } from "../theme";
import { toast } from "../toast";
import { hostHealth, type HostHealth } from "./kleioApi";
import { pairTicket } from "./pairTicket";
import { encodeQr, qrSvgPath, type QrResult } from "./qr";
import { relTime } from "./relTime";
import {
  explainError,
  kleio,
  useKleioRemote,
  type Device,
  type PairOffer,
  type TailscaleNode,
  type TailscaleStatus,
} from "./useKleioRemote";

const REFRESH_MS = 15_000;
const QR_QUIET_ZONE = 4;

type Load<T> = { state: "loading" } | { state: "ok"; value: T } | { state: "error"; error: string };

export function shortName(host: string): string {
  return host.split(".")[0] ?? host;
}

/** "12 ms" / "1.2 s": how quick the Mac mini answered. */
export function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Plain words for how this Mac reaches a tailnet peer. */
export function describeRoute(node: TailscaleNode): string {
  if (!node.online) return node.lastSeen ? `Offline · seen ${relTime(node.lastSeen)}` : "Offline";
  if (node.direct) return "Online · direct connection";
  return node.relay ? `Online · via relay (${node.relay.toUpperCase()})` : "Online";
}

export function ConnectionPage(): React.ReactElement {
  const { status, refresh: refreshRemote } = useKleioRemote();
  const active = status?.active ?? null;
  const paired = status?.paired ?? null;
  const [health, setHealth] = useState<Load<HostHealth>>({ state: "loading" });
  const [net, setNet] = useState<Load<TailscaleStatus>>({ state: "loading" });
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    const [h, t] = await Promise.allSettled([hostHealth(), kleio.tailscale()]);
    if (!alive.current) return;
    setHealth(
      h.status === "fulfilled"
        ? { state: "ok", value: h.value }
        : { state: "error", error: explainError(h.reason) },
    );
    setNet(
      t.status === "fulfilled"
        ? { state: "ok", value: t.value }
        : { state: "error", error: explainError(t.reason) },
    );
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [check]);

  const hostUp = health.state === "ok" && health.value.sidecar === "up";
  const hostLabel = shortName(active?.host ?? paired?.host ?? "Mac mini");
  const headline =
    health.state === "loading"
      ? { text: "Checking…", color: undefined }
      : hostUp
        ? { text: "Connected", color: theme.success }
        : health.state === "ok"
          ? { text: "Engine starting", color: theme.warning }
          : { text: "Can't reach", color: theme.error };

  return (
    <>
      <SettingsHeaderStatus>
        <Badge color={headline.color}>{headline.text}</Badge>
      </SettingsHeaderStatus>
      <SettingsHeaderAction>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={checking}
          onClick={() => void check()}
        >
          <ArrowClockwiseIcon size={14} weight="bold" aria-hidden="true" />
          {checking ? "Checking…" : "Check again"}
        </button>
      </SettingsHeaderAction>

      <ConnectionMap
        hostLabel={hostLabel}
        hostUp={hostUp}
        hostKnown={health.state !== "loading"}
        net={net.state === "ok" ? net.value : null}
      />

      <div className="settings-cols">
        <div className="settings-col">
          <SettingsCard
            title="Mac mini"
            description="Kleio's brain lives here. Chats, agents and code all run on it, so they keep going when this Mac sleeps."
          >
            <dl className="conn-facts">
              <Fact label="Address">
                <code className="conn-code">{active?.base ?? paired?.baseUrl ?? "Not paired"}</code>
              </Fact>
              <Fact label="Status">
                {health.state === "loading" ? (
                  "Checking…"
                ) : health.state === "error" ? (
                  <span className="conn-bad">{health.error}</span>
                ) : (
                  <span className={hostUp ? "conn-good" : "conn-warn"}>
                    {hostUp
                      ? "Online and ready"
                      : health.value.sidecar === "stale"
                        ? "Online · engine restarting"
                        : "Online · engine stopped"}
                  </span>
                )}
              </Fact>
              {health.state === "ok" && (
                <Fact label="Response">{formatLatency(health.value.latencyMs)}</Fact>
              )}
              <Fact label="This Mac">
                {active ? (
                  <>
                    “{active.label}”
                    {active.admin && (
                      <Badge color={theme.warning} className="conn-inline-badge">
                        Admin
                      </Badge>
                    )}
                  </>
                ) : (
                  "Not paired"
                )}
              </Fact>
              {paired && <Fact label="Paired">{relTime(paired.pairedAt)}</Fact>}
            </dl>
          </SettingsCard>

          <TailscaleCard net={net} hostLabel={hostLabel} />
        </div>

        <div className="settings-col">
          <PhoneCard
            baseUrl={active?.base ?? null}
            admin={active?.admin ?? false}
            onPaired={() => void check()}
          />
          <DevicesCard
            admin={active?.admin ?? false}
            selfId={active?.deviceId ?? null}
            onChanged={() => {
              void refreshRemote();
              void check();
            }}
          />
        </div>
      </div>
    </>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="conn-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ─── the map: this Mac ── Tailscale ── Mac mini ── Tailscale ── iPhone ──────

function ConnectionMap({
  hostLabel,
  hostUp,
  hostKnown,
  net,
}: {
  hostLabel: string;
  hostUp: boolean;
  hostKnown: boolean;
  net: TailscaleStatus | null;
}): React.ReactElement {
  const macLinkUp = hostUp || (net?.running === true && net.host?.online === true);
  const hostState = !hostKnown ? "is-unknown" : hostUp ? "is-up" : "is-down";
  return (
    <section className="conn-map" aria-label="How your devices connect">
      <MapNode
        icon={<DesktopIcon size={26} weight="duotone" aria-hidden="true" />}
        name="This Mac"
        detail={net?.self?.name ?? "Kleio Desktop"}
        state={net ? (net.running ? "is-up" : "is-down") : "is-unknown"}
      />
      <MapLink up={macLinkUp} known={hostKnown} label="Tailscale" />
      <MapNode
        icon={<HardDrivesIcon size={30} weight="duotone" aria-hidden="true" />}
        name={hostLabel}
        detail="Kleio host"
        state={hostState}
        hub
      />
      <MapLink up={hostUp} known={hostKnown} label="Tailscale" />
      <MapNode
        icon={<DeviceMobileIcon size={26} weight="duotone" aria-hidden="true" />}
        name="iPhone"
        detail="Kleio app"
        state="is-idle"
      />
    </section>
  );
}

function MapNode({
  icon,
  name,
  detail,
  state,
  hub = false,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  state: "is-up" | "is-down" | "is-unknown" | "is-idle";
  hub?: boolean;
}): React.ReactElement {
  return (
    <div className={`conn-node ${state}${hub ? " is-hub" : ""}`}>
      <span className="conn-node-icon">
        {icon}
        <span className="conn-node-dot" aria-hidden="true" />
      </span>
      <span className="conn-node-name">{name}</span>
      <span className="conn-node-detail">{detail}</span>
    </div>
  );
}

function MapLink({
  up,
  known,
  label,
}: {
  up: boolean;
  known: boolean;
  label: string;
}): React.ReactElement {
  return (
    <div
      className={`conn-link ${!known ? "is-unknown" : up ? "is-up" : "is-down"}`}
      aria-hidden="true"
    >
      <span className="conn-link-line" />
      <span className="conn-link-label">
        <LockSimpleIcon size={11} weight="bold" />
        {label}
      </span>
    </div>
  );
}

// ─── Tailscale ──────────────────────────────────────────────────────────────

function TailscaleCard({
  net,
  hostLabel,
}: {
  net: Load<TailscaleStatus>;
  hostLabel: string;
}): React.ReactElement {
  return (
    <SettingsCard
      title="Tailscale"
      description="The private network between your devices. Nothing is open to the internet."
    >
      {net.state === "loading" ? (
        <p className="settings-desc">Checking Tailscale on this Mac…</p>
      ) : net.state === "error" ? (
        <p className="conn-bad">{net.error}</p>
      ) : !net.value.installed ? (
        <p className="settings-desc">
          {net.value.error} Install it from tailscale.com and sign in with the same account as your
          Mac mini.
        </p>
      ) : (
        <dl className="conn-facts">
          <Fact label="This Mac">
            {net.value.running ? (
              <span className="conn-good">
                Connected{net.value.self ? ` as ${net.value.self.name}` : ""}
              </span>
            ) : (
              <span className="conn-bad">{net.value.error ?? "Not connected"}</span>
            )}
          </Fact>
          {net.value.tailnet && <Fact label="Network">{net.value.tailnet}</Fact>}
          {net.value.running && (
            <Fact label={hostLabel}>
              {net.value.host ? (
                <span className={net.value.host.online ? "conn-good" : "conn-bad"}>
                  {describeRoute(net.value.host)}
                </span>
              ) : (
                <span className="conn-warn">Not found on this network</span>
              )}
            </Fact>
          )}
          {net.value.host?.ip && (
            <Fact label="Private IP">
              <code className="conn-code">{net.value.host.ip}</code>
            </Fact>
          )}
          {net.value.version && <Fact label="Version">{net.value.version.split("-")[0]}</Fact>}
        </dl>
      )}
      {net.state === "ok" && net.value.health.length > 0 && (
        <ul className="conn-health">
          {net.value.health.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

// ─── the iPhone: a one-time pairing QR ──────────────────────────────────────

function PhoneCard({
  baseUrl,
  admin,
  onPaired,
}: {
  baseUrl: string | null;
  admin: boolean;
  onPaired: () => void;
}): React.ReactElement {
  const [offer, setOffer] = useState<PairOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!offer) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [offer]);

  const expired = offer ? offer.expiresAt <= now : false;
  useEffect(() => {
    if (!expired) return;
    setOffer(null);
    onPaired();
  }, [expired, onPaired]);

  const ticket = useMemo((): QrResult | null => {
    if (!offer || !baseUrl) return null;
    const t = pairTicket(baseUrl, offer.display);
    return t.ok ? encodeQr(t.value) : t;
  }, [offer, baseUrl]);

  async function mint(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setOffer(await kleio.offer(false));
      setNow(Date.now());
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  const secondsLeft = offer ? Math.max(0, Math.round((offer.expiresAt - now) / 1000)) : 0;

  return (
    <SettingsCard
      title="iPhone"
      description="Pair the Kleio iPhone app with your Mac mini. Your phone needs Tailscale too."
    >
      {!admin ? (
        <p className="settings-desc">
          Only an admin Mac can pair a new phone. On the Mac mini, run{" "}
          <code className="conn-code">kleio-host pair</code> and type the code on your phone.
        </p>
      ) : offer && ticket?.ok ? (
        <div className="conn-pair">
          <svg
            className="conn-qr"
            viewBox={`0 0 ${ticket.value.size + QR_QUIET_ZONE * 2} ${ticket.value.size + QR_QUIET_ZONE * 2}`}
            role="img"
            aria-label={`Pairing QR code for pair code ${offer.display}`}
            shapeRendering="crispEdges"
          >
            <rect width="100%" height="100%" fill="#fff" />
            <path d={qrSvgPath(ticket.value, QR_QUIET_ZONE)} fill="#000" />
          </svg>
          <div className="conn-pair-text">
            <ol className="conn-steps">
              <li>
                Open Kleio on your iPhone and tap <strong>Pair a host</strong>.
              </li>
              <li>
                Tap <strong>Scan QR code</strong>, then <strong>Scan with camera</strong>.
              </li>
              <li>Point it at this code.</li>
            </ol>
            <p className="settings-desc">
              Or type <code className="conn-pair-code">{offer.display}</code>
            </p>
            <p className="conn-expiry">
              Works once · expires in {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setOffer(null);
                onPaired();
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="conn-pair-start">
          <ShieldCheckIcon size={20} weight="duotone" aria-hidden="true" />
          <p className="settings-desc">
            You'll get a one-time code that works for a few minutes. It pairs the phone; it never
            shares a password.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !baseUrl}
            onClick={() => void mint()}
          >
            {busy ? "Confirm with Touch ID…" : "Show pairing QR"}
          </button>
        </div>
      )}
      {ticket && !ticket.ok && <p className="conn-bad">{ticket.error}</p>}
      {error && (
        <p className="conn-bad" role="alert">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}

// ─── devices ────────────────────────────────────────────────────────────────

function DevicesCard({
  admin,
  selfId,
  onChanged,
}: {
  admin: boolean;
  selfId: string | null;
  onChanged: () => void;
}): React.ReactElement {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setDevices(await kleio.devices());
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  async function revoke(id: string): Promise<void> {
    setBusy(true);
    try {
      setDevices(await kleio.revoke(id));
      setConfirm(null);
      toast("Device removed.", "success");
      onChanged();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  const live = (devices ?? []).filter((d) => !d.revoked);
  return (
    <SettingsCard
      title="Devices"
      description="Everything paired with your Mac mini. Remove one and it's signed out straight away."
    >
      {!admin ? (
        <p className="settings-desc">Only an admin Mac can see and remove devices.</p>
      ) : devices === null ? (
        <div className="conn-row">
          <p className="settings-desc">Showing devices needs Touch ID.</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? "Confirm with Touch ID…" : "Show devices"}
          </button>
        </div>
      ) : live.length === 0 ? (
        <p className="settings-desc">No devices paired.</p>
      ) : (
        <ul className="conn-devices">
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
                  {d.admin && (
                    <Badge color={theme.warning} className="conn-inline-badge">
                      Admin
                    </Badge>
                  )}
                </span>
                <span className="conn-device-sub">
                  {d.lastSeen ? `Active ${relTime(d.lastSeen)}` : `Paired ${relTime(d.createdAt)}`}
                </span>
              </span>
              {d.deviceId !== selfId &&
                (confirm === d.deviceId ? (
                  <span className="conn-inline-confirm">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirm(null)}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => void revoke(d.deviceId)}
                    >
                      Remove
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove ${d.label}`}
                    onClick={() => setConfirm(d.deviceId)}
                  >
                    Remove
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="conn-bad" role="alert">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
