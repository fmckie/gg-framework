import React from "react";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { BossBanner } from "./banner.js";
import { BRAND, LOGO_LINES } from "./branding.js";
import { SplashScreen } from "./splash.js";

const LEGACY_MANAGER_DISPLAY_NAME = ["GG", "Boss"].join(" ");

describe("Kleio Manager visual identity", () => {
  it("renders the branded compact banner", () => {
    const output = renderToString(<BossBanner subtitle="Orchestrator" showShortcuts />);
    expect(BRAND).toBe("Kleio Manager");
    expect(output).toContain("Kleio Manager");
    expect(output).not.toContain(LEGACY_MANAGER_DISPLAY_NAME);
    expect(output).not.toContain("Ken Kai");
    expect(output).not.toContain("· By");
    expect(LOGO_LINES.join("\n")).not.toContain("▄▀▀▀ ▄▀▀▀");
  });

  it("renders the branded splash and caption", () => {
    const output = renderToString(<SplashScreen caption="Starting workers…" />);
    expect(output).toContain("Kleio Manager");
    expect(output).toContain("Starting workers…");
    expect(output).not.toContain(LEGACY_MANAGER_DISPLAY_NAME);
    expect(output).not.toContain("Ken Kai");
    expect(output).not.toContain("· By");
  });
});
