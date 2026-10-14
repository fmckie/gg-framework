/**
 * dev-host: a Kleio host on this machine, for developing the desktop app
 * against. Sandboxed, loopback HTTP only.
 *
 * It runs the real host from this checkout (packages/kleio-host/dist/cli.js:
 * `init`, then `sidecar`, then `serve`) with the bundled sidecar
 * (gg-app/src-tauri/sidecar/app-sidecar.mjs on the staged node). Then it:
 *   - pairs an ordinary (non-admin) device for the desktop app;
 *   - mints an admin pairing code to redeem with curl;
 *   - prints the line that starts the app against the host.
 *
 * With --app (macOS) it opens the desktop app itself instead, as a new user,
 * for its real first run. It builds the debug app (cargo build), uses
 * gg-app's Vite on http://localhost:1420 or starts it, starts the host, mints
 * one admin pairing code and launches the app. You pair through the app's own
 * form, and Restart now relaunches it as the same new user. Debug builds
 * accept the dev host's http://127.0.0.1:<port> (host_url_allowed in
 * gg-app/src-tauri/src/kleio/mod.rs).
 *
 * Isolation (kleio-sandbox.mjs): one sandbox folder holds everything the
 * children write: HOME, the host's state folder, the Kleio and projects
 * folders, the settings file and the sidecar's working folder. This shell's
 * KLEIO_*, GG_* and NODE_OPTIONS don't reach them. With --app, the app's
 * HOME and CFFIXED_USER_HOME are <sandbox>/home as well: its ~/.kleio,
 * Library folders and webview storage are there. So is its Keychain: macOS
 * takes the search list and default keychain from HOME, and dev-host makes
 * a throwaway keychain the only one that home has. After every change to
 * that keychain it rereads the real search list and default keychain. If
 * either differs, it puts both back at once and stops.
 *
 * It refuses to run when any of those paths is the real home or inside it,
 * or touches the real ~/.gg, ~/.kleio or host state folder. The host and its
 * preview origin listen on 127.0.0.1 only: no Tailscale, no TLS. At exit it
 * reports any change to the real ~/.kleio and host state folder. With --app
 * it also reports changes to the real Keychain: the search list, default
 * keychain, login keychain, and the app's items (attributes only).
 *
 * Usage (packages/kleio-host/README.md, "Develop against a local host"):
 *   pnpm --filter "@kleio/coder..." build && pnpm --filter @kleio/host build
 *   pnpm --filter gg-app stage:node && pnpm --filter gg-app bundle:sidecar
 *   node gg-app/scripts/dev-host.mjs [--dir <path>] [--keep]
 *   node gg-app/scripts/dev-host.mjs --app [--keep]
 *
 *   --dir <path>  use this sandbox folder and keep it, so pairings and chats
 *                 survive a restart (created if missing)
 *   --keep        keep the fresh sandbox folder at exit
 *   --app         open the desktop app as a new user against the host (macOS;
 *                 not with --dir: a first run needs a fresh sandbox)
 *
 * Ctrl-C (or SIGTERM) stops the app and the Vite this started (with --app),
 * then the host and sidecar, and removes the sandbox.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  appEnv,
  appEnvProblems,
  canonicalPath,
  fingerprint,
  fingerprintChanges,
  freePorts,
  keychainPathProblems,
  sandboxEnv,
  sandboxProblems,
} from "./kleio-sandbox.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const CLI = join(repo, "packages/kleio-host/dist/cli.js");
const SIDECAR_BUNDLE = join(repo, "gg-app/src-tauri/sidecar/app-sidecar.mjs");
const BIN_DIR = join(repo, "gg-app/src-tauri/binaries");
const TOKEN_HEADER = "x-kleio-device-token";
const APP_LABEL = "gg-app (dev-host)";
const APP_DIR = join(repo, "gg-app");
const CARGO_TOML = join(APP_DIR, "src-tauri/Cargo.toml");
/** What a debug build loads (tauri.conf.json, build.devUrl). */
const VITE_URL = "http://localhost:1420/";
const SECURITY = "/usr/bin/security";
/** gg-app/src-tauri/src/kleio/keychain.rs: one generic password per secret and host. */
export const KEYCHAIN_SERVICE = "com.kleio.gg-app";
/** The app's Keychain accounts for a dev host: its nodeId is 127.0.0.1. */
export const LOOPBACK_ACCOUNTS = Object.freeze([
  "control-credential:127.0.0.1",
  "device-token:127.0.0.1",
]);
/** The sandbox's own keychain, in <sandbox>/home/Library/Keychains. */
const SANDBOX_KEYCHAIN = "kleio-dev-host.keychain-db";

/** stage-node.mjs names the binary after the Rust host triple. */
const NODE_TRIPLES = Object.freeze({
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
});

const USAGE = `usage: node gg-app/scripts/dev-host.mjs [--dir <path>] [--keep]
       node gg-app/scripts/dev-host.mjs --app [--keep]

  --dir <path>  use this sandbox folder and keep it, so pairings and chats
                survive a restart (created if missing)
  --keep        keep the fresh sandbox folder at exit
  --app         open the desktop app as a new user against the host (macOS;
                not with --dir: a first run needs a fresh sandbox)`;

/**
 * The line that starts the desktop app against the dev host: the env
 * override in gg-app's kleio/mod.rs (`from_env`), which takes a loopback URL
 * and never reads or writes ~/.kleio/remote.json. Throws on a URL that isn't
 * loopback HTTP or a token that isn't the host's URL-safe kind, so nothing
 * printed here ever needs shell quoting.
 */
export function launchLine({ url, token, shell = "posix" }) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(url)) {
    throw new Error(`not a loopback host URL: ${url}`);
  }
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
    throw new Error("the device token is not 32 or more URL-safe characters");
  }
  if (shell === "powershell") {
    return `$env:KLEIO_HOST_URL="${url}"; $env:KLEIO_DEVICE_TOKEN="${token}"; pnpm --filter gg-app tauri dev`;
  }
  return `KLEIO_HOST_URL=${url} KLEIO_DEVICE_TOKEN=${token} pnpm --filter gg-app tauri dev`;
}

export function parseArgs(argv) {
  const options = { dir: null, keep: false, app: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--keep") options.keep = true;
    else if (arg === "--app") options.app = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dir" && next && !next.startsWith("--")) {
      options.dir = next;
      i += 1;
    } else if (arg.startsWith("--dir=") && arg.length > "--dir=".length) {
      options.dir = arg.slice("--dir=".length);
    } else return { error: `unknown or incomplete option: ${arg}` };
  }
  if (options.app && options.dir) {
    return { error: "--app needs a fresh sandbox: use it without --dir" };
  }
  return { options };
}

/**
 * True when `line`, from `ps -A -E -ww -o pid=,command=`, is `binary` running
 * with exactly HOME=<home>. macOS prints a process's environment after its
 * arguments, separated by spaces, so this matches whole tokens: HOME=<home>2
 * and HOME=<home>/x don't count, and nor does a binary whose path only
 * starts with `binary`.
 */
export function psLineHasHome(line, { binary, home }) {
  const command = /^\s*\d+\s+(.*)$/.exec(line)?.[1];
  if (!command || (command !== binary && !command.startsWith(`${binary} `))) return false;
  return command.slice(binary.length).split(" ").includes(`HOME=${home}`);
}

/**
 * Why --app can't run here, or [] when it can. `tools` maps each command it
 * runs (cargo, pnpm) to whether it is on PATH.
 */
export function appModeProblems({ platform, sandbox, tools }) {
  const problems = [];
  if (platform !== "darwin") {
    problems.push("--app runs on macOS only: the app keeps its pairing in the macOS Keychain");
  }
  for (const [tool, found] of Object.entries(tools).sort(([a], [b]) => a.localeCompare(b))) {
    if (!found) problems.push(`--app needs ${tool} on PATH`);
  }
  if (/\s/.test(sandbox)) {
    problems.push(
      `the sandbox ${sandbox} has whitespace in its path: --app finds the app's processes by their HOME`,
    );
  }
  return problems;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const say = (msg) => console.log(msg);
const shown = (p) => {
  const rel = relative(process.cwd(), p);
  return rel && !rel.startsWith("..") ? rel : p;
};

function stagedNode() {
  const triple = NODE_TRIPLES[`${process.platform}-${process.arch}`];
  const names = existsSync(BIN_DIR) ? readdirSync(BIN_DIR) : [];
  const found = names.find(
    (f) => triple && (f === `ggnode-${triple}` || f === `ggnode-${triple}.exe`),
  );
  return found ? join(BIN_DIR, found) : null;
}

/** The real homes to protect: $HOME's and the account's, when they differ. */
function realHomes() {
  const homes = [homedir()];
  try {
    homes.push(userInfo().homedir);
  } catch {
    // No account record (some containers): $HOME is all there is.
  }
  return [...new Set(homes.filter(Boolean).map((h) => canonicalPath(h)))];
}

/** A call to the dev host. JSON in and out; a 15 s limit. */
async function api(base, method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { [TOKEN_HEADER]: token } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

/** A pair offer, minted with the host's own admin token (as `kleio-host pair` does). */
async function offer(base, adminToken, admin) {
  const r = await api(base, "POST", "/kleio/pair/offer", { token: adminToken, body: { admin } });
  if (r.status !== 200 || typeof r.body?.code !== "string") {
    throw new Error(`minting a pair code failed: ${r.status}`);
  }
  return r.body;
}

/**
 * The desktop app's device: the one in app.env when the host still knows it
 * (a reused --dir), else a new ordinary device paired over loopback.
 */
async function appDevice(base, adminToken, appEnvFile) {
  let saved = null;
  try {
    saved = readFileSync(appEnvFile, "utf8").match(/^KLEIO_DEVICE_TOKEN=([A-Za-z0-9_-]{32,})$/m);
  } catch {
    saved = null;
  }
  if (saved) {
    const check = await api(base, "GET", "/kleio/setup", { token: saved[1] });
    if (check.status === 200 && check.body?.admin === false)
      return { token: saved[1], reused: true };
  }
  const { code } = await offer(base, adminToken, false);
  const r = await api(base, "POST", "/kleio/pair/redeem", {
    body: { code, redemptionNonce: randomBytes(16).toString("hex"), label: APP_LABEL },
  });
  const payload = r.body?.payload;
  if (r.status !== 200 || r.body?.ok !== true || typeof payload?.token !== "string") {
    throw new Error(`pairing the app's device failed: ${r.status}`);
  }
  if (payload.controlCredential !== undefined) {
    throw new Error("the app's device came back as an admin device");
  }
  return { token: payload.token, reused: false };
}

/** Writes the app's URL and token to `file` (0600), whole or not at all. */
function writeAppEnv(file, url, token) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(
    tmp,
    `# Written by gg-app/scripts/dev-host.mjs: the dev host and the desktop app's device token.\n` +
      `KLEIO_HOST_URL=${url}\nKLEIO_DEVICE_TOKEN=${token}\n`,
    { mode: 0o600 },
  );
  renameSync(tmp, file);
}

/** The last lines of a log file, for an error message. */
function tail(file, lines = 20) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

/** A process's command line, or "" when it can't be read (gone, or not ours). */
function commandLine(pid) {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`,
        ],
        { encoding: "utf8", timeout: 10_000 },
      ).trim();
    }
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
  } catch {
    return "";
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/** The sidecar pid the supervisor last published, if any. */
function publishedSidecarPid(hostHome) {
  try {
    const pid = JSON.parse(readFileSync(join(hostHome, "sidecar.json"), "utf8")).pid;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * One kleio-host command, kept running the way launchd keeps the mini's two
 * jobs running (install-mini.sh: KeepAlive). When it exits it starts again a
 * second later, unless it is being stopped. After five exits in a minute it
 * stops trying and `onGiveUp` runs. Output goes to `logFile`, and each line
 * goes to the `onLine` listeners.
 *
 * On macOS and Linux it runs in a process group of its own, so a Ctrl-C in
 * the terminal reaches only dev-host, which then stops the jobs in order.
 */
function startJob({ name, args, env, logFile, onGiveUp }) {
  const log = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  const listeners = new Set();
  const exits = [];
  const job = {
    name,
    logFile,
    child: null,
    stopping: false,
    onLine: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop() {
      job.stopping = true;
      job.child?.kill("SIGTERM");
    },
    kill() {
      job.stopping = true;
      job.child?.kill("SIGKILL");
    },
    closeLog: () => new Promise((done) => log.end(done)),
  };
  const splitter = () => {
    let carry = "";
    return (chunk) => {
      log.write(chunk);
      const parts = (carry + chunk).split("\n");
      carry = parts.pop() ?? "";
      for (const line of parts) for (const fn of listeners) fn(line.replace(/\r$/, ""));
    };
  };
  const launch = () => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: env.HOME,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Windows would open a console window for a detached child.
      detached: process.platform !== "win32",
    });
    job.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", splitter());
    child.stderr.on("data", splitter());
    child.on("error", (e) => log.write(`[dev-host] could not start ${name}: ${e.message}\n`));
    child.on("exit", (code, signal) => {
      log.write(`[dev-host] ${name} exited (code ${code}, signal ${signal})\n`);
      if (job.child === child) job.child = null;
      if (job.stopping) return;
      const now = Date.now();
      exits.push(now);
      while (exits.length > 0 && now - (exits[0] ?? now) > 60_000) exits.shift();
      if (exits.length >= 5) {
        onGiveUp(job);
        return;
      }
      say(`! kleio-host ${name} exited (code ${code}, signal ${signal}); starting it again`);
      setTimeout(() => {
        if (!job.stopping) launch();
      }, 1_000);
    });
  };
  launch();
  return job;
}

/** Resolves on the first line from `job` that matches `pattern`. */
function waitForLine(job, pattern, ms, what) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      off();
      fail(new Error(`${what}: timed out after ${ms / 1000} s\n${tail(job.logFile)}`));
    }, ms);
    const off = job.onLine((line) => {
      if (!pattern.test(line)) return;
      clearTimeout(timer);
      off();
      done(line);
    });
  });
}

/** True when `name` is an executable file in a folder on PATH. */
function onPath(name) {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    if (!dir) return false;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** True when something is at `path`, a dangling symlink included. */
function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the debug app with this shell's environment (cargo needs ~/.cargo
 * and ~/.rustup). Resolves to the real path of the binary cargo reports: the
 * path the app relaunches itself from (Tauri canonicalizes it). Diagnostics
 * go to `logFile`.
 */
function buildDebugApp(logFile) {
  return new Promise((done, fail) => {
    const log = openSync(logFile, "a", 0o600);
    let child;
    try {
      child = spawn(
        "cargo",
        ["build", "--manifest-path", CARGO_TOML, "--message-format=json-render-diagnostics"],
        { cwd: repo, env: process.env, stdio: ["ignore", "pipe", log] },
      );
    } finally {
      closeSync(log);
    }
    let executable = null;
    let carry = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const lines = (carry + chunk).split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        let message = null;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          message?.reason === "compiler-artifact" &&
          message.target?.name === "gg-app" &&
          message.target.kind?.includes("bin") &&
          typeof message.executable === "string"
        ) {
          executable = message.executable;
        }
      }
    });
    child.on("error", (e) => fail(new Error(`cargo build didn't start: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) fail(new Error(`cargo build failed (exit ${code})\n${tail(logFile, 30)}`));
      else if (!executable) fail(new Error("cargo build didn't report the gg-app binary"));
      else done(realpathSync.native(executable));
    });
  });
}

/** What answers on VITE_URL: its status and page, or null when nothing does. */
async function devServerPage() {
  try {
    const res = await fetch(VITE_URL, { signal: AbortSignal.timeout(3_000) });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

/** True when `page` is gg-app's index.html as its Vite dev server serves it. */
function isAppVitePage(page) {
  return (
    page?.status === 200 &&
    page.text.includes("/@vite/client") &&
    page.text.includes('id="app-style-nonce"') &&
    page.text.includes('src="/src/main.tsx"')
  );
}

/**
 * Starts gg-app's Vite (`pnpm dev`) in a process group of its own and waits up
 * to 60 s for its page. `started` gets the child first, so that a failure
 * here still stops it.
 */
async function startVite(logFile, started) {
  const log = openSync(logFile, "a", 0o600);
  let child;
  try {
    child = spawn("pnpm", ["dev"], {
      cwd: APP_DIR,
      env: process.env,
      stdio: ["ignore", log, log],
      detached: true,
    });
  } finally {
    closeSync(log);
  }
  started(child);
  let ended = null;
  child.on("exit", (code, signal) => {
    ended ??= `exited (code ${code}, signal ${signal})`;
  });
  child.on("error", (e) => {
    ended ??= `didn't start: ${e.message}`;
  });
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (ended) throw new Error(`pnpm dev ${ended} before gg-app's page answered\n${tail(logFile)}`);
    if (isAppVitePage(await devServerPage())) return;
    await sleep(500);
  }
  throw new Error(`gg-app's page didn't answer on ${VITE_URL} within 60 s\n${tail(logFile)}`);
}

/** Stops a process group this script started: SIGTERM, then SIGKILL after `ms`. */
async function stopGroup(child, ms) {
  if (!child.pid) return;
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {
      // The whole group has exited.
    }
  };
  signal("SIGTERM");
  const until = Date.now() + ms;
  while (child.exitCode === null && child.signalCode === null && Date.now() < until) {
    await sleep(100);
  }
  signal("SIGKILL");
}

/** Starts the app detached, with `env`, in its home; its output goes to `logFile`. */
function launchApp({ binary, env, logFile }) {
  const log = openSync(logFile, "a", 0o600);
  try {
    return spawn(binary, [], { cwd: env.HOME, env, stdio: ["ignore", log, log], detached: true });
  } finally {
    closeSync(log);
  }
}

/** The pids of `match.binary` running with HOME=`match.home` (psLineHasHome), sorted. */
function findAppPids(match) {
  let out = "";
  try {
    out = execFileSync("ps", ["-A", "-E", "-ww", "-o", "pid=,command="], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .filter((line) => psLineHasHome(line, match))
    .map((line) => Number.parseInt(line, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .sort((a, b) => a - b);
}

/** True while `pid` is still `match.binary` with HOME=`match.home`. */
function isApp(pid, match) {
  try {
    const out = execFileSync("ps", ["-E", "-ww", "-o", "pid=,command=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return psLineHasHome(out.split("\n")[0] ?? "", match);
  } catch {
    return false;
  }
}

/**
 * Stops the app's processes (Restart now replaces the first one): SIGTERM,
 * then SIGKILL after 8 s. Each pid is checked to still be the app, with the
 * sandbox's HOME, right before each signal. Resolves to the pids it stopped
 * and any still running after that.
 */
async function stopApps(match) {
  const signal = (pids, name) => {
    for (const pid of pids) {
      if (!isApp(pid, match)) continue;
      try {
        process.kill(pid, name);
      } catch {
        // Gone in the meantime.
      }
    }
  };
  const stopped = findAppPids(match);
  let left = stopped;
  if (left.length === 0) return { stopped, left };
  signal(left, "SIGTERM");
  for (const [ms, next] of [
    [8_000, "SIGKILL"],
    [3_000, null],
  ]) {
    const until = Date.now() + ms;
    while (left.length > 0 && Date.now() < until) {
      await sleep(200);
      left = findAppPids(match);
    }
    if (left.length === 0 || !next) break;
    say(`! the app (pid ${left.join(", ")}) didn't stop in 8 s; killing it`);
    signal(left, next);
  }
  return { stopped, left };
}

/**
 * A `security` call timed out (a Keychain dialog may be waiting), or the real
 * Keychain changed. Once this is thrown, the run makes no more keychain
 * changes and keeps the sandbox.
 */
class KeychainStop extends Error {}

/**
 * One `security` call: an argument array, a 20 s limit, and never -g or -w,
 * so no secret is read. Errors name the subcommand only, since some calls
 * carry the sandbox keychain's password.
 */
function security(args, env) {
  const r = spawnSync(SECURITY, args, {
    env,
    encoding: "utf8",
    timeout: 20_000,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error?.code === "ETIMEDOUT") {
    throw new KeychainStop(
      `security ${args[0]} didn't finish in 20 s: a Keychain dialog may be waiting (cancel it)`,
    );
  }
  if (r.error) throw new Error(`security ${args[0]} didn't run: ${r.error.code ?? "error"}`);
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const sameResult = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The keychain paths `security list-keychains` or `default-keychain` printed. */
function keychainPaths(out) {
  return out
    .split("\n")
    .map((line) => /^\s*"(.+)"\s*$/.exec(line)?.[1])
    .filter((path) => path !== undefined);
}

/** This shell's environment with HOME pinned to `home`, and no CFFIXED_USER_HOME. */
function homeEnv(home) {
  const env = { ...process.env, HOME: home };
  delete env.CFFIXED_USER_HOME;
  return env;
}

/** The app's accounts for the host `<home>/.kleio/remote.json` names, if any. */
function pairedAccounts(home) {
  try {
    const { host } = JSON.parse(readFileSync(join(home, ".kleio", "remote.json"), "utf8"));
    if (typeof host === "string" && /^[A-Za-z0-9.-]+$/.test(host)) {
      return [`control-credential:${host}`, `device-token:${host}`];
    }
  } catch {
    // Not paired, or unreadable: the loopback accounts are still checked.
  }
  return [];
}

/**
 * The real Keychain, read with HOME=`home`: the search list, the default
 * keychain, the login keychain, and the attributes of the app's items for
 * `accounts` (find-generic-password without -g or -w: no secret is read).
 */
function keychainState(home, accounts) {
  const env = homeEnv(home);
  return {
    "search list": security(["list-keychains", "-d", "user"], env),
    "default keychain": security(["default-keychain", "-d", "user"], env),
    "login keychain": security(["login-keychain"], env),
    ...Object.fromEntries(
      accounts.map((account) => [
        `item ${account}`,
        security(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account], env),
      ]),
    ),
  };
}

/** Throws unless `keychain` may go to `security` as the sandbox's (keychainPathProblems). */
function checkSandboxKeychain(keychain, { home, realHomes, creates }) {
  if (creates && present(keychain)) {
    throw new Error(`refusing to create a keychain over ${keychain}: something is there`);
  }
  if (!creates && !present(keychain)) throw new Error(`the sandbox keychain ${keychain} is gone`);
  const problems = [
    ...new Set(
      realHomes.flatMap((realHome) =>
        keychainPathProblems({ path: keychain, sandboxHome: home, realHome }),
      ),
    ),
  ];
  if (problems.length > 0) throw new Error(`refusing to use ${problems.join("; ")}`);
}

/**
 * Makes `keychain` the only keychain of the app's home, and its default, so
 * the app's items land there and nowhere else. Every command runs with the
 * app's environment (HOME = CFFIXED_USER_HOME = the sandbox home), and the
 * path is checked with realpath before each one. `afterWrite` checks the
 * real Keychain after each one. The password is random, kept in memory and
 * never shown. The keychain stays unlocked (no timeout, no lock on sleep),
 * so it never asks for it.
 */
function createSandboxKeychain({ keychain, env, realHomes, afterWrite }) {
  const home = env.HOME;
  mkdirSync(dirname(keychain), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, "Library", "Preferences"), { recursive: true, mode: 0o700 });
  const password = randomBytes(24).toString("hex");
  const hidden = (text) => text.split(password).join("<password>").trim();
  for (const [args, creates] of [
    [["create-keychain", "-p", password, keychain], true],
    [["unlock-keychain", "-p", password, keychain], false],
    [["set-keychain-settings", keychain], false],
    [["default-keychain", "-d", "user", "-s", keychain], false],
    [["list-keychains", "-d", "user", "-s", keychain], false],
  ]) {
    checkSandboxKeychain(keychain, { home, realHomes, creates });
    const r = security(args, env);
    afterWrite(args[0]);
    if (r.status !== 0) {
      throw new Error(`security ${args[0]} failed (exit ${r.status}): ${hidden(r.err)}`);
    }
  }
  for (const args of [
    ["list-keychains", "-d", "user"],
    ["default-keychain", "-d", "user"],
  ]) {
    const r = security(args, env);
    if (r.status !== 0 || !sameResult(keychainPaths(r.out), [keychain])) {
      throw new Error(
        `the app's home doesn't name only its own keychain: ${args[0]} gave ${r.out}`,
      );
    }
  }
  const info = security(["show-keychain-info", keychain], env);
  const settings = `${info.out}${info.err}`;
  if (info.status !== 0 || !/no-timeout/.test(settings) || /lock-on-sleep/.test(settings)) {
    throw new Error(`the sandbox keychain would lock itself: ${settings.trim()}`);
  }
}

/** Which LOOPBACK_ACCOUNTS items the app's keychain holds (attributes only). */
function sandboxItems(env) {
  return LOOPBACK_ACCOUNTS.filter(
    (account) =>
      security(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account], env).status === 0,
  );
}

/** Deletes the sandbox's keychain, checked like its creation. False when it isn't there. */
function deleteSandboxKeychain(keychain, { env, realHomes, afterWrite }) {
  if (!present(keychain)) return false;
  checkSandboxKeychain(keychain, { home: env.HOME, realHomes, creates: false });
  const r = security(["delete-keychain", keychain], env);
  afterWrite("delete-keychain");
  if (r.status !== 0) {
    throw new Error(`security delete-keychain failed (exit ${r.status}): ${r.err.trim()}`);
  }
  return true;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error || parsed.options.help) {
    (parsed.error ? console.error : console.log)(`${parsed.error ?? ""}\n${USAGE}`.trim());
    process.exit(parsed.error ? 2 : 0);
  }
  const { dir, keep, app: appMode } = parsed.options;

  for (const [file, how] of [
    [CLI, "pnpm --filter @kleio/host build"],
    [
      SIDECAR_BUNDLE,
      'pnpm --filter "@kleio/coder..." build && pnpm --filter gg-app bundle:sidecar',
    ],
  ]) {
    if (!existsSync(file)) {
      console.error(`missing ${shown(file)}: run ${how}`);
      process.exit(1);
    }
  }
  const nodeBin = stagedNode();
  if (!nodeBin) {
    console.error(`no staged node in ${shown(BIN_DIR)}: run pnpm --filter gg-app stage:node`);
    process.exit(1);
  }

  // The real folders this must never touch, as they are now.
  const homes = realHomes();
  const watched = homes.flatMap((home) => [
    { label: "~/.kleio", dir: join(home, ".kleio"), critical: (p) => p === "remote.json" },
    {
      label: "host state folder",
      dir: join(home, "Library", "Application Support", "Kleio", "host"),
      critical: () => true,
    },
  ]);
  for (const w of watched) w.before = fingerprint(w.dir);

  // The sandbox. Checked before anything is written into it.
  const fresh = !dir;
  const sandbox = canonicalPath(fresh ? mkdtempSync(join(tmpdir(), "kleio-dev-host-")) : dir);
  const ports = await freePorts();
  const env = sandboxEnv({
    sandbox,
    baseEnv: process.env,
    apiPort: ports.api,
    previewPort: ports.preview,
    sidecarPath: SIDECAR_BUNDLE,
    nodeBin,
  });
  // --app: the desktop app's environment, its home the sandbox's, checked with the rest.
  const desktopEnv = appMode ? appEnv({ sandbox, baseEnv: process.env }) : null;
  const problems = [
    ...new Set([
      ...(appMode
        ? appModeProblems({
            platform: process.platform,
            sandbox,
            tools: { cargo: onPath("cargo"), pnpm: onPath("pnpm") },
          })
        : []),
      ...homes.flatMap((realHome) => [
        ...sandboxProblems({ sandbox, env, realHome }),
        ...(desktopEnv ? appEnvProblems({ sandbox, env: desktopEnv, realHome }) : []),
      ]),
    ]),
  ];
  if (problems.length > 0) {
    if (fresh) rmdirSync(sandbox); // the empty folder mkdtemp just made
    for (const p of problems) console.error(`refusing to run: ${p}`);
    if (!appMode) console.error("Pass --dir with a folder outside your home folder.");
    process.exit(2);
  }

  // --app: the real Keychain as it is now, read only.
  let keychainWatch = [];
  if (appMode) {
    try {
      keychainWatch = homes.map((home) => {
        const accounts = [...new Set([...LOOPBACK_ACCOUNTS, ...pairedAccounts(home)])].sort();
        return { home, accounts, before: keychainState(home, accounts) };
      });
    } catch (e) {
      if (fresh) rmdirSync(sandbox);
      console.error(`✗ reading the real Keychain: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }

  mkdirSync(sandbox, { recursive: true, mode: 0o700 });
  const logsDir = join(sandbox, "logs");
  for (const d of [env.HOME, logsDir, env.KLEIO_SIDECAR_CWD]) mkdirSync(d, { recursive: true });
  const logs = {
    init: join(logsDir, "init.log"),
    sidecar: join(logsDir, "sidecar.log"),
    serve: join(logsDir, "serve.log"),
    sidecarOwn: join(env.HOME, ".gg", "gg-app-sidecar.log"),
    build: join(logsDir, "build.log"),
    vite: join(logsDir, "vite.log"),
    app: join(logsDir, "app.log"),
  };
  const appEnvFile = join(sandbox, "app.env");
  const base = env.KLEIO_PUBLIC_URL;

  const jobs = [];
  const sidecarPids = new Set();
  let stopping = null;
  /**
   * --app: the binary, how to find its processes (Restart now replaces the
   * first), that first process, Vite if this run started it, and the
   * sandbox's keychain. `keychainStopped` is set by a KeychainStop. From then
   * on no keychain is changed and the sandbox is kept.
   */
  const desktop = desktopEnv
    ? {
        env: desktopEnv,
        binary: null,
        match: null,
        child: null,
        watcher: null,
        vite: null,
        keychain: join(desktopEnv.HOME, "Library", "Keychains", SANDBOX_KEYCHAIN),
        keychainStopped: false,
      }
    : null;

  /** Stops the jobs: SIGTERM, 8 s, then SIGKILL, and the sidecar if it outlived them. */
  const stopJobs = async () => {
    for (const job of jobs) job.stop();
    const until = Date.now() + 8_000;
    while (jobs.some((job) => job.child) && Date.now() < until) await sleep(100);
    for (const job of jobs) {
      if (job.child) {
        say(`! kleio-host ${job.name} didn't stop in 8 s; killing it`);
        job.kill();
      }
    }
    // The sidecar can outlive its supervisor (a hard kill, or Windows).
    const published = publishedSidecarPid(env.KLEIO_HOST_HOME);
    if (published) sidecarPids.add(published);
    for (const pid of [...sidecarPids].sort((a, b) => a - b)) {
      if (!alive(pid)) continue;
      if (commandLine(pid).includes(SIDECAR_BUNDLE)) {
        say(`! the sidecar (pid ${pid}) outlived its supervisor; killing it`);
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Gone in the meantime.
        }
      } else {
        say(`! pid ${pid} was the sidecar's; it is something else now, so it was left alone`);
      }
    }
    const gone = Date.now() + 3_000;
    while (jobs.some((job) => job.child) && Date.now() < gone) await sleep(100);
    await Promise.all(jobs.map((job) => job.closeLog()));
  };

  /** Reports changes to the real folders; true when one must never happen. */
  const reportChanges = () => {
    let critical = false;
    const changes = watched.flatMap((w) =>
      fingerprintChanges(w.before, fingerprint(w.dir)).map((c) => ({ ...c, ...w })),
    );
    for (const c of changes) {
      const where = c.path === "." ? c.dir : join(c.dir, c.path);
      if (c.critical(c.path)) {
        console.error(
          `✗ the real ${c.label} changed while the dev host ran: ${where} (${c.change})`,
        );
        critical = true;
      } else {
        console.error(
          `! the real ${c.label} changed while the dev host ran: ${where} (${c.change}). ` +
            "The desktop app keeps its own files there (gg-app-workspace.json); the dev host's processes never use that folder.",
        );
      }
    }
    if (changes.length === 0) say("✓ the real ~/.kleio and host state folder are unchanged");
    return critical;
  };

  /**
   * --app: after each change to the sandbox's keychain, the real search list
   * and default keychain must be what they were at start. If either differs,
   * both are put back from that state at once, with the real HOME, checked
   * again, and the run stops. Nothing is retried.
   */
  const afterKeychainWrite = (step) => {
    for (const w of keychainWatch) {
      const realEnv = homeEnv(w.home);
      const differs = () =>
        [
          ["search list", ["list-keychains", "-d", "user"]],
          ["default keychain", ["default-keychain", "-d", "user"]],
        ]
          .filter(([name, args]) => !sameResult(security(args, realEnv), w.before[name]))
          .map(([name]) => name);
      const changed = differs();
      if (changed.length === 0) continue;
      const list = keychainPaths(w.before["search list"].out);
      const [defaultKeychain] = keychainPaths(w.before["default keychain"].out);
      if (list.length > 0) security(["list-keychains", "-d", "user", "-s", ...list], realEnv);
      if (defaultKeychain) {
        security(["default-keychain", "-d", "user", "-s", defaultKeychain], realEnv);
      }
      const still = differs();
      throw new KeychainStop(
        `the real Keychain's ${changed.join(" and ")} (HOME=${w.home}) changed after security ${step}. ` +
          (still.length === 0
            ? "They were put back as they were at start, and match that again."
            : "Putting them back didn't work: check security list-keychains -d user and security default-keychain -d user."),
      );
    }
  };

  /**
   * --app: stops the app's processes, then Vite if this run started it. True
   * when an app process is still running after that.
   */
  const stopDesktop = async () => {
    if (desktop.watcher) clearInterval(desktop.watcher);
    let stuck = false;
    if (desktop.match) {
      const { stopped, left } = await stopApps(desktop.match);
      if (left.length > 0) {
        console.error(`✗ the app (pid ${left.join(", ")}) is still running`);
        stuck = true;
      } else if (stopped.length > 0) {
        say(`stopped the app (pid ${stopped.join(", ")})`);
      }
    }
    // The first process, if a stop came before ps showed it: still this script's child.
    const first = desktop.child;
    if (first && first.exitCode === null && first.signalCode === null && first.kill("SIGTERM")) {
      const until = Date.now() + 5_000;
      while (first.exitCode === null && first.signalCode === null && Date.now() < until) {
        await sleep(100);
      }
      if (first.exitCode === null && first.signalCode === null) first.kill("SIGKILL");
      say(`stopped the app (pid ${first.pid})`);
    }
    if (desktop.vite) {
      await stopGroup(desktop.vite, 5_000);
      say(`stopped Vite (pid ${desktop.vite.pid})`);
    }
    return stuck;
  };

  /**
   * --app: says which of the app's items the sandbox keychain held
   * (attributes only), then deletes it, with --keep too. True on a failure.
   */
  const closeSandboxKeychain = () => {
    if (desktop.keychainStopped) {
      console.error(`✗ a Keychain check failed, so this was left as it is: ${desktop.keychain}`);
      return true;
    }
    try {
      if (!present(desktop.keychain)) return false;
      const held = sandboxItems(desktop.env);
      deleteSandboxKeychain(desktop.keychain, {
        env: desktop.env,
        realHomes: homes,
        afterWrite: afterKeychainWrite,
      });
      say(
        `deleted the sandbox keychain (it held ${held.length > 0 ? held.join(" and ") : "none of the app's items"})`,
      );
      return false;
    } catch (e) {
      if (e instanceof KeychainStop) desktop.keychainStopped = true;
      console.error(
        `✗ deleting the sandbox keychain: ${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
  };

  /** --app: the real Keychain against its state at start. True on any change. */
  const reportKeychainChanges = () => {
    let changed = false;
    for (const w of keychainWatch) {
      const now = keychainState(w.home, w.accounts);
      for (const name of Object.keys(w.before)) {
        if (sameResult(now[name], w.before[name])) continue;
        console.error(
          `✗ the real Keychain changed while the dev host ran: ${name} (HOME=${w.home})`,
        );
        changed = true;
      }
    }
    if (!changed) {
      const items = [...new Set(keychainWatch.flatMap((w) => w.accounts))].sort();
      say(
        `✓ the real Keychain is unchanged: search list, default keychain, login keychain, and the items ${items.join(", ")} (attributes only)`,
      );
    }
    return changed;
  };

  /** Stops everything, checks the real folders, removes the sandbox, exits. */
  const shutdown = (code) => {
    stopping ??= (async () => {
      let exitCode = code;
      let keepSandbox = !fresh || keep;
      try {
        say("\nstopping the dev host…");
        if (desktop && (await stopDesktop())) {
          exitCode = 1;
          keepSandbox = true; // the app still has it open
        }
        await stopJobs();
        if (desktop && closeSandboxKeychain()) {
          exitCode = 1;
          keepSandbox = true; // left for a look
        }
        if (reportChanges()) exitCode = 1;
        if (desktop && reportKeychainChanges()) exitCode = 1;
        if (!keepSandbox) {
          rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
          say(`removed the sandbox ${sandbox}`);
        } else {
          say(`kept the sandbox ${sandbox}`);
        }
      } catch (e) {
        console.error(`✗ stopping the dev host: ${e instanceof Error ? e.message : String(e)}`);
        console.error(`  check for leftover processes and remove ${sandbox} by hand`);
        exitCode = 1;
      } finally {
        process.exit(exitCode);
      }
    })();
    return stopping;
  };

  let signals = 0;
  const onSignal = () => {
    signals += 1;
    if (signals > 1) {
      say("killing the host and sidecar now");
      for (const job of jobs) job.kill();
    }
    void shutdown(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  // The jobs run detached: a crash here must still stop them.
  const crashed = (e) => {
    console.error(`✗ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    void shutdown(1);
  };
  process.on("uncaughtException", crashed);
  process.on("unhandledRejection", crashed);
  const giveUp = (job) => {
    console.error(
      `✗ kleio-host ${job.name} keeps exiting; see ${job.logFile}\n${tail(job.logFile)}`,
    );
    void shutdown(1);
  };

  try {
    if (desktop) {
      say(`building the debug app (cargo build; output in ${logs.build})…`);
      desktop.binary = await buildDebugApp(logs.build);
      desktop.match = { binary: desktop.binary, home: desktop.env.HOME };
      const page = await devServerPage();
      if (isAppVitePage(page)) {
        say(`using gg-app's Vite, already on ${VITE_URL}`);
      } else if (page) {
        throw new Error(
          `something other than gg-app's Vite answers on ${VITE_URL} (HTTP ${page.status}): stop it, then run this again`,
        );
      } else {
        say(`starting gg-app's Vite (pnpm dev; output in ${logs.vite})…`);
        await startVite(logs.vite, (child) => {
          desktop.vite = child;
        });
      }
    }

    // Keys, registry, and the host's own admin token in secure/admin.token.
    const initLog = openSync(logs.init, "a", 0o600);
    try {
      execFileSync(process.execPath, [CLI, "init"], {
        cwd: env.HOME,
        env,
        stdio: ["ignore", initLog, initLog],
        timeout: 60_000,
      });
    } catch {
      throw new Error(`kleio-host init failed\n${tail(logs.init)}`);
    } finally {
      closeSync(initLog);
    }

    const sidecar = startJob({
      name: "sidecar",
      args: ["sidecar"],
      env,
      logFile: logs.sidecar,
      onGiveUp: giveUp,
    });
    jobs.push(sidecar);
    sidecar.onLine((line) => {
      if (!/endpoint published/.test(line)) return;
      const pid = publishedSidecarPid(env.KLEIO_HOST_HOME);
      if (pid) sidecarPids.add(pid);
    });
    await waitForLine(sidecar, /endpoint published/, 120_000, "the sidecar's start");

    const serve = startJob({
      name: "serve",
      args: ["serve"],
      env,
      logFile: logs.serve,
      onGiveUp: giveUp,
    });
    jobs.push(serve);
    await waitForLine(serve, /\[host\] listening/, 30_000, "the host's start");

    let health = null;
    for (let tries = 0; tries < 20 && health?.sidecar !== "up"; tries += 1) {
      if (tries > 0) await sleep(500);
      health = (await api(base, "GET", "/kleio/health").catch(() => ({ body: null }))).body;
    }
    if (health?.ok !== true || health.sidecar !== "up") {
      throw new Error(`the host isn't healthy: ${JSON.stringify(health)}`);
    }

    const adminToken = readFileSync(
      join(env.KLEIO_HOST_HOME, "secure", "admin.token"),
      "utf8",
    ).trim();

    if (desktop) {
      createSandboxKeychain({
        keychain: desktop.keychain,
        env: desktop.env,
        realHomes: homes,
        afterWrite: afterKeychainWrite,
      });
      // Minted last, so the code is fresh when the app opens: one use, five minutes.
      const admin = await offer(base, adminToken, true);
      const child = launchApp({ binary: desktop.binary, env: desktop.env, logFile: logs.app });
      desktop.child = child;
      let ended = null;
      child.on("exit", (code, signal) => {
        ended ??= `exited (code ${code}, signal ${signal})`;
      });
      child.on("error", (e) => {
        ended ??= `didn't start: ${e.message}`;
      });
      // Restart now replaces this process. Its successors are found by their HOME, with ps -E.
      const until = Date.now() + 15_000;
      while (!findAppPids(desktop.match).includes(child.pid ?? -1)) {
        if (ended) throw new Error(`the app ${ended}\n${tail(logs.app)}`);
        if (Date.now() > until) {
          throw new Error(
            `ps -E doesn't show the app (pid ${child.pid}) with HOME=${desktop.env.HOME}, so it couldn't be found again after Restart now`,
          );
        }
        await sleep(250);
      }
      let seen = String(child.pid);
      desktop.watcher = setInterval(() => {
        const pids = findAppPids(desktop.match).join(", ");
        if (pids === seen) return;
        seen = pids;
        say(pids ? `app: pid ${pids}` : "! the app isn't running; Ctrl-C stops the dev host");
      }, 2_000);
      const sidecarPid = publishedSidecarPid(env.KLEIO_HOST_HOME);
      const logList = [
        logs.app,
        logs.build,
        ...(desktop.vite ? [logs.vite] : []),
        logs.sidecar,
        logs.serve,
        logs.sidecarOwn,
      ];

      say(`
Kleio dev host, and the desktop app as a new user: in a sandbox, on loopback HTTP only.

  Host URL    ${base}   (sidecar up)
  Pair code   ${admin.display}   admin, one use, expires ${new Date(admin.expiresAt).toLocaleTimeString()}
              Type these into the app: Pair with your host, then Host URL, Pair code, Pair, Restart now.
              Another code: KLEIO_HOST_HOME=${env.KLEIO_HOST_HOME} KLEIO_HOST_PORT=${env.KLEIO_HOST_PORT} node ${shown(CLI)} pair --admin
  Pair it with this host only: pairing a real host from it would register a throwaway device there.
  The sandbox has no AI provider signed in; sign in from the app to chat.

  App         ${shown(desktop.binary)} (debug build)
  App home    ${desktop.env.HOME}
              its ~/.kleio, Library folders, webview storage, and its own keychain (deleted at exit)
  Vite        ${VITE_URL}   (${desktop.vite ? "started by this run, stopped at exit" : "already running: left alone"})
  Sandbox     ${sandbox}   (${keep ? "kept at exit" : "removed at exit; --keep keeps it"})
  Logs        ${logList.join("\n              ")}
  Processes   app ${child.pid}, serve ${serve.child?.pid}, sidecar job ${sidecar.child?.pid}, sidecar ${sidecarPid}${desktop.vite ? `, Vite ${desktop.vite.pid}` : ""}

Ctrl-C stops it.`);
      return;
    }

    // The app's device first: the host keeps one offer at a time.
    const app = await appDevice(base, adminToken, appEnvFile);
    writeAppEnv(appEnvFile, base, app.token);
    const admin = await offer(base, adminToken, true);
    const line = launchLine({
      url: base,
      token: app.token,
      shell: process.platform === "win32" ? "powershell" : "posix",
    });
    const sidecarPid = publishedSidecarPid(env.KLEIO_HOST_HOME);

    say(`
Kleio dev host: in a sandbox, on loopback HTTP only.

  Host        ${base}   (sidecar up)
  Admin code  ${admin.display}   one use, expires ${new Date(admin.expiresAt).toLocaleTimeString()}. Redeem it with:
              curl -s ${base}/kleio/pair/redeem -H 'content-type: application/json' -d '{"code":"${admin.code}","redemptionNonce":"'"$(openssl rand -hex 16)"'","label":"curl"}'
              Another code: KLEIO_HOST_HOME=${env.KLEIO_HOST_HOME} KLEIO_HOST_PORT=${env.KLEIO_HOST_PORT} node ${shown(CLI)} pair --admin

  Start the desktop app against it (${app.reused ? "the device paired last time" : "a new ordinary device"}, so Setup's key forms show status only):
    ${line}
  In that app, don't use Forget host or Pair: they act on your real ~/.kleio/remote.json and Keychain.
  The sandbox has no AI provider signed in; sign in from the app to chat.

  Sandbox     ${sandbox}   (${fresh ? (keep ? "kept at exit" : "removed at exit; --keep keeps it") : "yours: kept"})
  App token   ${appEnvFile}
  Logs        ${logs.sidecar}
              ${logs.serve}
              ${logs.sidecarOwn}
  Processes   serve ${serve.child?.pid}, sidecar job ${sidecar.child?.pid}, sidecar ${sidecarPid}

Ctrl-C stops it.`);
  } catch (e) {
    if (desktop && e instanceof KeychainStop) desktop.keychainStopped = true;
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    await shutdown(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
