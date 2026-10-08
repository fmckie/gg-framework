// Settings → Connection: how this device, the Mac mini (the Kleio host) and the
// other Kleio app reach each other. Everything runs on the Mac mini; the Mac
// and the iPhone are windows onto it, joined privately over Tailscale.
//
// - The verdict: in plain words, does it work, what was checked, and numbered
//   steps to fix it when it doesn't (connectionDiagnosis.ts).
// - Mac mini: its address, how quickly it replies, how this device is paired.
// - Tailscale (Mac only): the private network's details.
// - iPhone: a one-time pairing QR the Kleio iPhone app scans (admin).
// - Devices: every paired device, with revoke (admin).
//
// Replaces upstream's Telegram "Remote" page: the iPhone app is Kleio's remote.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DesktopIcon,
  DeviceMobileIcon,
  HardDrivesIcon,
  LockSimpleIcon,
  QuestionIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Badge } from "../Badge";
import { isPhone } from "../platform";
import { SettingsCard } from "../settings-section";
import { SettingsHeaderAction, SettingsHeaderStatus } from "../settings-header";
import { theme } from "../theme";
import { toast } from "../toast";
import {
  diagnose,
  unreachableReason,
  type Checked,
  type Diagnosis,
  type FixStep,
  type HealthCheck,
  type Tone,
} from "./connectionDiagnosis";
import { REACH_TIMEOUT_MS } from "./hostReach";
import { hostHealth } from "./kleioApi";
import { pairTicket } from "./pairTicket";
import { encodeQr, qrSvgPath, type QrResult } from "./qr";
import { relTime } from "./relTime";
import {
  explainError,
  kleio,
  useKleioRemote,
  type Device as PairedDevice,
  type PairOffer,
  type TailscaleStatus,
} from "./useKleioRemote";

const REFRESH_MS = 15_000;
const QR_QUIET_ZONE = 4;

type Device = "Mac" | "iPhone";

/** One round of checks, with whether this device had a network at the time. */
interface Checks {
  health: HealthCheck;
  /** `null` on the iPhone, which can't read its own Tailscale. */
  net: Checked<TailscaleStatus> | null;
  online: boolean;
}

const TONE_COLOR: Record<Tone, string> = {
  good: theme.success,
  warn: theme.warning,
  bad: theme.error,
};

export function shortName(host: string): string {
  return host.split(".")[0] ?? host;
}

/** "12 ms" / "1.2 s": how quick the Mac mini answered. */
export function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The HTTP status a failed call carries; 0 when nothing replied. */
function statusOf(e: unknown): number {
  if (typeof e !== "object" || e === null || !("status" in e)) return 0;
  return typeof e.status === "number" ? e.status : 0;
}

export function ConnectionPage(): React.ReactElement {
  const { status, refresh: refreshRemote } = useKleioRemote();
  const active = status?.active ?? null;
  const paired = status?.paired ?? null;
  const phone = isPhone();
  const device: Device = phone ? "iPhone" : "Mac";
  const [checks, setChecks] = useState<Checks | null>(null);
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
    const [h, t] = await Promise.allSettled([
      hostHealth(REACH_TIMEOUT_MS),
      phone ? Promise.resolve(null) : kleio.tailscale(),
    ]);
    if (!alive.current) return;
    setChecks({
      health:
        h.status === "fulfilled"
          ? { state: "ok", value: h.value }
          : {
              state: "error",
              reason: unreachableReason(statusOf(h.reason), explainError(h.reason)),
            },
      net:
        t.status === "rejected"
          ? { state: "error" }
          : t.value === null
            ? null
            : { state: "ok", value: t.value },
      online: navigator.onLine,
    });
    setChecking(false);
  }, [phone]);

  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [check]);

  const hostLabel = shortName(active?.host ?? paired?.host ?? "Mac mini");
  const verdict = checks ? diagnose({ ...checks, hostLabel, device }) : null;
  const health = checks?.health ?? null;

  return (
    <>
      <SettingsHeaderStatus>
        <Badge color={verdict ? TONE_COLOR[verdict.tone] : undefined}>
          {verdict?.badge ?? "Checking…"}
        </Badge>
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
        device={device}
        hostLabel={hostLabel}
        health={health}
        net={checks?.net?.state === "ok" ? checks.net.value : null}
      />

      <Verdict verdict={verdict} hostLabel={hostLabel} />

      <div className="settings-cols">
        <div className="settings-col">
          <SettingsCard
            title="Mac mini"
            description="Kleio's brain lives here. Chats, specialists and code all run on it, so they keep going when this device sleeps."
          >
            <dl className="conn-facts">
              <Fact label="Address">
                <code className="conn-code">{active?.base ?? paired?.baseUrl ?? "Not paired"}</code>
              </Fact>
              {health?.state === "ok" && (
                <Fact label="Reply time">{formatLatency(health.value.latencyMs)}</Fact>
              )}
              <Fact label={`This ${device}`}>
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

          {!phone && (
            <TailscaleCard net={checks === null ? undefined : checks.net} hostLabel={hostLabel} />
          )}
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

// ─── the verdict: does it work, what was checked, how to fix it ─────────────

function ToneIcon({ tone, size }: { tone: Tone | "unknown"; size: number }): React.ReactElement {
  if (tone === "good") return <CheckCircleIcon size={size} weight="fill" aria-hidden="true" />;
  if (tone === "warn") return <WarningCircleIcon size={size} weight="fill" aria-hidden="true" />;
  if (tone === "bad") return <XCircleIcon size={size} weight="fill" aria-hidden="true" />;
  return <QuestionIcon size={size} weight="bold" aria-hidden="true" />;
}

function Verdict({
  verdict,
  hostLabel,
}: {
  /** `null` until the first check finishes. */
  verdict: Diagnosis | null;
  hostLabel: string;
}): React.ReactElement {
  if (!verdict) {
    return (
      <section className="conn-verdict" aria-label="Connection check">
        <p className="conn-verdict-detail" role="status">
          Checking the connection to {hostLabel}…
        </p>
      </section>
    );
  }
  return (
    <section className={`conn-verdict is-${verdict.tone}`} aria-label="Connection check">
      <span className="conn-verdict-icon">
        <ToneIcon tone={verdict.tone} size={22} />
      </span>
      <div className="conn-verdict-body">
        <div role="status">
          <h3 className="conn-verdict-title">{verdict.headline}</h3>
          <p className="conn-verdict-detail">{verdict.detail}</p>
        </div>
        <ul className="conn-checks" aria-label="What was checked">
          {verdict.checks.map((c) => (
            <li key={c.label} className={`conn-check is-${c.tone}`}>
              <ToneIcon tone={c.tone} size={15} />
              <span className="conn-check-label">{c.label}</span>
              <span className="conn-check-text">{c.text}</span>
            </li>
          ))}
        </ul>
        {verdict.fix.length > 0 && (
          <div className="conn-fix">
            <h4 className="conn-fix-title">How to fix it</h4>
            <ol className="conn-steps">
              {verdict.fix.map((step) => (
                <li key={step.text}>
                  <FixStepText step={step} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function FixStepText({ step }: { step: FixStep }): React.ReactElement {
  const { link, command } = step;
  return (
    <>
      {step.text}
      {link && (
        <button
          type="button"
          className="btn btn-ghost btn-sm conn-fix-link"
          onClick={() => void openUrl(link.url)}
        >
          {link.label}
        </button>
      )}
      {command && <CommandLine command={command} />}
    </>
  );
}

/** A command to run on the Mac mini, with a button that copies it. */
function CommandLine({ command }: { command: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <span className="conn-command">
      {/* Wraps only between words: a break inside `-k` or a name would misread. */}
      <code>
        {command.split(" ").map((word, i) => (
          <span key={`${i}:${word}`}>
            {i > 0 && " "}
            <span className="conn-command-word">{word}</span>
          </span>
        ))}
      </code>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          navigator.clipboard.writeText(command).then(
            () => setCopied(true),
            () => toast("Couldn't copy. Select the command and copy it instead.", "error"),
          );
        }}
      >
        {copied ? (
          <CheckIcon size={13} weight="bold" aria-hidden="true" />
        ) : (
          <CopyIcon size={13} weight="bold" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
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

// ─── the map: this device ── Tailscale ── Mac mini ── Tailscale ── the other ─

function ConnectionMap({
  device,
  hostLabel,
  health,
  net,
}: {
  device: Device;
  hostLabel: string;
  /** `null` until the first check finishes. */
  health: HealthCheck | null;
  net: TailscaleStatus | null;
}): React.ReactElement {
  const hostKnown = health !== null;
  const reached = health?.state === "ok";
  const hostUp = reached && health.value.sidecar === "up";
  const linkUp = reached || (net?.running === true && net.host?.online === true);
  // A reply from the Mac mini proves this device's Tailscale works, even on
  // the iPhone, where the app can't read Tailscale itself.
  const selfState = net ? (net.running ? "is-up" : "is-down") : reached ? "is-up" : "is-unknown";
  const phone = device === "iPhone";
  const desktop = <DesktopIcon size={26} weight="duotone" aria-hidden="true" />;
  const mobile = <DeviceMobileIcon size={26} weight="duotone" aria-hidden="true" />;
  return (
    <section className="conn-map" aria-label="How your devices connect">
      <MapNode
        icon={phone ? mobile : desktop}
        name={`This ${device}`}
        detail={net?.self?.name ?? (phone ? "Kleio app" : "Kleio Desktop")}
        state={selfState}
      />
      <MapLink up={linkUp} known={hostKnown} label="Tailscale" />
      <MapNode
        icon={<HardDrivesIcon size={30} weight="duotone" aria-hidden="true" />}
        name={hostLabel}
        detail="Kleio host"
        state={!hostKnown ? "is-unknown" : hostUp ? "is-up" : "is-down"}
        hub
      />
      <MapLink up={hostUp} known={hostKnown} label="Tailscale" />
      <MapNode
        icon={phone ? desktop : mobile}
        name={phone ? "Mac" : "iPhone"}
        detail={phone ? "Kleio Desktop" : "Kleio app"}
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

// ─── Tailscale (Mac only: the iPhone app can't read the phone's Tailscale) ──

function TailscaleCard({
  net,
  hostLabel,
}: {
  /** `undefined` until the first check finishes. */
  net: Checked<TailscaleStatus> | null | undefined;
  hostLabel: string;
}): React.ReactElement {
  const ts = net?.state === "ok" ? net.value : null;
  return (
    <SettingsCard
      title="Tailscale"
      description="The private network between your devices. Nothing is open to the internet."
    >
      {net === undefined ? (
        <p className="settings-desc">Checking Tailscale on this Mac…</p>
      ) : !ts ? (
        <p className="settings-desc">Couldn't read Tailscale's settings on this Mac.</p>
      ) : !ts.installed ? (
        <p className="settings-desc">Not installed on this Mac yet.</p>
      ) : !ts.running ? (
        <p className="settings-desc">
          Tailscale isn't connected on this Mac, so there's nothing to show yet.
        </p>
      ) : (
        <dl className="conn-facts">
          {ts.tailnet && <Fact label="Account">{ts.tailnet}</Fact>}
          {ts.self && <Fact label="This Mac">{ts.self.name}</Fact>}
          {ts.host?.ip && (
            <Fact label={hostLabel}>
              <code className="conn-code">{ts.host.ip}</code>
            </Fact>
          )}
          {ts.version && <Fact label="Version">{ts.version.split("-")[0]}</Fact>}
        </dl>
      )}
      {ts && ts.health.length > 0 && (
        <div className="conn-health-box">
          <p className="conn-fix-title">Tailscale says</p>
          <ul className="conn-health">
            {ts.health.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
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
            {/* The iPhone app is the desktop app on a phone: it pairs by typing
                the host's address and this code (it has no QR scanner). */}
            <ol className="conn-steps">
              <li>
                Open Kleio on your iPhone and tap <strong>Pair with your Mac mini</strong>.
              </li>
              <li>
                Host URL: <code className="conn-pair-code">{baseUrl}</code>
              </li>
              <li>
                Pair code: <code className="conn-pair-code">{offer.display}</code>, then tap{" "}
                <strong>Pair</strong>.
              </li>
            </ol>
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
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
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
