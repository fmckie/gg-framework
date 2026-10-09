// The voice's files routes: GET /kleio/voice/files and POST
// /kleio/voice/files/read (list_files / read_file), plus agent-files.ts.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import {
  createTextCache,
  fileKind,
  isReadable,
  listFolder,
  PART_CHARS,
  partOf,
} from "../src/agent-files.js";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
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

/** Write `rel` under `dir` with `content`, its mtime `ageS` seconds ago. */
function put(dir: string, rel: string, content: string | Buffer = "x", ageS = 0): string {
  const full = join(dir, ...rel.split("/"));
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  const t = new Date(Date.now() - ageS * 1000);
  utimesSync(full, t, t);
  return full;
}

/** A symlink, except on Windows, where making one needs extra rights (as in files.test.ts). */
function link(target: string, at: string): void {
  if (process.platform !== "win32") symlinkSync(target, at);
}

interface Entry {
  path: string;
  name: string;
  kind: string;
  size: number;
  modified: string;
  readable: boolean;
  member?: string;
  by?: string;
}
const list = async (q: string): Promise<Res> => call("GET", `/kleio/voice/files?${q}`);
const files = (r: Res): Entry[] => (r.body as { files: Entry[] }).files;
const read = (body: unknown, headers = H): Promise<Res> =>
  call("POST", "/kleio/voice/files/read", body, headers);
const kleioDir = (): string => join(home, "Kleio");

// ---------------------------------------------------------------- agent-files.ts

describe("agent-files: listFolder", () => {
  it("lists regular files only: no hidden, symlinks, skipped folders or deep ones", async () => {
    const root = join(home, "walk");
    put(root, "a.md");
    put(root, "sub/b.pdf");
    put(root, ".env");
    put(root, ".cache/c.txt");
    put(root, "node_modules/x.js");
    put(root, "__pycache__/x.py");
    put(root, "venv/x.py");
    put(root, "lib/site-packages/x.py");
    put(root, "1/2/3/4/5/deep.txt");
    put(root, "1/2/3/4/5/6/deeper.txt");
    put(home, "outside/secret.txt");
    link(join(home, "outside"), join(root, "linked"));
    link(join(home, "outside", "secret.txt"), join(root, "link.txt"));
    const found = (await listFolder(root)).map((f) => f.path).sort();
    expect(found).toEqual(["1/2/3/4/5/deep.txt", "a.md", "sub/b.pdf"]);
    expect(await listFolder(join(home, "missing"))).toEqual([]);
  });

  it("stops after 3,000 entries", async () => {
    const root = join(home, "many");
    mkdirSync(root);
    for (let i = 0; i < 3_100; i++) writeFileSync(join(root, `f${i}.txt`), "");
    expect((await listFolder(root)).length).toBe(3_000);
  }, 15_000);

  it("knows kinds and what can be read", () => {
    expect(fileKind("R.PDF")).toBe("pdf");
    expect(fileKind("a.docx")).toBe("document");
    expect(fileKind("a.numbers")).toBe("spreadsheet");
    expect(fileKind("a.key")).toBe("slides");
    expect(fileKind("a.htm")).toBe("web_page");
    expect(fileKind("a.markdown")).toBe("text");
    expect(fileKind("a.yml")).toBe("data");
    expect(fileKind("a.scss")).toBe("code");
    expect(fileKind("a.heic")).toBe("image");
    expect(fileKind("a.m4a")).toBe("audio");
    expect(fileKind("a.webm")).toBe("video");
    expect(fileKind("Makefile")).toBe("other");
    for (const n of ["a.pdf", "a.docx", "a.pptx", "a.xlsx", "a.html", "a.txt", "a.csv", "a.ts"])
      expect(isReadable(n), n).toBe(true);
    for (const n of [
      "a.doc",
      "a.xls",
      "a.ppt",
      "a.key",
      "a.numbers",
      "a.rtf",
      "a.png",
      "a.mp3",
      "x",
    ])
      expect(isReadable(n), n).toBe(false);
  });

  it("splits text into parts and caches with a TTL and a size bound", () => {
    expect(partOf("", 1)).toEqual({ ok: true, value: { text: "", parts: 1 } });
    const t = "a".repeat(PART_CHARS) + "b";
    expect(partOf(t, 2)).toEqual({ ok: true, value: { text: "b", parts: 2 } });
    expect(partOf(t, 3)).toEqual({ ok: false, error: { parts: 2 } });
    let now = 0;
    const c = createTextCache(2, 1000, () => now);
    c.set("a", { text: "A" });
    c.set("b", { text: "B" });
    c.get("a");
    c.set("c", { text: "C" });
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toEqual({ text: "A" });
    now = 2000;
    expect(c.get("c")).toBeUndefined();
  });
});

// ---------------------------------------------------------------- list

describe("GET /kleio/voice/files", () => {
  it("is 401 unpaired, 400 for an unknown source or bad id", async () => {
    expect((await call("GET", "/kleio/voice/files?source=kleio", undefined, {})).status).toBe(401);
    expect((await read({ source: "kleio", path: "a.txt" }, {})).status).toBe(401);
    for (const q of [
      "source=nope",
      "",
      "source=specialist&id=b_XYZ",
      "source=specialist",
      "source=group&id=b_12345678",
      "source=chat&id=..%2Fx",
      "source=code",
    ]) {
      const r = await list(q);
      expect(r.status, q).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
  });

  it("kleio: her own folder, newest first, without blobs/ and groups/", async () => {
    put(kleioDir(), "old.md", "old", 100);
    put(kleioDir(), "reports/new.pdf", "%PDF", 10);
    put(kleioDir(), "pic.png", "png", 50);
    put(kleioDir(), "blobs/b_00000000/x.txt");
    put(kleioDir(), "groups/g_00000000/b_00000000/y.txt");
    put(kleioDir(), ".gg/uploads/z.txt");
    const r = await list("source=kleio&id=ignored");
    expect(r.status).toBe(200);
    expect(files(r).map((f) => f.path)).toEqual(["reports/new.pdf", "pic.png", "old.md"]);
    expect(files(r)[0]).toMatchObject({ name: "new.pdf", kind: "pdf", size: 4, readable: true });
    expect(files(r)[1]).toMatchObject({ kind: "image", readable: false });
    expect(files(r)[0]?.modified).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(files(r)[0]).not.toHaveProperty("member");
    const line = await logged("[voice] Phone: files kleio list ");
    expect(line).toMatch(/^\[voice\] Phone: files kleio list 200 in \d+ ms$/);
  });

  it("gives Kleio's folder for showing a file only when the workspace file route serves it", async () => {
    put(kleioDir(), "reports/q3.pdf", "%PDF-1.7");
    // Here Kleio's folder is outside the projects folders: nothing fetches from it.
    expect((await list("source=kleio")).body).not.toHaveProperty("cwd");
    await host.stop();
    host = await startHost({ homeCwd: join(projectsDir(), "Kleio") });
    put(join(projectsDir(), "Kleio"), "reports/q3.pdf", "%PDF-1.7");
    const r = await list("source=kleio");
    const cwd = (r.body as { cwd?: string }).cwd;
    expect(cwd).toBe(realpathSync(join(projectsDir(), "Kleio")));
    // What the phone then does to show it: the same route as every file card.
    const shown = await call(
      "GET",
      `/kleio/workspace/files/reports/q3.pdf?cwd=${encodeURIComponent(cwd ?? "")}`,
    );
    expect(shown.status).toBe(200);
    expect(shown.raw.toString("utf8")).toBe("%PDF-1.7");
  });

  it("answers at most 40", async () => {
    for (let i = 0; i < 45; i++) put(kleioDir(), `f${i}.txt`, "x", i);
    const r = await list("source=kleio");
    expect(files(r)).toHaveLength(40);
    expect(files(r)[0]?.name).toBe("f0.txt");
  });

  it("specialist: its folder; 404 when it doesn't exist", async () => {
    const b = await newBlob("Scout");
    put(blobDir(b.id), "brief.md", "# hi");
    const r = await list(`source=specialist&id=${b.id}`);
    expect(r.status).toBe(200);
    expect(files(r).map((f) => f.path)).toEqual(["brief.md"]);
    put(blobDir("b_deadbeef"), "orphan.md");
    const gone = await list("source=specialist&id=b_deadbeef");
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ error: "not_found" });
  });

  it("group: every current member's folder, tagged with who made it", async () => {
    const a = await newBlob("Ada");
    const c = await newBlob("Cy");
    const g = await newGroup([a.id, c.id]);
    const gdir = (bid: string): string => join(kleioDir(), "groups", g.id, bid);
    put(gdir(a.id), "a.md", "a", 20);
    put(gdir(c.id), "c/report.docx", "c", 10);
    put(gdir("b_99999999"), "former.md");
    const r = await list(`source=group&id=${g.id}`);
    expect(r.status).toBe(200);
    expect(files(r)).toEqual([
      expect.objectContaining({ path: "c/report.docx", member: c.id, by: "Cy", kind: "document" }),
      expect.objectContaining({ path: "a.md", member: a.id, by: "Ada" }),
    ]);
    expect((await list("source=group&id=g_deadbeef")).status).toBe(404);
  });
});

// ---------------------------------------------------------------- read

describe("POST /kleio/voice/files/read", () => {
  it("kleio: reads a part through the sidecar, and caches the text", async () => {
    const text = "a".repeat(PART_CHARS) + "tail";
    put(kleioDir(), "notes/long.md", text);
    const r = await read({ source: "kleio", path: "notes/long.md" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      name: "long.md",
      kind: "text",
      part: 1,
      parts: 2,
      text: "a".repeat(PART_CHARS),
    });
    expect(sidecar.fileTextCalls).toHaveLength(1);
    expect(sidecar.fileTextCalls[0]?.name).toBe("long.md");
    expect(sidecar.fileTextCalls[0]?.type).toBe("application/octet-stream");
    const two = await read({ source: "kleio", path: "notes/long.md", part: 2 });
    expect(two.body).toMatchObject({ part: 2, parts: 2, text: "tail" });
    // Unchanged: from the cache.
    expect(sidecar.fileTextCalls).toHaveLength(1);
    const three = await read({ source: "kleio", path: "notes/long.md", part: 3 });
    expect(three.status).toBe(416);
    expect(three.body).toEqual({ error: "no_such_part", parts: 2 });
    // Changed: read again.
    put(kleioDir(), "notes/long.md", "short", 1);
    const again = await read({ source: "kleio", path: "notes/long.md" });
    expect(again.body).toMatchObject({ parts: 1, text: "short" });
    expect(sidecar.fileTextCalls).toHaveLength(2);
    const line = await logged("[voice] Phone: files kleio read ");
    expect(line).toMatch(/^\[voice\] Phone: files kleio read 200 in \d+ ms$/);
    expect(logs.join("\n")).not.toContain("long.md");
  });

  it("passes pages through, and maps the sidecar's failures", async () => {
    put(kleioDir(), "r.pdf", "%PDF");
    sidecar.fileText = { status: 200, body: { text: "Page one.", pages: 3 } };
    expect((await read({ source: "kleio", path: "r.pdf" })).body).toEqual({
      name: "r.pdf",
      kind: "pdf",
      part: 1,
      parts: 1,
      text: "Page one.",
      pages: 3,
    });
    const cases: [number, unknown, number, string][] = [
      [422, { error: "unreadable" }, 422, "unreadable"],
      [415, { error: "unsupported" }, 415, "unsupported"],
      [413, { error: "too_large" }, 413, "too_large"],
      [500, { error: "boom" }, 503, "files_unavailable"],
    ];
    for (const [i, [status, body, want, error]] of cases.entries()) {
      put(kleioDir(), `f${i}.txt`, "x");
      sidecar.fileText = { status, body };
      const r = await read({ source: "kleio", path: `f${i}.txt` });
      expect(r.status, String(status)).toBe(want);
      expect(r.body).toEqual({ error });
    }
  });

  it("is 503 when the sidecar is unreachable", async () => {
    put(kleioDir(), "r.txt", "x");
    await sidecar.close();
    const r = await read({ source: "kleio", path: "r.txt" });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "files_unavailable" });
  });

  it("is 415 for a file it can't read, without calling the sidecar", async () => {
    put(kleioDir(), "pic.png", "png");
    put(kleioDir(), "old.doc", "doc");
    for (const path of ["pic.png", "old.doc"]) {
      const r = await read({ source: "kleio", path });
      expect(r.status).toBe(415);
      expect(r.body).toEqual({ error: "unsupported" });
    }
    expect(sidecar.fileTextCalls).toHaveLength(0);
  });

  it("is 413 over 20 MB", async () => {
    const full = put(kleioDir(), "big.txt", "");
    truncateSync(full, 20 * 1024 * 1024 + 1);
    const r = await read({ source: "kleio", path: "big.txt" });
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ error: "too_large" });
    expect(sidecar.fileTextCalls).toHaveLength(0);
  });

  it("refuses bad bodies, traversal, hidden names, symlinks and other owners' folders", async () => {
    const b = await newBlob("Scout");
    put(blobDir(b.id), "mine.txt");
    put(kleioDir(), ".env", "TOKEN=1");
    put(kleioDir(), "node_modules/x.js", "x");
    put(home, "outside.txt", "OUTSIDE");
    link(join(home, "outside.txt"), join(kleioDir(), "out.txt"));
    link(join(kleioDir(), "blobs"), join(kleioDir(), "agents"));
    for (const body of [
      null,
      [],
      { source: "nope", path: "a.txt" },
      { source: "kleio" },
      { source: "kleio", path: "" },
      { source: "kleio", path: "a.txt", part: 0 },
      { source: "kleio", path: "a.txt", part: 1.5 },
      { source: "kleio", path: "a.txt", part: "2" },
      { source: "kleio", path: "../outside.txt" },
      { source: "kleio", path: "a/../../outside.txt" },
      { source: "kleio", path: ".env" },
      { source: "kleio", path: "/etc/passwd" },
      { source: "specialist", path: "mine.txt" },
      { source: "group", id: "g_12345678", path: "x.txt" },
    ]) {
      const r = await read(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
    for (const body of [
      { source: "kleio", path: "out.txt" },
      { source: "kleio", path: `blobs/${b.id}/mine.txt` },
      { source: "kleio", path: `agents/${b.id}/mine.txt` },
      { source: "kleio", path: "node_modules/x.js" },
      { source: "kleio", path: "missing.txt" },
      { source: "specialist", id: "b_deadbeef", path: "mine.txt" },
    ]) {
      const r = await read(body);
      expect(r.status, JSON.stringify(body)).toBe(404);
      expect(r.body).toEqual({ error: "not_found" });
    }
    expect(sidecar.fileTextCalls).toHaveLength(0);
    const big = await read({ source: "kleio", path: "a".repeat(5000) });
    expect(big.status).toBe(413);
  });

  it("specialist and group: reads a member's file, refuses a non-member", async () => {
    const a = await newBlob("Ada");
    const c = await newBlob("Cy");
    const g = await newGroup([a.id]);
    put(blobDir(a.id), "solo.md", "solo");
    expect((await read({ source: "specialist", id: a.id, path: "solo.md" })).body).toMatchObject({
      text: "solo",
    });
    put(join(kleioDir(), "groups", g.id, a.id), "team.md", "team");
    put(join(kleioDir(), "groups", g.id, c.id), "not-member.md", "no");
    const ok = await read({ source: "group", id: g.id, member: a.id, path: "team.md" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: "team.md", text: "team" });
    const no = await read({ source: "group", id: g.id, member: c.id, path: "not-member.md" });
    expect(no.status).toBe(404);
    const noMember = await read({ source: "group", id: g.id, path: "team.md" });
    expect(noMember.status).toBe(400);
  });
});

// ---------------------------------------------------------------- chat / code

describe("voice files: chats and coding sessions", () => {
  function session(id: string, cwd: string, made: string[]): void {
    sidecar.stored.reads[id] = {
      session: { id, title: "Demo", cwd, lastActivity: "2026-10-07T09:00:00.000Z" },
      messages: [],
      files: made,
    };
  }

  it("lists and reads only the session's own files inside its folder", async () => {
    const dir = join(projectsDir(), "demo");
    const made = put(dir, "out/report.md", "# Report", 5);
    const csv = put(dir, "data.csv", "a,b", 1);
    put(dir, "secret.ts", "not made by the session");
    put(dir, ".env", "TOKEN=1");
    const outside = put(home, "elsewhere/x.txt", "outside");
    link(outside, join(dir, "link.txt"));
    session("s1", dir, [
      made,
      csv,
      join(dir, ".env"),
      outside,
      join(dir, "link.txt"),
      join(dir, "missing.txt"),
      dir,
      "relative.txt",
      42,
    ] as string[]);
    const r = await list("source=code&id=s1");
    expect(r.status).toBe(200);
    expect(files(r).map((f) => [f.path, f.kind])).toEqual([
      ["data.csv", "data"],
      ["out/report.md", "text"],
    ]);
    // Its folder, which the phone fetches a file from to show it.
    expect((r.body as { cwd?: string }).cwd).toBe(realpathSync(dir));
    expect(sidecar.storedCalls).toContain("/stored-sessions/s1?kind=code&files=1");

    const ok = await read({ source: "code", id: "s1", path: "out/report.md" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: "report.md", text: "# Report" });
    // A real file in the folder the session didn't make.
    for (const path of ["secret.ts", "link.txt", "../../elsewhere/x.txt"]) {
      const no = await read({ source: "code", id: "s1", path });
      expect(no.status, path).toBe(404);
    }
    const chat = await read({ source: "chat", id: "s1", path: "data.csv" });
    expect(chat.status).toBe(200);
    expect(sidecar.storedCalls).toContain("/stored-sessions/s1?kind=chat&files=1");
  });

  it("is 404 for an unknown session, one outside the projects folders, or in Kleio's folder", async () => {
    expect((await list("source=chat&id=nope")).status).toBe(404);
    const away = join(home, "away");
    put(away, "a.md");
    session("s2", away, [join(away, "a.md")]);
    expect((await list("source=chat&id=s2")).status).toBe(404);
    put(kleioDir(), "k.md");
    session("s3", kleioDir(), [join(kleioDir(), "k.md")]);
    expect((await list("source=chat&id=s3")).status).toBe(404);
    expect((await read({ source: "chat", id: "s3", path: "k.md" })).status).toBe(404);
  });

  it("is 503 when the sidecar is unreachable", async () => {
    await sidecar.close();
    const r = await list("source=chat&id=s1");
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "files_unavailable" });
  });
});
