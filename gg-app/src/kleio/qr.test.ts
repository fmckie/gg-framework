import { describe, expect, it } from "vitest";
import { NOT_A_TICKET, pairTicket, readTicket } from "./pairTicket";
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

  it("reads the v2 ticket pairTicket writes, to fill the pairing form", () => {
    const written = pairTicket(`${BASE}/`, "abc def");
    expect(written.ok && readTicket(written.value)).toEqual({
      kind: "v2",
      baseUrl: BASE,
      code: "ABC-DEF",
    });
  });

  it("sends a v3 ticket, whole and trimmed, to the link's confirm step", () => {
    expect(readTicket(`  ${V3}\n`)).toEqual({ kind: "v3", ticket: V3 });
  });

  it.each([
    ["nothing", ""],
    ["text that isn't JSON", "kleio://pair?code=ABC-DEF"],
    ["a JSON string", JSON.stringify("kleio-pair")],
    ["a JSON array", JSON.stringify([2, "kleio-pair"])],
    ["another type", v2({ type: "wifi" })],
    ["another version", v2({ v: 4 })],
    ["a version written as text", v2({ v: "3" })],
    ["an extra field", v2({ token: "secret" })],
    ["a missing code", JSON.stringify({ v: 2, type: "kleio-pair", baseUrl: BASE })],
    ["a code outside the pair alphabet", v2({ code: "ABI-DEF" })],
    ["a code without its dash", v2({ code: "ABCDEF" })],
    ["a lowercase code", v2({ code: "abc-def" })],
    ["an address off the tailnet", v2({ baseUrl: "https://example.com" })],
    ["an http address", v2({ baseUrl: "http://mac-mini-1.tail0000.ts.net:8443" })],
    ["an address with a path", v2({ baseUrl: `${BASE}/kleio` })],
    ["a v3 ticket over 1 KiB", JSON.stringify({ v: 3, type: "kleio-pair", pad: "x".repeat(1100) })],
  ])("refuses %s, so nothing is filled", (_label, text) => {
    expect(readTicket(text)).toEqual({ kind: "invalid", error: NOT_A_TICKET });
  });
});
