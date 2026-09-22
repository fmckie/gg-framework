import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import {
  createFileKeychain,
  generateMasterKey,
  MASTER_KEY_BYTES,
  type Keychain,
} from "../src/file-keychain.js";

let home: string;
let keyPath: string;
let storePath: string;

function writeMasterKey(path: string, key = generateMasterKey()): Buffer {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  chmodSync(join(path, ".."), 0o700);
  writeFileSync(path, key, { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kleio-host-reg-"));
  keyPath = join(home, "secure", "headless-master.key");
  storePath = join(home, "secure", "device-registry.json");
  writeMasterKey(keyPath);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function registry(over: Partial<Parameters<typeof createDeviceRegistry>[0]> = {}): DeviceRegistry {
  const keychain: Keychain = createFileKeychain({ keyPath });
  return createDeviceRegistry({ keychain, storePath, ...over });
}

describe("file keychain", () => {
  it("round-trips and produces a v1.hostKey envelope with a fresh nonce each time", () => {
    const kc = createFileKeychain({ keyPath });
    const a = kc.encrypt("secret");
    const b = kc.encrypt("secret");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.startsWith("v1.hostKey.")).toBe(true);
    expect(a.value).not.toBe(b.value);
    expect(kc.decrypt(a.value)).toEqual({ ok: true, value: "secret" });
  });

  it("rejects a tampered envelope and a wrong key without leaking which", () => {
    const kc = createFileKeychain({ keyPath });
    const enc = kc.encrypt("secret");
    if (!enc.ok) throw new Error("encrypt failed");
    // Flip one bit inside the ciphertext (past the prefix, nonce and tag).
    const prefix = "v1.hostKey.";
    const payload = Buffer.from(enc.value.slice(prefix.length), "base64url");
    payload[payload.length - 1] ^= 0x01;
    const flipped = prefix + payload.toString("base64url");
    expect(kc.decrypt(flipped)).toMatchObject({ ok: false, error: { kind: "decrypt_failed" } });
    const otherKey = join(home, "other", "key");
    writeMasterKey(otherKey);
    expect(createFileKeychain({ keyPath: otherKey }).decrypt(enc.value)).toMatchObject({
      ok: false,
      error: { kind: "decrypt_failed" },
    });
    expect(kc.decrypt("v1.safeStorage.abc")).toMatchObject({
      ok: false,
      error: { kind: "malformed" },
    });
  });

  it.skipIf(process.platform === "win32")(
    "refuses a key file that is world-readable or in a loose directory",
    () => {
      chmodSync(keyPath, 0o644);
      expect(() => createFileKeychain({ keyPath })).toThrow(/mode 0600/);
      chmodSync(keyPath, 0o600);
      chmodSync(join(keyPath, ".."), 0o755);
      expect(() => createFileKeychain({ keyPath })).toThrow(/mode 0700/);
    },
  );

  it("refuses a key of the wrong length", () => {
    writeFileSync(keyPath, Buffer.alloc(MASTER_KEY_BYTES - 1), { mode: 0o600 });
    expect(() => createFileKeychain({ keyPath })).toThrow(/exactly 32 bytes/);
  });
});

describe("device registry", () => {
  it("mints, persists an encrypted store (0600), and authenticates the raw token", async () => {
    const reg = registry();
    await reg.init();
    const minted = await reg.mint("Laptop");
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.value.token.length).toBeGreaterThanOrEqual(40);
    expect(reg.authenticate(minted.value.token)).toMatchObject({
      deviceId: minted.value.device.deviceId,
      label: "Laptop",
    });
    expect(reg.authenticate(minted.value.token + "x")).toBeNull();
    expect(reg.authenticate("")).toBeNull();
    const onDisk = readFileSync(storePath, "utf8");
    expect(onDisk).not.toContain(minted.value.token);
    expect(onDisk).toContain("v1.hostKey.");
    if (process.platform !== "win32") expect(statSync(storePath).mode & 0o777).toBe(0o600);
  });

  it("reloads from disk with the same master key and still authenticates", async () => {
    const first = registry();
    await first.init();
    const minted = await first.mint("Phone");
    if (!minted.ok) throw new Error("mint failed");
    const second = registry();
    await second.init();
    expect(second.list()).toEqual(first.list());
    expect(second.authenticate(minted.value.token)?.deviceId).toBe(minted.value.device.deviceId);
  });

  it("revoke persists and the token stops authenticating immediately", async () => {
    const reg = registry();
    await reg.init();
    const minted = await reg.mint("Laptop");
    if (!minted.ok) throw new Error("mint failed");
    const after = await reg.revoke(minted.value.device.deviceId);
    expect(after.ok && after.value[0]?.revoked).toBe(true);
    expect(reg.authenticate(minted.value.token)).toBeNull();
    const reloaded = registry();
    await reloaded.init();
    expect(reloaded.authenticate(minted.value.token)).toBeNull();
    expect(await reg.revoke("nope")).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });

  it("admin flag is persisted and surfaced; older records without it read as non-admin", async () => {
    const reg = registry();
    await reg.init();
    const admin = await reg.mint("Admin laptop", { admin: true });
    const plain = await reg.mint("Phone");
    if (!admin.ok || !plain.ok) throw new Error("mint failed");
    expect(reg.get(admin.value.device.deviceId)?.admin).toBe(true);
    expect(reg.get(plain.value.device.deviceId)?.admin).toBe(false);
    const doc = JSON.parse(readFileSync(storePath, "utf8")) as {
      devices: Record<string, unknown>[];
    };
    expect(doc.devices.find((d) => d.deviceId === plain.value.device.deviceId)).not.toHaveProperty(
      "admin",
    );
  });

  it("reads a store written by an earlier headless host (schema 1, v1.hostKey envelopes)", async () => {
    // Build the fixture with an independent keychain instance so this is a
    // format test, not a same-object round trip.
    const fixtureKc = createFileKeychain({ keyPath });
    const enc = fixtureKc.encrypt("legacy-raw-token");
    if (!enc.ok) throw new Error("encrypt failed");
    writeFileSync(
      storePath,
      JSON.stringify(
        {
          version: 1,
          devices: [
            {
              deviceId: "43a5f428-cf29-471c-9756-989035f43c39",
              label: "W's mac",
              created: "2026-09-07T22:34:42.545Z",
              lastSeen: null,
              revoked: false,
              encToken: enc.value,
            },
          ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const reg = registry();
    await reg.init();
    expect(reg.list()).toEqual([
      {
        deviceId: "43a5f428-cf29-471c-9756-989035f43c39",
        label: "W's mac",
        created: "2026-09-07T22:34:42.545Z",
        lastSeen: null,
        revoked: false,
        admin: false,
      },
    ]);
    expect(reg.authenticate("legacy-raw-token")?.label).toBe("W's mac");
  });

  it("refuses to start on a store it cannot decrypt rather than silently dropping devices", async () => {
    const reg = registry();
    await reg.init();
    await reg.mint("Laptop");
    writeMasterKey(keyPath); // rotate the key underneath the store
    await expect(registry().init()).rejects.toThrow(/decryption failed/);
  });

  it("refuses a malformed store", async () => {
    writeFileSync(storePath, JSON.stringify({ version: 1, devices: [{ deviceId: 1 }] }), {
      mode: 0o600,
    });
    await expect(registry().init()).rejects.toThrow(/malformed record/);
    writeFileSync(storePath, JSON.stringify({ version: 2, devices: [] }), { mode: 0o600 });
    await expect(registry().init()).rejects.toThrow(/schema is invalid/);
  });

  it("touch updates lastSeen without changing the token", async () => {
    const dates = [new Date("2026-09-22T10:00:00Z"), new Date("2026-09-22T11:00:00Z")];
    let i = 0;
    const reg = registry({ now: () => dates[Math.min(i++, dates.length - 1)]! });
    await reg.init();
    const minted = await reg.mint("Laptop");
    if (!minted.ok) throw new Error("mint failed");
    await reg.touch(minted.value.device.deviceId);
    expect(reg.get(minted.value.device.deviceId)?.lastSeen).toBe("2026-09-22T11:00:00.000Z");
    expect(reg.authenticate(minted.value.token)).not.toBeNull();
  });
});
