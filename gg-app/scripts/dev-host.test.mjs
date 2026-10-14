// Unit tests for dev-host.mjs: the sandbox guard (kleio-sandbox.mjs) that keeps
// the host and sidecar away from the real ~/.gg, ~/.kleio and host state folder,
// the fingerprint behind its before-and-after check, and the line it prints to
// start the desktop app. The "real home" here is always a temp folder handed to
// the guard; nothing looks at, or writes to, the real one.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { launchLine } from "./dev-host.mjs";
import { fingerprint, fingerprintChanges, sandboxEnv, sandboxProblems } from "./kleio-sandbox.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const STATE = join("Library", "Application Support", "Kleio", "host");

/** A stand-in for the real home, with the three folders the guard protects. */
function fakeRealHome() {
  const home = temp("kleio-real-home-");
  for (const dir of [".gg", ".kleio", STATE]) mkdirSync(join(home, dir), { recursive: true });
  return home;
}

function envFor(sandbox, baseEnv = { PATH: "/usr/bin:/bin" }) {
  return sandboxEnv({
    sandbox,
    baseEnv,
    apiPort: 41000,
    previewPort: 41001,
    sidecarPath: "/repo/gg-app/src-tauri/sidecar/app-sidecar.mjs",
    nodeBin: "/repo/gg-app/src-tauri/binaries/ggnode",
  });
}

/** The guard's verdict on `sandbox`, with `change` applied to its env. */
function problemsFor(sandbox, realHome, change = {}) {
  return sandboxProblems({ sandbox, env: { ...envFor(sandbox), ...change }, realHome });
}

/** A directory symlink (a junction on Windows, which needs no admin rights). */
function link(target, at) {
  symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
}

describe("the sandbox guard", () => {
  it("lets a fresh temp sandbox run", () => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");

    expect(problemsFor(sandbox, realHome)).toEqual([]);
  });

  it("refuses the real home as the sandbox, and as HOME", () => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");

    expect(problemsFor(realHome, realHome)).toContain(`the sandbox ${realHome} is the real home`);
    expect(problemsFor(sandbox, realHome, { HOME: realHome })).toContain(
      `HOME=${realHome} is the real home`,
    );
  });

  it.each([
    [".gg", "~/.gg"],
    [".kleio", "~/.kleio"],
    [STATE, "host state folder"],
  ])("refuses the real %s, a folder inside it, and a folder containing it", (dir, name) => {
    const realHome = fakeRealHome();
    const real = join(realHome, dir);

    expect(problemsFor(real, realHome)).toContain(`the sandbox ${real} is the real ${name}`);
    expect(problemsFor(join(real, "dev"), realHome)).toContain(
      `the sandbox ${join(real, "dev")} is inside the real ${name}`,
    );
    const sandbox = temp("kleio-dev-host-");
    expect(problemsFor(sandbox, realHome, { KLEIO_HOST_HOME: real })).toContain(
      `KLEIO_HOST_HOME=${real} is the real ${name}`,
    );
  });

  it("refuses a sandbox that contains the real home", () => {
    const realHome = fakeRealHome();
    const parent = join(realHome, "..");

    expect(problemsFor(parent, realHome).some((p) => p.includes("contains the real"))).toBe(true);
  });

  it("refuses the real folders through a symlink, even one to a folder not made yet", () => {
    const realHome = fakeRealHome();
    const elsewhere = temp("kleio-links-");
    link(join(realHome, ".gg"), join(elsewhere, "gg"));
    link(join(realHome, STATE), join(elsewhere, "state"));
    const sandbox = temp("kleio-dev-host-");

    expect(problemsFor(join(elsewhere, "gg", "dev"), realHome)).toContain(
      `the sandbox ${join(elsewhere, "gg", "dev")} is inside the real ~/.gg`,
    );
    expect(problemsFor(sandbox, realHome, { KLEIO_HOST_HOME: join(elsewhere, "state") })).toContain(
      `KLEIO_HOST_HOME=${join(elsewhere, "state")} is the real host state folder`,
    );
  });

  it("refuses the real folders spelt in another case", () => {
    const realHome = fakeRealHome();
    const upperGg = join(realHome, ".GG");
    const upperHome = realHome.toUpperCase();

    expect(problemsFor(upperGg, realHome)).toContain(`the sandbox ${upperGg} is the real ~/.gg`);
    expect(problemsFor(upperHome, realHome)).toContain(`the sandbox ${upperHome} is the real home`);
  });

  it("refuses a real folder that doesn't exist yet, spelt in another case", () => {
    // No state folder here, so realpath can't correct the case: only the
    // case-insensitive comparison catches it.
    const realHome = temp("kleio-real-home-");
    const spelt = join(realHome, "library", "application support", "KLEIO", "Host");
    const sandbox = temp("kleio-dev-host-");

    expect(problemsFor(sandbox, realHome, { KLEIO_HOST_HOME: spelt })).toContain(
      `KLEIO_HOST_HOME=${spelt} is the real host state folder`,
    );
  });

  it("refuses a ~/.gg that is a symlink out of the home, and the folder it points at", () => {
    const realHome = temp("kleio-real-home-");
    const outside = temp("kleio-gg-elsewhere-");
    link(outside, join(realHome, ".gg"));

    expect(problemsFor(join(outside, "dev"), realHome)).toContain(
      `the sandbox ${join(outside, "dev")} is inside the real ~/.gg`,
    );
  });

  it.each([
    "https://mac-mini-1.example.ts.net:8443",
    "http://0.0.0.0:41000",
    "http://localhost:41000",
    "http://127.0.0.1:41001",
    "http://127.0.0.1.example.com:41000",
    undefined,
  ])("refuses the public URL %s", (url) => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");

    expect(problemsFor(sandbox, realHome, { KLEIO_PUBLIC_URL: url })).toContain(
      `KLEIO_PUBLIC_URL=${url} is not http://127.0.0.1:41000`,
    );
  });

  it("refuses paths outside the sandbox, relative paths and paths with ..", () => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");
    const other = temp("kleio-other-");

    expect(problemsFor(sandbox, realHome, { KLEIO_PROJECTS_DIR: other })).toContain(
      `KLEIO_PROJECTS_DIR=${other} is not inside the sandbox ${sandbox}`,
    );
    expect(problemsFor(sandbox, realHome, { KLEIO_HOME_CWD: "Kleio" })).toContain(
      "KLEIO_HOME_CWD=Kleio is not a plain absolute path",
    );
    const escaping = `${sandbox}/home/../../x`;
    expect(problemsFor(sandbox, realHome, { KLEIO_SIDECAR_CWD: escaping })).toContain(
      `KLEIO_SIDECAR_CWD=${escaping} is not a plain absolute path`,
    );
    expect(problemsFor(sandbox, realHome, { USERPROFILE: undefined })).toContain(
      "USERPROFILE is not set",
    );
  });

  it("keeps the shell's own Kleio and GG settings, NODE_OPTIONS and home out", () => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");
    const env = envFor(sandbox, {
      PATH: "/usr/bin:/bin",
      HOME: realHome,
      KLEIO_COMPOSIO_API_KEY: "a-real-key",
      KLEIO_PREVIEW_URL: "https://mac-mini-1.example.ts.net:8444",
      GG_APP_SETTINGS_FILE: join(realHome, ".gg", "gg-app.json"),
      GG_DIAGNOSTICS_DIR: join(realHome, ".gg", "diagnostics"),
      NODE_OPTIONS: "--import=/somewhere/preload.mjs",
    });

    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe(join(sandbox, "home"));
    for (const key of [
      "KLEIO_COMPOSIO_API_KEY",
      "KLEIO_PREVIEW_URL",
      "GG_APP_SETTINGS_FILE",
      "GG_DIAGNOSTICS_DIR",
      "NODE_OPTIONS",
    ]) {
      expect(env).not.toHaveProperty(key);
    }
    expect(sandboxProblems({ sandbox, env, realHome })).toEqual([]);
    expect(
      problemsFor(sandbox, realHome, { KLEIO_COMPOSIO_API_KEY: "a-real-key", NODE_OPTIONS: "x" }),
    ).toEqual([
      "KLEIO_COMPOSIO_API_KEY comes from outside the sandbox",
      "NODE_OPTIONS comes from outside the sandbox",
    ]);
  });
});

describe("the before-and-after fingerprint", () => {
  it("names what was added, removed and changed, and nothing else", () => {
    const dir = temp("kleio-fingerprint-");
    writeFileSync(join(dir, "remote.json"), "{}");
    writeFileSync(join(dir, "gone.json"), "{}");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "same.txt"), "same");
    const before = fingerprint(dir);

    expect(fingerprintChanges(before, fingerprint(dir))).toEqual([]);

    writeFileSync(join(dir, "remote.json"), '{"baseUrl":"https://elsewhere"}');
    rmSync(join(dir, "gone.json"));
    writeFileSync(join(dir, "sub", "new.txt"), "new");
    const changes = fingerprintChanges(before, fingerprint(dir)).filter(
      (c) => c.path !== "." && c.path !== "sub",
    );

    expect(changes).toEqual([
      { path: "gone.json", change: "removed" },
      { path: "remote.json", change: "changed" },
      { path: join("sub", "new.txt"), change: "added" },
    ]);
  });

  it("notices a folder that appears", () => {
    const parent = temp("kleio-fingerprint-");
    const dir = join(parent, "host");
    const before = fingerprint(dir);
    mkdirSync(dir);

    expect(before).toEqual(new Map([[".", "absent"]]));
    expect(fingerprintChanges(before, fingerprint(dir))).toEqual([
      { path: ".", change: "changed" },
    ]);
  });
});

describe("the app's launch line", () => {
  const token = "A".repeat(20) + "b-_9".repeat(6);

  it("is the env override, a loopback URL and the device's token", () => {
    expect(launchLine({ url: "http://127.0.0.1:41000", token })).toBe(
      `KLEIO_HOST_URL=http://127.0.0.1:41000 KLEIO_DEVICE_TOKEN=${token} pnpm --filter gg-app tauri dev`,
    );
    expect(launchLine({ url: "http://127.0.0.1:41000", token, shell: "powershell" })).toBe(
      `$env:KLEIO_HOST_URL="http://127.0.0.1:41000"; $env:KLEIO_DEVICE_TOKEN="${token}"; pnpm --filter gg-app tauri dev`,
    );
  });

  it.each([
    "https://mac-mini-1.example.ts.net:8443",
    "http://localhost:41000",
    "http://0.0.0.0:41000",
    "http://127.0.0.1.example.com:41000",
    "http://127.0.0.1:41000/",
    "http://127.0.0.1:41000 && rm -rf ~",
  ])("refuses the URL %s", (url) => {
    expect(() => launchLine({ url, token })).toThrow(/not a loopback host URL/);
  });

  it.each([
    "A".repeat(31),
    `${"A".repeat(32)} rm`,
    `${"A".repeat(32)}$(id)`,
    `${"A".repeat(32)}"`,
    "",
  ])("refuses the token %j", (bad) => {
    expect(() => launchLine({ url: "http://127.0.0.1:41000", token: bad })).toThrow(
      /32 or more URL-safe characters/,
    );
  });
});
