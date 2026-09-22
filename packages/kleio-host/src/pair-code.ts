// Pair-code wire contract. Ported from kleio-desktop `src/shared/pair-code.ts`
// (MIT); the payload is reshaped for the HTTP host (no WebSocket bridge, no
// gateway/noledge capabilities). Dependency-free so a client can import it too.

/**
 * Crockford base32 — digits + uppercase letters minus `I L O U`. No glyph pair
 * in it can be misread for another when the code is read off a screen (or aloud)
 * and retyped on a second machine.
 */
export const PAIR_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 6 symbols over a 32-symbol alphabet = 30 bits ≈ 1.07e9 codes. */
export const PAIR_CODE_LENGTH = 6;

/** How long a minted offer stays redeemable. Bounds the offline guessing window. */
export const PAIR_OFFER_TTL_MS = 5 * 60_000;

/** Wrong codes tolerated before the offer is destroyed. */
export const PAIR_MAX_ATTEMPTS = 5;

/**
 * After a successful redemption the offer keeps a `redeemed` record for this
 * long so a client that lost the response (or failed mid-import) can re-POST the
 * SAME nonce and get the SAME payload back. Anything else is refused.
 */
export const PAIR_RETRY_WINDOW_MS = 60_000;

/** Bytes of client-generated randomness in a redemption nonce (hex on the wire). */
export const REDEMPTION_NONCE_BYTES = 16;
/** Hex length of a redemption nonce. */
export const REDEMPTION_NONCE_HEX_LENGTH = REDEMPTION_NONCE_BYTES * 2;

/** Unauthenticated-by-design redeem endpoint. */
export const PAIR_REDEEM_PATH = "/kleio/pair/redeem";

/** Redeem bodies are tiny; anything larger is rejected before it is parsed. */
export const PAIR_REDEEM_MAX_BODY_BYTES = 4 * 1024;

/** What a successful redemption hands the device. */
export interface PairingPayload {
  /** `https://<host>:<port>` — the base every subsequent request targets. */
  readonly baseUrl: string;
  /** Tailnet host name, for display and node binding. */
  readonly host: string;
  /** Per-device bearer, presented as `x-kleio-device-token`. */
  readonly token: string;
  /** The label the host recorded for this device. */
  readonly label: string;
  /** Device id the host assigned; needed to self-identify (e.g. revoke self). */
  readonly deviceId: string;
  /**
   * Admin pairing only: a macaroon for control RPC (revoke devices, manage
   * offers). Ordinary device pairs omit it.
   */
  readonly controlCredential?: string;
}

export interface PairRedeemRequest {
  /** The normalized 6-character code the user typed. */
  readonly code: string;
  /** 128-bit client-generated hex nonce, constant for one attempt sequence. */
  readonly redemptionNonce: string;
  /** Optional friendly label for the device being paired. */
  readonly label?: string;
}

/**
 * The uniform failure vocabulary. `unauthorized` covers wrong AND expired AND
 * exhausted deliberately — the body must not tell an attacker which it was.
 */
export type PairRedeemErrorCode = "not_found" | "unauthorized" | "bad_request";

export type PairRedeemResponse =
  | { readonly ok: true; readonly payload: PairingPayload }
  | { readonly ok: false; readonly error: PairRedeemErrorCode };

const CONFUSABLES: Readonly<Record<string, string>> = {
  I: "1",
  L: "1",
  O: "0",
};

/**
 * Fold what a human typed into a canonical code, or null if it cannot be one.
 * Strips spaces/dashes (we print `ABC-DEF`), uppercases, and resolves the three
 * confusable glyphs the alphabet excludes. Length and charset are enforced, so
 * a caller can hand the result straight to a constant-time comparison.
 */
export function normalizePairCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (compact.length !== PAIR_CODE_LENGTH) return null;
  let out = "";
  for (const ch of compact) {
    const mapped = CONFUSABLES[ch] ?? ch;
    if (!PAIR_CODE_ALPHABET.includes(mapped)) return null;
    out += mapped;
  }
  return out;
}

/** Display form: `ABC-DEF`. Grouping halves the retype error rate. */
export function formatPairCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** True for a well-formed redemption nonce (lowercase hex, exact length). */
export function isRedemptionNonce(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === REDEMPTION_NONCE_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(value)
  );
}

/** Mint a redemption nonce with the Web Crypto RNG (Node ≥ 20 and browsers). */
export function newRedemptionNonce(): string {
  const bytes = new Uint8Array(REDEMPTION_NONCE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Validate a redeemed ticket before anything is saved; the host is untrusted input. */
export function isPairingPayload(value: unknown): value is PairingPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (
    !isNonEmptyString(p.baseUrl) ||
    !p.baseUrl.startsWith("https://") ||
    !isNonEmptyString(p.host) ||
    !isNonEmptyString(p.token) ||
    !isNonEmptyString(p.label) ||
    !isNonEmptyString(p.deviceId)
  ) {
    return false;
  }
  if (p.controlCredential !== undefined && !isNonEmptyString(p.controlCredential)) return false;
  return true;
}

const ERROR_CODES: readonly string[] = ["not_found", "unauthorized", "bad_request"];

/** Type guard for a redeem response arriving over the network. */
export function isPairRedeemResponse(value: unknown): value is PairRedeemResponse {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.ok === true) return isPairingPayload(r.payload);
  if (r.ok === false) return ERROR_CODES.includes(r.error as string);
  return false;
}
