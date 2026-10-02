import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

// ---------------------------------------------------------------- host fixture

let home: string;
let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let host: Host;
let hostPort: number;
let H: Record<string, string>;
const logs: string[] = [];

async function startHost(): Promise<Host> {
  const h = createHost({
    listenPort: 0,
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
    log: (m) => logs.push(m),
  });
  await h.start();
  hostPort = (h.server.address() as { port: number }).port;
  return h;
}

beforeEach(async () => {
  logs.length = 0;
  home = mkdtempSync(join(tmpdir(), "kleio-files-route-"));
  mkdirSync(join(home, "secure"), { mode: 0o700 });
  chmodSync(join(home, "secure"), 0o700);
  const keyPath = join(home, "secure", "headless-master.key");
  writeFileSync(keyPath, generateMasterKey(), { mode: 0o600 });
  registry = createDeviceRegistry({
    keychain: createFileKeychain({ keyPath }),
    storePath: join(home, "secure", "device-registry.json"),
  });
  await registry.init();
  const phone = await registry.mint("Phone"); // not admin
  if (!phone.ok) throw new Error("mint");
  H = { [DEVICE_TOKEN_HEADER]: phone.value.token };
  sidecar = await fakeSidecar();
  writeFileSync(
    join(home, "sidecar.json"),
    JSON.stringify({ port: sidecar.port, token: sidecar.token, pid: 1, startedAt: "x" }),
  );
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
  raw: Buffer;
  body: unknown;
}
function call(method: string, path: string, body?: unknown, headers = H): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: hostPort,
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
          const raw = Buffer.concat(chunks);
          let parsed: unknown = raw.toString("utf8");
          try {
            parsed = JSON.parse(raw.toString("utf8"));
          } catch {
            // not JSON: keep the raw text
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function newBlob(name: string): Promise<{ id: string }> {
  const r = await call("POST", "/kleio/blobs", { name, job: `I am ${name}.`, autoSchedule: false });
  expect(r.status).toBe(200);
  return (r.body as { blob: { id: string } }).blob;
}

async function newGroup(members: string[]): Promise<{ id: string }> {
  const r = await call("POST", "/kleio/groups", { name: "Team", members });
  expect(r.status).toBe(200);
  return (r.body as { group: { id: string } }).group;
}

const blobDir = (id: string): string => join(home, "Kleio", "blobs", id);

/** The [files] log line starting with `prefix`; the server logs once the response has finished. */
async function logged(prefix: string): Promise<string | undefined> {
  for (let i = 0; i < 50; i++) {
    const hit = logs.find((l) => l.startsWith(prefix));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  return undefined;
}

// ---------------------------------------------------------------- routes

describe("GET /kleio/blobs/:id/files/*", () => {
  it("serves the file's exact bytes with download-only headers", async () => {
    const b = await newBlob("Scout");
    const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0, 1, 2, 255, 254])]);
    const name = "Morning-AI-Research-2026-10-01.pdf";
    mkdirSync(blobDir(b.id), { recursive: true });
    writeFileSync(join(blobDir(b.id), name), bytes);

    const r = await call("GET", `/kleio/blobs/${b.id}/files/${name}`);
    expect(r.status).toBe(200);
    expect(r.raw.equals(bytes)).toBe(true);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-length"]).toBe(String(bytes.length));
    expect(r.headers.etag).toMatch(new RegExp(`^"${bytes.length}-\\d+"$`));
    expect(r.headers["last-modified"]).toMatch(/GMT$/);
    expect(r.headers["content-disposition"]).toBe(`attachment; filename*=UTF-8''${name}`);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect(r.headers["cache-control"]).toBe("private, no-cache");
    expect(await logged(`[files] Phone ${b.id} → `)).toMatch(
      new RegExp(`^\\[files\\] Phone ${b.id} → 200 ${bytes.length}B \\d+ms$`),
    );
  });

  it("serves an encoded nested name, and html only as a download", async () => {
    const b = await newBlob("Scout");
    mkdirSync(join(blobDir(b.id), "out dir"), { recursive: true });
    writeFileSync(join(blobDir(b.id), "out dir", "café report.html"), "<script>1</script>");
    const r = await call(
      "GET",
      `/kleio/blobs/${b.id}/files/out%20dir/${encodeURIComponent("café report.html")}`,
    );
    expect(r.status).toBe(200);
    expect(r.body).toBe("<script>1</script>");
    expect(r.headers["content-type"]).toBe("application/octet-stream");
    expect(r.headers["content-disposition"]).toBe(
      "attachment; filename*=UTF-8''caf%C3%A9%20report.html",
    );
  });

  it("is 401 without a device token", async () => {
    const b = await newBlob("Scout");
    mkdirSync(blobDir(b.id), { recursive: true });
    writeFileSync(join(blobDir(b.id), "r.txt"), "secret");
    const r = await call("GET", `/kleio/blobs/${b.id}/files/r.txt`, undefined, {});
    expect(r.status).toBe(401);
    const bad = await call("GET", `/kleio/blobs/${b.id}/files/r.txt`, undefined, {
      [DEVICE_TOKEN_HEADER]: "nope",
    });
    expect(bad.status).toBe(401);
  });

  it("is 404 for an unknown agent, even when its folder exists", async () => {
    mkdirSync(blobDir("b_deadbeef"), { recursive: true });
    writeFileSync(join(blobDir("b_deadbeef"), "r.txt"), "orphan");
    const r = await call("GET", "/kleio/blobs/b_deadbeef/files/r.txt");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "no such agent" });
  });

  it("is 400 for a bad path or a hidden name, 404 for a missing file", async () => {
    const b = await newBlob("Scout");
    mkdirSync(join(blobDir(b.id), ".venv"), { recursive: true });
    writeFileSync(join(blobDir(b.id), ".venv", "cfg"), "hidden");
    writeFileSync(join(blobDir(b.id), ".env"), "TOKEN=1");
    writeFileSync(join(home, "Kleio", "secret"), "OUTSIDE");
    for (const p of ["..%2F..%2Fsecret", "..%5C..%5Csecret", "a%5Cb", "%E0%A4%A", "a//b", "a%00"]) {
      const r = await call("GET", `/kleio/blobs/${b.id}/files/${p}`);
      expect(r.status, p).toBe(400);
      expect(r.body).toEqual({ error: "bad path" });
    }
    // Dot segments (plain or %2e) are collapsed by the URL parser before
    // routing, so they never reach a folder they could climb out of.
    for (const p of ["%2e%2e/%2e%2e/secret", "../../secret", "%2E%2E/%2e%2E/%2e%2e/secret"]) {
      const r = await call("GET", `/kleio/blobs/${b.id}/files/${p}`);
      expect(r.status, p).not.toBe(200);
      expect(r.raw.toString()).not.toContain("OUTSIDE");
    }
    // Hidden names are a bad path, refused before the disk is touched.
    for (const p of [".env", ".venv/cfg", "%2Eenv"]) {
      const r = await call("GET", `/kleio/blobs/${b.id}/files/${p}`);
      expect(r.status, p).toBe(400);
      expect(r.body).toEqual({ error: "bad path" });
    }
    const missing = await call("GET", `/kleio/blobs/${b.id}/files/nope.pdf`);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "no such file" });
  });

  it("is 405 with allow: GET for any other method", async () => {
    const b = await newBlob("Scout");
    mkdirSync(blobDir(b.id), { recursive: true });
    writeFileSync(join(blobDir(b.id), "r.txt"), "keep");
    for (const m of ["POST", "PUT", "DELETE"]) {
      const r = await call(m, `/kleio/blobs/${b.id}/files/r.txt`, {});
      expect(r.status, m).toBe(405);
      expect(r.headers.allow).toBe("GET");
      expect(r.body).toEqual({ error: "method not allowed" });
    }
  });

  it("leaves the existing Blob routes alone", async () => {
    const b = await newBlob("Scout");
    const r = await call("GET", `/kleio/blobs/${b.id}`);
    expect(r.status).toBe(200);
    expect((r.body as { blob: { id: string } }).blob.id).toBe(b.id);
    const files = await call("GET", `/kleio/blobs/${b.id}/files`);
    expect(files.status).not.toBe(200);
  });
});

describe("GET /kleio/groups/:id/members/:blobId/files/*", () => {
  it("serves a member's file from its group folder", async () => {
    const a = await newBlob("Ada");
    const c = await newBlob("Cy");
    const g = await newGroup([a.id, c.id]);
    const dir = join(home, "Kleio", "groups", g.id, a.id);
    mkdirSync(join(dir, "out"), { recursive: true });
    writeFileSync(join(dir, "out", "notes.md"), "# Notes\n");
    const r = await call("GET", `/kleio/groups/${g.id}/members/${a.id}/files/out/notes.md`);
    expect(r.status).toBe(200);
    expect(r.body).toBe("# Notes\n");
    expect(r.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(await logged(`[files] Phone ${g.id}/${a.id} → 200 8B `)).toBeDefined();
    // Not in the agent's own folder.
    const own = await call("GET", `/kleio/blobs/${a.id}/files/out/notes.md`);
    expect(own.status).toBe(404);
    expect(own.body).toEqual({ error: "no such file" });
  });

  it("is 404 for an unknown group", async () => {
    const a = await newBlob("Ada");
    const dir = join(home, "Kleio", "groups", "g_deadbeef", a.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "r.txt"), "orphan");
    const r = await call("GET", `/kleio/groups/g_deadbeef/members/${a.id}/files/r.txt`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "no such group" });
  });

  it("is 405 for POST", async () => {
    const a = await newBlob("Ada");
    const g = await newGroup([a.id]);
    const r = await call("POST", `/kleio/groups/${g.id}/members/${a.id}/files/r.txt`, {});
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET");
  });
});
