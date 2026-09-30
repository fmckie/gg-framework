import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Fork guard: this build carries Kleio remote-host code, so it must never
// auto-update from upstream's releases (an upstream build would silently drop
// it). Fork releases would also need their own updater signing key.
describe("updater endpoint", () => {
  it("points at the fork's releases, never upstream's", () => {
    const conf = JSON.parse(
      readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    );
    expect(conf.plugins.updater.endpoints).toEqual([
      "https://github.com/fmckie/gg-framework/releases/latest/download/latest.json",
    ]);
  });
});
