// POST /kleio/previews on the API origin, and the isolation between the API
// and the preview origin it mints links to (see preview.ts).

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host, type HostOptions } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import { PREVIEW_CSP } from "../src/preview.js";
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

let home: string;
let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let host: Host;
let apiPort: number;
let previewPort: number;
let phoneId: string;
let H: Record<string, string>;
let clock: number;
const logs: string[] = [];

const projects = (): string => join(home, "projects");

async function startHost(extra: Partial<HostOptions> = {}): Promise<Host> {
  const h = createHost({
    listenPort: 0,
    previewPort: 0,
    publicBaseUrl: "https://mini.test:8443",
    nodeId: "mini.test",
    registry,
    offers: createPairOfferStore(),
    rings: createRingStore({ directory: join(home, "rings"), maxFrames: 50 }),
    sidecarEndpointPath: join(home, "sidecar.json"),
    controlRootKey: "control-root-key-for-tests-0123456789",
    routinePollMs: 0,
    homeCwd: join(home, "Kleio"),
    blobTickMs: 0,
    workspaceRoots: () => Promise.resolve([projects()]),
    now: () => new Date(clock),
    log: (m) => logs.push(m),
    ...extra,
  });
  await h.start();
  apiPort = (h.server.address() as { port: number }).port;
  previewPort = (h.previewServer?.address() as { port: number } | undefined)?.port ?? 0;
  return h;
}

beforeEach(async () => {
  logs.length = 0;
  clock = Date.parse("2026-10-02T12:00:00Z");
  home = mkdtempSync(join(tmpdir(), "kleio-preview-route-"));
  mkdirSync(join(home, "secure"), { mode: 0o700 });
  chmodSync(join(home, "secure"), 0o700);
  const keyPath = join(home, "secure", "headless-master.key");
  writeFileSync(keyPath, generateMasterKey(), { mode: 0o600 });
  registry = createDeviceRegistry({
    keychain: createFileKeychain({ keyPath }),
    storePath: join(home, "secure", "device-registry.json"),
  });
  await registry.init();
  const phone = await registry.mint("Phone");
  if (!phone.ok) throw new Error("mint");
  phoneId = phone.value.device.deviceId;
  H = { [DEVICE_TOKEN_HEADER]: phone.value.token };
  sidecar = await fakeSidecar();
  writeFileSync(
    join(home, "sidecar.json"),
    JSON.stringify({ port: sidecar.port, token: sidecar.token, pid: 1, startedAt: "x" }),
  );
  // A Code project with a two-file site, and a Chat report at the projects root.
  const site = join(projects(), "demo", "site");
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, "index.html"), '<link rel="stylesheet" href="style.css"><h1>Demo</h1>');
  writeFileSync(join(site, "style.css"), "body { background: rgb(1, 2, 3); }");
  writeFileSync(join(projects(), "demo", "notes.txt"), "PROJECT NOTES");
  writeFileSync(join(projects(), "report.html"), "<h1>Report</h1>");
  writeFileSync(join(projects(), "report.pdf"), "%PDF-1.4");
  mkdirSync(join(projects(), "other"), { recursive: true });
  writeFileSync(join(projects(), "other", "secret.txt"), "OTHER PROJECT");
  host = await startHost();
});
afterEach(async () => {
  await host.stop();
  await sidecar.close();
  rmSync(home, { recursive: true, force: true });
});

interface Res {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  body: unknown;
}
function call(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = H,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const api = (method: string, path: string, body?: unknown, headers = H): Promise<Res> =>
  call(apiPort, method, path, body, headers);

/** Mint and return the preview path (`/p/<token>/<name>`) on the preview port. */
async function mint(owner: unknown, path: string): Promise<{ path: string; token: string }> {
  const r = await api("POST", "/kleio/previews", { owner, path });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const { url, expiresAt } = r.body as { url: string; expiresAt: string };
  expect(expiresAt).toBe(new Date(clock + 60 * 60 * 1000).toISOString());
  const u = new URL(url);
  expect(u.origin).toBe(`http://127.0.0.1:${previewPort}`);
  const token = /^\/p\/([^/]+)\//.exec(u.pathname)?.[1] ?? "";
  return { path: u.pathname, token };
}
const ws = (cwd: string): { kind: "workspace"; cwd: string } => ({ kind: "workspace", cwd });

describe("POST /kleio/previews", () => {
  it("needs a device token", async () => {
    const r = await api("POST", "/kleio/previews", { owner: ws(projects()), path: "x" }, {});
    expect(r.status).toBe(401);
  });

  it("answers 404 when there is no preview server", async () => {
    await host.stop();
    host = await startHost({ previewPort: undefined });
    expect(host.previewServer).toBeNull();
    const r = await api("POST", "/kleio/previews", {
      owner: ws(join(projects(), "demo")),
      path: "site/index.html",
    });
    expect(r.status).toBe(404);
  });

  it("refuses bad bodies, non-POST, non-html and unreadable files", async () => {
    expect((await api("GET", "/kleio/previews")).status).toBe(405);
    const demo = ws(join(projects(), "demo"));
    for (const [body, status, error] of [
      [{ owner: demo }, 400, "bad_request"],
      [{ owner: { kind: "nope" }, path: "site/index.html" }, 400, "bad_request"],
      [{ owner: { kind: "blob", blobId: "../x" }, path: "a.html" }, 400, "bad_request"],
      [{ owner: demo, path: "notes.txt" }, 400, "not_a_site"],
      [{ owner: demo, path: "../report.html" }, 400, "bad path"],
      [{ owner: demo, path: "missing.html" }, 404, "no such file"],
      [{ owner: ws(join(home, "elsewhere")), path: "a.html" }, 404, "no such workspace"],
      [{ owner: { kind: "blob", blobId: "b_00000000" }, path: "a.html" }, 404, "no such agent"],
    ] as const) {
      const r = await api("POST", "/kleio/previews", body);
      expect(r.status, JSON.stringify(body)).toBe(status);
      expect(r.body).toEqual({ error });
    }
    const bad = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        { host: "127.0.0.1", port: apiPort, method: "POST", path: "/kleio/previews", headers: H },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end("{not json");
    });
    expect(bad).toBe(400);
  });

  it("serves a Code project's two-file site on the preview origin, sandboxed", async () => {
    const { path } = await mint(ws(join(projects(), "demo")), "site/index.html");
    expect(path).toMatch(/^\/p\/[A-Za-z0-9_-]{43}\/index\.html$/);
    const page = await call(previewPort, "GET", path, undefined, {});
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.text).toContain("<h1>Demo</h1>");
    const css = await call(
      previewPort,
      "GET",
      path.replace(/index\.html$/, "style.css"),
      undefined,
      {},
    );
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    for (const r of [page, css]) {
      expect(r.headers["content-security-policy"]).toBe(PREVIEW_CSP);
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["referrer-policy"]).toBe("no-referrer");
      expect(r.headers["cache-control"]).toBe("no-store");
    }
    // The folder token covers the site only, not the project around it.
    const up = await call(
      previewPort,
      "GET",
      path.replace(/index\.html$/, "../notes.txt"),
      undefined,
      {},
    );
    expect(up.status).toBe(404);
    expect(up.text).not.toContain("PROJECT NOTES");
  });

  it("mints a one-page token for a Chat report at the projects root", async () => {
    const { path } = await mint(ws(projects()), "report.html");
    expect(path).toMatch(/\/report\.html$/);
    const page = await call(previewPort, "GET", path, undefined, {});
    expect(page.status).toBe(200);
    expect(page.text).toContain("<h1>Report</h1>");
    const base = path.replace(/report\.html$/, "");
    for (const p of ["", "report.pdf", "other/secret.txt", "demo/site/index.html"]) {
      const r = await call(previewPort, "GET", base + p, undefined, {});
      expect(r.status, p).toBe(404);
      expect(r.text).not.toContain("OTHER PROJECT");
    }
  });

  it("serves a Specialist's site from its own folder", async () => {
    const made = await api("POST", "/kleio/blobs", {
      name: "Web",
      job: "I make sites.",
      autoSchedule: false,
    });
    expect(made.status).toBe(200);
    const blobId = (made.body as { blob: { id: string } }).blob.id;
    const dir = join(home, "Kleio", "blobs", blobId, "site");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), "<h1>Blob site</h1>");
    const { path } = await mint({ kind: "blob", blobId }, "site/index.html");
    const page = await call(previewPort, "GET", path, undefined, {});
    expect(page.status).toBe(200);
    expect(page.text).toContain("<h1>Blob site</h1>");
  });

  it.skipIf(process.platform === "win32")(
    "gives a one-page token when the site folder is a symlinked projects root",
    async () => {
      // A cwd that reaches the root through a link still counts as the root.
      symlinkSync(projects(), join(projects(), "demo", "loop"));
      const r = await api("POST", "/kleio/previews", {
        owner: ws(join(projects(), "demo")),
        path: "loop/report.html",
      });
      // The link leads outside the cwd's real path, so it is not readable at all.
      expect(r.status).toBe(404);
    },
  );

  it("stops working when the token expires or the device is revoked", async () => {
    const a = await mint(ws(join(projects(), "demo")), "site/index.html");
    expect((await call(previewPort, "GET", a.path, undefined, {})).status).toBe(200);
    clock += 60 * 60 * 1000;
    expect((await call(previewPort, "GET", a.path, undefined, {})).status).toBe(404);
    const b = await mint(ws(join(projects(), "demo")), "site/index.html");
    expect((await call(previewPort, "GET", b.path, undefined, {})).status).toBe(200);
    expect((await registry.revoke(phoneId)).ok).toBe(true);
    expect((await call(previewPort, "GET", b.path, undefined, {})).status).toBe(404);
  });

  it("never logs a token", async () => {
    const minted = await mint(ws(join(projects(), "demo")), "site/index.html");
    await call(previewPort, "GET", minted.path, undefined, {});
    await call(previewPort, "GET", `/p/${minted.token}`, undefined, {});
    expect(logs.some((l) => l.startsWith("[preview]"))).toBe(true);
    expect(logs.join("\n")).not.toContain(minted.token);
  });
});

describe("origin isolation", () => {
  it("answers no API path on the preview port, even with a device token", async () => {
    for (const p of [
      "/kleio/health",
      "/kleio/blobs",
      "/kleio/home",
      "/kleio/devices",
      "/kleio/workspace/files/report.pdf?cwd=" + encodeURIComponent(projects()),
      "/events",
      "/state",
      "/",
    ]) {
      const r = await call(previewPort, "GET", p, undefined, H);
      expect(r.status, p).toBe(404);
      expect(r.text).not.toContain("%PDF");
    }
    const post = await call(previewPort, "POST", "/kleio/previews", { owner: ws(projects()) }, H);
    expect(post.status).toBe(405);
    expect(sidecar.seen).toEqual([]);
  });

  it("never lets a page on the preview origin read the API", async () => {
    const origin = `http://127.0.0.1:${previewPort}`;
    const preflight = await api("OPTIONS", "/kleio/health", undefined, {
      origin,
      "access-control-request-method": "GET",
      "access-control-request-headers": DEVICE_TOKEN_HEADER,
    });
    const gets = await Promise.all([
      api("GET", "/kleio/health", undefined, { origin }),
      api("GET", "/kleio/blobs", undefined, { ...H, origin }),
      api(
        "GET",
        `/kleio/workspace/files/report.pdf?cwd=${encodeURIComponent(projects())}`,
        undefined,
        { ...H, origin },
      ),
    ]);
    expect(gets.map((r) => r.status)).toEqual([200, 200, 200]);
    for (const r of [preflight, ...gets])
      expect(Object.keys(r.headers).filter((k) => k.startsWith("access-control-"))).toEqual([]);
    // Without the device token, the API is closed.
    expect((await api("GET", "/kleio/blobs", undefined, { origin })).status).toBe(401);
  });
});
