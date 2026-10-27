// What `kleio-host pair`, `devices`, `revoke` and `status` say about the
// link (cli.ts), and what `pair` asks before a device pairs over it. Pure,
// so the tests check the words.

import { dirname, isAbsolute, join, resolve } from "node:path";
import type { PairedDevice } from "./device-registry.js";
import { isN0RelayUrl, keyPrefix, type LinkPeer, type LinkStateRead } from "./link.js";
import type { PairClaimState, PairOfferState } from "./pair-offer.js";
import { err, ok, type Result } from "./result.js";

/** The shortest prefix of a link key `revoke` takes. */
export const MIN_KEY_PREFIX = 8;

/**
 * kleio-link-host, by absolute path, never looked up on PATH:
 * KLEIO_LINK_HOST_BIN, or bin/ beside this install's dist/
 * (`~/kleio-host/bin/kleio-link-host` on the mini).
 */
export function linkHostBin(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  cliFile: string,
): Result<string, string> {
  const given = env.KLEIO_LINK_HOST_BIN;
  if (given !== undefined && given !== "") {
    return isAbsolute(given)
      ? ok(given)
      : err(`KLEIO_LINK_HOST_BIN must be an absolute path, not ${JSON.stringify(given)}`);
  }
  const exe = platform === "win32" ? "kleio-link-host.exe" : "kleio-link-host";
  return ok(resolve(dirname(cliFile), "..", "bin", exe));
}

/** Why `pair` has no QR code (POST /kleio/pair/offer's `ticketError`), for the person at the terminal. */
export function noTicketText(ticketError: string | null, linkDir: string): string {
  switch (ticketError) {
    case "no_link":
      return "this host doesn't serve Kleio's link.";
    case "link_down":
      return "kleio-link-host isn't running, or isn't on a relay yet. Start it, or give it a moment, then run kleio-host pair again.";
    case "config":
      return `the relay list, ${join(linkDir, "config.json")}, can't be read. kleio-host's log says why.`;
    default:
      return "the link's ticket couldn't be made. kleio-host's log says why.";
  }
}

/**
 * A device as GET /kleio/devices gives it; a host from before the link has no
 * `linkKey`, and one from before relay lists no `listVersion`.
 */
export function deviceFrom(raw: PairedDevice): PairedDevice {
  return {
    ...raw,
    linkKey: typeof raw.linkKey === "string" ? raw.linkKey : null,
    listVersion: typeof raw.listVersion === "number" ? raw.listVersion : null,
  };
}

/**
 * The device `revoke <arg>` means: the one with that ID, or else the one
 * paired device whose link key starts with `arg`, as `devices` and
 * kleio-link-host's log show keys (at least MIN_KEY_PREFIX hex characters).
 */
export function revokeTarget(
  devices: readonly PairedDevice[],
  arg: string,
): Result<PairedDevice, string> {
  const byId = devices.find((d) => d.deviceId === arg);
  if (byId) return ok(byId);
  const prefix = arg.toLowerCase();
  if (!/^[0-9a-f]+$/.test(prefix)) {
    return err(`No device has the ID ${arg}. kleio-host devices lists them.`);
  }
  if (prefix.length < MIN_KEY_PREFIX) {
    return err(`Give at least ${MIN_KEY_PREFIX} characters of a link key, or a device ID.`);
  }
  const matches = devices.filter(
    (d) => !d.revoked && d.linkKey !== null && d.linkKey.startsWith(prefix),
  );
  const [only, ...more] = matches;
  if (only !== undefined && more.length === 0) return ok(only);
  return err(
    only === undefined
      ? `No paired device has a link key starting ${prefix}.`
      : `${matches.length} paired devices have a link key starting ${prefix}: give more of it.`,
  );
}

/**
 * One line of `devices`. A link device shows its key's prefix and the path
 * its connection last took; any other was paired over its own network.
 */
export function deviceLine(d: PairedDevice, peers: readonly LinkPeer[]): string {
  const line = `${d.revoked ? "✗" : "✓"} ${d.deviceId}  ${d.label}${d.admin ? " [admin]" : ""}  paired ${d.created.slice(0, 10)}  seen ${d.lastSeen?.slice(0, 16) ?? "never"}`;
  if (d.linkKey === null) return `${line}  own network`;
  const peer = peers.find((p) => p.key === d.linkKey);
  const path = peer ? `${peer.path} at ${peer.at.slice(0, 16)}` : "no connection seen";
  return `${line}  link ${keyPrefix(d.linkKey)} (${path})`;
}

/** What `status` says about the link: kleio-link-host's state, and the host's key. */
export function linkStatusLines(read: LinkStateRead, publicKey: string | null): string[] {
  const key = publicKey === null ? "no key yet" : `key ${keyPrefix(publicKey)}`;
  switch (read.kind) {
    case "missing":
      return [`link: kleio-link-host hasn't written its state yet; ${key}`];
    case "invalid":
      return [`link: ${read.message}`];
    case "stale":
      return [
        `link: kleio-link-host isn't running (its state is from ${read.state.updatedAt}); ${key}`,
      ];
    case "running": {
      const s = read.state;
      const relay =
        s.relay === null ? "on no relay" : `on ${s.relay}${isN0RelayUrl(s.relay) ? " (n0's)" : ""}`;
      return [
        `link: running, ${relay}${s.rateLimited ? ", slowed by its relay" : ""}; ${key}`,
        `      ${s.connections} connection(s); direct addresses: ${s.addrs.join(", ") || "none"}`,
      ];
    }
  }
}

/** How often `pair`, in a terminal, checks on the code it showed. */
export const PAIR_WATCH_INTERVAL_MS = 1_000;

/**
 * Where the code `pair` showed has got to, from GET /kleio/pair. The code is
 * known by its `expiresAt`: a code shown since, from an admin device,
 * replaces it.
 */
export type PairWatch =
  /** No device has brought it yet. */
  | { readonly kind: "waiting" }
  /** A device brought it over the link and waits for an admin's Allow. */
  | { readonly kind: "ask"; readonly claim: PairClaimState }
  /** An admin allowed that device, and it's finishing on the device. */
  | { readonly kind: "allowed"; readonly claim: PairClaimState }
  /** It paired a device: over the link, the one in `claim`; with none, off it. */
  | { readonly kind: "paired"; readonly claim: PairClaimState | null }
  /** It's gone without pairing a device. */
  | { readonly kind: "gone"; readonly why: "expired" | "replaced" | "ended" };

export function pairWatch(state: PairOfferState, expiresAt: number, now: number): PairWatch {
  if (!state.active) return { kind: "gone", why: now >= expiresAt ? "expired" : "ended" };
  if (state.expiresAt !== expiresAt) return { kind: "gone", why: "replaced" };
  if (state.redeemed) return { kind: "paired", claim: state.claim };
  if (state.claim === null) return { kind: "waiting" };
  return state.claim.allowed
    ? { kind: "allowed", claim: state.claim }
    : { kind: "ask", claim: state.claim };
}

/** A waiting device by its name, or as "the device" when it gave none. */
function nameOf(claim: PairClaimState): string {
  return claim.label ?? "the device";
}

const GONE_TEXT = {
  expired: "The code expired. Run kleio-host pair for a new one.",
  replaced: "A newer pair code, shown since, replaced this one.",
  ended: "An admin device took the code away, or denied the device.",
} as const satisfies Record<Extract<PairWatch, { kind: "gone" }>["why"], string>;

/** What `pair` says as the code gets to `w`; null when it asks instead (askLines). */
export function watchText(w: PairWatch): string | null {
  switch (w.kind) {
    case "waiting":
      return "Waiting for a device to use the code (Ctrl-C to stop).";
    case "ask":
      return null;
    case "allowed":
      return `Allowed ${nameOf(w.claim)}. Finishing on the device…`;
    case "paired":
      return w.claim ? `Paired ${nameOf(w.claim)}.` : "Paired a device off the link.";
    case "gone":
      return GONE_TEXT[w.why];
  }
}

/**
 * What `pair` shows before it asks whether to allow `claim`: its name, its
 * device code, which the device shows too, and whether another device also
 * tried the code.
 */
export function askLines(claim: PairClaimState, admin: boolean): string[] {
  return [
    `${claim.label ?? "A device with no name"} wants to pair${admin ? ", as an admin device" : ""}.`,
    `Device code ${claim.deviceCode}: allow it only if the device shows the same.`,
    ...(claim.contested ? ["Another device also tried this code."] : []),
  ];
}

/** The question. Enter alone is No. */
export function askQuestion(claim: PairClaimState): string {
  return `Allow ${claim.label ?? "this device"} (device code ${claim.deviceCode})? [y/N] `;
}

/** Whether an answer to askQuestion is Yes: y or yes, in any case. Anything else is No. */
export function isYes(answer: string): boolean {
  return /^\s*y(?:es)?\s*$/i.test(answer);
}

/**
 * Whether the code, now at `w`, still waits on the question asked about
 * `asked`: the same device, and no other device tried the code since.
 */
export function stillAsks(w: PairWatch, asked: PairClaimState): boolean {
  return (
    w.kind === "ask" &&
    w.claim.deviceCode === asked.deviceCode &&
    w.claim.contested === asked.contested
  );
}

/**
 * What `pair` says once POST /kleio/pair/decide answers its Allow (`allow`)
 * or Deny for `claim`, and whether that's the end: after a Deny the code no
 * longer works. A host's 409 means the device waiting has changed, or none
 * is, and `pair` looks again.
 */
export function decidedText(
  allow: boolean,
  claim: PairClaimState,
  answer: { readonly status: number; readonly body: unknown },
): Result<{ readonly text: string; readonly done: boolean }, string> {
  if (answer.status === 200) {
    return ok(
      allow
        ? { text: `Allowed ${nameOf(claim)}. Finishing on the device…`, done: false }
        : { text: `Denied ${nameOf(claim)}. The code no longer works.`, done: true },
    );
  }
  const error =
    answer.status === 409 && typeof answer.body === "object" && answer.body !== null
      ? (answer.body as { readonly error?: unknown }).error
      : undefined;
  if (error === "changed") {
    return ok({
      text: `A different device is waiting now, not ${nameOf(claim)} (device code ${claim.deviceCode}).`,
      done: false,
    });
  }
  if (error === "none_waiting") return ok({ text: "No device is waiting any more.", done: false });
  return err(`decide failed: ${answer.status} ${JSON.stringify(answer.body)}`);
}

/** What `pair` says when it can't ask: its input or output isn't a terminal. */
export const NO_TERMINAL_LINES: readonly string[] = [
  "Not a terminal, so kleio-host can't ask you here to allow a device.",
  "Over Kleio's link, a device waits for an admin to allow it before it pairs.",
  "To pair one, use Pair a device in Kleio on an admin device, which asks you,",
  "or run kleio-host pair in a terminal.",
];
