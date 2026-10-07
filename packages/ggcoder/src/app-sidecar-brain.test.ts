import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Boots the REAL daemon and drives the Brain routes voice Kleio uses (through
 * the Kleio host): GET /brain gives the block text chat's system prompt gets
 * plus the tools' schemas, and POST /brain/tool runs those very tools, so a
 * memory saved by voice is the one text chat reads (~/.gg/chat-memories.json).
 */
const SIDECAR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "app-sidecar.js",
);

let tmpHome: string;
let tmpProject: string;
let daemon: ChildProcessByStdio<null, Readable, Readable> | undefined;
let port = 0;
let token = "";

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
  daemon.stderr.on("data", () => {});
  port = await new Promise<number>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`daemon never listened: ${out}`)), 60_000);
    daemon!.stdout.on("data", (chunk) => {
      out += chunk;
      const match = /GG_APP_LISTENING (\d+) (\S+)/.exec(out);
      if (match) {
        clearTimeout(timer);
        token = match[2]!;
        resolve(Number(match[1]));
      }
    });
    daemon!.on("error", reject);
    daemon!.on("exit", (code) => reject(new Error(`daemon exited (${code}): ${out}`)));
  });
}

async function stopDaemon(): Promise<void> {
  const d = daemon;
  daemon = undefined;
  if (d && d.exitCode === null && d.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      d.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      d.kill("SIGTERM");
    });
  }
}

function request(
  method: string,
  urlPath: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: { "content-type": "application/json", "x-gg-token": opts.token ?? token },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
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

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-brain-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-brain-project-"));
  await fs.mkdir(path.join(tmpHome, ".gg"), { recursive: true });
  await fs.writeFile(
    path.join(tmpHome, ".gg", "settings.json"),
    JSON.stringify({ autoCompact: false }),
  );
  await startDaemon();
});
afterEach(async () => {
  await stopDaemon();
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(tmpProject, { recursive: true, force: true });
});

describe("app sidecar: the Brain for voice Kleio", () => {
  it("gives text chat's memory block and the Brain tools, and saves to the same memory", async () => {
    const empty = await request("GET", "/brain");
    expect(empty.status).toBe(200);
    expect(String(empty.json.prompt)).toContain("# Durable memory");
    expect(String(empty.json.prompt)).toContain("# Jiwa");
    const tools = empty.json.tools as { name: string; parameters: { type?: string } }[];
    expect(tools.map((t) => t.name)).toEqual([
      "remember",
      "update_memory",
      "forget",
      "set_jiwa",
      "update_jiwa",
      "forget_jiwa",
    ]);
    expect(tools.every((t) => t.parameters.type === "object")).toBe(true);

    const saved = await request("POST", "/brain/tool", {
      body: {
        name: "remember",
        args: { content: "Has a dog called Biscuit.", category: "relationship", importance: 4 },
      },
    });
    expect(saved.status).toBe(200);
    expect(String(saved.json.result)).toMatch(/^Remembered as [\w-]+\. 1 memory stored\.$/);

    // Text chat reads the same file; the next call's block carries it.
    const file = JSON.parse(
      await fs.readFile(path.join(tmpHome, ".gg", "chat-memories.json"), "utf8"),
    ) as { memories: { text: string }[] };
    expect(file.memories.map((m) => m.text)).toEqual(["Has a dog called Biscuit."]);
    expect(String((await request("GET", "/brain")).json.prompt)).toContain(
      "Has a dog called Biscuit.",
    );

    const jiwa = await request("POST", "/brain/tool", {
      body: { name: "set_jiwa", args: { content: "Keep answers short." } },
    });
    expect(jiwa.status).toBe(200);
    expect(String((await request("GET", "/brain")).json.prompt)).toContain("Keep answers short.");
  });

  it("refuses anything but the Brain tools, bad arguments and strangers", async () => {
    expect(
      (await request("POST", "/brain/tool", { body: { name: "bash", args: {} } })).status,
    ).toBe(404);
    const bad = await request("POST", "/brain/tool", { body: { name: "remember", args: {} } });
    expect(bad.status).toBe(422);
    expect(typeof bad.json.error).toBe("string");
    // Text chat's own answer, words the model can act on.
    const missing = await request("POST", "/brain/tool", {
      body: { name: "forget", args: { id: "m-nope" } },
    });
    expect(missing.status).toBe(200);
    expect(String(missing.json.result)).toMatch(/was not found/);
    expect((await request("GET", "/brain", { token: "wrong" })).status).toBe(401);
  });
});
