import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Boots the REAL app sidecar daemon, reopens a chat with a screenshot in it,
 * and reads GET /history: what the app fetches each time a chat opens.
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

/** POSTs raw bytes to the daemon: its status, content type and body. */
function postBytes(
  urlPath: string,
  bytes: Buffer,
): Promise<{ status: number; type: string | undefined; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: {
          "x-gg-token": token,
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            type: res.headers["content-type"],
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(bytes);
  });
}

function request(
  method: string,
  urlPath: string,
  opts: { session?: string; body?: unknown } = {},
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
          "x-gg-token": token,
          ...(payload ? { "content-type": "application/json" } : {}),
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
    req.end(payload);
  });
}

beforeAll(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-history-images-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-history-images-project-"));
  await fs.mkdir(path.join(tmpHome, ".gg"), { recursive: true });
  await fs.writeFile(
    path.join(tmpHome, ".gg", "settings.json"),
    JSON.stringify({ autoCompact: false }),
  );
  // A stand-in key: reopening a chat needs its provider connected, and no
  // request here reaches the provider.
  await fs.writeFile(
    path.join(tmpHome, ".gg", "auth.json"),
    JSON.stringify({
      anthropic: { accessToken: "test-key", refreshToken: "", expiresAt: Date.now() + 3_600_000 },
    }),
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

/** A stored session: asked for a screenshot, took one, and answered. */
async function writeSessionWithScreenshot(): Promise<string> {
  const png = await sharp({
    create: { width: 1400, height: 900, channels: 3, background: { r: 210, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
  const at = "2026-10-26T12:00:00.000Z";
  const shot = path.join(tmpProject, "shot.png");
  const lines = [
    {
      type: "session",
      version: 2,
      id: "s1",
      conversationId: "s1",
      timestamp: at,
      cwd: tmpProject,
      provider: "anthropic",
      model: "claude-sonnet-5",
    },
    { role: "user", content: "Take a screenshot" },
    {
      role: "assistant",
      content: [{ type: "tool_call", id: "t1", name: "screenshot", args: {} }],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool_result",
          toolCallId: "t1",
          content: [
            { type: "text", text: `Captured https://example.com → ${shot} [image/png]` },
            { type: "image", mediaType: "image/png", data: png.toString("base64") },
          ],
        },
      ],
    },
    { role: "assistant", content: [{ type: "text", text: "Here it is." }] },
  ].map((record, index) =>
    index === 0
      ? record
      : {
          type: "message",
          id: `m${index}`,
          parentId: index === 1 ? null : `m${index - 1}`,
          timestamp: at,
          message: record,
        },
  );
  const file = path.join(tmpHome, ".gg", "sessions", "history-images", "s1.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

/** Reopens the stored chat with a screenshot: its session id. */
async function reopenChat(): Promise<string> {
  const sessionPath = await writeSessionWithScreenshot();
  const created = await request("POST", "/session", {
    body: { mode: "code", cwd: tmpProject, sessionPath },
  });
  expect(created, JSON.stringify(created.json)).toMatchObject({ status: 200 });
  return created.json.sessionId as string;
}

/** A WebP data URL's image: its format and size. */
async function webpOf(src: string | undefined): Promise<[string | undefined, number | undefined]> {
  const prefix = "data:image/webp;base64,";
  expect(src?.startsWith(prefix)).toBe(true);
  const meta = await sharp(Buffer.from(src?.slice(prefix.length) ?? "", "base64")).metadata();
  return [meta.format, meta.width];
}

describe("GET /history", () => {
  it("sends a reopened chat's screenshot as a 480 px WebP, with its path", async () => {
    const session = await reopenChat();

    const res = await request("GET", "/history", { session });
    expect(res.status).toBe(200);
    const history = res.json.history as Array<{
      toolImages?: Array<{ src: string; path?: string }>;
    }>;
    const images = history.flatMap((entry) => entry.toolImages ?? []);
    expect(images).toHaveLength(1);
    const [image] = images;
    const prefix = "data:image/webp;base64,";
    expect(image?.src.startsWith(prefix)).toBe(true);
    expect(image?.path).toBe(path.join(tmpProject, "shot.png"));
    const meta = await sharp(
      Buffer.from(image?.src.slice(prefix.length) ?? "", "base64"),
    ).metadata();
    expect([meta.format, meta.width]).toEqual(["webp", 480]);
  }, 30_000);
});

describe("a chat's images loaded as they're scrolled to", () => {
  /** The ref `GET /history?images=refs` lists for the screenshot. */
  async function listedRef(session: string): Promise<string> {
    const res = await request("GET", "/history?images=refs", { session });
    expect(res.status).toBe(200);
    const history = res.json.history as Array<{ toolImages?: Array<Record<string, unknown>> }>;
    const images = history.flatMap((entry) => entry.toolImages ?? []);
    expect(images).toHaveLength(1);
    return images[0]?.ref as string;
  }

  it("says the sidecar has them", async () => {
    const session = await reopenChat();
    const state = await request("GET", "/state", { session });
    expect(state.json.historyImageRefs).toBe(true);
  }, 30_000);

  it("lists each image by ref with its preview's size and path, and sends no image", async () => {
    const session = await reopenChat();
    const res = await request("GET", "/history?images=refs", { session });
    const history = res.json.history as Array<{ toolImages?: Array<Record<string, unknown>> }>;
    const [image] = history.flatMap((entry) => entry.toolImages ?? []);
    expect(image).toEqual({
      ref: expect.stringMatching(/^[0-9a-f]{64}$/),
      width: 480,
      height: 309,
      path: path.join(tmpProject, "shot.png"),
    });
  }, 30_000);

  it("sends a listed image's 480 px WebP preview by its ref", async () => {
    const session = await reopenChat();
    const ref = await listedRef(session);
    const res = await request("GET", `/history-images?refs=${ref}`, { session });
    expect(res.status).toBe(200);
    const images = res.json.images as Record<string, string>;
    expect(Object.keys(images)).toEqual([ref]);
    expect(await webpOf(images[ref])).toEqual(["webp", 480]);
  }, 30_000);

  it("finds an image by its ref without a listing first, as after a reopen", async () => {
    const session = await reopenChat();
    const ref = await listedRef(await reopenChat());
    const res = await request("GET", `/history-images?refs=${ref}`, { session });
    expect(Object.keys(res.json.images as Record<string, string>)).toEqual([ref]);
  }, 30_000);

  it("leaves out a ref this chat doesn't have", async () => {
    const session = await reopenChat();
    const ref = await listedRef(session);
    const other = "0".repeat(64);
    const res = await request("GET", `/history-images?refs=${ref},${other}`, { session });
    expect(res.status).toBe(200);
    expect(Object.keys(res.json.images as Record<string, string>)).toEqual([ref]);
  }, 30_000);

  it("refuses refs that aren't image refs, or more than 8", async () => {
    const session = await reopenChat();
    const ref = await listedRef(session);
    for (const refs of [
      "",
      "../state",
      ref.toUpperCase(),
      `${ref},x`,
      Array(9).fill(ref).join(","),
    ]) {
      const res = await request("GET", `/history-images?refs=${encodeURIComponent(refs)}`, {
        session,
      });
      expect(res.status, refs).toBe(400);
    }
  }, 30_000);
});

describe("POST /image-preview", () => {
  it("makes a big picture a WebP that fits 2048 px", async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 30, g: 90, b: 160 } },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const res = await postBytes("/image-preview", big);
    expect([res.status, res.type]).toEqual([200, "image/webp"]);
    const meta = await sharp(res.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 2048, 1536]);
  }, 30_000);

  it("answers 204 for what it can't read, so the original goes as it is", async () => {
    const res = await postBytes("/image-preview", Buffer.from("not an image"));
    expect([res.status, res.body.length]).toEqual([204, 0]);
  }, 30_000);
});
