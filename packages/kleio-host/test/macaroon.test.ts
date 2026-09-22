import { describe, expect, it } from "vitest";

import {
  addCaveat,
  expCaveat,
  isMacaroon,
  MACAROON_SENTINEL,
  mint,
  nodeCaveat,
  verify,
  type Caveat,
  type MacaroonContext,
} from "../src/macaroon.js";

const ROOT = "root-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ID = "cred-1";
const NODE = "mac-mini-1.taila6c237.ts.net";

const NOW = new Date("2026-06-29T12:00:00.000Z");
const FUTURE = new Date("2026-07-29T12:00:00.000Z");
const PAST = new Date("2026-06-01T12:00:00.000Z");

function ctx(over: Partial<MacaroonContext> = {}): MacaroonContext {
  return { now: NOW, nodeId: NODE, ...over };
}

describe("isMacaroon", () => {
  it("recognises the sentinel and rejects legacy bearers / non-strings", () => {
    expect(isMacaroon(mint(ROOT, ID, []))).toBe(true);
    expect(MACAROON_SENTINEL).toBe("mac1.");
    expect(isMacaroon("an-opaque-base64url-bearer")).toBe(false);
    expect(isMacaroon("")).toBe(false);
    expect(isMacaroon(undefined)).toBe(false);
    expect(isMacaroon(42)).toBe(false);
  });
});

describe("mint + verify (chain integrity)", () => {
  it("verifies a freshly minted macaroon with valid caveats", () => {
    const m = mint(ROOT, ID, [expCaveat(FUTURE), nodeCaveat(NODE)]);
    expect(verify(ROOT, m, ctx())).toEqual({ ok: true });
  });

  it("verifies a caveat-free macaroon (no constraints)", () => {
    const m = mint(ROOT, ID, []);
    expect(verify(ROOT, m, ctx({ nodeId: null })).ok).toBe(true);
  });

  it("rejects a macaroon minted under a different root key as sig", () => {
    const m = mint("a-different-root-key-bbbbbbbbbbbbbbbb", ID, [expCaveat(FUTURE)]);
    expect(verify(ROOT, m, ctx())).toEqual({ ok: false, reason: "sig" });
  });

  it("rejects a tampered signature as sig", () => {
    const m = mint(ROOT, ID, [expCaveat(FUTURE)]);
    const env = JSON.parse(
      Buffer.from(m.slice(MACAROON_SENTINEL.length), "base64url").toString("utf8"),
    ) as { id: string; caveats: string[]; sig: string };
    env.sig = Buffer.from("not-the-real-signature").toString("base64url");
    const forged =
      MACAROON_SENTINEL + Buffer.from(JSON.stringify(env), "utf8").toString("base64url");
    expect(verify(ROOT, forged, ctx())).toEqual({ ok: false, reason: "sig" });
  });

  it("rejects a tampered caveat as sig (caveats are folded into the chain)", () => {
    const m = mint(ROOT, ID, [nodeCaveat(NODE)]);
    const env = JSON.parse(
      Buffer.from(m.slice(MACAROON_SENTINEL.length), "base64url").toString("utf8"),
    ) as { id: string; caveats: string[]; sig: string };
    // Swap the bound node WITHOUT re-signing — the chain no longer matches.
    env.caveats = ["node=some-other-node"];
    const forged =
      MACAROON_SENTINEL + Buffer.from(JSON.stringify(env), "utf8").toString("base64url");
    expect(verify(ROOT, forged, ctx({ nodeId: "some-other-node" }))).toEqual({
      ok: false,
      reason: "sig",
    });
  });
});

describe("caveat evaluation", () => {
  it("rejects an expired macaroon as expired (only after sig proves authentic)", () => {
    const m = mint(ROOT, ID, [expCaveat(PAST)]);
    expect(verify(ROOT, m, ctx())).toEqual({ ok: false, reason: "expired" });
  });

  it("treats exp as exclusive at the exact instant", () => {
    const m = mint(ROOT, ID, [expCaveat(NOW)]);
    expect(verify(ROOT, m, ctx({ now: NOW }))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a node-bound macaroon presented to a different node as wrong-node", () => {
    const m = mint(ROOT, ID, [nodeCaveat(NODE)]);
    expect(verify(ROOT, m, ctx({ nodeId: "other-mini.ts.net" }))).toEqual({
      ok: false,
      reason: "wrong-node",
    });
  });

  it("rejects a node-bound macaroon when the verifier cannot resolve a node id", () => {
    const m = mint(ROOT, ID, [nodeCaveat(NODE)]);
    expect(verify(ROOT, m, ctx({ nodeId: null }))).toEqual({
      ok: false,
      reason: "wrong-node",
    });
  });

  it("rejects an unparseable / non-macaroon string as malformed", () => {
    expect(verify(ROOT, "not-a-macaroon", ctx())).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verify(ROOT, `${MACAROON_SENTINEL}@@@not-base64@@@`, ctx())).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("fails closed on an unknown caveat type", () => {
    // Append an unknown caveat through the legitimate (chained) path so the sig is
    // authentic — an unknown-but-authentic caveat must still be rejected.
    const base = mint(ROOT, ID, []);
    const unknown = addCaveat(base, {
      type: "scope" as Caveat["type"],
      value: "all",
    });
    expect(unknown).not.toBeNull();
    expect(verify(ROOT, unknown!, ctx())).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("addCaveat (attenuation without the root key)", () => {
  it("appends a caveat that the holder cannot later remove", () => {
    const base = mint(ROOT, ID, [nodeCaveat(NODE)]);
    // The laptop attenuates with an expiry WITHOUT knowing ROOT — and it still
    // verifies, proving attenuation needs only the macaroon.
    const shrunk = addCaveat(base, expCaveat(FUTURE));
    expect(shrunk).not.toBeNull();
    expect(verify(ROOT, shrunk!, ctx())).toEqual({ ok: true });
  });

  it("an attenuating expiry only ever tightens authority", () => {
    const base = mint(ROOT, ID, []); // unbounded
    const shrunk = addCaveat(base, expCaveat(PAST));
    expect(shrunk).not.toBeNull();
    // The base verifies, the attenuated copy does not — authority only shrank.
    expect(verify(ROOT, base, ctx({ nodeId: null })).ok).toBe(true);
    expect(verify(ROOT, shrunk!, ctx({ nodeId: null }))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("returns null for a non-macaroon input", () => {
    expect(addCaveat("not-a-macaroon", expCaveat(FUTURE))).toBeNull();
  });
});
