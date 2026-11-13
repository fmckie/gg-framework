import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../scripts/install-mini.sh");
const homes: string[] = [];

/** A fake service-user home with a stand-in cli.js that echoes what it got. */
const CLI_STANDIN =
  "console.log(JSON.stringify({ args: process.argv.slice(2), port: process.env.KLEIO_HOST_PORT }));\n";

function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "kleio-install-"));
  homes.push(home);
  mkdirSync(join(home, "kleio-host/dist"), { recursive: true });
  writeFileSync(join(home, "kleio-host/dist/cli.js"), CLI_STANDIN);
  return home;
}

function installCli(home: string): string {
  return execFileSync("sh", [script, "cli"], {
    env: { PATH: process.env.PATH ?? "", HOME: home, KLEIO_NODE_BIN: process.execPath },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("install-mini.sh cli", () => {
  it("installs a kleio-host command that runs cli.js with the jobs' node and port", () => {
    const home = fakeHome();

    installCli(home);
    const out = execFileSync(join(home, ".local/bin/kleio-host"), ["devices", "--x"], {
      env: { PATH: "/usr/bin:/bin", HOME: home },
      encoding: "utf8",
    });

    expect(JSON.parse(out)).toEqual({ args: ["devices", "--x"], port: "8443" });
  });

  it("adds the folder to PATH in ~/.zprofile once, keeping what was there", () => {
    const home = fakeHome();
    writeFileSync(join(home, ".zprofile"), "eval mine\n");

    installCli(home);
    const second = installCli(home);
    const profile = readFileSync(join(home, ".zprofile"), "utf8");

    expect(profile.startsWith("eval mine\n")).toBe(true);
    expect(profile.split(".local/bin:$PATH").length - 1).toBe(1);
    expect(second).not.toContain("added ~/.local/bin");
  });
});

const STATE = "Library/Application Support/Kleio/host";
const JOBS = ["com.kleio.host.sidecar", "com.kleio.host.serve", "com.kleio.host.link"] as const;

interface Mac {
  readonly home: string;
  /** Outside the home: the stand-ins, their call log and any Kleio.app. */
  readonly root: string;
  /** install-mini.sh with `env` added, as the service user runs it. */
  install(env?: Record<string, string>, ...args: string[]): { status: number | null; out: string };
  calls(): string[];
  clearCalls(): void;
  /** The jobs started (launchctl bootstrap), in order. */
  started(): string[];
  plist(label: string): string;
}

/** kleio-link-host as the installer uses it: `id` answers with a key. */
function linkHost(home: string, version: string): void {
  linkHostAt(join(home, "kleio-host/bin/kleio-link-host"), version);
}

function linkHostAt(path: string, version: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `#!/bin/sh\n# version ${version}\n[ "$1" = id ] && echo ${"ab".repeat(32)}\n`,
  );
  chmodSync(path, 0o755);
}

/**
 * The service user's home on a Mac with Tailscale, the code in place, and
 * stand-ins on PATH for launchctl, tailscale and what retires old agents, each
 * recording its calls. Nothing here touches the real launchd or home.
 */
function fakeMac(): Mac {
  const home = fakeHome();
  const root = mkdtempSync(join(tmpdir(), "kleio-install-mac-"));
  homes.push(root);
  const bin = join(root, "bin");
  const jobs = join(root, "jobs");
  const log = join(root, "calls.log");
  mkdirSync(bin);
  mkdirSync(jobs);
  mkdirSync(join(home, "kleio-host/sidecar"));
  writeFileSync(join(home, "kleio-host/sidecar/app-sidecar.mjs"), "sidecar\n");
  linkHost(home, "1");
  const shim = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}`);
    chmodSync(join(bin, name), 0o755);
  };
  shim(
    "launchctl",
    `printf 'launchctl %s\\n' "$*" >> '${log}'
start() {
  n=$(( $(cat '${jobs}/next' 2>/dev/null || echo 100) + 1 ))
  echo "$n" > '${jobs}/next'
  echo "$n" > '${jobs}/'"$1"
}
case "$1" in
  bootout) rm -f '${jobs}/'"$(basename "$2")" ;;
  bootstrap) start "$(basename "$3" .plist)" ;;
  kickstart) [ ! -e '${jobs}/'"$(basename "$3")" ] || start "$(basename "$3")" ;;
  print) [ -e '${jobs}/'"$(basename "$2")" ] || exit 113
    printf '%s = {\\n\\tstate = running\\n\\tpid = %s\\n}\\n' "$2" "$(cat '${jobs}/'"$(basename "$2")")" ;;
esac
`,
  );
  shim(
    "tailscale",
    `printf 'tailscale %s\\n' "$*" >> '${log}'
if [ "$1" = status ]; then printf '{"Self":{"DNSName":"mini.tailnet.ts.net."}}\\n'; fi
`,
  );
  for (const name of ["sudo", "pkill", "osascript", "pgrep", "pmset"]) {
    shim(name, `printf '${name} %s\\n' "$*" >> '${log}'\nexit 1\n`);
  }
  shim("curl", "exit 7\n");
  shim("sleep", "exit 0\n");
  const calls = (): string[] =>
    existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return {
    home,
    root,
    install: (env = {}, ...args) => {
      const r = spawnSync("sh", [script, ...args], {
        env: {
          PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          HOME: home,
          KLEIO_NODE_BIN: process.execPath,
          TAILSCALE_BIN: join(bin, "tailscale"),
          ...env,
        },
        encoding: "utf8",
      });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    },
    calls,
    clearCalls: () => rmSync(log, { force: true }),
    started: () =>
      calls()
        .filter((c) => c.startsWith("launchctl bootstrap"))
        .map((c) => c.replace(/^.*\/([^/]+)\.plist$/, "$1")),
    plist: (label) => readFileSync(join(home, "Library/LaunchAgents", `${label}.plist`), "utf8"),
  };
}

/** Each test runs the installer a few times, a hundred short processes apiece. */
const INSTALL_TEST_TIMEOUT_MS = 20_000;

describe.skipIf(process.platform === "win32")(
  "install-mini.sh",
  { timeout: INSTALL_TEST_TIMEOUT_MS },
  () => {
    it("starts the link job after serve, then restarts it only when what it runs changed", () => {
      const mac = fakeMac();

      const first = mac.install();

      expect(first.status, first.out).toBe(0);
      expect(mac.started()).toEqual([...JOBS]);
      expect(mac.plist("com.kleio.host.link")).toContain(
        [
          `<string>${join(mac.home, "kleio-host/bin/kleio-link-host")}</string>`,
          "<string>serve</string>",
          "<string>--state-dir</string>",
          `<string>${join(mac.home, STATE)}</string>`,
          "<string>--upstream</string>",
          "<string>127.0.0.1:8445</string>",
        ].join("\n    "),
      );
      expect(mac.plist("com.kleio.host.serve")).toContain(
        "<key>KLEIO_LINK_PORT</key><string>8445</string>",
      );

      // Nothing it runs changed: phones stay connected.
      mac.clearCalls();
      const again = mac.install();
      expect(again.status, again.out).toBe(0);
      expect(mac.started()).toEqual(["com.kleio.host.sidecar", "com.kleio.host.serve"]);
      expect(again.out).toContain(
        "com.kleio.host.link: unchanged, left running so phones stay connected",
      );

      // A new kleio-link-host.
      linkHost(mac.home, "2");
      mac.clearCalls();
      expect(mac.install().status).toBe(0);
      expect(mac.started()).toEqual([...JOBS]);

      // Another link port: serve and the link job agree on it.
      mac.clearCalls();
      expect(mac.install({ KLEIO_LINK_PORT: "9445" }).status).toBe(0);
      expect(mac.started()).toEqual([...JOBS]);
      expect(mac.plist("com.kleio.host.link")).toContain("<string>127.0.0.1:9445</string>");
      expect(mac.plist("com.kleio.host.serve")).toContain(
        "<key>KLEIO_LINK_PORT</key><string>9445</string>",
      );
    });

    it("with Tailscale, gives the jobs its addresses and fronts both ports", () => {
      const mac = fakeMac();

      const r = mac.install();

      expect(r.status, r.out).toBe(0);
      const serve = mac.plist("com.kleio.host.serve");
      expect(serve).toContain(
        "<key>KLEIO_PUBLIC_URL</key><string>https://mini.tailnet.ts.net:8443</string>",
      );
      expect(serve).toContain(
        "<key>KLEIO_PREVIEW_URL</key><string>https://mini.tailnet.ts.net:8444</string>",
      );
      expect(mac.calls()).toContain("tailscale serve --bg --https=8443 http://127.0.0.1:8443");
      expect(mac.calls()).toContain("tailscale serve --bg --https=8444 http://127.0.0.1:8444");
    });

    it("without Tailscale, installs for the link alone, with no tailnet addresses", () => {
      const mac = fakeMac();

      const r = mac.install({ TAILSCALE_BIN: join(mac.home, "no-tailscale") });

      expect(r.status, r.out).toBe(0);
      for (const label of ["com.kleio.host.sidecar", "com.kleio.host.serve"]) {
        expect(mac.plist(label)).not.toContain("KLEIO_PUBLIC_URL");
        expect(mac.plist(label)).not.toContain("KLEIO_PREVIEW_URL");
      }
      expect(mac.calls().some((c) => c.startsWith("tailscale"))).toBe(false);
      expect(mac.started()).toEqual([...JOBS]);
      expect(r.out).toContain("public:  none: without Tailscale, phones use Kleio's link alone");
      expect(r.out).toContain("preview: none: site previews need Tailscale for now");
    });

    it("stops before changing anything without kleio-link-host", () => {
      const mac = fakeMac();
      rmSync(join(mac.home, "kleio-host/bin"), { recursive: true });

      const r = mac.install();

      expect(r.status).toBe(1);
      expect(r.out).toContain(`missing ${join(mac.home, "kleio-host/bin/kleio-link-host")}`);
      expect(mac.calls()).toEqual([]);
    });

    it("uninstall stops and removes the link job too, and keeps the state", () => {
      const mac = fakeMac();
      expect(mac.install().status).toBe(0);
      mac.clearCalls();

      const r = mac.install({}, "uninstall");

      expect(r.status, r.out).toBe(0);
      for (const label of JOBS) {
        expect(
          mac.calls().some((c) => c.endsWith(`bootout gui/${process.getuid?.()}/${label}`)),
        ).toBe(true);
        expect(existsSync(join(mac.home, "Library/LaunchAgents", `${label}.plist`))).toBe(false);
      }
      expect(existsSync(join(mac.home, "kleio-host/.link-job"))).toBe(false);
      expect(mac.calls()).toContain("tailscale serve --https=8443 off");
      expect(existsSync(join(mac.home, STATE, "logs"))).toBe(true);
    });
  },
);

/** Paths, the user ID and node in a fake Mac's output, as fixed words. */
function normalized(mac: Mac, text: string): string {
  return text
    .split(process.execPath)
    .join("@NODE@")
    .split(mac.home)
    .join("@HOME@")
    .split(mac.root)
    .join("@ROOT@")
    .split(`gui/${process.getuid?.()}`)
    .join("gui/@UID@");
}

describe.skipIf(process.platform === "win32")(
  "install-mini.sh with no variables (the mini)",
  { timeout: INSTALL_TEST_TIMEOUT_MS },
  () => {
    // The fixtures were written by main's install-mini.sh at 3f10e6b3, before app
    // mode: with none of its variables set, the mini gets exactly what it got.
    it("writes the same jobs, makes the same calls and says the same", async () => {
      const mac = fakeMac();
      mkdirSync(join(mac.home, "Library/LaunchAgents"), { recursive: true });
      writeFileSync(join(mac.home, "Library/LaunchAgents/com.atlas.host.plist"), "<plist/>\n");

      const r = mac.install();

      expect(r.status, r.out).toBe(0);
      for (const label of JOBS) {
        await expect(normalized(mac, mac.plist(label))).toMatchFileSnapshot(
          `./fixtures/install-mini/mini-${label}.plist`,
        );
      }
      await expect(normalized(mac, `${mac.calls().join("\n")}\n`)).toMatchFileSnapshot(
        "./fixtures/install-mini/mini-calls.txt",
      );
      await expect(normalized(mac, r.out)).toMatchFileSnapshot(
        "./fixtures/install-mini/mini-out.txt",
      );
      expect(
        existsSync(
          join(mac.home, "Library/LaunchAgents/retired-by-kleio-host/com.atlas.host.plist"),
        ),
      ).toBe(true);
      expect(existsSync(join(mac.home, ".local/bin/kleio-host"))).toBe(true);
    });
  },
);

const CODE_ROOT = "Library/Application Support/Kleio/host-code";
const VERSION = "2.2.0+3f10e6b3";
const NOT_ASKED = ["sudo", "pkill", "osascript", "pgrep", "tailscale", "pmset"];

/** Kleio.app/Contents with the host staged in it, as stage-host.mjs and the app build leave it. */
function fakeApp(mac: Mac, version = VERSION): string {
  const contents = join(mac.root, `Kleio-${version}.app/Contents`);
  const host = join(contents, "Resources/host");
  mkdirSync(join(host, "dist/bin"), { recursive: true });
  mkdirSync(join(contents, "Resources/sidecar"), { recursive: true });
  mkdirSync(join(contents, "MacOS"));
  writeFileSync(join(host, "dist/cli.js"), CLI_STANDIN);
  writeFileSync(join(host, "dist/bin/kleio-capture"), "capture\n");
  linkHostAt(join(host, "bin/kleio-link-host"), version);
  copyFileSync(script, join(host, "install-mini.sh"));
  writeFileSync(join(host, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(host, "VERSION"), `${version}\n`);
  writeFileSync(join(contents, "Resources/sidecar/app-sidecar.mjs"), "sidecar\n");
  writeFileSync(join(contents, "MacOS/ggnode"), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  chmodSync(join(contents, "MacOS/ggnode"), 0o755);
  return contents;
}

/** The environment the app runs install-mini.sh with. */
function appEnv(mac: Mac, contents: string, version = VERSION): Record<string, string> {
  const code = join(mac.home, CODE_ROOT, version);
  return {
    KLEIO_HOST_MODE: "app",
    KLEIO_APP_CONTENTS: contents,
    KLEIO_HOST_CODE: code,
    KLEIO_NODE_BIN: join(code, "bin/ggnode"),
  };
}

function agents(mac: Mac): string[] {
  const dir = join(mac.home, "Library/LaunchAgents");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe.skipIf(process.platform === "win32")(
  "install-mini.sh in app mode (On this Mac)",
  { timeout: INSTALL_TEST_TIMEOUT_MS },
  () => {
    it("copies the host from Kleio.app into its version's folder and runs the jobs from there", () => {
      const mac = fakeMac();
      const code = join(mac.home, CODE_ROOT, VERSION);

      const r = mac.install(appEnv(mac, fakeApp(mac)));

      expect(r.status, r.out).toBe(0);
      for (const f of [
        "dist/cli.js",
        "dist/bin/kleio-capture",
        "sidecar/app-sidecar.mjs",
        "bin/kleio-link-host",
        "bin/ggnode",
        "install-mini.sh",
        "package.json",
        "VERSION",
      ]) {
        expect(existsSync(join(code, f)), f).toBe(true);
      }
      expect(readdirSync(join(mac.home, CODE_ROOT))).toEqual([VERSION]);
      expect(mac.started()).toEqual([...JOBS]);
      const serve = mac.plist("com.kleio.host.serve");
      expect(serve).toContain(`<string>${join(code, "bin/ggnode")}</string>`);
      expect(serve).toContain(`<string>${join(code, "dist/cli.js")}</string>`);
      expect(serve).toContain(
        `<key>KLEIO_SIDECAR_PATH</key><string>${join(code, "sidecar/app-sidecar.mjs")}</string>`,
      );
      expect(serve).not.toContain("KLEIO_PUBLIC_URL");
      expect(mac.plist("com.kleio.host.link")).toContain(
        `<string>${join(code, "bin/kleio-link-host")}</string>`,
      );
      for (const label of JOBS) {
        expect(mac.plist(label)).toContain(
          "<key>AssociatedBundleIdentifiers</key><array><string>com.kleio.app</string></array>",
        );
        expect(mac.plist(label)).not.toContain(join(mac.home, "kleio-host/"));
      }
    });

    it("asks nothing of the rest of the Mac: no sudo, old jobs, Tailscale, pmset, command or ~/.zprofile", () => {
      const mac = fakeMac();
      mkdirSync(join(mac.home, "Library/LaunchAgents"), { recursive: true });
      writeFileSync(join(mac.home, "Library/LaunchAgents/com.atlas.host.plist"), "<plist/>\n");

      // TAILSCALE_BIN is the stand-in, so Tailscale counts as installed.
      const r = mac.install(appEnv(mac, fakeApp(mac)));

      expect(r.status, r.out).toBe(0);
      expect(mac.calls().filter((c) => NOT_ASKED.includes(c.split(" ")[0] ?? ""))).toEqual([]);
      expect(existsSync(join(mac.home, "Library/LaunchAgents/com.atlas.host.plist"))).toBe(true);
      expect(existsSync(join(mac.home, ".zprofile"))).toBe(false);
      expect(existsSync(join(mac.home, ".local/bin"))).toBe(false);
      expect(r.out).not.toContain("kleio-host pair");
    });

    it("leaves a host installed the mini's way alone, changing nothing", () => {
      const mac = fakeMac();
      expect(mac.install().status).toBe(0);
      const before = JOBS.map((label) => mac.plist(label));
      mac.clearCalls();

      const r = mac.install(appEnv(mac, fakeApp(mac)));
      const off = mac.install({ KLEIO_HOST_MODE: "app" }, "uninstall");

      expect(r.status).toBe(1);
      expect(r.out).toContain("already runs a Kleio host that wasn't installed by the Kleio app");
      expect(off.status).toBe(1);
      expect(mac.calls()).toEqual([]);
      expect(JOBS.map((label) => mac.plist(label))).toEqual(before);
      expect(existsSync(join(mac.home, CODE_ROOT))).toBe(false);
    });

    it("stops before changing anything without Kleio.app's contents", () => {
      const mac = fakeMac();
      const env = appEnv(mac, fakeApp(mac));

      for (const contents of [undefined, join(mac.root, "Nowhere.app/Contents")]) {
        const r = mac.install({ ...env, KLEIO_APP_CONTENTS: contents ?? "" });
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain("KLEIO_APP_CONTENTS");
      }
      expect(mac.calls()).toEqual([]);
      expect(existsSync(join(mac.home, CODE_ROOT))).toBe(false);
      expect(agents(mac)).toEqual([]);
    });

    it("refuses a code folder that isn't one name in host-code", () => {
      const mac = fakeMac();
      const contents = fakeApp(mac);
      const root = join(mac.home, CODE_ROOT);

      for (const code of [
        root,
        `${root}/..`,
        `${root}/.`,
        `${root}/current`,
        `${root}/${VERSION}.partial`,
        `${root}/a/b`,
        join(mac.home, "kleio-host"),
      ]) {
        const r = mac.install({ ...appEnv(mac, contents), KLEIO_HOST_CODE: code });
        expect(r.status, code).toBe(1);
        expect(r.out).toContain("KLEIO_HOST_CODE must be a folder in");
      }
      expect(mac.calls()).toEqual([]);
      expect(existsSync(root)).toBe(false);
    });

    it.skipIf(process.getuid?.() === 0)("leaves no version folder when the copy fails", () => {
      const mac = fakeMac();
      const contents = fakeApp(mac);
      const unreadable = join(contents, "Resources/sidecar/locked.bin");
      writeFileSync(unreadable, "x\n");
      chmodSync(unreadable, 0o000);

      const r = mac.install(appEnv(mac, contents));

      expect(r.status).toBe(1);
      expect(r.out).toContain("nothing was installed");
      expect(readdirSync(join(mac.home, CODE_ROOT))).toEqual([]);
      expect(mac.calls()).toEqual([]);
      expect(agents(mac)).toEqual([]);
    });

    it("run again, keeps the copy and leaves the link job running", () => {
      const mac = fakeMac();
      const env = appEnv(mac, fakeApp(mac));
      expect(mac.install(env).status).toBe(0);
      mac.clearCalls();

      const again = mac.install(env);

      expect(again.status, again.out).toBe(0);
      expect(again.out).toContain("(already there)");
      expect(mac.started()).toEqual(["com.kleio.host.sidecar", "com.kleio.host.serve"]);
      expect(again.out).toContain(
        "com.kleio.host.link: unchanged, left running so phones stay connected",
      );
    });

    it("moves the jobs to a new version's folder and keeps the one before", () => {
      const mac = fakeMac();
      expect(mac.install(appEnv(mac, fakeApp(mac))).status).toBe(0);
      const next = "2.2.1+aaaaaaaa";
      mac.clearCalls();

      const r = mac.install(appEnv(mac, fakeApp(mac, next), next));

      expect(r.status, r.out).toBe(0);
      expect(mac.started()).toEqual([...JOBS]);
      expect(mac.plist("com.kleio.host.link")).toContain(
        `<string>${join(mac.home, CODE_ROOT, next, "bin/kleio-link-host")}</string>`,
      );
      expect(readdirSync(join(mac.home, CODE_ROOT)).sort()).toEqual([VERSION, next]);
    });

    it("uninstall removes the jobs and host-code, and keeps the state", () => {
      const mac = fakeMac();
      expect(mac.install(appEnv(mac, fakeApp(mac))).status).toBe(0);
      mac.clearCalls();

      const r = mac.install({ KLEIO_HOST_MODE: "app" }, "uninstall");

      expect(r.status, r.out).toBe(0);
      for (const label of JOBS) {
        expect(
          mac.calls().some((c) => c.endsWith(`bootout gui/${process.getuid?.()}/${label}`)),
        ).toBe(true);
      }
      expect(agents(mac)).toEqual([]);
      expect(existsSync(join(mac.home, CODE_ROOT))).toBe(false);
      expect(existsSync(join(mac.home, STATE, "logs"))).toBe(true);
      expect(mac.calls().some((c) => c.startsWith("tailscale"))).toBe(false);
    });

    it("installs no kleio-host command, and refuses a mode it doesn't know", () => {
      const mac = fakeMac();

      const cli = mac.install({ KLEIO_HOST_MODE: "app" }, "cli");
      const other = mac.install({ KLEIO_HOST_MODE: "laptop" });

      expect(cli.status).toBe(2);
      expect(existsSync(join(mac.home, ".local/bin"))).toBe(false);
      expect(other.status).toBe(2);
      expect(other.out).toContain("KLEIO_HOST_MODE is app or unset");
      expect(mac.calls()).toEqual([]);
    });
  },
);
