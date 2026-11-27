// iPhone screen audit harness (throwaway, git-ignored). The real app from this
// worktree's Vite server, in headless Chromium, behind a fake Tauri shell with
// made-up data. Each screen is captured as a phone (393x852, 3x, touch, iPhone
// user agent: the app tags <html> platform-ios itself) and as a desktop
// (1440x900), measured, and compared.
//
//   import { both } from "./lib.mjs";
//   await both({ area: "lists" }, async (app) => {
//     await app.tap(app.page.getByRole("button", { name: "Code", exact: true }));
//     await app.capture("projects");
//   });
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { defaultApi, hostData, responses as baseResponses } from "./base.mjs";
import { coveredInPage, measureInPage } from "./measure.mjs";

export * as base from "./base.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../../..");
export const SHOTS = path.join(REPO, ".gg/screenshots/iphone-audit");
export const URL = process.env.GG_AUDIT_URL ?? "http://127.0.0.1:54708/";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
export const DEVICES = {
  phone: {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

/** Runs in the page before the app: the Tauri shell, faked. Every command goes
 *  to Node (`__ggHost`), so a scene answers it with ordinary functions. */
function fakeTauri({ storage }) {
  const callbacks = new Map();
  const eventHandlers = new Map();
  let nextId = 1;
  try {
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  } catch {
    // No storage: the app copes.
  }
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
    invoke(cmd, args) {
      if (cmd === "plugin:app|version") return Promise.resolve("0.0.0-audit");
      if (cmd === "plugin:event|listen") {
        const name = args?.event;
        const handler = args?.handler;
        if (typeof name === "string" && typeof handler === "number") {
          if (!eventHandlers.has(name)) eventHandlers.set(name, new Set());
          eventHandlers.get(name).add(handler);
        }
        return Promise.resolve(nextId++);
      }
      if (cmd.startsWith("plugin:updater|")) return Promise.reject(new Error("no updates"));
      // Native dialogs (file pickers, confirms) reach the scene's `invoke`;
      // every other plugin is answered with nothing.
      if (cmd.startsWith("plugin:") && !cmd.startsWith("plugin:dialog|")) return Promise.resolve(null);
      let plain = null;
      try {
        plain = JSON.parse(JSON.stringify(args ?? null));
      } catch {
        plain = null;
      }
      return window.__ggHost(cmd, plain).then((r) => {
        if (r && r.__reject) throw r.__reject;
        return r ? r.value : null;
      });
    },
  };
  // Replays what the shell forwards: `agent-event` by default, or any event.
  window.__ggEmit = (type, data, event) => {
    const name = event || "agent-event";
    const ids = eventHandlers.get(name) ?? [];
    for (const id of ids) {
      const payload = event ? data : { type, data: data ?? {} };
      callbacks.get(id)?.({ event: name, id, payload });
    }
    return ids.size ?? 0;
  };
  window.__ggEvents = () => [...eventHandlers.keys()];
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
}

let browserPromise = null;
const browser = () => (browserPromise ??= chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE }));
export const closeBrowser = async () => (await browserPromise)?.close();

/**
 * Open the app as `device` ("phone" | "desktop") and hand `fn` an `app`:
 *   page, device, isPhone
 *   tap(target)            target: a Locator or a selector; tap on the phone, click on the desktop
 *   emit(type, data)       an agent event, as the shell forwards it
 *   emitEvent(name, data)  any other Tauri event
 *   calls()                every command the app invoked: [{ cmd, args }]
 *   capture(screen, opts)  screenshot(s) + measurements for this device
 *   settle(ms)
 * `scene`:
 *   area        folder under .gg/screenshots/iphone-audit/
 *   responses   { command: reply } over base.responses
 *   invoke      (cmd, args) => reply | undefined (undefined falls through)
 *   api         ({ method, path, body, session }) => { status, body } | undefined
 *   data        replaces parts of base.hostData()
 *   storage     localStorage entries set before the app loads
 *   now         a Date: freezes Date.now() (timers still run)
 */
export async function withApp(device, scene, fn) {
  const b = await browser();
  const context = await b.newContext(DEVICES[device]);
  const calls = [];
  const unknownCommands = new Set();
  const unknownRoutes = new Set();
  const errors = [];
  const data = { ...hostData(), ...scene.data };
  const responses = { ...baseResponses, ...scene.responses };
  await context.exposeBinding("__ggHost", async (_source, cmd, args) => {
    calls.push({ cmd, args });
    try {
      const own = await scene.invoke?.(cmd, args, { data, device });
      if (own !== undefined) return { value: own };
      if (cmd === "kleio_api") {
        const req = { method: args?.method ?? "GET", path: args?.path ?? "", body: args?.body, session: args?.session };
        const reply = (await scene.api?.(req, { data, device })) ?? defaultApi(req, data);
        if (reply) return { value: reply };
        unknownRoutes.add(`${req.method} ${req.path}`);
        return { value: { status: 404, body: { error: "not in the harness" } } };
      }
      if (cmd in responses) return { value: responses[cmd] };
      if (cmd.startsWith("plugin:")) return { value: null };
      unknownCommands.add(cmd);
      return { value: null };
    } catch (e) {
      return { __reject: String(e?.message ?? e) };
    }
  });
  await context.addInitScript(fakeTauri, { storage: { "kleio-setup-seen": "1", ...scene.storage } });
  const page = await context.newPage();
  if (scene.now) await page.clock.setFixedTime(scene.now);
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(scene.boot ?? 1800);
  const isPhone = device === "phone";
  const loc = (t) => (typeof t === "string" ? page.locator(t).first() : t);
  const app = {
    page,
    device,
    isPhone,
    data,
    settle: (ms = 500) => page.waitForTimeout(ms),
    async tap(target, opts = {}) {
      const l = loc(target);
      await (isPhone ? l.tap({ timeout: 5000, ...opts }) : l.click({ timeout: 5000, ...opts }));
      await page.waitForTimeout(opts.settle ?? 500);
    },
    emit: (type, d = {}) => page.evaluate(([t, x]) => window.__ggEmit(t, x), [type, d]),
    emitEvent: (name, d = {}) => page.evaluate(([n, x]) => window.__ggEmit(null, x, n), [name, d]),
    calls: () => calls.slice(),
    capture: (screen, opts = {}) =>
      capture(page, { area: scene.area, screen, device, errors, unknownCommands, unknownRoutes, ...opts }),
  };
  try {
    return await fn(app);
  } finally {
    await context.close();
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Screenshot and measure the screen as it stands. Writes
 *   <area>/<screen>--<device>.png        the viewport
 *   <area>/<screen>--<device>-2.png …    the main scroller, paged (unless scroll: false)
 *   <area>/<screen>--<device>.json       the measurements
 * opts: scroll (default true), note, element (a selector: also save a close-up).
 */
async function capture(page, { area, screen, device, errors, unknownCommands, unknownRoutes, scroll = true, note, element }) {
  const dir = path.join(SHOTS, slug(area));
  await mkdir(dir, { recursive: true });
  const stem = path.join(dir, `${slug(screen)}--${device}`);
  const record = await page.evaluate(measureInPage);
  await page.screenshot({ path: `${stem}.png` });
  const shots = [`${stem}.png`];
  if (element) {
    const el = page.locator(element).first();
    if (await el.isVisible().catch(() => false)) {
      await el.screenshot({ path: `${stem}-closeup.png` }).catch(() => {});
      shots.push(`${stem}-closeup.png`);
    }
  }
  // Page the largest scroller, and note what stays covered at its end.
  if (scroll && record.scrollers.length > 0) {
    const pages = await page.evaluate(async () => {
      const all = [...document.querySelectorAll("body *")].filter((el) => {
        const cs = getComputedStyle(el);
        return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 24 && el.getBoundingClientRect().width > 0 && !el.closest("[inert]");
      });
      all.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      const el = all[0];
      if (!el) return 0;
      window.__ggScroller = el;
      window.__ggScrollTop = el.scrollTop;
      return Math.min(4, Math.ceil((el.scrollHeight - el.clientHeight) / (el.clientHeight * 0.85)));
    });
    for (let i = 1; i <= pages; i++) {
      await page.evaluate((n) => {
        const el = window.__ggScroller;
        el.scrollTop = Math.min(el.scrollHeight, window.__ggScrollTop + n * el.clientHeight * 0.85);
      }, i);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${stem}-${i + 1}.png` });
      shots.push(`${stem}-${i + 1}.png`);
    }
    if (pages > 0) {
      await page.evaluate(() => {
        const el = window.__ggScroller;
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(200);
      record.coveredAtEnd = await page.evaluate(coveredInPage);
      await page.evaluate(() => {
        window.__ggScroller.scrollTop = window.__ggScrollTop;
      });
      await page.waitForTimeout(150);
    }
  }
  Object.assign(record, {
    area,
    screen,
    device,
    note,
    shots: shots.map((s) => path.relative(REPO, s)),
    errors: errors.slice(),
    unknownCommands: [...unknownCommands],
    unknownRoutes: [...unknownRoutes],
  });
  await writeFile(`${stem}.json`, JSON.stringify(record, null, 1));
  console.log(summary(record));
  return record;
}

const short = (c) => `${c.name || "(no name)"} [${c.variant || c.el}] ${c.w}x${c.h}${c.hit ? ` hit ${c.hit.w}x${c.hit.h}` : ""}`;

/** One screen on one device, in a few lines. The JSON has the rest. */
export function summary(r) {
  const out = [`\n== ${r.area}/${r.screen} (${r.device} ${r.viewport.w}x${r.viewport.h}) html="${r.html}"`];
  const live = r.controls.filter((c) => !c.disabled);
  const small = live.filter((c) => c.small);
  out.push(`controls ${r.controls.length}; under 44x44: ${small.length}`);
  if (r.device === "phone") for (const c of small) out.push(`  small: ${short(c)}`);
  const push = (label, list, fmt) => {
    if (list?.length) {
      out.push(`${label}: ${list.length}`);
      for (const x of list.slice(0, 12)) out.push(`  ${fmt(x)}`);
      if (list.length > 12) out.push(`  … ${list.length - 12} more in the JSON`);
    }
  };
  if (r.page.sideways) out.push(`PAGE SCROLLS SIDEWAYS: ${r.page.scrollWidth} > ${r.page.clientWidth}`);
  push("past the edge", r.pastEdge, (x) => `${x.el} "${x.text}" left ${x.left} right ${x.right}`);
  push("cut by a clipping parent", r.clippedX, (x) => `${x.el} "${x.text}" right ${x.right} by ${x.by}`);
  push("sideways scrollers", r.hScrollers, (x) => `${x.el} ${x.scrollWidth} in ${x.clientWidth}`);
  push("controls covered", r.controls.filter((c) => c.covered), (c) => `${short(c)} by ${c.covered}`);
  push("controls covered at the scroller's end", r.coveredAtEnd, (c) => `${c.name} by ${c.by}`);
  push("controls clipped", r.controls.filter((c) => c.clipped), (c) => `${short(c)} by ${c.clipped.by} (${c.clipped.px}px)`);
  push("controls overlapping", r.overlaps, (o) => `${o.a} × ${o.b} (${o.px})`);
  push("labels on 2+ lines", r.controls.filter((c) => c.lines), (c) => `${short(c)}: ${c.lines} lines`);
  push("labels spilling", r.controls.filter((c) => c.spill), (c) => `${short(c)}: ${c.spill}px`);
  push("unreachable below", r.unreachable, (x) => `${x.name} <${x.el}> top ${x.top}`);
  push("text cut off", r.truncated, (x) => `${x.how}: ${x.el} "${x.text}"`);
  push("desktop keys/words", r.hints, (x) => `${x.kind}: "${x.text}" <${x.el}>`);
  push("hover-only", r.hoverOnly, (x) => `${x.el} "${x.name}" controls ${x.controls} ruleApplies ${x.ruleApplies} :: ${x.rule}`);
  push("clickable non-controls", r.pointerRows, (x) => `${x.el} "${x.name}" ${x.w}x${x.h}`);
  push("errors", r.errors, (x) => x);
  push("commands with no made-up reply", r.unknownCommands, (x) => x);
  push("host routes with no made-up reply", r.unknownRoutes, (x) => x);
  out.push(`shots: ${r.shots.join(", ")}`);
  return out.join("\n");
}

/** Phone against desktop for one captured screen: what is missing, reordered or restyled. */
export async function compare(area, screen) {
  const read = async (device) =>
    JSON.parse(await readFile(path.join(SHOTS, slug(area), `${slug(screen)}--${device}.json`), "utf8"));
  const [phone, desktop] = await Promise.all([read("phone"), read("desktop")]);
  const key = (c) => c.name.toLowerCase();
  const named = (r) => r.controls.filter((c) => c.name);
  const p = named(phone);
  const d = named(desktop);
  const pNames = new Set(p.map(key));
  const dNames = new Set(d.map(key));
  const missing = [...new Map(d.filter((c) => !pNames.has(key(c))).map((c) => [key(c), c])).values()];
  const extra = [...new Map(p.filter((c) => !dNames.has(key(c))).map((c) => [key(c), c])).values()];
  const order = (list, other) => [...new Set(list.map(key).filter((k) => other.has(k)))];
  const pOrder = order(p, dNames);
  const dOrder = order(d, pNames);
  const restyled = [];
  for (const c of p) {
    const twin = d.find((x) => key(x) === key(c));
    const strip = (v) => v.replace(/\b(btn-sm|btn-lg)\b/g, "").replace(/\s+/g, " ").trim();
    if (twin && strip(twin.variant) !== strip(c.variant)) {
      restyled.push(`${c.name}: desktop [${twin.variant}] phone [${c.variant}]`);
    }
  }
  const out = [`\n## compare ${area}/${screen}`];
  out.push(`desktop controls not on the phone (${missing.length}):`);
  for (const c of missing) out.push(`  ${short(c)} in ${c.group}`);
  out.push(`phone controls not on the desktop (${extra.length}):`);
  for (const c of extra) out.push(`  ${short(c)} in ${c.group}`);
  if (pOrder.join("|") !== dOrder.join("|")) {
    out.push("ORDER DIFFERS (shared controls, visual order):");
    out.push(`  desktop: ${dOrder.join(" · ")}`);
    out.push(`  phone:   ${pOrder.join(" · ")}`);
  } else out.push("order of shared controls: same");
  out.push(`variant differs (${restyled.length}):`);
  for (const x of [...new Set(restyled)]) out.push(`  ${x}`);
  const text = out.join("\n");
  await writeFile(path.join(SHOTS, slug(area), `${slug(screen)}--compare.txt`), text);
  console.log(text);
  return text;
}

/** Run the same steps as a phone, then as a desktop, then compare every screen
 *  both captured. `fn(app)` branches on `app.isPhone` where the two differ. */
export async function both(scene, fn) {
  const seen = { phone: [], desktop: [] };
  for (const device of (process.env.GG_AUDIT_DEVICES ?? "phone,desktop").split(",")) {
    try {
      await withApp(device, scene, async (app) => {
        const inner = app.capture;
        app.capture = async (screen, opts) => {
          seen[device].push(screen);
          return inner(screen, opts);
        };
        await fn(app);
      });
    } catch (e) {
      console.log(`\n!! ${scene.area} as ${device} stopped: ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
  for (const screen of seen.phone) {
    if (seen.desktop.includes(screen)) await compare(scene.area, screen);
    else console.log(`\n!! ${scene.area}/${screen}: no desktop capture to compare`);
  }
}

/** Kleio home → Code → the first project → a fresh session, to the composer. */
export async function enterSession(app) {
  const { page } = app;
  const textarea = page.locator("textarea.input");
  for (const target of [
    page.getByRole("button", { name: "Code", exact: true }),
    page.locator(".picker-item").first(),
    page.getByText("+ New session").first(),
  ]) {
    if (await textarea.isVisible().catch(() => false)) break;
    await app.tap(target, { settle: 700 }).catch(() => {});
  }
  if (!(await textarea.isVisible().catch(() => false))) throw new Error("never reached the composer");
}
