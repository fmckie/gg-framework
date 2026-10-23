// Ported from kleio-desktop test/pair-offer.test.ts (MIT). Same redemption table;
// adapted for the async redeem and the mint-on-redeem callback.
import { describe, expect, it } from "vitest";
import {
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  PAIR_MAX_ATTEMPTS,
  PAIR_OFFER_TTL_MS,
  PAIR_RETRY_WINDOW_MS,
  type PairingPayload,
} from "../src/pair-code.js";
import {
  createPairOfferStore,
  MAX_RETIRED_CODES,
  mintCode,
  RETIRED_CODE_TTL_MS,
  type PairOfferStore,
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

  it("hands the minter where the redemption came from", async () => {
    const vias: RedeemVia[] = [];
    const store = createPairOfferStore();
    const offer = store.offer(async (label, via) => {
      vias.push(via);
      return payloadFor(label, 1);
    });
    expect(await store.redeem(offer.code, NONCE, "Phone", { linkKey: KEY_A })).toMatchObject({
      ok: true,
    });
    expect(vias).toEqual([{ linkKey: KEY_A }]);

    const other = createPairOfferStore();
    const second = other.offer(async (label, via) => {
      vias.push(via);
      return payloadFor(label, 2);
    });
    await other.redeem(second.code, NONCE, "Laptop");
    expect(vias).toEqual([{ linkKey: KEY_A }, { linkKey: null }]);
  });

  it("replays a retry only from where the first redemption came", async () => {
    const store = createPairOfferStore();
    let mints = 0;
    const offer = store.offer(async (label) => payloadFor(label, (mints += 1)));
    const first = await store.redeem(offer.code, NONCE, "Phone", { linkKey: KEY_A });
    expect(first).toMatchObject({ ok: true });
    expect(await store.redeem(offer.code, NONCE, "Phone", { linkKey: KEY_A })).toEqual(first);
    // From anywhere else, even with the nonce, the code has paired its device.
    for (const via of [{ linkKey: KEY_B }, { linkKey: null }]) {
      expect(await store.redeem(offer.code, NONCE, "Phone", via)).toEqual({
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
