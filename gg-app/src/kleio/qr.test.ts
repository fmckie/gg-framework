import { describe, expect, it } from "vitest";
// The link's ticket vectors, which kleio-host's and the link's own tests read too.
import vectors from "../../../packages/kleio-link/tests/fixtures/tickets.json";
import { NOT_A_TICKET, pairTicket, readTicket, TAILSCALE_TICKET_INCOMPLETE } from "./pairTicket";
import { encodeQr, qrSvgPath, type QrCode } from "./qr";

function encode(text: string): QrCode {
  const r = encodeQr(text);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function darkAt(q: QrCode, x: number, y: number): boolean {
  return q.dark[y * q.size + x] ?? false;
}

/** The 7×7 finder: dark ring, light ring, dark 3×3 core. */
function hasFinder(q: QrCode, left: number, top: number): boolean {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (darkAt(q, left + dx, top + dy) !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe("encodeQr", () => {
  it.each([
    // [bytes, version]: level M byte-mode capacity edges (ISO/IEC 18004 table 7).
    [14, 1],
    [15, 2],
    [84, 5],
    [85, 6],
    [213, 10],
    [214, 11],
    [2331, 40],
  ])("fits %i bytes in version %i", (bytes, version) => {
    const q = encode("x".repeat(bytes));
    expect(q.version).toBe(version);
    expect(q.size).toBe(17 + 4 * version);
    expect(q.dark).toHaveLength(q.size * q.size);
  });

  it("refuses text past version 40", () => {
    expect(encodeQr("x".repeat(2332))).toEqual({
      ok: false,
      error: "Too much text for a QR code.",
    });
  });

  it("counts UTF-8 bytes, not characters", () => {
    // 5 × "é" is 10 bytes; 14 × "é" is 28 bytes, past version 1's 14.
    expect(encode("é".repeat(5)).version).toBe(1);
    expect(encode("é".repeat(14)).version).toBe(3);
  });

  it("draws the finder, timing and dark-module patterns", () => {
    const q = encode("kleio");
    expect(hasFinder(q, 0, 0)).toBe(true);
    expect(hasFinder(q, q.size - 7, 0)).toBe(true);
    expect(hasFinder(q, 0, q.size - 7)).toBe(true);
    for (let i = 8; i < q.size - 8; i++) {
      expect(darkAt(q, i, 6)).toBe(i % 2 === 0);
      expect(darkAt(q, 6, i)).toBe(i % 2 === 0);
    }
    expect(darkAt(q, 8, q.size - 8)).toBe(true);
  });

  it("is deterministic", () => {
    expect(encode("same text")).toEqual(encode("same text"));
  });

  it("draws one unit square per dark module, inside the quiet zone", () => {
    const q = encode("A");
    const path = qrSvgPath(q, 4);
    const squares = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(squares).toHaveLength(q.dark.filter(Boolean).length);
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});

describe("pairTicket", () => {
  it("writes the ticket the iPhone app reads", () => {
    const r = pairTicket("https://mac-mini-1.tail0000.ts.net:8443/", "abc def");
    expect(r.ok && JSON.parse(r.value)).toEqual({
      v: 2,
      type: "kleio-pair",
      baseUrl: "https://mac-mini-1.tail0000.ts.net:8443",
      code: "ABC-DEF",
    });
    // The tickets are short: a version 6 symbol or smaller.
    expect(r.ok && encode(r.value).version).toBeLessThanOrEqual(6);
  });

  it.each([
    ["http", "http://mac-mini-1.tail0000.ts.net:8443"],
    ["not a tailnet", "https://example.com"],
    ["a path", "https://mac-mini-1.tail0000.ts.net/x"],
    ["a query", "https://mac-mini-1.tail0000.ts.net/?a=1"],
    ["credentials", "https://u:p@mac-mini-1.tail0000.ts.net"],
    ["not a URL", "mac mini"],
  ])("refuses an address with %s", (_label, baseUrl) => {
    expect(pairTicket(baseUrl, "ABC-DEF").ok).toBe(false);
  });

  it("refuses a code that isn't six characters", () => {
    expect(pairTicket("https://mini.tail0000.ts.net", "ABC-DE").ok).toBe(false);
  });

  // Step 48: the typed "Connect over your own network" form takes any https
  // host (kleio/commands.rs, typed_base_in), but a QR code stays Tailscale's.
  it.each([
    "https://kleio.example.com:8443",
    "https://mac-mini.home.arpa",
    "https://my-vpn-host:8443",
    "https://mini.tail0000.ts.net.evil.example",
  ])("draws no QR code for %s, which only the typed form takes", (baseUrl) => {
    expect(pairTicket(baseUrl, "ABC-DEF")).toEqual({
      ok: false,
      error: "The iPhone app only pairs with a Tailscale (.ts.net) address.",
    });
    expect(
      readTicket(JSON.stringify({ v: 2, type: "kleio-pair", baseUrl, code: "ABC-DEF" })),
    ).toEqual({
      kind: "invalid",
      error: TAILSCALE_TICKET_INCOMPLETE,
    });
  });
});

describe("readTicket", () => {
  const BASE = "https://mac-mini-1.tail0000.ts.net:8443";
  /** A v2 ticket's JSON, with `over` replacing or adding fields. */
  const v2 = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({ v: 2, type: "kleio-pair", baseUrl: BASE, code: "ABC-DEF", ...over });
  const V3 = JSON.stringify({
    v: 3,
    type: "kleio-pair",
    key: "ab12cd34".padEnd(64, "0"),
    relay: "https://euc1-1.relay.n0.iroh.link./",
    code: "ABC-DEF",
  });
  const [first] = vectors.good;
  if (first === undefined) throw new Error("no ticket vectors");
  const V5 = first.ticket;

  it("reads the v2 ticket pairTicket writes, to fill the pairing form", () => {
    const written = pairTicket(`${BASE}/`, "abc def");
    expect(written.ok && readTicket(written.value)).toEqual({
      kind: "v2",
      baseUrl: BASE,
      code: "ABC-DEF",
    });
  });

  it("sends a v5 ticket, whole and trimmed, to the link's confirm step", () => {
    expect(readTicket(`  ${V5}\n`)).toEqual({ kind: "link", ticket: V5 });
  });

  it("sends a v4 ticket, a host not yet updated's, to the link too", () => {
    for (const vector of vectors.v4) {
      expect(readTicket(vector.ticket), vector.about).toEqual({
        kind: "link",
        ticket: vector.ticket,
      });
    }
  });

  it("sends every ticket kleio-host writes to the link (the shared vectors)", () => {
    for (const vector of vectors.good) {
      expect(readTicket(vector.ticket), vector.about).toEqual({
        kind: "link",
        ticket: vector.ticket,
      });
    }
  });

  it("sends a v3 or a newer ticket to the link too, which says what it is", () => {
    expect(readTicket(V3)).toEqual({ kind: "link", ticket: V3 });
    const v6 = JSON.stringify({ ...JSON.parse(V5), v: 6 });
    expect(readTicket(v6)).toEqual({ kind: "link", ticket: v6 });
  });

  it.each([
    ["nothing", ""],
    ["text that isn't JSON", "kleio://pair?code=ABC-DEF"],
    ["a JSON string", JSON.stringify("kleio-pair")],
    ["a JSON array", JSON.stringify([2, "kleio-pair"])],
    ["another type", v2({ type: "wifi" })],
    ["a link ticket of another type", JSON.stringify({ ...JSON.parse(V5), type: "wifi" })],
    ["a version before v2", v2({ v: 1 })],
    ["a version that isn't whole", v2({ v: 3.5 })],
    ["a version written as text", v2({ v: "3" })],
    [
      "a link ticket over 512 bytes",
      JSON.stringify({ v: 5, type: "kleio-pair", pad: "x".repeat(500) }),
    ],
  ])("refuses %s as no Kleio ticket, so nothing is filled", (_label, text) => {
    expect(readTicket(text)).toEqual({ kind: "invalid", error: NOT_A_TICKET });
  });

  // A v2 ticket the pairing form can't use says it's Tailscale's, as Rust's
  // check does (TicketError::Tailscale).
  it.each([
    ["a link ticket with its version changed to 2", JSON.stringify({ ...JSON.parse(V5), v: 2 })],
    ["an extra field", v2({ token: "secret" })],
    ["a missing code", JSON.stringify({ v: 2, type: "kleio-pair", baseUrl: BASE })],
    ["a code outside the pair alphabet", v2({ code: "ABI-DEF" })],
    ["a code without its dash", v2({ code: "ABCDEF" })],
    ["a lowercase code", v2({ code: "abc-def" })],
    ["a code that isn't text", v2({ code: 123456 })],
    ["an address off the tailnet", v2({ baseUrl: "https://example.com" })],
    ["an http address", v2({ baseUrl: "http://mac-mini-1.tail0000.ts.net:8443" })],
    ["an address with a path", v2({ baseUrl: `${BASE}/kleio` })],
  ])("refuses a v2 ticket with %s as an incomplete one, so nothing is filled", (_label, text) => {
    expect(readTicket(text)).toEqual({ kind: "invalid", error: TAILSCALE_TICKET_INCOMPLETE });
  });
});
