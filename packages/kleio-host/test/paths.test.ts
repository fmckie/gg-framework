import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostPaths, resolveHostHome } from "../src/paths.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveHostHome", () => {
  it("macOS: ~/Library/Application Support/Kleio/host, as before", () => {
    expect(resolveHostHome({ platform: "darwin", env: {}, homedir: "/Users/x" })).toBe(
      "/Users/x/Library/Application Support/Kleio/host",
    );
  });

  it("Windows: %LOCALAPPDATA%\\Kleio\\host", () => {
    expect(
      resolveHostHome({
        platform: "win32",
        env: { LOCALAPPDATA: "D:\\Profiles\\x\\AppData\\Local" },
        homedir: "C:\\Users\\x",
      }),
    ).toBe("D:\\Profiles\\x\\AppData\\Local\\Kleio\\host");
  });

  it("Windows: <home>\\AppData\\Local when LOCALAPPDATA is missing or relative", () => {
    for (const env of [{}, { LOCALAPPDATA: "" }, { LOCALAPPDATA: "AppData\\Local" }]) {
      expect(resolveHostHome({ platform: "win32", env, homedir: "C:\\Users\\x" })).toBe(
        "C:\\Users\\x\\AppData\\Local\\Kleio\\host",
      );
    }
  });

  it("Linux and the rest: $XDG_STATE_HOME/kleio/host", () => {
    for (const platform of ["linux", "freebsd"]) {
      expect(
        resolveHostHome({ platform, env: { XDG_STATE_HOME: "/var/state/x" }, homedir: "/home/x" }),
      ).toBe("/var/state/x/kleio/host");
    }
  });

  it("Linux: ~/.local/state when XDG_STATE_HOME is missing or relative (the spec ignores it)", () => {
    for (const env of [{}, { XDG_STATE_HOME: "" }, { XDG_STATE_HOME: "state" }]) {
      expect(resolveHostHome({ platform: "linux", env, homedir: "/home/x" })).toBe(
        "/home/x/.local/state/kleio/host",
      );
    }
  });

  it("KLEIO_HOST_HOME wins on every OS, kept exactly as given", () => {
    const cases = [
      { platform: "darwin", homedir: "/Users/x", value: "/srv/kleio" },
      { platform: "win32", homedir: "C:\\Users\\x", value: "E:\\kleio" },
      { platform: "linux", homedir: "/home/x", value: "/srv/kleio" },
    ];
    for (const { platform, homedir: home, value } of cases) {
      const env = {
        KLEIO_HOST_HOME: value,
        LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
        XDG_STATE_HOME: "/var/state/x",
      };
      expect(resolveHostHome({ platform, env, homedir: home })).toBe(value);
    }
    // `??`, as before: only an unset variable falls through.
    expect(
      resolveHostHome({ platform: "darwin", env: { KLEIO_HOST_HOME: "" }, homedir: "/Users/x" }),
    ).toBe("");
  });
});

describe("hostPaths", () => {
  it("puts every file under the state folder with this OS's separator", () => {
    const home = join("state", "host");
    const p = hostPaths(home);
    expect(p).toEqual({
      home,
      secureDir: join(home, "secure"),
      masterKey: join(home, "secure", "headless-master.key"),
      controlRootKey: join(home, "secure", "control-root.key"),
      adminToken: join(home, "secure", "admin.token"),
      registry: join(home, "secure", "device-registry.json"),
      linkKey: join(home, "secure", "link.key"),
      linkUpstreamToken: join(home, "secure", "link-upstream.token"),
      linkAllow: join(home, "secure", "link-allow.json"),
      nodeId: join(home, "node-id"),
      linkDir: join(home, "link"),
      composioKey: join(home, "composio.key"),
      typesafeKey: join(home, "typesafe.key"),
      openaiKey: join(home, "openai.key"),
      rings: join(home, "rings"),
      sidecarEndpoint: join(home, "sidecar.json"),
      work: join(home, "work"),
      logs: join(home, "logs"),
    });
  });

  it("reads KLEIO_HOST_HOME from the real environment", () => {
    const override = join(homedir(), "kleio-paths-test");
    vi.stubEnv("KLEIO_HOST_HOME", override);
    expect(hostPaths().home).toBe(override);
  });

  it("without it, uses this OS's default", () => {
    vi.stubEnv("KLEIO_HOST_HOME", undefined);
    expect(hostPaths().home).toBe(
      resolveHostHome({ platform: process.platform, env: process.env, homedir: homedir() }),
    );
  });
});
