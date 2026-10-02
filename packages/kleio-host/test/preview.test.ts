import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPreviewServer,
  createPreviewStore,
  PREVIEW_CSP,
  previewContentType,
  type PreviewStore,
} from "../src/preview.js";

let dir: string;
let clock: number;
const revoked = new Set<string>();
let store: PreviewStore;
let server: Server;
let port: number;
const logs: string[] = [];

beforeEach(async () => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "kleio-preview-")));
  clock = Date.parse("2026-10-02T12:00:00Z");
  revoked.clear();
  logs.length = 0;
  store = createPreviewStore({
    deviceActive: (id) => !revoked.has(id),
    now: () => new Date(clock),
  });
  server = createPreviewServer({ store, log: (m) => logs.push(m) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

interface Res {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}
function get(path: string, method = "GET", headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** A two-file site under <dir>/projects/demo/site. */
function site(): string {
  const root = join(dir, "projects", "demo", "site");
  mkdirSync(join(root, "css"), { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    '<link rel="stylesheet" href="css/style.css"><h1>Hi</h1>',
  );
  writeFileSync(join(root, "css", "style.css"), "body { background: rgb(1, 2, 3); }");
  return root;
}

function expectPreviewHeaders(r: Res): void {
  expect(r.headers["content-security-policy"]).toBe(PREVIEW_CSP);
  expect(r.headers["x-content-type-options"]).toBe("nosniff");
  expect(r.headers["referrer-policy"]).toBe("no-referrer");
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.headers["access-control-allow-origin"]).toBe("*");
  expect(r.headers["access-control-allow-credentials"]).toBeUndefined();
}

describe("preview store", () => {
  it("mints a 43-char base64url token that expires after an hour", () => {
    const m = store.mint({ deviceId: "d1", siteRoot: "/s" });
    expect(m.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(m.expiresAt.getTime()).toBe(clock + 60 * 60 * 1000);
    expect(store.lookup(m.token)).toEqual({
      siteRoot: "/s",
      deviceId: "d1",
      expiresAt: clock + 3_600_000,
    });
    clock += 3_600_000 - 1;
    expect(store.lookup(m.token)).not.toBeNull();
    clock += 1;
    expect(store.lookup(m.token)).toBeNull();
  });

  it("keeps onlyFile, forgets a revoked device's tokens and unknown ones", () => {
    const m = store.mint({ deviceId: "d1", siteRoot: "/s", onlyFile: "/s/r.html" });
    expect(store.lookup(m.token)?.onlyFile).toBe("/s/r.html");
    revoked.add("d1");
    expect(store.lookup(m.token)).toBeNull();
    revoked.clear();
    expect(store.lookup(m.token)).toBeNull();
    expect(store.lookup("x".repeat(43))).toBeNull();
  });

  it("keeps at most 50 per device, evicting the oldest", () => {
    const first = Array.from({ length: 50 }, () => store.mint({ deviceId: "d1", siteRoot: "/s" }));
    const other = store.mint({ deviceId: "d2", siteRoot: "/s" });
    const next = store.mint({ deviceId: "d1", siteRoot: "/s" });
    expect(store.lookup(first[0]?.token ?? "")).toBeNull();
    expect(store.lookup(first[1]?.token ?? "")).not.toBeNull();
    expect(store.lookup(next.token)).not.toBeNull();
    expect(store.lookup(other.token)).not.toBeNull();
  });
});

describe("previewContentType", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["a.CSS", "text/css; charset=utf-8"],
    ["app.mjs", "text/javascript; charset=utf-8"],
    ["logo.svg", "image/svg+xml"],
    ["f.woff2", "font/woff2"],
    ["r.pdf", "application/pdf"],
    ["x.exe", "application/octet-stream"],
    ["noext", "application/octet-stream"],
  ])("%s → %s", (name, type) => expect(previewContentType(name)).toBe(type));
});

describe("preview server", () => {
  it("serves a two-file site with the sandbox headers", async () => {
    const root = site();
    const { token } = store.mint({ deviceId: "d1", siteRoot: root });
    const page = await get(`/p/${token}/index.html`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.body).toContain("<h1>Hi</h1>");
    expectPreviewHeaders(page);
    const css = await get(`/p/${token}/css/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(css.body).toContain("rgb(1, 2, 3)");
    expectPreviewHeaders(css);
    // A folder path is its index.html.
    const index = await get(`/p/${token}/`);
    expect(index.status).toBe(200);
    expect(index.body).toContain("<h1>Hi</h1>");
  });

  it("answers HEAD with headers only and 405 for anything else", async () => {
    const { token } = store.mint({ deviceId: "d1", siteRoot: site() });
    const head = await get(`/p/${token}/index.html`, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect(Number(head.headers["content-length"])).toBeGreaterThan(0);
    for (const m of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const r = await get(`/p/${token}/index.html`, m);
      expect(r.status, m).toBe(405);
      expect(r.headers.allow).toBe("GET, HEAD");
      expectPreviewHeaders(r);
    }
  });

  it("is 404 for traversal, hidden names, missing files and symlinks out", async () => {
    const root = site();
    writeFileSync(join(root, ".env"), "TOKEN=1");
    writeFileSync(join(dir, "projects", "demo", "secret.txt"), "OUTSIDE");
    const { token } = store.mint({ deviceId: "d1", siteRoot: root });
    for (const p of [
      "..%2Fsecret.txt",
      "../secret.txt",
      "%2e%2e/secret.txt",
      ".env",
      "%2Eenv",
      "nope.html",
      "css",
    ]) {
      const r = await get(`/p/${token}/${p}`);
      expect(r.status, p).toBe(404);
      expect(r.body).not.toContain("OUTSIDE");
      expectPreviewHeaders(r);
    }
    if (process.platform !== "win32") {
      symlinkSync(join(dir, "projects", "demo", "secret.txt"), join(root, "link.txt"));
      const r = await get(`/p/${token}/link.txt`);
      expect(r.status).toBe(404);
      expect(r.body).not.toContain("OUTSIDE");
    }
  });

  it("is 404 for an unknown, expired or revoked token", async () => {
    const root = site();
    const a = store.mint({ deviceId: "d1", siteRoot: root });
    const b = store.mint({ deviceId: "d2", siteRoot: root });
    expect((await get(`/p/${"A".repeat(43)}/index.html`)).status).toBe(404);
    revoked.add("d2");
    expect((await get(`/p/${b.token}/index.html`)).status).toBe(404);
    expect((await get(`/p/${a.token}/index.html`)).status).toBe(200);
    clock += 60 * 60 * 1000;
    expect((await get(`/p/${a.token}/index.html`)).status).toBe(404);
  });

  it("serves only the one file of a single-file token", async () => {
    const chat = join(dir, "projects");
    mkdirSync(join(chat, "other-project"), { recursive: true });
    writeFileSync(join(chat, "report.html"), "<h1>Report</h1>");
    writeFileSync(join(chat, "sibling.csv"), "a,b");
    writeFileSync(join(chat, "index.html"), "<h1>Index</h1>");
    writeFileSync(join(chat, "other-project", "index.html"), "OTHER-PROJECT");
    const { token } = store.mint({
      deviceId: "d1",
      siteRoot: chat,
      onlyFile: join(chat, "report.html"),
    });
    const r = await get(`/p/${token}/report.html`);
    expect(r.status).toBe(200);
    expect(r.body).toBe("<h1>Report</h1>");
    expectPreviewHeaders(r);
    for (const p of [
      "",
      "sibling.csv",
      "index.html",
      "other-project/",
      "other-project/index.html",
    ]) {
      const miss = await get(`/p/${token}/${p}`);
      expect(miss.status, p).toBe(404);
      expect(miss.body).not.toContain("OTHER-PROJECT");
    }
  });

  it("knows no other path, even with a device header", async () => {
    const { token } = store.mint({ deviceId: "d1", siteRoot: site() });
    for (const p of ["/", "/kleio/health", "/kleio/blobs", "/events", "/state", `/p/${token}`]) {
      const r = await get(p, "GET", { "x-kleio-device-token": "anything" });
      expect(r.status, p).toBe(404);
      expectPreviewHeaders(r);
    }
  });

  it("never logs a token", async () => {
    const { token } = store.mint({ deviceId: "d1", siteRoot: site() });
    await get(`/p/${token}/index.html`);
    await get(`/p/${token}`);
    await get(`/p/${token}/missing.css`);
    await new Promise((r) => setTimeout(r, 20));
    expect(logs.length).toBe(3);
    expect(logs[0]).toMatch(/^\[preview\] GET \/p\/…\/index\.html → 200 \d+B \d+ms$/);
    for (const line of logs) expect(line).not.toContain(token);
  });
});
