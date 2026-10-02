import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

const KEY = "ak_TESTKEY_0123456789abcd";

// ---------------------------------------------------------------- fake Composio

interface FakeComposio {
  port: number;
  seen: { method: string; path: string; key: string | undefined; body: any }[];
  accounts: any[];
  failStatus: number | null;
  sessions: number;
  close(): Promise<void>;
}

async function fakeComposio(): Promise<FakeComposio> {
  const api: FakeComposio = {
    port: 0,
    seen: [],
    accounts: [],
    failStatus: null,
    sessions: 0,
    close: async () => {},
  };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const body = raw ? JSON.parse(raw) : undefined;
      api.seen.push({
        method: req.method ?? "",
        path: url.pathname + url.search,
        key: req.headers["x-api-key"] as string | undefined,
        body,
      });
      const send = (status: number, obj: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.headers["x-api-key"] !== KEY) return send(401, { error: "bad key" });
      if (api.failStatus) return send(api.failStatus, { error: `boom, key was ${KEY}` });
      if (req.method === "POST" && url.pathname === "/api/v3.1/tool_router/session") {
        api.sessions += 1;
        return send(201, {
          session_id: `trs_${api.sessions}`,
          mcp: { type: "http", url: `https://mcp.test/tool_router/v3/trs_${api.sessions}/mcp` },
        });
      }
      const link = url.pathname.match(/^\/api\/v3\.1\/tool_router\/session\/([^/]+)\/link$/);
      // Composio's real answers for an app that needs no sign-in, and for one
      // with no managed sign-in and no auth config of the user's own.
      if (req.method === "POST" && link && body.toolkit === "hackernews")
        return send(400, {
          error: {
            message: "Toolkit hackernews does not require authentication.",
            code: 4326,
            slug: "ToolRouterV2_ToolkitsIsNoAuth",
            status: 400,
          },
        });
      if (req.method === "POST" && link && body.toolkit === "twitter")
        return send(400, {
          error: {
            message: `Composio does not manage auth for toolkit twitter (key ${KEY}).`,
            code: 4308,
            slug: "ToolRouterV2_NoManagedAuth",
            status: 400,
          },
        });
      if (req.method === "POST" && link && body.toolkit === "broken")
        return send(500, { error: { message: "Something broke upstream.", code: 1, slug: "X" } });
      if (req.method === "POST" && link)
        return send(201, {
          link_token: "lt_1",
          redirect_url: `https://connect.composio.dev/link/lt_1?toolkit=${body.toolkit}`,
          connected_account_id: "ca_new",
        });
      if (req.method === "GET" && url.pathname === "/api/v3.1/connected_accounts")
        return send(200, { items: api.accounts, next_cursor: null });
      if (req.method === "POST" && url.pathname === "/api/v3.1/toolkits/multi")
        return send(200, {
          items: (body.toolkits as string[]).map((slug) => ({
            slug,
            name: slug === "gmail" ? "Gmail" : slug,
            meta: { logo: `https://logos.test/${slug}.png`, description: "", categories: [] },
          })),
        });
      if (req.method === "GET" && url.pathname === "/api/v3.1/toolkits")
        return send(200, {
          items: [
            {
              slug: "gmail",
              name: "Gmail",
              no_auth: false,
              auth_schemes: ["OAUTH2"],
              composio_managed_auth_schemes: ["OAUTH2"],
              meta: {
                logo: "https://logos.test/gmail.png",
                description: "Email",
                categories: [{ id: "c1", name: "Communication" }],
              },
            },
            { slug: "notion", name: "Notion", meta: { description: "Notes", categories: [] } },
            {
              slug: "hackernews",
              name: "Hacker News",
              no_auth: true,
              auth_schemes: ["NO_AUTH"],
              composio_managed_auth_schemes: [],
              meta: { description: "News", categories: [] },
            },
            {
              slug: "twitter",
              name: "Twitter",
              no_auth: false,
              auth_schemes: ["OAUTH2"],
              composio_managed_auth_schemes: [],
              meta: { description: "Posts", categories: [] },
            },
            {
              slug: "supadata",
              name: "Supadata",
              no_auth: false,
              auth_schemes: ["API_KEY"],
              composio_managed_auth_schemes: [],
              meta: { description: "Transcripts", categories: [] },
            },
          ].filter(
            (t) =>
              !url.searchParams.get("search") || t.slug.includes(url.searchParams.get("search")!),
          ),
          next_cursor: null,
        });
      const del = url.pathname.match(/^\/api\/v3\.1\/connected_accounts\/([^/]+)$/);
      if (req.method === "DELETE" && del) {
        api.accounts = api.accounts.filter((a) => a.id !== del[1]);
        return send(200, { success: true });
      }
      send(404, { error: "no route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as { port: number }).port;
  api.close = () => new Promise((r) => server.close(() => r()));
  return api;
}

// ---------------------------------------------------------------- host fixture

let home: string;
let ggHome: string;
let sidecar: FakeSidecar;
let composio: FakeComposio;
let registry: DeviceRegistry;
let host: Host;
let hostPort: number;
let H: Record<string, string>;
const logs: string[] = [];

async function startHost(opts: { key?: boolean } = {}): Promise<Host> {
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
    composio: {
      baseUrl: `http://127.0.0.1:${composio.port}`,
      ggHome,
      keyPath: join(home, "composio.key"),
      ...(opts.key === false ? {} : {}),
    },
    log: (m) => logs.push(m),
  });
  await h.start();
  hostPort = (h.server.address() as { port: number }).port;
  return h;
}

beforeEach(async () => {
  logs.length = 0;
  home = mkdtempSync(join(tmpdir(), "kleio-apps-"));
  ggHome = join(home, "dot-gg");
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
  H = { [DEVICE_TOKEN_HEADER]: phone.value.token };
  sidecar = await fakeSidecar();
  writeFileSync(
    join(home, "sidecar.json"),
    JSON.stringify({ port: sidecar.port, token: sidecar.token, pid: 1, startedAt: "x" }),
  );
  composio = await fakeComposio();
});
afterEach(async () => {
  await host?.stop();
  await sidecar.close();
  await composio.close();
  rmSync(home, { recursive: true, force: true });
});

interface Res {
  status: number;
  body: any;
  raw: string;
  headers: Record<string, string | string[] | undefined>;
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
        let s = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (s += c));
        res.on("end", () => {
          let parsed: unknown = s;
          try {
            parsed = JSON.parse(s);
          } catch {
            // HTML or text
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, raw: s, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll until `check` holds, for work the host starts in the background. */
async function until(check: () => boolean, ms = 5000): Promise<void> {
  const t = Date.now();
  while (!check()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await settle(20);
  }
}
const withKey = (): void => writeFileSync(join(home, "composio.key"), `${KEY}\n`, { mode: 0o600 });
const mcpFile = (): any => JSON.parse(readFileSync(join(ggHome, "mcp.json"), "utf8"));

// ---------------------------------------------------------------- tests

describe("apps: not set up", () => {
  it("lists nothing and refuses the rest until a key exists", async () => {
    host = await startHost();
    expect((await call("GET", "/kleio/connections")).body).toEqual({
      configured: false,
      connections: [],
    });
    for (const [m, p, b] of [
      ["GET", "/kleio/connections/toolkits", undefined],
      ["POST", "/kleio/connections", { toolkit: "gmail" }],
      ["DELETE", "/kleio/connections/ca_1", undefined],
    ] as const) {
      const r = await call(m, p, b);
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ error: "apps not set up" });
    }
    expect((await call("GET", "/kleio/connections", undefined, {})).status).toBe(401);
    expect(composio.seen).toEqual([]);
  });
});

describe("apps: setup", () => {
  it("creates one Tool Router session and adds Composio to ~/.gg/mcp.json, keeping other servers", async () => {
    withKey();
    mkdirSync(ggHome, { recursive: true });
    writeFileSync(
      join(ggHome, "mcp.json"),
      JSON.stringify({ mcpServers: { mine: { command: "my-server" } }, extra: 1 }),
    );
    host = await startHost();
    // Setup runs in the background at start; a slow runner can take longer
    // than a fixed pause, so wait for the session call itself.
    const isCreate = (s: { path: string }): boolean => s.path === "/api/v3.1/tool_router/session";
    await until(() => composio.seen.some(isCreate));
    // ...and for the MCP entry, the last thing setup writes.
    await until(() => {
      try {
        return Boolean(mcpFile().mcpServers?.composio);
      } catch {
        return false;
      }
    });
    await settle();

    const creates = composio.seen.filter(isCreate);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body).toEqual({
      user_id: expect.stringMatching(/^kleio_[0-9a-f]{16}$/),
      manage_connections: {
        enable: true,
        callback_url: "https://mini.test:8443/kleio/connections/callback",
        enable_connection_removal: false,
      },
    });
    const f = mcpFile();
    expect(f.extra).toBe(1);
    expect(f.mcpServers.mine).toEqual({ command: "my-server" });
    expect(f.mcpServers.composio).toEqual({
      type: "http",
      url: "https://mcp.test/tool_router/v3/trs_1/mcp",
      headers: { "x-api-key": KEY },
    });
    // Unix permission bits; Windows has none to check (as in device-registry.test.ts).
    if (process.platform !== "win32")
      expect(statSync(join(ggHome, "mcp.json")).mode & 0o777).toBe(0o600);
    const state = JSON.parse(readFileSync(join(home, "composio.json"), "utf8"));
    expect(state).toMatchObject({ sessionId: "trs_1", userId: creates[0]!.body.user_id });

    // A restart reuses the same user and session and leaves mcp.json alone.
    await host.stop();
    const before = readFileSync(join(ggHome, "mcp.json"), "utf8");
    host = await startHost();
    await settle();
    expect(composio.sessions).toBe(1);
    expect(readFileSync(join(ggHome, "mcp.json"), "utf8")).toBe(before);
  });

  it("retires idle conversations when the tools change, so they reload them", async () => {
    host = await startHost();
    const h = await call("GET", "/kleio/home");
    expect(h.status).toBe(200);
    withKey();
    // The first apps request sets Composio up (the key just appeared).
    expect((await call("GET", "/kleio/connections")).status).toBe(200);
    await settle();
    expect(sidecar.disposed).toContain(h.body.sessionId);
    const again = await call("GET", "/kleio/home");
    expect(again.body.sessionId).not.toBe(h.body.sessionId);
  });

  it("never overwrites an unreadable mcp.json", async () => {
    withKey();
    mkdirSync(ggHome, { recursive: true });
    writeFileSync(join(ggHome, "mcp.json"), "{ not json");
    host = await startHost();
    await settle();
    expect(readFileSync(join(ggHome, "mcp.json"), "utf8")).toBe("{ not json");
  });
});

describe("apps: routes", () => {
  beforeEach(async () => {
    withKey();
    host = await startHost();
    await settle();
  });

  it("lists connections with names and logos", async () => {
    composio.accounts = [
      {
        id: "ca_1",
        toolkit: { slug: "gmail" },
        status: "ACTIVE",
        created_at: "2026-09-30T10:00:00Z",
      },
      { id: "ca_2", toolkit: { slug: "notion" }, status: "EXPIRED" },
    ];
    const r = await call("GET", "/kleio/connections");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      configured: true,
      connections: [
        {
          id: "ca_1",
          toolkit: "gmail",
          name: "Gmail",
          logo: "https://logos.test/gmail.png",
          status: "ACTIVE",
          createdAt: "2026-09-30T10:00:00Z",
        },
        {
          id: "ca_2",
          toolkit: "notion",
          name: "notion",
          logo: "https://logos.test/notion.png",
          status: "EXPIRED",
          createdAt: null,
        },
      ],
    });
    const listCall = composio.seen.find((s) => s.path.startsWith("/api/v3.1/connected_accounts?"))!;
    expect(listCall.path).toContain("user_ids=kleio_");
  });

  it("searches the catalogue", async () => {
    const all = await call("GET", "/kleio/connections/toolkits");
    expect(all.body.toolkits.map((t: any) => t.slug)).toEqual([
      "gmail",
      "notion",
      "hackernews",
      "twitter",
      "supadata",
    ]);
    expect(all.body.toolkits[0]).toEqual({
      slug: "gmail",
      name: "Gmail",
      logo: "https://logos.test/gmail.png",
      description: "Email",
      categories: ["Communication"],
      auth: "signin",
    });
    const some = await call("GET", "/kleio/connections/toolkits?search=not");
    expect(some.body).toMatchObject({ toolkits: [{ slug: "notion" }], nextCursor: null });
  });

  it("says how each app connects: no sign-in, a sign-in, or the user's own keys first", async () => {
    const all = await call("GET", "/kleio/connections/toolkits");
    const auth = Object.fromEntries(all.body.toolkits.map((t: any) => [t.slug, t.auth]));
    expect(auth).toEqual({
      gmail: "signin",
      // Composio said nothing about it: try the sign-in, as before.
      notion: "signin",
      hackernews: "none",
      twitter: "setup",
      // An API key is typed in while connecting; no developer app needed.
      supadata: "signin",
    });
  });

  it("explains an app that needs no sign-in, or the user's own keys, instead of Composio's JSON", async () => {
    const hn = await call("POST", "/kleio/connections", { toolkit: "hackernews" });
    expect(hn.status).toBe(409);
    expect(hn.body).toEqual({
      error: "This app doesn't need a sign-in. Kleio and your specialists can already use it.",
      code: "no_auth",
    });
    const x = await call("POST", "/kleio/connections", { toolkit: "twitter" });
    expect(x.status).toBe(409);
    expect(x.body.code).toBe("needs_setup");
    expect(x.body.error).toMatch(/own developer keys/);
    expect(x.raw).not.toContain(KEY);
    expect(
      logs.some((l) => l.includes("connect twitter: needs the user's own developer app")),
    ).toBe(true);
  });

  it("passes on Composio's message, not its raw JSON, for any other failure", async () => {
    const r = await call("POST", "/kleio/connections", { toolkit: "broken" });
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: "composio", status: 500, detail: "Something broke upstream." });
  });

  it("starts a connection with the callback, and disconnects", async () => {
    const r = await call("POST", "/kleio/connections", { toolkit: "Gmail" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      redirectUrl: "https://connect.composio.dev/link/lt_1?toolkit=gmail",
      connectionId: "ca_new",
    });
    const link = composio.seen.find((s) => s.path.endsWith("/link"))!;
    expect(link.path).toBe("/api/v3.1/tool_router/session/trs_1/link");
    expect(link.body).toEqual({
      toolkit: "gmail",
      callback_url: "https://mini.test:8443/kleio/connections/callback",
    });
    expect((await call("POST", "/kleio/connections", { toolkit: "../x" })).status).toBe(400);

    composio.accounts = [{ id: "ca_1", toolkit: { slug: "gmail" }, status: "ACTIVE" }];
    expect((await call("DELETE", "/kleio/connections/ca_1")).body).toEqual({ ok: true });
    expect(composio.accounts).toEqual([]);
    expect((await call("DELETE", "/kleio/connections/bad%20id")).status).toBe(400);
  });

  it("a Composio failure is a 502 that never contains the key", async () => {
    composio.failStatus = 500;
    const r = await call("GET", "/kleio/connections");
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: "composio", status: 500 });
    expect(r.raw).not.toContain(KEY);
    expect(r.body.detail).toContain("[key]");
  });

  it("the key is in no response and no log line", async () => {
    composio.accounts = [{ id: "ca_1", toolkit: { slug: "gmail" }, status: "ACTIVE" }];
    const bodies = [
      await call("GET", "/kleio/connections"),
      await call("GET", "/kleio/connections/toolkits"),
      await call("POST", "/kleio/connections", { toolkit: "gmail" }),
      await call("DELETE", "/kleio/connections/ca_1"),
      await call("GET", "/kleio/connections/callback?status=success", undefined, {}),
    ];
    for (const r of bodies) expect(r.raw).not.toContain(KEY);
    for (const line of logs) expect(line).not.toContain(KEY);
  });
});

describe("apps: OAuth callback page", () => {
  beforeEach(async () => {
    host = await startHost();
  });

  it("needs no token and bounces to the app with a whitelisted status", async () => {
    const ok = await call("GET", "/kleio/connections/callback?status=success", undefined, {});
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/html");
    expect(ok.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(ok.raw).toContain('url=kleio://connections?status=success"');
    expect(ok.raw).toContain("Connected");
    expect(ok.raw).not.toContain("<script");

    const evil = await call(
      "GET",
      `/kleio/connections/callback?status=${encodeURIComponent('"><script>alert(1)</script>')}`,
      undefined,
      {},
    );
    expect(evil.raw).toContain("status=unknown");
    expect(evil.raw).not.toContain("<script");
    expect(evil.raw).not.toContain("alert(1)");
  });
});
