// deploy-mini.sh and rollback-mini.sh, against a fake mini: a temp folder as
// the mini's home, laid out as the real one (install-mini.sh, src/paths.ts),
// and stand-ins on PATH for what talks to it. `ssh` runs the remote script
// locally with HOME = the fake mini; `rsync` copies into it; `launchctl` and
// `curl` record each call, and curl answers /kleio/health as the test says.
// The link job, started, writes link/state.json as kleio-link-host does,
// unless the test says it's down. Nothing here reaches a real host or the
// real home.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = resolve(__dirname, "../scripts");
const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const STATE = "Library/Application Support/Kleio/host";
const LABELS = ["com.kleio.host.sidecar", "com.kleio.host.serve"] as const;
/** Kleio's link: a mini from before it has neither its job nor bin/kleio-link-host. */
const LINK = "com.kleio.host.link";
const JOBS = [...LABELS, LINK] as const;
const LINK_BUILT = "packages/kleio-link/target/aarch64-apple-darwin/release/kleio-link-host";

function plist(label: string, version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>EnvironmentVariables</key><dict>
    <key>KLEIO_HOST_PORT</key><string>8443</string>
    <key>VERSION</key><string>${version}</string>
  </dict>
</dict></plist>
`;
}

function write(path: string, body: string, mode?: number): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, body);
  if (mode !== undefined) chmodSync(path, mode);
}

interface World {
  readonly repo: string;
  readonly mini: string;
  readonly laptopHome: string;
  readonly log: string;
  health(state: "up" | "down"): void;
  /** Whether kleio-link-host, started, writes its state. */
  link(state: "up" | "down"): void;
  /** The macOS version the mini's sw_vers reports. */
  macos(version: string): void;
  /** The mini's `uname -m`. */
  arch(machine: string): void;
  calls(): string[];
  clearCalls(): void;
}

/**
 * A checkout with the two scripts and something built to deploy ("new"), and
 * a mini running an older host ("old") with state, ~/.gg and its two jobs,
 * from before Kleio's link.
 */
function world(): World {
  const root = mkdtempSync(join(tmpdir(), "kleio-deploy-"));
  roots.push(root);
  const repo = join(root, "repo");
  const mini = join(root, "mini");
  const bin = join(root, "bin");
  const state = join(root, "state");
  const laptopHome = join(root, "laptop-home");
  const log = join(state, "calls.log");
  for (const d of [bin, join(state, "loaded"), laptopHome]) mkdirSync(d, { recursive: true });

  // The checkout.
  for (const name of ["deploy-mini.sh", "rollback-mini.sh"]) {
    write(
      join(repo, "packages/kleio-host/scripts", name),
      readFileSync(join(scripts, name), "utf8"),
    );
  }
  write(join(repo, "packages/kleio-host/package.json"), "{}\n");
  write(join(repo, "packages/kleio-host/dist/cli.js"), "new cli\n");
  write(join(repo, "packages/kleio-host/dist/chunk-new.js"), "new chunk\n");
  write(join(repo, "packages/kleio-host/dist/bin/kleio-capture"), "new capture helper\n", 0o755);
  write(join(repo, "gg-app/src-tauri/sidecar/app-sidecar.mjs"), "new sidecar\n");
  write(join(repo, "gg-app/src-tauri/sidecar/node_modules/dep/index.js"), "new dep\n");
  write(join(repo, LINK_BUILT), "new link host\n", 0o755);
  // Stands in for install-mini.sh: new plists, then the three jobs restarted.
  write(
    join(repo, "packages/kleio-host/scripts/install-mini.sh"),
    `#!/bin/sh
# new installer
set -eu
AGENTS="$HOME/Library/LaunchAgents"
${JOBS.map((l) => `cat > "$AGENTS/${l}.plist" <<'PL'\n${plist(l, "new")}PL`).join("\n")}
for label in ${JOBS.join(" ")}; do
  launchctl bootout "gui/$(id -u)/$label" || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  launchctl kickstart -k "gui/$(id -u)/$label"
done
`,
  );

  // The mini.
  write(join(mini, "kleio-host/dist/cli.js"), "old cli\n");
  write(join(mini, "kleio-host/dist/old-only.js"), "old only\n");
  write(join(mini, "kleio-host/sidecar/app-sidecar.mjs"), "old sidecar\n");
  write(join(mini, "kleio-host/sidecar/node_modules/dep/index.js"), "old dep\n");
  write(join(mini, "kleio-host/install-mini.sh"), "# old installer\n", 0o755);
  write(join(mini, "kleio-host/package.json"), '{ "type": "module" }\n');
  write(join(mini, STATE, "secure/device-registry.json"), '{"devices":["phone"]}\n', 0o600);
  write(join(mini, STATE, "secure/admin.token"), "admin-token\n", 0o600);
  chmodSync(join(mini, STATE, "secure"), 0o700);
  write(join(mini, STATE, "sessions.json"), "{}\n", 0o600);
  write(join(mini, STATE, "rings/s1.jsonl"), '{"seq":1}\n');
  write(join(mini, ".gg/auth.json"), '{"anthropic":"signed in"}\n', 0o600);
  write(join(mini, ".gg/chat-sessions/general/a.jsonl"), '{"role":"user"}\n');
  for (const l of LABELS) write(join(mini, "Library/LaunchAgents", `${l}.plist`), plist(l, "old"));
  for (const l of LABELS) writeFileSync(join(state, "loaded", l), "");

  const shim = (name: string, body: string): void =>
    write(join(bin, name), `#!/bin/sh\n${body}`, 0o755);
  shim(
    "ssh",
    `while [ $# -gt 0 ]; do
  case "$1" in -o) shift 2 ;; -*) shift ;; *) break ;; esac
done
host=$1; shift
printf 'ssh %s %s\\n' "$host" "$*" >> '${log}'
[ "$host" = mac-mini-1 ] || { echo "ssh: no host $host" >&2; exit 255; }
cd '${mini}'
exec env -i HOME='${mini}' PATH='${bin}:/usr/bin:/bin:/usr/sbin:/sbin' sh -c "$*"
`,
  );
  shim(
    "rsync",
    `printf 'rsync %s\\n' "$*" >> '${log}'
delete=0
while [ $# -gt 0 ]; do
  case "$1" in --delete) delete=1 ;; -*) ;; *) break ;; esac
  shift
done
case "$2" in mac-mini-1:*) ;; *) echo "rsync: no host in $2" >&2; exit 1 ;; esac
target='${mini}'/"\${2#*:}"
case "$1" in
  */) mkdir -p "$target"; [ "$delete" = 0 ] || find "$target" -mindepth 1 -delete; cp -R "$1". "$target" ;;
  *) cp "$1" "$target" ;;
esac
`,
  );
  shim(
    "launchctl",
    `printf 'launchctl %s\\n' "$*" >> '${log}'
# A loaded job is its pid in loaded/<label>, new on each start.
start() {
  n=$(( $(cat '${state}/next-pid' 2>/dev/null || echo 100) + 1 ))
  echo "$n" > '${state}/next-pid'
  echo "$n" > '${state}/loaded/'"$1"
  [ "$1" = ${LINK} ] && [ "$(cat '${state}/link')" = up ] || return 0
  mkdir -p "$HOME/${STATE}/link"
  printf '{\\n  "version": 1,\\n  "pid": %s,\\n  "relay": "https://relay.example/",\\n  "relays": []\\n}\\n' "$n" > "$HOME/${STATE}/link/state.json"
}
case "$1" in
  bootout) rm -f '${state}/loaded/'"$(basename "$2")" ;;
  bootstrap) start "$(basename "$3" .plist)" ;;
  kickstart) [ ! -e '${state}/loaded/'"$(basename "$3")" ] || start "$(basename "$3")" ;;
  print) [ -e '${state}/loaded/'"$(basename "$2")" ] || exit 113
    printf '%s = {\\n\\tstate = running\\n\\tpid = %s\\n}\\n' "$2" "$(cat '${state}/loaded/'"$(basename "$2")")" ;;
esac
`,
  );
  shim(
    "curl",
    `printf 'curl %s\\n' "$*" >> '${log}'
[ "$(cat '${state}/health')" = up ] || exit 7
printf '{"ok":true,"sidecar":"up","devices":1,"offer":false,"sessions":[]}'
`,
  );
  shim("sleep", "exit 0\n");
  shim("sw_vers", `[ "$1" = -productVersion ] && cat '${state}/macos'\n`);
  shim("uname", `if [ "$1" = -m ]; then cat '${state}/arch'; else echo Darwin; fi\n`);

  const w: World = {
    repo,
    mini,
    laptopHome,
    log,
    health: (s) => writeFileSync(join(state, "health"), s),
    link: (s) => writeFileSync(join(state, "link"), s),
    macos: (v) => writeFileSync(join(state, "macos"), `${v}\n`),
    arch: (m) => writeFileSync(join(state, "arch"), `${m}\n`),
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []),
    clearCalls: () => rmSync(log, { force: true }),
  };
  w.health("up");
  w.link("up");
  w.macos("26.6.2");
  w.arch("arm64");
  return w;
}

/** Runs a script with `env` added; HEALTH_WAIT unset means the scripts' default (60). */
function runWith(w: World, env: Record<string, string>, script: string, ...args: string[]) {
  const r = spawnSync("sh", [join(w.repo, "packages/kleio-host/scripts", script), ...args], {
    cwd: w.repo,
    env: {
      PATH: `${join(w.mini, "..", "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: w.laptopHome,
      ...env,
    },
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/**
 * Runs a script with a 2-try health wait. The sleep stand-in returns at once,
 * so a failing health check costs one curl per try, not 60 of them.
 */
function run(w: World, script: string, ...args: string[]) {
  return runWith(w, { HEALTH_WAIT: "2" }, script, ...args);
}

const read = (w: World, rel: string): string => readFileSync(join(w.mini, rel), "utf8");
const mode = (path: string): number => statSync(path).mode & 0o777;

/** Every path under the fake mini with its mode and content hash. */
function tree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of readdirSync(dir, { recursive: true }).map(String).sort()) {
    const s = statSync(join(dir, rel));
    const hash = s.isDirectory()
      ? "dir"
      : createHash("sha256")
          .update(readFileSync(join(dir, rel)))
          .digest("hex");
    out.set(rel, `${(s.mode & 0o777).toString(8)} ${hash}`);
  }
  return out;
}

function backups(w: World): string[] {
  const dir = join(w.mini, "kleio-backups");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** The deploy stamp has one-second steps: two deploys need a second between them. */
const nextSecond = (): Promise<void> => new Promise((done) => setTimeout(done, 1_100));

/**
 * Each test runs whole deploys as shell scripts, about a hundred short-lived
 * processes apiece. One deploy took 3.2 s on a macOS CI runner, so vitest's
 * default 5 s per test is too tight.
 */
const DEPLOY_TEST_TIMEOUT_MS = 20_000;

/** The scripts need sh, which Windows lacks. */
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("deploy-mini.sh and rollback-mini.sh", { timeout: DEPLOY_TEST_TIMEOUT_MS }, () => {
  it("keeps the old code in .prev and the state in a snapshot, then deploys", () => {
    const w = world();
    const stateBefore = tree(join(w.mini, STATE));

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status, r.out).toBe(0);
    // .prev: the code that ran before, whole.
    expect(read(w, "kleio-host/.prev/dist/cli.js")).toBe("old cli\n");
    expect(read(w, "kleio-host/.prev/dist/old-only.js")).toBe("old only\n");
    expect(read(w, "kleio-host/.prev/sidecar/app-sidecar.mjs")).toBe("old sidecar\n");
    expect(read(w, "kleio-host/.prev/sidecar/node_modules/dep/index.js")).toBe("old dep\n");
    expect(read(w, "kleio-host/.prev/install-mini.sh")).toBe("# old installer\n");
    for (const l of LABELS) {
      expect(read(w, `kleio-host/.prev/LaunchAgents/${l}.plist`)).toBe(plist(l, "old"));
    }
    // The snapshot: the state and ~/.gg as they were, modes kept, 0700.
    const [stamp, ...more] = backups(w);
    expect(more).toEqual([]);
    expect(stamp).toMatch(/^\d{8}T\d{6}Z$/);
    const snap = join(w.mini, "kleio-backups", stamp ?? "");
    expect(mode(join(w.mini, "kleio-backups"))).toBe(0o700);
    expect(mode(snap)).toBe(0o700);
    expect(tree(join(snap, "state"))).toEqual(stateBefore);
    expect(tree(join(snap, "gg"))).toEqual(tree(join(w.mini, ".gg")));
    expect(mode(join(snap, "state/secure"))).toBe(0o700);
    expect(mode(join(snap, "state/secure/device-registry.json"))).toBe(0o600);
    expect(readFileSync(join(snap, "manifest.txt"), "utf8")).toContain(`Taken: ${stamp} (UTC)`);
    expect(r.out).toContain(`state snapshot ${snap}`);
    // The new code is in place, installed, and the in-progress mark is gone.
    expect(read(w, "kleio-host/dist/cli.js")).toBe("new cli\n");
    expect(read(w, "kleio-host/dist/bin/kleio-capture")).toBe("new capture helper\n");
    expect(existsSync(join(w.mini, "kleio-host/dist/old-only.js"))).toBe(false);
    expect(r.out).toContain("\nmacOS 26.6.2\n");
    expect(r.out).not.toContain("needs macOS 14");
    expect(read(w, "kleio-host/sidecar/app-sidecar.mjs")).toBe("new sidecar\n");
    expect(read(w, "Library/LaunchAgents/com.kleio.host.serve.plist")).toBe(
      plist("com.kleio.host.serve", "new"),
    );
    expect(existsSync(join(w.mini, "kleio-host/.deploy-in-progress"))).toBe(false);
    expect(w.calls().filter((c) => c.startsWith("rsync"))).toEqual([
      "rsync -az --delete packages/kleio-host/dist/ mac-mini-1:kleio-host/dist/",
      "rsync -az packages/kleio-host/scripts/install-mini.sh mac-mini-1:kleio-host/",
      "rsync -az --delete gg-app/src-tauri/sidecar/ mac-mini-1:kleio-host/sidecar/",
      `rsync -az ${LINK_BUILT} mac-mini-1:kleio-host/bin/kleio-link-host`,
    ]);
    expect(w.calls()).toContain("ssh mac-mini-1 mkdir -p kleio-host/bin");
    expect(w.calls()).toContain("ssh mac-mini-1 sh kleio-host/install-mini.sh");
    expect(w.calls()).toContain("curl -s -m 2 http://127.0.0.1:8443/kleio/health");
    // Kleio's link: kleio-link-host beside dist, its job up and on a relay.
    // The mini had none before, so .prev has none.
    expect(read(w, "kleio-host/bin/kleio-link-host")).toBe("new link host\n");
    expect(existsSync(join(w.mini, "kleio-host/.prev/bin"))).toBe(false);
    expect(existsSync(join(w.mini, `kleio-host/.prev/LaunchAgents/${LINK}.plist`))).toBe(false);
    expect(r.out).toContain(
      ".prev: the code that runs now (dist, sidecar, install-mini.sh, launchd plists)",
    );
    expect(r.out).toMatch(/; link up \(pid \d+\), on https:\/\/relay\.example\/\n/);
  });

  it("warns when the mini's macOS can't run the capture helper, and deploys the rest", () => {
    const w = world();
    w.macos("13.6.1");

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(
      "The mini runs macOS 13.6.1: showing web pages and PDFs in a voice call needs macOS 14 or later.",
    );
    expect(read(w, "kleio-host/dist/cli.js")).toBe("new cli\n");
  });

  it("with --no-build, refuses to deploy without the capture helper, and changes nothing", () => {
    const w = world();
    rmSync(join(w.repo, "packages/kleio-host/dist/bin"), { recursive: true });
    const before = tree(w.mini);

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status).toBe(1);
    expect(r.out).toContain("missing packages/kleio-host/dist/bin/kleio-capture; build first");
    expect(tree(w.mini)).toEqual(before);
    expect(w.calls()).toEqual([]);
  });

  it("with --no-build, refuses to deploy without kleio-link-host, and changes nothing", () => {
    const w = world();
    rmSync(join(w.repo, "packages/kleio-link/target"), { recursive: true });
    const before = tree(w.mini);

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status).toBe(1);
    expect(r.out).toContain(`missing ${LINK_BUILT}; build first`);
    expect(tree(w.mini)).toEqual(before);
    expect(w.calls()).toEqual([]);
  });

  it("refuses a mini without Apple silicon, which kleio-link-host is built for, and changes nothing", () => {
    const w = world();
    w.arch("x86_64");
    const before = tree(w.mini);

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status).not.toBe(0);
    expect(r.out).toContain(
      "The mini is x86_64: kleio-link-host is built for Apple silicon (arm64) only.",
    );
    expect(tree(w.mini)).toEqual(before);
    expect(w.calls().some((c) => c.startsWith("rsync"))).toBe(false);
  });

  it("keeps the mark and says why when kleio-link-host doesn't come up", () => {
    const w = world();
    // An earlier kleio-link-host's state: it isn't the job's process now.
    write(
      join(w.mini, STATE, "link/state.json"),
      '{\n  "pid": 1,\n  "relay": "https://relay.example/"\n}\n',
    );
    w.link("down");

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(
      /After 2 s, kleio-link-host is running \(pid \d+\), but hasn't written its state yet\./,
    );
    expect(r.out).toContain(`Its log: ${join(w.mini, STATE, "logs/link.err.log")}`);
    expect(r.out).not.toContain("Not healthy after");
    expect(r.out).toContain("To go back to the code that ran before:");
    expect(read(w, "kleio-host/.deploy-in-progress")).toContain("code_changed=1");
  });

  it("refuses to deploy over an unfinished deploy, and changes nothing", () => {
    const w = world();
    write(
      join(w.mini, "kleio-host/.deploy-in-progress"),
      "started=20261014T120000Z\ncode_changed=1\n",
    );
    const before = tree(w.mini);

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status).not.toBe(0);
    expect(r.out).toContain(
      "A deploy started at 20261014T120000Z changed the code but didn't finish.",
    );
    expect(r.out).toContain("Roll back with rollback-mini.sh, or deploy again with --force");
    expect(tree(w.mini)).toEqual(before);
    expect(w.calls().some((c) => c.startsWith("rsync"))).toBe(false);
  });

  it("keeps the mark and prints the rollback when the host isn't healthy after", () => {
    const w = world();
    w.health("down");

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Not healthy after 2 s on port 8443: no answer");
    // One try a second, at most HEALTH_WAIT of them.
    expect(w.calls().filter((c) => c.startsWith("curl"))).toHaveLength(2);
    expect(r.out).toContain(
      "To go back to the code that ran before:  sh packages/kleio-host/scripts/rollback-mini.sh",
    );
    expect(read(w, "kleio-host/.deploy-in-progress")).toContain("code_changed=1");
    expect(read(w, "kleio-host/.prev/dist/cli.js")).toBe("old cli\n");
    expect(read(w, "kleio-host/dist/cli.js")).toBe("new cli\n");
  });

  it("rolls back: .prev's code in place, the new code moved aside, the sidecar restarted first", () => {
    const w = world();
    w.health("down");
    expect(run(w, "deploy-mini.sh", "--no-build").status).not.toBe(0);
    const [stamp] = backups(w);
    const stateBefore = tree(join(w.mini, STATE));
    w.health("up");
    w.clearCalls();

    const r = run(w, "rollback-mini.sh");

    expect(r.status, r.out).toBe(0);
    expect(read(w, "kleio-host/dist/cli.js")).toBe("old cli\n");
    expect(read(w, "kleio-host/dist/old-only.js")).toBe("old only\n");
    expect(read(w, "kleio-host/sidecar/app-sidecar.mjs")).toBe("old sidecar\n");
    expect(read(w, "kleio-host/install-mini.sh")).toBe("# old installer\n");
    for (const l of LABELS) {
      expect(read(w, `Library/LaunchAgents/${l}.plist`)).toBe(plist(l, "old"));
    }
    const aside = readdirSync(join(w.mini, "kleio-host")).filter((d) =>
      d.startsWith(".rolled-back-"),
    );
    expect(aside).toHaveLength(1);
    const moved = join("kleio-host", aside[0] ?? "");
    expect(read(w, join(moved, "dist/cli.js"))).toBe("new cli\n");
    expect(read(w, join(moved, "sidecar/app-sidecar.mjs"))).toBe("new sidecar\n");
    expect(read(w, join(moved, "install-mini.sh"))).toContain("# new installer");
    expect(read(w, join(moved, "LaunchAgents/com.kleio.host.serve.plist"))).toBe(
      plist("com.kleio.host.serve", "new"),
    );
    // .prev is from before Kleio's link: kleio-link-host and its job go aside.
    expect(existsSync(join(w.mini, "kleio-host/bin"))).toBe(false);
    expect(read(w, join(moved, "bin/kleio-link-host"))).toBe("new link host\n");
    expect(existsSync(join(w.mini, `Library/LaunchAgents/${LINK}.plist`))).toBe(false);
    expect(read(w, join(moved, `LaunchAgents/${LINK}.plist`))).toBe(plist(LINK, "new"));
    expect(r.out).toContain(`${LINK}: stopped, as .prev is from before Kleio's link`);
    // .prev stays, so a rollback can run again.
    expect(read(w, "kleio-host/.prev/dist/cli.js")).toBe("old cli\n");
    const restarts = w
      .calls()
      .filter((c) => /^launchctl (bootout|bootstrap|kickstart)/.test(c))
      .map((c) =>
        c.replace(/gui\/\d+/, "gui/UID").replace(join(w.mini, "Library/LaunchAgents/"), ""),
      );
    expect(restarts).toEqual([
      // Stopped, and not started again.
      "launchctl bootout gui/UID/com.kleio.host.link",
      "launchctl bootout gui/UID/com.kleio.host.sidecar",
      "launchctl bootstrap gui/UID com.kleio.host.sidecar.plist",
      "launchctl kickstart -k gui/UID/com.kleio.host.sidecar",
      "launchctl bootout gui/UID/com.kleio.host.serve",
      "launchctl bootstrap gui/UID com.kleio.host.serve.plist",
      "launchctl kickstart -k gui/UID/com.kleio.host.serve",
    ]);
    expect(existsSync(join(w.mini, "kleio-host/.deploy-in-progress"))).toBe(false);
    expect(r.out).toContain(
      `The snapshot taken before the deploy: ${join(w.mini, "kleio-backups", stamp ?? "")}`,
    );
    expect(tree(join(w.mini, STATE))).toEqual(stateBefore);
  });

  it("refuses to roll back without a .prev, and changes nothing", () => {
    const w = world();
    const before = tree(w.mini);

    const r = run(w, "rollback-mini.sh");

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Nothing to roll back to:");
    expect(tree(w.mini)).toEqual(before);
    expect(w.calls().some((c) => c.startsWith("launchctl"))).toBe(false);
  });

  it("--dry-run prints every command and runs none", () => {
    const w = world();
    const before = tree(w.mini);

    const deploy = run(w, "deploy-mini.sh", "--dry-run");
    const rollback = run(w, "rollback-mini.sh", "--dry-run");

    expect(deploy.status, deploy.out).toBe(0);
    expect(rollback.status, rollback.out).toBe(0);
    // The bundle is made from the dist folders of @kleio/coder and the
    // workspace packages it uses, so those are built first, or an older
    // build would ship.
    // The capture helper comes after the host, whose build empties dist/.
    // kleio-link-host is built for the mini's Apple silicon.
    const builds = [
      "+ pnpm --filter @kleio/coder... build",
      "+ node gg-app/scripts/bundle-sidecar.mjs",
      "+ pnpm --filter @kleio/host build",
      "+ sh packages/kleio-host/scripts/build-capture.sh",
      "+ cargo build --release --locked --features host --bin kleio-link-host --target aarch64-apple-darwin --manifest-path packages/kleio-link/Cargo.toml",
    ].map((line) => deploy.out.indexOf(`\n${line}\n`));
    expect(builds, deploy.out).not.toContain(-1);
    expect([...builds].sort((a, b) => a - b)).toEqual(builds);
    for (const line of [
      "+ node gg-app/scripts/bundle-sidecar.mjs",
      "+ pnpm --filter @kleio/host build",
      "+ rsync -az --delete packages/kleio-host/dist/ mac-mini-1:kleio-host/dist/",
      "+ rsync -az packages/kleio-host/scripts/install-mini.sh mac-mini-1:kleio-host/",
      "+ rsync -az --delete gg-app/src-tauri/sidecar/ mac-mini-1:kleio-host/sidecar/",
      "+ ssh -o ConnectTimeout=15 mac-mini-1 mkdir -p kleio-host/bin",
      `+ rsync -az ${LINK_BUILT} mac-mini-1:kleio-host/bin/kleio-link-host`,
      "+ ssh -o ConnectTimeout=15 mac-mini-1 sh kleio-host/install-mini.sh",
    ]) {
      expect(deploy.out).toContain(line);
    }
    expect(deploy.out.split("<<'REMOTE'").length - 1).toBe(4);
    expect(rollback.out).toContain("+ ssh -o ConnectTimeout=15 mac-mini-1 sh -s <<'REMOTE'");
    // HEALTH_WAIT reaches the scripts run on the mini; 60 when unset or empty.
    expect(deploy.out.split("\nWAIT=2\n").length - 1).toBe(4);
    expect(rollback.out).toContain("\nWAIT=2\n");
    const unset: Record<string, string>[] = [{}, { HEALTH_WAIT: "" }];
    for (const env of unset) {
      expect(runWith(w, env, "deploy-mini.sh", "--dry-run").out).toContain("\nWAIT=60\n");
      expect(runWith(w, env, "rollback-mini.sh", "--dry-run").out).toContain("\nWAIT=60\n");
    }
    expect(w.calls()).toEqual([]);
    expect(tree(w.mini)).toEqual(before);
  });

  it.each(["0", "060", "601", "1.5", "-1", "60s"])(
    "refuses HEALTH_WAIT=%j before doing anything",
    (wait) => {
      const w = world();
      const before = tree(w.mini);

      const deploy = runWith(w, { HEALTH_WAIT: wait }, "deploy-mini.sh", "--no-build");
      const rollback = runWith(w, { HEALTH_WAIT: wait }, "rollback-mini.sh");

      for (const r of [deploy, rollback]) {
        expect(r.status).toBe(2);
        expect(r.out).toContain("HEALTH_WAIT must be a whole number of seconds from 1 to 600");
      }
      expect(w.calls()).toEqual([]);
      expect(tree(w.mini)).toEqual(before);
    },
  );

  it("with --force over an unfinished deploy, keeps the .prev from before it", async () => {
    const w = world();
    w.health("down");
    expect(run(w, "deploy-mini.sh", "--no-build").status).not.toBe(0);
    write(join(w.repo, "packages/kleio-host/dist/cli.js"), "newer cli\n");
    w.health("up");
    await nextSecond();

    const refused = run(w, "deploy-mini.sh", "--no-build");
    const forced = run(w, "deploy-mini.sh", "--no-build", "--force");

    expect(refused.status).not.toBe(0);
    expect(forced.status, forced.out).toBe(0);
    expect(forced.out).toContain(".prev: kept as it was");
    expect(read(w, "kleio-host/.prev/dist/cli.js")).toBe("old cli\n");
    expect(read(w, "kleio-host/dist/cli.js")).toBe("newer cli\n");
    expect(backups(w)).toHaveLength(2);
    expect(existsSync(join(w.mini, "kleio-host/.deploy-in-progress"))).toBe(false);
  });

  it("a later deploy moves the older .prev aside instead of deleting it", async () => {
    const w = world();
    expect(run(w, "deploy-mini.sh", "--no-build").status).toBe(0);
    const [first] = backups(w);
    write(join(w.repo, "packages/kleio-host/dist/cli.js"), "newer cli\n");
    await nextSecond();

    const r = run(w, "deploy-mini.sh", "--no-build");

    expect(r.status, r.out).toBe(0);
    expect(read(w, "kleio-host/.prev/dist/cli.js")).toBe("new cli\n");
    expect(read(w, `kleio-host/.prev-${first}/dist/cli.js`)).toBe("old cli\n");
    expect(read(w, "kleio-host/dist/cli.js")).toBe("newer cli\n");
    expect(r.out).toContain(`.prev-${first}`);
  });

  it("keeps kleio-link-host in .prev once there, and a rollback restarts .prev's after serve", async () => {
    const w = world();
    expect(run(w, "deploy-mini.sh", "--no-build").status).toBe(0);
    write(join(w.repo, LINK_BUILT), "newer link host\n", 0o755);
    await nextSecond();
    const second = run(w, "deploy-mini.sh", "--no-build");
    expect(second.status, second.out).toBe(0);
    expect(second.out).toContain(
      ".prev: the code that runs now (dist, sidecar, bin, install-mini.sh, launchd plists)",
    );
    expect(read(w, "kleio-host/.prev/bin/kleio-link-host")).toBe("new link host\n");
    expect(read(w, `kleio-host/.prev/LaunchAgents/${LINK}.plist`)).toBe(plist(LINK, "new"));
    expect(read(w, "kleio-host/bin/kleio-link-host")).toBe("newer link host\n");
    w.clearCalls();

    const r = run(w, "rollback-mini.sh");

    expect(r.status, r.out).toBe(0);
    expect(read(w, "kleio-host/bin/kleio-link-host")).toBe("new link host\n");
    const aside = readdirSync(join(w.mini, "kleio-host")).filter((d) =>
      d.startsWith(".rolled-back-"),
    );
    expect(read(w, join("kleio-host", aside[0] ?? "", "bin/kleio-link-host"))).toBe(
      "newer link host\n",
    );
    expect(read(w, `Library/LaunchAgents/${LINK}.plist`)).toBe(plist(LINK, "new"));
    const started = w
      .calls()
      .filter((c) => c.startsWith("launchctl bootstrap"))
      .map((c) => c.replace(/^.*\/([^/]+)\.plist$/, "$1"));
    expect(started).toEqual([...JOBS]);
    expect(r.out).toMatch(/\nlink: up \(pid \d+\), on https:\/\/relay\.example\/\n/);
  });

  it("keeps the mark when the kleio-link-host it rolled back to doesn't come up", async () => {
    const w = world();
    expect(run(w, "deploy-mini.sh", "--no-build").status).toBe(0);
    await nextSecond();
    w.health("down");
    expect(run(w, "deploy-mini.sh", "--no-build").status).not.toBe(0);
    w.health("up");
    w.link("down");

    const r = run(w, "rollback-mini.sh");

    expect(r.status).not.toBe(0);
    // The state the last kleio-link-host left doesn't count for this one.
    expect(r.out).toMatch(
      /2 s after the rollback, kleio-link-host is running \(pid \d+\), but hasn't written its state yet\./,
    );
    expect(r.out).toContain("The in-progress mark stays.");
    expect(existsSync(join(w.mini, "kleio-host/.deploy-in-progress"))).toBe(true);
  });

  // Root reads anything, so the copy can't be made to fail that way.
  it.skipIf(process.getuid?.() === 0)(
    "stops before any code changes when the snapshot can't be made, and clears its mark",
    () => {
      const w = world();
      // A folder in ~/.gg that can't be read: the copy fails.
      const locked = join(w.mini, ".gg/locked");
      mkdirSync(locked);
      writeFileSync(join(locked, "x"), "x");
      chmodSync(locked, 0o000);
      try {
        const r = run(w, "deploy-mini.sh", "--no-build");

        expect(r.status).not.toBe(0);
        expect(r.out).toContain("Stopped before any code changed");
        expect(r.out).toContain(".partial");
        expect(read(w, "kleio-host/dist/cli.js")).toBe("old cli\n");
        expect(existsSync(join(w.mini, "kleio-host/.deploy-in-progress"))).toBe(false);
        expect(w.calls().some((c) => c.startsWith("rsync"))).toBe(false);
      } finally {
        chmodSync(locked, 0o700);
        for (const b of backups(w)) {
          const copy = join(w.mini, "kleio-backups", b, "gg/locked");
          if (existsSync(copy)) chmodSync(copy, 0o700);
        }
      }
    },
  );
});
