import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Without it, a build made with the iOS 27 SDK is stopped by UIKit at launch.
const MANIFEST =
  /<key>UIApplicationSceneManifest<\/key>\s*<dict>\s*<key>UIApplicationSupportsMultipleScenes<\/key>\s*<true\/>\s*<\/dict>/;

describe("the iPhone app's scene lifecycle", () => {
  it("is in the plist every iOS build merges in", () => {
    expect(read("src-tauri/Info.ios.plist")).toMatch(MANIFEST);
  });

  it("is in the plist Xcode builds", () => {
    expect(read("src-tauri/gen/apple/gg-app_iOS/Info.plist")).toMatch(MANIFEST);
  });

  it("is in project.yml, which the Xcode project is regenerated from", () => {
    expect(read("src-tauri/gen/apple/project.yml")).toMatch(
      /\n {8}UIApplicationSceneManifest:\n {10}UIApplicationSupportsMultipleScenes: true\n/,
    );
  });
});
