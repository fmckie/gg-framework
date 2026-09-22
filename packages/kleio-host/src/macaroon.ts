// Phase 3b — a minimal, first-party-only macaroon for the control credential.
//
// A macaroon is a bearer token that still verifies by HMAC, but carries
// *attenuating caveats* — conditions that can only REDUCE authority. We use two:
//   - `exp=<ISO>`  : auto-expiry, so a stolen ticket dies on its own.
//   - `node=<id>`  : node-binding, so a lifted token is useless against any other
//                    mini (prior-art §10: fly.io machine-binding, Stanford macaroons).
//
// It is implemented in-repo over Node `crypto` (no new dependency — consistent with
// the repo's minimal-dep posture; ADR-0002 Phase 3 addenda #6). Scope is first-party
// caveats only; third-party / biometric-discharge caveats are deferred (the local 2c
// biometric gate already enforces presence structurally).
//
// Wire shape: `mac1.<base64url(JSON({ id, caveats, sig }))>`. The leading `mac1.`
// sentinel distinguishes a macaroon from a legacy opaque bearer, so the verifier can
// pick the macaroon path vs. the constant-time-compare fallback (backward compat).
//
// Signature chain (standard macaroon construction):
//   sig0 = HMAC(rootKey, id)
//   sigᵢ = HMAC(sigᵢ₋₁, caveatStringᵢ)     // each caveat folded over the running sig
// The final sig is the credential's authenticity proof. Because every caveat is
// folded into the chain, an attacker cannot remove or modify a caveat without the
// root key; they CAN append further caveats (the attenuation property), which only
// ever tightens authority — an unknown appended caveat fails closed at verify.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Distinguishes a macaroon from a legacy opaque control bearer. */
export const MACAROON_SENTINEL = "mac1.";

/** A first-party caveat. `exp` is an ISO-8601 instant; `node` is a stable node id. */
export interface Caveat {
  readonly type: "exp" | "node";
  readonly value: string;
}

/** Build an expiry caveat for the given absolute instant. */
export function expCaveat(at: Date): Caveat {
  return { type: "exp", value: at.toISOString() };
}

/** Build a node-binding caveat for the given stable node id. */
export function nodeCaveat(nodeId: string): Caveat {
  return { type: "node", value: nodeId };
}

/** Context a verifier evaluates caveats against. */
export interface MacaroonContext {
  /** Wall clock used to evaluate `exp` (the verifier injects a real clock). */
  readonly now: Date;
  /** This mini's stable node id; `null` when it could not be resolved. */
  readonly nodeId: string | null;
}

export type MacaroonVerifyReason = "sig" | "expired" | "wrong-node" | "malformed";

export type MacaroonVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: MacaroonVerifyReason };

/** True when `value` looks like a serialized macaroon (sentinel prefix). */
export function isMacaroon(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(MACAROON_SENTINEL);
}

function caveatString(caveat: Caveat): string {
  return `${caveat.type}=${caveat.value}`;
}

function chainSignature(rootKey: string, id: string, caveatStrings: readonly string[]): Buffer {
  let sig = createHmac("sha256", rootKey).update(id).digest();
  for (const cstr of caveatStrings) {
    sig = createHmac("sha256", sig).update(cstr).digest();
  }
  return sig;
}

interface Envelope {
  readonly id: string;
  readonly caveats: readonly string[];
  readonly sig: string; // base64url HMAC digest
}

function encode(envelope: Envelope): string {
  const json = JSON.stringify(envelope);
  return MACAROON_SENTINEL + Buffer.from(json, "utf8").toString("base64url");
}

/** Parse a serialized macaroon into its envelope, or null when malformed. */
function decode(serialized: string): Envelope | null {
  if (!isMacaroon(serialized)) return null;
  const body = serialized.slice(MACAROON_SENTINEL.length);
  let parsed: unknown;
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.sig !== "string") {
    return null;
  }
  if (!Array.isArray(record.caveats)) return null;
  const caveats: string[] = [];
  for (const c of record.caveats) {
    if (typeof c !== "string") return null;
    caveats.push(c);
  }
  return { id: record.id, caveats, sig: record.sig };
}

/**
 * Mint a macaroon: `id` identifies the credential (its registry id), `caveats`
 * attenuate it. The returned string is the bearer the laptop presents.
 */
export function mint(rootKey: string, id: string, caveats: readonly Caveat[]): string {
  const caveatStrings = caveats.map(caveatString);
  const sig = chainSignature(rootKey, id, caveatStrings);
  return encode({ id, caveats: caveatStrings, sig: sig.toString("base64url") });
}

/**
 * Attenuate an existing macaroon by appending a caveat. The classic macaroon
 * property: this needs ONLY the macaroon (not the root key), because the new
 * signature chains off the embedded one — so a holder (e.g. the laptop) can shrink
 * its own authority without ever seeing the secret. Returns null if `serialized`
 * is not a well-formed macaroon.
 */
export function addCaveat(serialized: string, caveat: Caveat): string | null {
  const env = decode(serialized);
  if (!env) return null;
  let sig: Buffer;
  try {
    sig = Buffer.from(env.sig, "base64url");
  } catch {
    return null;
  }
  const cstr = caveatString(caveat);
  const nextSig = createHmac("sha256", sig).update(cstr).digest();
  return encode({
    id: env.id,
    caveats: [...env.caveats, cstr],
    sig: nextSig.toString("base64url"),
  });
}

/**
 * Verify a macaroon against `rootKey` and `ctx`. Recomputes the HMAC chain and
 * does a CONSTANT-TIME final compare (so a wrong root key leaks nothing), then —
 * only if the signature is authentic — evaluates each caveat. A signature mismatch
 * is `sig`; an authentic-but-stale token is `expired`; an authentic token bound to
 * a different node is `wrong-node`; an unparseable or unknown-caveat token is
 * `malformed` (fail closed). Order matters: caveats are evaluated only after the
 * signature is proven, so failure reasons never leak across the trust boundary.
 */
export function verify(rootKey: string, serialized: string, ctx: MacaroonContext): MacaroonVerdict {
  const env = decode(serialized);
  if (!env) return { ok: false, reason: "malformed" };

  const expected = chainSignature(rootKey, env.id, env.caveats);
  let presented: Buffer;
  try {
    presented = Buffer.from(env.sig, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: "sig" };
  }

  for (const cstr of env.caveats) {
    const eq = cstr.indexOf("=");
    if (eq < 0) return { ok: false, reason: "malformed" };
    const type = cstr.slice(0, eq);
    const value = cstr.slice(eq + 1);
    if (type === "exp") {
      const expMs = Date.parse(value);
      if (!Number.isFinite(expMs) || ctx.now.getTime() >= expMs) {
        return { ok: false, reason: "expired" };
      }
    } else if (type === "node") {
      if (ctx.nodeId === null || value !== ctx.nodeId) {
        return { ok: false, reason: "wrong-node" };
      }
    } else {
      // An unknown first-party caveat we can't evaluate must NOT be satisfied.
      return { ok: false, reason: "malformed" };
    }
  }
  return { ok: true };
}
