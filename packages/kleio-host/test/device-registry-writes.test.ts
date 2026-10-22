import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretLock } from "../src/acl.js";
import { err, ok } from "../src/result.js";

// Disk writes with a delay chosen per call, so a test can make an early write
// finish after a later one — what a Windows runner (Defender scanning each new
// file) does at random.
const delays: number[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      const ms = delays.shift() ?? 0;
      if (ms) await new Promise((r) => setTimeout(r, ms));
      return real.writeFile(...args);
    },
  };
});

const { atomicWrite, createDeviceRegistry } = await import("../src/device-registry.js");
const { createFileKeychain, generateMasterKey } = await import("../src/file-keychain.js");

let home: string;
let keyPath: string;
let storePath: string;

beforeEach(() => {
  delays.length = 0;
  home = mkdtempSync(join(tmpdir(), "kleio-reg-writes-"));
  keyPath = join(home, "secure", "headless-master.key");
  storePath = join(home, "secure", "device-registry.json");
  mkdirSync(join(home, "secure"), { recursive: true, mode: 0o700 });
  chmodSync(join(home, "secure"), 0o700);
  writeFileSync(keyPath, generateMasterKey(), { mode: 0o600 });
  chmodSync(keyPath, 0o600);
});
afterEach(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

const registry = () =>
  createDeviceRegistry({ keychain: createFileKeychain({ keyPath }), storePath });

describe("device registry disk writes", () => {
  it("a slow lastSeen write can never erase a device minted after it started", async () => {
    const reg = registry();
    await reg.init();
    const a = await reg.mint("Laptop");
    if (!a.ok) throw new Error("mint A");

    // touch(A) starts first and its write is slow; mint(B) starts right after
    // and its write is fast. Unordered, B's file lands first and A's stale
    // snapshot (no B) overwrites it.
    delays.push(300, 0);
    const touching = reg.touch(a.value.device.deviceId);
    const b = await reg.mint("Phone");
    if (!b.ok) throw new Error("mint B");
    await touching;

    const onDisk = registry();
    await onDisk.init();
    expect(
      onDisk
        .list()
        .map((d) => d.label)
        .sort(),
    ).toEqual(["Laptop", "Phone"]);
    expect(onDisk.authenticate(b.value.token)?.label).toBe("Phone");
  });

  it("every write finishes cleanly: no temp files are left beside the store", async () => {
    const reg = registry();
    await reg.init();
    delays.push(50, 0, 30, 0);
    const m = await reg.mint("A");
    if (!m.ok) throw new Error("mint");
    await Promise.all([reg.touch(m.value.device.deviceId), reg.mint("B"), reg.mint("C")]);
    expect(readdirSync(join(home, "secure")).filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(JSON.parse(readFileSync(storePath, "utf8")).devices).toHaveLength(3);
  });
});

describe("atomicWrite with a lock (a secret)", () => {
  const temps = (): string[] => readdirSync(home).filter((f) => f.includes(".tmp"));

  it("locks the temp file while it is still empty, then fills it and renames it", async () => {
    const target = join(home, "typesafe.key");
    const seen: { path: string; kind: string; content: string }[] = [];
    const lock: SecretLock = {
      lock: async (path, kind) => {
        seen.push({ path, kind, content: readFileSync(path, "utf8") });
        return ok(undefined);
      },
    };
    await atomicWrite(target, "SECRET-ONE\n", 0o600, lock);
    await atomicWrite(target, "SECRET-TWO\n", 0o600, lock);
    expect(seen.map((s) => [s.kind, s.content])).toEqual([
      ["file", ""],
      ["file", ""],
    ]);
    for (const s of seen) expect(s.path).toMatch(/typesafe\.key\.tmp-[0-9a-f]{12}$/);
    expect(readFileSync(target, "utf8")).toBe("SECRET-TWO\n");
    if (process.platform !== "win32") expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(temps()).toEqual([]);
  });

  it("a failed lock throws in its own words and writes nothing", async () => {
    const lock: SecretLock = {
      lock: async () => err({ kind: "icacls_failed", message: "icacls exited with 5" }),
    };
    const fresh = join(home, "composio.key");
    const kept = join(home, "openai.key");
    writeFileSync(kept, "OLD\n");
    for (const target of [fresh, kept]) {
      const failure: unknown = await atomicWrite(target, "SECRET-KEY\n", 0o600, lock).then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toMatch(/could not lock .*\(icacls_failed\): icacls exited with 5/);
      expect(String(failure)).not.toContain("SECRET-KEY");
    }
    expect(existsSync(fresh)).toBe(false);
    expect(readFileSync(kept, "utf8")).toBe("OLD\n");
    expect(temps()).toEqual([]);
  });
});
