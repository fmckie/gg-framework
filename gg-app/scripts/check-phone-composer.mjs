// Run: pnpm --filter gg-app exec node scripts/check-phone-composer.mjs
// Requires Playwright's Chromium. Starts a Vite dev server on a free port, or
// set GG_PHONE_URL to use one that is already running (`pnpm --filter gg-app dev`).
//
// The iPhone composer and transcript, checked in the real App at an iPhone 16
// viewport (390x844) with an iPhone user agent, so the app tags <html>
// `platform-ios` and loads its phone layout. A fake Tauri IPC layer stands in
// for the shell and records every command the webview invokes. It proves:
//   1. the @muse chip addresses the draft and focuses the input;
//   2. mid-run, the round button sends a @muse question as a helper prompt
//      (agent_ken_prompt) instead of stopping, and stays Stop for other drafts;
//   3. with the on-screen keyboard up, Return still adds a line (no send);
//   4. with an empty draft, the round button still stops the run (agent_cancel);
//   5. the @muse highlight wraps like the textarea, so the caret lands at the
//      end of the visible text (with a control showing the old 15px misses);
//   6. the transcript never scrolls sideways, and the status dots are drawn
//      circles centred on their line.
// Screenshots go to gg-app/.gg/phone-composer/ (git-ignored).
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = path.join(root, ".gg/phone-composer");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const CWD = "/Users/demo/projects/kleio-website";
const QUESTION = "what happened while I was away? Did the screenshots get retaken";

const responses = {
  sidecar_port: 45678,
  agent_state: {
    provider: "anthropic",
    model: "claude-opus-4-5",
    cwd: CWD,
    mode: "code",
    running: false,
    runState: "idle",
    thinkingLevel: "high",
    supportedThinkingLevels: ["low", "medium", "high"],
    planMode: false,
    contextWindow: 200000,
    gitBranch: "main",
    isGitRepo: true,
    autopilot: false,
    kenProvider: "anthropic",
    kenModel: "claude-opus-4-5",
    kenModelOverride: false,
    tasks: [],
  },
  app_settings_get: { projectsRoot: "/Users/demo/projects", configured: true },
  agent_projects: {
    projects: [{ name: "kleio-website", path: CWD, lastActiveDisplay: "2m ago", sources: [] }],
  },
  agent_sessions: { sessions: [] },
  agent_models: { models: [] },
  agent_commands: { commands: [] },
  agent_tasks: { tasks: [] },
  agent_memories: { memories: [] },
  kleio_remote_status: {
    active: {
      base: "http://100.64.0.1:8787",
      host: "mac-mini-1",
      deviceId: "harness-iphone",
      label: "iPhone",
      admin: false,
    },
    paired: null,
  },
};

/** Runs in the page before the app: the Tauri shell, faked and recorded. */
function fakeTauri({ responses }) {
  const callbacks = new Map();
  const eventHandlers = new Map();
  const calls = [];
  let nextId = 1;
  window.__ggCalls = calls;
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
      if (cmd === "plugin:app|version") return Promise.resolve("0.0.0-harness");
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
      if (cmd.startsWith("plugin:")) return Promise.resolve(null);
      calls.push({ cmd, args: args ?? null });
      if (cmd === "kleio_api") {
        return Promise.resolve(
          args?.path === "/kleio/health"
            ? { status: 200, body: { ok: true } }
            : { status: 404, body: { error: "not in the harness" } },
        );
      }
      return Promise.resolve(cmd in responses ? responses[cmd] : null);
    },
  };
  // Replays what the shell forwards from the sidecar's event stream.
  window.__ggEmit = (type, data) => {
    for (const id of eventHandlers.get("agent-event") ?? []) {
      callbacks.get(id)?.({ event: "agent-event", id, payload: { type, data: data ?? {} } });
    }
  };
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert(address && typeof address !== "string");
  await new Promise((resolve) => probe.close(resolve));
  return address.port;
}

const step = (label) => console.log(`- ${label}`);

async function run(page) {
  const emit = (type, data = {}) => page.evaluate(([t, d]) => window.__ggEmit(t, d), [type, data]);
  const calls = () => page.evaluate(() => window.__ggCalls.map((c) => ({ ...c })));
  const callCount = async (cmd) => (await calls()).filter((c) => c.cmd === cmd).length;
  const roundButton = ".inputactions-trailing .icon-circle-primary";
  const roundTitle = () => page.getAttribute(roundButton, "title");
  const shot = async (name, options = {}) => {
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, ...options });
    console.log(`  screenshot: ${path.relative(root, file)}`);
  };

  // ── Into a session ────────────────────────────────────────────────────
  const textarea = page.locator("textarea.input");
  if (!(await textarea.isVisible().catch(() => false))) {
    // Kleio home → Code → the project → a fresh session.
    for (const target of [
      page.getByRole("button", { name: "Code", exact: true }),
      page.locator(".picker-item").first(),
      page.getByText("+ New session").first(),
    ]) {
      await target
        .click({ timeout: 3000 })
        .then(() => page.waitForTimeout(600))
        .catch(() => {});
      if (await textarea.isVisible().catch(() => false)) break;
    }
  }
  if (!(await textarea.isVisible().catch(() => false))) {
    await shot("no-composer");
    throw new Error("never reached the composer (see no-composer.png)");
  }
  assert(
    await page.evaluate(() => document.documentElement.classList.contains("platform-ios")),
    "the app should tag <html> platform-ios for an iPhone user agent",
  );

  // ── A run in flight, like the second screenshot ───────────────────────
  step("seed a run: long reply, four sub-agents, three tool rows");
  await textarea.fill("Map the screens the new Kleio app really has, then retake the screenshots");
  await page.tap(roundButton);
  await page.waitForTimeout(250);
  assert.equal(await callCount("agent_prompt"), 1, "an idle round button sends to the coder");
  await emit("run_start");
  await emit("thinking_delta", { text: "…" });
  // The last one is still working, so its dot (not a tick) is on screen.
  const agents = [
    ["specialists", 37800, 4900, 10500, 8, "closed"],
    ["groups", 43300, 45700, 6900, 10, "closed"],
    ["apps_models", 36700, 4900, 9300, 7, "closed"],
    ["connection_native", 132200, 478600, 10800, 21, "running"],
  ];
  for (const [name, input, cacheRead, output, tools, state] of agents) {
    await emit("subagent_state", {
      agent_id: `sa-${name}`,
      task_name: name,
      state,
      current_activity: state === "running" ? "Read src/kleio/ConnectionPage.tsx" : undefined,
      started_at: 0,
      updated_at: 512000,
      elapsed_ms: 512000,
      turn_count: 6,
      tool_use_count: tools,
      token_usage: { input, output, cacheRead },
    });
  }
  await page.waitForTimeout(400);
  for (const chunk of [
    "I checked the exact navigation wiring in `App.tsx`, the views, how Specialists, ",
    "Groups and Settings render, and the host API types, so the fake data matches what ",
    "the pages really expect. The capture script lives at ",
    "`/var/folders/c4/4h8qvm0s7cj6vfdcc_2368/T/kleio-screens/capture-screenshots.mjs` ",
    "and its notes are at https://github.com/kleio-app/kleio-website/blob/main/docs/",
    "screenshots-inventory-for-the-new-app-and-the-old-one.md\n\n",
    "Now the remaining shapes: the connection page and pairing modal need status, ",
    "devices, offers and Tailscale, plus the entry type the specialist chat renders.",
  ]) {
    await emit("text_delta", { text: chunk });
    await page.waitForTimeout(40);
  }
  for (const [id, name, args, result] of [
    ["t1", "read", { file_path: "scripts/capture-screenshots.mjs" }, "300 lines"],
    ["t2", "read", { file_path: "scripts/capture-screenshots.mjs" }, "345 lines"],
    [
      "t3",
      "bash",
      {
        command:
          'R="/var/folders/c4/4h8qvm0s7cj6vfdcc_2368/T/kleio-screens" && node scripts/capture-screenshots.mjs --out "$R"',
      },
      null,
    ],
  ]) {
    await emit("tool_call_start", { toolCallId: id, name, args });
    await page.waitForTimeout(120);
    if (result !== null) await emit("tool_call_end", { toolCallId: id, result, isError: false });
  }
  await page.waitForTimeout(600);

  // ── Transcript: no sideways scroll; dots drawn and centred ────────────
  step("transcript stays inside its box; dots are drawn circles on their line");
  const layout = await page.evaluate(() => {
    const transcript = document.querySelector(".transcript");
    const box = transcript.getBoundingClientRect();
    const lineCentre = (el) => {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      // One-line spans centre on their box; a block's first line on its line height.
      return r.height <= lh * 1.5 ? r.top + r.height / 2 : r.top + lh / 2;
    };
    const dots = [
      ...document.querySelectorAll(".assistant-dot, .tool-dot, .subagent-icon.is-dot"),
    ].map((el) => {
      const before = getComputedStyle(el, "::before");
      const r = el.getBoundingClientRect();
      const centre = r.top + parseFloat(before.top) + parseFloat(before.height) / 2;
      const text = el.nextElementSibling;
      return {
        kind: el.className,
        glyphHidden: getComputedStyle(el).visibility === "hidden",
        drawn: before.content === '""' && before.visibility === "visible",
        size: `${before.width} × ${before.height}`,
        offset: text ? Math.round((centre - lineCentre(text)) * 10) / 10 : null,
      };
    });
    return {
      scrollWidth: transcript.scrollWidth,
      clientWidth: transcript.clientWidth,
      overflowX: getComputedStyle(transcript).overflowX,
      rowsPastEdge: [...transcript.querySelectorAll(".subagent-row, .tool-row, .assistant-msg")]
        .filter((el) => el.getBoundingClientRect().right > box.right + 0.5)
        .map((el) => el.textContent.slice(0, 40)),
      dots,
    };
  });
  console.log(
    `  transcript scrollWidth ${layout.scrollWidth} / clientWidth ${layout.clientWidth}, overflow-x ${layout.overflowX}`,
  );
  assert(layout.scrollWidth <= layout.clientWidth, "nothing in the transcript is wider than it");
  assert.deepEqual(layout.rowsPastEdge, [], "no row runs past the transcript's edge");
  assert.equal(layout.overflowX, "hidden");
  const kinds = new Set(layout.dots.map((d) => d.kind.split(" ")[0]));
  for (const kind of ["assistant-dot", "tool-dot", "subagent-icon"]) {
    assert(kinds.has(kind), `expected a ${kind} on screen`);
  }
  for (const dot of layout.dots) {
    console.log(`  ${dot.kind}: ${dot.size}, ${dot.offset}px from its line's centre`);
    assert(dot.glyphHidden && dot.drawn, `${dot.kind} should draw a circle, not the ⏺ glyph`);
    assert.equal(dot.size, "9px × 9px");
    if (dot.offset !== null) assert(Math.abs(dot.offset) <= 1.5, `${dot.kind} sits off its line`);
  }
  await page.evaluate(() => document.querySelector(".subagents")?.scrollIntoView());
  await page.waitForTimeout(150);
  await shot("0-transcript-rows");
  await page.evaluate(() => {
    const transcript = document.querySelector(".transcript");
    transcript.scrollTop = transcript.scrollHeight;
  });

  // ── The @muse chip ────────────────────────────────────────────────────
  step("the @muse chip addresses the draft and focuses the input");
  assert.equal(await roundTitle(), "Stop the run", "an empty draft mid-run keeps Stop");
  await page.tap(".helper-chip");
  await page.waitForTimeout(100);
  assert.equal(await textarea.inputValue(), "@muse ");
  assert(
    await page.evaluate(() => document.activeElement?.matches("textarea.input") ?? false),
    "the chip should leave the cursor in the input",
  );
  assert.equal(await roundTitle(), "Stop the run", "@muse with nothing to ask yet keeps Stop");
  await page.keyboard.type(QUESTION);
  await page.waitForTimeout(300);

  // ── Caret vs the visible text ─────────────────────────────────────────
  step("the caret lands at the end of the visible @muse text");
  const measure = () =>
    page.evaluate(() => {
      const ta = document.querySelector("textarea.input");
      const overlay = document.querySelector(".ken-input-highlight");
      const cs = getComputedStyle(ta);
      // Where the textarea draws its caret: mirror it from ITS OWN computed
      // style (not the overlay's rules) and measure the end of the draft.
      const mirror = document.createElement("div");
      for (const p of [
        "boxSizing",
        "width",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "borderStyle",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "fontStretch",
        "fontKerning",
        "fontVariantLigatures",
        "fontFeatureSettings",
        "lineHeight",
        "letterSpacing",
        "wordSpacing",
        "textTransform",
        "textIndent",
        "tabSize",
        "whiteSpace",
        "overflowWrap",
        "wordBreak",
      ]) {
        mirror.style[p] = cs[p];
      }
      const r = ta.getBoundingClientRect();
      Object.assign(mirror.style, {
        position: "fixed",
        left: `${r.left}px`,
        top: `${r.top - ta.scrollTop}px`,
        height: "auto",
        visibility: "hidden",
      });
      mirror.textContent = ta.value.slice(0, ta.selectionEnd);
      const marker = document.createElement("span");
      marker.textContent = "\u200b";
      mirror.append(marker);
      document.body.append(mirror);
      const caret = marker.getBoundingClientRect();
      mirror.remove();
      // Where the overlay's visible text ends.
      const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT);
      let last = null;
      while (walker.nextNode()) last = walker.currentNode;
      const range = document.createRange();
      range.setStart(last, last.length);
      range.collapse(true);
      const end = range.getBoundingClientRect();
      const lh = parseFloat(cs.lineHeight);
      return {
        textareaFont: cs.fontSize,
        overlayFont: getComputedStyle(overlay).fontSize,
        textareaLines: Math.round((ta.scrollHeight - parseFloat(cs.paddingTop) * 2) / lh),
        overlayLines: Math.round((overlay.scrollHeight - parseFloat(cs.paddingTop) * 2) / lh),
        dx: Math.round((caret.left - end.left) * 10) / 10,
        dy: Math.round((caret.top + caret.height / 2 - (end.top + end.height / 2)) * 10) / 10,
        caretX: Math.round(caret.left - r.left),
        width: Math.round(r.width),
      };
    });
  const aligned = await measure();
  console.log(`  fixed:   ${JSON.stringify(aligned)}`);
  assert.equal(aligned.overlayFont, aligned.textareaFont, "overlay and textarea share a size");
  assert.equal(aligned.overlayLines, aligned.textareaLines, "overlay wraps like the textarea");
  assert(aligned.textareaLines >= 2, "the draft should wrap for this check to mean anything");
  assert(Math.abs(aligned.dx) <= 1.5 && Math.abs(aligned.dy) <= 1.5, "caret at the text's end");
  assert(aligned.caretX > 8 && aligned.caretX < aligned.width - 8, "caret mid-line, not wrapped");
  // Control: the overlay at the desktop's 15px (the bug) puts the caret elsewhere.
  const desktopSize = await page.addStyleTag({
    content: "html.platform-ios .ken-input-highlight { font-size: 15px !important; }",
  });
  const control = await measure();
  console.log(`  control: ${JSON.stringify(control)}`);
  assert(
    Math.abs(control.dx) > 1.5 || Math.abs(control.dy) > 1.5,
    "the control should miss, or this check proves nothing",
  );
  await desktopSize.evaluate((el) => el.remove());
  await page.waitForTimeout(100);
  assert.deepEqual(await measure(), aligned, "control style removed");
  // The caret blinks: two frames half a blink apart, one of them shows it.
  await shot("1-caret-mid-line-a", { caret: "initial" });
  await page.waitForTimeout(530);
  await shot("1-caret-mid-line-b", { caret: "initial" });
  // The textarea's own glyphs in red over the highlight: they should coincide.
  await page.evaluate(() => {
    document.querySelector("textarea.input").style.color = "rgba(255, 40, 40, 0.85)";
  });
  await shot("2-textarea-over-highlight", {
    clip: await page.locator(".inputwrap").boundingBox(),
  });
  await page.evaluate(() => {
    document.querySelector("textarea.input").style.color = "";
  });

  // ── Mid-run send ──────────────────────────────────────────────────────
  step("mid-run, the round button sends the @muse question to the helper");
  assert.equal(await roundTitle(), "Send", "a @muse question mid-run turns Stop into Send");
  const cancelsBefore = await callCount("agent_cancel");
  await page.tap(roundButton);
  await page.waitForTimeout(300);
  const kenPrompts = (await calls()).filter((c) => c.cmd === "agent_ken_prompt");
  assert.equal(kenPrompts.length, 1, "exactly one helper prompt went out");
  assert.deepEqual(kenPrompts[0].args, { text: QUESTION });
  assert.equal(await callCount("agent_cancel"), cancelsBefore, "the run was not cancelled");
  assert.equal(await callCount("agent_prompt"), 1, "nothing was queued for the coder");
  assert.equal(await textarea.inputValue(), "", "the draft cleared");
  assert.equal(await roundTitle(), "Stop the run", "the build is still running");
  console.log(`  agent_ken_prompt ${JSON.stringify(kenPrompts[0].args)}`);
  await shot("3-after-muse-send");

  step("a draft for the coder mid-run keeps Stop");
  await textarea.fill("also retake the dark screenshots");
  await page.waitForTimeout(100);
  assert.equal(await roundTitle(), "Stop the run");
  await textarea.fill("");

  step("with the keyboard up, Return adds a line and sends nothing");
  await page.evaluate(() => document.documentElement.classList.add("keyboard-open"));
  await page.tap(".helper-chip");
  await page.keyboard.type("is return still a new line?");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  assert.equal(await callCount("agent_ken_prompt"), 1, "Return did not send");
  assert.equal(await textarea.inputValue(), "@muse is return still a new line?\n");
  await textarea.fill("");
  await page.evaluate(() => document.documentElement.classList.remove("keyboard-open"));

  // ── Empty draft still stops ───────────────────────────────────────────
  step("with an empty draft, the round button still stops the run");
  await page.waitForTimeout(100);
  assert.equal(await roundTitle(), "Stop the run");
  await page.tap(roundButton);
  await page.waitForTimeout(300);
  assert.equal(await callCount("agent_cancel"), cancelsBefore + 1, "agent_cancel went out");
  assert.equal(await callCount("agent_ken_prompt"), 1);
}

await mkdir(outDir, { recursive: true });
let server = null;
let url = process.env.GG_PHONE_URL;
if (!url) {
  const port = await freePort();
  server = await createServer({
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await server.listen();
  url = `http://127.0.0.1:${port}/`;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  });
  await context.addInitScript(fakeTauri, { responses });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
  await page.goto(url, { waitUntil: "load" });
  // A cold Vite cache can reload the page once while it optimises deps; let
  // that happen, then start from a clean load.
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  await run(page);
  console.log("\nphone composer: all checks passed");
} finally {
  await browser.close();
  await server?.close();
}
