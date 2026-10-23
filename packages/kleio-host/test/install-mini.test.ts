import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../scripts/install-mini.sh");
const homes: string[] = [];

/** A fake service-user home with a stand-in cli.js that echoes what it got. */
function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "kleio-install-"));
  homes.push(home);
  mkdirSync(join(home, "kleio-host/dist"), { recursive: true });
  writeFileSync(
    join(home, "kleio-host/dist/cli.js"),
    "console.log(JSON.stringify({ args: process.argv.slice(2), port: process.env.KLEIO_HOST_PORT }));\n",
  );
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
  const path = join(home, "kleio-host/bin/kleio-link-host");
  mkdirSync(join(home, "kleio-host/bin"), { recursive: true });
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
  for (const name of ["sudo", "pkill", "osascript", "pgrep"]) {
    shim(name, `printf '${name} %s\\n' "$*" >> '${log}'\nexit 1\n`);
  }
  shim("curl", "exit 7\n");
  shim("sleep", "exit 0\n");
  const calls = (): string[] =>
    existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return {
    home,
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
