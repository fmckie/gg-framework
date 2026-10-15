/**
 * End-to-end check: Brain (memories and Jiwa) from Settings → Setup, in a
 * sandbox. Manual, not CI: it needs a Playwright Chromium and the gg-app dev
 * server for the UI half.
 *
 * What's real: the kleio-host CLI from packages/kleio-host/dist (`init`,
 * `sidecar`, `serve`), the freshly bundled sidecar on the staged node, a
 * non-admin "iPhone (e2e)" device paired through the real pair-offer/redeem
 * flow, a chat session opened through the host, the Brain's add and edit
 * routes, and the store files they write. In Chromium, at 1440×900 and at
 * iPhone size: Setup (it opens by itself on a new device), the Brain card and
 * the Brain window, with a fake Tauri shell that sends `kleio_api` and the
 * `agent_*` Brain commands to the host with the device's token and that
 * session, as the Rust commands do.
 *
 * What's faked: the rest of the shell (a signed-in provider, a projects
 * folder, an idle agent) and the chat itself: `select_project` and
 * `agent_prompt` are recorded, not run, so no model is needed. Whether Kleio
 * then asks her questions and saves the answers needs a real host.
 *
 * Isolation: everything lives under one temp folder T (kleio-sandbox.mjs:
 * HOME and USERPROFILE = T/home, KLEIO_HOST_HOME = T/host, loopback ports).
 * The script refuses to run when any of that clashes with the real home, and
 * fails, naming it, if the real ~/.gg/chat-memories.json, chat-jiwa.json,
 * their .bak files or anything in ~/.kleio changed while it ran.
 *
 * Usage:
 *   pnpm --filter @kleio/coder build && pnpm --filter @kleio/host build
 *   pnpm --filter gg-app stage:node && pnpm --filter gg-app bundle:sidecar
 *   pnpm --filter gg-app dev             # terminal 1 (http://localhost:1420)
 *   node gg-app/scripts/e2e-brain-setup.mjs
 *
 * Output: .gg/screenshots/brain-setup/{desktop,phone}-*.png, and a summary on
 * stdout. KEEP_SANDBOX=1 keeps T; E2E_VERBOSE=1 prints the host's and
 * sidecar's output.
 */
import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fingerprint,
  fingerprintChanges,
  freePorts,
  sandboxEnv,
  sandboxProblems,
} from "./kleio-sandbox.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const cli = join(repo, "packages/kleio-host/dist/cli.js");
const sidecarBundle = join(repo, "gg-app/src-tauri/sidecar/app-sidecar.mjs");
const binDir = join(repo, "gg-app/src-tauri/binaries");
const outDir = join(repo, ".gg/screenshots/brain-setup");
const appUrl = process.env.GG_SHOT_URL ?? "http://localhost:1420";
const TOKEN_HEADER = "x-kleio-device-token";
const SESSION_HEADER = "x-gg-session";
const REAL_HOME = homedir();
/** The fake shell's projects folder. Only ever recorded: nothing opens it. */
const PROJECTS = "/e2e/projects";

const SIZES = [
  {
    name: "desktop",
    context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  },
  {
    name: "phone",
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    },
  },
];

// What the UI run types.
const MEMORY = "Works as a GP in Harrogate, three days a week.";
const MEMORY_EDITED = "Works as a GP in Harrogate, Monday to Wednesday.";
const INSTRUCTION = "Answer in British English, and keep it brief.";

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 23)} ${msg}`);

function check(ok, what) {
  if (!ok) throw new Error(`✗ ${what}`);
  log(`✓ ${what}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The real Brain files, which the run must leave alone ─────────────────────

const REAL_BRAIN_FILES = [
  "chat-memories.json",
  "chat-memories.json.bak",
  "chat-jiwa.json",
  "chat-jiwa.json.bak",
];

/** SHA-256 of a file, or "absent". Read only to hash: nothing is printed. */
function fileHash(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (e) {
    if (e?.code === "ENOENT") return "absent";
    throw e;
  }
}

function realSnapshot() {
  return {
    files: new Map(
      REAL_BRAIN_FILES.map((name) => [`~/.gg/${name}`, fileHash(join(REAL_HOME, ".gg", name))]),
    ),
    kleio: fingerprint(join(REAL_HOME, ".kleio")),
  };
}

/** What changed in the real files between two snapshots, by name, sorted. */
function realChanges(before, after) {
  const files = [...before.files.keys()]
    .sort()
    .filter((name) => before.files.get(name) !== after.files.get(name))
    .map((name) => `${name} changed`);
  const kleio = fingerprintChanges(before.kleio, after.kleio).map(
    ({ path, change }) => `~/.kleio/${path === "." ? "" : path} ${change}`,
  );
  return [...files, ...kleio];
}

// ── The real host and sidecar ────────────────────────────────────────────────

function stagedNode() {
  const found = existsSync(binDir)
    ? readdirSync(binDir).find((f) => f.startsWith("ggnode-"))
    : null;
  if (!found) throw new Error("stage node first: pnpm --filter gg-app stage:node");
  return join(binDir, found);
}

/** `kleio-host <args>`, with its output kept line by line. */
function startJob(name, args, env) {
  const child = spawn(process.execPath, [cli, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = [];
  const onData = (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) lines.push(line);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code, signal) =>
    lines.push(`[e2e] ${name} exited code=${code} signal=${signal}`),
  );
  return { name, child, lines };
}

async function waitForLine(job, pattern, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (job.lines.some((l) => pattern.test(l))) return;
    if (job.child.exitCode !== null) break;
    await sleep(100);
  }
  throw new Error(`${what}: timed out\n${job.lines.slice(-20).join("\n")}`);
}

/** The sidecar's own pid, from the endpoint file the supervisor publishes. */
function sidecarPid(env) {
  try {
    return JSON.parse(readFileSync(join(env.KLEIO_HOST_HOME, "sidecar.json"), "utf8")).pid;
  } catch {
    return null;
  }
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

/** One request through the host. `raw` sends a body exactly as given. */
async function hostCall(api, token, { method, path, body, raw, session }) {
  const sends = raw !== undefined || body !== undefined;
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      [TOKEN_HEADER]: token,
      ...(session ? { [SESSION_HEADER]: session } : {}),
      ...(sends ? { "content-type": "application/json" } : {}),
    },
    ...(sends ? { body: raw ?? JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text.trim() ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

/** The Brain routes, as the phone, in one chat session. */
function brainClient(api, token, session) {
  const call = (method, path, body, raw) =>
    hostCall(api, token, { method, path, body, raw, session });
  return {
    call,
    list: async (kind) => {
      const r = await call("GET", `/${kind}`);
      if (r.status !== 200) throw new Error(`GET /${kind}: ${r.status} ${JSON.stringify(r.body)}`);
      return kind === "memories" ? r.body.memories : r.body.jiwa;
    },
    /** Empty both, so each UI run starts on a new Brain. */
    clear: async function () {
      for (const kind of ["memories", "jiwa"]) {
        for (const entry of await this.list(kind)) {
          const r = await call("DELETE", `/${kind}/${encodeURIComponent(entry.id)}`);
          if (r.status !== 200) throw new Error(`DELETE /${kind}/${entry.id}: ${r.status}`);
        }
      }
    },
  };
}

/** The sandbox's store files, as the sidecar wrote them. */
function storeFiles(home) {
  const read = (name) => JSON.parse(readFileSync(join(home, ".gg", name), "utf8"));
  return { memories: read("chat-memories.json").memories, jiwa: read("chat-jiwa.json").jiwa };
}

async function apiChecks(brain, home) {
  const added = await brain.call("POST", "/memories", {
    text: "Ken's daughter is called Ada.",
    category: "relationship",
    importance: 4,
  });
  check(
    added.status === 200 &&
      added.body?.memory?.text === "Ken's daughter is called Ada." &&
      added.body.memories?.length === 1 &&
      added.body.hardLimit === 90,
    "POST /memories adds a memory: 200 with the snapshot and the entry",
  );
  const memoryId = added.body.memory.id;

  const edited = await brain.call("PATCH", `/memories/${encodeURIComponent(memoryId)}`, {
    text: "Ken's daughter Ada is seven.",
    category: "relationship",
    importance: 5,
  });
  check(
    edited.status === 200 &&
      edited.body?.memory?.id === memoryId &&
      edited.body.memory.text === "Ken's daughter Ada is seven." &&
      edited.body.memory.importance === 5 &&
      edited.body.memories.length === 1,
    "PATCH /memories/:id edits it in place",
  );

  const jiwaAdded = await brain.call("POST", "/jiwa", {
    text: "Use British spelling.",
    category: "voice",
    importance: 3,
  });
  check(
    jiwaAdded.status === 200 && jiwaAdded.body?.entry?.text === "Use British spelling.",
    "POST /jiwa adds an instruction",
  );
  const jiwaId = jiwaAdded.body.entry.id;
  const jiwaEdited = await brain.call("PATCH", `/jiwa/${encodeURIComponent(jiwaId)}`, {
    text: "Use British spelling, always.",
    category: "voice",
    importance: 4,
  });
  check(
    jiwaEdited.status === 200 &&
      jiwaEdited.body?.entry?.id === jiwaId &&
      jiwaEdited.body.entry.importance === 4,
    "PATCH /jiwa/:id edits it in place",
  );

  const duplicate = await brain.call("POST", "/memories", {
    text: "Ken's daughter Ada is seven.",
    category: "relationship",
    importance: 3,
  });
  check(
    duplicate.status === 409 && duplicate.body?.duplicateOf?.id === memoryId,
    `a near duplicate gets 409 with duplicateOf (${duplicate.body?.error})`,
  );

  const missing = await brain.call("PATCH", "/memories/no-such-memory", {
    text: "Anything.",
    category: "other",
    importance: 3,
  });
  check(
    missing.status === 404 && missing.body?.error === "That memory isn't in Brain any more.",
    "an id Brain doesn't have gets 404, in its own words",
  );

  const invalid = await brain.call("POST", "/jiwa", {
    text: "Be kind.",
    category: "mood",
    importance: 3,
  });
  check(
    invalid.status === 400 && String(invalid.body?.error).startsWith("Invalid Brain entry:"),
    `a category Jiwa doesn't have gets 400 (${invalid.body?.error})`,
  );

  const big = await brain.call(
    "POST",
    "/memories",
    undefined,
    JSON.stringify({ text: "x".repeat(20_000), category: "other", importance: 3 }),
  );
  check(big.status === 413, `a body over 16 KiB gets 413 (${big.status})`);

  const files = storeFiles(home);
  check(
    files.memories.length === 1 &&
      files.memories[0].text === "Ken's daughter Ada is seven." &&
      files.jiwa.length === 1 &&
      files.jiwa[0].text === "Use British spelling, always.",
    "the sandbox's chat-memories.json and chat-jiwa.json hold the saved entries",
  );
}

// ── The app, in Chromium, with the Tauri shell bridged to the host ───────────

function initScript({ responses }) {
  const callbacks = new Map();
  let nextId = 1;
  const BRIDGED = new Set([
    "kleio_api",
    "agent_memories",
    "agent_jiwa",
    "agent_delete_memory",
    "agent_delete_jiwa",
    "agent_save_memory",
    "agent_save_jiwa",
  ]);
  const RECORDED = new Set(["select_project", "agent_prompt"]);
  window.__e2eCalls = [];
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
        const r = await window.__e2eBridge(cmd, args ?? {});
        if (r.error !== undefined) throw r.error;
        return r.value;
      }
      if (RECORDED.has(cmd)) {
        window.__e2eCalls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? {})) });
        return null;
      }
      if (cmd === "plugin:app|version") return "0.0.0-e2e";
      if (cmd === "plugin:event|listen") return nextId++;
      if (cmd.startsWith("plugin:updater|")) throw new Error("no updates");
      if (cmd.startsWith("plugin:")) return null;
      return cmd in responses ? responses[cmd] : null;
    },
  };
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
}

function responsesFor({ api, phone }) {
  const active = {
    base: api,
    host: "sandbox.e2e",
    deviceId: phone.deviceId,
    label: phone.label,
    admin: false,
  };
  return {
    sidecar_port: 45678,
    kleio_remote_status: {
      active,
      paired: { baseUrl: api, ...active, pairedAt: "2026-10-15T12:00:00Z" },
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
    app_settings_get: { projectsRoot: PROJECTS, configured: true },
    agent_state: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      cwd: PROJECTS,
      mode: "chat",
      chatAgent: "general",
      running: false,
      runState: "idle",
    },
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
    agent_history: { history: [] },
    agent_local: { endpoints: [] },
    agent_projects: { projects: [] },
    agent_sessions: { sessions: [] },
  };
}

/**
 * What the Rust commands do, against the sandbox host with the phone's token:
 * kleio_api as is, and the Brain commands in the window's chat session. A
 * refusal comes back as the sidecar's own words, as sidecar_error_message
 * passes them on, and Tauri rejects with that text.
 */
function bridge({ api, token, session }) {
  const refusal = (action, r) => ({
    error:
      typeof r.body?.error === "string" && r.body.error.trim()
        ? r.body.error
        : `${action} failed: HTTP ${r.status}`,
  });
  return async (cmd, args) => {
    try {
      if (cmd === "kleio_api") {
        const r = await hostCall(api, token, {
          method: String(args.method).toUpperCase(),
          path: args.path,
          body: args.body ?? undefined,
          session: args.session ?? undefined,
        });
        return { value: r };
      }
      const kind = cmd.endsWith("jiwa") ? "jiwa" : "memories";
      const call = (method, path, body) => hostCall(api, token, { method, path, body, session });
      if (cmd === "agent_memories" || cmd === "agent_jiwa") {
        const r = await call("GET", `/${kind}`);
        return r.status === 200 ? { value: r.body } : refusal("load", r);
      }
      if (cmd === "agent_delete_memory" || cmd === "agent_delete_jiwa") {
        const r = await call("DELETE", `/${kind}/${encodeURIComponent(args.id)}`);
        return r.status === 200 ? { value: r.body } : refusal("delete", r);
      }
      // agent_save_memory / agent_save_jiwa: brain_save_route in lib.rs.
      const entry = { text: args.text, category: args.category, importance: args.importance };
      const r =
        args.id == null
          ? await call("POST", `/${kind}`, entry)
          : await call("PATCH", `/${kind}/${encodeURIComponent(args.id)}`, entry);
      return r.status === 200 ? { value: r.body } : refusal("save", r);
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  };
}

/** The focused element, by its name: aria-label, else its text. */
const focusedName = (page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute("aria-label") ??
      document.activeElement?.textContent?.trim() ??
      "",
  );

/** Wait for the Brain window's live region to say `text`. */
const spoken = (page, text) =>
  page.waitForFunction(
    (expected) => document.querySelector('.memory-modal [role="status"]')?.textContent === expected,
    text,
    { timeout: 10_000 },
  );

/**
 * Setup → the Brain card (empty) → Open Brain → add a memory, edit it, try a
 * duplicate, add a Jiwa instruction → close → the counts → Introduce yourself.
 * One screenshot per state.
 */
async function runUi(browser, size, ctx) {
  const context = await browser.newContext(size.context);
  await context.exposeFunction("__e2eBridge", bridge(ctx));
  await context.addInitScript(initScript, { responses: responsesFor(ctx) });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") log(`  [console] ${m.text().slice(0, 200)}`);
  });
  const shots = [];
  const shot = async (step) => {
    const file = `${size.name}-${step}.png`;
    await page.waitForTimeout(350); // let entrances settle
    await page.screenshot({ path: join(outDir, file) });
    shots.push(file);
    log(`  → ${file}`);
  };

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const phone = await page.evaluate(() =>
    document.documentElement.classList.contains("platform-ios"),
  );
  check(phone === (size.name === "phone"), `${size.name}: platform-ios is ${phone}`);

  // Setup opens by itself on a new device; the Brain card is last, empty.
  await page.getByRole("heading", { level: 1, name: "Setup" }).waitFor({ timeout: 20_000 });
  const card = page.getByRole("region", { name: "Brain" });
  await card.getByText("Not set up").waitFor({ timeout: 15_000 });
  check(
    (await card
      .getByText(
        "Nothing yet. Introduce yourself: Kleio asks a few short questions and saves your answers.",
      )
      .count()) === 1,
    `${size.name}: the empty card says how to start`,
  );
  await card.scrollIntoViewIfNeeded();
  await shot("01-card-empty");

  // The Brain window, empty.
  await card.getByRole("button", { name: "Open Brain" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("No durable memories yet.").waitFor({ timeout: 10_000 });
  await shot("02-brain-empty");

  // 1. Add a memory.
  await dialog.getByRole("button", { name: "Add memory" }).click();
  let form = dialog.getByRole("form", { name: "New memory" });
  await form.waitFor();
  check(
    (await page.evaluate(() => document.activeElement?.tagName)) === "TEXTAREA",
    `${size.name}: the editor opens with focus in the text field`,
  );
  await form.getByRole("textbox", { name: "Memory" }).fill(MEMORY);
  await form.getByRole("radio", { name: "Identity" }).check();
  await form.getByRole("radio", { name: "4" }).check();
  await shot("03-add-form");
  await form.getByRole("button", { name: "Save" }).click();
  await dialog.locator(".memory-table-text", { hasText: MEMORY }).waitFor({ timeout: 10_000 });
  await spoken(page, "Memory added.");
  check((await focusedName(page)) === "Add memory", `${size.name}: focus is back on Add memory`);
  const [added] = await ctx.brain.list("memories");
  check(
    added?.text === MEMORY && added.category === "identity" && added.importance === 4,
    `${size.name}: the host has the memory as typed (identity, 4)`,
  );
  await shot("04-added");

  // 2. Edit it.
  await dialog.getByRole("button", { name: `Edit memory: ${MEMORY}` }).click();
  form = dialog.getByRole("form", { name: "Edit memory" });
  await form.waitFor();
  check(
    await form.getByRole("button", { name: "Save" }).isDisabled(),
    `${size.name}: Save is off until something changes`,
  );
  await form.getByRole("textbox", { name: "Memory" }).fill(MEMORY_EDITED);
  await form.getByRole("radio", { name: "5" }).check();
  await shot("05-edit-form");
  await form.getByRole("button", { name: "Save" }).click();
  await dialog
    .locator(".memory-table-text", { hasText: MEMORY_EDITED })
    .waitFor({ timeout: 10_000 });
  await spoken(page, "Memory saved.");
  check(
    (await focusedName(page)) === `Edit memory: ${MEMORY_EDITED}`,
    `${size.name}: focus is back on the row's Edit`,
  );
  const memories = await ctx.brain.list("memories");
  check(
    memories.length === 1 &&
      memories[0].id === added.id &&
      memories[0].text === MEMORY_EDITED &&
      memories[0].importance === 5,
    `${size.name}: the host edited the same memory`,
  );
  await shot("06-edited");

  // 3. A duplicate: refused in the sidecar's words, the draft kept.
  await dialog.getByRole("button", { name: "Add memory" }).click();
  form = dialog.getByRole("form", { name: "New memory" });
  await form.getByRole("textbox", { name: "Memory" }).fill(MEMORY_EDITED);
  await form.getByRole("button", { name: "Save" }).click();
  const refusal = form.getByRole("alert");
  await refusal.waitFor({ timeout: 10_000 });
  const refusalText = (await refusal.textContent()) ?? "";
  check(
    refusalText === `Brain already has one like this: “${MEMORY_EDITED}”`,
    `${size.name}: a duplicate is refused in the sidecar's words`,
  );
  check(
    (await form.getByRole("textbox", { name: "Memory" }).inputValue()) === MEMORY_EDITED,
    `${size.name}: the refused draft is kept`,
  );
  await shot("07-duplicate");
  await form.getByRole("button", { name: "Cancel" }).click();
  check(
    (await ctx.brain.list("memories")).length === 1,
    `${size.name}: still one memory on the host`,
  );

  // 4. On the Jiwa tab, add an instruction.
  await dialog.getByRole("tab", { name: "Jiwa" }).click();
  await dialog.getByText("No Jiwa instructions yet.").waitFor();
  await dialog.getByRole("button", { name: "Add instruction" }).click();
  form = dialog.getByRole("form", { name: "New Jiwa instruction" });
  await form.getByRole("textbox", { name: "Instruction" }).fill(INSTRUCTION);
  await form.getByRole("radio", { name: "Voice" }).check();
  await form.getByRole("button", { name: "Save" }).click();
  await dialog.locator(".memory-table-text", { hasText: INSTRUCTION }).waitFor();
  await spoken(page, "Instruction added.");
  const [instruction] = await ctx.brain.list("jiwa");
  check(
    instruction?.text === INSTRUCTION &&
      instruction.category === "voice" &&
      instruction.importance === 3,
    `${size.name}: the host has the instruction (voice, 3)`,
  );
  await shot("08-jiwa-added");

  // 5–6. Close: the card counts again, and focus is back on Open Brain.
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await card.getByText("1 memory and 1 Jiwa instruction.").waitFor({ timeout: 10_000 });
  check((await card.getByText("Done").count()) === 1, `${size.name}: the card says Done`);
  check((await focusedName(page)) === "Open Brain", `${size.name}: focus is back on Open Brain`);
  await card.scrollIntoViewIfNeeded();
  await shot("09-card-counts");

  // 7. Introduce yourself: a new chat with Kleio, the prompt as its chip.
  await card.getByRole("button", { name: "Introduce yourself" }).click();
  await page
    .locator(".user-msg.command", { hasText: "Introduce yourself" })
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const prompt = await page.evaluate(
    async () => (await import("/src/kleio/introduce.ts")).INTRODUCE_PROMPT,
  );
  const calls = await page.evaluate(() => window.__e2eCalls);
  const selects = calls.filter((c) => c.cmd === "select_project");
  const prompts = calls.filter((c) => c.cmd === "agent_prompt");
  check(
    selects.length === 1 &&
      JSON.stringify(selects[0].args) ===
        JSON.stringify({ mode: "chat", chatAgent: "general", cwd: PROJECTS, sessionPath: null }),
    `${size.name}: one select_project, a new chat with the general agent`,
  );
  check(
    prompts.length === 1 && prompts[0].args.text === prompt,
    `${size.name}: one agent_prompt, carrying INTRODUCE_PROMPT`,
  );
  check(
    (await page.getByText(prompt.slice(0, 60)).count()) === 0,
    `${size.name}: the transcript shows the chip, not the prompt`,
  );
  await shot("10-introduce-chat");

  check(errors.length === 0, `${size.name}: no page errors (${errors.join("; ") || "none"})`);
  await context.close();
  return shots;
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const [file, how] of [
    [cli, "pnpm --filter @kleio/host build"],
    [sidecarBundle, "pnpm --filter gg-app bundle:sidecar"],
  ]) {
    if (!existsSync(file)) throw new Error(`missing ${file}: ${how}`);
  }
  const up = await fetch(appUrl).then(
    (r) => r.ok,
    () => false,
  );
  if (!up) throw new Error(`start the dev server first (${appUrl}): pnpm --filter gg-app dev`);
  mkdirSync(outDir, { recursive: true });

  const before = realSnapshot();
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "kleio-e2e-brain-")));
  const { api: apiPort, preview: previewPort } = await freePorts();
  const env = sandboxEnv({
    sandbox,
    baseEnv: process.env,
    apiPort,
    previewPort,
    sidecarPath: sidecarBundle,
    nodeBin: stagedNode(),
  });
  const problems = sandboxProblems({ sandbox, env, realHome: REAL_HOME });
  if (problems.length > 0) {
    rmSync(sandbox, { recursive: true, force: true });
    throw new Error(`refusing to run:\n  ${problems.join("\n  ")}`);
  }
  mkdirSync(env.HOME, { recursive: true });
  mkdirSync(env.KLEIO_SIDECAR_CWD, { recursive: true });
  const api = env.KLEIO_PUBLIC_URL;
  log(`sandbox ${sandbox}`);

  const summary = { api: [], ui: {} };
  let browser;
  let sidecar;
  let host;
  let failure = null;
  try {
    execFileSync(process.execPath, [cli, "init"], { env, stdio: "ignore" });
    sidecar = startJob("sidecar", ["sidecar"], env);
    await waitForLine(sidecar, /endpoint published/, 120_000, "sidecar start");
    host = startJob("host", ["serve"], env);
    await waitForLine(host, /\[host\] listening/, 15_000, "host start");
    const phone = await pairPhone(env, api);

    // A chat session, as the app opens one for its window.
    const opened = await hostCall(api, phone.token, {
      method: "POST",
      path: "/session",
      body: { mode: "chat" },
    });
    check(
      opened.status === 200 && typeof opened.body?.sessionId === "string",
      "a chat session opened through the host",
    );
    const session = opened.body.sessionId;
    const brain = brainClient(api, phone.token, session);
    const noSession = await hostCall(api, phone.token, {
      method: "POST",
      path: "/memories",
      body: { text: "No session.", category: "other", importance: 3 },
    });
    check(noSession.status === 404, "without a session, the Brain routes answer 404");

    // API: add and edit for both, every refusal, and the files on disk.
    await apiChecks(brain, env.HOME);
    summary.api = ["add", "edit", "409", "404", "400", "413", "files"];

    // UI, at each size, each on a new Brain.
    browser = await chromium.launch();
    for (const size of SIZES) {
      await brain.clear();
      log(`UI at ${size.name} size`);
      summary.ui[size.name] = await runUi(browser, size, {
        api,
        token: phone.token,
        session,
        phone,
        brain,
      });
      const files = storeFiles(env.HOME);
      check(
        files.memories.length === 1 &&
          files.memories[0].text === MEMORY_EDITED &&
          files.jiwa.length === 1 &&
          files.jiwa[0].text === INSTRUCTION,
        `${size.name}: the sandbox's files hold what the window saved`,
      );
    }
  } catch (e) {
    failure = e;
  } finally {
    await browser?.close().catch(() => {});
    host?.child.kill("SIGTERM");
    sidecar?.child.kill("SIGTERM");
    await sleep(2_000);
    for (const job of [host, sidecar]) {
      if (job && job.child.exitCode === null) job.child.kill("SIGKILL");
    }
    // The supervisor's own child may outlive it: stop it too.
    const pid = sidecarPid(env);
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    if (process.env.E2E_VERBOSE === "1") {
      for (const job of [sidecar, host]) if (job) console.log(job.lines.join("\n"));
    }
    if (process.env.KEEP_SANDBOX !== "1") rmSync(sandbox, { recursive: true, force: true });
  }
  const changes = realChanges(before, realSnapshot());
  if (changes.length > 0)
    throw new Error(`✗ the real Kleio files changed:\n  ${changes.join("\n  ")}`);
  log("✓ the real ~/.gg Brain files and ~/.kleio are unchanged");
  if (failure) throw failure;
  console.log(JSON.stringify({ ok: true, ...summary }));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
