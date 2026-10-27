// Single live pair offer, in memory. Ported from kleio-desktop
// `src/main/pairing/pair-offer.ts` (MIT) with one change: the offer holds a
// *mint* callback rather than a pre-built payload, so the device record and its
// token only come into existence when a code is actually redeemed. An offer that
// expires unredeemed leaves nothing behind. Retry semantics are unchanged: the
// first redemption's payload is cached for the retry window and replayed to the
// same nonce.
//
// Kleio's addition: a code that stops being live is retired with why (used,
// expired, replaced, locked or denied), and for an hour that code, shown
// exactly, gets that answer instead of the uniform one, so a phone scanning an
// old QR code can say what to do. Any other code gets the answer it always
// did, and a retired code's answer costs the live offer no attempt.
//
// And a pairing over the link waits for an admin's Allow
// (docs/adr/0003-link-pairing-needs-approval.md). The first device to bring
// the live code over the link claims it, by its link key and nonce, and its
// device is made only once an admin allows it (`decide`). Until then each of
// its requests is held up to PAIR_HOLD_MS for the decision, then answered
// `pending`, and it asks again with the same nonce. Deny, closing the code,
// or the code running out while it waits retires the code as `denied`. Any
// other device with the code is turned away as `claimed`, at no attempt's
// cost. Off the link, a code pairs at once, as it always did.

import { randomInt, timingSafeEqual } from "node:crypto";
import {
  formatDeviceCode,
  isRedemptionNonce,
  normalizePairCode,
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  PAIR_HOLD_MS,
  PAIR_MAX_ATTEMPTS,
  PAIR_OFFER_TTL_MS,
  PAIR_RETRY_AFTER_MS,
  PAIR_RETRY_WINDOW_MS,
  type PairingPayload,
  type PairRetiredCode,
} from "./pair-code.js";

/** How long a retired code still gets its own answer. */
export const RETIRED_CODE_TTL_MS = 60 * 60_000;

/** The most retired codes kept; the oldest goes first. */
export const MAX_RETIRED_CODES = 16;

/** The longest label a device may send, before it's cleaned. */
export const MAX_LABEL_LENGTH = 64;

export interface PairOffer {
  /** The plaintext code, for display on the host only. */
  readonly code: string;
  readonly expiresAt: number;
}

export type PairRedeemOutcome =
  | { readonly ok: true; readonly payload: PairingPayload }
  | {
      /** The device waits on the code, and no admin has allowed it yet. */
      readonly ok: false;
      readonly reason: "pending";
      /** How long the device waits before it asks again. */
      readonly retryAfterMs: number;
      /** When the code runs out. */
      readonly expiresAt: number;
    }
  | {
      readonly ok: false;
      /**
       * `bad_request` — the body was not a code + nonce at all; nothing is
       * consumed. `update_required` — a pairing over the link that doesn't
       * wait for an admin's Allow; nothing is consumed. `not_found` — no
       * offer exists. `unauthorized` — the uniform verdict for any code that
       * is neither live nor retired, so the response shape is never an
       * oracle. `claimed` — the live code, which another device is waiting
       * on; no attempt is consumed. `used`, `expired`, `replaced`, `locked`,
       * `denied` — the code is exactly one this store retired, and why.
       */
      readonly reason:
        | "bad_request"
        | "update_required"
        | "not_found"
        | "unauthorized"
        | "claimed"
        | PairRetiredCode;
    };

/**
 * The device waiting on the live code over the link, as the host UI shows it.
 * Never its nonce or its whole link key.
 */
export interface PairClaimState {
  /** The name it asked to be listed under, cleaned; null if it gave none. */
  readonly label: string | null;
  /** Its device code (`formatDeviceCode`), which the device shows too. */
  readonly deviceCode: string;
  /** When it first brought the code. */
  readonly at: number;
  /** Whether another device has brought the code since. */
  readonly contested: boolean;
  /** Whether an admin has allowed it; it's then finishing on the device. */
  readonly allowed: boolean;
}

/** Secret-free state for the host UI. Never contains the code or payload. */
export interface PairOfferState {
  readonly active: boolean;
  readonly expiresAt: number | null;
  readonly attemptsRemaining: number;
  readonly redeemed: boolean;
  /** Whether this offer would grant a control credential (admin pairing). */
  readonly admin: boolean;
  /** The device waiting on the code over the link, if one is. */
  readonly claim: PairClaimState | null;
}

export type PairDecideOutcome =
  | {
      readonly ok: true;
      /** The device decided on, as the host UI showed it. */
      readonly label: string | null;
      readonly deviceCode: string;
    }
  | {
      readonly ok: false;
      /**
       * `none_waiting` — no device is waiting on a live code: none came, it
       * paired already, or the code is gone. `changed` — the device waiting
       * isn't the one whose device code the admin was shown.
       */
      readonly reason: "none_waiting" | "changed";
    };

/** Where a redemption came from: the link, with the device's key (link.ts), or not. */
export interface RedeemVia {
  /** The device's key on the link; null off it. */
  readonly linkKey: string | null;
}

/** A redemption on the host's own listener. */
export const OFF_THE_LINK: RedeemVia = { linkKey: null };

/**
 * Called exactly once, on the first successful redemption. `allowedBy` names
 * the admin who allowed a device over the link; it's null off the link.
 */
export type PayloadMinter = (
  label: string | undefined,
  via: RedeemVia,
  allowedBy: string | null,
) => Promise<PairingPayload>;

export interface PairOfferStore {
  /** Mint a code, replacing (and invalidating) any live offer. */
  offer(mint: PayloadMinter, options?: { readonly admin?: boolean }): PairOffer;
  /**
   * Redeem `code`. A retry replays the payload only with the same nonce and
   * from the same place: a token bound to one link key is no use from
   * another, and nothing else may have it. Over the link, `waits` must be
   * true: the device waits for an admin's Allow.
   */
  redeem(
    code: unknown,
    redemptionNonce: unknown,
    label?: unknown,
    via?: RedeemVia,
    waits?: unknown,
  ): Promise<PairRedeemOutcome>;
  /**
   * An admin's Allow or Deny, by `by`, for the device waiting on the live
   * code: only if it's the one with `deviceCode`, when that's given. Allow
   * lets its next request pair; Deny retires the code as `denied`.
   */
  decide(allow: boolean, by: string, deviceCode?: string): PairDecideOutcome;
  peek(): PairOfferState;
  /** Take the live code away. A device waiting on it is turned down (`denied`). */
  revoke(): void;
}

const IDLE: PairOfferState = {
  active: false,
  expiresAt: null,
  attemptsRemaining: 0,
  redeemed: false,
  admin: false,
  claim: null,
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

/**
 * The label a device sent, as the host lists it: no longer than
 * MAX_LABEL_LENGTH as sent, with control and format characters (bidi
 * overrides and zero-width ones among them) and lone surrogates gone, as
 * link.ts `ticketName` cleans a host's name. Line breaks and tabs become
 * spaces, and spaces are collapsed. Undefined if nothing's left.
 */
export function cleanLabel(label: unknown): string | undefined {
  if (typeof label !== "string" || label.length > MAX_LABEL_LENGTH) return undefined;
  const cleaned = label
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
export function holdFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** The device over the link a live code is reserved for. */
interface Claim {
  readonly nonce: string;
  readonly linkKey: string;
  readonly label: string | undefined;
  readonly at: number;
  /** An admin's Allow: who, and when. A Deny retires the code instead. */
  decision: { readonly by: string; readonly at: number } | null;
  /** Another device has brought the code since. */
  contested: boolean;
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
    readonly linkKey: string | null;
    readonly payload: PairingPayload;
    readonly expiresAt: number;
  } | null;
  /** Mint in flight: a second correct redeem racing the first must wait, not double-mint. */
  minting: Promise<PairingPayload> | null;
  /** The device waiting on the code over the link, once one brings it. */
  claim: Claim | null;
  /** Aborted once the offer is decided or retired, ending any request's hold. */
  readonly settled: AbortController;
}

export interface PairOfferStoreDeps {
  /** Injected for tests. Defaults to Date.now. */
  readonly now?: () => number;
  /** Injected for tests. Defaults to a CSPRNG over the alphabet. */
  readonly mintCode?: () => string;
  /**
   * Waits up to `ms` for an admin's decision on a link pairing, ending early
   * once `signal` aborts. Injected for tests. Defaults to `holdFor`.
   */
  readonly hold?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function createPairOfferStore(deps: PairOfferStoreDeps = {}): PairOfferStore {
  const now = deps.now ?? ((): number => Date.now());
  const mint = deps.mintCode ?? mintCode;
  const hold = deps.hold ?? holdFor;
  let live: LiveOffer | null = null;
  let retired: readonly { code: string; reason: PairRetiredCode; until: number }[] = [];

  /** Keep `code`'s reason for RETIRED_CODE_TTL_MS, with the latest MAX_RETIRED_CODES. */
  function retire(code: string, reason: PairRetiredCode, at: number): void {
    retired = [
      ...retired.filter((r) => r.until > at),
      { code, reason, until: at + RETIRED_CODE_TTL_MS },
    ].slice(-MAX_RETIRED_CODES);
  }

  /**
   * The live offer leaves: a redeemed one was used, whatever ends it. A
   * request held for a decision gets its answer at once.
   */
  function retireLive(reason: PairRetiredCode, at: number): void {
    if (live) {
      retire(live.code, live.redeemed ? "used" : reason, at);
      live.settled.abort();
    }
    live = null;
  }

  /**
   * Why `code` was retired, if it's exactly a code this store retired. Each
   * kept code is compared, in constant time, so the time taken says nothing
   * about which matched; the latest match wins.
   */
  function retiredReason(code: string, at: number): PairRetiredCode | null {
    let reason: PairRetiredCode | null = null;
    for (const r of retired) {
      if (secretEqual(code, r.code) && r.until > at) reason = r.reason;
    }
    return reason;
  }

  /**
   * Drop the offer once its TTL — or, after redemption, its retry window —
   * lapses. A device an admin allowed has the retry window from the Allow to
   * come for its token, even past the TTL; one still waiting for a decision
   * when the TTL lapses wasn't allowed, so the code is retired as `denied`. Returns
   * "expired" only for a TTL lapse we are destroying right now, because that
   * single request still answers `unauthorized` (uniform with a wrong code);
   * every later one gets a bare 404.
   */
  function reap(at: number): "expired" | "none" {
    if (!live) return "none";
    if (live.redeemed) {
      if (at >= live.redeemed.expiresAt) retireLive("used", at);
      return "none";
    }
    if (at < live.expiresAt) return "none";
    const allowed = live.claim?.decision;
    if (allowed && at < allowed.at + PAIR_RETRY_WINDOW_MS) return "none";
    retireLive(live.claim && !allowed ? "denied" : "expired", at);
    return "expired";
  }

  /**
   * Make the device, once: a concurrent correct redeem loses (uniform
   * `unauthorized`), so the payload is minted only once.
   */
  async function mintFor(
    offer: LiveOffer,
    label: string | undefined,
    nonce: string,
    via: RedeemVia,
    allowedBy: string | null,
  ): Promise<PairRedeemOutcome> {
    if (offer.minting) {
      return { ok: false, reason: "unauthorized" };
    }
    offer.minting = offer.mint(label, via, allowedBy);
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
      nonce,
      linkKey: via.linkKey,
      payload,
      expiresAt: now() + PAIR_RETRY_WINDOW_MS,
    };
    return { ok: true, payload };
  }

  return {
    offer(mintPayload, options = {}): PairOffer {
      const at = now();
      reap(at);
      retireLive("replaced", at);
      const code = mint();
      live = {
        code,
        mint: mintPayload,
        admin: options.admin === true,
        expiresAt: at + PAIR_OFFER_TTL_MS,
        attemptsRemaining: PAIR_MAX_ATTEMPTS,
        redeemed: null,
        minting: null,
        claim: null,
        settled: new AbortController(),
      };
      return { code, expiresAt: live.expiresAt };
    },

    async redeem(
      code,
      redemptionNonce,
      label,
      via = OFF_THE_LINK,
      waits,
    ): Promise<PairRedeemOutcome> {
      // A malformed body must not touch state — otherwise the attempt budget is
      // burnable without ever guessing a code. Checked before the clock so it
      // cannot even observe expiry.
      const normalized = normalizePairCode(code);
      if (normalized === null || !isRedemptionNonce(redemptionNonce)) {
        return { ok: false, reason: "bad_request" };
      }
      // Over the link, a device must wait for an admin's Allow. An app too
      // old to is told to update, before anything is touched.
      if (via.linkKey !== null && waits !== true) {
        return { ok: false, reason: "update_required" };
      }
      const cleaned = cleanLabel(label);

      const at = now();
      const lapsed = reap(at);
      if (!live) {
        const reason = retiredReason(normalized, at);
        if (reason) return { ok: false, reason };
        return { ok: false, reason: lapsed === "expired" ? "unauthorized" : "not_found" };
      }
      const offer = live;

      const codeMatches = secretEqual(normalized, offer.code);
      // A code from an older offer, exactly: why it's gone, at no attempt's cost.
      const reason = codeMatches ? null : retiredReason(normalized, at);
      if (reason) return { ok: false, reason };

      if (offer.redeemed) {
        // Retry path: same code AND same nonce replays the identical payload.
        // A retry never consumes an attempt, so a flaky network cannot burn the
        // budget; a wrong nonce never consumes the record, so a replay attempt
        // cannot deny the legitimate client its retry.
        if (
          codeMatches &&
          secretEqual(redemptionNonce, offer.redeemed.nonce) &&
          via.linkKey === offer.redeemed.linkKey
        ) {
          return { ok: true, payload: offer.redeemed.payload };
        }
        // The code paired a device already: this is someone else, or later.
        return { ok: false, reason: codeMatches ? "used" : "unauthorized" };
      }

      if (!codeMatches) {
        offer.attemptsRemaining -= 1;
        if (offer.attemptsRemaining <= 0) retireLive("locked", at);
        return { ok: false, reason: "unauthorized" };
      }

      // Correct code. Once a device over the link has claimed it, it's that
      // device's: anyone else is turned away, at no attempt's cost, and the
      // admin is told someone tried.
      const claimed = offer.claim;
      if (
        claimed &&
        !(secretEqual(redemptionNonce, claimed.nonce) && via.linkKey === claimed.linkKey)
      ) {
        claimed.contested = true;
        return { ok: false, reason: "claimed" };
      }
      // Off the link, a code pairs at once, as it always did.
      if (via.linkKey === null) return mintFor(offer, cleaned, redemptionNonce, via, null);

      // Over the link, the device waits for an admin's Allow.
      if (offer.minting) return { ok: false, reason: "unauthorized" };
      const claim =
        claimed ??
        (offer.claim = {
          nonce: redemptionNonce,
          linkKey: via.linkKey,
          label: cleaned,
          at,
          decision: null,
          contested: false,
        });
      if (!claim.decision) {
        await hold(PAIR_HOLD_MS, offer.settled.signal);
        const after = now();
        reap(after);
        // Denied, revoked, replaced or run out while it waited: say which.
        if (live !== offer) {
          return { ok: false, reason: retiredReason(normalized, after) ?? "not_found" };
        }
        if (!claim.decision) {
          return {
            ok: false,
            reason: "pending",
            retryAfterMs: PAIR_RETRY_AFTER_MS,
            expiresAt: offer.expiresAt,
          };
        }
      }
      // Allowed: the device is made under the name the admin was shown.
      return mintFor(offer, claim.label, redemptionNonce, via, claim.decision.by);
    },

    decide(allow, by, deviceCode): PairDecideOutcome {
      const at = now();
      reap(at);
      const claim = live?.claim;
      if (!live || !claim || live.redeemed) return { ok: false, reason: "none_waiting" };
      const shown = formatDeviceCode(claim.linkKey);
      const compact = (c: string): string => c.replace(/\s+/g, "").toUpperCase();
      if (deviceCode !== undefined && compact(deviceCode) !== compact(shown)) {
        return { ok: false, reason: "changed" };
      }
      if (allow) {
        claim.decision ??= { by, at };
        live.settled.abort();
      } else {
        retireLive("denied", at);
      }
      return { ok: true, label: claim.label ?? null, deviceCode: shown };
    },

    peek(): PairOfferState {
      reap(now());
      if (!live) return IDLE;
      const claim = live.claim;
      return {
        active: true,
        expiresAt: live.expiresAt,
        attemptsRemaining: live.attemptsRemaining,
        redeemed: live.redeemed !== null,
        admin: live.admin,
        claim: claim
          ? {
              label: claim.label ?? null,
              deviceCode: formatDeviceCode(claim.linkKey),
              at: claim.at,
              contested: claim.contested,
              allowed: claim.decision !== null,
            }
          : null,
      };
    },

    revoke(): void {
      // A code that paired a device was used, and one a device is waiting on
      // turns it down. One that didn't is simply gone: the host turned it
      // off, and no code is waiting.
      const at = now();
      reap(at);
      if (live?.redeemed) retireLive("used", at);
      else if (live?.claim) retireLive("denied", at);
      live = null;
    },
  };
}
