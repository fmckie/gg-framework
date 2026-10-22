// Her voice's shows: POST /kleio/voice/show, GET /kleio/voice/show/<id> and
// GET /kleio/voice/show/<id>/text|image|page-<n> (show.ts, host.ts). Web
// pages and PDFs are drawn by a fake capturer here; capture.test.ts tests the
// real one.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capturer, CaptureSupport, PdfDoc, Png } from "../src/capture.js";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host, type HostOptions } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import { err, ok } from "../src/result.js";
import {
  checkShowPath,
  parseShowPart,
  SHOW_IMAGE_MAX,
  SHOW_PDF_MAX,
  SHOW_TEXT_MAX,
  SHOW_TTL_MS,
  VOICE_PLACES,
  wholeUtf8,
  WORKSPACE_PLACES,
  type ShowInfo,
} from "../src/show.js";
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

// ---------------------------------------------------------------- fakes

/** A real PNG signature, then bytes: what the fake capturer "draws", and a picture file. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("a picture"),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("a photo")]);
const WEBP = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 a picture", "latin1");

interface FakeCapture {
  readonly capturer: Capturer;
  /** Addresses url() was asked for, PDFs counted, pages drawn. */
  readonly urls: string[];
  pdfs: number;
  readonly pages: number[];
}

/** A capturer that draws nothing: canned pictures and PDFs in `dir`, by the address's path. */
function fakeCapture(dir: string, support: CaptureSupport = { available: true }): FakeCapture {
  mkdirSync(dir, { recursive: true });
  const png = (name: string): Png => {
    const file = join(dir, name);
    writeFileSync(file, PNG);
    return { file, width: 2048, height: 1600, bytes: PNG.length };
  };
  const doc = (pages: number): PdfDoc => {
    const file = join(dir, `d_${pages}.pdf`);
    writeFileSync(file, "%PDF-1.7");
    return { id: `d_${"a".repeat(32)}`, file, pages, totalPages: pages, title: "A paper" };
  };
  const fake: FakeCapture = {
    urls: [],
    pdfs: 0,
    pages: [],
    capturer: {
      support,
      async url(raw, view, signal) {
        fake.urls.push(raw);
        const url = new URL(raw);
        const host = url.hostname;
        if (url.pathname === "/slow") {
          // Runs until the show is replaced.
          await new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
          return err({ kind: "cancelled", host });
        }
        if (url.pathname === "/gone") return err({ kind: "http_status", status: 404, host });
        if (url.pathname.endsWith(".pdf")) return ok({ kind: "pdf", doc: doc(3), host });
        return ok({
          kind: "web",
          png: png(`c_${view}.png`),
          host,
          status: 200,
          cut: true,
          signIn: url.pathname === "/login",
          title: "A page",
        });
      },
      async pdf(bytes) {
        fake.pdfs += 1;
        if (bytes.toString("latin1").includes("locked")) return err({ kind: "locked", host: "" });
        return ok(doc(2));
      },
      async pdfPage(d, page) {
        fake.pages.push(page);
        if (page > d.pages) return err({ kind: "no_page", host: "" });
        return ok(png(`p_${page}.png`));
      },
    },
  };
  return fake;
}

// ---------------------------------------------------------------- host fixture

let home: string;
let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let host: Host;
let hostPort: number;
let PHONE: Record<string, string>;
let LAPTOP: Record<string, string>;
let clock: number;
let fake: FakeCapture;
const logs: string[] = [];

const kleioDir = (): string => join(home, "Kleio");
const projectsDir = (): string => join(home, "projects");
const appDir = (): string => join(projectsDir(), "app");
const blobDir = (id: string): string => join(kleioDir(), "blobs", id);

async function startHost(withCapture = true, extra: Partial<HostOptions> = {}): Promise<Host> {
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
    homeCwd: kleioDir(),
    blobTickMs: 0,
    workspaceRoots: () => Promise.resolve([projectsDir()]),
    now: () => new Date(clock),
    capture: fake.capturer,
    log: (m) => logs.push(m),
    ...extra,
  };
  const { capture: _none, ...noCapture } = options;
  const h = createHost(withCapture ? options : noCapture);
  await h.start();
  hostPort = (h.server.address() as { port: number }).port;
  return h;
}

beforeEach(async () => {
  logs.length = 0;
  clock = Date.now();
  home = mkdtempSync(join(tmpdir(), "kleio-show-route-"));
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
  const laptop = await registry.mint("Laptop");
  if (!phone.ok || !laptop.ok) throw new Error("mint");
  PHONE = { [DEVICE_TOKEN_HEADER]: phone.value.token };
  LAPTOP = { [DEVICE_TOKEN_HEADER]: laptop.value.token };
  sidecar = await fakeSidecar();
  writeFileSync(
    join(home, "sidecar.json"),
    JSON.stringify({ port: sidecar.port, token: sidecar.token, pid: 1, startedAt: "x" }),
  );
  fake = fakeCapture(join(home, "captures"));
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

/** One request; `body` a string is sent as it is, anything else as JSON. */
function call(method: string, path: string, body?: unknown, headers = PHONE): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      body === undefined
        ? undefined
        : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
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

/** Write `rel` under `dir`, its mtime `ageS` seconds ago. */
function put(dir: string, rel: string, content: string | Buffer = "x", ageS = 0): string {
  const full = join(dir, ...rel.split("/"));
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  const t = new Date(Date.now() - ageS * 1000);
  utimesSync(full, t, t);
  return full;
}

/** Symlinks need extra rights on Windows: those cases run elsewhere. */
const posixIt = it.skipIf(process.platform === "win32");

const show = (body: unknown, headers = PHONE): Promise<Res> =>
  call("POST", "/kleio/voice/show", body, headers);
const info = (r: Res): ShowInfo => (r.body as { show: ShowInfo }).show;
const part = (id: string, name: string, headers = PHONE): Promise<Res> =>
  call("GET", `/kleio/voice/show/${id}/${name}`, undefined, headers);

/** The show, once its capture has ended. */
async function settled(id: string): Promise<ShowInfo> {
  for (let i = 0; i < 100; i++) {
    const r = await call("GET", `/kleio/voice/show/${id}`);
    const s = info(r);
    if (s.state !== "capturing") return s;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("still capturing");
}

/** Every part of a show carries these: nothing in it runs, sniffs or is kept. */
function expectSafeHeaders(r: Res, type: string): void {
  expect(r.headers["content-type"]).toBe(type);
  expect(r.headers["x-content-type-options"]).toBe("nosniff");
  expect(r.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
  expect(r.headers["cache-control"]).toBe("private, no-store");
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

/** A saved session the fake sidecar answers for, with the files it made. */
function session(id: string, cwd: string, made: string[]): void {
  sidecar.stored.reads[id] = {
    session: { id, title: "Demo", cwd, lastActivity: "2026-10-07T09:00:00.000Z" },
    messages: [],
    files: made,
  };
}

// ---------------------------------------------------------------- show.ts

describe("show.ts", () => {
  it("names parts as text, image or page-1 to page-500", () => {
    expect(parseShowPart("text")).toEqual({ kind: "text" });
    expect(parseShowPart("image")).toEqual({ kind: "image" });
    expect(parseShowPart("page-1")).toEqual({ kind: "page", page: 1 });
    expect(parseShowPart("page-500")).toEqual({ kind: "page", page: 500 });
    for (const bad of ["page-0", "page-501", "page-01", "page-1x", "page-", "Page-1", "thumb", ""])
      expect(parseShowPart(bad), bad).toBeNull();
  });

  it("places a path in its owner's folder or one of the two hidden folders", () => {
    expect(checkShowPath("reports/q3.md")).toEqual({
      segments: ["reports", "q3.md"],
      place: "folder",
    });
    expect(checkShowPath(".gg/plans/plan.md")?.place).toBe("plans");
    expect(checkShowPath(".gg/generated/x.png")?.place).toBe("generated");
    // A percent escape that doesn't spell anything dangerous is a name.
    expect(checkShowPath("50%25 off.md")?.place).toBe("folder");
  });

  it("opens .gg/screenshots to the viewer only, and a session's plans never to it", () => {
    // Her voice's hidden folders by default: screenshots are never hers.
    expect(checkShowPath(".gg/screenshots/x.png")).toBeNull();
    expect(checkShowPath(".gg/plans/plan.md", VOICE_PLACES)?.place).toBe("plans");
    expect(checkShowPath(".gg/screenshots/x.png", WORKSPACE_PLACES)?.place).toBe("screenshots");
    expect(checkShowPath(".gg/generated/x.png", WORKSPACE_PLACES)?.place).toBe("generated");
    expect(checkShowPath(".gg/plans/plan.md", WORKSPACE_PLACES)).toBeNull();
    expect(checkShowPath("out/report.md", WORKSPACE_PLACES)?.place).toBe("folder");
  });

  it("never cuts a character in half", () => {
    const text = Buffer.from("ab€", "utf8"); // € is 3 bytes
    expect(wholeUtf8(text.subarray(0, 4)).toString("utf8")).toBe("ab");
    expect(wholeUtf8(text.subarray(0, 3)).toString("utf8")).toBe("ab");
    expect(wholeUtf8(text).toString("utf8")).toBe("ab€");
    expect(wholeUtf8(Buffer.from("plain")).toString("utf8")).toBe("plain");
  });
});

// ---------------------------------------------------------------- files

describe("POST /kleio/voice/show: files on the allow-list", () => {
  it("shows Kleio's own report as Markdown, as plain text", async () => {
    put(kleioDir(), "report.md", "# Q3\n\nAll good.");
    const r = await show({ source: "kleio", path: "report.md" });
    expect(r.status).toBe(200);
    const s = info(r);
    expect(s).toEqual({
      id: s.id,
      kind: "text",
      name: "report.md",
      state: "ready",
      format: "markdown",
    });
    expect(s.id).toMatch(/^sh_[0-9a-f]{32}$/);
    const text = await part(s.id, "text");
    expect(text.status).toBe(200);
    expectSafeHeaders(text, "text/plain; charset=utf-8");
    expect(text.raw.toString("utf8")).toBe("# Q3\n\nAll good.");
    // The state again, for the device's panel.
    expect(info(await call("GET", `/kleio/voice/show/${s.id}`))).toEqual(s);
    // Names and paths are never logged.
    expect(logs.some((l) => /^\[voice\] Phone: show kleio 200 in \d+ ms$/.test(l))).toBe(true);
    expect(logs.join("\n")).not.toContain("report.md");
  });

  it("shows a picture Kleio made, from her .gg/generated, as what its bytes are", async () => {
    put(kleioDir(), ".gg/generated/x.png", PNG);
    // Named .jpg but a PNG: drawn as a PNG.
    put(kleioDir(), ".gg/generated/y.jpg", PNG);
    const r = await show({ source: "kleio", path: ".gg/generated/x.png" });
    expect(r.status).toBe(200);
    expect(info(r)).toMatchObject({ kind: "image", name: "x.png", state: "ready" });
    const img = await part(info(r).id, "image");
    expect(img.status).toBe(200);
    expectSafeHeaders(img, "image/png");
    expect(img.raw.equals(PNG)).toBe(true);
    const y = await show({ source: "kleio", path: ".gg/generated/y.jpg" });
    expectSafeHeaders(await part(info(y).id, "image"), "image/png");
  });

  it("shows a project's plan, its pictures and the pictures its agents made", async () => {
    put(appDir(), ".gg/plans/plan.md", "## The plan");
    put(appDir(), "docs/diagram.jpg", JPEG);
    put(appDir(), ".gg/generated/mock.webp", WEBP);
    const plan = await show({ source: "project", id: "app", path: ".gg/plans/plan.md" });
    expect(plan.status).toBe(200);
    expect(info(plan)).toMatchObject({ kind: "text", format: "markdown", name: "plan.md" });
    expect((await part(info(plan).id, "text")).raw.toString("utf8")).toBe("## The plan");
    const diagram = await show({ source: "project", id: "app", path: "docs/diagram.jpg" });
    expect(diagram.status).toBe(200);
    expectSafeHeaders(await part(info(diagram).id, "image"), "image/jpeg");
    const mock = await show({ source: "project", id: "app", path: ".gg/generated/mock.webp" });
    expect(mock.status).toBe(200);
    expectSafeHeaders(await part(info(mock).id, "image"), "image/webp");
  });

  it("shows a specialist's PDF page by page, drawn by the capturer", async () => {
    const b = await newBlob("Scout");
    put(blobDir(b.id), "findings.pdf", "%PDF-1.7 two pages");
    const r = await show({ source: "specialist", id: b.id, path: "findings.pdf" });
    expect(r.status).toBe(200);
    const s = info(r);
    expect(s).toMatchObject({
      kind: "pdf",
      name: "findings.pdf",
      state: "ready",
      pages: 2,
      totalPages: 2,
      title: "A paper",
    });
    expect(fake.pdfs).toBe(1);
    const page = await part(s.id, "page-2");
    expect(page.status).toBe(200);
    expectSafeHeaders(page, "image/png");
    expect(page.raw.equals(PNG)).toBe(true);
    const past = await part(s.id, "page-3");
    expect(past.status).toBe(416);
    expect(past.body).toMatchObject({ error: "no_page", pages: 2 });
    expect((await part(s.id, "text")).status).toBe(404);
    expect((await part(s.id, "image")).body).toEqual({ error: "no_such_part" });
  });

  it("shows a group member's file, data as plain text, and an Office document's text", async () => {
    const a = await newBlob("Ada");
    const g = await newGroup([a.id]);
    put(join(kleioDir(), "groups", g.id, a.id), "team.csv", "a,b\n1,2");
    const csv = await show({ source: "group", id: g.id, member: a.id, path: "team.csv" });
    expect(csv.status).toBe(200);
    expect(info(csv)).toMatchObject({ kind: "text", format: "plain" });
    expect((await part(info(csv).id, "text")).raw.toString("utf8")).toBe("a,b\n1,2");
    put(kleioDir(), "brief.docx", "PK docx bytes");
    sidecar.fileText = { status: 200, body: { text: "The brief, as words." } };
    const doc = await show({ source: "kleio", path: "brief.docx" });
    expect(doc.status).toBe(200);
    expect(info(doc)).toMatchObject({ kind: "text", format: "plain", name: "brief.docx" });
    const text = await part(info(doc).id, "text");
    expectSafeHeaders(text, "text/plain; charset=utf-8");
    expect(text.raw.toString("utf8")).toBe("The brief, as words.");
    // Extracted once, when shown: the part comes from the cache.
    expect(sidecar.fileTextCalls).toHaveLength(1);
  });

  it("shows a chat's or coding session's own files, its generated pictures included", async () => {
    const dir = join(projectsDir(), "demo");
    const made = put(dir, "out/report.md", "# Report");
    const pic = put(dir, ".gg/generated/z.png", PNG);
    session("s1", dir, [made, pic]);
    const r = await show({ source: "code", id: "s1", path: "out/report.md" });
    expect(r.status).toBe(200);
    expect((await part(info(r).id, "text")).raw.toString("utf8")).toBe("# Report");
    const img = await show({ source: "chat", id: "s1", path: ".gg/generated/z.png" });
    expect(img.status).toBe(200);
    expect((await part(info(img).id, "image")).raw.equals(PNG)).toBe(true);
  });

  it("draws an HTML file as its text, never as markup", async () => {
    put(kleioDir(), "page.html", "<h1>Hi</h1><script>steal()</script>");
    put(kleioDir(), "old.htm", "<p>Old</p>");
    sidecar.fileText = { status: 200, body: { text: "Hi" } };
    const r = await show({ source: "kleio", path: "page.html" });
    expect(r.status).toBe(200);
    expect(info(r)).toMatchObject({ kind: "text", format: "plain" });
    const text = await part(info(r).id, "text");
    expectSafeHeaders(text, "text/plain; charset=utf-8");
    expect(text.raw.toString("utf8")).toBe("Hi");
    expect(text.raw.toString("utf8")).not.toContain("<script>");
    expect(sidecar.fileTextCalls[0]?.name).toBe("page.html");
    expect((await part(info(r).id, "image")).status).toBe(404);
    expect(info(await show({ source: "kleio", path: "old.htm" }))).toMatchObject({
      format: "plain",
    });
  });

  it("draws the first MB of a long text, cut between characters", async () => {
    // "€" is 3 bytes: after "ab", the 1 MB line falls inside one.
    const body = Buffer.from(`ab${"€".repeat(Math.ceil(SHOW_TEXT_MAX / 3) + 10)}`, "utf8");
    put(kleioDir(), "long.txt", body);
    const r = await show({ source: "kleio", path: "long.txt" });
    expect(info(r)).toMatchObject({ kind: "text", format: "plain", cut: true });
    const text = await part(info(r).id, "text");
    // The character cut by the line is left out whole.
    expect(text.raw.length).toBe(SHOW_TEXT_MAX - 2);
    // Whole characters only: it decodes, and encodes back, unchanged.
    expect(Buffer.from(text.raw.toString("utf8"), "utf8").equals(text.raw)).toBe(true);
  });

  it("ends the show when the file changes, or stops being allowed", async () => {
    const full = put(kleioDir(), "report.md", "v1", 60);
    const r = await show({ source: "kleio", path: "report.md" });
    put(kleioDir(), "report.md", "version two");
    const changed = await part(info(r).id, "text");
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ error: "changed" });
    rmSync(full);
    expect((await part(info(r).id, "text")).status).toBe(404);
    // Its owner is checked again too: a member taken out of the group.
    const a = await newBlob("Ada");
    const c = await newBlob("Cy");
    const g = await newGroup([a.id, c.id]);
    put(join(kleioDir(), "groups", g.id, a.id), "notes.md", "Ada's notes");
    const notes = await show({ source: "group", id: g.id, member: a.id, path: "notes.md" });
    expect((await part(info(notes).id, "text")).status).toBe(200);
    expect((await call("PATCH", `/kleio/groups/${g.id}`, { members: [c.id] })).status).toBe(200);
    const gone = await part(info(notes).id, "text");
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ error: "not_found" });
  });

  posixIt("ends the show when the file is swapped for a symlink", async () => {
    put(home, "outside/secret.md", "OUTSIDE");
    const full = put(kleioDir(), "report.md", "mine");
    const r = await show({ source: "kleio", path: "report.md" });
    rmSync(full);
    symlinkSync(join(home, "outside", "secret.md"), full);
    const swapped = await part(info(r).id, "text");
    expect(swapped.status).toBe(404);
    expect(swapped.raw.toString("utf8")).not.toContain("OUTSIDE");
  });
});

/** Paths refused by their spelling alone (400), for her voice's sources and the viewer's. */
const REFUSED_SPELLINGS: readonly string[] = [
  "../outside.txt",
  "a/../../outside.txt",
  "./report.md",
  "%2e%2e/outside.txt",
  "%2E%2E/outside.txt",
  "%252e%252e/outside.txt",
  "reports%2f..%2f..%2foutside.txt",
  "%2eenv",
  "/etc/passwd",
  "C:/Windows/win.ini",
  "C:report.md",
  "~/report.md",
  "~",
  "~root/report.md",
  "..\\outside.txt",
  "reports\\report.md",
  "report\u0000.md",
  "report\n.md",
  ".env",
  "reports/.env",
  ".git/config",
  ".ssh/id_ed25519",
  ".gg/sessions/x.md",
  ".gg/settings.json",
  ".gg/plans/../../.env",
  ".gg/plans/sub/plan.md",
  ".gg/generated/sub/x.png",
  "sub/.gg/plans/plan.md",
  ".gg/plans/.hidden.md",
  ".gg/generated/.x.png",
  ".gg",
  ".gg/plans",
  "report.md/",
  "a//report.md",
  "",
  "a".repeat(1025),
];

describe("POST /kleio/voice/show: refusals", () => {
  it("refuses paths that leave the folder, hide, or smuggle a separator", async () => {
    put(home, "outside.txt", "OUTSIDE");
    put(kleioDir(), ".env", "TOKEN=1");
    put(kleioDir(), ".gg/sessions/x.md", "a transcript");
    put(kleioDir(), ".gg/plans/sub/plan.md", "deep");
    put(kleioDir(), "sub/.gg/plans/plan.md", "not at the top");
    put(kleioDir(), "report.md", "ok");
    for (const path of REFUSED_SPELLINGS) {
      const r = await show({ source: "kleio", path });
      expect(r.status, JSON.stringify(path)).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
    expect(sidecar.fileTextCalls).toHaveLength(0);
  });

  posixIt("refuses a symlink anywhere: out, in, a folder, or the hidden folders", async () => {
    const b = await newBlob("Scout");
    put(blobDir(b.id), "mine.md", "the specialist's");
    put(home, "outside/secret.md", "OUTSIDE");
    put(home, "outside/secret.png", PNG);
    put(kleioDir(), "report.md", "ok");
    symlinkSync(join(home, "outside", "secret.md"), join(kleioDir(), "out.md"));
    symlinkSync(join(kleioDir(), "report.md"), join(kleioDir(), "same.md"));
    symlinkSync(join(home, "outside"), join(kleioDir(), "linked"));
    symlinkSync(join(kleioDir(), "blobs"), join(kleioDir(), "agents"));
    // Each hidden folder, or .gg itself, a symlink out.
    mkdirSync(join(appDir(), ".gg"), { recursive: true });
    symlinkSync(join(home, "outside"), join(appDir(), ".gg", "plans"));
    symlinkSync(join(home, "outside"), join(appDir(), ".gg", "generated"));
    mkdirSync(join(projectsDir(), "web"), { recursive: true });
    symlinkSync(join(home, "outside"), join(projectsDir(), "web", ".gg"));
    // A picture in .gg/generated that is itself a symlink.
    mkdirSync(join(kleioDir(), ".gg", "generated"), { recursive: true });
    symlinkSync(join(home, "outside", "secret.png"), join(kleioDir(), ".gg", "generated", "x.png"));
    const refused: [string, string | undefined, string][] = [
      ["kleio", undefined, "out.md"],
      ["kleio", undefined, "same.md"],
      ["kleio", undefined, "linked/secret.md"],
      ["kleio", undefined, `agents/${b.id}/mine.md`],
      ["kleio", undefined, ".gg/generated/x.png"],
      ["project", "app", ".gg/plans/secret.md"],
      ["project", "app", ".gg/generated/secret.png"],
      ["project", "web", ".gg/plans/secret.md"],
      ["project", "web", ".gg/generated/secret.png"],
    ];
    for (const [source, id, path] of refused) {
      const r = await show({ source, ...(id ? { id } : {}), path });
      expect(r.status, `${source} ${path}`).toBe(404);
      expect(r.body).toEqual({ error: "not_found" });
    }
  });

  it("refuses places off the allow-list: other owners' folders, tooling, a project's code, data or build output", async () => {
    const b = await newBlob("Scout");
    put(blobDir(b.id), "mine.md");
    put(kleioDir(), "groups/g_00000000/b_00000000/team.md");
    put(kleioDir(), "node_modules/pkg/README.md");
    put(kleioDir(), ".gg/generated/notes.md");
    put(kleioDir(), ".gg/plans/picture.png", PNG);
    // A folder with a document's name.
    put(kleioDir(), "folder.md/q3.md");
    put(appDir(), "src/index.ts", "secret code");
    put(appDir(), "dist/report.md", "built");
    put(appDir(), "data.csv", "a,b");
    put(appDir(), ".gg/plans/settings.json", "{}");
    put(appDir(), "node_modules/pkg/README.md", "dep");
    const refused: [string, string | undefined, string][] = [
      ["kleio", undefined, `blobs/${b.id}/mine.md`],
      ["kleio", undefined, "groups/g_00000000/b_00000000/team.md"],
      ["kleio", undefined, "node_modules/pkg/README.md"],
      ["kleio", undefined, ".gg/generated/notes.md"],
      ["kleio", undefined, ".gg/plans/picture.png"],
      ["kleio", undefined, "missing.md"],
      ["kleio", undefined, "folder.md"],
      // Another spelling of a refused folder: on a disk that ignores case it is
      // the same folder, and its real path's spelling differs, so it is refused.
      ["kleio", undefined, `Blobs/${b.id}/mine.md`],
      ["kleio", undefined, "Node_Modules/pkg/README.md"],
      ["project", "app", "src/index.ts"],
      ["project", "app", "dist/report.md"],
      ["project", "app", "DIST/report.md"],
      ["project", "app", "data.csv"],
      ["project", "app", ".gg/plans/settings.json"],
      ["project", "app", "node_modules/pkg/README.md"],
    ];
    for (const [source, id, path] of refused) {
      const r = await show({ source, ...(id ? { id } : {}), path });
      expect(r.status, `${source} ${path}`).toBe(404);
      expect(r.body).toEqual({ error: "not_found" });
    }
    expect((await show({ source: "project", id: "app", path: ".gg/settings.json" })).status).toBe(
      400,
    );
  });

  it("refuses kinds it can't draw: SVG, HEIC, code, audio, video, old Office files", async () => {
    put(kleioDir(), "fake.png", '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    put(kleioDir(), "empty.gif", "");
    for (const path of [
      "logo.svg",
      "photo.heic",
      "script.ts",
      "song.mp3",
      "clip.mov",
      "old.doc",
      "Makefile",
      "fake.png",
      "empty.gif",
    ]) {
      if (path !== "fake.png" && path !== "empty.gif") put(kleioDir(), path, "x");
      const r = await show({ source: "kleio", path });
      expect(r.status, path).toBe(415);
      expect(r.body).toEqual({
        error: "unsupported",
        detail: "Kleio can't show this kind of file yet.",
      });
    }
    expect(fake.pdfs).toBe(0);
  });

  it("refuses other owners: another specialist, a non-member, a file the session didn't make", async () => {
    const a = await newBlob("Ada");
    const c = await newBlob("Cy");
    const g = await newGroup([a.id]);
    put(blobDir(a.id), "ada.md", "Ada's");
    put(join(kleioDir(), "groups", g.id, c.id), "not-member.md");
    const dir = join(projectsDir(), "demo");
    const made = put(dir, "made.md");
    put(dir, "secret.md", "not made by the session");
    session("s1", dir, [made, join(dir, ".gg", "plans", "p.md")]);
    put(dir, ".gg/plans/p.md", "a plan it wrote");
    const away = join(home, "away");
    session("s2", away, [put(away, "a.md")]);
    const cases: [unknown, number][] = [
      [{ source: "specialist", id: c.id, path: "ada.md" }, 404],
      [{ source: "specialist", id: "b_deadbeef", path: "ada.md" }, 404],
      [{ source: "specialist", id: "b_XYZ", path: "ada.md" }, 400],
      [{ source: "specialist", path: "ada.md" }, 400],
      [{ source: "group", id: g.id, member: c.id, path: "not-member.md" }, 404],
      [{ source: "group", id: g.id, path: "not-member.md" }, 400],
      [{ source: "group", id: "g_deadbeef", member: a.id, path: "x.md" }, 404],
      [{ source: "code", id: "s1", path: "secret.md" }, 404],
      [{ source: "code", id: "s1", path: ".gg/plans/p.md" }, 404],
      [{ source: "code", id: "nope", path: "made.md" }, 404],
      [{ source: "chat", id: "s2", path: "a.md" }, 404],
      [{ source: "project", id: "nope", path: "README.md" }, 404],
      [{ source: "project", id: "../app", path: "README.md" }, 400],
    ];
    for (const [body, status] of cases) {
      const r = await show(body);
      expect(r.status, JSON.stringify(body)).toBe(status);
    }
    expect((await show({ source: "code", id: "s1", path: "made.md" })).status).toBe(200);
  });

  it("answers 413 over the size caps, before reading or extracting", async () => {
    truncateSync(put(kleioDir(), "huge.png", PNG), SHOW_IMAGE_MAX + 1);
    truncateSync(put(kleioDir(), "huge.pdf", "%PDF-"), SHOW_PDF_MAX + 1);
    truncateSync(put(kleioDir(), "huge.docx", "PK"), 20 * 1024 * 1024 + 1);
    for (const path of ["huge.png", "huge.pdf", "huge.docx"]) {
      const r = await show({ source: "kleio", path });
      expect(r.status, path).toBe(413);
      expect(r.body).toMatchObject({ error: "too_large" });
    }
    expect(fake.pdfs).toBe(0);
    expect(sidecar.fileTextCalls).toHaveLength(0);
  });

  it("says when a PDF is locked, and keeps no show", async () => {
    put(kleioDir(), "locked.pdf", "%PDF- locked");
    const r = await show({ source: "kleio", path: "locked.pdf" });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ error: "locked", detail: "That PDF is locked with a password." });
  });

  it("refuses bad bodies", async () => {
    for (const body of [
      null,
      [],
      {},
      "not json",
      { url: 5 },
      { url: "https://example.com/", source: "kleio" },
      { url: "https://example.com/", path: "a.md" },
      { url: "https://example.com/", view: "tv" },
      { source: "nope", path: "a.md" },
      { source: "kleio" },
      { source: "kleio", path: 5 },
      { source: "kleio", path: "a.md", id: 5 },
      { source: "kleio", path: "a.md", member: 5 },
    ]) {
      const r = await show(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
    const big = await show({ source: "kleio", path: "a".repeat(5000) });
    expect(big.status).toBe(413);
  });
});

// ---------------------------------------------------------------- the viewer's: a session's folder

/** A Chat or Code session's folder, in Kleio's projects folders. */
const demoDir = (): string => join(projectsDir(), "demo");
/** The viewer's request for a file in a session's folder. */
const inFolder = (path: string, cwd = demoDir()): Record<string, string> => ({
  source: "workspace",
  cwd,
  path,
});

describe("POST /kleio/voice/show: a session's folder, for the file viewer", () => {
  it("shows its Markdown, text and CSV as text, and never logs the folder or a name", async () => {
    put(demoDir(), "README.md", "# Demo\n\nHello.");
    put(demoDir(), "notes.txt", "plain notes");
    put(demoDir(), "data/team.csv", "a,b\n1,2");
    const md = await show(inFolder("README.md"));
    expect(md.status).toBe(200);
    const s = info(md);
    expect(s).toEqual({
      id: s.id,
      kind: "text",
      name: "README.md",
      state: "ready",
      format: "markdown",
    });
    const text = await part(s.id, "text");
    expectSafeHeaders(text, "text/plain; charset=utf-8");
    expect(text.raw.toString("utf8")).toBe("# Demo\n\nHello.");
    const txt = await show(inFolder("notes.txt"));
    expect(info(txt)).toMatchObject({ kind: "text", format: "plain", name: "notes.txt" });
    expect((await part(info(txt).id, "text")).raw.toString("utf8")).toBe("plain notes");
    const csv = await show(inFolder("data/team.csv"));
    expect(info(csv)).toMatchObject({ kind: "text", format: "plain", name: "team.csv" });
    expect((await part(info(csv).id, "text")).raw.toString("utf8")).toBe("a,b\n1,2");
    expect(logs.some((l) => /^\[voice\] Phone: show workspace 200 in \d+ ms$/.test(l))).toBe(true);
    const logged = logs.join("\n");
    for (const secret of [demoDir(), "README", "notes.txt", "team.csv"])
      expect(logged).not.toContain(secret);
  });

  it("shows its PDF page by page, a picture as what its bytes are, and a report in out/", async () => {
    put(demoDir(), "paper.pdf", "%PDF-1.7 two pages");
    put(demoDir(), "out/report.md", "# Built");
    // Named .jpg but a PNG: drawn as a PNG.
    put(demoDir(), "docs/chart.jpg", PNG);
    const pdf = await show(inFolder("paper.pdf"));
    expect(pdf.status).toBe(200);
    expect(info(pdf)).toMatchObject({ kind: "pdf", name: "paper.pdf", state: "ready", pages: 2 });
    const page = await part(info(pdf).id, "page-2");
    expect(page.status).toBe(200);
    expectSafeHeaders(page, "image/png");
    expect(page.raw.equals(PNG)).toBe(true);
    expect((await part(info(pdf).id, "page-3")).status).toBe(416);
    const report = await show(inFolder("out/report.md"));
    expect(report.status).toBe(200);
    expect((await part(info(report).id, "text")).raw.toString("utf8")).toBe("# Built");
    const chart = await show(inFolder("docs/chart.jpg"));
    expect(info(chart)).toMatchObject({ kind: "image", name: "chart.jpg", state: "ready" });
    const img = await part(info(chart).id, "image");
    expectSafeHeaders(img, "image/png");
    expect(img.raw.equals(PNG)).toBe(true);
  });

  it("shows the pictures generate_image and screenshot made, one level deep", async () => {
    put(demoDir(), ".gg/generated/x.png", PNG);
    put(demoDir(), ".gg/screenshots/y.png", PNG);
    put(demoDir(), ".gg/screenshots/z.jpeg", JPEG);
    const cases: [string, string][] = [
      [".gg/generated/x.png", "image/png"],
      [".gg/screenshots/y.png", "image/png"],
      [".gg/screenshots/z.jpeg", "image/jpeg"],
    ];
    for (const [path, type] of cases) {
      const r = await show(inFolder(path));
      expect(r.status, path).toBe(200);
      expect(info(r)).toMatchObject({ kind: "image", state: "ready" });
      expectSafeHeaders(await part(info(r).id, "image"), type);
    }
  });

  it("is only ever the device's that made it", async () => {
    put(demoDir(), "notes.md", "mine");
    const id = info(await show(inFolder("notes.md"))).id;
    for (const r of [
      await call("GET", `/kleio/voice/show/${id}`, undefined, LAPTOP),
      await part(id, "text", LAPTOP),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "not_found" });
    }
    expect((await part(id, "text")).status).toBe(200);
  });

  it("ends the show when the file changes, or the folder leaves Kleio's projects folders", async () => {
    // Kleio's projects folders, as settings would change them.
    let roots = [projectsDir()];
    await host.stop();
    host = await startHost(true, { workspaceRoots: () => Promise.resolve(roots) });
    put(demoDir(), "report.md", "v1", 60);
    put(demoDir(), ".gg/screenshots/y.png", PNG, 60);
    const r = await show(inFolder("report.md"));
    put(demoDir(), "report.md", "version two");
    const changed = await part(info(r).id, "text");
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ error: "changed" });
    const pic = await show(inFolder(".gg/screenshots/y.png"));
    expect((await part(info(pic).id, "image")).status).toBe(200);
    roots = [kleioDir()];
    const gone = await part(info(pic).id, "image");
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ error: "not_found" });
  });

  posixIt("ends the show when the file, or the folder, is swapped for a symlink", async () => {
    put(home, "outside/report.md", "OUTSIDE");
    put(home, "outside/notes.md", "OUTSIDE");
    const full = put(demoDir(), "report.md", "mine");
    const r = await show(inFolder("report.md"));
    rmSync(full);
    symlinkSync(join(home, "outside", "report.md"), full);
    const swapped = await part(info(r).id, "text");
    expect(swapped.status).toBe(404);
    expect(swapped.raw.toString("utf8")).not.toContain("OUTSIDE");
    // The session's folder itself swapped for a link out of the projects folders.
    const web = join(projectsDir(), "web");
    put(web, "notes.md", "web notes");
    const w = await show(inFolder("notes.md", web));
    expect(w.status).toBe(200);
    rmSync(web, { recursive: true, force: true });
    symlinkSync(join(home, "outside"), web);
    const moved = await part(info(w).id, "text");
    expect(moved.status).toBe(404);
    expect(moved.raw.toString("utf8")).not.toContain("OUTSIDE");
  });
});

describe("POST /kleio/voice/show: a session's folder, refused", () => {
  it("refuses the same spellings, its plans and anything but a picture one level into screenshots", async () => {
    put(home, "outside.txt", "OUTSIDE");
    put(demoDir(), ".env", "TOKEN=1");
    put(demoDir(), "report.md", "ok");
    put(demoDir(), ".gg/plans/p.md", "a plan");
    put(demoDir(), ".gg/screenshots/sub/x.png", PNG);
    put(demoDir(), ".gg/screenshots/.x.png", PNG);
    for (const path of [
      ...REFUSED_SPELLINGS,
      ".gg/plans/p.md",
      ".gg/screenshots/sub/x.png",
      ".gg/screenshots/.x.png",
      ".gg/screenshots",
    ]) {
      const r = await show(inFolder(path));
      expect(r.status, JSON.stringify(path)).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
  });

  it("keeps .gg/screenshots closed to her voice's sources", async () => {
    put(kleioDir(), ".gg/screenshots/x.png", PNG);
    put(appDir(), ".gg/screenshots/x.png", PNG);
    for (const body of [
      { source: "kleio", path: ".gg/screenshots/x.png" },
      { source: "project", id: "app", path: ".gg/screenshots/x.png" },
    ]) {
      const r = await show(body);
      expect(r.status, body.source).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
  });

  posixIt(
    "refuses a symlink anywhere: out, in, a folder, .gg or either picture folder",
    async () => {
      put(home, "outside/secret.md", "OUTSIDE");
      put(home, "outside/secret.png", PNG);
      put(home, "outside/generated/secret.png", PNG);
      put(home, "outside/screenshots/secret.png", PNG);
      const demo = demoDir();
      put(demo, "report.md", "ok");
      symlinkSync(join(home, "outside", "secret.md"), join(demo, "out.md"));
      symlinkSync(join(demo, "report.md"), join(demo, "same.md"));
      symlinkSync(join(home, "outside"), join(demo, "linked"));
      // .gg/generated a symlink out, and a picture in .gg/screenshots that is one.
      mkdirSync(join(demo, ".gg", "screenshots"), { recursive: true });
      symlinkSync(join(home, "outside"), join(demo, ".gg", "generated"));
      symlinkSync(join(home, "outside", "secret.png"), join(demo, ".gg", "screenshots", "x.png"));
      // The other way round in a second folder.
      const web = join(projectsDir(), "web");
      mkdirSync(join(web, ".gg", "generated"), { recursive: true });
      symlinkSync(join(home, "outside"), join(web, ".gg", "screenshots"));
      symlinkSync(join(home, "outside", "secret.png"), join(web, ".gg", "generated", "x.png"));
      // .gg itself a symlink out.
      const site = join(projectsDir(), "site");
      mkdirSync(site, { recursive: true });
      symlinkSync(join(home, "outside"), join(site, ".gg"));
      const refused: [string, string][] = [
        [demo, "out.md"],
        [demo, "same.md"],
        [demo, "linked/secret.md"],
        [demo, ".gg/generated/secret.png"],
        [demo, ".gg/screenshots/x.png"],
        [web, ".gg/screenshots/secret.png"],
        [web, ".gg/generated/x.png"],
        [site, ".gg/generated/secret.png"],
        [site, ".gg/screenshots/secret.png"],
      ];
      for (const [cwd, path] of refused) {
        const r = await show(inFolder(path, cwd));
        expect(r.status, `${cwd} ${path}`).toBe(404);
        expect(r.body).toEqual({ error: "not_found" });
      }
    },
  );

  it("refuses tooling folders and a picture folder's other files, 404 like a missing one", async () => {
    put(demoDir(), "node_modules/pkg/README.md", "dep");
    put(demoDir(), "lib/__pycache__/notes.txt", "cache");
    put(demoDir(), ".gg/generated/notes.md", "not a picture");
    put(demoDir(), ".gg/screenshots/notes.md", "not a picture");
    // A folder with a document's name.
    put(demoDir(), "x.md/inner.md", "inside");
    for (const path of [
      "node_modules/pkg/README.md",
      // Another spelling of a refused folder: its real path's spelling differs.
      "Node_Modules/pkg/README.md",
      "lib/__pycache__/notes.txt",
      ".gg/generated/notes.md",
      ".gg/screenshots/notes.md",
      "missing.md",
      "x.md",
    ]) {
      const r = await show(inFolder(path));
      expect(r.status, path).toBe(404);
      expect(r.body).toEqual({ error: "not_found" });
    }
  });

  it("refuses kinds the viewer doesn't draw, and never extracts a document's text", async () => {
    put(demoDir(), "fake.png", '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    put(demoDir(), "empty.gif", "");
    for (const path of [
      "src/index.ts",
      "logo.svg",
      "photo.heic",
      "report.docx",
      "page.html",
      "data.json",
      "Makefile",
      "fake.png",
      "empty.gif",
    ]) {
      if (path !== "fake.png" && path !== "empty.gif") put(demoDir(), path, "x");
      const r = await show(inFolder(path));
      expect(r.status, path).toBe(415);
      expect(r.body).toEqual({
        error: "unsupported",
        detail: "Kleio can't show this kind of file yet.",
      });
    }
    expect(sidecar.fileTextCalls).toHaveLength(0);
    expect(fake.pdfs).toBe(0);
  });

  it("refuses a folder outside Kleio's projects folders, hidden, relative, missing or a file", async () => {
    put(demoDir(), "notes.md", "ok");
    put(demoDir(), ".gg/plans/notes.md", "a plan");
    put(projectsDir(), ".hidden/notes.md", "hidden");
    put(kleioDir(), "notes.md", "Kleio's own");
    put(home, "notes.md", "home");
    for (const cwd of [
      "projects/demo",
      "/etc",
      home,
      kleioDir(),
      // The plans, reached as a folder of their own: still hidden.
      join(demoDir(), ".gg", "plans"),
      join(projectsDir(), ".hidden"),
      join(projectsDir(), "missing"),
      join(demoDir(), "notes.md"),
      `${demoDir()}\n`,
      `${demoDir()}\u0000`,
      `/${"a".repeat(1024)}`,
    ]) {
      const r = await show(inFolder("notes.md", cwd));
      expect(r.status, JSON.stringify(cwd.slice(0, 80))).toBe(404);
      expect(r.body).toEqual({ error: "not_found" });
    }
    expect((await show(inFolder("notes.md"))).status).toBe(200);
  });

  posixIt("refuses a folder linked out of the projects folders", async () => {
    put(home, "outside/notes.md", "OUTSIDE");
    mkdirSync(projectsDir(), { recursive: true });
    symlinkSync(join(home, "outside"), join(projectsDir(), "linked"));
    const r = await show(inFolder("notes.md", join(projectsDir(), "linked")));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "not_found" });
  });

  it("shows nothing on a host with no projects folders", async () => {
    put(demoDir(), "notes.md", "ok");
    await host.stop();
    host = await startHost(true, { workspaceRoots: undefined });
    const r = await show(inFolder("notes.md"));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "not_found" });
  });

  it("answers 413 over the size caps, before reading", async () => {
    truncateSync(put(demoDir(), "huge.png", PNG), SHOW_IMAGE_MAX + 1);
    truncateSync(put(demoDir(), ".gg/screenshots/huge.png", PNG), SHOW_IMAGE_MAX + 1);
    truncateSync(put(demoDir(), "huge.pdf", "%PDF-"), SHOW_PDF_MAX + 1);
    for (const path of ["huge.png", ".gg/screenshots/huge.png", "huge.pdf"]) {
      const r = await show(inFolder(path));
      expect(r.status, path).toBe(413);
      expect(r.body).toMatchObject({ error: "too_large" });
    }
    expect(fake.pdfs).toBe(0);
  });

  it("refuses bad bodies: a cwd that isn't a string, or beside an id, a member or an address", async () => {
    put(demoDir(), "notes.md", "ok");
    const cwd = demoDir();
    for (const body of [
      { source: "workspace", path: "notes.md" },
      { source: "workspace", cwd: 5, path: "notes.md" },
      { source: "workspace", cwd: null, path: "notes.md" },
      { source: "workspace", cwd: [cwd], path: "notes.md" },
      { source: "workspace", cwd },
      { source: "workspace", cwd, path: 5 },
      { source: "workspace", cwd, path: "notes.md", id: "s1" },
      { source: "workspace", cwd, path: "notes.md", member: "b_00000000" },
      { source: "workspace", cwd, path: "notes.md", url: "https://example.com/" },
      { url: "https://example.com/", cwd },
      { source: "specialist", id: "b_00000000", cwd, path: "notes.md" },
      { source: "kleio", cwd, path: "notes.md" },
    ]) {
      const r = await show(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
    expect(fake.urls).toEqual([]);
    expect((await show(inFolder("notes.md"))).status).toBe(200);
  });

  it("is never her voice's: list_files and read_file can't name a session's folder", async () => {
    put(demoDir(), "notes.md", "ok");
    const list = await call("GET", "/kleio/voice/files?source=workspace");
    expect(list.status).toBe(400);
    expect(list.body).toEqual({ error: "bad_request" });
    const read = await call("POST", "/kleio/voice/files/read", inFolder("notes.md"));
    expect(read.status).toBe(400);
    expect(read.body).toEqual({ error: "bad_request" });
  });
});

// ---------------------------------------------------------------- links

describe("POST /kleio/voice/show: web pages and PDF links", () => {
  it("captures a page in the background, then draws it", async () => {
    const r = await show({ url: "https://example.com/news?id=7", view: "phone" });
    expect(r.status).toBe(200);
    expect(info(r)).toMatchObject({
      kind: "web",
      name: "example.com",
      host: "example.com",
      state: "capturing",
    });
    const s = await settled(info(r).id);
    expect(s).toEqual({
      id: info(r).id,
      kind: "web",
      name: "example.com",
      host: "example.com",
      state: "ready",
      width: 2048,
      height: 1600,
      cut: true,
      signIn: false,
      title: "A page",
    });
    expect(fake.urls).toEqual(["https://example.com/news?id=7"]);
    const img = await part(s.id, "image");
    expect(img.status).toBe(200);
    expectSafeHeaders(img, "image/png");
    expect(img.raw.equals(PNG)).toBe(true);
    expect((await part(s.id, "text")).body).toEqual({ error: "no_such_part" });
    expect((await part(s.id, "page-1")).status).toBe(404);
    // Its host is logged; its address never is.
    expect(
      logs.some((l) => /^\[voice\] Phone: show page example\.com 200 in \d+ ms$/.test(l)),
    ).toBe(true);
    expect(logs.join("\n")).not.toContain("/news");
    expect(logs.join("\n")).not.toContain("id=7");
  });

  it("flags a sign-in wall", async () => {
    const r = await show({ url: "https://example.com/login" });
    expect(await settled(info(r).id)).toMatchObject({ state: "ready", signIn: true });
  });

  it("sends a PDF link to the PDF's pages", async () => {
    const r = await show({ url: "https://arxiv.org/pdf/1706.03762.pdf" });
    const s = await settled(info(r).id);
    expect(s).toMatchObject({ kind: "pdf", state: "ready", host: "arxiv.org", pages: 3 });
    const page = await part(s.id, "page-3");
    expect(page.status).toBe(200);
    expectSafeHeaders(page, "image/png");
    expect((await part(s.id, "image")).status).toBe(404);
  });

  it("says why a capture failed, in plain words", async () => {
    const r = await show({ url: "https://example.com/gone" });
    const s = await settled(info(r).id);
    expect(s).toMatchObject({
      kind: "web",
      state: "failed",
      reason: "http_status",
      status: 404,
      detail: "There's no page at that address (example.com answered 404).",
    });
    expect((await part(s.id, "image")).body).toEqual({ error: "failed" });
  });

  it("refuses an address before anything is fetched, and says why", async () => {
    const cases: [string, string][] = [
      ["javascript:alert(1)", "scheme"],
      ["data:text/html,<script>x</script>", "scheme"],
      ["file:///etc/passwd", "scheme"],
      ["ftp://example.com/x", "scheme"],
      ["blob:https://example.com/x", "scheme"],
      ["http://user:pass@example.com/", "credentials"],
      ["http://example.com:22/", "port"],
      ["http://localhost/", "local_name"],
      ["http://127.0.0.1/", "private_address"],
      ["http://[::1]/", "private_address"],
      ["http://169.254.169.254/latest/meta-data/", "private_address"],
      ["http://100.100.100.100/", "private_address"],
      ["http://10.0.0.1/", "private_address"],
      ["//example.com/", "bad_url"],
      [`https://example.com/${"a".repeat(2100)}`, "too_long"],
    ];
    for (const [url, refusal] of cases) {
      const r = await show({ url });
      expect(r.status, url).toBe(422);
      expect(r.body, url).toMatchObject({ error: "refused", refusal });
      expect((r.body as { detail?: unknown }).detail, url).toEqual(expect.any(String));
    }
    expect(fake.urls).toEqual([]);
  });

  it("stops a capture still running when a newer show replaces it", async () => {
    const slow = await show({ url: "https://example.com/slow" });
    expect(info(slow).state).toBe("capturing");
    expect((await part(info(slow).id, "image")).body).toEqual({ error: "not_ready" });
    put(kleioDir(), "report.md", "now this");
    expect((await show({ source: "kleio", path: "report.md" })).status).toBe(200);
    expect(await settled(info(slow).id)).toMatchObject({ state: "failed", reason: "cancelled" });
  });
});

describe("hosts that can't draw web pages or PDFs", () => {
  beforeEach(async () => {
    await host.stop();
    fake = fakeCapture(join(home, "captures"), { available: false, reason: "not_macos" });
    host = await startHost();
  });

  it("says so for a page or a PDF, and still shows text and pictures", async () => {
    const page = await show({ url: "https://example.com/" });
    expect(page.status).toBe(501);
    expect(page.body).toEqual({
      error: "unavailable",
      detail: "Kleio can't show web pages or PDFs on this host.",
    });
    put(kleioDir(), "paper.pdf", "%PDF-1.7");
    const pdf = await show({ source: "kleio", path: "paper.pdf" });
    expect(pdf.status).toBe(501);
    expect(pdf.body).toEqual(page.body);
    expect(fake.urls).toEqual([]);
    expect(fake.pdfs).toBe(0);
    put(kleioDir(), "report.md", "# Still here");
    const md = await show({ source: "kleio", path: "report.md" });
    expect(md.status).toBe(200);
    expect((await part(info(md).id, "text")).raw.toString("utf8")).toBe("# Still here");
    put(kleioDir(), ".gg/generated/x.png", PNG);
    const img = await show({ source: "kleio", path: ".gg/generated/x.png" });
    expect(img.status).toBe(200);
    expect((await part(info(img).id, "image")).raw.equals(PNG)).toBe(true);
  });

  it("still refuses a private address as one, so its link is never offered", async () => {
    const r = await show({ url: "http://169.254.169.254/latest/meta-data/" });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: "refused", refusal: "private_address" });
  });

  it("says so too when the host has no capturer at all", async () => {
    await host.stop();
    host = await startHost(false);
    const r = await show({ url: "https://example.com/" });
    expect(r.status).toBe(501);
    expect(r.body).toMatchObject({ error: "unavailable" });
  });
});

// ---------------------------------------------------------------- ids, devices, methods

describe("show ids, devices and methods", () => {
  async function aShow(): Promise<string> {
    put(kleioDir(), "report.md", "# Q3");
    const r = await show({ source: "kleio", path: "report.md" });
    expect(r.status).toBe(200);
    return info(r).id;
  }

  it("needs a paired device", async () => {
    const id = await aShow();
    expect((await show({ source: "kleio", path: "report.md" }, {})).status).toBe(401);
    expect((await call("GET", `/kleio/voice/show/${id}`, undefined, {})).status).toBe(401);
    expect((await part(id, "text", {})).status).toBe(401);
    const bad = { [DEVICE_TOKEN_HEADER]: "not-a-token" };
    expect((await part(id, "text", bad)).status).toBe(401);
  });

  it("is only ever the device's that made it", async () => {
    const id = await aShow();
    for (const r of [
      await call("GET", `/kleio/voice/show/${id}`, undefined, LAPTOP),
      await part(id, "text", LAPTOP),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "not_found" });
    }
    expect((await part(id, "text")).status).toBe(200);
  });

  it("expires after 15 minutes", async () => {
    const id = await aShow();
    clock += SHOW_TTL_MS - 1;
    expect((await call("GET", `/kleio/voice/show/${id}`)).status).toBe(200);
    clock += 1;
    expect((await call("GET", `/kleio/voice/show/${id}`)).status).toBe(404);
    expect((await part(id, "text")).status).toBe(404);
  });

  it("is 400 for a malformed id or part, 404 for an unknown one", async () => {
    const id = await aShow();
    for (const path of [
      "sh_123",
      `sh_${"A".repeat(32)}`,
      `sh_${"0".repeat(33)}`,
      `SH_${"0".repeat(32)}`,
      "x",
      "",
      `${id}/page-0`,
      `${id}/page-501`,
      `${id}/page-01`,
      `${id}/page-1x`,
      `${id}/thumb`,
      `${id}/TEXT`,
      `${id}/text/more`,
    ]) {
      const r = await call("GET", `/kleio/voice/show/${path}`);
      expect(r.status, path).toBe(400);
      expect(r.body).toEqual({ error: "bad_request" });
    }
    expect((await call("GET", `/kleio/voice/show/sh_${"0".repeat(32)}`)).status).toBe(404);
  });

  it("is 405 for the wrong method", async () => {
    const id = await aShow();
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const r = await call(method, "/kleio/voice/show");
      expect(r.status, method).toBe(405);
      expect(r.headers.allow).toBe("POST");
    }
    for (const path of [`/kleio/voice/show/${id}`, `/kleio/voice/show/${id}/text`]) {
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const r = await call(method, path, {});
        expect(r.status, `${method} ${path}`).toBe(405);
        expect(r.headers.allow).toBe("GET");
      }
    }
  });
});
