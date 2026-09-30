import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefaultModel } from "./core/model-registry.js";

/**
 * Boots the REAL app sidecar daemon and drives POST /complete over HTTP
 * against a stub OpenAI-compatible local endpoint: the daemon must resolve the
 * model exactly like POST /session (fail closed), make one tool-less call, and
 * never write the prompt anywhere.
 */
const SIDECAR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "app-sidecar.js",
);

const ENDPOINT_ID = "custom-stub";
const MODEL = `local/${ENDPOINT_ID}/stub-chat`;
/** Never written to disk by the daemon — checked across the whole HOME. */
const SECRET = "PROMPT-MARKER-7f3a91";

let tmpHome: string;
let tmpProject: string;
type Daemon = ChildProcessByStdio<null, Readable, Readable>;
let daemon: Daemon | undefined;
let port = 0;
let token = "";

// ── Stub OpenAI-compatible endpoint ────────────────────────────────────
let stub: http.Server;
let stubPort = 0;
let chatRequests: Record<string, unknown>[] = [];
let stubAuthHeaders: (string | undefined)[] = [];

function sseChunk(delta: Record<string, unknown>, finish: string | null = null): string {
  const chunk = {
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: 0,
    model: "stub-chat",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function startStub(): Promise<void> {
  stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "stub-chat",
                object: "model",
                type: "chat",
                tool_calling: true,
                context_window: 32768,
              },
            ],
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const body = JSON.parse(raw) as Record<string, unknown>;
        chatRequests.push(body);
        stubAuthHeaders.push(req.headers.authorization);
        const messages = body.messages as { role: string; content: unknown }[];
        const user = JSON.stringify(messages.at(-1)?.content ?? "");
        if (user.includes("HANG")) return; // never answer: the daemon must time out
        if (user.includes("REJECT")) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "stub rejected the request" } }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseChunk({ role: "assistant", content: '{"schedules":' }));
        res.write(sseChunk({ content: "[]}" }));
        res.write(sseChunk({}, "stop"));
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => {
    stub.listen(0, "127.0.0.1", () => {
      stubPort = (stub.address() as AddressInfo).port;
      resolve();
    });
  });
}

/** Start the daemon on an ephemeral port and wait for its listening handshake. */
async function startDaemon(): Promise<void> {
  daemon = spawn(process.execPath, [SIDECAR], {
    cwd: tmpProject,
    env: {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      GG_APP_CWD: tmpProject,
      GG_APP_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  port = await new Promise<number>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`daemon never listened: ${out}`)), 60_000);
    daemon!.stdout.on("data", (chunk) => {
      out += chunk;
      const match = /GG_APP_LISTENING (\d+) (\S+)/.exec(out);
      if (match) {
        clearTimeout(timer);
        token = match[2];
        resolve(Number(match[1]));
      }
    });
    daemon!.on("error", reject);
    daemon!.on("exit", (code) => reject(new Error(`daemon exited (${code}): ${out}`)));
  });
}

function complete(
  body: unknown,
  opts: { token?: string; raw?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = opts.raw ?? JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/complete",
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.token === "" ? {} : { "x-gg-token": opts.token ?? token }),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: {} });
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** Every file under `dir` whose contents include `needle`. */
async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    if ((await fs.readFile(file, "utf-8").catch(() => "")).includes(needle)) hits.push(file);
  }
  return hits;
}

beforeEach(async () => {
  chatRequests = [];
  stubAuthHeaders = [];
  await startStub();
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-complete-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-complete-project-"));
  await fs.mkdir(path.join(tmpHome, ".gg"), { recursive: true });
  await fs.writeFile(
    path.join(tmpHome, ".gg", "settings.json"),
    JSON.stringify({ autoCompact: false }),
  );
  // A cold daemon: the endpoint is configured, but no scan has run yet, so
  // neither the model registry nor auth.json knows about it.
  await fs.writeFile(
    path.join(tmpHome, ".gg", "gg-app.json"),
    JSON.stringify({
      localEndpoints: [
        {
          id: ENDPOINT_ID,
          label: "Stub",
          baseUrl: `http://127.0.0.1:${stubPort}/v1`,
          apiKey: "sk-stub",
        },
      ],
    }),
  );
  await startDaemon();
});

afterEach(async () => {
  const runningDaemon = daemon;
  daemon = undefined;
  if (runningDaemon && runningDaemon.exitCode === null && runningDaemon.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      runningDaemon.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      runningDaemon.kill("SIGKILL");
    });
  }
  stub.closeAllConnections();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
  const removeOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
  await fs.rm(tmpHome, removeOptions);
  await fs.rm(tmpProject, removeOptions);
});

describe("POST /complete", () => {
  it("returns the stub's text from one tool-less call and never persists the prompt", async () => {
    const res = await complete({
      model: MODEL,
      system: "Reply with JSON only.",
      prompt: `every morning check the news ${SECRET}`,
      maxTokens: 800,
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ text: '{"schedules":[]}', model: MODEL });

    expect(chatRequests).toHaveLength(1);
    const sent = chatRequests[0]!;
    expect(sent.model).toBe("stub-chat");
    expect(sent.messages).toEqual([
      { role: "system", content: "Reply with JSON only." },
      { role: "user", content: `every morning check the news ${SECRET}` },
    ]);
    expect(sent.tools).toBeUndefined();
    expect(sent.max_completion_tokens ?? sent.max_tokens).toBe(800);
    // The endpoint's own key, from the auth store.
    expect(stubAuthHeaders[0]).toBe("Bearer sk-stub");

    expect(await filesContaining(tmpHome, SECRET)).toEqual([]);
  }, 90_000);

  it("applies the default maxTokens", async () => {
    const res = await complete({ model: MODEL, prompt: "hi" });
    expect(res.status).toBe(200);
    const sent = chatRequests[0]!;
    expect(sent.max_completion_tokens ?? sent.max_tokens).toBe(1000);
  }, 90_000);

  it("answers 400 for bad input without calling a provider", async () => {
    const cases: [unknown, string | undefined, string][] = [
      [undefined, "{not json", "invalid JSON body"],
      [{ prompt: "hi" }, undefined, "model must be a non-empty string"],
      [{ model: MODEL }, undefined, "prompt must be a non-empty string"],
      [{ model: MODEL, prompt: "hi", system: 3 }, undefined, "system must be a string"],
      [
        { model: MODEL, prompt: "hi", maxTokens: 4001 },
        undefined,
        "maxTokens must be an integer from 1 to 4000",
      ],
      [
        { model: MODEL, prompt: "hi", timeoutMs: 120_001 },
        undefined,
        "timeoutMs must be an integer from 1 to 120000",
      ],
    ];
    for (const [body, raw, error] of cases) {
      const res = await complete(body, raw === undefined ? {} : { raw });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error });
    }
    expect(chatRequests).toHaveLength(0);
  }, 90_000);

  it("requires the daemon token", async () => {
    const res = await complete({ model: MODEL, prompt: "hi" }, { token: "" });
    expect(res.status).toBe(401);
    expect(chatRequests).toHaveLength(0);
  }, 90_000);

  it("answers 409 for an unknown model and for a provider that isn't connected", async () => {
    const unknown = "local/no-such-endpoint/ghost-model";
    const res = await complete({ model: unknown, prompt: "hi" });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: `model unavailable: ${unknown}` });

    // Registered, but this daemon has no Anthropic credentials: no fallback.
    const cloud = getDefaultModel("anthropic").id;
    const refused = await complete({ model: cloud, prompt: "hi" });
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ error: `model unavailable: ${cloud}` });
    expect(chatRequests).toHaveLength(0);
  }, 90_000);

  it("aborts at timeoutMs and answers 502", async () => {
    const started = Date.now();
    const res = await complete({ model: MODEL, prompt: "HANG please", timeoutMs: 1500 });
    expect(res.status).toBe(502);
    expect(res.json).toEqual({ error: "completion timed out after 1500ms" });
    expect(chatRequests).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 90_000);

  it("answers 502 when the provider fails", async () => {
    const res = await complete({ model: MODEL, prompt: "REJECT this" });
    expect(res.status).toBe(502);
    expect(String(res.json.error)).toMatch(/^completion failed: /);
  }, 90_000);
});
