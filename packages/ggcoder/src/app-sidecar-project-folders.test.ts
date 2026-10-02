import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Boots the REAL app sidecar daemon and drives GET /projects/folders over HTTP:
 * "Open existing" for a paired device must list every folder in the projects
 * folder, including ones the user hid from the project list.
 */
const SIDECAR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "app-sidecar.js",
);

let tmp: string;
let projectsRoot: string;
type Daemon = ChildProcessByStdio<null, Readable, Readable>;
let daemon: Daemon | undefined;
let port = 0;
let token = "";

async function startDaemon(): Promise<void> {
  const home = path.join(tmp, "home");
  daemon = spawn(process.execPath, [SIDECAR], {
    cwd: projectsRoot,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      GG_APP_CWD: projectsRoot,
      GG_APP_PORT: "0",
      GG_APP_SETTINGS_FILE: path.join(home, ".gg", "kleio-app.json"),
      GG_APP_PROJECTS_DIR: projectsRoot,
      GG_APP_PROJECTS_ONLY: "1",
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
    if (payload) req.write(payload);
    req.end();
  });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gg-project-folders-"));
  projectsRoot = path.join(tmp, "kleio-projects");
  const gg = path.join(tmp, "home", ".gg");
  await fs.mkdir(gg, { recursive: true });
  await fs.writeFile(path.join(gg, "settings.json"), JSON.stringify({ autoCompact: false }));
  for (const name of ["visible", "test"]) {
    await fs.mkdir(path.join(projectsRoot, name), { recursive: true });
  }
  await fs.writeFile(
    path.join(gg, "kleio-app.json"),
    JSON.stringify({ projectsRoot, hiddenProjects: [path.join(projectsRoot, "test")] }),
  );
  await startDaemon();
});

afterEach(async () => {
  daemon?.kill("SIGKILL");
  daemon = undefined;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("GET /projects/folders", () => {
  it("lists every folder by name, marking the ones hidden from the project list", async () => {
    const created = await request("POST", "/session", { body: { mode: "code" } });
    expect(created.status).toBe(200);
    const session = String(created.json.sessionId);

    const res = await request("GET", "/projects/folders", { session });

    expect(res.status).toBe(200);
    expect(res.json.folders).toEqual([
      { name: "test", path: path.join(projectsRoot, "test"), hidden: true },
      { name: "visible", path: path.join(projectsRoot, "visible"), hidden: false },
    ]);
    // The project list itself still leaves the hidden one out.
    const listed = await request("GET", "/projects", { session });
    const paths = (listed.json.projects as { path: string }[]).map((p) => p.path);
    expect(paths).toContain(path.join(projectsRoot, "visible"));
    expect(paths).not.toContain(path.join(projectsRoot, "test"));
  });

  it("is session-scoped like /projects", async () => {
    const res = await request("GET", "/projects/folders");
    expect(res.status).toBe(404);
  });
});
