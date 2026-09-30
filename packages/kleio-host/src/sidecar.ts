// gg-app sidecar supervisor.
//
// Runs `node app-sidecar.mjs` exactly as gg-app/src-tauri/src/lib.rs does:
// GG_APP_PORT=0 (kernel-assigned), GG_APP_TOKEN=<random>, and the child prints
// `GG_APP_LISTENING <port> <token>` once bound. The supervisor launches it
// unchanged; the engine changes Kleio relies on are listed in host.ts.
//
// The chosen port and token are published to a 0600 "endpoint file" so the
// proxy — a separate process under its own launchd job — can find the sidecar
// without being its parent. Redeploying the proxy therefore never kills a run
// (Step 2 finding #2). The file is rewritten on every (re)spawn; the proxy
// re-reads it whenever a request to the sidecar fails to connect.

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { atomicWrite } from "./device-registry.js";

export interface SidecarEndpoint {
  readonly port: number;
  readonly token: string;
  readonly pid: number;
  readonly startedAt: string;
}

export interface SidecarSupervisorOptions {
  readonly nodeBin: string;
  readonly sidecarPath: string;
  readonly cwd: string;
  /** Where to publish { port, token, pid }. */
  readonly endpointPath: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (msg: string) => void;
  /** Max consecutive crashes inside `crashWindowMs` before giving up. */
  readonly maxCrashes?: number;
  readonly crashWindowMs?: number;
  /** Test seam. */
  readonly spawnImpl?: typeof spawn;
}

export interface SidecarSupervisor {
  start(): void;
  /** Resolves once the current child has printed its port. */
  ready(): Promise<SidecarEndpoint>;
  stop(): Promise<void>;
  endpoint(): SidecarEndpoint | null;
}

const HANDSHAKE = "GG_APP_LISTENING ";

export function createSidecarSupervisor(options: SidecarSupervisorOptions): SidecarSupervisor {
  const log = options.log ?? ((): void => {});
  const spawnImpl = options.spawnImpl ?? spawn;
  const maxCrashes = options.maxCrashes ?? 5;
  const crashWindowMs = options.crashWindowMs ?? 60_000;

  let child: ChildProcess | null = null;
  let current: SidecarEndpoint | null = null;
  let stopping = false;
  let crashes = 0;
  let lastStart = 0;
  let readyResolve: ((e: SidecarEndpoint) => void) | null = null;
  let readyPromise = new Promise<SidecarEndpoint>((r) => (readyResolve = r));

  function resetReady(): void {
    readyPromise = new Promise<SidecarEndpoint>((r) => (readyResolve = r));
  }

  function launch(): void {
    const token = randomUUID();
    lastStart = Date.now();
    current = null;
    child = spawnImpl(options.nodeBin, [options.sidecarPath], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, GG_APP_PORT: "0", GG_APP_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid ?? -1;
    log(`[sidecar] spawned pid=${pid}`);
    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (line.startsWith(HANDSHAKE)) {
          const port = Number(line.slice(HANDSHAKE.length).split(/\s+/)[0]);
          if (Number.isInteger(port) && port > 0) {
            current = { port, token, pid, startedAt: new Date(lastStart).toISOString() };
            void atomicWrite(options.endpointPath, `${JSON.stringify(current)}\n`, 0o600).then(
              () => log(`[sidecar] listening on 127.0.0.1:${port}; endpoint published`),
              (e) => log(`[sidecar] endpoint publish failed: ${String(e)}`),
            );
            readyResolve?.(current);
          }
          return;
        }
        log(`[sidecar:out] ${line}`);
      });
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on("line", (line) => log(`[sidecar:err] ${line}`));
    }
    child.on("exit", (code, signal) => {
      log(`[sidecar] exited code=${code} signal=${signal}`);
      child = null;
      current = null;
      resetReady();
      if (stopping) return;
      if (Date.now() - lastStart > crashWindowMs) crashes = 0;
      crashes += 1;
      if (crashes > maxCrashes) {
        log(`[sidecar] crashed ${crashes}x within ${crashWindowMs}ms; giving up`);
        process.exitCode = 1;
        return;
      }
      const delay = Math.min(30_000, 1000 * 2 ** (crashes - 1));
      log(`[sidecar] respawning in ${delay}ms`);
      setTimeout(launch, delay).unref();
    });
  }

  return {
    start() {
      if (child) return;
      stopping = false;
      launch();
    },
    ready: () => readyPromise,
    async stop() {
      stopping = true;
      const c = child;
      if (!c) return;
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          c.kill("SIGKILL");
        }, 5000);
        c.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
        c.kill("SIGTERM");
      });
    },
    endpoint: () => current,
  };
}

/** Read the endpoint file the supervisor publishes. Null when absent/invalid. */
export async function readSidecarEndpoint(path: string): Promise<SidecarEndpoint | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<SidecarEndpoint>;
    if (
      Number.isInteger(parsed.port) &&
      (parsed.port as number) > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
    ) {
      return parsed as SidecarEndpoint;
    }
    return null;
  } catch {
    return null;
  }
}
