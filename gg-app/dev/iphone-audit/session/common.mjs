// Shared by the session scenes: made-up run events and a selector probe.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { SHOTS } from "../lib.mjs";

export const AREA = "session";
export const SEND = ".inputactions-trailing .icon-circle-primary";

// A table wider than the phone (shape from scripts/check-phone-composer.mjs, content made up).
export const TABLE_REPLY = [
  "\n\nHere is how the three caches compare:\n\n",
  "| Cache | Cost | Time to first byte | Eviction | Best for | Source |\n",
  "| --- | --- | --- | --- | --- | --- |\n",
  "| Redis cluster | $99 | 40 ms (55 with TLS on) | Very good, adaptive | ",
  "Checkout and long sessions | `notes/redis-cluster.md` |\n",
  "| In-process LRU | $0 | 3 ms | Good | Everyday reads | https://example.com/benchmarks/lru |\n",
  "\nMy pick is the Redis cluster.",
].join("");

const TEXT = [
  "I checked the checkout wiring in `src/checkout/retry.ts`, the cart views, how orders, ",
  "refunds and settings render, and the payment API types, so the retry matches what ",
  "the pages really expect. The helper script lives at ",
  "`/var/folders/zz/demo0000000000000000/T/aurora-store/scripts/replay-checkout.mjs` ",
  "and its notes are at https://github.com/demo/aurora-store/blob/main/docs/",
  "checkout-retry-with-idempotency-keys-and-the-old-flow.md\n\n",
  "Now the remaining shapes: the refund page and the receipt modal need status, ",
  "devices, offers and totals, plus the entry type the order list renders.",
];

// [task, agent type (→ god), input, cacheRead, output, tools, state, activity]
export const AGENTS = [
  ["survey_routes", "owl", 37800, 4900, 10500, 8, "closed", undefined],
  ["build_limiter", "bee", 43300, 45700, 6900, 10, "closed", undefined],
  ["audit_login", "auditor", 36700, 4900, 9300, 7, "closed", undefined],
  ["checkout_native_retry", "worker", 132200, 478600, 10800, 21, "running", "Read src/checkout/RetryPage.tsx"],
  ["compare_caches", "researcher", 22100, 3900, 4100, 5, "running", "Fetching example.com/benchmarks/lru"],
  ["doubt_the_plan", "skeptic", 18400, 2100, 3300, 4, "running", "Reading docs/checkout-retry.md"],
  ["run_auth_suite", undefined, 9200, 1100, 1600, 3, "running", "Running pnpm test auth"],
  ["second_survey", "owl", 12800, 900, 2100, 6, "running", 'Searching for "idempotencyKey("'],
  ["second_build", "bee", 15100, 1900, 2600, 9, "starting", undefined],
];

/** Send a first message and open a run. */
export async function startRun(app, prompt = "Add checkout retry with idempotency keys, then rerun the cart tests") {
  const textarea = app.page.locator("textarea.input");
  await textarea.fill(prompt);
  await app.settle(150);
  await app.tap(SEND, { settle: 300 });
  await app.emit("run_start");
  await app.emit("thinking_delta", { text: "…" });
}

export async function seedAgents(app, count = 4) {
  for (const [name, type, input, cacheRead, output, tools, state, activity] of AGENTS.slice(0, count)) {
    await app.emit("subagent_state", {
      agent_id: `sa-${name}`,
      task_name: name,
      agent_name: type,
      state,
      current_activity: activity,
      started_at: 0,
      updated_at: 512000,
      elapsed_ms: 512000,
      turn_count: 6,
      tool_use_count: tools,
      token_usage: { input, output, cacheRead },
    });
  }
  await app.settle(500);
}

export async function seedText(app) {
  for (const chunk of TEXT) {
    await app.emit("text_delta", { text: chunk });
    await app.settle(40);
  }
}

export async function seedTools(app) {
  for (const [id, name, args, result] of [
    ["t1", "read", { file_path: "scripts/replay-checkout.mjs" }, "300 lines"],
    ["t2", "edit", { file_path: "src/checkout/retry.ts" }, "Edited src/checkout/retry.ts"],
    ["t3", "bash", { command: 'R="/var/folders/zz/demo0000000000000000/T/aurora-store" && node scripts/replay-checkout.mjs --out "$R"' }, null],
  ]) {
    await app.emit("tool_call_start", { toolCallId: id, name, args });
    await app.settle(120);
    if (result !== null) await app.emit("tool_call_end", { toolCallId: id, result, isError: false });
  }
  await app.settle(600);
}

export async function finishRun(app) {
  await app.emit("tool_call_end", { toolCallId: "t3", result: "12 passed", isError: false });
  await app.emit("turn_end", { usage: { inputTokens: 41200, outputTokens: 2900, cacheRead: 12000, cacheWrite: 0 } });
  await app.emit("agent_done", { totalUsage: { outputTokens: 2900 } });
  await app.emit("run_end", {});
  await app.settle(900);
}

/** Measure named selectors (every match): box, font size, computed bits. Saved beside the record. */
export async function probe(app, screen, selectors) {
  const out = await app.page.evaluate((sels) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const res = {};
    for (const sel of sels) {
      res[sel] = [...document.querySelectorAll(sel)].slice(0, 12).map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          text: (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60),
          x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height),
          display: cs.display, fontSize: cs.fontSize, minHeight: cs.minHeight, height: cs.height,
          overflow: `${cs.overflowX}/${cs.overflowY}`, scrollW: el.scrollWidth, clientW: el.clientWidth,
          scrollH: el.scrollHeight, clientH: el.clientHeight, position: cs.position,
        };
      });
    }
    return res;
  }, selectors);
  const file = path.join(SHOTS, AREA, `${screen}--${app.device}.probe.json`);
  await writeFile(file, JSON.stringify(out, null, 1));
  console.log(`\n-- probe ${screen} (${app.device})`);
  for (const [sel, list] of Object.entries(out)) {
    if (list.length === 0) console.log(`  ${sel}: (none)`);
    for (const m of list) console.log(`  ${sel}: ${m.x},${m.y} ${m.w}x${m.h} display ${m.display} font ${m.fontSize} minH ${m.minHeight} scroll ${m.scrollW}/${m.clientW} "${m.text}"`);
  }
  return out;
}
