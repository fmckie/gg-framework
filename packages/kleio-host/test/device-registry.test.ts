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
import type { SecretLock } from "../src/acl.js";
import {
  atomicWrite,
  createDeviceRegistry,
  linkAllowDocument,
  type DeviceRegistry,
  type PairedDevice,
} from "../src/device-registry.js";
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
        // Laptops, and records from before push existed, read as unregistered.
        push: null,
        liveStart: null,
        // ...and records from before the link have no link key.
        linkKey: null,
        // An old store has no relay list version.
        listVersion: null,
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

  it("survives rapid back-to-back writes (mint, revoke, touch) without a persist failure", async () => {
    // Each call renames a fresh temp file over the store; Windows briefly
    // refuses a rename over a just-renamed target. Ten rounds, no 'io' errors.
    const reg = registry();
    await reg.init();
    for (let i = 0; i < 10; i += 1) {
      const m = await reg.mint(`d${i}`);
      expect(m.ok).toBe(true);
      if (!m.ok) return;
      await reg.touch(m.value.device.deviceId);
      const r = await reg.revoke(m.value.device.deviceId);
      expect(r.ok).toBe(true);
    }
    expect(reg.list().filter((d) => d.revoked)).toHaveLength(10);
  });

  it("atomicWrite leaves no temp file behind when the rename fails", async () => {
    const target = join(home, "nope", "x.json");
    await expect(atomicWrite(target, "{}", 0o600)).resolves.toBeUndefined();
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(join(home, "nope")).filter((f) => f.includes(".tmp-"))).toEqual([]);
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

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("device registry: link keys", () => {
  it("binds a device's link key at minting, and keeps it across a reload", async () => {
    const reg = registry();
    await reg.init();
    const minted = await reg.mint("iPhone", { linkKey: KEY_A });
    if (!minted.ok) throw new Error("mint failed");
    expect(minted.value.device.linkKey).toBe(KEY_A);
    expect(minted.value.superseded).toEqual([]);
    const plain = await reg.mint("Laptop");
    if (!plain.ok) throw new Error("mint failed");
    expect(plain.value.device.linkKey).toBeNull();

    const again = registry();
    await again.init();
    expect(again.get(minted.value.device.deviceId)?.linkKey).toBe(KEY_A);
    expect(again.get(plain.value.device.deviceId)?.linkKey).toBeNull();
  });

  it("keeps the relay list version a device got, across a reload, writing only a change", async () => {
    const reg = registry();
    await reg.init();
    const minted = await reg.mint("iPhone", { linkKey: KEY_A });
    if (!minted.ok) throw new Error("mint failed");
    expect(minted.value.device.listVersion).toBeNull();
    await reg.setListVersion(minted.value.device.deviceId, 3);
    expect(reg.get(minted.value.device.deviceId)?.listVersion).toBe(3);
    const written = statSync(storePath).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await reg.setListVersion(minted.value.device.deviceId, 3);
    expect(statSync(storePath).mtimeMs).toBe(written);
    await reg.setListVersion("no-such-device", 4);

    const again = registry();
    await again.init();
    expect(again.get(minted.value.device.deviceId)?.listVersion).toBe(3);
  });

  it("refuses a link key that isn't 64 lowercase hex characters, and mints nothing", async () => {
    const reg = registry();
    await reg.init();
    for (const bad of ["", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64)]) {
      const r = await reg.mint("iPhone", { linkKey: bad });
      expect(r.ok ? null : r.error.kind).toBe("invalid");
    }
    expect(reg.list()).toEqual([]);
  });

  it("a new pairing with the same link key replaces the older one, so a key never has two live devices", async () => {
    const reg = registry();
    await reg.init();
    const first = await reg.mint("iPhone", { linkKey: KEY_A, admin: true });
    if (!first.ok) throw new Error("mint failed");
    await reg.setLiveStart(first.value.device.deviceId, {
      token: "ab",
      env: "sandbox",
      registeredAt: "2026-10-23T00:00:00Z",
    });
    const other = await reg.mint("iPad", { linkKey: KEY_B });
    const second = await reg.mint("iPhone", { linkKey: KEY_A });
    if (!second.ok || !other.ok) throw new Error("mint failed");
    expect(second.value.superseded).toEqual([first.value.device.deviceId]);
    const old = reg.get(first.value.device.deviceId);
    expect(old).toMatchObject({ revoked: true, liveStart: null });
    expect(reg.authenticate(first.value.token)).toBeNull();
    expect(reg.authenticate(second.value.token)?.deviceId).toBe(second.value.device.deviceId);
    expect(reg.get(other.value.device.deviceId)?.revoked).toBe(false);
    expect(reg.list().filter((d) => d.linkKey === KEY_A && !d.revoked)).toHaveLength(1);
  });
});

describe("device registry: the link's allow-list", () => {
  const allowPath = (): string => join(home, "secure", "link-allow.json");
  const allow = (): unknown => JSON.parse(readFileSync(allowPath(), "utf8"));

  /** A lock that records each path, and fails while `failing` says so. */
  function countingLock(failing: () => boolean = () => false): {
    lock: SecretLock;
    locked: string[];
  } {
    const locked: string[] = [];
    return {
      locked,
      lock: {
        lock: async (path) => {
          locked.push(path);
          return failing()
            ? { ok: false, error: { kind: "icacls_failed", message: "icacls exited with 5" } }
            : { ok: true, value: undefined };
        },
      },
    };
  }

  it("is written at init, then on each pairing and revoke that changes it, 0600 and locked", async () => {
    const { lock, locked } = countingLock();
    const reg = registry({ linkAllowPath: allowPath(), secretLock: lock });
    await reg.init();
    expect(allow()).toEqual({ version: 1, devices: [], revoked: [] });
    if (process.platform !== "win32") expect(statSync(allowPath()).mode & 0o777).toBe(0o600);

    const phone = await reg.mint("iPhone", { linkKey: KEY_B });
    const pad = await reg.mint("iPad", { linkKey: KEY_A });
    if (!phone.ok || !pad.ok) throw new Error("mint failed");
    expect(allow()).toEqual({
      version: 1,
      devices: [
        { key: KEY_A, deviceId: pad.value.device.deviceId, label: "iPad" },
        { key: KEY_B, deviceId: phone.value.device.deviceId, label: "iPhone" },
      ],
      revoked: [],
    });
    expect(JSON.stringify(allow())).not.toContain(phone.value.token);

    await reg.revoke(phone.value.device.deviceId);
    expect(allow()).toEqual({
      version: 1,
      devices: [{ key: KEY_A, deviceId: pad.value.device.deviceId, label: "iPad" }],
      revoked: [KEY_B],
    });

    // A write that doesn't change it (lastSeen, a device without a key) leaves it alone.
    const writes = locked.length;
    await reg.touch(pad.value.device.deviceId);
    await reg.mint("Laptop");
    expect(locked).toHaveLength(writes);
    expect(locked.every((path) => path.startsWith(`${allowPath()}.tmp-`))).toBe(true);
  });

  it("a failed write is logged and tried again at the next one, and never undoes the pairing", async () => {
    let failing = true;
    const logs: string[] = [];
    const { lock } = countingLock(() => failing);
    const reg = registry({
      linkAllowPath: allowPath(),
      secretLock: lock,
      log: (m) => logs.push(m),
    });
    await reg.init();
    const phone = await reg.mint("iPhone", { linkKey: KEY_A });
    expect(phone.ok).toBe(true);
    expect(logs.some((l) => l.includes("couldn't write the link's allow-list"))).toBe(true);
    expect(() => readFileSync(allowPath())).toThrow();

    failing = false;
    if (!phone.ok) throw new Error("mint failed");
    await reg.touch(phone.value.device.deviceId);
    expect(allow()).toMatchObject({ devices: [{ key: KEY_A, label: "iPhone" }] });
  });

  it("init rewrites a file that's missing or behind", async () => {
    const first = registry({ linkAllowPath: allowPath() });
    await first.init();
    const phone = await first.mint("iPhone", { linkKey: KEY_A });
    if (!phone.ok) throw new Error("mint failed");
    writeFileSync(allowPath(), "{}");
    const again = registry({ linkAllowPath: allowPath() });
    await again.init();
    expect(allow()).toMatchObject({ devices: [{ key: KEY_A }], revoked: [] });
  });

  it("lists a key as revoked only while no live device has it", () => {
    const device = (over: Partial<PairedDevice>): PairedDevice => ({
      deviceId: "d",
      label: "x",
      created: "2026-10-23T00:00:00Z",
      lastSeen: null,
      revoked: false,
      admin: false,
      push: null,
      liveStart: null,
      linkKey: null,
      ...over,
    });
    expect(
      linkAllowDocument([
        device({ deviceId: "old", linkKey: KEY_A, revoked: true }),
        device({ deviceId: "new", linkKey: KEY_A }),
        device({ deviceId: "gone", linkKey: KEY_B, revoked: true }),
        device({ deviceId: "gone-again", linkKey: KEY_B, revoked: true }),
        device({ deviceId: "laptop" }),
      ]),
    ).toEqual({
      version: 1,
      devices: [{ key: KEY_A, deviceId: "new", label: "x" }],
      revoked: [KEY_B],
    });
  });
});
