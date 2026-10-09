import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

const KEY = "sk-setup-test-key-0123456789abcdef";
const KEY2 = "sk-setup-test-key-SECOND-9876543210";
const SECRETS = [KEY, KEY2];

/** How the fake providers answer the next key check. */
type Mode = "ok" | 401 | 403 | 500 | "throw";

interface Seen {
  url: string;
  method: string;
  key: string | undefined;
  body: string | undefined;
}

function fakeProvider(header: "x-api-key" | "authorization"): {
  fetch: typeof fetch;
  seen: Seen[];
  mode: { value: Mode };
  sessions: { n: number };
  /** While set, a session request waits for it. */
  gate: { value: Promise<void> | null };
} {
  const seen: Seen[] = [];
  const mode = { value: "ok" as Mode };
  const sessions = { n: 0 };
  const gate: { value: Promise<void> | null } = { value: null };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const raw = headers[header];
    const key = header === "authorization" ? raw?.replace(/^Bearer /, "") : raw;
    seen.push({
      url,
      method: init?.method ?? "GET",
      key,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (mode.value === "throw") throw new Error(`connect ECONNREFUSED (key ${key})`);
    if (typeof mode.value === "number")
      return new Response(JSON.stringify({ error: `nope, key was ${key}` }), {
        status: mode.value,
      });
    if (url.endsWith("/api/v3.1/tool_router/session")) {
      await gate.value;
      sessions.n += 1;
      return new Response(
        JSON.stringify({
          session_id: `trs_${sessions.n}`,
          mcp: { url: `https://mcp.test/trs_${sessions.n}/mcp` },
        }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ items: [], answers: {} }), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, seen, mode, sessions, gate };
}

// ---------------------------------------------------------------- fixture

let home: string;
let ggHome: string;
let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let host: Host | null = null;
let hostPort: number;
let A: Record<string, string>;
let P: Record<string, string>;
let composio: ReturnType<typeof fakeProvider>;
let typesafe: ReturnType<typeof fakeProvider>;
const logs: string[] = [];
const bodies: string[] = [];

async function startHost(extra: Partial<HostOptions> = {}): Promise<void> {
  await host?.stop();
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
    homeCwd: join(home, "Kleio"),
    blobTickMs: 0,
    composio: {
      baseUrl: "https://composio.test",
      ggHome,
      fetch: composio.fetch,
      ...(extra.composio ?? {}),
    },
    jev: { baseUrl: "https://typesafe.test", fetch: typesafe.fetch, ...(extra.jev ?? {}) },
    ...(extra.voice ? { voice: extra.voice } : {}),
    log: (m) => logs.push(m),
  });
  await host.start();
  hostPort = (host.server.address() as { port: number }).port;
}

beforeEach(async () => {
  logs.length = 0;
  bodies.length = 0;
  home = mkdtempSync(join(tmpdir(), "kleio-setup-"));
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
  const admin = await registry.mint("Admin Mac", { admin: true });
  const phone = await registry.mint("Phone");
  if (!admin.ok || !phone.ok) throw new Error("mint");
  A = { [DEVICE_TOKEN_HEADER]: admin.value.token };
  P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
  sidecar = await fakeSidecar();
  writeFileSync(
    join(home, "sidecar.json"),
    JSON.stringify({ port: sidecar.port, token: sidecar.token, pid: 1, startedAt: "x" }),
  );
  composio = fakeProvider("x-api-key");
  typesafe = fakeProvider("authorization");
  await startHost();
});
afterEach(async () => {
  await host?.stop();
  host = null;
  await sidecar.close();
  // The key never reaches a response body or a log line, in any test.
  for (const s of SECRETS) {
    for (const b of bodies) expect(b).not.toContain(s);
    for (const l of logs) expect(l).not.toContain(s);
  }
  rmSync(home, { recursive: true, force: true });
});

interface Res {
  status: number;
  body: any;
}
function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
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
        let s = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (s += c));
        res.on("end", () => {
          bodies.push(s);
          let parsed: unknown = s;
          try {
            parsed = JSON.parse(s);
          } catch {}
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const keyFile = (name: string): string => join(home, `${name}.key`);
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

// ---------------------------------------------------------------- tests

describe("GET /kleio/setup", () => {
  it("needs a device token", async () => {
    expect((await call("GET", "/kleio/setup")).status).toBe(401);
  });

  it("reports admin and each key's state, without any key", async () => {
    const phone = await call("GET", "/kleio/setup", P);
    expect(phone).toEqual({
      status: 200,
      body: { admin: false, keys: { openai: "missing", composio: "missing", typesafe: "missing" } },
    });
    writeFileSync(keyFile("composio"), `${KEY}\n`);
    writeFileSync(keyFile("typesafe"), "  \n");
    await startHost({ voice: { apiKey: KEY2 } });
    const admin = await call("GET", "/kleio/setup", A);
    expect(admin.body).toEqual({
      admin: true,
      keys: { openai: "env", composio: "saved", typesafe: "missing" },
    });
    await startHost({ jev: { apiKey: KEY2 }, composio: { apiKey: KEY2 } });
    expect((await call("GET", "/kleio/setup", P)).body.keys).toEqual({
      openai: "missing",
      composio: "env",
      typesafe: "env",
    });
  });
});

describe("POST/DELETE /kleio/setup/keys/:name", () => {
  it("is admin-only and knows only composio and typesafe", async () => {
    for (const name of ["composio", "typesafe"]) {
      expect((await call("POST", `/kleio/setup/keys/${name}`, P, { key: KEY })).body).toEqual({
        error: "forbidden",
      });
      expect((await call("DELETE", `/kleio/setup/keys/${name}`, P)).status).toBe(403);
    }
    expect(await call("POST", "/kleio/setup/keys/openai", A, { key: KEY })).toEqual({
      status: 404,
      body: { error: "not_found" },
    });
    expect((await call("DELETE", "/kleio/setup/keys/nope", A)).status).toBe(404);
    expect((await call("POST", "/kleio/setup/keys/composio", {}, { key: KEY })).status).toBe(401);
    expect(composio.seen).toHaveLength(0);
    expect(typesafe.seen).toHaveLength(0);
  });

  it("bounds and validates the body", async () => {
    const big = { key: "x".repeat(5000) };
    expect(await call("POST", "/kleio/setup/keys/typesafe", A, big)).toEqual({
      status: 413,
      body: { error: "too_large" },
    });
    expect(await call("POST", "/kleio/setup/keys/typesafe", A, "{not json")).toEqual({
      status: 400,
      body: { error: "bad_request" },
    });
    expect((await call("POST", "/kleio/setup/keys/composio", A, { key: 42 })).status).toBe(400);
    expect((await call("POST", "/kleio/setup/keys/composio", A, "null")).status).toBe(400);
    for (const bad of ["", "   ", "has space", "a".repeat(513)])
      expect(await call("POST", "/kleio/setup/keys/composio", A, { key: bad })).toEqual({
        status: 422,
        body: { error: "bad_key" },
      });
    expect(composio.seen).toHaveLength(0);
  });

  it("answers 409 when the env sets the key", async () => {
    await startHost({ composio: { apiKey: KEY2 }, jev: { apiKey: KEY2 } });
    for (const name of ["composio", "typesafe"]) {
      expect(await call("POST", `/kleio/setup/keys/${name}`, A, { key: KEY })).toEqual({
        status: 409,
        body: { error: "set_by_env" },
      });
      expect((await call("DELETE", `/kleio/setup/keys/${name}`, A)).body).toEqual({
        error: "set_by_env",
      });
    }
    // (The env key's own session set-up at start is the only Composio call.)
    expect(composio.seen.filter((s) => s.url.includes("/toolkits"))).toHaveLength(0);
    expect(typesafe.seen).toHaveLength(0);
    expect(existsSync(keyFile("composio"))).toBe(false);
  });

  for (const name of ["composio", "typesafe"] as const) {
    const provider = (): ReturnType<typeof fakeProvider> =>
      name === "composio" ? composio : typesafe;

    it(`${name}: a rejected key is never saved`, async () => {
      provider().mode.value = 401;
      expect(await call("POST", `/kleio/setup/keys/${name}`, A, { key: KEY })).toEqual({
        status: 422,
        body: { error: "bad_key" },
      });
      provider().mode.value = 403;
      expect((await call("POST", `/kleio/setup/keys/${name}`, A, { key: KEY })).status).toBe(422);
      provider().mode.value = 500;
      const rejected = await call("POST", `/kleio/setup/keys/${name}`, A, { key: KEY });
      expect(rejected.status).toBe(502);
      expect(rejected.body.error).toBe("rejected");
      expect(rejected.body.detail).toContain("[key]");
      expect(rejected.body.detail.length).toBeLessThanOrEqual(200);
      provider().mode.value = "throw";
      const down = await call("POST", `/kleio/setup/keys/${name}`, A, { key: KEY });
      expect(down.status).toBe(504);
      expect(down.body.error).toBe("unreachable");
      expect(existsSync(keyFile(name))).toBe(false);
    });

    it(`${name}: an accepted key is saved 0600, then removed`, async () => {
      const saved = await call("POST", `/kleio/setup/keys/${name}`, A, { key: `  ${KEY}\n` });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({
        admin: true,
        keys: { openai: "missing", composio: "missing", typesafe: "missing", [name]: "saved" },
      });
      expect(readFileSync(keyFile(name), "utf8")).toBe(`${KEY}\n`);
      if (process.platform !== "win32") expect(statSync(keyFile(name)).mode & 0o777).toBe(0o600);
      const check = provider().seen[0]!;
      expect(check.key).toBe(KEY);
      if (name === "composio") {
        expect(check).toMatchObject({
          method: "GET",
          url: "https://composio.test/api/v3.1/toolkits?limit=1",
        });
      } else {
        expect(check).toMatchObject({ method: "POST", url: "https://typesafe.test/v1/systemone" });
        expect(JSON.parse(check.body!)).toEqual({
          model: "jev-latest",
          state: "Kleio is checking this API key.",
          questions: { ok: { type: "noul", instructions: "Is this a test?" } },
        });
      }
      expect(logs.some((l) => l.includes("[setup] Admin Mac saved the"))).toBe(true);
      const gone = await call("DELETE", `/kleio/setup/keys/${name}`, A);
      expect(gone.status).toBe(200);
      expect(gone.body.keys[name]).toBe("missing");
      expect(existsSync(keyFile(name))).toBe(false);
    });
  }

  it("composio: without a home thread the key routes are 404; GET still reports", async () => {
    await host?.stop();
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
      composio: { fetch: composio.fetch, ggHome },
      log: (m) => logs.push(m),
    });
    await host.start();
    hostPort = (host.server.address() as { port: number }).port;
    writeFileSync(keyFile("composio"), KEY);
    expect((await call("POST", "/kleio/setup/keys/composio", A, { key: KEY })).status).toBe(404);
    expect((await call("DELETE", "/kleio/setup/keys/composio", A)).status).toBe(404);
    expect((await call("GET", "/kleio/setup", A)).body.keys.composio).toBe("saved");
  });

  it("composio: delete drops the session and only its mcp.json entry", async () => {
    mkdirSync(ggHome, { recursive: true });
    writeFileSync(
      join(ggHome, "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }),
    );
    expect((await call("POST", "/kleio/setup/keys/composio", A, { key: KEY })).status).toBe(200);
    await until(() => readFileSync(join(ggHome, "mcp.json"), "utf8").includes("composio"));
    const state = JSON.parse(readFileSync(join(home, "composio.json"), "utf8"));
    expect(state.sessionId).toBe("trs_1");

    expect((await call("DELETE", "/kleio/setup/keys/composio", A)).status).toBe(200);
    expect(JSON.parse(readFileSync(join(ggHome, "mcp.json"), "utf8"))).toEqual({
      mcpServers: { other: { command: "x" } },
    });
    expect(JSON.parse(readFileSync(join(home, "composio.json"), "utf8"))).toEqual({
      userId: state.userId,
    });
    expect(logs).toContain("[setup] Admin Mac removed the Composio key");
  });

  it("composio: a key removed while its session is being made leaves nothing behind", async () => {
    mkdirSync(ggHome, { recursive: true });
    const others = { mcpServers: { other: { command: "x" } } };
    writeFileSync(join(ggHome, "mcp.json"), JSON.stringify(others));
    let release = (): void => {};
    composio.gate.value = new Promise<void>((r) => {
      release = r;
    });
    expect((await call("POST", "/kleio/setup/keys/composio", A, { key: KEY })).status).toBe(200);
    // The background setup has asked Composio for a session and is waiting.
    await until(() => composio.seen.some((s) => s.url.endsWith("/tool_router/session")));
    expect((await call("DELETE", "/kleio/setup/keys/composio", A)).status).toBe(200);
    release();
    await until(() => composio.sessions.n === 1);
    // Whatever the stale setup would do next has had time to happen.
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.parse(readFileSync(join(ggHome, "mcp.json"), "utf8"))).toEqual(others);
    const state = JSON.parse(readFileSync(join(home, "composio.json"), "utf8"));
    expect(Object.keys(state)).toEqual(["userId"]);
    expect(existsSync(keyFile("composio"))).toBe(false);
  });

  it("composio: a new key gets a new session; the same key changes nothing", async () => {
    expect((await call("POST", "/kleio/setup/keys/composio", A, { key: KEY })).status).toBe(200);
    await until(() => composio.sessions.n === 1);
    await until(() => existsSync(join(ggHome, "mcp.json")));
    const mcp = (): any => JSON.parse(readFileSync(join(ggHome, "mcp.json"), "utf8"));
    expect(mcp().mcpServers.composio.headers["x-api-key"]).toBe(KEY);

    // Same key again: checked, but no new session and nothing rewritten.
    expect((await call("POST", "/kleio/setup/keys/composio", A, { key: KEY })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(composio.sessions.n).toBe(1);

    expect((await call("POST", "/kleio/setup/keys/composio", A, { key: KEY2 })).status).toBe(200);
    await until(() => composio.sessions.n === 2);
    await until(() => mcp().mcpServers.composio?.headers["x-api-key"] === KEY2);
    const sessionCalls = composio.seen.filter((s) => s.url.endsWith("/tool_router/session"));
    expect(sessionCalls.map((s) => s.key)).toEqual([KEY, KEY2]);
    const state = JSON.parse(readFileSync(join(home, "composio.json"), "utf8"));
    expect(state.sessionId).toBe("trs_2");
    expect(readFileSync(keyFile("composio"), "utf8")).toBe(`${KEY2}\n`);
  });
});
