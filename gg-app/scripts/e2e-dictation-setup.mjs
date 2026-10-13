/**
 * End-to-end check: dictation's speech model set up from Settings → Setup, in
 * a sandbox. Manual, not CI: it downloads the real model (139 MB) from Hugging
 * Face, needs macOS's `say` for a test clip, and a Playwright Chromium and the
 * gg-app dev server for the screenshots.
 *
 * What's real: the kleio-host CLI from packages/kleio-host/dist (`init`,
 * `sidecar`, `serve`), the freshly bundled sidecar
 * (gg-app/src-tauri/sidecar/app-sidecar.mjs on the staged node), a non-admin
 * device paired through the real pair-offer/redeem flow, the pinned download
 * from Hugging Face, Whisper, and the Dictation card in Chromium with a fake
 * Tauri shell bridged to the host with that device's token (as in
 * e2e-remote-outputs.mjs).
 *
 * What's faked: the network's condition, for Hugging Face only. The sidecar
 * runs with an --import preload in front of fetch that refuses huggingface.co
 * and *.hf.co while a flag file exists ("the network is down"), slows them to
 * 6 MB/s while another exists (so a kill lands mid-download on any
 * connection), and records each request and the bytes received (the evidence
 * for the resume). Nothing else about the network is touched.
 *
 * Isolation: everything lives under one temp folder T (HOME and USERPROFILE =
 * T/home, KLEIO_HOST_HOME = T/host, loopback ports). The script refuses to run
 * when any of that points at the real home, refuses any non-loopback host URL,
 * and fails if the real ~/.gg/models or ~/.kleio changed while it ran.
 *
 * Stages, in one sandbox (about one model download in all):
 *   1. Network off: prepare gives failed: offline.
 *   2. Network on, same sidecar process: prepare downloads (retry, no restart).
 *   3. kill -9 the sidecar mid-download; restart; prepare resumes from the
 *      .part (first progress sample near where it stopped) and reaches ready;
 *      the files are hashed against the pin.
 *   4. A `say` clip through POST /transcribe comes back as the words said.
 *   5. Restart with the network off: GET says ready, and transcribing still works.
 *   6. The sidecar's memory before and after Whisper loads.
 *   UI: the card at iPhone size, against the sandbox host, in each state.
 *
 * Usage:
 *   pnpm --filter @kleio/core build && pnpm --filter @kleio/coder build
 *   pnpm --filter @kleio/host build
 *   pnpm --filter gg-app stage:node && pnpm --filter gg-app bundle:sidecar
 *   pnpm --filter gg-app dev             # terminal 1 (http://localhost:1420)
 *   node gg-app/scripts/e2e-dictation-setup.mjs
 *
 * Output: .gg/screenshots/dictation-setup/e2e-*.png, and a summary on stdout.
 */
import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const cli = join(repo, "packages/kleio-host/dist/cli.js");
const sidecarBundle = join(repo, "gg-app/src-tauri/sidecar/app-sidecar.mjs");
const binDir = join(repo, "gg-app/src-tauri/binaries");
const outDir = join(repo, ".gg/screenshots/dictation-setup");
const appUrl = process.env.GG_SHOT_URL ?? "http://localhost:1420";
const TOKEN_HEADER = "x-kleio-device-token";
const REAL_HOME = homedir();

const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
};

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 23)} ${msg}`);

function check(ok, what) {
  if (!ok) throw new Error(`✗ ${what}`);
  log(`✓ ${what}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

// ── Isolation guards ─────────────────────────────────────────────────────────

/** True when `p` is the real home or inside it (case-insensitive, real paths). */
function insideRealHome(p) {
  const real = (x) => {
    try {
      return realpathSync(x).toLowerCase();
    } catch {
      return resolve(x).toLowerCase();
    }
  };
  const home = real(REAL_HOME);
  const target = real(p);
  return target === home || target.startsWith(home + sep);
}

function guardSandbox(tmp, env) {
  for (const key of [
    "HOME",
    "USERPROFILE",
    "KLEIO_HOST_HOME",
    "KLEIO_HOME_CWD",
    "KLEIO_PROJECTS_DIR",
    "KLEIO_SETTINGS_FILE",
    "KLEIO_SIDECAR_CWD",
  ]) {
    const value = env[key];
    if (!value || !resolve(value).startsWith(tmp) || insideRealHome(value)) {
      throw new Error(`refusing to run: ${key}=${value} is not inside the sandbox ${tmp}`);
    }
  }
  for (const key of ["KLEIO_PUBLIC_URL"]) {
    if (new URL(env[key]).hostname !== "127.0.0.1") {
      throw new Error(`refusing to run: ${key}=${env[key]} is not loopback`);
    }
  }
}

/** Names, sizes and mtimes under `dir` (recursively), to compare before and after. */
function fingerprint(dir) {
  if (!existsSync(dir)) return "(none)";
  const entries = readdirSync(dir, { recursive: true }).map(String).sort();
  return entries
    .map((rel) => {
      try {
        const s = statSync(join(dir, rel));
        return `${rel}:${s.isDirectory() ? "dir" : s.size}:${Math.round(s.mtimeMs)}`;
      } catch {
        return `${rel}:gone`;
      }
    })
    .join("\n");
}

// ── The network switch (a preload in the sidecar) ────────────────────────────

/** Bytes per millisecond while throttled: 6 MB/s, so a kill lands mid-download. */
const THROTTLE_BYTES_PER_MS = 6_000;

/**
 * A preload for the sidecar that sits in front of fetch for Hugging Face only:
 * refuses it while the "off" flag exists (like a cut network), slows it while
 * the "slow" flag exists, and records each request (path, Range, pid) and the
 * bytes each process received, as the evidence for the resume checks.
 */
function writeNetworkSwitch(tmp) {
  const offFlag = join(tmp, "network-off");
  const slowFlag = join(tmp, "network-slow");
  const requests = join(tmp, "hub-requests.jsonl");
  const preload = join(tmp, "network-switch.mjs");
  writeFileSync(
    preload,
    `import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const offFlag = ${JSON.stringify(offFlag)};
const slowFlag = ${JSON.stringify(slowFlag)};
const requests = ${JSON.stringify(requests)};
const bytesFile = ${JSON.stringify(join(tmp, "hub-bytes-"))} + process.pid + ".txt";
const real = globalThis.fetch;
const isHub = (host) =>
  host === "huggingface.co" || host.endsWith(".huggingface.co") || host.endsWith(".hf.co");
let received = 0;
let written = 0;
const record = (force) => {
  if (force || received - written >= 1_000_000) {
    writeFileSync(bytesFile, String(received));
    written = received;
  }
};
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (!isHub(url.hostname)) return real(input, init);
  const range = new Headers(init?.headers).get("range");
  const off = existsSync(offFlag);
  appendFileSync(requests, JSON.stringify({ pid: process.pid, path: url.pathname, range, blocked: off }) + "\\n");
  if (off) {
    throw new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND " + url.hostname + " (e2e network switch)"),
    });
  }
  const res = await real(input, init);
  if (!res.body) return res;
  const reader = res.body.getReader();
  const slow = existsSync(slowFlag);
  const body = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        record(true);
        controller.close();
        return;
      }
      received += value.byteLength;
      record(false);
      if (slow) await new Promise((r) => setTimeout(r, value.byteLength / ${THROTTLE_BYTES_PER_MS}));
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
};
`,
  );
  const readRequests = () =>
    existsSync(requests)
      ? readFileSync(requests, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const bytesReceived = () =>
    readdirSync(tmp)
      .filter((f) => f.startsWith("hub-bytes-"))
      .reduce((n, f) => n + Number(readFileSync(join(tmp, f), "utf8")), 0);
  return {
    preload,
    off: () => writeFileSync(offFlag, "1"),
    on: () => rmSync(offFlag, { force: true }),
    slow: () => writeFileSync(slowFlag, "1"),
    requests: readRequests,
    bytesReceived,
  };
}

// ── The real host and sidecar ────────────────────────────────────────────────

function stagedNode() {
  const found = existsSync(binDir)
    ? readdirSync(binDir).find((f) => f.startsWith("ggnode-"))
    : null;
  if (!found) throw new Error("stage node first: pnpm --filter gg-app stage:node");
  return join(binDir, found);
}

function lineWatcher(child, lines) {
  const onData = (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) lines.push(line);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
}

/** Wait until `pattern` has matched at least `count` lines in all. */
async function waitForLine(lines, pattern, ms, what, count = 1) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (lines.filter((l) => pattern.test(l)).length >= count) return;
    await sleep(100);
  }
  throw new Error(`${what}: timed out\n${lines.slice(-20).join("\n")}`);
}

const PUBLISHED = /endpoint published/;
const RESPAWNING = /respawning/;

/**
 * `kleio-host sidecar`, kept alive the way launchd keeps the
 * com.kleio.host.sidecar job alive (install-mini.sh: KeepAlive, a 5 s
 * ThrottleInterval; 1 s here). When its sidecar dies, the supervisor logs that
 * it is respawning and exits; the job is then started again, and with it a
 * new sidecar.
 */
function startSidecarJob(env, network) {
  const lines = [];
  const job = { child: null, stopped: false };
  const launch = () => {
    const child = spawn(process.execPath, [cli, "sidecar"], {
      env: {
        ...env,
        // The supervisor passes its env on to the sidecar, preload included.
        NODE_OPTIONS: `--import=${pathToFileURL(network.preload).href}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;
    lineWatcher(child, lines);
    child.on("exit", (code, signal) => {
      lines.push(`[e2e] kleio-host sidecar exited code=${code} signal=${signal}`);
      if (!job.stopped) setTimeout(launch, 1_000);
    });
  };
  launch();
  return {
    lines,
    stop() {
      job.stopped = true;
      job.child?.kill("SIGTERM");
    },
    kill() {
      job.child?.kill("SIGKILL");
    },
  };
}

/** The sidecar's own pid, from the endpoint file the supervisor publishes. */
function sidecarPid(env) {
  const endpoint = JSON.parse(readFileSync(join(env.KLEIO_HOST_HOME, "sidecar.json"), "utf8"));
  return endpoint.pid;
}

/** Resident memory of a pid, in MB (macOS/Linux `ps`). */
function rssMb(pid) {
  const kb = Number(
    execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim(),
  );
  return Math.round(kb / 1024);
}

async function startHost(env) {
  const child = spawn(process.execPath, [cli, "serve"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const lines = [];
  lineWatcher(child, lines);
  await waitForLine(lines, /\[host\] listening/, 15_000, "host start");
  return { child, lines };
}

async function pairPhone(env, api) {
  const admin = readFileSync(join(env.KLEIO_HOST_HOME, "secure/admin.token"), "utf8").trim();
  const offer = await (
    await fetch(`${api}/kleio/pair/offer`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: admin, "content-type": "application/json" },
      body: "{}",
    })
  ).json();
  const redeemed = await (
    await fetch(`${api}/kleio/pair/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: offer.code,
        redemptionNonce: randomBytes(16).toString("hex"),
        label: "iPhone (e2e)",
      }),
    })
  ).json();
  check(
    redeemed.ok === true && typeof redeemed.payload?.token === "string",
    "non-admin phone paired",
  );
  check(redeemed.payload.admin !== true, "the phone is not an admin");
  return redeemed.payload;
}

// ── Talking to the host as the phone ─────────────────────────────────────────

function phoneClient(api, token) {
  const headers = { [TOKEN_HEADER]: token };
  const call = async (method, path, body, extra = {}) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { ...headers, ...extra, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  };
  return {
    call,
    status: () => call("GET", "/kleio/setup/dictation"),
    prepare: () => call("POST", "/kleio/setup/dictation", {}),
  };
}

/** Poll GET until `done(dictation)` holds; returns every dictation seen. */
async function pollUntil(phone, done, ms, what) {
  const seen = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await phone.status();
    if (r.status === 200) {
      seen.push(r.body.dictation);
      if (done(r.body.dictation)) return seen;
    }
    await sleep(500);
  }
  throw new Error(`${what}: timed out; last ${JSON.stringify(seen.at(-1))}`);
}

// ── The model's files, checked against the pin ───────────────────────────────

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyPinned(modelsDir) {
  const core = await import(pathToFileURL(join(repo, "packages/gg-core/dist/index.js")).href);
  const dir = core.modelDir(modelsDir);
  for (const file of core.WHISPER_MODEL.files) {
    const path = join(dir, ...file.path.split("/"));
    check(statSync(path).size === file.size, `${file.path}: ${file.size} bytes`);
    check((await sha256(path)) === file.sha256, `${file.path}: SHA-256 matches the pin`);
  }
  check(existsSync(join(dir, ".kleio-verified.json")), "the verified marker is written");
  check(
    readdirSync(dir, { recursive: true }).every((f) => !String(f).endsWith(".part")),
    "no .part files left",
  );
  return core;
}

// ── A spoken clip ────────────────────────────────────────────────────────────

const SPOKEN = "Run the tests and fix the failing build.";

function sayClip(tmp) {
  const wav = join(tmp, "clip.wav");
  execFileSync("say", ["-o", wav, "--data-format=LEI16@16000", "--file-format=WAVE", SPOKEN]);
  const data = readFileSync(wav);
  // The PCM after the WAVE header's "data" chunk.
  const at = data.indexOf(Buffer.from("data"));
  if (at < 0) throw new Error("say wrote no data chunk");
  const size = data.readUInt32LE(at + 4);
  return data.subarray(at + 8, at + 8 + size).toString("base64");
}

async function transcribe(phone, audio) {
  // /transcribe is a session route: open one, as the composer does.
  const session = await phone.call("POST", "/session", { mode: "chat" });
  check(
    session.status === 200 && typeof session.body?.sessionId === "string",
    "a chat session opened",
  );
  const r = await phone.call(
    "POST",
    "/transcribe",
    { audio },
    { "x-gg-session": session.body.sessionId },
  );
  return r;
}

const normalise = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ── The card, in Chromium, against the sandbox host ──────────────────────────

function initScript({ phone }) {
  const callbacks = new Map();
  let nextId = 1;
  const active = {
    base: phone.base,
    host: "sandbox.e2e",
    deviceId: phone.deviceId,
    label: phone.label,
    admin: false,
  };
  const responses = {
    sidecar_port: 45678,
    kleio_remote_status: {
      active,
      paired: { baseUrl: phone.base, ...active, pairedAt: "2026-10-13T12:00:00Z" },
    },
    app_auth_status: { providers: [] },
    app_settings_get: { projectsRoot: "/tmp", configured: true },
    agent_models: { models: [] },
    agent_commands: { commands: [] },
    agent_tasks: { tasks: [] },
    agent_projects: { projects: [] },
    agent_sessions: { sessions: [] },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    plugins: {},
    convertFileSrc: (p) => p,
    transformCallback(cb) {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    async invoke(cmd, args) {
      if (cmd === "kleio_api") {
        const r = await window.__kleioBridge(args);
        if (r.error) throw r.error;
        return r.value;
      }
      if (cmd === "plugin:app|version") return "0.0.0-e2e";
      if (cmd === "plugin:event|listen") return nextId++;
      if (cmd.startsWith("plugin:updater|")) throw new Error("no updates");
      if (cmd.startsWith("plugin:")) return null;
      return cmd in responses ? responses[cmd] : null;
    },
  };
}

/** kleio_api against the real host, with the phone's token, like the Rust command. */
function bridge(api, token) {
  return async ({ method, path, body }) => {
    try {
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { [TOKEN_HEADER]: token, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text.trim() ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { value: { status: res.status, body: parsed } };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  };
}

async function shootCard(browser, api, phone, name) {
  const context = await browser.newContext(IPHONE);
  await context.exposeFunction("__kleioBridge", bridge(api, phone.token));
  await context.addInitScript(initScript, { phone: { ...phone, base: api } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const card = page.getByRole("region", { name: "Dictation" });
  await card.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: join(outDir, `e2e-${name}.png`) });
  const badge = await card.locator(".badge").first().textContent();
  await context.close();
  check(errors.length === 0, `${name}: no page errors (${errors.join("; ") || "none"})`);
  log(`→ e2e-${name}.png (badge: ${badge})`);
  return badge;
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const [file, how] of [
    [cli, "pnpm --filter @kleio/host build"],
    [sidecarBundle, "pnpm --filter gg-app bundle:sidecar"],
    [join(repo, "packages/gg-core/dist/index.js"), "pnpm --filter @kleio/core build"],
  ]) {
    if (!existsSync(file)) throw new Error(`missing ${file}: ${how}`);
  }
  const up = await fetch(appUrl).then(
    (r) => r.ok,
    () => false,
  );
  if (!up) throw new Error(`start the dev server first (${appUrl}): pnpm --filter gg-app dev`);
  mkdirSync(outDir, { recursive: true });

  const realModels = join(REAL_HOME, ".gg", "models");
  const realKleio = join(REAL_HOME, ".kleio");
  const before = { models: fingerprint(realModels), kleio: fingerprint(realKleio) };

  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kleio-e2e-dictation-")));
  const home = join(tmp, "home");
  mkdirSync(home, { recursive: true });
  const [apiPort, previewPort] = [await freePort(), await freePort()];
  // Nothing of this shell's own Kleio or app settings reaches the sandbox.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("KLEIO_") && !key.startsWith("GG_APP_") && key !== "NODE_OPTIONS",
    ),
  );
  const env = {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    KLEIO_HOST_HOME: join(tmp, "host"),
    KLEIO_HOST_PORT: String(apiPort),
    KLEIO_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    KLEIO_PREVIEW_PORT: String(previewPort),
    KLEIO_HOME_CWD: join(tmp, "Kleio"),
    KLEIO_PROJECTS_DIR: join(tmp, "projects"),
    KLEIO_SETTINGS_FILE: join(home, ".gg", "kleio-app.json"),
    KLEIO_SIDECAR_PATH: sidecarBundle,
    KLEIO_NODE_BIN: stagedNode(),
    KLEIO_SIDECAR_CWD: join(tmp, "work"),
  };
  guardSandbox(tmp, env);
  mkdirSync(env.KLEIO_SIDECAR_CWD, { recursive: true });
  const api = env.KLEIO_PUBLIC_URL;
  const modelsDir = join(home, ".gg", "models");
  log(`sandbox ${tmp}`);

  const network = writeNetworkSwitch(tmp);
  const summary = {};
  let browser;
  let sidecar;
  let host;
  try {
    execFileSync(process.execPath, [cli, "init"], { env, stdio: "ignore" });
    network.off();
    sidecar = startSidecarJob(env, network);
    await waitForLine(sidecar.lines, PUBLISHED, 120_000, "sidecar start");
    host = await startHost(env);
    const phoneInfo = await pairPhone(env, api);
    const phone = phoneClient(api, phoneInfo.token);
    browser = await chromium.launch();

    // Fresh host: absent, and the card offers the download.
    const fresh = await phone.status();
    check(
      fresh.status === 200 && fresh.body.dictation.state === "absent",
      "a fresh host says absent",
    );
    summary.bytes = fresh.body.dictation.bytes;
    check((await shootCard(browser, api, phoneInfo, "absent")) === "Not set up", "card: absent");

    // 1. Network off: failed: offline.
    const first = await phone.prepare();
    check(first.status === 200, `prepare answered (${first.body?.dictation?.state})`);
    const offline = await pollUntil(phone, (d) => d.state === "failed", 60_000, "offline failure");
    check(
      offline.at(-1).reason === "offline",
      "with the network off, prepare gives failed: offline",
    );
    check(
      JSON.stringify(offline).includes("ENOTFOUND") === false,
      "no raw error reaches the device",
    );
    check((await shootCard(browser, api, phoneInfo, "failed")) === "Not set up", "card: failed");

    // 2. Network on, same process: the retry downloads (slowed, so the kill
    //    below lands mid-file).
    const pid1 = sidecarPid(env);
    network.slow();
    network.on();
    const retry = await phone.prepare();
    check(retry.status === 200, "prepare again, without a restart");
    const partway = await pollUntil(
      phone,
      (d) => d.state === "downloading" && d.loaded >= 30_000_000,
      600_000,
      "download to 30 MB",
    );
    const atKill = partway.at(-1).loaded;

    // 3. kill -9 mid-download, restart, resume.
    process.kill(pid1, "SIGKILL");
    check(sidecarPid(env) === pid1, "the same sidecar process was downloading (no restart needed)");
    log(`killed the sidecar (pid ${pid1}) at ${Math.round(atKill / 1e6)} MB`);
    await waitForLine(sidecar.lines, RESPAWNING, 15_000, "supervisor notices", 1);
    await waitForLine(sidecar.lines, PUBLISHED, 120_000, "sidecar restart", 2);
    const pid2 = sidecarPid(env);
    check(pid2 !== pid1, `a new sidecar process (pid ${pid2})`);
    const afterRestart = await phone.status();
    check(
      afterRestart.body?.dictation?.state === "absent",
      "after the kill, nothing is running: absent",
    );
    const memBefore = rssMb(pid2);
    await phone.prepare();
    const resuming = await pollUntil(
      phone,
      (d) => d.state === "downloading" && d.loaded > 0,
      60_000,
      "the resumed download's first progress",
    );
    const firstSample = resuming.at(-1).loaded;
    check(
      firstSample >= atKill * 0.9,
      `it picked up the .part: first sample ${Math.round(firstSample / 1e6)} MB (killed at ${Math.round(atKill / 1e6)} MB)`,
    );
    check(
      (await shootCard(browser, api, phoneInfo, "downloading")) === "In progress",
      "card: downloading",
    );
    const finished = await pollUntil(
      phone,
      (d) => d.state === "ready" || d.state === "failed",
      900_000,
      "resume to ready",
    );
    check(finished.at(-1).state === "ready", "the resumed download reaches ready");
    const memAfter = rssMb(pid2);
    const core = await verifyPinned(modelsDir);
    const total = core.modelBytes();
    const ranged = network
      .requests()
      .filter(
        (r) => r.pid === pid2 && typeof r.range === "string" && /^bytes=[1-9]\d*-$/.test(r.range),
      );
    check(
      ranged.length >= 1,
      `the new process asked with a Range (${ranged[0]?.path} ${ranged[0]?.range})`,
    );
    const fetched = network.bytesReceived();
    check(
      fetched > total - 2_000_000 && fetched < total + 4_000_000,
      `about one model's bytes fetched in all: ${Math.round(fetched / 1e6)} MB for a ${Math.round(total / 1e6)} MB model`,
    );
    check((await shootCard(browser, api, phoneInfo, "ready")) === "Done", "card: ready");

    // 4. A spoken clip.
    const audio = sayClip(tmp);
    const heard = await transcribe(phone, audio);
    check(heard.status === 200, `POST /transcribe answered ${heard.status}`);
    check(normalise(heard.body.text) === normalise(SPOKEN), `transcribed: "${heard.body.text}"`);
    const memLoaded = rssMb(pid2);

    // 5. Restart with the network off: ready, and dictation still works.
    network.off();
    process.kill(pid2, "SIGKILL");
    await waitForLine(sidecar.lines, RESPAWNING, 15_000, "supervisor notices", 2);
    await waitForLine(sidecar.lines, PUBLISHED, 120_000, "sidecar restart", 3);
    const pid3 = sidecarPid(env);
    check(pid3 !== pid2, `a new sidecar process (pid ${pid3}), network off`);
    const offlineStatus = await phone.status();
    check(
      offlineStatus.body?.dictation?.state === "ready",
      "after an offline restart, a few stats say ready (no network asked)",
    );
    const offlineHeard = await transcribe(phone, audio);
    check(
      offlineHeard.status === 200 && normalise(offlineHeard.body.text) === normalise(SPOKEN),
      `offline after a restart, still transcribed: "${offlineHeard.body?.text}"`,
    );
    const asked = network.requests().filter((r) => r.pid === pid3);
    check(asked.length === 0, `the restarted sidecar never asked Hugging Face (${asked.length})`);
    const sidecarLog = readFileSync(join(home, ".gg", "gg-app-sidecar.log"), "utf8");
    summary.downloadsLogged = (
      sidecarLog.match(/speech model downloaded and checked/g) ?? []
    ).length;
    check(
      summary.downloadsLogged === 1,
      `one checked download in all (${summary.downloadsLogged})`,
    );

    // 6. Memory, for the README.
    summary.memory = {
      beforeLoadMb: memBefore,
      afterDownloadMb: memAfter,
      afterFirstClipMb: memLoaded,
    };
    log(
      `memory: sidecar ${memBefore} MB before, ${memAfter} MB with Whisper loaded, ` +
        `${memLoaded} MB after a chat session and the first clip`,
    );
  } finally {
    await browser?.close().catch(() => {});
    host?.child.kill("SIGTERM");
    sidecar?.stop();
    await sleep(2_000);
    if (host && host.child.exitCode === null) host.child.kill("SIGKILL");
    sidecar?.kill();
    // The supervisor's own child may outlive it: stop it too.
    try {
      process.kill(sidecarPid(env), "SIGKILL");
    } catch {
      // Already gone.
    }
    if (process.env.E2E_VERBOSE === "1" && sidecar) console.log(sidecar.lines.join("\n"));
    const after = { models: fingerprint(realModels), kleio: fingerprint(realKleio) };
    if (after.models !== before.models) throw new Error("✗ the real ~/.gg/models changed");
    if (after.kleio !== before.kleio) throw new Error("✗ the real ~/.kleio changed");
    log("✓ the real ~/.gg/models and ~/.kleio are unchanged");
    if (process.env.KEEP_SANDBOX !== "1") rmSync(tmp, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: true, ...summary }));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
