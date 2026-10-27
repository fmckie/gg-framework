import { describe, expect, it } from "vitest";
import {
  DEVICE_CODE_LENGTH,
  formatDeviceCode,
  formatPairCode,
  isPairingPayload,
  isPairRedeemResponse,
} from "../src/pair-code.js";

/** What a host reached over the link only hands a device: no baseUrl. */
const LINK_ONLY = { host: "kleio-ea4a6c63e29c520a", token: "t", label: "Phone", deviceId: "d1" };

describe("isPairingPayload", () => {
  it("takes a payload with an https baseUrl, or with none (a host reached over the link only)", () => {
    expect(isPairingPayload({ ...LINK_ONLY, baseUrl: "https://mini.test.ts.net:8443" })).toBe(true);
    expect(isPairingPayload(LINK_ONLY)).toBe(true);
    expect(isPairRedeemResponse({ ok: true, payload: LINK_ONLY })).toBe(true);
  });

  it("refuses a baseUrl that's empty, not https, or not a string", () => {
    for (const baseUrl of ["", "  ", "http://mini.test.ts.net:8443", 8443, null]) {
      expect(isPairingPayload({ ...LINK_ONLY, baseUrl }), String(baseUrl)).toBe(false);
    }
  });

  it("takes a preview origin that's https, or a host on the same Mac, and nothing after it", () => {
    for (const previewOrigin of ["https://mini.test.ts.net:8444", "http://127.0.0.1:52715"]) {
      expect(isPairingPayload({ ...LINK_ONLY, previewOrigin }), previewOrigin).toBe(true);
    }
    for (const previewOrigin of [
      "",
      "http://mini.test.ts.net:8444",
      "http://localhost:52715",
      "https://mini.test.ts.net:8444/",
      "https://mini.test.ts.net:8444/p",
      "https://user@mini.test.ts.net:8444",
      "HTTPS://Mini.test.ts.net:8444",
      "not a url",
      8444,
      null,
    ]) {
      expect(isPairingPayload({ ...LINK_ONLY, previewOrigin }), String(previewOrigin)).toBe(false);
    }
  });

  it("still needs the host, token, label and device ID", () => {
    for (const field of ["host", "token", "label", "deviceId"]) {
      const rest = Object.fromEntries(Object.entries(LINK_ONLY).filter(([k]) => k !== field));
      expect(isPairingPayload(rest), field).toBe(false);
    }
  });
});

describe("isPairRedeemResponse", () => {
  it("takes each refusal the host gives, the retired codes' reasons among them", () => {
    for (const error of [
      "not_found",
      "unauthorized",
      "bad_request",
      "used",
      "expired",
      "replaced",
      "locked",
    ]) {
      expect(isPairRedeemResponse({ ok: false, error }), error).toBe(true);
    }
    expect(isPairRedeemResponse({ ok: false, error: "revoked" })).toBe(false);
    expect(isPairRedeemResponse({ ok: false })).toBe(false);
  });
});

describe("waiting for an admin's Allow", () => {
  it("takes the refusals a waiting device can get, and pending only with when to ask again", () => {
    for (const error of ["claimed", "update_required", "denied"]) {
      expect(isPairRedeemResponse({ ok: false, error }), error).toBe(true);
    }
    expect(
      isPairRedeemResponse({ ok: false, error: "pending", retryAfterMs: 3000, expiresAt: 1 }),
    ).toBe(true);
    for (const wrong of [
      { ok: false, error: "pending" },
      { ok: false, error: "pending", retryAfterMs: "3000", expiresAt: 1 },
      { ok: false, error: "pending", retryAfterMs: 3000 },
    ]) {
      expect(isPairRedeemResponse(wrong), JSON.stringify(wrong)).toBe(false);
    }
  });

  it("shows a device code as its key's first six hex characters, in a style of its own", () => {
    expect(formatDeviceCode(`3f9ac2${"0".repeat(58)}`)).toBe("3F9 AC2");
    expect(formatDeviceCode("a".repeat(64))).toBe("AAA AAA");
    expect(formatDeviceCode("3f9ac2").length).toBe(DEVICE_CODE_LENGTH + 1);
    // Not a pair code's style, which has a dash.
    expect(formatDeviceCode("3f9ac2")).not.toBe(formatPairCode("3F9AC2"));
  });
});
