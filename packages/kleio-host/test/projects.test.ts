// Kleio's projects, for her voice: projects.ts, and the routes GET/POST
// /kleio/projects, POST /kleio/projects/code, the voice's project files
// (GET /kleio/voice/files?source=project, POST /kleio/voice/files/read) and a
// specialist's latest messages (GET /kleio/blobs/:id/messages).

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host, type HostOptions } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import {
  consentGated,
  createProject,
  isNewProjectName,
  isProjectDoc,
  isProjectName,
  parseNewProject,
  parseStartCode,
  projectDocAt,
  projectDocs,
  projectFolders,
  projectStatus,
  projectSummaries,
  usableRoot,
  worksIn,
  type ProjectFolder,
} from "../src/projects.js";
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

let home: string;

/** Write `rel` under `dir` with `content`, its mtime `ageS` seconds ago. */
function put(dir: string, rel: string, content = "x", ageS = 0): string {
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

const projectsDir = (): string => join(home, "projects");
const extraDir = (): string => join(home, "extra-root");
const kleioDir = (): string => join(home, "Kleio");

// ---------------------------------------------------------------- projects.ts

describe("projects.ts", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kleio-projects-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const scan = (): { home: string; platform: NodeJS.Platform } => ({
    home,
    platform: "linux",
  });

  it("checks names: any visible folder name to find one, the app's form to make one", () => {
    for (const ok of ["recipe-app", "My App (old)", "café", "a.b"])
      expect(isProjectName(ok)).toBe(true);
    for (const bad of ["", ".", "..", ".git", "a/b", "a\\b", "a\u0000b", "x".repeat(256), 3, null])
      expect(isProjectName(bad), String(bad)).toBe(false);
    for (const ok of ["recipe-app", "a", "v2", "x".repeat(64)])
      expect(isNewProjectName(ok)).toBe(true);
    for (const bad of [
      "Recipe",
      "recipe_app",
      "-a",
      "a-",
      "a--b",
      "a b",
      "x".repeat(65),
      "node_modules",
      "dist",
    ])
      expect(isNewProjectName(bad), bad).toBe(false);
  });

  it("parses the route bodies", () => {
    expect(parseNewProject('{"name":"recipe-app"}')).toEqual({ ok: true, value: "recipe-app" });
    expect(parseNewProject('{"name":"../x"}').ok).toBe(false);
    expect(parseNewProject("[]").ok).toBe(false);
    expect(parseNewProject("nope").ok).toBe(false);
    expect(parseStartCode('{"name":"My App","prompt":"  Add dark mode. "}')).toEqual({
      ok: true,
      value: { name: "My App", prompt: "Add dark mode." },
    });
    expect(parseStartCode('{"name":"..","prompt":"x"}').ok).toBe(false);
    expect(parseStartCode('{"name":"a","prompt":"  "}').ok).toBe(false);
    expect(parseStartCode(`{"name":"a","prompt":"${"x".repeat(4001)}"}`).ok).toBe(false);
  });

  it("never uses the home folder, a filesystem root or a consent-gated folder", () => {
    expect(usableRoot(join(home, "projects"), home, "linux")).toBe(true);
    expect(usableRoot(home, home, "linux")).toBe(false);
    expect(usableRoot("/", home, "linux")).toBe(false);
    expect(usableRoot("relative/projects", home, "linux")).toBe(false);
    expect(usableRoot(join(home, "Documents", "code"), home, "darwin")).toBe(false);
    expect(usableRoot(join(home, "Documents", "code"), home, "linux")).toBe(true);
    expect(consentGated(join(home, "Desktop"), home, "darwin")).toBe(true);
    expect(consentGated(join(home, "Desktops"), home, "darwin")).toBe(false);
  });

  it("lists plain folders only, once per name, never Kleio's own", async () => {
    mkdirSync(join(projectsDir(), "beta"), { recursive: true });
    mkdirSync(join(projectsDir(), "Alpha"), { recursive: true });
    mkdirSync(join(projectsDir(), ".hidden"), { recursive: true });
    mkdirSync(join(projectsDir(), "node_modules"), { recursive: true });
    put(projectsDir(), "notes.txt");
    mkdirSync(join(home, "elsewhere"), { recursive: true });
    link(join(home, "elsewhere"), join(projectsDir(), "linked"));
    mkdirSync(join(projectsDir(), "Kleio"), { recursive: true });
    mkdirSync(join(extraDir(), "alpha"), { recursive: true });
    mkdirSync(join(extraDir(), "gamma"), { recursive: true });
    // As the host compares it: by real path (native, as fs.promises.realpath
    // resolves Windows' short temp names).
    const kleio = realpathSync.native(join(projectsDir(), "Kleio"));
    const found = await projectFolders([projectsDir(), extraDir(), projectsDir(), home], {
      ...scan(),
      skip: (real) => real === kleio,
    });
    expect(found.map((p) => p.name)).toEqual(["Alpha", "beta", "gamma"]);
    expect(found[2]?.dir).toBe(join(extraDir(), "gamma"));
  });

  it("makes a new project once, in the first projects folder", async () => {
    const roots = [projectsDir(), extraDir()];
    const made = await createProject(roots, "recipe-app", scan());
    expect(made).toMatchObject({ ok: true, value: { name: "recipe-app" } });
    expect(existsSync(join(projectsDir(), "recipe-app"))).toBe(true);
    expect(await createProject(roots, "recipe-app", scan())).toEqual({
      ok: false,
      error: "exists",
    });
    mkdirSync(join(extraDir(), "taken"), { recursive: true });
    expect(await createProject(roots, "taken", scan())).toEqual({ ok: false, error: "exists" });
    expect(await createProject([home], "x", scan())).toEqual({ ok: false, error: "no_folder" });
    expect(await createProject([], "x", scan())).toEqual({ ok: false, error: "no_folder" });
  });

  it("finds a project's documents and plans, never its code, secrets or build output", async () => {
    const dir = join(projectsDir(), "app");
    put(dir, "README.md", "# App", 30);
    put(dir, "docs/design.md", "design", 20);
    put(dir, ".gg/plans/dark-mode.md", "## Plan", 10);
    put(dir, ".gg/settings.json", "{}");
    put(dir, ".env", "TOKEN=1");
    put(dir, "src/index.ts", "code");
    put(dir, "dist/notes.md", "built");
    put(dir, "node_modules/pkg/README.md", "dep");
    put(dir, "data.csv", "a,b");
    const docs = await projectDocs(dir);
    expect(docs.map((f) => f.path).sort()).toEqual([
      ".gg/plans/dark-mode.md",
      "README.md",
      "docs/design.md",
    ]);
    expect(isProjectDoc("src/index.ts")).toBe(false);
    expect(isProjectDoc("build/x/report.md")).toBe(false);
    for (const path of ["../x.md", "a/../x.md", "./x.md", "a//x.md", ".x/a.md", "/x.md"])
      expect(isProjectDoc(path), path).toBe(false);
    expect(await projectDocAt(dir, ".gg/plans/dark-mode.md")).toEqual({
      root: join(realpathSync.native(dir), ".gg", "plans"),
      path: "dark-mode.md",
    });
    expect(await projectDocAt(dir, ".gg/plans/../settings.json")).toBeNull();
    expect(await projectDocAt(dir, "README.md")).toEqual({ root: dir, path: "README.md" });
    expect(await projectDocAt(dir, ".env")).toBeNull();
    expect(await projectDocAt(dir, ".gg/settings.json")).toBeNull();
  });

  it("does not follow a symlinked plans folder", async () => {
    if (process.platform === "win32") return;
    const dir = join(projectsDir(), "app");
    put(home, "secret/plan.md", "outside");
    mkdirSync(join(dir, ".gg"), { recursive: true });
    link(join(home, "secret"), join(dir, ".gg", "plans"));
    expect((await projectDocs(dir)).map((f) => f.path)).toEqual([]);
    expect(await projectDocAt(dir, ".gg/plans/plan.md")).toBeNull();
  });

  it("tells a project's status from its sessions and what's running", () => {
    const p: ProjectFolder = {
      name: "app",
      dir: "/p/app",
      real: "/real/p/app",
      mtimeMs: Date.parse("2026-10-01T00:00:00Z"),
    };
    const other: ProjectFolder = { name: "web", dir: "/p/web", real: "/p/web", mtimeMs: 0 };
    const rows = [
      { id: "s1", title: "Old", cwd: "/p/app", lastActivity: "2026-10-02T00:00:00Z" },
      { id: "s2", title: "New", cwd: "/real/p/app/pkg", lastActivity: "2026-10-05T00:00:00Z" },
      { id: "s3", title: "Elsewhere", cwd: "/p/apple", lastActivity: "2026-10-06T00:00:00Z" },
    ];
    const jobs = [
      { cwd: "/p/app", phase: "working" as const, line: "Running tests" },
      { cwd: "/p/app", phase: "needsYou" as const, line: "Which colour?" },
    ];
    expect(projectStatus(p, rows, jobs)).toEqual({
      name: "app",
      lastActivity: "2026-10-05T00:00:00.000Z",
      sessions: 2,
      now: { state: "needs_you", doing: "Which colour?" },
      recent: [
        { title: "New", lastActivity: "2026-10-05T00:00:00Z" },
        { title: "Old", lastActivity: "2026-10-02T00:00:00Z" },
      ],
    });
    expect(projectSummaries([other, p], rows, []).map((s) => [s.name, s.sessions])).toEqual([
      ["app", 2],
      ["web", 0],
    ]);
  });

  // Regression: the project's folders were compared as given while the
  // session's was resolved, so on Windows no session matched its project.
  it("compares a project's folders resolved, as the session's is", () => {
    const p: ProjectFolder = { name: "app", dir: "/p/x/../app", real: "/p/app/", mtimeMs: 0 };
    expect(worksIn("/p/app", p)).toBe(true);
    expect(worksIn("/p/app/src", p)).toBe(true);
    expect(worksIn("/p/apple", p)).toBe(false);
    expect(worksIn("/p", p)).toBe(false);
  });
});

// ---------------------------------------------------------------- routes

let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let host: Host;
let hostPort: number;
let H: Record<string, string>;
const logs: string[] = [];

async function startHost(withWorkspace = true): Promise<Host> {
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
    workspaceRoots: () => Promise.resolve([projectsDir(), extraDir()]),
    log: (m) => logs.push(m),
  };
  const { workspaceRoots: _unused, ...noWorkspace } = options;
  const h = createHost(withWorkspace ? options : noWorkspace);
  await h.start();
  hostPort = (h.server.address() as { port: number }).port;
  return h;
}

interface Res {
  status: number;
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
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // not JSON: keep the raw text
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

describe("project routes", () => {
  beforeEach(async () => {
    logs.length = 0;
    home = mkdtempSync(join(tmpdir(), "kleio-projects-route-"));
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

  it("lists projects with their sessions, most recently worked on first", async () => {
    mkdirSync(join(projectsDir(), "app"), { recursive: true });
    mkdirSync(join(projectsDir(), "web"), { recursive: true });
    mkdirSync(kleioDir(), { recursive: true });
    sidecar.stored.code = [
      {
        id: "s1",
        title: "Dark mode",
        cwd: join(projectsDir(), "app"),
        lastActivity: "2030-01-02T00:00:00.000Z",
      },
      {
        id: "s2",
        title: "Login",
        cwd: join(projectsDir(), "app"),
        lastActivity: "2030-01-01T00:00:00.000Z",
      },
    ];
    const r = await call("GET", "/kleio/projects");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      projects: [
        { name: "app", sessions: 2, lastActivity: "2030-01-02T00:00:00.000Z" },
        { name: "web", sessions: 0 },
      ],
    });
    // No folders and no session ids reach a device.
    expect(JSON.stringify(r.body)).not.toContain(home);
    expect(JSON.stringify(r.body)).not.toContain("s1");
    expect(sidecar.storedCalls.at(-1)).toMatch(/^\/stored-sessions\?kind=code&limit=\d+$/);
  });

  it("tells one project's status: its newest session's latest messages and its documents", async () => {
    const dir = join(projectsDir(), "app");
    put(dir, "README.md", "# App");
    put(dir, ".gg/plans/dark-mode.md", "## Plan");
    put(dir, ".env", "TOKEN=1");
    sidecar.stored.code = [
      { id: "s1", title: "Dark mode", cwd: dir, lastActivity: "2030-01-02T00:00:00.000Z" },
      { id: "s2", title: "Login", cwd: dir, lastActivity: "2030-01-01T00:00:00.000Z" },
    ];
    sidecar.stored.reads["s1"] = {
      session: { id: "s1", title: "Dark mode", cwd: dir, lastActivity: "2030-01-02T00:00:00.000Z" },
      messages: [
        { role: "user", text: "Add dark mode." },
        { role: "assistant", text: "Done: dark mode follows the system setting." },
      ],
    };
    const r = await call("GET", "/kleio/projects?name=APP");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      name: "app",
      sessions: 2,
      recent: [{ title: "Dark mode" }, { title: "Login" }],
      latest: {
        title: "Dark mode",
        messages: [
          { from: "user", text: "Add dark mode." },
          { from: "assistant", text: "Done: dark mode follows the system setting." },
        ],
      },
    });
    const docs = (r.body as { docs: { path: string }[] }).docs.map((d) => d.path).sort();
    expect(docs).toEqual([".gg/plans/dark-mode.md", "README.md"]);
    expect(sidecar.storedCalls).toContain("/stored-sessions/s1?kind=code");
    expect((await call("GET", "/kleio/projects?name=nope")).status).toBe(404);
    expect((await call("GET", "/kleio/projects?name=..")).status).toBe(400);
  });

  it("makes a new project, once, by name", async () => {
    const r = await call("POST", "/kleio/projects", { name: "recipe-app" });
    expect(r).toEqual({ status: 200, body: { name: "recipe-app" } });
    expect(existsSync(join(projectsDir(), "recipe-app"))).toBe(true);
    expect((await call("POST", "/kleio/projects", { name: "recipe-app" })).status).toBe(409);
    for (const name of ["../escape", "Recipe", ".git", "", 3]) {
      expect((await call("POST", "/kleio/projects", { name })).status, String(name)).toBe(400);
    }
    expect(existsSync(join(home, "escape"))).toBe(false);
    expect((await call("DELETE", "/kleio/projects")).status).toBe(405);
  });

  it("starts coding work in a project: a Code session there, named for it, nudged when done", async () => {
    const dir = join(projectsDir(), "app");
    mkdirSync(dir, { recursive: true });
    const r = await call("POST", "/kleio/projects/code", { name: "app", prompt: "Add dark mode." });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ project: "app", sessionId: "created-1" });
    expect(sidecar.creates.at(-1)).toEqual({ mode: "code", cwd: dir });
    expect(sidecar.prompts.at(-1)).toEqual({
      session: "created-1",
      body: { text: "Add dark mode.\n\n(Started by voice from Kleio.)" },
    });
    expect((await call("POST", "/kleio/projects/code", { name: "nope", prompt: "x" })).status).toBe(
      404,
    );
    expect((await call("POST", "/kleio/projects/code", { name: "app", prompt: " " })).status).toBe(
      400,
    );
    expect(
      (await call("POST", "/kleio/projects/code", { name: "../..", prompt: "x" })).status,
    ).toBe(400);
    expect((await call("GET", "/kleio/projects/code")).status).toBe(405);
    // Nothing was created for the refused requests.
    expect(sidecar.creates).toHaveLength(1);
  });

  it("tells what a coding agent is doing in a project right now, and when it stops", async () => {
    mkdirSync(join(projectsDir(), "app"), { recursive: true });
    const r = await call("POST", "/kleio/projects/code", { name: "app", prompt: "Add search." });
    expect(r.status).toBe(200);
    const sid = (r.body as { sessionId: string }).sessionId;
    const frame = (type: string, data: Record<string, unknown>): string =>
      `data: ${JSON.stringify({ type, data })}`;
    sidecar.emit(sid, frame("run_start", {}));
    sidecar.emit(sid, frame("tool_call_start", { toolCallId: "t1", name: "bash", args: {} }));
    const now = async (): Promise<unknown> => {
      const listed = await call("GET", "/kleio/projects");
      return (listed.body as { projects: { name: string; now?: unknown }[] }).projects.find(
        (p) => p.name === "app",
      )?.now;
    };
    // Polled until it shows, with room for a slow CI runner.
    const until = async (done: (v: unknown) => boolean): Promise<unknown> => {
      const deadline = Date.now() + 5_000;
      let v = await now();
      while (!done(v) && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 20));
        v = await now();
      }
      return v;
    };
    expect(await until((v) => v !== undefined)).toMatchObject({
      state: "working",
      doing: expect.any(String),
    });
    sidecar.emit(sid, frame("run_end", {}));
    expect(await until((v) => v === undefined)).toBeUndefined();
  });

  it("never treats Kleio's own folder as a project", async () => {
    await host.stop();
    // Kleio's folder inside the projects folder.
    const inside = join(projectsDir(), "Kleio");
    mkdirSync(inside, { recursive: true });
    mkdirSync(join(projectsDir(), "app"), { recursive: true });
    const options = { homeCwd: inside };
    host = createHost({
      listenPort: 0,
      publicBaseUrl: "https://mini.test:8443",
      nodeId: "mini.test",
      registry,
      offers: createPairOfferStore(),
      rings: createRingStore({ directory: join(home, "rings"), maxFrames: 50 }),
      sidecarEndpointPath: join(home, "sidecar.json"),
      controlRootKey: "control-root-key-for-tests-0123456789",
      routinePollMs: 0,
      blobTickMs: 0,
      workspaceRoots: () => Promise.resolve([projectsDir()]),
      log: (m) => logs.push(m),
      ...options,
    });
    await host.start();
    hostPort = (host.server.address() as { port: number }).port;
    const r = await call("GET", "/kleio/projects");
    expect((r.body as { projects: { name: string }[] }).projects.map((p) => p.name)).toEqual([
      "app",
    ]);
    expect((await call("GET", "/kleio/projects?name=Kleio")).status).toBe(404);
    expect(
      (await call("POST", "/kleio/projects/code", { name: "Kleio", prompt: "x" })).status,
    ).toBe(404);
    expect((await call("GET", "/kleio/voice/files?source=project&id=Kleio")).status).toBe(404);
  });

  it("lists and reads a project's documents only", async () => {
    const dir = join(projectsDir(), "app");
    put(dir, "README.md", "# App");
    put(dir, ".gg/plans/dark-mode.md", "## The plan");
    put(dir, ".env", "TOKEN=1");
    put(dir, "src/index.ts", "secret code");
    const listed = await call("GET", "/kleio/voice/files?source=project&id=app");
    expect(listed.status).toBe(200);
    const paths = (listed.body as { files: { path: string }[] }).files.map((f) => f.path).sort();
    expect(paths).toEqual([".gg/plans/dark-mode.md", "README.md"]);
    const plan = await call("POST", "/kleio/voice/files/read", {
      source: "project",
      id: "app",
      path: ".gg/plans/dark-mode.md",
    });
    expect(plan.status).toBe(200);
    expect(plan.body).toMatchObject({ name: "dark-mode.md", text: "## The plan" });
    for (const path of [
      ".env",
      "src/index.ts",
      "../../secure/headless-master.key",
      ".gg/../.env",
    ]) {
      const no = await call("POST", "/kleio/voice/files/read", {
        source: "project",
        id: "app",
        path,
      });
      expect(no.status, path).toBe(404);
    }
    expect((await call("GET", "/kleio/voice/files?source=project&id=nope")).status).toBe(404);
    expect((await call("GET", "/kleio/voice/files?source=project")).status).toBe(400);
  });

  it("is 404 without projects folders and 503 when the sidecar is unreachable", async () => {
    mkdirSync(join(projectsDir(), "app"), { recursive: true });
    await sidecar.close();
    expect((await call("GET", "/kleio/projects")).status).toBe(503);
    await host.stop();
    host = await startHost(false);
    expect((await call("GET", "/kleio/projects")).status).toBe(404);
    expect((await call("POST", "/kleio/projects", { name: "x" })).status).toBe(404);
  });

  it("needs a paired device", async () => {
    expect((await call("GET", "/kleio/projects", undefined, {})).status).toBe(401);
    expect((await call("POST", "/kleio/projects", { name: "x" }, {})).status).toBe(401);
  });

  it("reads a specialist's latest messages from its saved conversation", async () => {
    const made = await call("POST", "/kleio/blobs", {
      name: "Chef",
      job: "I plan dinners.",
      autoSchedule: false,
    });
    expect(made.status).toBe(200);
    const id = (made.body as { blob: { id: string } }).blob.id;
    expect(await call("GET", `/kleio/blobs/${id}/messages`)).toEqual({
      status: 200,
      body: { messages: [] },
    });
    const cwd = join(kleioDir(), "blobs", id);
    sidecar.stored.chat = [
      {
        id: "c-other",
        title: "Other",
        cwd: join(kleioDir(), "blobs", "b_00000000"),
        lastActivity: "2030-01-03T00:00:00.000Z",
      },
      { id: "c-chef", title: "Dinners", cwd, lastActivity: "2030-01-02T00:00:00.000Z" },
    ];
    sidecar.stored.reads["c-chef"] = {
      session: { id: "c-chef", title: "Dinners", cwd, lastActivity: "2030-01-02T00:00:00.000Z" },
      messages: [
        { role: "user", text: "What's for dinner?" },
        { role: "assistant", text: "Risotto." },
      ],
    };
    const r = await call("GET", `/kleio/blobs/${id}/messages`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      messages: [
        { from: "user", text: "What's for dinner?" },
        { from: "assistant", text: "Risotto." },
      ],
      lastActivity: "2030-01-02T00:00:00.000Z",
    });
    expect((await call("GET", "/kleio/blobs/b_ffffffff/messages")).status).toBe(404);
    expect((await call("POST", `/kleio/blobs/${id}/messages`)).status).toBe(405);
  });
});
