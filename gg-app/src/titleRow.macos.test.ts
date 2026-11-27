import { describe, expect, it } from "vitest";
import windowsRs from "../src-tauri/src/windows.rs?raw";
import appCss from "./App.css?raw";
import phoneCss from "./kleio/kleio-phone.css?raw";

describe("the 48px title row", () => {
  it("is 48px on macOS, with the gutter that clears the traffic lights", () => {
    expect(appCss).toContain(
      ".platform-macos .chat-head-strip {\n  height: 48px;\n  padding: 0 var(--rail) 0 82px;\n}",
    );
  });

  it("puts the lights' 16px frame in a 48px title bar, so they centre on the row", () => {
    const [, x, y] =
      /MAC_TRAFFIC_LIGHTS: tauri::LogicalPosition<f64> =\s+tauri::LogicalPosition::new\(([\d.]+), ([\d.]+)\);/.exec(
        windowsRs,
      ) ?? [];
    expect(Number(y) + 16).toBe(48);
    expect(Number(x)).toBe(16);
  });

  it("moves the lights on macOS only: one call, inside the macOS-only builder step", () => {
    expect(windowsRs.match(/traffic_light_position/g)).toHaveLength(1);
    const macOnly =
      /#\[cfg\(target_os = "macos"\)\]\npub\(crate\) fn apply_mac_overlay[^}]+\}/.exec(
        windowsRs,
      )?.[0];
    expect(macOnly).toContain(".traffic_light_position(MAC_TRAFFIC_LIGHTS)");
  });

  it("leaves Windows and Linux at 38px with no gutter", () => {
    expect(appCss).toMatch(
      /\n\.chat-head-strip \{\n {2}display: flex;\n {2}align-items: center;\n {2}gap: 12px;\n[^}]*\n {2}height: 38px;\n[^}]*\n {2}padding: 0 var\(--rail\);\n\}/,
    );
  });

  it("keeps the 48px and the lights' gutter off the iPhone, whose strip is as tall as its wrapped lines", () => {
    expect(phoneCss).toContain(
      "html.platform-ios .app.app-session .chat-head-strip {\n  flex-wrap: wrap;\n  height: auto;\n  gap: 0 12px;\n  padding: 2px 16px;\n}",
    );
  });
});
