// AES-256-GCM envelope keychain for the login-independent host account.
// Ported from kleio-desktop `src/main/headless/file-keychain.ts` (MIT).
//
// COMPATIBILITY (plan decision D3): the envelope prefix `v1.hostKey.` and the
// AAD string are byte-for-byte what earlier Kleio/Atlas headless hosts wrote, so
// a device-registry.json encrypted by them still decrypts here under the same
// master key. Do not change either without a migration.

import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { dirname } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { err, ok, type Result } from "./result.js";

export type KeychainError =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "malformed"; readonly message: string }
  | { readonly kind: "decrypt_failed"; readonly message: string };

export interface Keychain {
  /** Whether real encryption is currently available. */
  isAvailable(): boolean;
  /** Encrypt a secret into an opaque envelope string. */
  encrypt(plaintext: string): Result<string, KeychainError>;
  /** Decrypt an envelope string produced by `encrypt`. */
  decrypt(envelope: string): Result<string, KeychainError>;
}

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_PREFIX = "v1.hostKey.";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const AAD = Buffer.from("Atlas headless host key v1", "utf8");

export interface FileKeychainOptions {
  readonly keyPath: string;
  /** Owner required for both key and parent directory. Defaults to this process. */
  readonly expectedUid?: number;
  /** Test seam; production uses a fresh cryptographic nonce for every value. */
  readonly randomNonce?: () => Buffer;
}

function mode(stat: Stats): number {
  return stat.mode & 0o777;
}

function loadMasterKey(keyPath: string, expectedUid: number): Buffer {
  const parentPath = dirname(keyPath);
  const parent = lstatSync(parentPath);
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error(`headless key parent must be a regular directory: ${parentPath}`);
  }
  if (parent.uid !== expectedUid) {
    throw new Error(`headless key parent has wrong owner: ${parentPath}`);
  }
  if (mode(parent) !== 0o700) {
    throw new Error(`headless key parent must have mode 0700: ${parentPath}`);
  }

  const before = lstatSync(keyPath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`headless master key must be a regular file: ${keyPath}`);
  }
  if (before.uid !== expectedUid) {
    throw new Error(`headless master key has wrong owner: ${keyPath}`);
  }
  if (mode(before) !== 0o600) {
    throw new Error(`headless master key must have mode 0600: ${keyPath}`);
  }

  const fd = openSync(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`headless master key changed during validation: ${keyPath}`);
    }
    const key = readFileSync(fd);
    if (key.length !== KEY_BYTES) {
      throw new Error(`headless master key must contain exactly ${KEY_BYTES} bytes`);
    }
    return key;
  } finally {
    closeSync(fd);
  }
}

function malformed(message: string): Result<never, KeychainError> {
  return err({ kind: "malformed", message });
}

export const MASTER_KEY_BYTES = KEY_BYTES;

/** Fresh 32-byte master key. The caller writes it with mode 0600 in a 0700 dir. */
export function generateMasterKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * AES-256-GCM Keychain implementation for the login-independent host account.
 * The key is validated eagerly, kept only in this process, and never logged.
 */
export function createFileKeychain(options: FileKeychainOptions): Keychain {
  const expectedUid = options.expectedUid ?? process.getuid?.() ?? 0;
  const key = loadMasterKey(options.keyPath, expectedUid);
  const nonceSource = options.randomNonce ?? ((): Buffer => randomBytes(NONCE_BYTES));

  function encrypt(plaintext: string): Result<string, KeychainError> {
    try {
      const nonce = nonceSource();
      if (nonce.length !== NONCE_BYTES) {
        return err({
          kind: "decrypt_failed",
          message: `encrypt failed: nonce must contain ${NONCE_BYTES} bytes`,
        });
      }
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const payload = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
      return ok(`${ENVELOPE_PREFIX}${payload.toString("base64url")}`);
    } catch (error) {
      return err({
        kind: "decrypt_failed",
        message: `encrypt failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  function decrypt(envelope: string): Result<string, KeychainError> {
    if (typeof envelope !== "string" || !envelope.startsWith(ENVELOPE_PREFIX)) {
      return malformed("envelope is not v1.hostKey.<base64url>");
    }
    const encoded = envelope.slice(ENVELOPE_PREFIX.length);
    if (!encoded || !BASE64URL.test(encoded)) {
      return malformed("headless envelope payload is not strict base64url");
    }
    let payload: Buffer;
    try {
      payload = Buffer.from(encoded, "base64url");
    } catch {
      return malformed("headless envelope payload is not valid base64url");
    }
    if (payload.toString("base64url") !== encoded) {
      return malformed("headless envelope payload is not canonical base64url");
    }
    if (payload.length < NONCE_BYTES + TAG_BYTES) {
      return malformed("headless envelope payload is too short");
    }

    try {
      const nonce = payload.subarray(0, NONCE_BYTES);
      const tag = payload.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
      const ciphertext = payload.subarray(NONCE_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(AAD);
      decipher.setAuthTag(tag);
      return ok(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    } catch {
      return err({
        kind: "decrypt_failed",
        message: "decrypt failed: authentication rejected the envelope",
      });
    }
  }

  return { isAvailable: () => true, encrypt, decrypt };
}
