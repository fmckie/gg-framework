// Unit tests for dev-host.mjs: the sandbox guard (kleio-sandbox.mjs) that keeps
// the host and sidecar away from the real ~/.gg, ~/.kleio and host state folder,
// the fingerprint behind its before-and-after check, and the line it prints to
// start the desktop app. Then --app's pure parts: its options and checks, the
// app's environment and its guard, the guard on the sandbox keychain's path,
// how it finds the app's processes, and the Keychain items it watches. The
// "real home" here is always a temp folder handed to the guard; nothing looks
// at, or writes to, the real one, and nothing here runs `security`.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appModeProblems,
  KEYCHAIN_SERVICE,
  launchLine,
  LOOPBACK_ACCOUNTS,
  parseArgs,
  psLineHasHome,
} from "./dev-host.mjs";
import {
  appEnv,
  appEnvProblems,
  fingerprint,
  fingerprintChanges,
  keychainPathProblems,
  sandboxEnv,
  sandboxProblems,
} from "./kleio-sandbox.mjs";

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

describe("the options", () => {
  it("takes --app, alone or with --keep", () => {
    expect(parseArgs(["--app"])).toEqual({
      options: { dir: null, keep: false, app: true, help: false },
    });
    expect(parseArgs(["--app", "--keep"]).options).toMatchObject({ app: true, keep: true });
    expect(parseArgs(["--dir", "/tmp/kleio"]).options).toMatchObject({
      app: false,
      dir: "/tmp/kleio",
    });
  });

  it.each([[["--app", "--dir", "/tmp/kleio"]], [["--dir=/tmp/kleio", "--app"]]])(
    "refuses --app with --dir: %j",
    (argv) => {
      expect(parseArgs(argv)).toEqual({
        error: "--app needs a fresh sandbox: use it without --dir",
      });
    },
  );
});

describe("--app's own checks", () => {
  it("pass on macOS, with cargo and pnpm, and a sandbox path without whitespace", () => {
    expect(
      appModeProblems({
        platform: "darwin",
        sandbox: "/private/var/folders/x/T/kleio-dev-host-abc",
        tools: { cargo: true, pnpm: true },
      }),
    ).toEqual([]);
  });

  it("refuse other platforms, missing tools and a sandbox path with whitespace", () => {
    expect(
      appModeProblems({
        platform: "linux",
        sandbox: "/tmp/my sandbox",
        tools: { pnpm: false, cargo: false },
      }),
    ).toEqual([
      "--app runs on macOS only: the app keeps its pairing in the macOS Keychain",
      "--app needs cargo on PATH",
      "--app needs pnpm on PATH",
      "the sandbox /tmp/my sandbox has whitespace in its path: --app finds the app's processes by their HOME",
    ]);
  });
});

describe("the desktop app's environment", () => {
  it("is this shell's without its Kleio, GG and preload settings, with every home in the sandbox", () => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");
    const env = appEnv({
      sandbox,
      baseEnv: {
        PATH: "/usr/bin:/bin",
        LANG: "en_GB.UTF-8",
        HOME: realHome,
        USERPROFILE: realHome,
        CFFIXED_USER_HOME: realHome,
        KLEIO_HOST_URL: "http://127.0.0.1:41000",
        KLEIO_DEVICE_TOKEN: "a-device-token",
        KLEIO_CONTROL_CREDENTIAL: "a-control-credential",
        GG_APP_SETTINGS_FILE: join(realHome, ".gg", "gg-app.json"),
        NODE_OPTIONS: "--import=/somewhere/preload.mjs",
      },
    });
    const home = join(sandbox, "home");

    expect(env).toEqual({
      PATH: "/usr/bin:/bin",
      LANG: "en_GB.UTF-8",
      HOME: home,
      USERPROFILE: home,
      CFFIXED_USER_HOME: home,
    });
    expect(appEnvProblems({ sandbox, env, realHome })).toEqual([]);
  });

  it("refuses the real home, the real ~/.kleio, a home outside the sandbox and a relative one", () => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");
    const other = temp("kleio-other-");
    const env = appEnv({ sandbox, baseEnv: { PATH: "/usr/bin:/bin" } });
    const problems = (change) => appEnvProblems({ sandbox, env: { ...env, ...change }, realHome });
    const kleio = join(realHome, ".kleio");

    expect(problems({ HOME: realHome })).toContain(`HOME=${realHome} is the real home`);
    expect(problems({ CFFIXED_USER_HOME: kleio })).toContain(
      `CFFIXED_USER_HOME=${kleio} is the real ~/.kleio`,
    );
    expect(problems({ USERPROFILE: other })).toContain(
      `USERPROFILE=${other} is not inside the sandbox ${sandbox}`,
    );
    expect(problems({ HOME: "home" })).toContain("HOME=home is not a plain absolute path");
    expect(problems({ CFFIXED_USER_HOME: undefined })).toContain("CFFIXED_USER_HOME is not set");
    expect(appEnvProblems({ sandbox: realHome, env, realHome })).toContain(
      `the sandbox ${realHome} is the real home`,
    );
  });

  it("refuses any Kleio setting, even one the host runs with, and GG and preload settings", () => {
    const realHome = fakeRealHome();
    const sandbox = temp("kleio-dev-host-");
    const env = appEnv({ sandbox, baseEnv: { PATH: "/usr/bin:/bin" } });

    expect(
      appEnvProblems({
        sandbox,
        env: {
          ...env,
          KLEIO_DEVICE_TOKEN: "left-over",
          KLEIO_HOST_PORT: "41000",
          GG_DIAGNOSTICS_DIR: "/somewhere",
          NODE_OPTIONS: "--import=/somewhere/preload.mjs",
        },
        realHome,
      }),
    ).toEqual([
      "GG_DIAGNOSTICS_DIR comes from outside the sandbox",
      "KLEIO_DEVICE_TOKEN comes from outside the sandbox",
      "KLEIO_HOST_PORT comes from outside the sandbox",
      "NODE_OPTIONS comes from outside the sandbox",
    ]);
  });
});

describe("the sandbox keychain's path", () => {
  const KEYCHAIN = join("Library", "Keychains", "kleio-dev-host.keychain-db");

  /** A sandbox home as dev-host makes it: under its real path, with a Keychains folder. */
  function sandboxHome() {
    const home = join(realpathSync.native(temp("kleio-dev-host-")), "home");
    mkdirSync(join(home, "Library", "Keychains"), { recursive: true });
    return home;
  }

  it("lets the keychain in the sandbox home through, before and after it exists", () => {
    const realHome = fakeRealHome();
    const home = sandboxHome();
    const path = join(home, KEYCHAIN);

    expect(keychainPathProblems({ path, sandboxHome: home, realHome })).toEqual([]);
    writeFileSync(path, "");
    expect(keychainPathProblems({ path, sandboxHome: home, realHome })).toEqual([]);
  });

  it("refuses the real login keychain, a path outside the sandbox home and the home itself", () => {
    const realHome = fakeRealHome();
    const home = sandboxHome();
    const login = join(realpathSync.native(realHome), "Library", "Keychains", "login.keychain-db");
    const other = join(realpathSync.native(temp("kleio-other-")), "other.keychain-db");

    expect(keychainPathProblems({ path: login, sandboxHome: home, realHome })).toEqual([
      `the keychain ${login} is inside the real home`,
      `the keychain ${login} is not inside the sandbox home ${home}`,
    ]);
    expect(keychainPathProblems({ path: other, sandboxHome: home, realHome })).toEqual([
      `the keychain ${other} is not inside the sandbox home ${home}`,
    ]);
    expect(keychainPathProblems({ path: home, sandboxHome: home, realHome })).toEqual([
      `the keychain ${home} is not inside the sandbox home ${home}`,
    ]);
  });

  it("refuses a relative path and one with ..", () => {
    const realHome = fakeRealHome();
    const home = sandboxHome();

    for (const path of ["kleio-dev-host.keychain-db", `${home}/../other.keychain-db`]) {
      expect(keychainPathProblems({ path, sandboxHome: home, realHome })).toEqual([
        `the keychain ${path} is not a plain absolute path`,
      ]);
    }
  });

  it("refuses a path through a link into the real home", () => {
    const realHome = fakeRealHome();
    const home = join(realpathSync.native(temp("kleio-dev-host-")), "home");
    mkdirSync(join(home, "Library"), { recursive: true });
    mkdirSync(join(realHome, "Library", "Keychains"), { recursive: true });
    link(join(realHome, "Library", "Keychains"), join(home, "Library", "Keychains"));
    const path = join(home, KEYCHAIN);
    const problems = keychainPathProblems({ path, sandboxHome: home, realHome });

    expect(problems.some((p) => p.startsWith(`the keychain ${path} is not its real path `))).toBe(
      true,
    );
    expect(problems).toContain(`the keychain ${path} is inside the real home`);
    expect(problems).toContain(`the keychain ${path} is not inside the sandbox home ${home}`);
  });
});

describe("finding the app's processes", () => {
  const binary = "/repo/gg-app/src-tauri/target/debug/gg-app";
  const home = "/private/var/folders/x/T/kleio-dev-host-abc/home";
  const match = { binary, home };

  it("counts the binary running with exactly the sandbox's HOME", () => {
    expect(
      psLineHasHome(
        ` 4242 ${binary} PATH=/usr/bin:/bin HOME=${home} CFFIXED_USER_HOME=${home}`,
        match,
      ),
    ).toBe(true);
    expect(psLineHasHome(`4242 ${binary} --flag HOME=${home}`, match)).toBe(true);
  });

  it.each([
    ["another HOME", `4242 ${binary} HOME=/Users/someone`],
    ["a HOME that starts like it", `4242 ${binary} HOME=${home}2`],
    ["a HOME inside it", `4242 ${binary} HOME=${home}/x`],
    ["only CFFIXED_USER_HOME", `4242 ${binary} CFFIXED_USER_HOME=${home}`],
    ["no environment shown", `4242 ${binary}`],
    ["another binary", `4242 /Applications/Kleio.app/Contents/MacOS/gg-app HOME=${home}`],
    ["a binary whose path starts like it", `4242 ${binary}-old HOME=${home}`],
    ["the binary in another command's arguments", `4242 /bin/echo ${binary} HOME=${home}`],
    ["a line without a pid", `${binary} HOME=${home}`],
  ])("ignores %s", (_, line) => {
    expect(psLineHasHome(line, match)).toBe(false);
  });
});

describe("the app's Keychain items", () => {
  it("are named as gg-app's keychain.rs names them, for a dev host at 127.0.0.1", () => {
    const source = readFileSync(
      new URL("../src-tauri/src/kleio/keychain.rs", import.meta.url),
      "utf8",
    );

    expect(source).toContain(`const SERVICE: &str = "${KEYCHAIN_SERVICE}";`);
    for (const kind of ["control-credential", "device-token"]) {
      expect(source).toContain(`format!("${kind}:{host}")`);
    }
    expect(LOOPBACK_ACCOUNTS).toEqual(["control-credential:127.0.0.1", "device-token:127.0.0.1"]);
  });
});
