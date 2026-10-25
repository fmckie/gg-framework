// Settings → Connection in plain English. Two checks run on this device (does
// the Mac mini answer? what does Tailscale here say?) and this turns them into
// one verdict, a short checklist, and numbered steps to fix whatever is wrong.
// Over Kleio's link, `diagnoseLink` does the same from what the link says
// (kleio_link_status), and the gate, the home screen and Setup use its words.
// Pure, so every case is tested without a network.

import type { HostHealth, HostKind } from "./kleioApi";
import type { LinkRelayName, LinkStatus } from "./kleioLink";
import { relTime } from "./relTime";
import type { TailscaleStatus } from "./useKleioRemote";

/** One finished check: its answer, or that it couldn't be done. */
export type Checked<T> = { state: "ok"; value: T } | { state: "error" };

/** Why the Mac mini didn't give a good answer. */
export type Unreachable =
  /** Something on the Mac mini answered, just not Kleio (Tailscale's proxy sends a 502). */
  | "replied"
  /** The Mac mini turned the connection away: nothing is listening for Kleio. */
  | "refused"
  /** Its name didn't resolve. Tailscale names only resolve while Tailscale is on. */
  | "not-found"
  /** Nothing came back in time. */
  | "no-reply"
  /** This device has no network at all. */
  | "offline"
  | "unknown";

export type HealthCheck =
  { state: "ok"; value: HostHealth } | { state: "error"; reason: Unreachable };

/**
 * Sorts a failed Mac mini check by what the network stack said. `status` is
 * the HTTP status when something replied, 0 when nothing did.
 */
export function unreachableReason(status: number, message: string): Unreachable {
  if (status !== 0) return "replied";
  const m = message.toLowerCase();
  if (/connection refused|os error 61\b|os error 111\b/.test(m)) return "refused";
  if (
    /lookup address|nodename nor servname|dns error|name or service not known|no such host/.test(m)
  )
    return "not-found";
  if (
    /network is unreachable|internet connection appears to be offline|not connected to the internet/.test(
      m,
    )
  )
    return "offline";
  if (/timed out|timeout|no route to host|host is down/.test(m)) return "no-reply";
  return "unknown";
}

export type Tone = "good" | "warn" | "bad";

export interface CheckLine {
  label: string;
  tone: Tone | "unknown";
  text: string;
}

/** One way to fix things; `command` is shown to copy, `link` is a page to open. */
export interface FixStep {
  text: string;
  command?: string;
  link?: { label: string; url: string };
}

export interface Diagnosis {
  tone: Tone;
  /** One or two words for the header badge. */
  badge: string;
  /** The verdict, as a sentence. */
  headline: string;
  /** What it means for you, or what's wrong. */
  detail: string;
  checks: CheckLine[];
  /** Empty when everything works. */
  fix: FixStep[];
}

export interface DiagnosisInput {
  health: HealthCheck;
  /** Tailscale on this device. The iPhone app can't read its own Tailscale, so `null` there. */
  net: Checked<TailscaleStatus> | null;
  /** The Mac mini's short name, e.g. "mac-mini-1". */
  hostLabel: string;
  /** "Mac" or "iPhone". */
  device: "Mac" | "iPhone";
  /** Whether this device has any network at all (`navigator.onLine`). */
  online: boolean;
}

export const TAILSCALE_DOWNLOAD = "https://tailscale.com/download";
export const TAILSCALE_MACHINES = "https://login.tailscale.com/admin/machines";

// The two jobs install-mini.sh sets up on the Mac mini (packages/kleio-host).
/** Restarts Kleio's engine: chats, specialists and code. */
export const RESTART_ENGINE = 'launchctl kickstart -k "gui/$(id -u)/com.kleio.host.sidecar"';
/** Restarts Kleio's host: what this device talks to. */
export const RESTART_HOST = 'launchctl kickstart -k "gui/$(id -u)/com.kleio.host.serve"';

const NEEDS_SIGN_IN = new Set(["NeedsLogin", "NeedsMachineAuth"]);

/** What Tailscale on this device says, as one checklist line. */
function tailscaleLine({ health, net, device }: DiagnosisInput): CheckLine {
  const label = `Tailscale on this ${device}`;
  if (net === null || net.state === "error") {
    // Nothing to read here, but a reply from the Mac mini proves it works.
    return health.state === "ok"
      ? { label, tone: "good", text: "Working" }
      : {
          label,
          tone: "unknown",
          text: net === null ? "Check the Tailscale app" : "Couldn't check",
        };
  }
  const ts = net.value;
  if (!ts.installed) return { label, tone: "bad", text: "Not installed" };
  if (ts.running) return { label, tone: "good", text: ts.self ? `On, as ${ts.self.name}` : "On" };
  if (ts.backendState === "NeedsMachineAuth")
    return { label, tone: "bad", text: "Waiting for approval" };
  if (ts.backendState === "NeedsLogin") return { label, tone: "bad", text: "Signed out" };
  if (ts.backendState === "Starting") return { label, tone: "warn", text: "Starting up" };
  return { label, tone: "bad", text: ts.backendState === "Stopped" ? "Turned off" : "Not running" };
}

/** Whether Tailscale here can see the Mac mini, as one checklist line. */
function peerLine({ net, hostLabel }: DiagnosisInput, now: number): CheckLine | null {
  if (net?.state !== "ok" || !net.value.running) return null;
  const label = `${hostLabel} on Tailscale`;
  const host = net.value.host;
  if (!host) return { label, tone: "bad", text: "Not on your network" };
  if (!host.online) {
    const seen = host.lastSeen ? `, last seen ${relTime(host.lastSeen, now)}` : "";
    return { label, tone: "bad", text: `Offline${seen}` };
  }
  if (host.direct) return { label, tone: "good", text: "Online, direct link" };
  return { label, tone: "good", text: "Online, through a relay (a little slower)" };
}

const NO_ANSWER: Record<Unreachable, string> = {
  replied: "Not answering",
  refused: "Not answering",
  "not-found": "Can't find it",
  "no-reply": "No reply",
  offline: "No reply",
  unknown: "No reply",
};

/** Kleio's own reply, as one checklist line. */
function hostLine({ health, hostLabel }: DiagnosisInput): CheckLine {
  const label = `Kleio on ${hostLabel}`;
  if (health.state === "error") return { label, tone: "bad", text: NO_ANSWER[health.reason] };
  const s = health.value.sidecar;
  if (s === "up") return { label, tone: "good", text: "Running" };
  if (s === "stale") return { label, tone: "warn", text: "Restarting" };
  return { label, tone: "bad", text: "Stopped" };
}

/** The Mac mini is reachable but Kleio on it isn't: restart Kleio's host. */
function kleioNotAnswering(checks: CheckLine[], hostLabel: string, checkAgain: FixStep): Diagnosis {
  return {
    checks,
    tone: "bad",
    badge: "Disconnected",
    headline: `Kleio on ${hostLabel} isn't answering`,
    detail: `${hostLabel} is on your Tailscale network, but Kleio there didn't reply. It has probably stopped.`,
    fix: [
      { text: `On ${hostLabel}, open Terminal and run:`, command: RESTART_HOST },
      checkAgain,
      {
        text: `Still not answering? Run Kleio's installer (install-mini.sh) on ${hostLabel} again. It's safe to run again.`,
      },
    ],
  };
}

/**
 * The verdict for the page. `now` is injected so "last seen" reads the same in
 * a test as on screen.
 */
export function diagnose(input: DiagnosisInput, now: number = Date.now()): Diagnosis {
  const { health, net, hostLabel, device } = input;
  const checks = [tailscaleLine(input), peerLine(input, now), hostLine(input)].filter(
    (c): c is CheckLine => c !== null,
  );
  const press = device === "iPhone" ? "tap" : "click";
  const checkAgain: FixStep = { text: `Then ${press} Check again.` };

  // Kleio answered: whatever Tailscale here reports, the connection works.
  if (health.state === "ok") {
    const s = health.value.sidecar;
    if (s === "up") {
      return {
        checks,
        tone: "good",
        badge: "Connected",
        headline: `Connected to ${hostLabel}`,
        detail: `Everything's working. Chats, specialists and code run on ${hostLabel}, so they keep going when this ${device} sleeps.`,
        fix: [],
      };
    }
    if (s === "stale") {
      return {
        checks,
        tone: "warn",
        badge: "Restarting",
        headline: `Kleio is restarting on ${hostLabel}`,
        detail: `${hostLabel} is answering, but Kleio there is partway through a restart. It's usually back within a minute.`,
        fix: [
          { text: `Wait a minute, then ${press} Check again.` },
          {
            text: `Still restarting after a few minutes? On ${hostLabel}, open Terminal and run:`,
            command: RESTART_ENGINE,
          },
        ],
      };
    }
    return {
      checks,
      tone: "bad",
      badge: "Kleio stopped",
      headline: `Kleio has stopped on ${hostLabel}`,
      detail: `${hostLabel} is on and reachable, but Kleio isn't running on it, so chats and specialists can't answer.`,
      fix: [
        { text: `On ${hostLabel}, open Terminal and run:`, command: RESTART_ENGINE },
        checkAgain,
      ],
    };
  }

  const down = { checks, tone: "bad" as const, badge: "Disconnected" };
  const reason = input.online ? health.reason : "offline";

  // Something on the Mac mini answered, or turned the connection away: the
  // network is fine, Kleio isn't.
  if (reason === "replied" || reason === "refused")
    return kleioNotAnswering(checks, hostLabel, checkAgain);

  if (reason === "offline") {
    return {
      ...down,
      headline: `This ${device} is offline`,
      detail: `It isn't connected to the internet, so it can't reach ${hostLabel}.`,
      fix: [
        {
          text:
            device === "iPhone"
              ? "Connect to Wi-Fi or mobile data."
              : "Connect to Wi-Fi or a network cable.",
        },
        checkAgain,
      ],
    };
  }

  // On the Mac, Tailscale's own status says what's wrong.
  const ts = net?.state === "ok" ? net.value : null;
  if (ts && !ts.installed) {
    return {
      ...down,
      headline: `Tailscale isn't installed on this ${device}`,
      detail: `Kleio reaches ${hostLabel} over Tailscale, a private network between your own devices. This ${device} needs it too.`,
      fix: [
        {
          text: "Download and install Tailscale.",
          link: { label: "Get Tailscale", url: TAILSCALE_DOWNLOAD },
        },
        { text: `Sign in with the same account you use on ${hostLabel}.` },
        checkAgain,
      ],
    };
  }
  if (ts && !ts.running) {
    if (ts.backendState === "NeedsMachineAuth") {
      return {
        ...down,
        headline: `This ${device} is waiting for approval on Tailscale`,
        detail: `Tailscale is signed in, but your Tailscale network has to approve this ${device} before it can reach ${hostLabel}.`,
        fix: [
          {
            text: `Open your Tailscale admin page and approve this ${device}.`,
            link: { label: "Open Tailscale admin", url: TAILSCALE_MACHINES },
          },
          checkAgain,
        ],
      };
    }
    if (ts.backendState && NEEDS_SIGN_IN.has(ts.backendState)) {
      return {
        ...down,
        headline: `Tailscale is signed out on this ${device}`,
        detail: `Kleio can't reach ${hostLabel} until Tailscale on this ${device} is signed in.`,
        fix: [
          { text: "Click the Tailscale icon in the menu bar and sign in." },
          { text: `Use the same account as ${hostLabel}.` },
          checkAgain,
        ],
      };
    }
    if (ts.backendState === "Starting") {
      return {
        ...down,
        tone: "warn",
        badge: "Starting",
        headline: `Tailscale is still starting on this ${device}`,
        detail: "This usually takes a few seconds.",
        fix: [{ text: `Wait a moment, then ${press} Check again.` }],
      };
    }
    if (ts.backendState === "Stopped") {
      return {
        ...down,
        headline: `Tailscale is turned off on this ${device}`,
        detail: `Kleio talks to ${hostLabel} over Tailscale, so nothing gets through while it's off.`,
        fix: [{ text: "Click the Tailscale icon in the menu bar and turn it on." }, checkAgain],
      };
    }
    return {
      ...down,
      headline: `Tailscale isn't running on this ${device}`,
      detail: `Kleio talks to ${hostLabel} over Tailscale, so nothing gets through until it's running.`,
      fix: [
        { text: "Open Tailscale from your Applications folder, and sign in if it asks." },
        checkAgain,
      ],
    };
  }
  if (ts && !ts.host) {
    return {
      ...down,
      headline: `${hostLabel} isn't on your Tailscale network`,
      detail: `Tailscale is on here, but ${hostLabel} isn't one of its devices. That usually means this ${device} and ${hostLabel} are signed in to different Tailscale accounts.`,
      fix: [
        {
          text: `On ${hostLabel}, open Tailscale and check which account it's signed in to${ts.tailnet ? ` (this ${device} uses ${ts.tailnet})` : ""}.`,
        },
        { text: "Sign both in to the same account." },
        checkAgain,
      ],
    };
  }
  if (ts?.host && !ts.host.online) {
    const seen = ts.host.lastSeen ? ` It was last seen ${relTime(ts.host.lastSeen, now)}.` : "";
    return {
      ...down,
      headline: `${hostLabel} is offline`,
      detail: `Tailscale here is fine, but ${hostLabel} isn't connected to it.${seen}`,
      fix: [
        { text: `Make sure ${hostLabel} is switched on, awake and online.` },
        { text: `On ${hostLabel}, check that Tailscale is on and signed in.` },
        checkAgain,
      ],
    };
  }
  if (ts?.host?.online) {
    if (reason !== "not-found") return kleioNotAnswering(checks, hostLabel, checkAgain);
    return {
      ...down,
      headline: `This ${device} can't look up ${hostLabel}`,
      detail: `Tailscale is on and can see ${hostLabel}, but this ${device} couldn't turn its name into an address. Tailscale's DNS setting may be off here.`,
      fix: [
        {
          text: "Click the Tailscale icon in the menu bar, open its settings, and turn on \u201cUse Tailscale DNS settings\u201d.",
        },
        checkAgain,
      ],
    };
  }

  // The iPhone, which can't read its own Tailscale: go by how the request failed.
  if (reason === "not-found") {
    return {
      ...down,
      headline: `This ${device} can't find ${hostLabel}`,
      detail: `${hostLabel}'s address only works over Tailscale, so Tailscale on this ${device} is probably off, or signed in to a different account.`,
      fix: [
        { text: `Open the Tailscale app on this ${device} and make sure it says Connected.` },
        { text: `Check it's signed in to the same account as ${hostLabel}.` },
        checkAgain,
      ],
    };
  }
  return {
    ...down,
    headline: `${hostLabel} isn't replying`,
    detail: `This ${device} asked ${hostLabel} for a reply and got none. ${hostLabel} may be asleep or switched off, or Tailscale may be off on one of them.`,
    fix: [
      { text: `Make sure ${hostLabel} is switched on and awake, with Tailscale on.` },
      { text: `Open the Tailscale app on this ${device} and make sure it says Connected.` },
      checkAgain,
    ],
  };
}

// ─── Kleio's link ──────────────────────────────────────────────────────────

/** GET /kleio/health over the link. */
export type LinkHealth =
  | { state: "ok"; value: HostHealth }
  /** `kleioDown`: the host's link answered for a Kleio that didn't (its 502). */
  | { state: "error"; kleioDown: boolean };

/** Whether a failed call is the host's link answering for a stopped Kleio. */
export function isKleioDown(status: number, error: unknown): boolean {
  return status === 502 && error === "kleio_down";
}

export interface LinkDiagnosisInput {
  /** What the link says (kleio_link_status). */
  link: LinkStatus;
  health: LinkHealth;
  /** The host's OS and kind, as GET /kleio/host last said; null if it never has. */
  host: HostKind | null;
  /** The host's short name, e.g. "mac-mini-1". */
  hostLabel: string;
  device: "Mac" | "iPhone";
  /** Whether this device has any network at all (`navigator.onLine`). */
  online: boolean;
}

/** Restarts Kleio's link on a Mac host (install-mini.sh's third job). */
export const RESTART_LINK = 'launchctl kickstart -k "gui/$(id -u)/com.kleio.host.link"';
/** Restarts Kleio's link on a Linux host (packages/kleio-link/contrib/kleio-link.service). */
export const RESTART_LINK_SYSTEMD = "systemctl --user restart kleio-link.service";
/** Starts Kleio's link on a Windows host, from the folder Kleio's host is in. */
export const START_LINK_WINDOWS = "& .\\bin\\kleio-link-host.exe serve";
/** Starts Kleio's host on Linux and Windows, which have no service for it yet. */
export const START_HOST = "kleio-host serve";
/** Starts Kleio's engine there, likewise. */
export const START_ENGINE = "kleio-host sidecar";

/** How to start one of Kleio's programs again on the host, by its OS. */
function restart(
  host: HostKind | null,
  hostLabel: string,
  what: { name: string; mac: string; linux: string; windows: string },
): FixStep[] {
  switch (host?.os) {
    case "darwin":
      return [{ text: `On ${hostLabel}, open Terminal and run:`, command: what.mac }];
    case "linux":
      return [{ text: `On ${hostLabel}, in a terminal, run:`, command: what.linux }];
    case "win32":
      return [
        {
          text: `On ${hostLabel}, open PowerShell in the folder Kleio is in, and run:`,
          command: what.windows,
        },
        { text: "Leave that window open: closing it stops it." },
      ];
    default:
      return [{ text: `On ${hostLabel}, start ${what.name} again.` }];
  }
}

const restartHost = (host: HostKind | null, hostLabel: string): FixStep[] =>
  restart(host, hostLabel, {
    name: "Kleio",
    mac: RESTART_HOST,
    linux: START_HOST,
    windows: START_HOST,
  });

const restartEngine = (host: HostKind | null, hostLabel: string): FixStep[] =>
  restart(host, hostLabel, {
    name: "Kleio's engine",
    mac: RESTART_ENGINE,
    linux: START_ENGINE,
    windows: START_ENGINE,
  });

const restartLink = (host: HostKind | null, hostLabel: string): FixStep[] =>
  restart(host, hostLabel, {
    name: "Kleio's link",
    mac: RESTART_LINK,
    linux: RESTART_LINK_SYSTEMD,
    windows: START_LINK_WINDOWS,
  });

/** The relays, as the app names them: n0's once, as n0's public relays. */
function relayNames(relays: LinkRelayName[]): string {
  const names: string[] = [];
  for (const relay of relays) {
    const name = relay.n0 ? "n0's public relays" : relay.host;
    if (!names.includes(name)) names.push(name);
  }
  return names.join(", ");
}

/** A relay address's host name, without the final dot n0's have. */
export function relayHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * How long ago `atMs` was, as "3 min ago". Under a second, or a moment after
 * this clock's now (the link works the time out a moment before), it's
 * "just now", not relTime's "in 0s".
 */
function reachedAgo(atMs: number, now: number): string {
  return now - atMs < 1_000 ? "just now" : relTime(new Date(atMs).toISOString(), now);
}

/** The link's own checklist lines. */
function linkChecks({ link, health, hostLabel, device }: LinkDiagnosisInput): CheckLine[] {
  const checks: CheckLine[] = [];
  const label = `Kleio's link on this ${device}`;
  if (!link.running) checks.push({ label, tone: "bad", text: "Not running" });
  else if (link.refusal) checks.push({ label, tone: "bad", text: "Turned away" });
  else if (link.connected) checks.push({ label, tone: "good", text: "Connected" });
  else if (link.dialling) checks.push({ label, tone: "warn", text: "Reconnecting…" });
  else checks.push({ label, tone: "bad", text: "Not connected" });
  if (link.connected && link.path) {
    const text =
      link.path === "direct"
        ? "Direct"
        : link.pathN0
          ? "Through n0's public relay"
          : `Through your relay${relayHost(link.pathAddr) ? ` (${relayHost(link.pathAddr)})` : ""}`;
    checks.push(
      link.rateLimited
        ? { label: "Path", tone: "warn", text: `${text}, slowed by the relay` }
        : { label: "Path", tone: "good", text },
    );
  }
  if (link.unreached?.kind === "no-relay")
    checks.push({ label: "Relays tried", tone: "bad", text: relayNames(link.unreached.relays) });
  const kleio = `Kleio on ${hostLabel}`;
  if (health.state === "ok") {
    const s = health.value.sidecar;
    checks.push(
      s === "up"
        ? { label: kleio, tone: "good", text: "Running" }
        : s === "stale"
          ? { label: kleio, tone: "warn", text: "Restarting" }
          : { label: kleio, tone: "bad", text: "Stopped" },
    );
  } else {
    checks.push({ label: kleio, tone: "bad", text: health.kleioDown ? "Not running" : "No reply" });
  }
  return checks;
}

/** Pairing again, after the host has turned this device away. */
function pairAgain(hostLabel: string, device: string): FixStep[] {
  return [
    {
      text: `Show a new pairing QR code: on your admin device in Settings → Connection, or on ${hostLabel} with:`,
      command: "kleio-host pair",
    },
    { text: `Pair this ${device} again with it.` },
  ];
}

/**
 * The verdict over Kleio's link: the same shape as `diagnose`'s, from what the
 * link says (kleio_link_status) and whether Kleio on the host answered. `now`
 * is injected so "last reached" reads the same in a test as on screen.
 */
export function diagnoseLink(input: LinkDiagnosisInput, now: number = Date.now()): Diagnosis {
  const { link, health, host, hostLabel, device } = input;
  const checks = linkChecks(input);
  const press = device === "iPhone" ? "tap" : "click";
  const checkAgain: FixStep = { text: `Then ${press} Check again.` };
  const down = { checks, tone: "bad" as const };

  // Turned away: nothing else matters until it pairs again.
  if (link.refusal === "revoked") {
    return {
      ...down,
      badge: "Removed",
      headline: `${hostLabel} removed this ${device}`,
      detail: `This ${device} was revoked on ${hostLabel}, so ${hostLabel} turns it away. Pair it again to use Kleio here.`,
      fix: pairAgain(hostLabel, device),
    };
  }
  if (link.refusal === "not-paired") {
    return {
      ...down,
      badge: "Not paired",
      headline: `${hostLabel} doesn't know this ${device}`,
      detail: "It may have been set up again. Pair it again.",
      fix: pairAgain(hostLabel, device),
    };
  }
  if (!link.running) {
    return {
      ...down,
      badge: "Link stopped",
      headline: `Kleio's link isn't running on this ${device}`,
      detail: `It didn't start${link.error ? ` (${link.error})` : ""}, so Kleio can't reach ${hostLabel}.`,
      fix: [{ text: "Quit Kleio and open it again." }],
    };
  }

  if (health.state === "ok") {
    const s = health.value.sidecar;
    if (s === "up") return connectedOverLink(input, checks);
    if (s === "stale") {
      return {
        checks,
        tone: "warn",
        badge: "Restarting",
        headline: `Kleio is restarting on ${hostLabel}`,
        detail: `${hostLabel} is answering, but Kleio there is partway through a restart. It's usually back within a minute.`,
        fix: [
          { text: `Wait a minute, then ${press} Check again.` },
          ...restartEngine(host, hostLabel).map((step, i) =>
            i === 0
              ? { ...step, text: `Still restarting after a few minutes? ${step.text}` }
              : step,
          ),
        ],
      };
    }
    return {
      ...down,
      badge: "Kleio stopped",
      headline: `Kleio has stopped on ${hostLabel}`,
      detail: `${hostLabel} is on and reachable, but Kleio's engine isn't running on it, so chats and specialists can't answer.`,
      fix: [...restartEngine(host, hostLabel), checkAgain],
    };
  }

  if (!input.online) {
    return {
      ...down,
      badge: "Offline",
      headline: `This ${device} is offline`,
      detail: `It isn't connected to the internet, so it can't reach ${hostLabel}.`,
      fix: [
        {
          text:
            device === "iPhone"
              ? "Connect to Wi-Fi or mobile data."
              : "Connect to Wi-Fi or a network cable.",
        },
        checkAgain,
      ],
    };
  }

  // The host's link answered for a Kleio that didn't.
  if (health.kleioDown) {
    return {
      ...down,
      badge: "Kleio stopped",
      headline: `Kleio on ${hostLabel} isn't running`,
      detail: `${hostLabel} is online and its link answered, but Kleio itself didn't.`,
      fix: [...restartHost(host, hostLabel), checkAgain],
    };
  }

  const unreached = link.unreached;
  if (unreached?.kind === "host-silent") {
    const last =
      link.lastReachedMs === null
        ? `The relay answered, but ${hostLabel} didn't.`
        : `Last reached ${reachedAgo(link.lastReachedMs, now)}.`;
    const kind = host?.laptop
      ? ` ${hostLabel} is a laptop: open it and keep it on power.`
      : host?.os === "linux"
        ? ` If ${hostLabel} is a VPS, check in your provider's dashboard that it's running.`
        : "";
    return {
      ...down,
      badge: "Asleep or offline",
      headline: `${hostLabel} is asleep or offline`,
      detail: `${last}${kind}`,
      fix: [
        {
          text: host?.laptop
            ? `Open ${hostLabel} and plug it in.`
            : `Make sure ${hostLabel} is switched on, awake and online.`,
        },
        ...restartLink(host, hostLabel).map((step, i) =>
          i === 0
            ? { ...step, text: `If it is, Kleio's link there may have stopped. ${step.text}` }
            : step,
        ),
        checkAgain,
      ],
    };
  }
  if (unreached?.kind === "no-relay") {
    return {
      ...down,
      badge: "Relay blocked",
      headline: "Kleio can't reach its relay",
      detail:
        device === "iPhone"
          ? "This network may block it: try mobile data or another Wi-Fi."
          : "This network may block it: try another Wi-Fi or network.",
      fix: [
        {
          text:
            device === "iPhone"
              ? "Switch to mobile data, or join another Wi-Fi."
              : "Join another Wi-Fi or network.",
        },
        checkAgain,
      ],
    };
  }
  if (unreached?.kind === "relay-refused") {
    const relay = unreached.relays[0];
    if (!relay || relay.n0) {
      return {
        ...down,
        badge: "Update Kleio",
        headline: "The shared relay no longer takes this version",
        detail: "Update Kleio to keep connecting through the shared relay.",
        fix: [{ text: `Update Kleio on this ${device}.` }, checkAgain],
      };
    }
    return {
      ...down,
      badge: "Update Kleio",
      headline: "Your relay doesn't take this version",
      detail: `${relay.host} answers, but turns this version of Kleio away.`,
      fix: [
        { text: `Update Kleio on this ${device}.` },
        { text: `Or update the relay on ${relay.host}.` },
        checkAgain,
      ],
    };
  }
  if (link.dialling) {
    return {
      checks,
      tone: "warn",
      badge: "Reconnecting",
      headline: `Reconnecting to ${hostLabel}…`,
      detail: "Kleio is looking for it through its relays.",
      fix: [],
    };
  }
  // The link is up, and Kleio didn't answer in time.
  if (link.connected) {
    return {
      ...down,
      badge: "Disconnected",
      headline: `Kleio on ${hostLabel} isn't answering`,
      detail: `The link to ${hostLabel} is up, but Kleio there didn't reply in time.`,
      fix: [...restartHost(host, hostLabel), checkAgain],
    };
  }
  return {
    checks,
    tone: "warn",
    badge: "Checking",
    headline: `Can't reach ${hostLabel} yet`,
    detail: "Kleio is finding out why, and trying again.",
    fix: [{ text: `Wait a moment, then ${press} Check again.` }],
  };
}

/** Connected over the link: which way, and whether a relay is slowing it. */
function connectedOverLink(
  { link, hostLabel, device }: LinkDiagnosisInput,
  checks: CheckLine[],
): Diagnosis {
  const keepsGoing = `Chats, specialists and code run on ${hostLabel}, so they keep going when this ${device} sleeps.`;
  if (link.rateLimited) {
    return {
      checks,
      tone: "warn",
      badge: "Slowed",
      headline: `Connected to ${hostLabel}, slowly`,
      detail: link.pathN0
        ? "Slowed by the shared relay, to about 1 MB/s. Chats are slower while a file downloads. A relay of your own is faster."
        : "Slowed by your relay, which is limiting this connection. Chats are slower while a file downloads.",
      fix: [],
    };
  }
  const own = relayHost(link.pathAddr);
  const path =
    link.path === "direct"
      ? `Direct: this ${device} and ${hostLabel} reach each other without a relay.`
      : link.pathN0
        ? "Through the relay. n0's public relay is shared and rate-limited, so big files are slower."
        : link.path === "relay"
          ? `Through your relay${own ? ` (${own})` : ""}.`
          : "Everything's working.";
  return {
    checks,
    tone: "good",
    badge: "Connected",
    headline: `Connected to ${hostLabel}`,
    detail: `${path} ${keepsGoing}`,
    fix: [],
  };
}

/**
 * A verdict as a line for places with room for one (the gate, Setup, the home
 * pill's tooltip): its headline as a sentence, then what it means.
 */
export function diagnosisText(d: Diagnosis): string {
  const headline = /[.…!?]$/.test(d.headline) ? d.headline : `${d.headline}.`;
  return d.detail ? `${headline} ${d.detail}` : headline;
}
