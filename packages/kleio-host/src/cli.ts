#!/usr/bin/env node
// kleio-host CLI.
//
//   kleio-host init                      create state dir, keys, first admin token (prints it once)
//   kleio-host sidecar                   run the sidecar supervisor (launchd job 1)
//   kleio-host serve                     run the HTTP host (launchd job 2)
//   kleio-host pair [--admin] [--label]  mint a pair code (talks to the running host)
//   kleio-host devices                   list devices
//   kleio-host revoke <deviceId>         revoke a device
//   kleio-host status                    health
//
// `pair`/`devices`/`revoke`/`status` are thin HTTP clients against the local
// host using the admin token from `secure/admin.token` (written by `init`).

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";
import { createDeviceRegistry } from "./device-registry.js";
import { createFileKeychain, generateMasterKey } from "./file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER } from "./host.js";
import { apnsConfigFromEnv, createApnsPusher } from "./apns.js";
import { createPairOfferStore } from "./pair-offer.js";
import { hostPaths, type HostPaths } from "./paths.js";
import { createRingStore } from "./sse-ring.js";
import { createSidecarSupervisor } from "./sidecar.js";

const log = (msg: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
};

const flag = (name: string): boolean => process.argv.includes(name);

function ensureSecure(p: HostPaths): void {
  mkdirSync(p.secureDir, { recursive: true, mode: 0o700 });
  chmodSync(p.secureDir, 0o700);
  for (const key of [p.masterKey, p.controlRootKey]) {
    if (!existsSync(key)) {
      writeFileSync(key, generateMasterKey(), { mode: 0o600 });
      chmodSync(key, 0o600);
    }
  }
  for (const d of [p.rings, p.work, p.logs]) mkdirSync(d, { recursive: true });
}

function readControlRoot(p: HostPaths): string {
  return readFileSync(p.controlRootKey).toString("base64url");
}

async function openRegistry(p: HostPaths) {
  const registry = createDeviceRegistry({
    keychain: createFileKeychain({ keyPath: p.masterKey }),
    storePath: p.registry,
    log,
  });
  await registry.init();
  return registry;
}

function listenPort(): number {
  return Number(process.env.KLEIO_HOST_PORT ?? 8443);
}

function publicBase(): string {
  const url = process.env.KLEIO_PUBLIC_URL;
  if (!url) throw new Error("KLEIO_PUBLIC_URL must be set (e.g. https://mini.tailnet.ts.net:8443)");
  return url.replace(/\/$/, "");
}

// ------------------------------------------------------------------ commands

async function init(p: HostPaths): Promise<void> {
  ensureSecure(p);
  const registry = await openRegistry(p);
  const adminTokenPath = join(p.secureDir, "admin.token");
  if (existsSync(adminTokenPath) && registry.list().some((d) => d.admin && !d.revoked)) {
    log(`[init] already initialised at ${p.home}`);
    return;
  }
  const minted = await registry.mint(`${hostname()} admin`, { admin: true });
  if (!minted.ok) throw new Error(minted.error.message);
  writeFileSync(adminTokenPath, minted.value.token, { mode: 0o600 });
  chmodSync(adminTokenPath, 0o600);
  log(
    `[init] state at ${p.home}; local admin device ${minted.value.device.deviceId} (token in secure/admin.token)`,
  );
}

async function sidecar(p: HostPaths): Promise<void> {
  const sidecarPath = process.env.KLEIO_SIDECAR_PATH;
  if (!sidecarPath) throw new Error("KLEIO_SIDECAR_PATH must point at app-sidecar.mjs");
  const sup = createSidecarSupervisor({
    nodeBin: process.env.KLEIO_NODE_BIN ?? process.execPath,
    sidecarPath,
    cwd: process.env.KLEIO_SIDECAR_CWD ?? p.work,
    // Nobody is at this machine's screen: the sidecar must never touch a
    // folder macOS would gate behind a privacy dialog (it hangs, not errors).
    env: { GG_APP_HEADLESS: "1" },
    endpointPath: p.sidecarEndpoint,
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

async function serve(p: HostPaths): Promise<void> {
  const registry = await openRegistry(p);
  const apns = createApnsPusher({ config: apnsConfigFromEnv(), log });
  log(
    apns.configured
      ? "[apns] configured"
      : "[apns] not configured (KLEIO_APNS_* unset); nudges off",
  );
  const host = createHost({
    apns,
    listenPort: listenPort(),
    publicBaseUrl: publicBase(),
    nodeId: new URL(publicBase()).hostname,
    registry,
    offers: createPairOfferStore(),
    rings: createRingStore({ directory: p.rings, log }),
    sidecarEndpointPath: p.sidecarEndpoint,
    controlRootKey: readControlRoot(p),
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
  const token = readFileSync(join(p.secureDir, "admin.token"), "utf8").trim();
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

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const p = hostPaths();
  switch (cmd) {
    case "init":
      return init(p);
    case "sidecar":
      return sidecar(p);
    case "serve":
      return serve(p);
    case "pair": {
      const r = await adminCall(p, "POST", "/kleio/pair/offer", { admin: flag("--admin") });
      if (r.status !== 200) throw new Error(`pair failed: ${r.status} ${JSON.stringify(r.body)}`);
      const b = r.body as { display: string; expiresAt: number; admin: boolean };
      process.stdout.write(
        `\n  Pair code:  ${b.display}${b.admin ? "   (admin)" : ""}\n  Expires:    ${new Date(b.expiresAt).toLocaleTimeString()}\n\n`,
      );
      return;
    }
    case "devices": {
      const r = await adminCall(p, "GET", "/kleio/devices");
      const devices = (
        r.body as {
          devices: {
            deviceId: string;
            label: string;
            created: string;
            lastSeen: string | null;
            revoked: boolean;
            admin: boolean;
          }[];
        }
      ).devices;
      for (const d of devices) {
        process.stdout.write(
          `${d.revoked ? "✗" : "✓"} ${d.deviceId}  ${d.label}${d.admin ? " [admin]" : ""}  paired ${d.created.slice(0, 10)}  seen ${d.lastSeen?.slice(0, 16) ?? "never"}\n`,
        );
      }
      return;
    }
    case "revoke": {
      const id = process.argv[3];
      if (!id) throw new Error("usage: kleio-host revoke <deviceId>");
      const r = await adminCall(p, "POST", `/kleio/devices/${encodeURIComponent(id)}/revoke`);
      if (r.status !== 200) throw new Error(`revoke failed: ${r.status} ${JSON.stringify(r.body)}`);
      process.stdout.write(`revoked ${id}\n`);
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
      });
      process.stdout.write(`${r}\n`);
      return;
    }
    default:
      process.stderr.write("usage: kleio-host <init|sidecar|serve|pair|devices|revoke|status>\n");
      process.exit(2);
  }
}

main().catch((e) => {
  process.stderr.write(`kleio-host: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
