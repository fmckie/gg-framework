#!/usr/bin/env node
// kleio-host CLI.
//
//   kleio-host init                      create state dir, keys, first admin token (prints it once)
//   kleio-host sidecar                   run the sidecar supervisor (launchd job 1)
//   kleio-host serve                     run the HTTP host (launchd job 2)
//   kleio-host pair [--admin] [--label]  mint a pair code: the code, its QR code and pairing text;
//                                        then, in a terminal, ask to allow the device that brings
//                                        it over the link
//   kleio-host devices                   list devices, with each link key's prefix and last path
//   kleio-host revoke <deviceId|key>     revoke a device, by ID or a prefix of its link key
//   kleio-host status                    health, and the link's
//   kleio-host capture-check [--no-sites] check page capture can't reach this Mac's network
//
// `pair`/`devices`/`revoke`/`status` are thin HTTP clients against the local
// host using the admin token from `secure/admin.token` (written by `init`).

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createSecretLock, type SecretLock } from "./acl.js";
import { createDeviceRegistry, type PairedDevice } from "./device-registry.js";
import { createFileKeychain } from "./file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER } from "./host.js";
import { checkedPublicUrl } from "./public-url.js";
import { apnsConfigFromEnv, createApnsPusher } from "./apns.js";
import { runCaptureCheck } from "./capture-check.js";
import { createCapturer, defaultCacheDir, defaultHelperPath, macHelperBackend } from "./capture.js";
import {
  DEFAULT_LINK_PORT,
  isUpstreamToken,
  readLinkState,
  ticketName,
  type LinkOptions,
  type LinkPeer,
  type LinkStateRead,
} from "./link.js";
import {
  askLines,
  askQuestion,
  decidedText,
  deviceFrom,
  deviceLine,
  isYes,
  linkHostBin,
  linkStatusLines,
  NO_TERMINAL_LINES,
  noTicketText,
  PAIR_WATCH_INTERVAL_MS,
  pairWatch,
  revokeTarget,
  stillAsks,
  watchText,
} from "./link-cli.js";
import { readLinkPublicKey, readPairPublicKey } from "./link-secrets.js";
import { settleNodeId, type NodeIdSource } from "./node-id.js";
import { createPairOfferStore, type PairClaimState, type PairOfferState } from "./pair-offer.js";
import { hostPaths, type HostPaths } from "./paths.js";
import { ensureLinkSecrets, ensureSecure, lockFailureMessage, lockSecrets } from "./secure-dir.js";
import { createRingStore } from "./sse-ring.js";
import { createSidecarSupervisor } from "./sidecar.js";
import { sidecarAppEnv } from "./sidecar-env.js";
import { readWorkspaceRoots } from "./workspace-roots.js";
import { runFile, runOptions } from "./run-file.js";

const log = (msg: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
};

const flag = (name: string): boolean => process.argv.includes(name);

/** Lock the state folder's secrets to this user, or stop the command (exit 1). */
async function mustLockSecrets(p: HostPaths, lock: SecretLock): Promise<void> {
  const locked = await lockSecrets(p, lock);
  if (!locked.ok) throw new Error(lockFailureMessage(locked.error));
}

function readControlRoot(p: HostPaths): string {
  return readFileSync(p.controlRootKey).toString("base64url");
}

async function openRegistry(p: HostPaths, lock: SecretLock) {
  const registry = createDeviceRegistry({
    keychain: createFileKeychain({ keyPath: p.masterKey }),
    storePath: p.registry,
    linkAllowPath: p.linkAllow,
    secretLock: lock,
    log,
  });
  await registry.init();
  return registry;
}

function listenPort(): number {
  return Number(process.env.KLEIO_HOST_PORT ?? 8443);
}

/**
 * KLEIO_PUBLIC_URL without its trailing slash: where devices reach this host
 * over their own network (Tailscale, another VPN, or a TLS proxy). Unset on a
 * host reached over the link only.
 */
function publicBase(): string | undefined {
  return checkedPublicUrl(process.env.KLEIO_PUBLIC_URL);
}

/** The link listener's port on 127.0.0.1 (see link.ts). */
function linkPort(): number {
  const raw = process.env.KLEIO_LINK_PORT ?? String(DEFAULT_LINK_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`KLEIO_LINK_PORT must be a port number, not ${JSON.stringify(raw)}`);
  return port;
}

/** The link as `serve` runs it: its secrets are made by now (ensureLinkSecrets). */
function linkOptions(p: HostPaths, publicKey: string, pairKey: string): LinkOptions {
  const upstreamToken = readFileSync(p.linkUpstreamToken, "utf8").trim();
  if (!isUpstreamToken(upstreamToken)) {
    throw new Error(
      `${p.linkUpstreamToken} isn't a token. Remove it and start kleio-host again to make a new one, then restart kleio-link-host.`,
    );
  }
  return {
    port: linkPort(),
    upstreamToken,
    publicKey,
    pairKey,
    dir: p.linkDir,
    // The machine's name as people know it: "Wills-Mac-mini.local" is "Wills-Mac-mini".
    name: ticketName(hostname().split(".")[0] ?? ""),
  };
}

/** The static-site preview origin's port (see preview.ts). */
function previewPort(): number {
  const raw = process.env.KLEIO_PREVIEW_PORT ?? "8444";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`KLEIO_PREVIEW_PORT must be a port number, not ${JSON.stringify(raw)}`);
  return port;
}

/**
 * The preview origin's port and public base: KLEIO_PREVIEW_URL, else the
 * public URL on the preview port. Null on a host with neither, which has no
 * site previews: a phone couldn't open them.
 */
function previewOrigin(publicUrl: string | undefined): { port: number; base: string } | null {
  const port = previewPort();
  const given = process.env.KLEIO_PREVIEW_URL;
  if (given) return { port, base: given.replace(/\/$/, "") };
  if (publicUrl === undefined) return null;
  const url = new URL(publicUrl);
  url.port = String(port);
  return { port, base: url.origin };
}

const NODE_ID_SOURCE: Readonly<Record<NodeIdSource, string>> = {
  stored: "stored",
  public_url: "KLEIO_PUBLIC_URL's host name, now stored",
  link_key: "from the link key, now stored",
};

// ------------------------------------------------------------------ commands

async function init(p: HostPaths, lock: SecretLock): Promise<void> {
  const secured = await ensureSecure(p, lock);
  if (!secured.ok) throw new Error(lockFailureMessage(secured.error));
  const registry = await openRegistry(p, lock);
  const adminTokenPath = p.adminToken;
  if (existsSync(adminTokenPath) && registry.list().some((d) => d.admin && !d.revoked)) {
    log(`[init] already initialised at ${p.home}`);
    return;
  }
  const minted = await registry.mint(`${hostname()} admin`, { admin: true });
  if (!minted.ok) throw new Error(minted.error.message);
  // Written inside the locked secure/, so it inherits the lock; then locked itself.
  writeFileSync(adminTokenPath, minted.value.token, { mode: 0o600 });
  chmodSync(adminTokenPath, 0o600);
  const locked = await lock.lock(adminTokenPath, "file");
  if (!locked.ok) {
    throw new Error(lockFailureMessage({ path: adminTokenPath, error: locked.error }));
  }
  log(
    `[init] state at ${p.home}; local admin device ${minted.value.device.deviceId} (token in secure/admin.token)`,
  );
}

async function sidecar(p: HostPaths, lock: SecretLock): Promise<void> {
  await mustLockSecrets(p, lock);
  const sidecarPath = process.env.KLEIO_SIDECAR_PATH;
  if (!sidecarPath) throw new Error("KLEIO_SIDECAR_PATH must point at app-sidecar.mjs");
  // Kleio's own settings file and projects folder, apart from the upstream app's.
  const env = sidecarAppEnv(process.env, homedir());
  mkdirSync(env.GG_APP_PROJECTS_DIR, { recursive: true });
  log(`[sidecar] projects folder ${env.GG_APP_PROJECTS_DIR}`);
  const sup = createSidecarSupervisor({
    nodeBin: process.env.KLEIO_NODE_BIN ?? process.execPath,
    sidecarPath,
    cwd: process.env.KLEIO_SIDECAR_CWD ?? p.work,
    env,
    endpointPath: p.sidecarEndpoint,
    secretLock: lock,
    log,
  });
  const stop = (): void => {
    log("[sidecar] stopping");
    void sup.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  sup.start();
  await sup.ready();
}

async function serve(p: HostPaths, lock: SecretLock): Promise<void> {
  await mustLockSecrets(p, lock);
  const registry = await openRegistry(p, lock);
  // A host set up before the link has neither of its secrets yet.
  const linkSecrets = await ensureLinkSecrets(p, lock);
  if (!linkSecrets.ok) throw new Error(lockFailureMessage(linkSecrets.error));
  const publicUrl = publicBase();
  const linkKey = await readLinkPublicKey(p.linkKey);
  if (!linkKey.ok) throw new Error(linkKey.error);
  const pairKey = await readPairPublicKey(p.linkPairKey);
  if (!pairKey.ok) throw new Error(pairKey.error);
  const link = linkOptions(p, linkKey.value, pairKey.value);
  const node = await settleNodeId({
    path: p.nodeId,
    ...(publicUrl !== undefined ? { publicUrl } : {}),
    linkPublicKey: () => Promise.resolve(linkKey),
  });
  if (!node.ok) throw new Error(node.error);
  log(`[host] node ID ${node.value.nodeId} (${NODE_ID_SOURCE[node.value.source]})`);
  if (publicUrl === undefined) {
    log(
      "[host] no KLEIO_PUBLIC_URL: devices reach this host over the link only, site previews are off, and the Apps sign-in ends on Composio's own page",
    );
  }
  const preview = previewOrigin(publicUrl);
  const apns = createApnsPusher({ config: apnsConfigFromEnv(), log });
  log(
    apns.configured
      ? "[apns] configured"
      : "[apns] not configured (KLEIO_APNS_* unset); nudges off",
  );
  // Her voice's shows of web pages and PDFs: the macOS helper draws them. On
  // a host that can't, the capturer says why once, and those shows say so.
  const capture = createCapturer({
    backend: macHelperBackend({ path: defaultHelperPath() }),
    cacheDir: defaultCacheDir(),
    log,
  });
  const host = createHost({
    apns,
    capture,
    diagnosticsDir: p.logs,
    homeCwd: process.env.KLEIO_HOME_CWD || join(homedir(), "Kleio"),
    // The same projects folders the sidecar runs Chat and Code sessions in.
    workspaceRoots: () => readWorkspaceRoots(process.env, homedir()),
    ...(process.env.KLEIO_BLOB_DEFAULT_MODEL
      ? { blobDefaultModel: process.env.KLEIO_BLOB_DEFAULT_MODEL }
      : {}),
    composio: {
      ...(process.env.KLEIO_COMPOSIO_API_KEY ? { apiKey: process.env.KLEIO_COMPOSIO_API_KEY } : {}),
      ...(process.env.KLEIO_COMPOSIO_BASE_URL
        ? { baseUrl: process.env.KLEIO_COMPOSIO_BASE_URL }
        : {}),
    },
    jev: {
      ...(process.env.TYPESAFE_API_KEY ? { apiKey: process.env.TYPESAFE_API_KEY } : {}),
      ...(process.env.TYPESAFE_BASE_URL ? { baseUrl: process.env.TYPESAFE_BASE_URL } : {}),
    },
    // Kleio's conversational voice: the key is normally set from Settings.
    voice: {
      ...(process.env.KLEIO_OPENAI_API_KEY ? { apiKey: process.env.KLEIO_OPENAI_API_KEY } : {}),
      ...(process.env.KLEIO_VOICE_MODEL ? { model: process.env.KLEIO_VOICE_MODEL } : {}),
    },
    listenPort: listenPort(),
    ...(publicUrl !== undefined ? { publicBaseUrl: publicUrl } : {}),
    ...(preview ? { previewPort: preview.port, previewBaseUrl: preview.base } : {}),
    nodeId: node.value.nodeId,
    link,
    registry,
    offers: createPairOfferStore(),
    rings: createRingStore({ directory: p.rings, log }),
    sidecarEndpointPath: p.sidecarEndpoint,
    controlRootKey: readControlRoot(p),
    secretLock: lock,
    log,
  });
  const stop = (): void => {
    log("[host] stopping");
    void host.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await host.start();
}

function adminCall(
  p: HostPaths,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const token = readFileSync(p.adminToken, "utf8").trim();
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        host: "127.0.0.1",
        port: listenPort(),
        method,
        path,
        headers: {
          [DEVICE_TOKEN_HEADER]: token,
          ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
        },
      },
      (res) => {
        let s = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (s += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(s) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: s });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** The link's state, as `devices` and `status` show it. */
async function linkState(p: HostPaths): Promise<{ read: LinkStateRead; key: string | null }> {
  const key = await readLinkPublicKey(p.linkKey);
  if (!key.ok) return { read: { kind: "missing" }, key: null };
  // kleio-link-host doesn't start without it: `serve` makes it.
  const pairKey = await readPairPublicKey(p.linkPairKey);
  if (!pairKey.ok) return { read: { kind: "missing" }, key: key.value };
  const read = await readLinkState(p.linkDir, key.value, pairKey.value, new Date());
  return { read, key: key.value };
}

/** The paths each device's link connection last took. */
async function linkPeers(p: HostPaths): Promise<readonly LinkPeer[]> {
  const { read } = await linkState(p);
  return read.kind === "running" || read.kind === "stale" ? read.state.peers : [];
}

/** Every device, from the running host. */
async function listDevices(p: HostPaths): Promise<PairedDevice[]> {
  const r = await adminCall(p, "GET", "/kleio/devices");
  if (r.status !== 200) throw new Error(`devices failed: ${r.status} ${JSON.stringify(r.body)}`);
  return (r.body as { devices: PairedDevice[] }).devices.map(deviceFrom);
}

/** The live code's state (GET /kleio/pair): never the code, nor a device's nonce or whole key. */
async function pairState(p: HostPaths): Promise<PairOfferState> {
  const r = await adminCall(p, "GET", "/kleio/pair");
  if (r.status !== 200) throw new Error(`pair state failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as PairOfferState;
}

/** What came of asking whether to allow a device. */
type Asked =
  | { readonly kind: "answer"; readonly text: string }
  /** The code moved on from what was asked: another device tried it, or the device stopped waiting. */
  | { readonly kind: "moved" }
  /** The terminal's input ended (Ctrl-D): nothing can be asked any more. */
  | { readonly kind: "closed" };

/**
 * Ask whether to allow `claim`, checking all the while (`still`) that the
 * code still waits on that question, so the question is never answered
 * about a device other than the one shown.
 */
async function askAllow(
  rl: Interface,
  inputEnded: AbortSignal,
  claim: PairClaimState,
  admin: boolean,
  still: () => Promise<boolean>,
): Promise<Asked> {
  if (inputEnded.aborted) return { kind: "closed" };
  const lines = askLines(claim, admin).map((line) => `  ${line}\n`);
  process.stdout.write(`\n${lines.join("")}`);
  const moved = new AbortController();
  const watching = (async (): Promise<{ readonly error: unknown } | null> => {
    try {
      while (!moved.signal.aborted) {
        await sleep(PAIR_WATCH_INTERVAL_MS, undefined, { signal: moved.signal });
        if (!(await still())) moved.abort();
      }
      return null;
    } catch (error) {
      if (moved.signal.aborted) return null;
      moved.abort();
      return { error };
    }
  })();
  let asked: Asked;
  try {
    const text = await rl.question(`  ${askQuestion(claim)}`, {
      signal: AbortSignal.any([moved.signal, inputEnded]),
    });
    asked = { kind: "answer", text };
  } catch (error) {
    if (!moved.signal.aborted && !inputEnded.aborted) {
      moved.abort();
      await watching;
      throw error;
    }
    // readline ends the question's line itself.
    asked = inputEnded.aborted ? { kind: "closed" } : { kind: "moved" };
  }
  moved.abort();
  const failed = await watching;
  if (failed) throw failed.error;
  return asked;
}

/**
 * In a terminal, `pair` stays with the code it showed. A device that brings
 * it over the link waits for an admin's Allow, so this asks for one, showing
 * the device's name and device code. True once the code pairs a device.
 */
async function watchPairing(p: HostPaths, expiresAt: number, admin: boolean): Promise<boolean> {
  // Not a terminal of its own (no raw mode), so Ctrl-C stops `pair` as before.
  // Reading all along drops anything typed before a question: an answer
  // typed ahead can't allow a device nobody has seen.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const inputEnded = new AbortController();
  rl.once("close", () => inputEnded.abort());
  let said: string | null = null;
  const say = (text: string): void => {
    if (text !== said) process.stdout.write(`  ${text}\n`);
    said = text;
  };
  const watch = async (): Promise<ReturnType<typeof pairWatch>> =>
    pairWatch(await pairState(p), expiresAt, Date.now());
  try {
    for (;;) {
      const w = await watch();
      if (w.kind !== "ask") {
        const text = watchText(w);
        if (text !== null) say(text);
        if (w.kind === "paired") return true;
        if (w.kind === "gone") return false;
        await sleep(PAIR_WATCH_INTERVAL_MS);
        continue;
      }
      const asked = await askAllow(rl, inputEnded.signal, w.claim, admin, async () =>
        stillAsks(await watch(), w.claim),
      );
      if (asked.kind === "closed") {
        say("No answer: the terminal's input ended. Nothing was allowed.");
        return false;
      }
      if (asked.kind === "moved") continue;
      const allow = isYes(asked.text);
      const decided = decidedText(
        allow,
        w.claim,
        await adminCall(p, "POST", "/kleio/pair/decide", {
          allow,
          deviceCode: w.claim.deviceCode,
        }),
      );
      if (!decided.ok) throw new Error(decided.error);
      say(decided.value.text);
      if (decided.value.done) return false;
    }
  } finally {
    rl.close();
  }
}

/**
 * The pairing QR code, drawn by kleio-link-host (`qr` reads the ticket on
 * stdin, never from its arguments, which other users can see), then the
 * ticket as text, for "Paste pairing text" on a Mac.
 */
async function showTicket(ticket: string): Promise<void> {
  const bin = linkHostBin(process.env, process.platform, fileURLToPath(import.meta.url));
  if (!bin.ok) {
    process.stdout.write(`  No QR code: ${bin.error}\n\n`);
  } else {
    const color = process.stdout.isTTY ? ["--color"] : [];
    const drawn = await runFile(
      bin.value,
      ["qr", ...color],
      runOptions(10_000, 256 * 1024),
      ticket,
    );
    if (drawn.ok && drawn.value.exitCode === 0) {
      process.stdout.write(`${drawn.value.stdout}\n`);
    } else {
      const why = drawn.ok
        ? `it exited with ${drawn.value.exitCode}: ${drawn.value.stderr.trim()}`
        : drawn.error.message;
      process.stdout.write(
        `  No QR code: kleio-link-host at ${bin.value} couldn't draw it (${why}).\n\n`,
      );
    }
  }
  process.stdout.write(
    `  Pairing text, for "Paste pairing text" in Kleio on a Mac:\n\n  ${ticket}\n\n`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const p = hostPaths();
  const lock = createSecretLock({ platform: process.platform, env: process.env, log });
  switch (cmd) {
    case "init":
      return init(p, lock);
    case "sidecar":
      return sidecar(p, lock);
    case "serve":
      return serve(p, lock);
    case "pair": {
      const r = await adminCall(p, "POST", "/kleio/pair/offer", { admin: flag("--admin") });
      if (r.status !== 200) throw new Error(`pair failed: ${r.status} ${JSON.stringify(r.body)}`);
      const b = r.body as {
        display: string;
        expiresAt: number;
        admin: boolean;
        ticket?: string | null;
        ticketError?: string | null;
      };
      process.stdout.write(
        `\n  Pair code:  ${b.display}${b.admin ? "   (admin)" : ""}\n  Expires:    ${new Date(b.expiresAt).toLocaleTimeString()}\n\n`,
      );
      if (typeof b.ticket === "string") await showTicket(b.ticket);
      else
        process.stdout.write(`  No QR code: ${noTicketText(b.ticketError ?? null, p.linkDir)}\n\n`);
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stdout.write(`${NO_TERMINAL_LINES.map((line) => `  ${line}\n`).join("")}\n`);
        return;
      }
      if (!(await watchPairing(p, b.expiresAt, b.admin))) process.exitCode = 1;
      return;
    }
    case "devices": {
      const devices = await listDevices(p);
      const peers = await linkPeers(p);
      for (const d of devices) process.stdout.write(`${deviceLine(d, peers)}\n`);
      return;
    }
    case "revoke": {
      const arg = process.argv[3];
      if (!arg) throw new Error("usage: kleio-host revoke <deviceId | link key prefix>");
      const target = revokeTarget(await listDevices(p), arg);
      if (!target.ok) throw new Error(target.error);
      const id = target.value.deviceId;
      const r = await adminCall(p, "POST", `/kleio/devices/${encodeURIComponent(id)}/revoke`);
      if (r.status !== 200) throw new Error(`revoke failed: ${r.status} ${JSON.stringify(r.body)}`);
      process.stdout.write(`revoked ${id} (${target.value.label})\n`);
      return;
    }
    case "status": {
      const r = await new Promise<string>((resolve, reject) => {
        request({ host: "127.0.0.1", port: listenPort(), path: "/kleio/health" }, (res) => {
          let s = "";
          res.on("data", (c) => (s += c));
          res.on("end", () => resolve(s));
        })
          .on("error", reject)
          .end();
      }).catch((e: unknown) => {
        process.exitCode = 1;
        return `host: not answering on 127.0.0.1:${listenPort()} (${e instanceof Error ? e.message : String(e)})`;
      });
      process.stdout.write(`${r}\n`);
      const link = await linkState(p);
      for (const line of linkStatusLines(link.read, link.key)) process.stdout.write(`${line}\n`);
      return;
    }
    case "capture-check": {
      const passed = await runCaptureCheck({
        sites: !flag("--no-sites"),
        out: (line) => process.stdout.write(`${line}\n`),
      });
      process.exit(passed ? 0 : 1);
      return;
    }
    default:
      process.stderr.write(
        "usage: kleio-host <init|sidecar|serve|pair|devices|revoke|status|capture-check>\n",
      );
      process.exit(2);
  }
}

main().catch((e) => {
  process.stderr.write(`kleio-host: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
