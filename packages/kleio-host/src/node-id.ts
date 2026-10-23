// This host's node ID: the name admin control credentials are bound to (the
// macaroon `node` caveat, macaroon.ts) and the `host` a pairing hands a
// device. It used to be the public URL's hostname, read at every start, so a
// host that stopped using Tailscale would have failed every admin device's
// credential with `wrong-node`.
//
// Now it's settled once and kept in `node-id` (paths.ts): the public URL's
// hostname when there is one, so credentials minted before still verify,
// else a name from the link key. A stored ID wins over the URL from then on.

import { readFile } from "node:fs/promises";
import { atomicWrite } from "./device-registry.js";
import { err, ok, type Result } from "./result.js";

/** A host name, an IP address (IPv6 in brackets, as URL.hostname gives it) or a link name. */
const NODE_ID_RE = /^[A-Za-z0-9._:[\]-]{1,253}$/;

export function isNodeId(value: string): boolean {
  return NODE_ID_RE.test(value);
}

/** The node ID a public URL gives: its hostname, as before node-id was stored. */
export function nodeIdFromPublicUrl(publicUrl: string): string {
  return new URL(publicUrl).hostname;
}

/** The node ID of a host with no public URL: "kleio-" and its link key's first 16 hex characters. */
export function nodeIdFromLinkKey(publicKeyHex: string): string {
  return `kleio-${publicKeyHex.slice(0, 16)}`;
}

export type NodeIdSource = "stored" | "public_url" | "link_key";

export interface SettledNodeId {
  readonly nodeId: string;
  readonly source: NodeIdSource;
}

export interface SettleNodeIdOptions {
  /** The node-id file (paths.ts). */
  readonly path: string;
  /** KLEIO_PUBLIC_URL, when the host has one. */
  readonly publicUrl?: string;
  /** The link key's public half (64 hex characters), asked for only when it's needed. */
  readonly linkPublicKey: () => Promise<Result<string, string>>;
}

/**
 * The stored node ID, or the one to store now: the public URL's hostname,
 * else the link key's name. A stored file that isn't a node ID is an error,
 * never replaced, because a new ID fails every admin credential.
 */
export async function settleNodeId(
  options: SettleNodeIdOptions,
): Promise<Result<SettledNodeId, string>> {
  let stored: string | null = null;
  try {
    stored = (await readFile(options.path, "utf8")).trim();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") return err(`${options.path} can't be read (${code ?? "unreadable"})`);
  }
  if (stored !== null) {
    if (!isNodeId(stored)) {
      return err(
        `${options.path} doesn't hold a node ID. Admin devices' credentials are bound to it, so it isn't replaced: put back the name it held (the host's Tailscale name, if it had one), or delete it to settle a new one and pair admin devices again.`,
      );
    }
    return ok({ nodeId: stored, source: "stored" });
  }
  let settled: SettledNodeId;
  if (options.publicUrl !== undefined) {
    settled = { nodeId: nodeIdFromPublicUrl(options.publicUrl), source: "public_url" };
  } else {
    const key = await options.linkPublicKey();
    if (!key.ok) return err(key.error);
    settled = { nodeId: nodeIdFromLinkKey(key.value), source: "link_key" };
  }
  if (!isNodeId(settled.nodeId)) return err(`${settled.nodeId} can't be a node ID`);
  await atomicWrite(options.path, `${settled.nodeId}\n`, 0o644);
  return ok(settled);
}
