import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefaultModel } from "./core/model-registry.js";

/**
 * Boots the REAL app sidecar daemon and drives POST /session over HTTP: the
 * persona/model contract is about what the daemon accepts, refuses (400/409),
 * and persists (per-project gg-app.json, never the global settings.json).
 */
const SIDECAR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "app-sidecar.js",
);

let tmpHome: string;
let tmpProject: string;
type Daemon = ChildProcessByStdio<null, Readable, Readable>;
let daemon: Daemon | undefined;
let port = 0;
let token = "";

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

function request(
  method: string,
  urlPath: string,
  opts: { session?: string; body?: unknown; token?: string; host?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(opts.session ? { "x-gg-session": opts.session } : {}),
          // Default to the real token; pass token: "" to exercise the 401 path.
          ...(opts.token !== undefined
            ? opts.token
              ? { "x-gg-token": opts.token }
              : {}
            : { "x-gg-token": token }),
          ...(opts.host ? { host: opts.host } : {}),
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
    if (payload) req.write(payload);
    req.end();
  });
}

const SETTINGS = { autoCompact: false };

function settingsPath(): string {
  return path.join(tmpHome, ".gg", "settings.json");
}

async function readAppSettings(): Promise<{
  projectModels?: Record<string, { provider: string; model: string }>;
}> {
  try {
    return JSON.parse(await fs.readFile(path.join(tmpHome, ".gg", "gg-app.json"), "utf-8"));
  } catch {
    return {};
  }
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-session-create-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-session-create-project-"));
  await fs.mkdir(path.join(tmpHome, ".gg"), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(SETTINGS));
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
  const removeOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
  await fs.rm(tmpHome, removeOptions);
  await fs.rm(tmpProject, removeOptions);
});

const persona = { name: "Scout", instructions: "Watch the markets and summarise briefly." };

describe("POST /session", () => {
  it("keeps existing code and chat session creation unchanged", async () => {
    const code = await request("POST", "/session", { body: { mode: "code", cwd: tmpProject } });
    expect(code.status).toBe(200);
    const codeState = await request("GET", "/state", { session: code.json.sessionId as string });
    expect(codeState.json).toMatchObject({ mode: "code" });

    const chat = await request("POST", "/session", {
      body: { mode: "chat", chatAgent: "research", cwd: tmpProject },
    });
    expect(chat.status).toBe(200);
    const chatState = await request("GET", "/state", { session: chat.json.sessionId as string });
    expect(chatState.json).toMatchObject({ mode: "chat", chatAgent: "research" });
    // No model requested → nothing pinned.
    expect((await readAppSettings()).projectModels).toBeUndefined();
  }, 90_000);

  it("creates a persona chat session on General's namespace", async () => {
    const res = await request("POST", "/session", {
      body: { mode: "chat", chatAgent: "therapist", cwd: tmpProject, persona },
    });
    expect(res.status).toBe(200);
    const state = await request("GET", "/state", { session: res.json.sessionId as string });
    expect(state.json).toMatchObject({ mode: "chat", chatAgent: "general" });
  }, 90_000);

  it("rejects a persona without chat mode, and an invalid persona, with 400", async () => {
    for (const body of [
      { mode: "code", cwd: tmpProject, persona },
      { cwd: tmpProject, persona },
      { mode: "chat", cwd: tmpProject, persona: { name: "", instructions: "x" } },
      { mode: "chat", cwd: tmpProject, persona: { name: "x".repeat(41), instructions: "x" } },
      { mode: "chat", cwd: tmpProject, persona: { name: "Scout", instructions: "" } },
      { mode: "chat", cwd: tmpProject, model: 42 },
    ]) {
      const res = await request("POST", "/session", { body });
      expect(res.status).toBe(400);
      expect(res.json.sessionId).toBeUndefined();
    }
  }, 90_000);

  it("returns 409 for an unknown model and creates nothing", async () => {
    const res = await request("POST", "/session", {
      body: { mode: "chat", cwd: tmpProject, model: "local/no-such-endpoint/ghost-model" },
    });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "model unavailable: local/no-such-endpoint/ghost-model" });
    expect((await readAppSettings()).projectModels).toBeUndefined();
    expect(JSON.parse(await fs.readFile(settingsPath(), "utf-8"))).toEqual(SETTINGS);
  }, 90_000);

  it("returns 409 for a known model whose provider is not connected (no cloud fallback)", async () => {
    // A real, registered model — but this daemon has no Anthropic credentials.
    const known = getDefaultModel("anthropic").id;
    const res = await request("POST", "/session", {
      body: { mode: "chat", cwd: tmpProject, model: known },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe(`model unavailable: ${known}`);
    expect((await readAppSettings()).projectModels).toBeUndefined();
  }, 90_000);

  it("starts on a requested model and pins it for the project only", async () => {
    // Connect a provider through a throwaway window, then pick one of its models.
    const bootstrap = await request("POST", "/session", {
      body: { mode: "code", cwd: tmpProject },
    });
    const bootId = bootstrap.json.sessionId as string;
    const connect = await request("POST", "/auth/apikey", {
      session: bootId,
      body: { provider: "xai", key: "sk-test-key" },
    });
    expect(connect.status).toBe(200);
    const models = await request("GET", "/models", { session: bootId });
    const xai = (models.json.models as { id: string; provider: string }[]).filter(
      (m) => m.provider === "xai",
    );
    const target = xai.at(-1)!.id;
    const settingsBefore = await fs.readFile(settingsPath(), "utf-8");

    const res = await request("POST", "/session", {
      body: { mode: "chat", cwd: tmpProject, model: target, persona },
    });
    expect(res.status).toBe(200);
    const state = await request("GET", "/state", { session: res.json.sessionId as string });
    expect(state.json).toMatchObject({ provider: "xai", model: target });

    const prefs = (await readAppSettings()).projectModels ?? {};
    expect(prefs[path.resolve(tmpProject)]).toMatchObject({ provider: "xai", model: target });
    // The global settings.json is never written on this path.
    expect(await fs.readFile(settingsPath(), "utf-8")).toBe(settingsBefore);
  }, 90_000);
});
