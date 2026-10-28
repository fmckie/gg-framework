import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LINK_KEY_BYTES,
  linkPublicKey,
  newLinkKey,
  newUpstreamToken,
  readLinkPublicKey,
  readPairPublicKey,
} from "../src/link-secrets.js";

// Ed25519 secret keys and their public halves: RFC 8032 section 7.1's tests 1
// and 2, and the two keys the link crate's ticket tests use, the host's and
// its pairing endpoint's (SecretKey::from_bytes(&[7; 32]) and &[8; 32] in
// iroh 1.4.1, read from kleio-link-host).
const VECTORS: readonly (readonly [Buffer, string])[] = [
  [
    Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  ],
  [
    Buffer.from("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "hex"),
    "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
  ],
  [Buffer.alloc(32, 7), "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c"],
  [Buffer.alloc(32, 8), "1398f62c6d1a457c51ba6a4b5f3dbd2f69fca93216218dc8997e416bd17d93ca"],
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kleio-link-secrets-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("linkPublicKey", () => {
  it("gives each secret's Ed25519 public half as 64 lowercase hex characters", () => {
    for (const [secret, expected] of VECTORS) {
      expect(linkPublicKey(secret)).toEqual({ ok: true, value: expected });
    }
  });

  it("refuses anything but 32 bytes", () => {
    for (const length of [0, 31, 33, 64]) {
      expect(linkPublicKey(Buffer.alloc(length, 1))).toEqual({ ok: false, error: "not_a_key" });
    }
  });
});

describe("new secrets", () => {
  it("a link key is 32 bytes, and each is new", () => {
    const a = newLinkKey();
    expect(a).toHaveLength(LINK_KEY_BYTES);
    expect(a.equals(newLinkKey())).toBe(false);
  });

  it("an upstream token is 43 base64url characters, and each is new", () => {
    const a = newUpstreamToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(newUpstreamToken());
  });
});

describe("readLinkPublicKey", () => {
  it("reads link.key's public half", async () => {
    const path = join(dir, "link.key");
    writeFileSync(path, VECTORS[0]![0]);
    expect(await readLinkPublicKey(path)).toEqual({ ok: true, value: VECTORS[0]![1] });
  });

  it("says why when the file is missing or isn't a key, and leaves it alone", async () => {
    const missing = await readLinkPublicKey(join(dir, "none.key"));
    expect(missing.ok ? null : missing.error).toMatch(/can't be read \(ENOENT\)/);

    const path = join(dir, "link.key");
    writeFileSync(path, "not a key\n");
    const damaged = await readLinkPublicKey(path);
    expect(damaged.ok ? null : damaged.error).toMatch(/isn't a link key .*pair again/);
  });
});

describe("readPairPublicKey", () => {
  it("reads link-pair.key's public half", async () => {
    const path = join(dir, "link-pair.key");
    writeFileSync(path, VECTORS[3]![0]);
    expect(await readPairPublicKey(path)).toEqual({ ok: true, value: VECTORS[3]![1] });
  });

  it("says why when the file is missing or isn't a key, and leaves it alone", async () => {
    const missing = await readPairPublicKey(join(dir, "none.key"));
    expect(missing.ok ? null : missing.error).toMatch(/can't be read \(ENOENT\).*serve makes it/);

    const path = join(dir, "link-pair.key");
    writeFileSync(path, "not a key\n");
    const damaged = await readPairPublicKey(path);
    expect(damaged.ok ? null : damaged.error).toMatch(/isn't a pairing key .*QR codes/);
  });
});
