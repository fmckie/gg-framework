// The link's two secrets, kept in secure/ (paths.ts) and made by `init` and
// `serve` (secure-dir.ts), never replaced once made:
//
//   link.key             32 random bytes: the Ed25519 secret key
//                        kleio-link-host serves the link with (iroh's
//                        SecretKey::from_bytes). Its public half is the key
//                        every pairing QR code names, and phones check it in
//                        the handshake, so a new one cuts off every phone.
//   link-upstream.token  The secret kleio-link-host shows on kleio-host's link
//                        listener before any of a phone's bytes.

import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { err, ok, type Result } from "./result.js";

/** An Ed25519 secret key's length, and so link.key's. */
export const LINK_KEY_BYTES = 32;

/** A new link key. Any 32 bytes are an Ed25519 secret key. */
export function newLinkKey(): Buffer {
  return randomBytes(LINK_KEY_BYTES);
}

/** A new upstream token: 32 random bytes as base64url, 43 characters. */
export function newUpstreamToken(): string {
  return randomBytes(32).toString("base64url");
}

// An Ed25519 private key in PKCS #8 (RFC 8410), up to the 32 secret bytes.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * The link key's public half, as 64 lowercase hex characters: how iroh
 * writes an endpoint's key, in tickets and kleio-link-host's log.
 */
export function linkPublicKey(secret: Buffer): Result<string, "not_a_key"> {
  if (secret.length !== LINK_KEY_BYTES) return err("not_a_key");
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, secret]),
    format: "der",
    type: "pkcs8",
  });
  const der = createPublicKey(key).export({ format: "der", type: "spki" });
  // SPKI for Ed25519 is a 12-byte header and the 32-byte key.
  return ok(der.subarray(der.length - LINK_KEY_BYTES).toString("hex"));
}

/** Read link.key and give its public half, or say why not (the file is left alone). */
export async function readLinkPublicKey(path: string): Promise<Result<string, string>> {
  let secret: Buffer;
  try {
    secret = await readFile(path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unreadable";
    return err(`${path} can't be read (${code}); kleio-host init or serve makes it`);
  }
  const key = linkPublicKey(secret);
  return key.ok
    ? key
    : err(
        `${path} isn't a link key (a link key is ${LINK_KEY_BYTES} bytes). Moving it aside makes a new one, which gives the host a new key: every phone then has to pair again.`,
      );
}
