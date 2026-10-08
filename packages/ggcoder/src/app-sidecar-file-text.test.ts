import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Boots the REAL app sidecar daemon and drives POST /file-text over HTTP. */
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

function post(
  urlPath: string,
  body: Buffer,
  opts: { token?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-gg-token": opts.token ?? token,
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
    // An oversize body is cut off mid-upload; the 413 may still arrive.
    req.on("error", (err) => (req.writableEnded ? undefined : reject(err)));
    req.end(body);
  });
}

beforeAll(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-file-text-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-file-text-project-"));
  const child = spawn(process.execPath, [SIDECAR], {
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
  daemon = child;
  port = await new Promise<number>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`daemon never listened: ${out}`)), 60_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const match = /GG_APP_LISTENING (\d+) (\S+)/.exec(out);
      if (match?.[1] && match[2]) {
        clearTimeout(timer);
        token = match[2];
        resolve(Number(match[1]));
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`daemon exited (${code}): ${out}`)));
  });
}, 90_000);

afterAll(async () => {
  const running = daemon;
  daemon = undefined;
  if (running && running.exitCode === null && running.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      running.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      running.kill("SIGKILL");
    });
  }
  // Windows can hold the killed daemon's files open for a moment.
  const removeOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
  await fs.rm(tmpHome, removeOptions);
  await fs.rm(tmpProject, removeOptions);
});

describe("POST /file-text", () => {
  const url = (name: string): string => `/file-text?name=${encodeURIComponent(name)}`;

  it("requires the token", async () => {
    const res = await post(url("a.txt"), Buffer.from("hi"), { token: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns text, and maps failures to 400/415/422", async () => {
    expect(await post(url("My notes.txt"), Buffer.from("hello"))).toEqual({
      status: 200,
      json: { text: "hello" },
    });
    expect((await post(url("a.exe"), Buffer.from("x"))).json).toEqual({ error: "unsupported" });
    expect((await post(url("a.exe"), Buffer.from("x"))).status).toBe(415);
    const nul = await post(url("a.txt"), Buffer.from([0x61, 0]));
    expect(nul).toEqual({ status: 422, json: { error: "unreadable" } });
    expect(await post("/file-text", Buffer.from("x"))).toEqual({
      status: 400,
      json: { error: "bad_request" },
    });
  });

  it("refuses bodies over 20 MB", async () => {
    const res = await post(url("big.txt"), Buffer.alloc(20 * 1024 * 1024 + 1, 0x61));
    expect(res).toEqual({ status: 413, json: { error: "too_large" } });
  }, 30_000);
});
