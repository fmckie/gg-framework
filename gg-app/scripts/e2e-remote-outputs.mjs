/**
 * End-to-end check: outputs a Chat/Code session writes on the Mac mini open on
 * a paired iPhone. Manual, not CI (needs a Playwright Chromium and the dev
 * server).
 *
 * What's real: the kleio-host CLI from packages/kleio-host/dist (`init` +
 * `serve`, both its API and its preview origin on loopback ports), a device
 * paired through its real pair-offer/redeem flow, a PDF rendered by Chromium
 * and a two-file static site written into a temp projects folder.
 *
 * What's faked: the Tauri shell. The webview runs in Chromium at the iPhone
 * layout with a fake `__TAURI_INTERNALS__`; the three Rust commands the cards
 * call (`kleio_file_fetch`, `kleio_file_open`, `kleio_site_open`) are bridged
 * to real HTTP calls against the host, carrying the device token like Rust.
 * Quick Look and Safari are not exercised: see the simulator smoke in
 * gg-app/README.md.
 *
 * Usage:
 *   pnpm --filter @kleio/host build
 *   pnpm --filter gg-app dev             # terminal 1 (http://localhost:1420)
 *   node gg-app/scripts/e2e-remote-outputs.mjs
 *
 * Output: .gg/screenshots/remote-outputs/{01-cards,02-pdf,03-site}.png
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const cli = join(repo, "packages/kleio-host/dist/cli.js");
const outDir = join(repo, ".gg/screenshots/remote-outputs");
const appUrl = process.env.GG_SHOT_URL ?? "http://localhost:1420";
const TOKEN_HEADER = "x-kleio-device-token";

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

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ── The real host ────────────────────────────────────────────────────────────

async function startHost(tmp) {
  const [apiPort, previewPort] = [await freePort(), await freePort()];
  const env = {
    ...process.env,
    KLEIO_HOST_HOME: join(tmp, "host"),
    KLEIO_HOST_PORT: String(apiPort),
    KLEIO_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    KLEIO_PREVIEW_PORT: String(previewPort),
    KLEIO_HOME_CWD: join(tmp, "Kleio"),
    // Chat and Code sessions' projects folder; no settings file → this default.
    KLEIO_PROJECTS_DIR: join(tmp, "projects"),
    KLEIO_SETTINGS_FILE: join(tmp, "kleio-app.json"),
  };
  execFileSync(process.execPath, [cli, "init"], { env, stdio: "ignore" });
  const child = spawn(process.execPath, [cli, "serve"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const lines = [];
  await new Promise((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("host did not start")), 15_000);
    const onData = (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        lines.push(line);
        if (line.includes("[host] listening")) {
          clearTimeout(timer);
          ready();
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => fail(new Error(`host exited (${code}): ${lines.join("\n")}`)));
  });
  child.removeAllListeners("exit");
  const api = `http://127.0.0.1:${apiPort}`;
  const preview = `http://127.0.0.1:${previewPort}`;
  log(`host up: api ${api}, preview ${preview}`);

  // Pair a phone the real way: the admin mints an offer, the phone redeems it.
  const admin = readFileSync(join(tmp, "host/secure/admin.token"), "utf8").trim();
  const offer = await json(
    await fetch(`${api}/kleio/pair/offer`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: admin, "content-type": "application/json" },
      body: "{}",
    }),
  );
  const redeemed = await json(
    await fetch(`${api}/kleio/pair/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: offer.code,
        redemptionNonce: randomBytes(16).toString("hex"),
        label: "iPhone (e2e)",
      }),
    }),
  );
  check(redeemed.ok === true && typeof redeemed.payload?.token === "string", "phone paired");
  return { child, api, preview, lines, phone: redeemed.payload };
}

// ── Outputs a session "wrote" on the host ────────────────────────────────────

async function writeOutputs(browser, demo) {
  mkdirSync(join(demo, "site"), { recursive: true });
  const page = await browser.newPage();
  await page.setContent(
    `<style>body{font:15px system-ui;margin:48px}h1{color:#9b1c2c}</style>
     <h1>Quarterly report</h1><p>Revenue up 12%. Churn down to 2.1%.</p>`,
  );
  writeFileSync(join(demo, "report.pdf"), await page.pdf({ format: "A4" }));
  await page.close();
  writeFileSync(
    join(demo, "site/index.html"),
    `<!doctype html><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="style.css">
<title>Demo site</title>
<main><h1>Demo site</h1><p>Served from the Mac mini's preview origin.</p></main>`,
  );
  writeFileSync(
    join(demo, "site/style.css"),
    `body { background: rgb(18, 94, 74); color: white; font: 17px system-ui; margin: 32px; }`,
  );
}

// ── The webview, with the Tauri shell bridged to the host ────────────────────

function initScript({ responses }) {
  const callbacks = new Map();
  const eventHandlers = new Map();
  let nextId = 1;
  const BRIDGED = new Set(["kleio_api", "kleio_file_fetch", "kleio_file_open", "kleio_site_open"]);
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
      if (BRIDGED.has(cmd)) {
        const r = await window.__kleioBridge(cmd, args);
        if (r && r.error) throw r.error;
        return r ? r.value : null;
      }
      if (cmd === "plugin:app|version") return "0.0.0-e2e";
      if (cmd === "plugin:event|listen") {
        const name = args?.event;
        if (typeof name === "string" && typeof args?.handler === "number") {
          if (!eventHandlers.has(name)) eventHandlers.set(name, new Set());
          eventHandlers.get(name).add(args.handler);
        }
        return nextId++;
      }
      if (cmd.startsWith("plugin:updater|")) throw new Error("no updates");
      if (cmd.startsWith("plugin:")) return null;
      return cmd in responses ? responses[cmd] : null;
    },
  };
  window.__ggEmit = (type, data) => {
    const ids = eventHandlers.get("agent-event");
    if (!ids) return 0;
    for (const id of ids) {
      callbacks.get(id)?.({ event: "agent-event", id, payload: { type, data: data ?? {} } });
    }
    return ids.size;
  };
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
}

function responsesFor({ api, projects, demo, phone }) {
  const active = {
    base: api,
    host: "mini.e2e",
    deviceId: phone.deviceId,
    label: phone.label,
    admin: false,
  };
  return {
    sidecar_port: 45678,
    kleio_remote_status: {
      active,
      paired: { baseUrl: api, ...active, pairedAt: "2026-10-02T12:00:00Z" },
    },
    agent_state: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      cwd: demo,
      mode: "code",
      running: false,
      runState: "idle",
      thinkingLevel: "medium",
      supportedThinkingLevels: ["low", "medium", "high"],
      planMode: false,
      contextWindow: 200000,
      gitBranch: null,
      isGitRepo: false,
      autopilot: false,
      tasks: [],
    },
    app_auth_status: {
      providers: [
        {
          value: "anthropic",
          label: "Anthropic",
          description: "Claude",
          methods: ["oauth"],
          connected: true,
        },
      ],
    },
    app_settings_get: { projectsRoot: projects, configured: true },
    agent_models: {
      models: [
        {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          provider: "anthropic",
          contextWindow: 200000,
        },
      ],
    },
    agent_commands: { commands: [] },
    agent_tasks: { tasks: [] },
    agent_projects: {
      projects: [{ name: "demo", path: demo, lastActiveDisplay: "now", sources: ["folder"] }],
    },
    agent_sessions: { sessions: [] },
  };
}

/** What the Rust commands do, against the real host. Errors come back as text, like Tauri's. */
function bridge({ api, preview, phone, seen }) {
  const headers = { [TOKEN_HEADER]: phone.token };
  const fileUrl = (owner, path) =>
    `${api}/kleio/workspace/files/${path.split("/").map(encodeURIComponent).join("/")}?cwd=${encodeURIComponent(owner.cwd)}`;
  return async (cmd, { owner, path, method, body: payload }) => {
    try {
      // The generic proxy (the app's health gate, Specialists list, …).
      if (cmd === "kleio_api") {
        const res = await fetch(`${api}${path}`, {
          method,
          headers: { ...headers, ...(payload ? { "content-type": "application/json" } : {}) },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        const text = await res.text();
        let body = null;
        try {
          body = text.trim() ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        return { value: { status: res.status, body } };
      }
      if (cmd === "kleio_site_open") {
        const res = await fetch(`${api}/kleio/previews`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ owner, path }),
        });
        const body = await json(res);
        if (!res.ok) return { error: body.error ?? `HTTP ${res.status}` };
        // Rust's check: the link must be on the paired host, never elsewhere.
        if (new URL(body.url).hostname !== new URL(api).hostname) return { error: "bad link" };
        seen.site = body.url;
        return { value: null };
      }
      const res = await fetch(fileUrl(owner, path), { headers });
      if (!res.ok) return { error: (await json(res)).error ?? `HTTP ${res.status}` };
      const bytes = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get("content-type") ?? "").split(";")[0];
      seen[cmd] = { path, bytes, mime, disposition: res.headers.get("content-disposition") };
      if (cmd === "kleio_file_open") return { value: null };
      return {
        value: { name: path.split("/").pop(), size: bytes.length, mime, thumbnail: null },
      };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  };
}

async function openTranscript(page) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  for (const target of ["button:has-text('Code')", ".picker-item", "text=+ New session"]) {
    await page.click(target, { timeout: 5000 }).catch(() => log(`  ! no ${target}`));
    await page.waitForTimeout(600);
  }
}

async function replyWithOutputs(page) {
  const emit = (type, data) => page.evaluate(([t, d]) => window.__ggEmit(t, d), [type, data ?? {}]);
  await page.fill("textarea", "Make me the quarterly report as a PDF and a small demo site");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  await emit("run_start", {});
  await emit("tool_call_start", {
    toolCallId: "w1",
    name: "write",
    args: { file_path: "site/index.html" },
  });
  await emit("tool_call_end", { toolCallId: "w1", result: "wrote 4 lines", isError: false });
  await emit("text_delta", {
    text:
      "Done. Here's the [Quarterly report](report.pdf) and the [Demo site](site/index.html). " +
      "I also touched [notes](src/notes.ts).",
  });
  await emit("turn_end", {
    usage: { inputTokens: 1200, outputTokens: 80, cacheRead: 0, cacheWrite: 0 },
  });
  await emit("agent_done", {});
  await emit("run_end", {});
  await page.waitForTimeout(1200);
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(cli)) throw new Error("build the host first: pnpm --filter @kleio/host build");
  const up = await fetch(appUrl).then(
    (r) => r.ok,
    () => false,
  );
  if (!up) throw new Error(`start the dev server first (${appUrl}): pnpm --filter gg-app dev`);
  mkdirSync(outDir, { recursive: true });

  const tmp = mkdtempSync(join(tmpdir(), "kleio-e2e-outputs-"));
  const projects = join(tmp, "projects");
  const demo = join(projects, "demo");
  const browser = await chromium.launch();
  let host;
  let page;
  try {
    await writeOutputs(browser, demo);
    host = await startHost(tmp);
    const seen = {};

    // 01: the cards in the iPhone transcript, sized by the host.
    const context = await browser.newContext(IPHONE);
    await context.exposeFunction("__kleioBridge", bridge({ ...host, seen }));
    await context.addInitScript(initScript, {
      responses: responsesFor({ ...host, projects, demo }),
    });
    page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") log(`  [console] ${m.text().slice(0, 160)}`);
    });
    page.on("pageerror", (e) => log(`  [page error] ${e.message.slice(0, 200)}`));
    await openTranscript(page);
    check(
      await page.evaluate(() => document.documentElement.classList.contains("platform-ios")),
      "iPhone layout (platform-ios)",
    );
    await replyWithOutputs(page);
    const pdfSize = statSync(join(demo, "report.pdf")).size;
    await page
      .getByText(`PDF document · ${Math.round(pdfSize / 1024)} KB`)
      .waitFor({ timeout: 5000 });
    check(true, `PDF card shows the host's size (${pdfSize} bytes)`);
    check(
      (await page.getByText("Website · opens in your browser").count()) === 1,
      "site card shows",
    );
    check(
      (await page.locator(".kleio-file").count()) === 2,
      "two cards (no card for src/notes.ts)",
    );
    check(seen.kleio_file_fetch?.mime === "application/pdf", "fetch came back as application/pdf");
    await page.locator(".kleio-file").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outDir, "01-cards.png") });
    log("→ 01-cards.png");

    // 02: Open the PDF. Quick Look is the shell's; here, the bytes it would get.
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForTimeout(600);
    const opened = seen.kleio_file_open;
    check(opened?.bytes.subarray(0, 5).toString() === "%PDF-", "opened bytes start with %PDF-");
    check(opened.bytes.length === pdfSize, "opened bytes match the size on disk");
    check(/^attachment/.test(opened.disposition ?? ""), "API sends the PDF as an attachment");
    check((await page.locator(".kleio-file-note").count()) === 0, "no error under the card");
    await page.screenshot({ path: join(outDir, "02-pdf.png") });
    log("→ 02-pdf.png (headless Chromium has no PDF viewer; Quick Look is the simulator's)");

    // 03: Open site → a preview link on the isolated origin, opened like Safari would.
    await page.getByRole("button", { name: "Open site", exact: true }).click();
    await page.waitForTimeout(600);
    check(
      typeof seen.site === "string" && seen.site.startsWith(`${host.preview}/p/`),
      "minted a preview link",
    );
    const safari = await browser.newContext(IPHONE);
    const site = await safari.newPage();
    const res = await site.goto(seen.site);
    const headers = res.headers();
    check(
      res.status() === 200 && headers["content-type"].startsWith("text/html"),
      "site served as HTML",
    );
    check(
      /^sandbox /.test(headers["content-security-policy"] ?? ""),
      "site carries the sandbox CSP",
    );
    const background = await site.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(background === "rgb(18, 94, 74)", "style.css loaded through the preview origin");
    await site.screenshot({ path: join(outDir, "03-site.png") });
    log("→ 03-site.png");

    // The page can't reach the API, and has no origin of its own.
    const probe = await site.evaluate(async (api) => {
      const out = {};
      try {
        await fetch(`${api}/kleio/health`);
        out.health = "readable";
      } catch {
        out.health = "blocked";
      }
      try {
        await fetch(`${api}/kleio/blobs`, { headers: { "x-kleio-device-token": "x" } });
        out.blobs = "readable";
      } catch {
        out.blobs = "blocked";
      }
      try {
        void window.localStorage.length;
        out.storage = "available";
      } catch {
        out.storage = "blocked";
      }
      try {
        void document.cookie;
        out.cookie = "available";
      } catch {
        out.cookie = "blocked";
      }
      out.origin = window.origin;
      return out;
    }, host.api);
    check(probe.health === "blocked", "site can't read the API (no CORS)");
    check(probe.blobs === "blocked", "site can't send the device header (preflight refused)");
    check(
      probe.storage === "blocked" && probe.cookie === "blocked",
      "site has no storage or cookies",
    );
    check(probe.origin === "null", "site runs on an opaque origin");
    check(
      !host.lines.some((l) => l.includes(seen.site.split("/p/")[1].split("/")[0])),
      "host logs never contain the preview token",
    );
    await safari.close();
    await context.close();
    log(`all checks passed; screenshots in ${outDir}`);
  } catch (e) {
    // Leave evidence of where the webview was when it failed.
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(outDir, "failure.png") }).catch(() => {});
      const text = await page.evaluate(() => document.body.innerText).catch(() => "");
      log(`webview text at failure:\n${text.slice(0, 800)}`);
      log(`→ failure.png`);
    }
    throw e;
  } finally {
    await browser.close();
    host?.child.kill("SIGTERM");
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
