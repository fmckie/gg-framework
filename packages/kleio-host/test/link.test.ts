import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect, createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import {
  buildTicket,
  checkPreamble,
  createLinkListener,
  DEFAULT_LINK_CONFIG,
  isDirectAddr,
  isRelayUrl,
  LINK_HOST,
  LINK_STATE_FRESH_MS,
  linkTicket,
  MAX_TICKET_BYTES,
  readLinkConfig,
  readLinkState,
  ticketName,
  type LinkListener,
  type TicketInput,
} from "../src/link.js";
import {
  formatDeviceCode,
  newRedemptionNonce,
  PAIR_MAX_ATTEMPTS,
  PAIR_RETRY_AFTER_MS,
  type PairingPayload,
} from "../src/pair-code.js";
import type { RelayPing } from "../src/link-relays.js";
import { createPairOfferStore, type PairOfferStoreDeps } from "../src/pair-offer.js";
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

/** SecretKey::from_bytes(&[7; 32])'s public half, as in the shared ticket vectors. */
const HOST_KEY = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const SECRET = "Sx3_".repeat(10) + "abc";
const N0_EU = "https://euc1-1.relay.n0.iroh.link./";
const OWN = "https://relay.example.com/";
const NODE_ID = "kleio-ea4a6c63e29c520a";
const PUBLIC_URL = "https://mini.test.ts.net:8443";

const preamble = (key: string, secret = SECRET): string => `KLEIO-LINK/1 ${key} ${secret}\r\n`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface TicketVector {
  readonly about: string;
  readonly build: TicketInput;
  readonly ticket: string;
}
const vectors = (
  JSON.parse(
    readFileSync(new URL("../../kleio-link/tests/fixtures/tickets.json", import.meta.url), "utf8"),
  ) as { good: TicketVector[] }
).good;

let scratch: string;
const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "kleio-host-link-"));
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Writes `parts` on a new connection, `gapMs` apart, then reads until the
 * other end closes or `waitMs` passes.
 */
function exchange(
  port: number,
  parts: readonly (string | Buffer)[],
  options: { gapMs?: number; waitMs?: number; end?: boolean } = {},
): Promise<{ text: string; closed: boolean }> {
  const { gapMs = 0, waitMs = 3000, end = false } = options;
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let text = "";
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ text, closed });
    };
    const timer = setTimeout(() => finish(false), waitMs);
    socket.on("data", (d: Buffer) => (text += d.toString("latin1")));
    socket.on("close", () => finish(true));
    socket.on("error", () => {});
    socket.on("connect", () => {
      void (async () => {
        for (const part of parts) {
          if (socket.destroyed) return;
          socket.write(part);
          if (gapMs > 0) await sleep(gapMs);
        }
        if (end && !socket.destroyed) socket.end();
      })();
    });
  });
}

/** One HTTP request over the link listener, opened with `key`'s first line. */
function linkRequest(
  port: number,
  key: string,
  options: {
    method?: string;
    path: string;
    token?: string;
    body?: string | Buffer;
    secret?: string;
    host?: string;
  },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: {
          host: options.host ?? LINK_HOST,
          ...(options.token ? { [DEVICE_TOKEN_HEADER]: options.token } : {}),
        },
        // No `agent`: with one (even `agent: false`), Node ignores createConnection.
        createConnection: () => {
          const socket = connect(port, "127.0.0.1");
          socket.write(preamble(key, options.secret));
          return socket;
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** A request to the host's own (Tailscale) listener. */
function apiRequest(
  port: number,
  options: { method?: string; path: string; token?: string; body?: string; host?: string },
): Promise<{ status: number; body: string; allow: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: {
          ...(options.host ? { host: options.host } : {}),
          ...(options.token ? { [DEVICE_TOKEN_HEADER]: options.token } : {}),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => {
          const allow = res.headers.allow;
          resolve({ status: res.statusCode ?? 0, body, allow });
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/**
 * One request written by hand, for what Node's client won't send (a request
 * with no Host header), opened with `key`'s first line when it's for the link.
 */
function rawRequest(
  port: number,
  request: string,
  key?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("data", (c: string) => (answer += c));
    socket.on("end", () => {
      const status = Number(/^HTTP\/1\.[01] (\d{3}) /.exec(answer)?.[1] ?? 0);
      const blank = answer.indexOf("\r\n\r\n");
      resolve({ status, body: blank === -1 ? "" : answer.slice(blank + 4) });
    });
    socket.on("error", reject);
    socket.write((key === undefined ? "" : preamble(key)) + request);
  });
}

function writeState(dir: string, over: Record<string, unknown> = {}): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      pid: 4242,
      key: HOST_KEY,
      relay: N0_EU,
      addrs: ["192.168.1.20:52043"],
      rateLimited: false,
      connections: 1,
      relays: [{ url: N0_EU, state: "home" }],
      ...over,
    }),
  );
}

function writeConfig(dir: string, doc: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(doc));
}

describe("the link listener's first line", () => {
  it("names the device's key when the secret is right", () => {
    expect(checkPreamble(Buffer.from(preamble(KEY_A)), SECRET)).toEqual({ ok: true, value: KEY_A });
  });

  it("is garbled unless it's the protocol, a lowercase hex key, a token and CRLF, exactly", () => {
    const bad = [
      "",
      `KLEIO-LINK/2 ${KEY_A} ${SECRET}\r\n`,
      `kleio-link/1 ${KEY_A} ${SECRET}\r\n`,
      `KLEIO-LINK/1 ${KEY_A.toUpperCase()} ${SECRET}\r\n`,
      `KLEIO-LINK/1 ${KEY_A.slice(1)} ${SECRET}\r\n`,
      `KLEIO-LINK/1 ${KEY_A}  ${SECRET}\r\n`,
      `KLEIO-LINK/1 ${KEY_A} ${SECRET}\n`,
      `KLEIO-LINK/1 ${KEY_A} ${SECRET} more\r\n`,
      `KLEIO-LINK/1 ${KEY_A} ${SECRET}é\r\n`,
      `KLEIO-LINK/1 ${KEY_A} short\r\n`,
    ];
    for (const line of bad) {
      expect(checkPreamble(Buffer.from(line), SECRET), JSON.stringify(line)).toEqual({
        ok: false,
        error: "garbled",
      });
    }
  });

  it("tells a wrong secret apart from a garbled line, whatever its length", () => {
    for (const secret of [`t${SECRET.slice(1)}`, SECRET.slice(1), `${SECRET}x`, "s".repeat(16)]) {
      expect(checkPreamble(Buffer.from(preamble(KEY_A, secret)), SECRET)).toEqual({
        ok: false,
        error: "wrong_secret",
      });
    }
  });
});

describe("the link listener", () => {
  /** The listener in front of a server that answers with what it saw. */
  async function bare(timeoutMs = 300): Promise<{
    listener: LinkListener;
    port: number;
    logs: string[];
    seen: string[];
  }> {
    const logs: string[] = [];
    const seen: string[] = [];
    const holder: { listener?: LinkListener } = {};
    const http: Server = createServer((req, res) => {
      let bytes = 0;
      req.on("data", (c: Buffer) => (bytes += c.length));
      req.on("end", () => {
        const line = `${req.method} ${req.url} ${bytes} ${holder.listener?.keyOf(req.socket) ?? "none"}`;
        seen.push(line);
        res.end(line);
      });
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    const listener = createLinkListener({
      http,
      upstreamToken: SECRET,
      log: (m) => logs.push(m),
      preambleTimeoutMs: timeoutMs,
    });
    holder.listener = listener;
    const port = await listener.listen(0);
    cleanups.push(async () => {
      http.closeAllConnections();
      await Promise.all([listener.close(), new Promise((r) => http.close(r))]);
    });
    return { listener, port, logs, seen };
  }

  const get = (path: string, close = true): string =>
    `GET ${path} HTTP/1.1\r\nhost: link.kleio.invalid\r\n${close ? "connection: close\r\n" : ""}\r\n`;

  it("takes the first line and a request in one write, and gives the request the device's key", async () => {
    const { port, seen } = await bare();
    const { text, closed } = await exchange(port, [preamble(KEY_A) + get("/a")]);
    expect(text).toContain(`GET /a 0 ${KEY_A}`);
    expect(closed).toBe(true);
    expect(seen).toEqual([`GET /a 0 ${KEY_A}`]);
  });

  it("takes them split anywhere, the first line too", async () => {
    const { port, seen } = await bare();
    const whole = preamble(KEY_B) + get("/split");
    const parts = [whole.slice(0, 5), whole.slice(5, 70), whole.slice(70, 130), whole.slice(130)];
    const { text } = await exchange(port, parts, { gapMs: 30 });
    expect(text).toContain(`GET /split 0 ${KEY_B}`);
    expect(seen).toEqual([`GET /split 0 ${KEY_B}`]);
  });

  it("keeps the key for each request a kept-alive connection carries", async () => {
    const { port, seen } = await bare();
    const { text } = await exchange(port, [preamble(KEY_A) + get("/one", false), get("/two")], {
      gapMs: 50,
    });
    expect(text).toContain(`GET /one 0 ${KEY_A}`);
    expect(text).toContain(`GET /two 0 ${KEY_A}`);
    expect(seen).toEqual([`GET /one 0 ${KEY_A}`, `GET /two 0 ${KEY_A}`]);
  });

  it("carries a large body whole", async () => {
    const { port } = await bare();
    const body = Buffer.alloc(4_000_000, 0x61);
    const r = await linkRequest(port, KEY_A, { method: "POST", path: "/big", body });
    expect(r).toEqual({ status: 200, body: `POST /big 4000000 ${KEY_A}` });
  });

  const refusals: [string, string[], string, { end?: boolean }?][] = [
    ["a request with no first line", [get("/")], "wasn't a link preamble"],
    ["the wrong secret", [preamble(KEY_A, "w".repeat(43)) + get("/")], "had the wrong secret"],
    ["a line with no end", ["K".repeat(300)], "longer than 256 bytes"],
    [
      "a line that ends too late",
      [`KLEIO-LINK/1 ${"a".repeat(300)} ${SECRET}\r\n${get("/")}`],
      "longer than 256 bytes",
    ],
    ["a line cut short by the client", ["KLEIO-LINK/1 "], "closed before", { end: true }],
  ];
  for (const [what, parts, why, options] of refusals) {
    it(`closes the connection, with nothing read or said, on ${what}`, async () => {
      const { port, logs, seen } = await bare();
      const { text, closed } = await exchange(port, parts, options);
      expect(closed).toBe(true);
      expect(text).toBe("");
      expect(seen).toEqual([]);
      await sleep(20);
      expect(logs.some((l) => l.includes(why))).toBe(true);
      expect(logs.join("\n")).not.toContain(SECRET);
      expect(logs.join("\n")).not.toContain("w".repeat(43));
    });
  }

  it("closes a connection whose first line isn't done in time", async () => {
    const { port, logs, seen } = await bare(200);
    const since = Date.now();
    const { text, closed } = await exchange(port, ["KLEIO-LINK/1 "], { waitMs: 3000 });
    expect(closed).toBe(true);
    expect(Date.now() - since).toBeLessThan(2000);
    expect(text).toBe("");
    expect(seen).toEqual([]);
    expect(logs.some((l) => l.includes("wasn't done within 200 ms"))).toBe(true);
  });

  it("stops listening on close, and drops the connections still on their first line", async () => {
    const { listener, port } = await bare(10_000);
    const opening = exchange(port, ["KLEIO-LINK/1 "], { waitMs: 3000 });
    await sleep(100);
    await listener.close();
    expect((await opening).closed).toBe(true);
    await expect(
      new Promise((resolve, reject) => {
        const s = connect(port, "127.0.0.1");
        s.on("connect", () => {
          s.destroy();
          resolve("connected");
        });
        s.on("error", reject);
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("the link in the host", () => {
  async function linkHost(
    link: {
      port?: number;
      publicUrl?: boolean;
      pingRelay?: (relay: string) => Promise<RelayPing>;
      /** How a waiting phone's request is held; by default it isn't, and hears `pending` at once. */
      hold?: PairOfferStoreDeps["hold"];
    } = {},
  ): Promise<{
    host: Host;
    registry: DeviceRegistry;
    apiPort: number;
    linkPort: number;
    logs: string[];
    dir: string;
  }> {
    const keyPath = join(scratch, "secure", "headless-master.key");
    mkdirSync(join(scratch, "secure"), { recursive: true, mode: 0o700 });
    chmodSync(join(scratch, "secure"), 0o700);
    writeFileSync(keyPath, generateMasterKey(), { mode: 0o600 });
    const registry = createDeviceRegistry({
      keychain: createFileKeychain({ keyPath }),
      storePath: join(scratch, "secure", "device-registry.json"),
    });
    await registry.init();
    const sidecar: FakeSidecar = await fakeSidecar();
    cleanups.push(() => sidecar.close());
    writeFileSync(
      join(scratch, "sidecar.json"),
      JSON.stringify({ port: sidecar.port, token: sidecar.token, pid: 1, startedAt: "x" }),
    );
    const logs: string[] = [];
    const dir = join(scratch, "link");
    const host = createHost({
      listenPort: 0,
      ...(link.publicUrl ? { publicBaseUrl: PUBLIC_URL } : {}),
      nodeId: NODE_ID,
      registry,
      offers: createPairOfferStore({ hold: link.hold ?? (async () => {}) }),
      rings: createRingStore({ directory: join(scratch, "rings"), maxFrames: 50 }),
      sidecarEndpointPath: join(scratch, "sidecar.json"),
      controlRootKey: "control-root-key-for-tests-0123456789",
      routinePollMs: 0,
      log: (m) => logs.push(m),
      ...(link.pingRelay ? { pingRelay: link.pingRelay } : {}),
      link: {
        port: link.port ?? 0,
        upstreamToken: SECRET,
        publicKey: HOST_KEY,
        dir,
        name: "test-host",
        preambleTimeoutMs: 300,
      },
    });
    await host.start();
    cleanups.push(() => host.stop());
    const apiPort = (host.server.address() as AddressInfo).port;
    return { host, registry, apiPort, linkPort: host.link?.port() ?? 0, logs, dir };
  }

  async function mint(
    registry: DeviceRegistry,
    label: string,
    linkKey?: string,
    admin = false,
  ): Promise<{ token: string; deviceId: string }> {
    const minted = await registry.mint(label, {
      admin,
      ...(linkKey === undefined ? {} : { linkKey }),
    });
    if (!minted.ok) throw new Error(minted.error.message);
    return { token: minted.value.token, deviceId: minted.value.device.deviceId };
  }

  /** An admin's pair offer, on the host's own listener. */
  async function offer(
    apiPort: number,
    adminToken: string,
  ): Promise<{ code: string; display: string; ticket: string | null; ticketError: string | null }> {
    const r = await apiRequest(apiPort, {
      method: "POST",
      path: "/kleio/pair/offer",
      token: adminToken,
    });
    expect(r.status).toBe(200);
    return JSON.parse(r.body) as {
      code: string;
      display: string;
      ticket: string | null;
      ticketError: string | null;
    };
  }

  /** A redemption as the app sends it: it waits for an admin's Allow, unless `waits` is false. */
  const redeemBody = (
    code: string,
    label: string,
    options: { nonce?: string; waits?: boolean } = {},
  ): string =>
    JSON.stringify({
      code,
      redemptionNonce: options.nonce ?? newRedemptionNonce(),
      label,
      ...(options.waits === false ? {} : { waits: true }),
    });

  /** An admin's Allow or Deny, on the host's own listener. */
  const decide = (
    apiPort: number,
    adminToken: string,
    body: unknown,
  ): Promise<{ status: number; body: string }> =>
    apiRequest(apiPort, {
      method: "POST",
      path: "/kleio/pair/decide",
      token: adminToken,
      body: JSON.stringify(body),
    });

  /** The admin's view of the live code. */
  const pairState = async (apiPort: number, adminToken: string): Promise<string> =>
    (await apiRequest(apiPort, { path: "/kleio/pair", token: adminToken })).body;

  /** A phone's redemption over the link, asked as often as the test likes. */
  const asker =
    (linkPort: number, key: string, body: string) =>
    (): Promise<{ status: number; body: string }> =>
      linkRequest(linkPort, key, { method: "POST", path: "/kleio/pair/redeem", body });

  /**
   * A phone pairing over the link as the app does it: it hears `pending`, an
   * admin allows it, and the same request again pairs it.
   */
  async function pairOverLink(
    ports: { apiPort: number; linkPort: number },
    adminToken: string,
    code: string,
    label = "iPhone",
  ): Promise<{ status: number; body: string }> {
    const ask = asker(ports.linkPort, KEY_A, redeemBody(code, label));
    expect((await ask()).status).toBe(202);
    expect((await decide(ports.apiPort, adminToken, { allow: true })).status).toBe(200);
    return ask();
  }

  const payloadOf = (body: string): PairingPayload =>
    (JSON.parse(body) as { payload: PairingPayload }).payload;

  it("takes a link device's token from its own key only", async () => {
    const { registry, linkPort, logs } = await linkHost();
    const phone = await mint(registry, "iPhone", KEY_A);
    const own = await linkRequest(linkPort, KEY_A, { path: "/kleio/link", token: phone.token });
    expect(own.status).toBe(200);
    const other = await linkRequest(linkPort, KEY_B, { path: "/kleio/link", token: phone.token });
    expect(other).toEqual({ status: 401, body: JSON.stringify({ error: "unauthorized" }) });
    expect(logs.some((l) => l.includes("iPhone's token: it came with another"))).toBe(true);
  });

  it("doesn't take the token of a device paired over its own network", async () => {
    const { registry, apiPort, linkPort } = await linkHost();
    const laptop = await mint(registry, "Laptop");
    expect(
      (await linkRequest(linkPort, KEY_A, { path: "/kleio/link", token: laptop.token })).status,
    ).toBe(401);
    expect((await apiRequest(apiPort, { path: "/kleio/link", token: laptop.token })).status).toBe(
      200,
    );
  });

  it("answers GET /kleio/link with the key, the relay list and where the link is", async () => {
    const { registry, linkPort, dir } = await linkHost();
    const phone = await mint(registry, "iPhone", KEY_A);
    const ask = async (): Promise<unknown> => {
      const r = await linkRequest(linkPort, KEY_A, { path: "/kleio/link", token: phone.token });
      expect(r.status).toBe(200);
      return JSON.parse(r.body) as unknown;
    };
    expect(await ask()).toEqual({
      key: HOST_KEY,
      relays: ["n0"],
      listVersion: 0,
      running: false,
      relay: null,
      addrs: [],
      rateLimited: false,
      updatedAt: null,
    });

    const updatedAt = new Date().toISOString();
    writeState(dir, {
      updatedAt,
      rateLimited: true,
      addrs: ["192.168.1.20:52043", "127.0.0.1:52043", "[2001:db8::7]:52043"],
    });
    writeConfig(dir, { version: 1, listVersion: 3, relays: [OWN, "n0"] });
    expect(await ask()).toEqual({
      key: HOST_KEY,
      relays: [OWN, "n0"],
      listVersion: 3,
      running: true,
      relay: N0_EU,
      addrs: ["192.168.1.20:52043", "[2001:db8::7]:52043"],
      rateLimited: true,
      updatedAt,
    });

    // Old state: where it was last, but not running, and no longer slowed.
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    writeState(dir, { updatedAt: old, rateLimited: true });
    expect(await ask()).toMatchObject({
      running: false,
      relay: N0_EU,
      rateLimited: false,
      updatedAt: old,
    });
  });

  /** Waits until `check` holds, for up to 2 s. */
  async function until(check: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("never happened");
  }

  function configDoc(dir: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as Record<string, unknown>;
  }

  const ANSWERS = async (): Promise<RelayPing> => ({ kind: "relay", ms: 12 });

  it("shows any paired device the relay list, and lets only an admin change it", async () => {
    const { registry, apiPort, linkPort } = await linkHost({ pingRelay: ANSWERS });
    const phone = await mint(registry, "iPhone", KEY_A);
    const admin = await mint(registry, "Laptop", undefined, true);
    const seen = await linkRequest(linkPort, KEY_A, {
      path: "/kleio/link/relays",
      token: phone.token,
    });
    expect(seen.status).toBe(200);
    expect(JSON.parse(seen.body)).toEqual({
      listVersion: 0,
      relays: [{ entry: "n0", state: "unknown", new: false }],
      inUse: true,
      hostRelay: null,
      waiting: 0,
    });
    const put = (token: string, body: unknown) =>
      apiRequest(apiPort, {
        method: "PUT",
        path: "/kleio/link/relays",
        token,
        body: JSON.stringify(body),
      });
    const refused = await linkRequest(linkPort, KEY_A, {
      method: "PUT",
      path: "/kleio/link/relays",
      token: phone.token,
      body: JSON.stringify({ listVersion: 0, relays: [OWN, "n0"] }),
    });
    expect(refused.status).toBe(403);

    const set = await put(admin.token, { listVersion: 0, relays: [OWN, "n0"] });
    expect(set.status).toBe(200);
    expect(JSON.parse(set.body)).toMatchObject({
      listVersion: 1,
      relays: [
        { entry: OWN, new: true },
        { entry: "n0", new: false },
      ],
      inUse: false,
      waiting: 1,
      waitingFor: [{ deviceId: phone.deviceId, label: "iPhone" }],
      pings: [{ relay: OWN, kind: "relay", ms: 12 }],
    });
  });

  it("uses a new list once every device has it, keeping the host on known relays till then", async () => {
    const { registry, apiPort, linkPort, dir } = await linkHost({ pingRelay: ANSWERS });
    const phone = await mint(registry, "iPhone", KEY_A);
    const pad = await mint(registry, "iPad", KEY_B);
    const admin = await mint(registry, "Laptop", undefined, true);
    const set = await apiRequest(apiPort, {
      method: "PUT",
      path: "/kleio/link/relays",
      token: admin.token,
      body: JSON.stringify({ listVersion: 0, relays: [OWN] }),
    });
    expect(set.status).toBe(200);
    // kleio-link-host stays on n0's relays, which every device knows.
    expect(configDoc(dir)).toEqual({
      version: 1,
      listVersion: 1,
      relays: ["n0", OWN],
      list: [OWN],
      promoted: ["n0"],
    });
    // Devices get the new list.
    const info = await linkRequest(linkPort, KEY_A, { path: "/kleio/link", token: phone.token });
    expect(JSON.parse(info.body)).toMatchObject({ relays: [OWN], listVersion: 1 });
    await until(() => registry.get(phone.deviceId)?.listVersion === 1);
    expect(configDoc(dir).promoted).toEqual(["n0"]);
    // The last device gets it: the host uses it.
    await linkRequest(linkPort, KEY_B, { path: "/kleio/link", token: pad.token });
    await until(() => configDoc(dir).promoted === undefined);
    expect(configDoc(dir)).toEqual({ version: 1, listVersion: 1, relays: [OWN] });
  });

  it("refuses a bad list, a stale one, and a relay that doesn't answer unless saved anyway", async () => {
    const { registry, apiPort, dir } = await linkHost({
      pingRelay: async () => ({ kind: "no_answer", detail: "ENOTFOUND" }),
    });
    const admin = await mint(registry, "Laptop", undefined, true);
    const put = (body: unknown) =>
      apiRequest(apiPort, {
        method: "PUT",
        path: "/kleio/link/relays",
        token: admin.token,
        body: JSON.stringify(body),
      });
    expect(await put({ listVersion: 0, relays: ["http://relay.example.com/"] })).toMatchObject({
      status: 400,
      body: JSON.stringify({
        error: "bad_relays",
        message: "http://relay.example.com/ isn't https.",
      }),
    });
    expect((await put({ relays: [OWN] })).status).toBe(400);
    const unreachable = await put({ listVersion: 0, relays: [OWN, "n0"] });
    expect(unreachable.status).toBe(422);
    expect(JSON.parse(unreachable.body)).toEqual({
      error: "relay_unreachable",
      pings: [{ relay: OWN, kind: "no_answer", detail: "ENOTFOUND" }],
    });
    const anyway = await put({ listVersion: 0, relays: [OWN, "n0"], force: true });
    expect(anyway.status).toBe(200);
    // No device on the link waits for it, so it's used at once.
    expect(configDoc(dir)).toEqual({ version: 1, listVersion: 1, relays: [OWN, "n0"] });
    expect(await put({ listVersion: 0, relays: ["n0"] })).toMatchObject({
      status: 409,
      body: JSON.stringify({ error: "stale", listVersion: 1 }),
    });
  });

  it("uses a waiting list now when an admin says so", async () => {
    const { registry, apiPort, linkPort, dir } = await linkHost({ pingRelay: ANSWERS });
    const phone = await mint(registry, "iPhone", KEY_A);
    const admin = await mint(registry, "Laptop", undefined, true);
    await apiRequest(apiPort, {
      method: "PUT",
      path: "/kleio/link/relays",
      token: admin.token,
      body: JSON.stringify({ listVersion: 0, relays: [OWN] }),
    });
    const notAdmin = await linkRequest(linkPort, KEY_A, {
      method: "POST",
      path: "/kleio/link/relays/use-now",
      token: phone.token,
      body: JSON.stringify({ listVersion: 1 }),
    });
    expect(notAdmin.status).toBe(403);
    const used = await apiRequest(apiPort, {
      method: "POST",
      path: "/kleio/link/relays/use-now",
      token: admin.token,
      body: JSON.stringify({ listVersion: 1 }),
    });
    expect(used.status).toBe(200);
    expect(JSON.parse(used.body)).toMatchObject({ inUse: true, waiting: 0 });
    expect(configDoc(dir)).toEqual({ version: 1, listVersion: 1, relays: [OWN] });
  });

  it("answers 500 for a relay list it can't read, and 405 to anything but GET", async () => {
    const { registry, linkPort, dir, logs } = await linkHost();
    const phone = await mint(registry, "iPhone", KEY_A);
    writeConfig(dir, { version: 1, listVersion: 0, relays: [] });
    const r = await linkRequest(linkPort, KEY_A, { path: "/kleio/link", token: phone.token });
    expect(r).toEqual({ status: 500, body: JSON.stringify({ error: "link_config" }) });
    expect(logs.some((l) => l.includes("config.json: relays must be"))).toBe(true);
    const post = await linkRequest(linkPort, KEY_A, {
      method: "POST",
      path: "/kleio/link",
      token: phone.token,
    });
    expect(post.status).toBe(405);
  });

  it("closes the link's connections when it stops, kept-alive ones too", async () => {
    const { host, linkPort } = await linkHost();
    const open = exchange(
      linkPort,
      [`${preamble(KEY_A)}GET /kleio/health HTTP/1.1\r\nhost: link.kleio.invalid\r\n\r\n`],
      { waitMs: 5000 },
    );
    await sleep(200);
    const since = Date.now();
    await host.stop();
    const { text, closed } = await open;
    expect(text).toContain("HTTP/1.1 200");
    expect(closed).toBe(true);
    expect(Date.now() - since).toBeLessThan(2500);
  });

  it("pairs over the link: bound to the phone's key, and of no use off the link", async () => {
    const { registry, apiPort, linkPort, logs } = await linkHost({ publicUrl: true });
    const admin = await mint(registry, "Admin", undefined, true);
    const { code } = await offer(apiPort, admin.token);
    const redeem = await pairOverLink({ apiPort, linkPort }, admin.token, code);
    expect(redeem.status).toBe(200);
    const payload = payloadOf(redeem.body);
    expect(payload).not.toHaveProperty("baseUrl");
    expect(payload).toMatchObject({ host: NODE_ID, label: "iPhone" });
    expect(registry.get(payload.deviceId)?.linkKey).toBe(KEY_A);

    const onLink = await linkRequest(linkPort, KEY_A, {
      path: "/kleio/link",
      token: payload.token,
    });
    expect(onLink.status).toBe(200);
    const offLink = await apiRequest(apiPort, { path: "/kleio/link", token: payload.token });
    expect(offLink.status).toBe(401);
    expect(logs.some((l) => l.includes("iPhone's token off the link: it was paired over"))).toBe(
      true,
    );
  });

  it("pairs on the host's own listener with no key, and gives that device its address", async () => {
    const { registry, apiPort, logs } = await linkHost({ publicUrl: true });
    const admin = await mint(registry, "Admin", undefined, true);
    const { code } = await offer(apiPort, admin.token);
    // At once, as an app that doesn't wait still may off the link.
    const redeem = await apiRequest(apiPort, {
      method: "POST",
      path: "/kleio/pair/redeem",
      body: redeemBody(code, "Laptop", { waits: false }),
    });
    expect(redeem.status).toBe(200);
    const payload = payloadOf(redeem.body);
    expect(payload.baseUrl).toBe(PUBLIC_URL);
    expect(registry.get(payload.deviceId)?.linkKey).toBeNull();
    expect(logs).toContain("[pair] Laptop paired off the link (admin=false)");
  });

  it("pairing the same phone again replaces its older pairing", async () => {
    const { registry, apiPort, linkPort, logs } = await linkHost();
    const admin = await mint(registry, "Admin", undefined, true);
    const pair = async (): Promise<PairingPayload> => {
      const { code } = await offer(apiPort, admin.token);
      const r = await pairOverLink({ apiPort, linkPort }, admin.token, code);
      expect(r.status).toBe(200);
      return payloadOf(r.body);
    };
    const first = await pair();
    const second = await pair();
    const ask = (token: string): Promise<{ status: number }> =>
      linkRequest(linkPort, KEY_A, { path: "/kleio/link", token });
    expect((await ask(first.token)).status).toBe(401);
    expect((await ask(second.token)).status).toBe(200);
    expect(registry.get(first.deviceId)?.revoked).toBe(true);
    expect(logs.some((l) => l.includes(`replaces ${first.deviceId}, paired with the same`))).toBe(
      true,
    );
  });

  it("keeps a phone over the link waiting (202) till an admin allows it, and makes nothing meanwhile", async () => {
    const { registry, apiPort, linkPort, logs } = await linkHost();
    const admin = await mint(registry, "Admin", undefined, true);
    const { code } = await offer(apiPort, admin.token);
    const nonce = newRedemptionNonce();
    const ask = asker(linkPort, KEY_A, redeemBody(code, "iPhone", { nonce }));
    const waiting = await ask();
    expect(waiting.status).toBe(202);
    expect(JSON.parse(waiting.body)).toEqual({
      ok: false,
      error: "pending",
      retryAfterMs: PAIR_RETRY_AFTER_MS,
      expiresAt: expect.any(Number),
    });
    expect((await ask()).status).toBe(202);
    expect(registry.list().map((d) => d.label)).toEqual(["Admin"]);

    // The admin sees who's waiting: its name and device code, never its
    // nonce or whole key. The open health route says only that a code is live.
    const deviceCode = formatDeviceCode(KEY_A);
    const state = await pairState(apiPort, admin.token);
    expect(JSON.parse(state)).toMatchObject({
      active: true,
      claim: { label: "iPhone", deviceCode, contested: false, allowed: false },
    });
    expect(state).not.toContain(nonce);
    expect(state).not.toContain(KEY_A);
    const health = (await apiRequest(apiPort, { path: "/kleio/health" })).body;
    expect(JSON.parse(health)).toMatchObject({ offer: true });
    expect(health).not.toContain("iPhone");
    expect(health).not.toContain(deviceCode);

    const allowed = await decide(apiPort, admin.token, { allow: true, deviceCode });
    expect(allowed).toMatchObject({
      status: 200,
      body: JSON.stringify({ ok: true, label: "iPhone", deviceCode }),
    });
    const paired = await ask();
    expect(paired.status).toBe(200);
    expect(payloadOf(paired.body)).toMatchObject({ label: "iPhone" });
    expect(await ask()).toEqual(paired);
    expect(registry.list().map((d) => d.label)).toEqual(["Admin", "iPhone"]);
    expect(logs).toContain(`[admin] Admin allowed iPhone (${deviceCode})`);
    expect(logs).toContain(
      `[pair] iPhone paired over the link (device code ${deviceCode}, admin=false, allowed by Admin)`,
    );
  });

  it("answers a phone the moment an admin allows it, while its request is held", async () => {
    const { registry, apiPort, linkPort } = await linkHost({
      // Held until a decision, however long that takes.
      hold: (_ms, signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve())),
    });
    const admin = await mint(registry, "Admin", undefined, true);
    const { code } = await offer(apiPort, admin.token);
    const held = asker(linkPort, KEY_A, redeemBody(code, "iPhone"))();
    await expect
      .poll(async () => JSON.parse(await pairState(apiPort, admin.token)).claim?.label)
      .toBe("iPhone");
    expect((await decide(apiPort, admin.token, { allow: true })).status).toBe(200);
    const paired = await held;
    expect(paired.status).toBe(200);
    expect(payloadOf(paired.body)).toMatchObject({ label: "iPhone" });
  });

  it("turns away another device with the code (409 claimed), at no try's cost, and tells the admin", async () => {
    const { registry, apiPort, linkPort } = await linkHost();
    const admin = await mint(registry, "Admin", undefined, true);
    const { code } = await offer(apiPort, admin.token);
    expect((await asker(linkPort, KEY_A, redeemBody(code, "iPhone"))()).status).toBe(202);
    const claimed = { status: 409, body: JSON.stringify({ ok: false, error: "claimed" }) };
    expect(await asker(linkPort, KEY_B, redeemBody(code, "Stranger"))()).toEqual(claimed);
    // Off the link too: the code is the waiting phone's now.
    expect(
      await apiRequest(apiPort, {
        method: "POST",
        path: "/kleio/pair/redeem",
        body: redeemBody(code, "Laptop"),
      }),
    ).toMatchObject(claimed);
    expect(JSON.parse(await pairState(apiPort, admin.token))).toMatchObject({
      attemptsRemaining: PAIR_MAX_ATTEMPTS,
      claim: { label: "iPhone", contested: true },
    });
    expect(registry.list().map((d) => d.label)).toEqual(["Admin"]);
  });

  it("turns a waiting phone down (410 denied) on Deny, or when the code is closed", async () => {
    const { registry, apiPort, linkPort, logs } = await linkHost();
    const admin = await mint(registry, "Admin", undefined, true);
    const turnDown = [
      (): Promise<{ status: number }> => decide(apiPort, admin.token, { allow: false }),
      (): Promise<{ status: number }> =>
        apiRequest(apiPort, { method: "POST", path: "/kleio/pair/revoke", token: admin.token }),
    ];
    for (const down of turnDown) {
      const { code } = await offer(apiPort, admin.token);
      const ask = asker(linkPort, KEY_A, redeemBody(code, "iPhone"));
      expect((await ask()).status).toBe(202);
      expect((await down()).status).toBe(200);
      expect(await ask()).toEqual({
        status: 410,
        body: JSON.stringify({ ok: false, error: "denied" }),
      });
    }
    expect(registry.list().map((d) => d.label)).toEqual(["Admin"]);
    expect(logs).toContain(`[admin] Admin denied iPhone (${formatDeviceCode(KEY_A)})`);
  });

  it("refuses an app too old to wait (426 update_required), at no try's cost", async () => {
    const { registry, apiPort, linkPort } = await linkHost();
    const admin = await mint(registry, "Admin", undefined, true);
    const { code } = await offer(apiPort, admin.token);
    expect(await asker(linkPort, KEY_A, redeemBody(code, "iPhone", { waits: false }))()).toEqual({
      status: 426,
      body: JSON.stringify({ ok: false, error: "update_required" }),
    });
    expect(JSON.parse(await pairState(apiPort, admin.token))).toMatchObject({
      active: true,
      attemptsRemaining: PAIR_MAX_ATTEMPTS,
      claim: null,
    });
    expect(registry.list().map((d) => d.label)).toEqual(["Admin"]);
  });

  it("decides only on a device that's waiting, and the one the admin was shown", async () => {
    const { registry, apiPort, linkPort } = await linkHost();
    const admin = await mint(registry, "Admin", undefined, true);
    const noneWaiting = { status: 409, body: JSON.stringify({ ok: false, error: "none_waiting" }) };
    expect(await decide(apiPort, admin.token, { allow: true })).toMatchObject(noneWaiting);
    const { code } = await offer(apiPort, admin.token);
    expect(await decide(apiPort, admin.token, { allow: false })).toMatchObject(noneWaiting);
    const ask = asker(linkPort, KEY_A, redeemBody(code, "iPhone"));
    expect((await ask()).status).toBe(202);
    expect(
      await decide(apiPort, admin.token, { allow: true, deviceCode: formatDeviceCode(KEY_B) }),
    ).toMatchObject({ status: 409, body: JSON.stringify({ ok: false, error: "changed" }) });
    expect((await ask()).status).toBe(202);
    for (const body of [
      "",
      "null",
      "[]",
      "{}",
      '{"allow":"yes"}',
      '{"allow":true,"deviceCode":5}',
    ]) {
      const bad = await apiRequest(apiPort, {
        method: "POST",
        path: "/kleio/pair/decide",
        token: admin.token,
        body,
      });
      expect(bad.status).toBe(400);
    }
    expect(
      (await decide(apiPort, admin.token, { allow: true, deviceCode: "A".repeat(17) })).status,
    ).toBe(400);
    // The device code as typed: any case, any spacing.
    expect((await decide(apiPort, admin.token, { allow: true, deviceCode: "aaaaaa" })).status).toBe(
      200,
    );
    expect((await ask()).status).toBe(200);
  });

  it("gives each pair offer the link's ticket while the link can pair", async () => {
    const { registry, apiPort, dir, logs } = await linkHost();
    const admin = await mint(registry, "Admin", undefined, true);
    const down = await offer(apiPort, admin.token);
    expect(down).toMatchObject({ ticket: null, ticketError: "link_down" });
    expect(logs.some((l) => l.includes("the pair offer has no QR code"))).toBe(true);

    writeState(dir, { addrs: ["192.168.1.20:52043"] });
    const up = await offer(apiPort, admin.token);
    expect(up.ticketError).toBeNull();
    expect(JSON.parse(up.ticket ?? "null")).toEqual({
      v: 4,
      type: "kleio-pair",
      name: "test-host",
      key: HOST_KEY,
      relays: [N0_EU, "n0"],
      addrs: ["192.168.1.20:52043"],
      code: up.display,
    });
  });

  it("lets a device remove itself, and nothing else", async () => {
    const { registry, apiPort, linkPort } = await linkHost();
    const phone = await mint(registry, "iPhone", KEY_A);
    const laptop = await mint(registry, "Laptop");
    const wrong = await apiRequest(apiPort, { path: "/kleio/devices/self", token: laptop.token });
    expect(wrong).toMatchObject({ status: 405, allow: "DELETE" });

    const gone = await linkRequest(linkPort, KEY_A, {
      method: "DELETE",
      path: "/kleio/devices/self",
      token: phone.token,
    });
    expect(gone).toEqual({ status: 200, body: JSON.stringify({ ok: true }) });
    expect(registry.get(phone.deviceId)?.revoked).toBe(true);
    expect(registry.get(laptop.deviceId)?.revoked).toBe(false);
    const again = await linkRequest(linkPort, KEY_A, { path: "/kleio/link", token: phone.token });
    expect(again.status).toBe(401);
    expect((await apiRequest(apiPort, { path: "/kleio/link", token: laptop.token })).status).toBe(
      200,
    );
  });

  /** What a listener answers a request whose Host isn't one of its addresses. */
  const MISDIRECTED = { status: 421, body: JSON.stringify({ error: "misdirected_request" }) };

  it("answers each listener only at its own addresses, refusing any other name with 421", async () => {
    const { apiPort, linkPort, logs } = await linkHost({ publicUrl: true });
    const refused = (): string[] => logs.filter((l) => l.includes("[host] refused a request"));
    // The API: this machine's names at its port, and KLEIO_PUBLIC_URL's, which
    // Tailscale Serve passes on for a device paired by address.
    for (const host of [
      `127.0.0.1:${apiPort}`,
      `localhost:${apiPort}`,
      `[::1]:${apiPort}`,
      "mini.test.ts.net:8443",
      "MINI.test.ts.net:8443",
    ]) {
      expect((await apiRequest(apiPort, { path: "/kleio/health", host })).status, host).toBe(200);
    }
    // The link: the app's link address, which kleio-link-host's own requests name too.
    for (const host of [LINK_HOST, `127.0.0.1:${linkPort}`]) {
      const answer = await linkRequest(linkPort, KEY_A, { path: "/kleio/health", host });
      expect(answer.status, host).toBe(200);
    }
    expect(refused()).toEqual([]);

    // A web page whose name points at this machine, each listener's names on
    // the other, and the public name without its port: refused, and said once.
    for (let i = 0; i < 2; i += 1) {
      for (const host of ["evil.example", LINK_HOST, "mini.test.ts.net"]) {
        const answer = await apiRequest(apiPort, { path: "/kleio/health", host });
        expect(answer, host).toMatchObject(MISDIRECTED);
      }
      for (const host of [`127.0.0.1:${apiPort}`, "mini.test.ts.net:8443"]) {
        const answer = await linkRequest(linkPort, KEY_A, { path: "/kleio/health", host });
        expect(answer, host).toEqual(MISDIRECTED);
      }
    }
    expect(refused()).toEqual([
      `[host] refused a request to the API with Host "evil.example": it answers only to 127.0.0.1:${apiPort}, localhost:${apiPort}, [::1]:${apiPort}, mini.test.ts.net:8443 (said once for each)`,
      expect.stringContaining(`to the API with Host "${LINK_HOST}":`),
      expect.stringContaining('to the API with Host "mini.test.ts.net":'),
      `[host] refused a request on the link with Host "127.0.0.1:${apiPort}": it answers only to ${LINK_HOST}, 127.0.0.1:${linkPort} (said once for each)`,
      expect.stringContaining('on the link with Host "mini.test.ts.net:8443":'),
    ]);
  });

  it("refuses a request with no Host header with 400, on either listener", async () => {
    const { apiPort, linkPort, logs } = await linkHost({ publicUrl: true });
    const bad = { status: 400, body: JSON.stringify({ error: "bad_request" }) };
    // HTTP/1.0 may leave Host out, so this host refuses it...
    const noHost = "GET /kleio/health HTTP/1.0\r\n\r\n";
    expect(await rawRequest(apiPort, noHost)).toEqual(bad);
    expect(await rawRequest(linkPort, noHost, KEY_A)).toEqual(bad);
    // ...and HTTP/1.1 must have one, so Node refuses it first.
    const oneOne = await rawRequest(apiPort, "GET /kleio/health HTTP/1.1\r\n\r\n");
    expect(oneOne.status).toBe(400);
    expect(logs.filter((l) => l.includes("with no Host header"))).toEqual([
      "[host] refused a request to the API with no Host header (said once)",
      "[host] refused a request on the link with no Host header (said once)",
    ]);
    // With one, the same request is answered.
    const named = `GET /kleio/health HTTP/1.0\r\nHost: 127.0.0.1:${apiPort}\r\n\r\n`;
    expect((await rawRequest(apiPort, named)).status).toBe(200);
    const onLink = `GET /kleio/health HTTP/1.0\r\nHost: ${LINK_HOST}\r\n\r\n`;
    expect((await rawRequest(linkPort, onLink, KEY_A)).status).toBe(200);
  });

  it("refuses a misdirected request before anything else: no token, and no try at a code", async () => {
    const { registry, apiPort } = await linkHost({ publicUrl: true });
    const admin = await mint(registry, "Admin", undefined, true);
    const evil = "evil.example";
    const devices = { path: "/kleio/devices", token: admin.token };
    expect(await apiRequest(apiPort, { ...devices, host: evil })).toMatchObject(MISDIRECTED);
    expect((await apiRequest(apiPort, devices)).status).toBe(200);

    // More wrong codes than a code's tries: none counts, as none is read.
    const { code } = await offer(apiPort, admin.token);
    const wrong = (code.startsWith("0") ? "1" : "0") + code.slice(1);
    for (let i = 0; i <= PAIR_MAX_ATTEMPTS; i += 1) {
      const body = redeemBody(wrong, "Stranger");
      const tried = await apiRequest(apiPort, {
        method: "POST",
        path: "/kleio/pair/redeem",
        body,
        host: evil,
      });
      expect(tried).toMatchObject(MISDIRECTED);
    }
    // So the code still pairs, by the host's address, as pairing under
    // "Advanced: connect over your own network" does.
    const redeem = await apiRequest(apiPort, {
      method: "POST",
      path: "/kleio/pair/redeem",
      body: redeemBody(code, "Laptop"),
      host: "mini.test.ts.net:8443",
    });
    expect(redeem.status).toBe(200);
    expect(payloadOf(redeem.body).baseUrl).toBe(PUBLIC_URL);
  });

  it("doesn't start when the link's port is taken, and frees the others", async () => {
    const taken = createNetServer();
    await new Promise<void>((r) => taken.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise<void>((r) => taken.close(() => r())));
    const port = (taken.address() as AddressInfo).port;
    await expect(linkHost({ port })).rejects.toThrow(/EADDRINUSE/);
  });
});

describe("addresses in a ticket", () => {
  it("takes a relay's address only as https://<host>[:<port>]/, as a URL parser writes it", () => {
    for (const good of [N0_EU, OWN, "https://relay.example.com:8443/", "https://[2001:db8::1]/"]) {
      expect(isRelayUrl(good), good).toBe(true);
    }
    for (const bad of [
      "http://relay.example.com/",
      "https://relay.example.com",
      "https://relay.example.com/path",
      "https://relay.example.com/?q",
      "https://relay.example.com/#f",
      "https://user@relay.example.com/",
      "https://Relay.example.com/",
      "https://relay.example.com:443/",
      `https://${"r".repeat(200)}.example/`,
      "n0",
      42,
    ]) {
      expect(isRelayUrl(bad), String(bad)).toBe(false);
    }
  });

  it("takes a direct address in Rust's one form, and only one a phone could use", () => {
    for (const good of [
      "192.168.1.20:52043",
      "203.0.113.7:7842",
      "[2001:db8::7]:1",
      "[fe80::1]:65535",
    ]) {
      expect(isDirectAddr(good), good).toBe(true);
    }
    for (const bad of [
      "192.168.001.20:52043",
      "192.168.1.20:0",
      "192.168.1.20:65536",
      "192.168.1.20:052043",
      "192.168.1.20",
      "127.0.0.1:52043",
      "0.0.0.0:52043",
      "[::1]:52043",
      "[::]:52043",
      "[2001:0db8::7]:1",
      "[2001:DB8::7]:1",
      "[fe80::1%en0]:1",
      "[::ffff:1.2.3.4]:1",
      "2001:db8::7:1",
    ]) {
      expect(isDirectAddr(bad), bad).toBe(false);
    }
  });

  it("makes a host's name fit: no control or bidi characters, at most 32 bytes", () => {
    expect(ticketName("Wills-Mac-mini")).toBe("Wills-Mac-mini");
    expect(ticketName("  two \t names  ")).toBe("two names");
    expect(ticketName("evil\u202Eniam\u0007")).toBe("evilniam");
    expect(ticketName("x".repeat(40))).toBe("x".repeat(32));
    expect(ticketName("é".repeat(20))).toBe("é".repeat(16));
    expect(ticketName("😀".repeat(9))).toBe("😀".repeat(8));
    expect(ticketName("\uD800abc")).toBe("abc");
    expect(ticketName("")).toBe("Kleio host");
    expect(ticketName("\u0000\u0001")).toBe("Kleio host");
  });
});

describe("the v4 pairing ticket", () => {
  it.each(vectors.map((v) => [v.about, v] as const))("%s", (_about, vector) => {
    expect(buildTicket(vector.build)).toEqual({ ok: true, value: vector.ticket });
  });

  it("keeps the default ticket under 300 bytes, for an 80-column terminal's QR code", () => {
    const defaults = vectors.filter((v) => v.build.relays.join() === "n0");
    expect(defaults.length).toBeGreaterThan(1);
    for (const v of defaults) expect(Buffer.byteLength(v.ticket, "utf8")).toBeLessThan(300);
  });

  const base: TicketInput = {
    name: "mac-mini-1",
    key: HOST_KEY,
    relay: N0_EU,
    relays: ["n0"],
    addrs: ["192.168.1.20:52043"],
    code: "ABC-DEF",
  };

  it("refuses what a phone wouldn't take", () => {
    const cases: [Partial<TicketInput>, string][] = [
      [{ name: "" }, "name"],
      [{ name: "bidi\u202Ename" }, "name"],
      [{ name: "x".repeat(33) }, "name"],
      [{ key: HOST_KEY.toUpperCase() }, "key"],
      [{ relay: "n0" }, "relay"],
      [{ relay: "http://relay.example.com/" }, "relay"],
      [{ relays: ["n1"] }, "relays"],
      [{ addrs: ["127.0.0.1:1"] }, "addrs"],
      [{ code: "ABCDE" }, "code"],
      [{ code: "ABU-DEF" }, "code"],
    ];
    for (const [over, error] of cases) {
      expect(buildTicket({ ...base, ...over }), JSON.stringify(over)).toEqual({ ok: false, error });
    }
  });

  it("puts the relay it's on first, each relay once, at most four", () => {
    const r = buildTicket({
      ...base,
      relay: OWN,
      relays: ["https://a.example/", OWN, "https://b.example/", "https://c.example/", "n0"],
      addrs: ["192.168.1.20:52043", "192.168.1.21:52043", "192.168.1.22:52043"],
    });
    if (!r.ok) throw new Error(r.error);
    const ticket = JSON.parse(r.value) as { relays: string[]; addrs: string[] };
    expect(ticket.relays).toEqual([
      OWN,
      "https://a.example/",
      "https://b.example/",
      "https://c.example/",
    ]);
    expect(ticket.addrs).toEqual(["192.168.1.20:52043", "192.168.1.21:52043"]);
  });

  it("keeps a long one to 512 bytes: addresses go first, then relays after the first", () => {
    const long = (c: string): string =>
      `https://${c.repeat(63)}.${"e".repeat(63)}.${"l".repeat(50)}.example/`;
    const relays = [long("p"), long("q"), long("s")];
    const r = buildTicket({
      ...base,
      relay: long("r"),
      relays,
      addrs: ["192.168.1.20:52043", "[2a02:c7c8:aaaa:bbbb:cccc:dddd:eeee:ffff]:65535"],
    });
    if (!r.ok) throw new Error(r.error);
    expect(Buffer.byteLength(r.value, "utf8")).toBeLessThanOrEqual(MAX_TICKET_BYTES);
    const ticket = JSON.parse(r.value) as { relays: string[]; addrs: string[] };
    expect(ticket.relays).toEqual([long("r")]);
    expect(ticket.addrs).toEqual([]);
  });
});

describe("the link's files", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const at = (msAgo: number): string => new Date(now.getTime() - msAgo).toISOString();

  it("reads kleio-link-host's state: running while it's fresh, stale after", async () => {
    const dir = join(scratch, "link");
    expect(await readLinkState(dir, HOST_KEY, now)).toEqual({ kind: "missing" });
    writeState(dir, {
      updatedAt: at(LINK_STATE_FRESH_MS),
      addrs: ["192.168.1.20:52043", "127.0.0.1:1", "192.168.1.20:52043", 7],
      relays: [{ url: N0_EU, state: "home" }, { url: "nope", state: "x" }, "junk"],
      peers: [
        { key: KEY_A, path: "direct", at: at(5_000) },
        { key: KEY_B, path: "carrier pigeon", at: at(5_000) },
        { key: "short", path: "relay", at: at(5_000) },
        { key: KEY_B, path: "relay", at: "whenever" },
      ],
    });
    expect(await readLinkState(dir, HOST_KEY, now)).toEqual({
      kind: "running",
      state: {
        updatedAt: at(LINK_STATE_FRESH_MS),
        pid: 4242,
        key: HOST_KEY,
        relay: N0_EU,
        addrs: ["192.168.1.20:52043"],
        rateLimited: false,
        connections: 1,
        relays: [{ url: N0_EU, state: "home" }],
        peers: [{ key: KEY_A, path: "direct", at: at(5_000) }],
      },
    });
    writeState(dir, { updatedAt: at(LINK_STATE_FRESH_MS + 1) });
    expect((await readLinkState(dir, HOST_KEY, now)).kind).toBe("stale");
  });

  it("calls a state file invalid when it isn't this host's, or isn't one", async () => {
    const dir = join(scratch, "link");
    const cases: [Record<string, unknown> | string, string][] = [
      [{ key: KEY_A }, "another key"],
      [{ version: 2 }, "not a version 1 state file"],
      [{ updatedAt: "yesterday" }, "no updatedAt"],
      [{ pid: 0 }, "no pid"],
      [{ relay: "http://relay.example.com/" }, "relay isn't"],
      [{ addrs: "192.168.1.20:52043" }, "addrs isn't a list"],
      [{ rateLimited: "no" }, "rateLimited"],
      [{ connections: -1 }, "connections"],
      [{ peers: "none" }, "peers isn't a list"],
      ["{not json", "isn't JSON"],
    ];
    for (const [over, why] of cases) {
      if (typeof over === "string") {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "state.json"), over);
      } else {
        writeState(dir, { updatedAt: at(0), ...over });
      }
      const read = await readLinkState(dir, HOST_KEY, now);
      expect(read.kind, why).toBe("invalid");
      expect(read.kind === "invalid" ? read.message : "", why).toContain(why);
    }
  });

  it("reads the relay list, n0's alone without the file", async () => {
    const dir = join(scratch, "link");
    expect(await readLinkConfig(dir)).toEqual({ ok: true, value: DEFAULT_LINK_CONFIG });
    writeConfig(dir, { version: 1, listVersion: 2, relays: [OWN, "n0"] });
    expect(await readLinkConfig(dir)).toEqual({
      ok: true,
      value: { listVersion: 2, relays: [OWN, "n0"], hostOrder: [OWN, "n0"], promoted: null },
    });
    for (const bad of [
      { version: 2, listVersion: 0, relays: ["n0"] },
      { version: 1, listVersion: -1, relays: ["n0"] },
      { version: 1, listVersion: 0, relays: [] },
      { version: 1, listVersion: 0, relays: ["n0", "n0"] },
      { version: 1, listVersion: 0, relays: [OWN, OWN] },
      {
        version: 1,
        listVersion: 0,
        relays: [
          "n0",
          "https://a.example/",
          "https://b.example/",
          "https://c.example/",
          "https://d.example/",
        ],
      },
      { version: 1, listVersion: 0, relays: ["http://relay.example.com/"] },
    ]) {
      writeConfig(dir, bad);
      expect((await readLinkConfig(dir)).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("makes a ticket only while kleio-link-host is running on a relay", async () => {
    const dir = join(scratch, "link");
    const link = { dir, publicKey: HOST_KEY, name: "test-host" };
    const kind = async (): Promise<string> => {
      const r = await linkTicket(link, "ABCDEF", now);
      return r.ok ? "ticket" : r.error.kind;
    };
    expect(await kind()).toBe("link_down");
    writeState(dir, { updatedAt: at(LINK_STATE_FRESH_MS + 1) });
    expect(await kind()).toBe("link_down");
    writeState(dir, { updatedAt: at(0), relay: null });
    expect(await kind()).toBe("link_down");
    writeState(dir, { updatedAt: at(0), key: KEY_A });
    expect(await kind()).toBe("link_down");

    writeState(dir, { updatedAt: at(0), addrs: ["192.168.1.20:52043"] });
    const r = await linkTicket(link, "abc def", now);
    expect(r).toEqual(
      buildTicket({
        name: "test-host",
        key: HOST_KEY,
        relay: N0_EU,
        relays: ["n0"],
        addrs: ["192.168.1.20:52043"],
        code: "ABCDEF",
      }),
    );

    writeConfig(dir, { version: 1, listVersion: 0, relays: [] });
    expect(await kind()).toBe("config");
  });
});
