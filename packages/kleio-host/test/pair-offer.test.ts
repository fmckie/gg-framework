// Ported from kleio-desktop test/pair-offer.test.ts (MIT). Same redemption table;
// adapted for the async redeem and the mint-on-redeem callback.
import { describe, expect, it, vi } from "vitest";
import {
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  PAIR_HOLD_MS,
  PAIR_MAX_ATTEMPTS,
  PAIR_OFFER_TTL_MS,
  PAIR_RETRY_AFTER_MS,
  PAIR_RETRY_WINDOW_MS,
  type PairingPayload,
} from "../src/pair-code.js";
import {
  cleanLabel,
  createPairOfferStore,
  holdFor,
  MAX_RETIRED_CODES,
  mintCode,
  OFF_THE_LINK,
  RETIRED_CODE_TTL_MS,
  type PairOfferStore,
  type PairRedeemOutcome,
  type RedeemVia,
} from "../src/pair-offer.js";

const NONCE = "a".repeat(32);
const OTHER_NONCE = "b".repeat(32);

function payloadFor(label: string | undefined, n: number): PairingPayload {
  return {
    baseUrl: "https://mac.taila6c237.ts.net:8443",
    host: "mac.taila6c237.ts.net",
    token: `tok-${n}`,
    label: label ?? "Device",
    deviceId: `dev-${n}`,
  };
}

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

function fixture(mintCodeImpl?: () => string): {
  store: PairOfferStore;
  advance: (ms: number) => void;
  code: string;
  mints: () => number;
  labels: (string | undefined)[];
} {
  const c = clock();
  const store = createPairOfferStore({
    now: c.now,
    ...(mintCodeImpl ? { mintCode: mintCodeImpl } : {}),
  });
  let mints = 0;
  const labels: (string | undefined)[] = [];
  const offer = store.offer(async (label) => {
    labels.push(label);
    mints += 1;
    return payloadFor(label, mints);
  });
  return { store, advance: c.advance, code: offer.code, mints: () => mints, labels };
}

describe("createPairOfferStore — redemption table", () => {
  it("correct code, first time, live offer: ok + payload, minted exactly once", async () => {
    const f = fixture();
    const r = await f.store.redeem(f.code, NONCE, "Laptop");
    expect(r).toEqual({ ok: true, payload: payloadFor("Laptop", 1) });
    expect(f.mints()).toBe(1);
    expect(f.labels).toEqual(["Laptop"]);
  });

  it("correct code, same nonce, inside the window: identical payload, no re-mint", async () => {
    const f = fixture();
    const first = await f.store.redeem(f.code, NONCE);
    f.advance(PAIR_RETRY_WINDOW_MS - 1);
    const again = await f.store.redeem(f.code, NONCE);
    expect(again).toEqual(first);
    expect(f.mints()).toBe(1);
  });

  it("correct code, different nonce, inside the window: used, and no replay", async () => {
    const f = fixture();
    await f.store.redeem(f.code, NONCE);
    expect(await f.store.redeem(f.code, OTHER_NONCE)).toEqual({ ok: false, reason: "used" });
    expect(f.mints()).toBe(1);
  });

  it("correct code, same nonce, past the window: used, and the payload isn't replayed", async () => {
    const f = fixture();
    await f.store.redeem(f.code, NONCE);
    f.advance(PAIR_RETRY_WINDOW_MS);
    expect(await f.store.redeem(f.code, NONCE)).toEqual({ ok: false, reason: "used" });
    expect(f.mints()).toBe(1);
  });

  it("correct code after revoke(): the offer is gone (404), nothing minted", async () => {
    const f = fixture();
    f.store.revoke();
    expect(await f.store.redeem(f.code, NONCE)).toEqual({ ok: false, reason: "not_found" });
    expect(f.mints()).toBe(0);
  });

  it("a new offer replaces the old code, which says so at no cost to the new one", async () => {
    const f = fixture();
    const second = f.store.offer(async () => payloadFor("Second", 99));
    expect(second.code).not.toBe(f.code);
    expect(await f.store.redeem(f.code, NONCE)).toEqual({ ok: false, reason: "replaced" });
    expect(f.store.peek().attemptsRemaining).toBe(PAIR_MAX_ATTEMPTS);
    expect(await f.store.redeem(second.code, NONCE)).toEqual({
      ok: true,
      payload: payloadFor("Second", 99),
    });
    expect(f.mints()).toBe(0);
  });

  it("wrong code against a live offer: unauthorized, one attempt spent, nothing minted", async () => {
    const f = fixture();
    expect(await f.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "unauthorized" });
    expect(f.store.peek().attemptsRemaining).toBe(PAIR_MAX_ATTEMPTS - 1);
    expect(f.mints()).toBe(0);
  });

  it("the fifth wrong code destroys the offer, and its own code then says locked", async () => {
    const f = fixture();
    for (let i = 0; i < PAIR_MAX_ATTEMPTS; i += 1) {
      expect(await f.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "unauthorized" });
    }
    expect(f.store.peek().active).toBe(false);
    expect(await f.store.redeem(f.code, NONCE)).toEqual({ ok: false, reason: "locked" });
    expect(await f.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "not_found" });
    expect(f.mints()).toBe(0);
  });

  it("an expired offer's own code says expired", async () => {
    const f = fixture();
    f.advance(PAIR_OFFER_TTL_MS);
    expect(await f.store.redeem(f.code, NONCE)).toEqual({ ok: false, reason: "expired" });
    expect(await f.store.redeem(f.code, NONCE)).toEqual({ ok: false, reason: "expired" });
    expect(f.mints()).toBe(0);
  });

  it("any other code after expiry answers unauthorized once, then 404, as it always did", async () => {
    const f = fixture();
    f.advance(PAIR_OFFER_TTL_MS);
    expect(await f.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "unauthorized" });
    expect(await f.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "not_found" });
  });

  it("any request with no offer: 404", async () => {
    const store = createPairOfferStore();
    expect(await store.redeem("ABCDEF", NONCE)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a malformed body is bad_request and changes nothing", async () => {
    const f = fixture();
    const before = f.store.peek();
    for (const [code, nonce] of [
      [undefined, NONCE],
      ["ABCDE", NONCE],
      ["ABCDEFG", NONCE],
      ["ABCDE!", NONCE],
      [f.code, undefined],
      [f.code, "a".repeat(31)],
      [f.code, "A".repeat(32)],
      [f.code, "g".repeat(32)],
    ] as const) {
      expect(await f.store.redeem(code, nonce)).toEqual({ ok: false, reason: "bad_request" });
    }
    expect(f.store.peek()).toEqual(before);
    expect(f.mints()).toBe(0);
  });
});

describe("createPairOfferStore — invariants", () => {
  it("a wrong code does not consume the retry record", async () => {
    const f = fixture();
    const first = await f.store.redeem(f.code, NONCE);
    await f.store.redeem("ZZZZZZ", NONCE);
    expect(await f.store.redeem(f.code, NONCE)).toEqual(first);
  });

  it("a retry does not consume an attempt", async () => {
    const f = fixture();
    await f.store.redeem(f.code, NONCE);
    for (let i = 0; i < PAIR_MAX_ATTEMPTS + 2; i += 1) await f.store.redeem(f.code, NONCE);
    expect(f.store.peek().active).toBe(true);
  });

  it("normalizes what the user typed: dashes, case, and I/L/O", async () => {
    const f = fixture(() => "AB1C0D");
    expect(await f.store.redeem("ab-1c od".replace(" ", ""), NONCE)).toMatchObject({ ok: true });
    const g = fixture(() => "AB1C0D");
    expect(await g.store.redeem("abIcOd", NONCE)).toMatchObject({ ok: true });
    const h = fixture(() => "AB1C0D");
    expect(await h.store.redeem("abLcOd", NONCE)).toMatchObject({ ok: true });
  });

  it("peek() never exposes the code or the payload, and reports admin", () => {
    const f = fixture();
    const state = f.store.peek();
    expect(JSON.stringify(state)).not.toContain(f.code);
    expect(state).toEqual({
      active: true,
      expiresAt: 1_000_000 + PAIR_OFFER_TTL_MS,
      attemptsRemaining: PAIR_MAX_ATTEMPTS,
      redeemed: false,
      admin: false,
      claim: null,
    });
    f.store.offer(async () => payloadFor("Admin", 1), { admin: true });
    expect(f.store.peek().admin).toBe(true);
  });

  it("peek() reports idle before any offer and after expiry", () => {
    const store = createPairOfferStore();
    expect(store.peek()).toEqual({
      active: false,
      expiresAt: null,
      attemptsRemaining: 0,
      redeemed: false,
      admin: false,
      claim: null,
    });
    const f = fixture();
    f.advance(PAIR_OFFER_TTL_MS);
    expect(f.store.peek().active).toBe(false);
  });

  it("a failing mint leaves the offer live and consumes no attempt", async () => {
    const store = createPairOfferStore();
    let fail = true;
    const offer = store.offer(async () => {
      if (fail) throw new Error("registry down");
      return payloadFor("Laptop", 1);
    });
    expect(await store.redeem(offer.code, NONCE)).toEqual({ ok: false, reason: "unauthorized" });
    expect(store.peek()).toMatchObject({
      active: true,
      attemptsRemaining: PAIR_MAX_ATTEMPTS,
      redeemed: false,
    });
    fail = false;
    expect(await store.redeem(offer.code, NONCE)).toEqual({
      ok: true,
      payload: payloadFor("Laptop", 1),
    });
  });

  it("two concurrent correct redeems mint once; the second nonce is refused", async () => {
    const store = createPairOfferStore();
    let mints = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const offer = store.offer(async () => {
      mints += 1;
      await gate;
      return payloadFor("Laptop", mints);
    });
    const a = store.redeem(offer.code, NONCE);
    const b = store.redeem(offer.code, OTHER_NONCE);
    release();
    expect(await a).toEqual({ ok: true, payload: payloadFor("Laptop", 1) });
    expect(await b).toEqual({ ok: false, reason: "unauthorized" });
    expect(mints).toBe(1);
  });

  it("an offer revoked while minting hands out nothing", async () => {
    const store = createPairOfferStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const offer = store.offer(async () => {
      await gate;
      return payloadFor("Laptop", 1);
    });
    const pending = store.redeem(offer.code, NONCE);
    store.revoke();
    release();
    expect(await pending).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("mints codes over the whole alphabet, roughly uniformly", () => {
    const counts = new Map<string, number>();
    const samples = 4000;
    for (let i = 0; i < samples; i += 1) {
      const code = mintCode();
      expect(code).toHaveLength(PAIR_CODE_LENGTH);
      for (const ch of code) {
        expect(PAIR_CODE_ALPHABET).toContain(ch);
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(PAIR_CODE_ALPHABET.length);
    const expected = (samples * PAIR_CODE_LENGTH) / PAIR_CODE_ALPHABET.length;
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(expected * 0.7);
      expect(n).toBeLessThan(expected * 1.3);
    }
  });

  it("expiry is TTL from mint", () => {
    const c = clock(5000);
    const store = createPairOfferStore({ now: c.now });
    const offer = store.offer(async () => payloadFor("x", 1));
    expect(offer.expiresAt).toBe(5000 + PAIR_OFFER_TTL_MS);
  });
});

describe("createPairOfferStore: redeeming over the link", () => {
  const KEY_A = "a".repeat(64);
  const KEY_B = "b".repeat(64);

  it("hands the minter where the redemption came from, and who allowed it", async () => {
    const minted: { via: RedeemVia; allowedBy: string | null }[] = [];
    const store = createPairOfferStore({ hold: async () => {} });
    const offer = store.offer(async (label, via, allowedBy) => {
      minted.push({ via, allowedBy });
      return payloadFor(label, 1);
    });
    const phone = (): ReturnType<PairOfferStore["redeem"]> =>
      store.redeem(offer.code, NONCE, "Phone", { linkKey: KEY_A }, true);
    expect(await phone()).toMatchObject({ ok: false, reason: "pending" });
    expect(store.decide(true, "Will's Mac")).toMatchObject({ ok: true });
    expect(await phone()).toMatchObject({ ok: true });
    expect(minted).toEqual([{ via: { linkKey: KEY_A }, allowedBy: "Will's Mac" }]);

    const other = createPairOfferStore();
    const second = other.offer(async (label, via, allowedBy) => {
      minted.push({ via, allowedBy });
      return payloadFor(label, 2);
    });
    await other.redeem(second.code, NONCE, "Laptop");
    expect(minted.at(-1)).toEqual({ via: { linkKey: null }, allowedBy: null });
  });

  it("replays a retry only from where the first redemption came", async () => {
    const store = createPairOfferStore({ hold: async () => {} });
    let mints = 0;
    const offer = store.offer(async (label) => payloadFor(label, (mints += 1)));
    const phone = { linkKey: KEY_A };
    expect(await store.redeem(offer.code, NONCE, "Phone", phone, true)).toMatchObject({
      reason: "pending",
    });
    store.decide(true, "Admin");
    const first = await store.redeem(offer.code, NONCE, "Phone", phone, true);
    expect(first).toMatchObject({ ok: true });
    expect(await store.redeem(offer.code, NONCE, "Phone", phone, true)).toEqual(first);
    // From anywhere else, even with the nonce, the code has paired its device.
    for (const via of [{ linkKey: KEY_B }, { linkKey: null }]) {
      expect(await store.redeem(offer.code, NONCE, "Phone", via, true)).toEqual({
        ok: false,
        reason: "used",
      });
    }
    expect(await store.redeem(offer.code, NONCE)).toEqual({ ok: false, reason: "used" });
    expect(mints).toBe(1);
  });
});

describe("createPairOfferStore: retired codes", () => {
  /** A store whose codes are `codes`, one per offer, on a clock the test moves. */
  function store(codes: string[]): {
    store: PairOfferStore;
    advance: (ms: number) => void;
    offer: () => string;
  } {
    const c = clock();
    let i = 0;
    const s = createPairOfferStore({ now: c.now, mintCode: () => codes[i++] ?? "ZZZZZZ" });
    return {
      store: s,
      advance: c.advance,
      offer: () => s.offer(async (label) => payloadFor(label, i)).code,
    };
  }

  it("gives a code that isn't one it retired today's answer, after each kind of retirement", async () => {
    // used, replaced, locked and expired, one after another.
    const s = store(["AAA111", "BBB222", "CCC333", "DDD444", "EEE555"]);
    await s.store.redeem(s.offer(), NONCE);
    s.offer(); // used
    s.offer(); // replaced
    for (let i = 0; i < PAIR_MAX_ATTEMPTS; i += 1) await s.store.redeem("ZZZZZZ", NONCE); // locked
    expect(await s.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "not_found" });
    s.offer();
    s.advance(PAIR_OFFER_TTL_MS); // expired
    expect(await s.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "unauthorized" });
    expect(await s.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "not_found" });
    s.offer(); // live
    expect(await s.store.redeem("ZZZZZZ", NONCE)).toEqual({ ok: false, reason: "unauthorized" });
    expect(s.store.peek().attemptsRemaining).toBe(PAIR_MAX_ATTEMPTS - 1);

    // Each retired code, shown exactly (as typed, too), says why.
    expect(await s.store.redeem("aaa111", NONCE)).toEqual({ ok: false, reason: "used" });
    expect(await s.store.redeem("BBB-222", NONCE)).toEqual({ ok: false, reason: "replaced" });
    expect(await s.store.redeem("CCC333", NONCE)).toEqual({ ok: false, reason: "locked" });
    expect(await s.store.redeem("DDD444", NONCE)).toEqual({ ok: false, reason: "expired" });
    // ...at no cost to the live offer.
    expect(s.store.peek().attemptsRemaining).toBe(PAIR_MAX_ATTEMPTS - 1);
    expect(await s.store.redeem("EEE555", NONCE)).toMatchObject({ ok: true });
  });

  it("revoking a redeemed offer retires its code as used, and an unredeemed one as nothing", async () => {
    const s = store(["AAA111", "FFF666"]);
    await s.store.redeem(s.offer(), NONCE);
    s.store.revoke();
    expect(await s.store.redeem("AAA111", OTHER_NONCE)).toEqual({ ok: false, reason: "used" });
    s.offer();
    s.store.revoke();
    expect(await s.store.redeem("FFF666", NONCE)).toEqual({ ok: false, reason: "not_found" });
  });

  it("forgets a retired code after an hour", async () => {
    const s = store(["EXPR00"]);
    s.offer();
    s.advance(PAIR_OFFER_TTL_MS);
    expect(await s.store.redeem("EXPR00", NONCE)).toEqual({ ok: false, reason: "expired" });
    s.advance(RETIRED_CODE_TTL_MS - 1);
    expect(await s.store.redeem("EXPR00", NONCE)).toEqual({ ok: false, reason: "expired" });
    s.advance(1);
    expect(await s.store.redeem("EXPR00", NONCE)).toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps only the latest retired codes", async () => {
    const codes = Array.from({ length: MAX_RETIRED_CODES + 2 }, (_, i) =>
      `R${String(i).padStart(2, "0")}000`.slice(0, PAIR_CODE_LENGTH),
    );
    const s = store(codes);
    for (let i = 0; i < codes.length; i += 1) s.offer();
    // The last code is live; each before it was replaced, and the first one is forgotten.
    expect(await s.store.redeem(codes[0], NONCE)).toEqual({ ok: false, reason: "unauthorized" });
    expect(await s.store.redeem(codes[1], NONCE)).toEqual({ ok: false, reason: "replaced" });
    expect(await s.store.redeem(codes[codes.length - 2], NONCE)).toEqual({
      ok: false,
      reason: "replaced",
    });
  });
});

describe("createPairOfferStore: a device over the link waits for an admin's Allow", () => {
  /** The phone's key: its device code is 3F9 AC2. */
  const PHONE: RedeemVia = { linkKey: `3f9ac2${"a".repeat(58)}` };
  const STRANGER: RedeemVia = { linkKey: "b".repeat(64) };

  /**
   * A live offer on a clock the test moves, whose holds end at once, as if no
   * admin decided within one. `redeem` is the phone's request, as it sends it.
   */
  function waiting(): {
    store: PairOfferStore;
    advance: (ms: number) => void;
    code: string;
    mints: () => number;
    redeem: (via?: RedeemVia, nonce?: string) => Promise<PairRedeemOutcome>;
  } {
    const c = clock();
    const store = createPairOfferStore({ now: c.now, hold: async () => {} });
    let mints = 0;
    const { code } = store.offer(async (label) => payloadFor(label, (mints += 1)));
    return {
      store,
      advance: c.advance,
      code,
      mints: () => mints,
      redeem: (via = PHONE, nonce = NONCE) => store.redeem(code, nonce, "Phone", via, true),
    };
  }

  it("is pending until an admin decides, and nothing is made meanwhile", async () => {
    const w = waiting();
    const pending = {
      ok: false,
      reason: "pending",
      retryAfterMs: PAIR_RETRY_AFTER_MS,
      expiresAt: 1_000_000 + PAIR_OFFER_TTL_MS,
    };
    expect(await w.redeem()).toEqual(pending);
    w.advance(PAIR_RETRY_AFTER_MS);
    expect(await w.redeem()).toEqual(pending);
    expect(w.mints()).toBe(0);
    // The admin sees who's waiting, and never its nonce or whole key.
    const state = w.store.peek();
    expect(state).toEqual({
      active: true,
      expiresAt: 1_000_000 + PAIR_OFFER_TTL_MS,
      attemptsRemaining: PAIR_MAX_ATTEMPTS,
      redeemed: false,
      admin: false,
      claim: {
        label: "Phone",
        deviceCode: "3F9 AC2",
        at: 1_000_000,
        contested: false,
        allowed: false,
      },
    });
    expect(JSON.stringify(state)).not.toContain(NONCE);
    expect(JSON.stringify(state)).not.toContain(PHONE.linkKey);
  });

  it("after Allow, its next request pairs it, and the same nonce and key get that answer again", async () => {
    const w = waiting();
    await w.redeem();
    expect(w.store.decide(true, "Admin")).toEqual({
      ok: true,
      label: "Phone",
      deviceCode: "3F9 AC2",
    });
    expect(w.store.peek().claim).toMatchObject({ allowed: true });
    const paired = await w.redeem();
    expect(paired).toEqual({ ok: true, payload: payloadFor("Phone", 1) });
    expect(await w.redeem()).toEqual(paired);
    expect(w.mints()).toBe(1);
    expect(w.store.peek()).toMatchObject({ redeemed: true });
    // Nobody else gets it: not another nonce, nor another key.
    expect(await w.redeem(PHONE, OTHER_NONCE)).toEqual({ ok: false, reason: "used" });
    expect(await w.redeem(STRANGER)).toEqual({ ok: false, reason: "used" });
  });

  it("turns away anyone else with the code as claimed, at no try's cost, and tells the admin", async () => {
    const w = waiting();
    await w.redeem();
    expect(await w.redeem(STRANGER, OTHER_NONCE)).toEqual({ ok: false, reason: "claimed" });
    expect(await w.redeem(STRANGER)).toEqual({ ok: false, reason: "claimed" });
    expect(await w.redeem(PHONE, OTHER_NONCE)).toEqual({ ok: false, reason: "claimed" });
    // Off the link too: the code is that device's now.
    expect(await w.store.redeem(w.code, OTHER_NONCE, "Laptop")).toEqual({
      ok: false,
      reason: "claimed",
    });
    expect(w.store.peek()).toMatchObject({
      attemptsRemaining: PAIR_MAX_ATTEMPTS,
      claim: { label: "Phone", contested: true },
    });
    // The device that claimed it still pairs, once allowed.
    w.store.decide(true, "Admin");
    expect(await w.redeem()).toMatchObject({ ok: true });
    expect(w.mints()).toBe(1);
  });

  it("Deny retires the code as denied: the device is told, and nothing was made", async () => {
    const w = waiting();
    await w.redeem();
    expect(w.store.decide(false, "Admin")).toEqual({
      ok: true,
      label: "Phone",
      deviceCode: "3F9 AC2",
    });
    expect(w.store.peek().active).toBe(false);
    expect(await w.redeem()).toEqual({ ok: false, reason: "denied" });
    expect(await w.redeem(STRANGER, OTHER_NONCE)).toEqual({ ok: false, reason: "denied" });
    expect(w.mints()).toBe(0);
  });

  it("closing the code, or its running out, turns a waiting device down too", async () => {
    const closed = waiting();
    await closed.redeem();
    closed.store.revoke();
    expect(await closed.redeem()).toEqual({ ok: false, reason: "denied" });

    const ranOut = waiting();
    await ranOut.redeem();
    ranOut.advance(PAIR_OFFER_TTL_MS);
    expect(ranOut.store.peek().active).toBe(false);
    expect(await ranOut.redeem()).toEqual({ ok: false, reason: "denied" });
    expect(closed.mints() + ranOut.mints()).toBe(0);
  });

  it("gives an allowed device the retry window to come for its token, past the code's time", async () => {
    const w = waiting();
    await w.redeem();
    w.advance(PAIR_OFFER_TTL_MS - 1);
    w.store.decide(true, "Admin");
    w.advance(PAIR_RETRY_WINDOW_MS - 1);
    expect(await w.redeem()).toMatchObject({ ok: true });

    const late = waiting();
    await late.redeem();
    late.store.decide(true, "Admin");
    late.advance(PAIR_OFFER_TTL_MS);
    expect(await late.redeem()).toEqual({ ok: false, reason: "expired" });
    expect(late.mints()).toBe(0);
  });

  it("ends a request's hold as soon as an admin decides, or the code goes", async () => {
    const holds: number[] = [];
    const store = createPairOfferStore({
      // A hold that only a decision ends.
      hold: (ms, signal) => {
        holds.push(ms);
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
      },
    });
    const offer = (n: number): string => store.offer(async (label) => payloadFor(label, n)).code;
    const ask = (code: string): Promise<PairRedeemOutcome> =>
      store.redeem(code, NONCE, "Phone", PHONE, true);

    const allowed = ask(offer(1));
    // Held: the admin sees who's waiting, and allows it.
    expect(store.peek().claim).toMatchObject({ label: "Phone", allowed: false });
    store.decide(true, "Admin");
    expect(await allowed).toEqual({ ok: true, payload: payloadFor("Phone", 1) });
    expect(holds).toEqual([PAIR_HOLD_MS]);

    const denied = ask(offer(2));
    store.decide(false, "Admin");
    expect(await denied).toEqual({ ok: false, reason: "denied" });

    const closed = ask(offer(3));
    store.revoke();
    expect(await closed).toEqual({ ok: false, reason: "denied" });

    const replaced = ask(offer(4));
    offer(5);
    expect(await replaced).toEqual({ ok: false, reason: "replaced" });
  });

  it("holds a request PAIR_HOLD_MS by default, then answers pending", async () => {
    vi.useFakeTimers();
    try {
      const store = createPairOfferStore();
      const { code } = store.offer(async (label) => payloadFor(label, 1));
      let answer: PairRedeemOutcome | null = null;
      void store.redeem(code, NONCE, "Phone", PHONE, true).then((a) => (answer = a));
      await vi.advanceTimersByTimeAsync(PAIR_HOLD_MS - 1);
      expect(answer).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toMatchObject({ ok: false, reason: "pending" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("holdFor ends at once on an abort, and on its own after its time", async () => {
    const started = Date.now();
    const controller = new AbortController();
    const held = holdFor(60_000, controller.signal);
    controller.abort();
    await held;
    await holdFor(60_000, controller.signal); // already aborted
    await holdFor(5, new AbortController().signal);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("tells an app too old to wait to update, and changes nothing", async () => {
    const w = waiting();
    const before = w.store.peek();
    for (const waits of [undefined, false, "true", 1]) {
      expect(await w.store.redeem(w.code, NONCE, "Phone", PHONE, waits), String(waits)).toEqual({
        ok: false,
        reason: "update_required",
      });
    }
    // A wrong code too: no try is spent.
    expect(await w.store.redeem("ZZZZZZ", NONCE, "Phone", PHONE)).toEqual({
      ok: false,
      reason: "update_required",
    });
    expect(w.store.peek()).toEqual(before);
    expect(w.mints()).toBe(0);
    // A body that isn't a redeem body is still that, first.
    expect(await w.store.redeem("x", NONCE, "Phone", PHONE)).toEqual({
      ok: false,
      reason: "bad_request",
    });
  });

  it("off the link, a code pairs at once, with nobody asked", async () => {
    const f = fixture();
    expect(await f.store.redeem(f.code, NONCE, "Laptop", OFF_THE_LINK, true)).toEqual({
      ok: true,
      payload: payloadFor("Laptop", 1),
    });
    expect(f.store.peek().claim).toBeNull();
    expect(f.store.decide(true, "Admin")).toEqual({ ok: false, reason: "none_waiting" });
  });

  it("decides only while a device waits, and only for the one the admin was shown", async () => {
    const w = waiting();
    expect(w.store.decide(true, "Admin")).toEqual({ ok: false, reason: "none_waiting" });
    await w.redeem();
    expect(w.store.decide(true, "Admin", "000 000")).toEqual({ ok: false, reason: "changed" });
    expect(w.store.decide(false, "Admin", "000 000")).toEqual({ ok: false, reason: "changed" });
    expect(w.store.peek().claim).toMatchObject({ allowed: false });
    expect(w.store.decide(true, "Admin", "3f9ac2")).toMatchObject({ ok: true });
    await w.redeem();
    // Paired: nothing's left to decide.
    expect(w.store.decide(false, "Admin")).toEqual({ ok: false, reason: "none_waiting" });
    expect(w.store.peek()).toMatchObject({ active: true, redeemed: true });
  });
});

describe("cleanLabel", () => {
  it("strips bidi overrides, zero-width and control characters, and collapses spaces", () => {
    expect(cleanLabel("Finn\u202E's\u200B iPhone\u2066")).toBe("Finn's iPhone");
    expect(cleanLabel("\u2067Will's\u2069 \uFEFFMac\u0000")).toBe("Will's Mac");
    expect(cleanLabel("  Will's\n\tphone  ")).toBe("Will's phone");
    expect(cleanLabel("a \u200D b")).toBe("a b");
    expect(cleanLabel("lone \uD800 surrogate")).toBe("lone surrogate");
    expect(cleanLabel("Café 📱")).toBe("Café 📱");
  });

  it("gives nothing for a label that's empty once cleaned, too long, or not text", () => {
    for (const label of ["", "   ", "\u202E\u200B", "x".repeat(65), 5, null, undefined]) {
      expect(cleanLabel(label), String(label)).toBeUndefined();
    }
    expect(cleanLabel("x".repeat(64))).toBe("x".repeat(64));
  });

  it("lists a device, and shows it to the admin, under its cleaned label", async () => {
    const f = fixture();
    await f.store.redeem(f.code, NONCE, "Evil\u202Egnp.exe");
    expect(f.labels).toEqual(["Evilgnp.exe"]);

    const store = createPairOfferStore({ hold: async () => {} });
    const { code } = store.offer(async (label) => payloadFor(label, 1));
    await store.redeem(code, NONCE, "Phone\u200B\u2066", { linkKey: "c".repeat(64) }, true);
    expect(store.peek().claim?.label).toBe("Phone");
  });
});
