import { describe, expect, it } from "vitest";
import { explainError, isNewDevice, NEW_DEVICE_MS, type Device } from "./useKleioRemote";

const NOW = Date.parse("2026-10-23T12:00:00Z");

function device(over: Partial<Device> = {}): Device {
  return {
    deviceId: "d1",
    label: "Sam's iPhone",
    created: "2026-10-23T10:00:00Z",
    lastSeen: null,
    revoked: false,
    admin: false,
    ...over,
  };
}

const pairedAgo = (ms: number): string => new Date(NOW - ms).toISOString();

describe("isNewDevice", () => {
  it("is a device paired in the last week", () => {
    expect(isNewDevice(device(), null, NOW)).toBe(true);
    expect(isNewDevice(device({ created: pairedAgo(NEW_DEVICE_MS - 1000) }), null, NOW)).toBe(true);
    expect(isNewDevice(device({ created: pairedAgo(NEW_DEVICE_MS) }), null, NOW)).toBe(false);
    expect(isNewDevice(device({ created: pairedAgo(30 * 24 * 60 * 60_000) }), null, NOW)).toBe(
      false,
    );
  });

  it("takes a pairing time ahead of this clock as new: the host's clock can run ahead", () => {
    expect(isNewDevice(device({ created: "2026-10-23T12:05:00Z" }), null, NOW)).toBe(true);
  });

  it("is never this device, a revoked one, or one whose pairing time can't be read", () => {
    expect(isNewDevice(device(), "d1", NOW)).toBe(false);
    expect(isNewDevice(device(), "d2", NOW)).toBe(true);
    expect(isNewDevice(device({ revoked: true }), null, NOW)).toBe(false);
    expect(isNewDevice(device({ created: "" }), null, NOW)).toBe(false);
  });
});

describe("explainError", () => {
  it("says an admin command's message, not [object Object]", () => {
    // Rust's AdminError, as Tauri delivers it.
    expect(
      explainError({ kind: "denied", message: "Touch ID was cancelled or didn't match." }),
    ).toBe("Touch ID was cancelled or didn't match.");
    expect(
      explainError({ kind: "forbidden", message: "This device isn't an admin on the host." }),
    ).toBe("This device isn't an admin on the host.");
  });

  it("says a command's error string, and an Error's message, as before", () => {
    expect(explainError("Host refused the code (expired).")).toBe(
      "Host refused the code (expired).",
    );
    expect(explainError(new Error("connection refused"))).toBe("connection refused");
    expect(explainError("biometric denied:denied")).toBe("Touch ID was cancelled or didn't match.");
  });
});
