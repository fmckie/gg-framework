// What `kleio-host pair`, `devices`, `revoke` and `status` say about the
// link (cli.ts). Pure, so the tests check the words.

import { dirname, isAbsolute, join, resolve } from "node:path";
import type { PairedDevice } from "./device-registry.js";
import { isN0RelayUrl, keyPrefix, type LinkPeer, type LinkStateRead } from "./link.js";
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
