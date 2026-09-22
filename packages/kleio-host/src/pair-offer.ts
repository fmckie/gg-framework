// Single live pair offer, in memory. Ported from kleio-desktop
// `src/main/pairing/pair-offer.ts` (MIT) with one change: the offer holds a
// *mint* callback rather than a pre-built payload, so the device record and its
// token only come into existence when a code is actually redeemed. An offer that
// expires unredeemed leaves nothing behind. Retry semantics are unchanged: the
// first redemption's payload is cached for the retry window and replayed to the
// same nonce.

import { randomInt, timingSafeEqual } from "node:crypto";
import {
  isRedemptionNonce,
  normalizePairCode,
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  PAIR_MAX_ATTEMPTS,
  PAIR_OFFER_TTL_MS,
  PAIR_RETRY_WINDOW_MS,
  type PairingPayload,
} from "./pair-code.js";

export interface PairOffer {
  /** The plaintext code, for display on the host only. */
  readonly code: string;
  readonly expiresAt: number;
}

export type PairRedeemOutcome =
  | { readonly ok: true; readonly payload: PairingPayload }
  | {
      readonly ok: false;
      /**
       * `bad_request` — the body was not a code + nonce at all; nothing is
       * consumed. `not_found` — no offer exists. `unauthorized` — the uniform
       * verdict for wrong, expired, exhausted, and refused-replay alike, so the
       * response shape is never an oracle for which it was.
       */
      readonly reason: "bad_request" | "not_found" | "unauthorized";
    };

/** Secret-free state for the host UI. Never contains the code or payload. */
export interface PairOfferState {
  readonly active: boolean;
  readonly expiresAt: number | null;
  readonly attemptsRemaining: number;
  readonly redeemed: boolean;
  /** Whether this offer would grant a control credential (admin pairing). */
  readonly admin: boolean;
}

/** Called exactly once, on the first successful redemption. */
export type PayloadMinter = (label: string | undefined) => Promise<PairingPayload>;

export interface PairOfferStore {
  /** Mint a code, replacing (and invalidating) any live offer. */
  offer(mint: PayloadMinter, options?: { readonly admin?: boolean }): PairOffer;
  redeem(code: unknown, redemptionNonce: unknown, label?: unknown): Promise<PairRedeemOutcome>;
  peek(): PairOfferState;
  revoke(): void;
}

const IDLE: PairOfferState = {
  active: false,
  expiresAt: null,
  attemptsRemaining: 0,
  redeemed: false,
  admin: false,
};

/**
 * Uniform over the alphabet: `randomInt(max)` rejection-samples internally, so
 * there is no modulo bias to reintroduce here.
 */
export function mintCode(): string {
  let out = "";
  for (let i = 0; i < PAIR_CODE_LENGTH; i += 1) {
    out += PAIR_CODE_ALPHABET.charAt(randomInt(PAIR_CODE_ALPHABET.length));
  }
  return out;
}

/** Constant-time compare of two same-charset strings; false on length mismatch. */
export function secretEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

interface LiveOffer {
  readonly code: string;
  readonly mint: PayloadMinter;
  readonly admin: boolean;
  readonly expiresAt: number;
  attemptsRemaining: number;
  /** Set on first successful redemption; the offer then only serves retries. */
  redeemed: {
    readonly nonce: string;
    readonly payload: PairingPayload;
    readonly expiresAt: number;
  } | null;
  /** Mint in flight: a second correct redeem racing the first must wait, not double-mint. */
  minting: Promise<PairingPayload> | null;
}

export interface PairOfferStoreDeps {
  /** Injected for tests. Defaults to Date.now. */
  readonly now?: () => number;
  /** Injected for tests. Defaults to a CSPRNG over the alphabet. */
  readonly mintCode?: () => string;
}

export function createPairOfferStore(deps: PairOfferStoreDeps = {}): PairOfferStore {
  const now = deps.now ?? ((): number => Date.now());
  const mint = deps.mintCode ?? mintCode;
  let live: LiveOffer | null = null;

  /**
   * Drop the offer once its TTL — or, after redemption, its retry window —
   * lapses. Returns "expired" only for a TTL lapse we are destroying right now,
   * because that single request still answers `unauthorized` (uniform with a
   * wrong code); every later one gets a bare 404.
   */
  function reap(at: number): "expired" | "none" {
    if (!live) return "none";
    if (live.redeemed) {
      if (at >= live.redeemed.expiresAt) live = null;
      return "none";
    }
    if (at < live.expiresAt) return "none";
    live = null;
    return "expired";
  }

  return {
    offer(mintPayload, options = {}): PairOffer {
      const at = now();
      const code = mint();
      live = {
        code,
        mint: mintPayload,
        admin: options.admin === true,
        expiresAt: at + PAIR_OFFER_TTL_MS,
        attemptsRemaining: PAIR_MAX_ATTEMPTS,
        redeemed: null,
        minting: null,
      };
      return { code, expiresAt: live.expiresAt };
    },

    async redeem(code, redemptionNonce, label): Promise<PairRedeemOutcome> {
      // A malformed body must not touch state — otherwise the attempt budget is
      // burnable without ever guessing a code. Checked before the clock so it
      // cannot even observe expiry.
      const normalized = normalizePairCode(code);
      if (normalized === null || !isRedemptionNonce(redemptionNonce)) {
        return { ok: false, reason: "bad_request" };
      }
      const cleanLabel =
        typeof label === "string" && label.trim().length > 0 && label.length <= 64
          ? label.trim()
          : undefined;

      const at = now();
      if (reap(at) === "expired") return { ok: false, reason: "unauthorized" };
      if (!live) return { ok: false, reason: "not_found" };
      const offer = live;

      const codeMatches = secretEqual(normalized, offer.code);

      if (offer.redeemed) {
        // Retry path: same code AND same nonce replays the identical payload.
        // A retry never consumes an attempt, so a flaky network cannot burn the
        // budget; a wrong nonce never consumes the record, so a replay attempt
        // cannot deny the legitimate client its retry.
        if (codeMatches && secretEqual(redemptionNonce, offer.redeemed.nonce)) {
          return { ok: true, payload: offer.redeemed.payload };
        }
        return { ok: false, reason: "unauthorized" };
      }

      if (!codeMatches) {
        offer.attemptsRemaining -= 1;
        if (offer.attemptsRemaining <= 0) live = null;
        return { ok: false, reason: "unauthorized" };
      }

      // Correct code. Mint once; a concurrent correct redeem with a different
      // nonce loses (uniform `unauthorized`), one with the same nonce shares.
      if (offer.minting) {
        return { ok: false, reason: "unauthorized" };
      }
      offer.minting = offer.mint(cleanLabel);
      let payload: PairingPayload;
      try {
        payload = await offer.minting;
      } catch {
        // Minting failed (registry unavailable). The offer stays live so the
        // user can retry once the host recovers; no attempt is consumed.
        offer.minting = null;
        return { ok: false, reason: "unauthorized" };
      }
      if (live !== offer) {
        // Revoked or replaced while minting; do not hand out a token for a
        // dead offer. The minted device stays in the registry for the admin to
        // see and revoke; leaking it would be worse than an orphan record.
        return { ok: false, reason: "unauthorized" };
      }
      offer.redeemed = {
        nonce: redemptionNonce,
        payload,
        expiresAt: now() + PAIR_RETRY_WINDOW_MS,
      };
      return { ok: true, payload };
    },

    peek(): PairOfferState {
      reap(now());
      if (!live) return IDLE;
      return {
        active: true,
        expiresAt: live.expiresAt,
        attemptsRemaining: live.attemptsRemaining,
        redeemed: live.redeemed !== null,
        admin: live.admin,
      };
    },

    revoke(): void {
      live = null;
    },
  };
}
