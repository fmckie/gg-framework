import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const pkg = JSON.parse(read("package.json")).version;
const conf = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const ios = JSON.parse(read("src-tauri/tauri.ios.conf.json"));
const cargo = read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1];
const lock = read("src-tauri/Cargo.lock").match(/name = "gg-app"\nversion = "([^"]+)"/)?.[1];
const yml = read("src-tauri/gen/apple/project.yml");
const ymlValues = (key) =>
  [...yml.matchAll(new RegExp(`^\\s+${key}: "?([^"\\s]+)"?$`, "gm"))].map((m) => m[1]);
const plist = (target, key) =>
  read(`src-tauri/gen/apple/${target}/Info.plist`).match(
    new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`),
  )?.[1];

// The home screen shows the app's version on the Mac and the iPhone alike;
// scripts/bump-version.mjs moves every one of these together.
describe("app version", () => {
  it("is the same everywhere the Mac and iPhone builds read it", () => {
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
    expect({
      conf,
      cargo,
      lock,
      iosConf: ios.version,
      yml: ymlValues("CFBundleShortVersionString"),
      appPlist: plist("gg-app_iOS", "CFBundleShortVersionString"),
      widgetPlist: plist("KleioWidgets", "CFBundleShortVersionString"),
    }).toEqual({
      conf: pkg,
      cargo: pkg,
      lock: pkg,
      iosConf: pkg,
      yml: [pkg, pkg],
      appPlist: pkg,
      widgetPlist: pkg,
    });
  });

  it("gives the iPhone app and its widget one build number", () => {
    const build = ios.bundle.iOS.bundleVersion;
    expect(build).toMatch(/^\d+$/);
    expect({
      yml: ymlValues("CFBundleVersion"),
      appPlist: plist("gg-app_iOS", "CFBundleVersion"),
      widgetPlist: plist("KleioWidgets", "CFBundleVersion"),
    }).toEqual({ yml: [build, build], appPlist: build, widgetPlist: build });
  });
});
