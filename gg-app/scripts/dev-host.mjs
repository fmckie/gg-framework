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
 * Isolation (kleio-sandbox.mjs): one sandbox folder holds everything the
 * children write: HOME, the host's state folder, the Kleio and projects
 * folders, the settings file and the sidecar's working folder. This shell's
 * KLEIO_*, GG_* and NODE_OPTIONS don't reach them.
 *
 * It refuses to run when any of those paths is the real home or inside it,
 * or touches the real ~/.gg, ~/.kleio or host state folder. The host and its
 * preview origin listen on 127.0.0.1 only: no Tailscale, no TLS. At exit it
 * reports any change to the real ~/.kleio and host state folder.
 *
 * Usage (packages/kleio-host/README.md, "Develop against a local host"):
 *   pnpm --filter "@kleio/coder..." build && pnpm --filter @kleio/host build
 *   pnpm --filter gg-app stage:node && pnpm --filter gg-app bundle:sidecar
 *   node gg-app/scripts/dev-host.mjs [--dir <path>] [--keep]
 *
 *   --dir <path>  use this sandbox folder and keep it, so pairings and chats
 *                 survive a restart (created if missing)
 *   --keep        keep the fresh sandbox folder at exit
 *
 * Ctrl-C (or SIGTERM) stops the host and sidecar and removes the sandbox.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalPath,
  fingerprint,
  fingerprintChanges,
  freePorts,
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

  --dir <path>  use this sandbox folder and keep it, so pairings and chats
                survive a restart (created if missing)
  --keep        keep the fresh sandbox folder at exit`;

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

function parseArgs(argv) {
  const options = { dir: null, keep: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--keep") options.keep = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dir" && next && !next.startsWith("--")) {
      options.dir = next;
      i += 1;
    } else if (arg.startsWith("--dir=") && arg.length > "--dir=".length) {
      options.dir = arg.slice("--dir=".length);
    } else return { error: `unknown or incomplete option: ${arg}` };
  }
  return { options };
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

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error || parsed.options.help) {
    (parsed.error ? console.error : console.log)(`${parsed.error ?? ""}\n${USAGE}`.trim());
    process.exit(parsed.error ? 2 : 0);
  }
  const { dir, keep } = parsed.options;

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
  const problems = [
    ...new Set(homes.flatMap((realHome) => sandboxProblems({ sandbox, env, realHome }))),
  ];
  if (problems.length > 0) {
    if (fresh) rmdirSync(sandbox); // the empty folder mkdtemp just made
    for (const p of problems) console.error(`refusing to run: ${p}`);
    console.error("Pass --dir with a folder outside your home folder.");
    process.exit(2);
  }
  mkdirSync(sandbox, { recursive: true, mode: 0o700 });
  const logsDir = join(sandbox, "logs");
  for (const d of [env.HOME, logsDir, env.KLEIO_SIDECAR_CWD]) mkdirSync(d, { recursive: true });
  const logs = {
    init: join(logsDir, "init.log"),
    sidecar: join(logsDir, "sidecar.log"),
    serve: join(logsDir, "serve.log"),
    sidecarOwn: join(env.HOME, ".gg", "gg-app-sidecar.log"),
  };
  const appEnvFile = join(sandbox, "app.env");
  const base = env.KLEIO_PUBLIC_URL;

  const jobs = [];
  const sidecarPids = new Set();
  let stopping = null;

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

  /** Stops everything, checks the real folders, removes the sandbox, exits. */
  const shutdown = (code) => {
    stopping ??= (async () => {
      let exitCode = code;
      try {
        say("\nstopping the dev host…");
        await stopJobs();
        if (reportChanges()) exitCode = 1;
        if (fresh && !keep) {
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

    // The app's device first: the host keeps one offer at a time.
    const adminToken = readFileSync(
      join(env.KLEIO_HOST_HOME, "secure", "admin.token"),
      "utf8",
    ).trim();
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
