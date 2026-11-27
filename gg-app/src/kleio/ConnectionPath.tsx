// Settings → Connection: the path from this device, by the way
// through (Tailscale, or a relay or a direct line over Kleio's link), to the
// host, and the one verdict line under it. Where the way breaks comes from the
// checks the verdict reads: the failing node is dashed with a red ring, and Fix
// sits in the gap and opens the verdict's numbered steps. A restart or a
// reconnect is waiting, not a fault: lapis, and a quiet button. While Kleio is
// connected one slow light crosses the path; nothing else on the page moves.
// What was checked stays in words for a screen reader, so no state is said by
// colour alone.

import { useEffect, useId, useRef } from "react";
import {
  ArrowClockwiseIcon,
  BroadcastIcon,
  DesktopIcon,
  DeviceMobileIcon,
  HardDrivesIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react";
import { relayHost, type Checked, type Diagnosis, type HealthCheck } from "./connectionDiagnosis";
import { FixStepText } from "./FixSteps";
import type { LinkStatus } from "./kleioLink";
import type { TailscaleStatus } from "./useKleioRemote";

/** One round of the page's checks, as the path reads it. */
export interface RouteChecks {
  health: HealthCheck;
  /** The check failed with the host's link answering for a stopped Kleio. */
  kleioDown: boolean;
  /** `null` over the link, where Tailscale says nothing. */
  net: Checked<TailscaleStatus> | null;
  online: boolean;
}

/** Where the way breaks: at this Mac's door, mid-way, or at the host's door. */
export type FailAt = "device" | "network" | "host";

export interface Route {
  /** `warn` is waiting (a restart, a reconnect), not a fault. */
  state: "checking" | "ok" | "warn" | "broken";
  /** `null` while the way is whole, or not yet known. */
  failAt: FailAt | null;
  /** The way through: Tailscale, or a relay or a direct line over the link. */
  through: { name: string; detail: string; relay: boolean };
  /** Kleio on the host answered and is running: the light may travel. */
  connected: boolean;
}

function wayThrough(checks: RouteChecks | null, link: LinkStatus | null): Route["through"] {
  if (link) {
    if (link.path === "direct") return { name: "Direct", detail: "No relay needed", relay: false };
    // The relay the open connection goes through; else the one the host was last reached by.
    const open = link.connected && link.path === "relay";
    const n0 = open ? link.pathN0 : link.relayN0;
    const own = relayHost(open ? link.pathAddr : link.relay);
    return { name: "Relay", detail: n0 ? "n0's public relay" : (own ?? "Your relay"), relay: true };
  }
  const net = checks?.net?.state === "ok" ? checks.net.value : null;
  return {
    name: "Tailscale",
    detail: net?.host?.online
      ? net.host.direct
        ? "Direct link"
        : "Through a relay"
      : (net?.tailnet ?? "Private network"),
    relay: false,
  };
}

/**
 * The path's state and where it breaks, from the same checks the verdict
 * reads, so the two can't disagree. `selfDown`: this Mac's own end can't work
 * (Tailscale off here, or its link stopped or turned away).
 */
export function routeOf(
  checks: RouteChecks | null,
  link: LinkStatus | null,
  verdict: Diagnosis | null,
  selfDown: boolean,
): Route {
  const through = wayThrough(checks, link);
  if (!checks || !verdict) return { state: "checking", failAt: null, through, connected: false };
  if (verdict.tone === "good") return { state: "ok", failAt: null, through, connected: true };
  const state = verdict.tone === "warn" ? "warn" : "broken";
  const health = checks.health;
  // Answering and running, though slowly: the way is whole.
  if (health.state === "ok" && health.value.sidecar === "up")
    return { state, failAt: null, through, connected: true };
  let failAt: FailAt;
  if (selfDown || !checks.online) failAt = "device";
  else if (health.state === "ok") failAt = "host";
  else {
    const net = checks.net?.state === "ok" ? checks.net.value : null;
    // Something reached the host, or spoke for it: the way through works, and
    // what's down is at the host's door.
    const hostSeen =
      checks.kleioDown ||
      health.reason === "replied" ||
      health.reason === "refused" ||
      (net?.running === true && net.host?.online === true) ||
      link?.connected === true ||
      link?.unreached?.kind === "host-silent";
    failAt = hostSeen ? "host" : "network";
  }
  return { state, failAt, through, connected: false };
}

/** A node's mark: fine, a fault, waiting, or not known. */
type Mark = "is-up" | "is-down" | "is-wait" | "is-unknown";
type LegKind = "up" | "unknown" | "break-start" | "break-middle" | "break-end";

export function ConnectionPath({
  device,
  selfDetail,
  hostLabel,
  replyTime,
  route,
  verdict,
  checking,
  onCheck,
  fixOpen,
  onFix,
  arrivedToFix,
}: {
  /** What this device is: the first node's name and picture. */
  device: "Mac" | "iPhone";
  /** This device's name on the network, or the app's. */
  selfDetail: string;
  hostLabel: string;
  /** How quickly the host answered ("40 ms"); `null` when it didn't. */
  replyTime: string | null;
  route: Route;
  /** `null` until the first check finishes. */
  verdict: Diagnosis | null;
  checking: boolean;
  onCheck: () => void;
  fixOpen: boolean;
  onFix: () => void;
  /** Opened by Overview's Fix: focus goes to the steps once they are there. */
  arrivedToFix: boolean;
}): React.ReactElement {
  const { state, failAt, through } = route;
  const stepsId = useId();
  const stepsTitle = useRef<HTMLHeadingElement>(null);
  const hasFix = (verdict?.fix.length ?? 0) > 0;
  const good = verdict?.tone === "good";
  // What fails is red, unless it is only waiting.
  const failed: Mark = state === "warn" ? "is-wait" : "is-down";
  const unknown = state === "checking";

  const focused = useRef(false);
  useEffect(() => {
    if (!arrivedToFix || focused.current || !hasFix || !fixOpen) return;
    focused.current = true;
    stepsTitle.current?.focus();
  }, [arrivedToFix, hasFix, fixOpen]);

  const first: LegKind = unknown ? "unknown" : failAt === "device" ? "break-start" : "up";
  const second: LegKind =
    unknown || failAt === "device"
      ? "unknown"
      : failAt === "network"
        ? "break-middle"
        : failAt === "host"
          ? "break-end"
          : "up";
  const fix = hasFix ? (
    <button
      type="button"
      // The page's one filled button, unless it is only waiting.
      className={`btn btn-sm cx-fix ${state === "broken" ? "btn-primary" : "btn-ghost"}`}
      aria-expanded={fixOpen}
      aria-controls={stepsId}
      onClick={onFix}
    >
      Fix
    </button>
  ) : null;
  const Through = through.relay ? BroadcastIcon : ShareNetworkIcon;

  return (
    <section className={`cx-path is-${state}`} aria-label="Connection check">
      <div className="cx-route" role="group" aria-label="How your devices connect">
        <PathNode
          icon={
            device === "iPhone" ? (
              <DeviceMobileIcon size={24} weight="light" aria-hidden="true" />
            ) : (
              <DesktopIcon size={24} weight="light" aria-hidden="true" />
            )
          }
          name={`This ${device}`}
          detail={selfDetail}
          mark={unknown ? "is-unknown" : failAt === "device" ? failed : "is-up"}
        />
        <PathLeg kind={first} fix={first === "up" || first === "unknown" ? null : fix} />
        <PathNode
          icon={<Through size={24} weight="light" aria-hidden="true" />}
          name={through.name}
          detail={through.detail}
          mark={
            unknown || failAt === "device"
              ? "is-unknown"
              : failAt === "network"
                ? failed
                : state === "warn" && failAt === null
                  ? "is-wait"
                  : "is-up"
          }
        />
        <PathLeg kind={second} fix={second === "up" || second === "unknown" ? null : fix} />
        <PathNode
          icon={<HardDrivesIcon size={26} weight="light" aria-hidden="true" />}
          name={hostLabel}
          detail={replyTime ? `Replies in ${replyTime}` : "Kleio host"}
          mark={
            unknown ? "is-unknown" : failAt === "host" ? failed : failAt ? "is-unknown" : "is-up"
          }
          hub
        />
        {/* The page's one moving thing: a slow light, only while connected. */}
        {route.connected && (
          <span className="cx-track" aria-hidden="true">
            <span className="cx-light" />
          </span>
        )}
      </div>

      <div className="cx-verdict">
        <div role="status">
          {verdict ? (
            <>
              <h3 className="cx-verdict-line">{verdict.headline}</h3>
              {/* All is well: the path says it; a screen reader still hears what it means. */}
              <p className={good ? "sr-only" : "cx-verdict-detail"}>{verdict.detail}</p>
            </>
          ) : (
            <p className="cx-verdict-line">Checking the connection to {hostLabel}…</p>
          )}
        </div>
        {verdict && (
          <ul className="sr-only" aria-label="What was checked">
            {verdict.checks.map((c) => (
              <li key={c.label}>
                <span>{c.label}</span>: <span>{c.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="cx-verdict-actions">
          <button type="button" className="st-text-btn" disabled={checking} onClick={onCheck}>
            <ArrowClockwiseIcon size={12} weight="bold" aria-hidden="true" />
            {checking ? "Checking…" : "Check again"}
          </button>
          {/* With no gap to sit in, Fix waits beside Check again. */}
          {failAt === null && fix}
        </div>
      </div>

      {verdict && hasFix && (
        <div className="cx-fix-steps" id={stepsId} hidden={!fixOpen}>
          <h4 className="st-label" ref={stepsTitle} tabIndex={-1}>
            How to fix it
          </h4>
          <ol className="conn-steps">
            {verdict.fix.map((step) => (
              <li key={step.text}>
                <FixStepText step={step} />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function PathNode({
  icon,
  name,
  detail,
  mark,
  hub = false,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  mark: Mark;
  hub?: boolean;
}): React.ReactElement {
  return (
    <div className={`cx-node ${mark}${hub ? " is-hub" : ""}`}>
      <span className="cx-orb">
        {icon}
        <span className="cx-dot" aria-hidden="true" />
      </span>
      <span className="cx-node-name">{name}</span>
      <span className="cx-node-detail">{detail}</span>
    </div>
  );
}

/** One hop: a hairline, dotted while unknown, cut where it fails, with Fix in the gap. */
function PathLeg({ kind, fix }: { kind: LegKind; fix: React.ReactNode }): React.ReactElement {
  const broken = kind.startsWith("break");
  return (
    <div className={`cx-leg is-${kind}`}>
      <span className="cx-seg" aria-hidden="true" />
      {broken && (
        <>
          <span className="cx-gap">{fix}</span>
          <span className="cx-seg is-after" aria-hidden="true" />
        </>
      )}
    </div>
  );
}
