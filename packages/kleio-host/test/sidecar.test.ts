import type { ChildProcess, spawn, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecretLock } from "../src/acl.js";
import { ok } from "../src/result.js";
import {
  createSidecarSupervisor,
  IPC_STOP_ENV,
  IPC_STOP_IMPORT,
  type SidecarSupervisor,
} from "../src/sidecar.js";

/** Prints the handshake, then waits; see the file for its SIGTERM handling. */
const CHILD = resolve(__dirname, "fixtures/sidecar-child.mjs");

let dir: string;
let running: SidecarSupervisor | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kleio-sidecar-"));
});
afterEach(async () => {
  await running?.stop();
  running = null;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

/** A supervisor running the stand-in child the Windows way, on any OS. */
function windowsWay(
  env: Record<string, string>,
  stopGraceMs: number,
): { sup: SidecarSupervisor; logs: string[]; locked: string[] } {
  const logs: string[] = [];
  const locked: string[] = [];
  const secretLock: SecretLock = {
    lock: async (path) => {
      locked.push(path);
      return ok(undefined);
    },
  };
  const sup = createSidecarSupervisor({
    nodeBin: process.execPath,
    sidecarPath: CHILD,
    cwd: dir,
    endpointPath: join(dir, "sidecar.json"),
    env,
    platform: "win32",
    stopGraceMs,
    secretLock,
    log: (m) => logs.push(m),
  });
  running = sup;
  return { sup, logs, locked };
}

describe("stopping the sidecar on Windows (through its IPC channel)", () => {
  it("runs the sidecar's own SIGTERM teardown, with no hard kill", async () => {
    const marker = join(dir, "term");
    const { sup, logs, locked } = windowsWay({ KLEIO_TEST_MARKER: marker }, 15_000);
    sup.start();
    expect((await sup.ready()).port).toBe(4321);
    // The shim took its marker out of the environment, so nothing the
    // sidecar starts in turn acts on it.
    expect(logs).toContain("[sidecar:out] ipc-stop-env unset");
    // The endpoint file (it holds the token) was locked before it was filled.
    await until(() => logs.some((l) => l.endsWith("endpoint published")));
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatch(/sidecar\.json\.tmp-[0-9a-f]+$/);

    const asked = Date.now();
    await sup.stop();
    expect(readFileSync(marker, "utf8")).toBe("term");
    expect(logs).toContain("[sidecar] exited code=0 signal=null");
    expect(Date.now() - asked).toBeLessThan(15_000);
  }, 30_000);

  it("kills a sidecar whose teardown hangs once stopGraceMs is up", async () => {
    const marker = join(dir, "term");
    const { sup, logs } = windowsWay(
      { KLEIO_TEST_MARKER: marker, KLEIO_TEST_IGNORE_TERM: "1" },
      1000,
    );
    sup.start();
    await sup.ready();
    await sup.stop();
    // It was asked gently first, and then it was killed.
    expect(readFileSync(marker, "utf8")).toBe("term");
    expect(logs).toContain("[sidecar] exited code=null signal=SIGKILL");
  }, 30_000);
});

describe("how the sidecar is started", () => {
  interface Spawned {
    readonly file: string;
    readonly args: readonly string[];
    readonly options: SpawnOptions;
  }
  /** Records the spawn and hands back a child that never prints or exits. */
  function spySpawn(): { impl: typeof spawn; calls: Spawned[] } {
    const calls: Spawned[] = [];
    const impl = ((file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
      calls.push({ file, args: [...args], options });
      return new EventEmitter() as ChildProcess;
    }) as typeof spawn;
    return { impl, calls };
  }
  const noLock: SecretLock = { lock: async () => ok(undefined) };

  it("only Windows gets the IPC channel and the preloaded shim", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
      const { impl, calls } = spySpawn();
      createSidecarSupervisor({
        nodeBin: "/opt/node",
        sidecarPath: "/opt/app-sidecar.mjs",
        cwd: "/work",
        endpointPath: join(dir, "sidecar.json"),
        env: { EXTRA: "1" },
        platform,
        spawnImpl: impl,
        secretLock: noLock,
      }).start();
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call?.file).toBe("/opt/node");
      expect(call?.options.cwd).toBe("/work");
      expect(call?.options.env).toMatchObject({ EXTRA: "1", GG_APP_PORT: "0" });
      expect(call?.options.env?.GG_APP_TOKEN).toMatch(/^[0-9a-f-]{36}$/);
      if (platform === "win32") {
        expect(call?.args).toEqual(["--import", IPC_STOP_IMPORT, "/opt/app-sidecar.mjs"]);
        expect(call?.options.stdio).toEqual(["ignore", "pipe", "pipe", "ipc"]);
        expect(call?.options.env?.[IPC_STOP_ENV]).toBe("1");
      } else {
        expect(call?.args).toEqual(["/opt/app-sidecar.mjs"]);
        expect(call?.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
        expect(call?.options.env).not.toHaveProperty(IPC_STOP_ENV);
      }
    }
  });

  it("preloads the shim as an inline module", () => {
    expect(IPC_STOP_IMPORT.startsWith("data:text/javascript,")).toBe(true);
    const shim = decodeURIComponent(IPC_STOP_IMPORT.slice("data:text/javascript,".length));
    expect(shim).toContain(`process.env.${IPC_STOP_ENV} === "1"`);
    expect(shim).toContain("process.channel.unref()");
  });
});
