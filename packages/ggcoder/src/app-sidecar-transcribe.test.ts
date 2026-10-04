import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Boots the REAL app sidecar daemon and drives POST /transcribe (iPhone
 * dictation) over HTTP. Every case here is answered before Whisper loads, so
 * no speech model is downloaded.
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
let session = "";

function request(
  method: string,
  urlPath: string,
  opts: { session?: string; raw?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          "content-type": "application/json",
          "x-gg-token": token,
          ...(opts.session ? { "x-gg-session": opts.session } : {}),
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
    if (opts.raw !== undefined) req.write(opts.raw);
    req.end();
  });
}

const transcribe = (raw: string): ReturnType<typeof request> =>
  request("POST", "/transcribe", { session, raw });

/** `seconds` of 16 kHz mono 16-bit PCM, as base64. */
function pcm(seconds: number, sample: (i: number) => number = () => 0): string {
  const bytes = Buffer.alloc(Math.round(seconds * 16_000) * 2);
  for (let i = 0; i < bytes.length / 2; i++) bytes.writeInt16LE(sample(i), i * 2);
  return bytes.toString("base64");
}

beforeAll(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-transcribe-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-transcribe-project-"));
  await fs.mkdir(path.join(tmpHome, ".gg"), { recursive: true });
  await fs.writeFile(
    path.join(tmpHome, ".gg", "settings.json"),
    JSON.stringify({ autoCompact: false }),
  );
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
  const created = await request("POST", "/session", {
    raw: JSON.stringify({ mode: "chat", chatAgent: "general", cwd: tmpProject }),
  });
  session = String(created.json.sessionId ?? "");
  expect(session).not.toBe("");
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
  const removeOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
  await fs.rm(tmpHome, removeOptions);
  await fs.rm(tmpProject, removeOptions);
});

describe("POST /transcribe", () => {
  it.each([
    ["a body that isn't JSON", "not json", "invalid JSON body"],
    ["no audio", JSON.stringify({}), "missing audio"],
    ["audio that isn't text", JSON.stringify({ audio: 42 }), "missing audio"],
    [
      "audio that isn't base64",
      JSON.stringify({ audio: "%%%%" }),
      "The recording could not be read.",
    ],
  ])("refuses %s", async (_case, raw, error) => {
    const res = await transcribe(raw);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error });
  });

  it("refuses a clip over two minutes before decoding it", async () => {
    const res = await transcribe(JSON.stringify({ audio: pcm(121) }));
    expect(res.status).toBe(413);
    expect(res.json).toEqual({ error: "Recordings can be up to 2 minutes long." });
  });

  it.each([
    ["silence", pcm(2)],
    ["a clip too short to hold words", pcm(0.3, (i) => (i % 2 ? 8_000 : -8_000))],
  ])("answers %s with no text, without loading Whisper", async (_case, audio) => {
    const res = await transcribe(JSON.stringify({ audio }));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ text: "" });
  });

  it("needs a session, like every other session route", async () => {
    const res = await request("POST", "/transcribe", { raw: JSON.stringify({ audio: pcm(1) }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
