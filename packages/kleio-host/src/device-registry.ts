// Per-device bearer token registry. Ported from kleio-desktop
// `src/main/pairing/device-registry.ts` (MIT) with one deliberate change: the
// old design wrote a plaintext "projection" (`~/.gg/device-tokens.json`) for a
// separate bridge process to read. Here the proxy and the registry live in one
// process, so raw tokens exist only in memory and `authenticate()` does the
// constant-time compare directly. The encrypted store format (schema 1, AES-GCM
// envelopes from file-keychain) is unchanged, so an existing
// device-registry.json is read as-is (plan decision D3).

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Keychain } from "./file-keychain.js";
import { err, ok, type Result } from "./result.js";

const STORE_SCHEMA = 1;
const FILE_MODE = 0o600;

/** Non-secret device view. */
export interface PairedDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly created: string;
  readonly lastSeen: string | null;
  readonly revoked: boolean;
  /** Whether this device holds a control credential (admin). */
  readonly admin: boolean;
}

interface DeviceRecord {
  readonly deviceId: string;
  readonly label: string;
  readonly created: string;
  lastSeen: string | null;
  revoked: boolean;
  /** Secret-backend envelope (never the raw token). */
  readonly encToken: string;
  /** Absent in records written by older hosts; treated as false. */
  readonly admin?: boolean;
}

interface StoreDocument {
  readonly version: number;
  readonly devices: DeviceRecord[];
}

export interface MintResult {
  readonly device: PairedDevice;
  /** The raw bearer token — handed to the device exactly once. */
  readonly token: string;
}

export type RegistryError =
  | { readonly kind: "keychain"; readonly message: string }
  | { readonly kind: "io"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export interface DeviceRegistry {
  /** Load the store and recover raw tokens into memory. */
  init(): Promise<void>;
  list(): PairedDevice[];
  get(deviceId: string): PairedDevice | undefined;
  mint(
    label: string,
    options?: { readonly admin?: boolean },
  ): Promise<Result<MintResult, RegistryError>>;
  revoke(deviceId: string): Promise<Result<PairedDevice[], RegistryError>>;
  /** Best-effort lastSeen update; never throws. Rate-limited by the caller. */
  touch(deviceId: string): Promise<void>;
  /**
   * Resolve a presented bearer to its device, or null. Constant-time over every
   * non-revoked token so timing never reveals which prefix matched.
   */
  authenticate(token: string): PairedDevice | null;
}

export interface DeviceRegistryDeps {
  readonly keychain: Keychain;
  /** Encrypted store path (0600). */
  readonly storePath: string;
  readonly now?: () => Date;
  readonly randomId?: () => string;
  readonly randomToken?: () => string;
  readonly log?: (msg: string) => void;
}

function isDeviceRecord(value: unknown): value is DeviceRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.deviceId === "string" &&
    typeof record.label === "string" &&
    typeof record.created === "string" &&
    (record.lastSeen === null || typeof record.lastSeen === "string") &&
    typeof record.revoked === "boolean" &&
    typeof record.encToken === "string" &&
    (record.admin === undefined || typeof record.admin === "boolean")
  );
}

function toPaired(record: DeviceRecord): PairedDevice {
  return {
    deviceId: record.deviceId,
    label: record.label,
    created: record.created,
    lastSeen: record.lastSeen,
    revoked: record.revoked,
    admin: record.admin === true,
  };
}

export async function atomicWrite(path: string, data: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  await writeFile(tmp, data, { encoding: "utf8", mode });
  await chmod(tmp, mode);
  await rename(tmp, path);
}

export function createDeviceRegistry(deps: DeviceRegistryDeps): DeviceRegistry {
  const now = deps.now ?? ((): Date => new Date());
  const randomId = deps.randomId ?? randomUUID;
  const randomToken = deps.randomToken ?? ((): string => randomBytes(32).toString("base64url"));
  const log = deps.log ?? ((): void => {});
  const { keychain, storePath } = deps;

  let records: DeviceRecord[] = [];
  /** deviceId → raw token bytes, only for records whose envelope decrypted. */
  const rawByDevice = new Map<string, Buffer>();

  function sorted(): DeviceRecord[] {
    return [...records].sort(
      (a, b) => a.created.localeCompare(b.created) || a.deviceId.localeCompare(b.deviceId),
    );
  }

  async function persistStore(): Promise<void> {
    const doc: StoreDocument = { version: STORE_SCHEMA, devices: records };
    await atomicWrite(storePath, `${JSON.stringify(doc, null, 2)}\n`, FILE_MODE);
  }

  async function init(): Promise<void> {
    records = [];
    rawByDevice.clear();
    try {
      const raw = await readFile(storePath, "utf8");
      const parsed = JSON.parse(raw) as { readonly version?: unknown; readonly devices?: unknown };
      if (parsed.version !== STORE_SCHEMA || !Array.isArray(parsed.devices)) {
        throw new Error("device registry schema is invalid");
      }
      records = parsed.devices.filter(isDeviceRecord);
      if (records.length !== parsed.devices.length) {
        throw new Error("device registry contains a malformed record");
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`device registry initialization failed: ${messageOf(e)}`, { cause: e });
      }
    }
    if (!keychain.isAvailable()) {
      throw new Error("device registry: keychain unavailable at init");
    }
    for (const record of records) {
      const dec = keychain.decrypt(record.encToken);
      if (!dec.ok) {
        rawByDevice.clear();
        throw new Error(`device registry token decryption failed for ${record.deviceId}`);
      }
      rawByDevice.set(record.deviceId, Buffer.from(dec.value, "utf8"));
    }
    log(`[registry] loaded ${records.length} device(s) from ${storePath}`);
  }

  function list(): PairedDevice[] {
    return sorted().map(toPaired);
  }

  function get(deviceId: string): PairedDevice | undefined {
    const record = records.find((r) => r.deviceId === deviceId);
    return record ? toPaired(record) : undefined;
  }

  async function mint(
    label: string,
    options: { readonly admin?: boolean } = {},
  ): Promise<Result<MintResult, RegistryError>> {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      return err({ kind: "io", message: "a non-empty label is required" });
    }
    if (!keychain.isAvailable()) {
      return err({ kind: "keychain", message: "keychain unavailable; cannot mint a secure token" });
    }
    const token = randomToken();
    const enc = keychain.encrypt(token);
    if (!enc.ok) return err({ kind: "keychain", message: enc.error.message });

    const record: DeviceRecord = {
      deviceId: randomId(),
      label: trimmed,
      created: now().toISOString(),
      lastSeen: null,
      revoked: false,
      encToken: enc.value,
      ...(options.admin ? { admin: true } : {}),
    };
    records.push(record);
    rawByDevice.set(record.deviceId, Buffer.from(token, "utf8"));
    try {
      await persistStore();
    } catch (e) {
      records = records.filter((r) => r.deviceId !== record.deviceId);
      rawByDevice.delete(record.deviceId);
      return err({ kind: "io", message: messageOf(e) });
    }
    return ok({ device: toPaired(record), token });
  }

  async function revoke(deviceId: string): Promise<Result<PairedDevice[], RegistryError>> {
    const record = records.find((r) => r.deviceId === deviceId);
    if (!record) return err({ kind: "not_found", message: `no device with id ${deviceId}` });
    const was = record.revoked;
    record.revoked = true;
    try {
      await persistStore();
    } catch (e) {
      record.revoked = was;
      return err({ kind: "io", message: messageOf(e) });
    }
    return ok(list());
  }

  async function touch(deviceId: string): Promise<void> {
    const record = records.find((r) => r.deviceId === deviceId);
    if (!record) return;
    record.lastSeen = now().toISOString();
    try {
      await persistStore();
    } catch (e) {
      log(`[registry] failed to persist lastSeen for ${deviceId}: ${messageOf(e)}`);
    }
  }

  function authenticate(token: string): PairedDevice | null {
    if (typeof token !== "string" || token.length === 0 || token.length > 512) return null;
    const presented = Buffer.from(token, "utf8");
    let match: DeviceRecord | null = null;
    // Compare against every live token, never short-circuiting, so the time
    // taken does not depend on where (or whether) the match is.
    for (const record of records) {
      const raw = rawByDevice.get(record.deviceId);
      if (!raw || raw.length !== presented.length) continue;
      const equal = timingSafeEqual(raw, presented);
      if (equal && !record.revoked && match === null) match = record;
    }
    return match ? toPaired(match) : null;
  }

  return { init, list, get, mint, revoke, touch, authenticate };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
