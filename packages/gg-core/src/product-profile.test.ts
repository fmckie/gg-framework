import { describe, expect, it } from "vitest";
import {
  KLEIO_CODER_ERROR_DISPLAY,
  KLEIO_MANAGER_ERROR_DISPLAY,
  KLEIO_PRODUCT_PROFILE,
  resolveEnvironmentAlias,
} from "./product-profile.js";

describe("KLEIO_PRODUCT_PROFILE", () => {
  it("keeps preferred display identities separate from compatibility identifiers", () => {
    expect(KLEIO_PRODUCT_PROFILE.coder).toMatchObject({
      displayName: "Kleio Coder",
      preferredCommand: "kleio-coder",
      legacyCommand: "ggcoder",
      mcpClientName: "kleio-coder",
      legacyMcpClientName: "ggcoder",
      agentHomeId: "ggcoder",
    });
    expect(KLEIO_PRODUCT_PROFILE.manager).toMatchObject({
      displayName: "Kleio Manager",
      preferredCommand: "kleio-manager",
      legacyCommand: "ggboss",
    });
  });

  it("provides Coder and Manager error profiles with the preferred login command", () => {
    expect(KLEIO_CODER_ERROR_DISPLAY).toEqual({
      productName: "Kleio Coder",
      loginCommand: "kleio-coder login",
      bugReportUrl: "https://github.com/fmckie/gg-framework/issues",
    });
    expect(KLEIO_MANAGER_ERROR_DISPLAY).toEqual({
      productName: "Kleio Manager",
      loginCommand: "kleio-coder login",
      bugReportUrl: "https://github.com/fmckie/gg-framework/issues",
    });
  });
});

describe("resolveEnvironmentAlias", () => {
  it("prefers the branded variable when both values are present", () => {
    expect(
      resolveEnvironmentAlias(
        { KLEIO_TOKEN: "preferred", GG_TOKEN: "legacy" },
        "KLEIO_TOKEN",
        "GG_TOKEN",
      ),
    ).toBe("preferred");
  });

  it("falls back to legacy aliases in declaration order", () => {
    expect(
      resolveEnvironmentAlias({ OLD_TOKEN: "old", OLDEST_TOKEN: "oldest" }, "KLEIO_TOKEN", [
        "OLD_TOKEN",
        "OLDEST_TOKEN",
      ]),
    ).toBe("old");
  });

  it("treats an explicitly empty preferred value as authoritative", () => {
    expect(
      resolveEnvironmentAlias({ KLEIO_TOKEN: "", GG_TOKEN: "legacy" }, "KLEIO_TOKEN", "GG_TOKEN"),
    ).toBe("");
  });

  it("returns undefined when no alias is configured", () => {
    expect(resolveEnvironmentAlias({}, "KLEIO_TOKEN", "GG_TOKEN")).toBeUndefined();
  });
});
