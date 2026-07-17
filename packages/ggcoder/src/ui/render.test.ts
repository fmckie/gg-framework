import { describe, expect, it } from "vitest";
import { getResetClearMode, isFullscreenViewportRequested } from "./render.js";

describe("getResetClearMode", () => {
  it("uses a full screen redraw for terminal resize remounts", () => {
    expect(getResetClearMode({ resizeRedraw: true })).toBe("screen");
  });

  it("keeps ordinary overlay remounts to a viewport clear", () => {
    expect(getResetClearMode(undefined)).toBe("viewport");
    expect(getResetClearMode({})).toBe("viewport");
  });

  it("uses a full screen redraw for explicit session/history replacement", () => {
    expect(getResetClearMode({ wipeSession: true })).toBe("screen");
    expect(getResetClearMode({ history: [{ kind: "banner", id: "banner" }] })).toBe("screen");
  });
});

describe("isFullscreenViewportRequested", () => {
  it("prefers the Kleio flag over the legacy alias", () => {
    expect(isFullscreenViewportRequested({ KLEIO_CODER_FULLSCREEN: "0", GG_FULLSCREEN: "1" })).toBe(
      false,
    );
    expect(isFullscreenViewportRequested({ KLEIO_CODER_FULLSCREEN: "1", GG_FULLSCREEN: "0" })).toBe(
      true,
    );
  });

  it("supports the legacy flag and treats an empty preferred value as authoritative", () => {
    expect(isFullscreenViewportRequested({ GG_FULLSCREEN: "1" })).toBe(true);
    expect(isFullscreenViewportRequested({ KLEIO_CODER_FULLSCREEN: "", GG_FULLSCREEN: "1" })).toBe(
      false,
    );
  });
});
