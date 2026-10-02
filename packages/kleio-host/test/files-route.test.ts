import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { MAX_FILE_BYTES } from "../src/files.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host, type HostOptions } from "../src/host.js";
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

/** Kleio's projects folders for the workspace route: the Chat root and an extra root. */
const projectsDir = (): string => join(home, "projects");
const extraDir = (): string => join(home, "extra-root");

async function startHost(extra: Partial<HostOptions> = {}, withWorkspace = true): Promise<Host> {
  const options: HostOptions = {
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
    workspaceRoots: () => Promise.resolve([projectsDir(), extraDir()]),
    log: (m) => logs.push(m),
    ...extra,
  };
  const { workspaceRoots: _unused, ...noWorkspace } = options;
  const h = createHost(withWorkspace ? options : noWorkspace);
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

describe("GET /kleio/workspace/files/*?cwd=", () => {
  const ws = (cwd: string, rest: string): string =>
    `/kleio/workspace/files/${rest}?cwd=${encodeURIComponent(cwd)}`;
  const project = (): string => join(projectsDir(), "demo");

  beforeEach(() => {
    mkdirSync(join(project(), "out"), { recursive: true });
    mkdirSync(extraDir(), { recursive: true });
  });

  it("serves a Code project's PDF with the Blob file headers", async () => {
    const bytes = Buffer.from("%PDF-1.7\nhello");
    writeFileSync(join(project(), "out", "report.pdf"), bytes);
    const r = await call("GET", ws(project(), "out/report.pdf"));
    expect(r.status).toBe(200);
    expect(r.raw.equals(bytes)).toBe(true);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''report.pdf");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(await logged("[files] Phone workspace ")).toMatch(
      new RegExp(`^\\[files\\] Phone workspace ".*demo" → 200 ${bytes.length}B \\d+ms$`),
    );
  });

  it("serves a CSV from the Chat root and a file from an extra root", async () => {
    writeFileSync(join(projectsDir(), "sales.csv"), "a,b\n1,2\n");
    const r = await call("GET", ws(projectsDir(), "sales.csv"));
    expect(r.status).toBe(200);
    expect(r.body).toBe("a,b\n1,2\n");
    expect(r.headers["content-type"]).toMatch(/^text\/csv/);
    writeFileSync(join(extraDir(), "x.txt"), "extra");
    const e = await call("GET", ws(extraDir(), "x.txt"));
    expect(e.status).toBe(200);
    expect(e.body).toBe("extra");
  });

  it("keeps html a download, never a page", async () => {
    writeFileSync(join(project(), "index.html"), "<script>1</script>");
    const r = await call("GET", ws(project(), "index.html"));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/octet-stream");
    expect(r.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''index.html");
  });

  it("is 401 without a device token", async () => {
    writeFileSync(join(project(), "r.txt"), "secret");
    const r = await call("GET", ws(project(), "r.txt"), undefined, {});
    expect(r.status).toBe(401);
  });

  it("is 400 for hidden names and bad paths, 404 for a missing file", async () => {
    writeFileSync(join(project(), ".env"), "TOKEN=1");
    writeFileSync(join(projectsDir(), "secret.txt"), "OUTSIDE-PROJECT");
    for (const p of [".env", "%2Eenv", "..%2Fsecret.txt", "a%5Cb"]) {
      const r = await call("GET", ws(project(), p));
      expect(r.status, p).toBe(400);
      expect(r.body).toEqual({ error: "bad path" });
    }
    for (const p of ["../secret.txt", "%2e%2e/secret.txt"]) {
      const r = await call("GET", ws(project(), p));
      expect(r.status, p).not.toBe(200);
      expect(r.raw.toString()).not.toContain("OUTSIDE-PROJECT");
    }
    const missing = await call("GET", ws(project(), "nope.pdf"));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "no such file" });
  });

  it("is 404 for a cwd outside Kleio's folders, hidden, relative or missing", async () => {
    writeFileSync(join(home, "outside.txt"), "OUTSIDE");
    mkdirSync(join(home, "projects-evil"), { recursive: true });
    writeFileSync(join(home, "projects-evil", "x.txt"), "EVIL");
    mkdirSync(join(projectsDir(), ".hidden"), { recursive: true });
    writeFileSync(join(projectsDir(), ".hidden", "x.txt"), "HIDDEN");
    for (const [cwd, rest] of [
      [home, "outside.txt"],
      [join(home, "projects-evil"), "x.txt"],
      [join(projectsDir(), ".hidden"), "x.txt"],
      ["projects/demo", "x.txt"],
      [join(projectsDir(), "gone"), "x.txt"],
    ] as const) {
      const r = await call("GET", ws(cwd, rest));
      expect(r.status, cwd).toBe(404);
      expect(r.body).toEqual({ error: "no such workspace" });
    }
    const noCwd = await call("GET", "/kleio/workspace/files/x.txt");
    expect(noCwd.status).toBe(404);
    expect(noCwd.body).toEqual({ error: "no such workspace" });
  });

  it.skipIf(process.platform === "win32")("is 404 for a symlink out of the project", async () => {
    writeFileSync(join(home, "outside.txt"), "OUTSIDE");
    symlinkSync(join(home, "outside.txt"), join(project(), "link.txt"));
    symlinkSync(home, join(projectsDir(), "escape"));
    const file = await call("GET", ws(project(), "link.txt"));
    expect(file.status).toBe(404);
    expect(file.raw.toString()).not.toContain("OUTSIDE");
    const dir = await call("GET", ws(join(projectsDir(), "escape"), "outside.txt"));
    expect(dir.status).toBe(404);
    expect(dir.body).toEqual({ error: "no such workspace" });
  });

  it("is 413 for a file over the size cap", async () => {
    const big = join(project(), "big.csv");
    writeFileSync(big, "");
    truncateSync(big, MAX_FILE_BYTES + 1);
    const r = await call("GET", ws(project(), "big.csv"));
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ error: "file too large" });
  });

  it("is 405 with allow: GET for POST", async () => {
    writeFileSync(join(project(), "r.txt"), "keep");
    const r = await call("POST", ws(project(), "r.txt"), {});
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET");
  });

  it("is 404 when the host has no workspace roots", async () => {
    await host.stop();
    host = await startHost({}, false);
    writeFileSync(join(project(), "r.txt"), "keep");
    const r = await call("GET", ws(project(), "r.txt"));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "no such workspace" });
  });
});
