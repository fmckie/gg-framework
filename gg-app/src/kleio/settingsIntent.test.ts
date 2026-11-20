import { describe, expect, it } from "vitest";
import { INTENT_KEPT_MS, leaveSettingsIntent, takeSettingsIntent } from "./settingsIntent";

describe("settingsIntent", () => {
  it("is read once, then gone", () => {
    leaveSettingsIntent("connection-fix");
    expect(takeSettingsIntent()).toBe("connection-fix");
    expect(takeSettingsIntent()).toBeNull();
  });

  it("reads the notes for Apps and for Tools once each", () => {
    for (const note of ["apps-fix", "tools-fix"] as const) {
      leaveSettingsIntent(note);
      expect(takeSettingsIntent()).toBe(note);
      expect(takeSettingsIntent()).toBeNull();
    }
  });

  it("has nothing to read when none was left", () => {
    expect(takeSettingsIntent()).toBeNull();
  });

  it("keeps only the latest note", () => {
    leaveSettingsIntent("connection-fix");
    leaveSettingsIntent("connection-always-on");
    expect(takeSettingsIntent()).toBe("connection-always-on");
    expect(takeSettingsIntent()).toBeNull();
  });

  it("drops a note nothing read in time, so a later visit finds none", () => {
    leaveSettingsIntent("connection-fix", 1_000);
    expect(takeSettingsIntent(1_000 + INTENT_KEPT_MS + 1)).toBeNull();
    leaveSettingsIntent("connection-fix", 1_000);
    expect(takeSettingsIntent(1_000 + INTENT_KEPT_MS)).toBe("connection-fix");
  });
});
