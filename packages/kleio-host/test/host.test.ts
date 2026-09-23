import { chmodSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, CONTROL_HEADER, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import type { ApnsPusher } from "../src/apns.js";
import { newRedemptionNonce, type PairingPayload } from "../src/pair-code.js";
import { createPairOfferStore, type PairOfferStore } from "../src/pair-offer.js";
import { createRingStore, type RingStore, type SessionRing } from "../src/sse-ring.js";
import * as macaroon from "../src/macaroon.js";

// ---------------------------------------------------------------- fake sidecar

interface FakeSidecar {
  server: Server;
  port: number;
  token: string;
  seen: { method: string; url: string; host: string; token: string | undefined }[];
  emit(sessionId: string, frame: string): void;
  /** What GET /routines reports as routine → session (the daemon's own sessions). */
  routineSessions: Record<string, string>;
  routines: { id: string; nextRunAt: number }[];
  /** Hold GET /routines open this long before answering (0 = at once). */
  routinesDelayMs: number;
  close(): Promise<void>;
}

async function fakeSidecar(): Promise<FakeSidecar> {
  const token = "sidecar-" + Math.random().toString(36).slice(2);
  const streams = new Map<string, Set<import("node:http").ServerResponse>>();
  const seen: FakeSidecar["seen"] = [];
  const routineSessions: Record<string, string> = {};
  const routines: { id: string; nextRunAt: number }[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      host: req.headers.host ?? "",
      token: req.headers["x-gg-token"] as string | undefined,
    });
    // Mimic the real sidecar: loopback Host allowlist + token.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) {
      res.writeHead(403);
      return res.end("bad host");
    }
    if (req.headers["x-gg-token"] !== token) {
      res.writeHead(401);
      return res.end("bad token");
    }
    if (url.pathname === "/events") {
      const sid = url.searchParams.get("session") ?? "none";
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "ready", session: sid })}\n\n`);
      let set = streams.get(sid);
      if (!set) streams.set(sid, (set = new Set()));
      set.add(res);
      req.on("close", () => set!.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/session") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "created-" + seen.length }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/routines") {
      const answer = (): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ routines, sessions: routineSessions }));
      };
      if (api.routinesDelayMs > 0) setTimeout(answer, api.routinesDelayMs);
      else answer();
      return;
    }
    if (url.pathname === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({ runState: "idle", session: req.headers["x-gg-session"] ?? null }),
      );
    }
    if (req.method === "POST" && url.pathname === "/prompt") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, echoed: JSON.parse(body) }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const api: FakeSidecar = {
    server,
    port,
    token,
    seen,
    emit(sid, frame) {
      for (const r of streams.get(sid) ?? []) r.write(frame + "\n\n");
    },
    routineSessions,
    routines,
    routinesDelayMs: 0,
    close: () =>
      new Promise((r) => {
        for (const set of streams.values()) for (const s of set) s.destroy();
        // Same as the real host's stop(): close() alone waits for idle
        // keep-alive sockets (a stopped host's poll connection, for one).
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
  return api;
}

// ---------------------------------------------------------------- fixture

let home: string;
let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let offers: PairOfferStore;
let host: Host;
let hostPort: number;
const ROOT = "control-root-key-for-tests-0123456789";
const NODE = "mini.test.ts.net";

function publishEndpoint(sc: FakeSidecar): void {
  writeFileSync(
    join(home, "sidecar.json"),
    JSON.stringify({ port: sc.port, token: sc.token, pid: 1, startedAt: "x" }),
  );
}

/** Records nudges instead of calling Apple. */
const nudges: { sessionId: string; devices: string[] }[] = [];
const fakeApns: ApnsPusher = {
  configured: true,
  async notify(nudge, devices) {
    const targets = devices.filter((d) => d.push && !d.revoked).map((d) => d.label);
    nudges.push({ sessionId: nudge.sessionId, devices: targets });
    return targets.length;
  },
};

async function startHost(overrides: { rings?: RingStore } = {}): Promise<Host> {
  const h = createHost({
    apns: fakeApns,
    diagnosticsDir: join(home, "logs"),
    listenPort: 0,
    publicBaseUrl: `https://${NODE}:8443`,
    nodeId: NODE,
    registry,
    offers,
    rings: overrides.rings ?? createRingStore({ directory: join(home, "rings"), maxFrames: 50 }),
    sidecarEndpointPath: join(home, "sidecar.json"),
    controlRootKey: ROOT,
    routinePollMs: 200,
  });
  await h.start();
  hostPort = (h.server.address() as { port: number }).port;
  return h;
}

beforeEach(async () => {
  nudges.length = 0;
  home = mkdtempSync(join(tmpdir(), "kleio-host-it-"));
  const keyPath = join(home, "secure", "headless-master.key");
  mkdirSync(join(home, "secure"), { mode: 0o700 });
  chmodSync(join(home, "secure"), 0o700);
  writeFileSync(keyPath, generateMasterKey(), { mode: 0o600 });
  registry = createDeviceRegistry({
    keychain: createFileKeychain({ keyPath }),
    storePath: join(home, "secure", "device-registry.json"),
  });
  await registry.init();
  offers = createPairOfferStore();
  sidecar = await fakeSidecar();
  publishEndpoint(sidecar);
  host = await startHost();
});
afterEach(async () => {
  await host.stop();
  await sidecar.close();
  rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------- helpers

interface Res {
  status: number;
  body: any;
  headers: Record<string, string | string[] | undefined>;
}
function call(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: hostPort,
        method,
        path,
        headers: {
          ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let s = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (s += c));
        res.on("end", () => {
          let body: unknown = s;
          try {
            body = JSON.parse(s);
          } catch {}
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function sse(
  path: string,
  headers: Record<string, string>,
  frames: (id: number, data: any) => boolean | void,
): Promise<void> & { close: () => void } {
  let req: import("node:http").ClientRequest;
  const p = new Promise<void>((resolve, reject) => {
    req = httpRequest(
      {
        host: "127.0.0.1",
        port: hostPort,
        path,
        headers: { accept: "text/event-stream", ...headers },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let s = "";
          res.on("data", (c) => (s += c));
          res.on("end", () => reject(new Error(`${res.statusCode} ${s}`)));
          return;
        }
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          buf += c;
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const id = raw.match(/^id: (\d+)$/m)?.[1];
            const data = raw.match(/^data: (.*)$/m)?.[1];
            if (id && data && frames(Number(id), JSON.parse(data)) === true) {
              req.destroy();
              resolve();
            }
          }
        });
        res.on("close", () => resolve());
      },
    );
    req.on("error", () => resolve());
    req.end();
  }) as Promise<void> & { close: () => void };
  p.close = () => req.destroy();
  return p;
}

async function pairAdmin(): Promise<PairingPayload> {
  // Bootstrap: the first admin is minted directly (the installer does this).
  const minted = await registry.mint("Bootstrap admin", { admin: true });
  if (!minted.ok) throw new Error("mint failed");
  return {
    baseUrl: "",
    host: NODE,
    token: minted.value.token,
    label: "Bootstrap admin",
    deviceId: minted.value.device.deviceId,
  };
}

// ---------------------------------------------------------------- tests

describe("host: auth boundary", () => {
  it("health is open; everything else needs a device token", async () => {
    expect((await call("GET", "/kleio/health")).status).toBe(200);
    expect((await call("GET", "/state")).status).toBe(401);
    expect(
      (await call("GET", "/state", { headers: { [DEVICE_TOKEN_HEADER]: "nope" } })).status,
    ).toBe(401);
    expect((await call("GET", "/kleio/devices")).status).toBe(401);
    // Only the host's own calls (health probe on /state, the routine-session
    // poll on /routines — both with the sidecar token) may have reached the
    // sidecar; no unauthenticated client request passes through.
    expect(
      sidecar.seen.filter(
        (r) =>
          !(
            r.method === "GET" &&
            (r.url === "/state" || r.url === "/routines") &&
            r.token === sidecar.token
          ),
      ),
    ).toHaveLength(0);
  });

  it("proxies an authenticated request with Host rewritten and the sidecar token added; never leaks the device token", async () => {
    const admin = await pairAdmin();
    const r = await call("POST", "/prompt", {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token, "x-gg-session": "s1" },
      body: { text: "hi" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, echoed: { text: "hi" } });
    const seen = sidecar.seen.at(-1)!;
    expect(seen.host).toBe(`127.0.0.1:${sidecar.port}`);
    expect(seen.token).toBe(sidecar.token);
    // The fake records headers it got; make sure the device token was stripped.
    expect(JSON.stringify(seen)).not.toContain(admin.token);
  });

  it("revoking a device closes its open event streams, not just future requests", async () => {
    const admin = await pairAdmin();
    const victim = await registry.mint("Victim");
    if (!victim.ok) throw new Error("mint");
    let closed = false;
    const stream = sse(
      `/events?session=s9`,
      { [DEVICE_TOKEN_HEADER]: victim.value.token },
      () => {},
    );
    void stream.then(() => (closed = true));
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(false);
    const r = await call("POST", `/kleio/devices/${victim.value.device.deviceId}/revoke`, {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token },
    });
    expect(r.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(true);
  });

  it("a revoked device is refused immediately", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    expect(
      (await call("GET", "/state", { headers: { [DEVICE_TOKEN_HEADER]: phone.value.token } }))
        .status,
    ).toBe(200);
    const rev = await call("POST", `/kleio/devices/${phone.value.device.deviceId}/revoke`, {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token },
    });
    expect(rev.status).toBe(200);
    expect(
      (await call("GET", "/state", { headers: { [DEVICE_TOKEN_HEADER]: phone.value.token } }))
        .status,
    ).toBe(401);
  });

  it("non-admin devices cannot reach /kleio/* control routes; a control macaroon grants it", async () => {
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const H = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    expect((await call("GET", "/kleio/devices", { headers: H })).status).toBe(403);
    const good = macaroon.mint(ROOT, phone.value.device.deviceId, [
      macaroon.expCaveat(new Date(Date.now() + 60_000)),
      macaroon.nodeCaveat(NODE),
    ]);
    expect(
      (await call("GET", "/kleio/devices", { headers: { ...H, [CONTROL_HEADER]: good } })).status,
    ).toBe(200);
    const wrongNode = macaroon.mint(ROOT, phone.value.device.deviceId, [
      macaroon.nodeCaveat("other.ts.net"),
    ]);
    expect(
      (await call("GET", "/kleio/devices", { headers: { ...H, [CONTROL_HEADER]: wrongNode } }))
        .status,
    ).toBe(403);
    const expired = macaroon.mint(ROOT, phone.value.device.deviceId, [
      macaroon.expCaveat(new Date(Date.now() - 1)),
    ]);
    expect(
      (await call("GET", "/kleio/devices", { headers: { ...H, [CONTROL_HEADER]: expired } }))
        .status,
    ).toBe(403);
  });
});

describe("host: pairing", () => {
  it("admin mints an offer; a new device redeems it by code and can then call the API", async () => {
    const admin = await pairAdmin();
    const offer = await call("POST", "/kleio/pair/offer", {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token },
    });
    expect(offer.status).toBe(200);
    expect(offer.body.display).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    expect(registry.list()).toHaveLength(1); // nothing minted until redeemed

    const nonce = newRedemptionNonce();
    const typed = offer.body.display.toLowerCase(); // as a human would type it
    const redeem = await call("POST", "/kleio/pair/redeem", {
      body: { code: typed, redemptionNonce: nonce, label: "Will's phone" },
    });
    expect(redeem.status).toBe(200);
    const payload = redeem.body.payload as PairingPayload;
    expect(payload).toMatchObject({
      baseUrl: `https://${NODE}:8443`,
      host: NODE,
      label: "Will's phone",
    });
    expect(payload.controlCredential).toBeUndefined();
    expect(registry.list().map((d) => d.label)).toEqual(["Bootstrap admin", "Will's phone"]);

    expect(
      (await call("GET", "/state", { headers: { [DEVICE_TOKEN_HEADER]: payload.token } })).status,
    ).toBe(200);
    expect(
      (await call("GET", "/kleio/devices", { headers: { [DEVICE_TOKEN_HEADER]: payload.token } }))
        .status,
    ).toBe(403);

    // Same nonce retry replays; a fresh nonce is refused; wrong code burns an attempt.
    expect(
      (await call("POST", "/kleio/pair/redeem", { body: { code: typed, redemptionNonce: nonce } }))
        .body.payload.token,
    ).toBe(payload.token);
    expect(
      (
        await call("POST", "/kleio/pair/redeem", {
          body: { code: typed, redemptionNonce: newRedemptionNonce() },
        })
      ).status,
    ).toBe(401);
  });

  it("an admin offer yields a control credential that passes the node/exp caveats", async () => {
    const admin = await pairAdmin();
    const offer = await call("POST", "/kleio/pair/offer", {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token },
      body: { admin: true },
    });
    const redeem = await call("POST", "/kleio/pair/redeem", {
      body: { code: offer.body.code, redemptionNonce: newRedemptionNonce(), label: "Laptop" },
    });
    const payload = redeem.body.payload as PairingPayload;
    expect(payload.controlCredential).toMatch(/^mac1\./);
    expect(
      macaroon.verify(ROOT, payload.controlCredential!, { now: new Date(), nodeId: NODE }),
    ).toEqual({ ok: true });
    expect(registry.get(payload.deviceId)?.admin).toBe(true);
    expect(
      (await call("GET", "/kleio/devices", { headers: { [DEVICE_TOKEN_HEADER]: payload.token } }))
        .status,
    ).toBe(200);
  });

  it("redeem never oracles: wrong/expired/absent all look alike apart from 404 when no offer exists", async () => {
    expect(
      (
        await call("POST", "/kleio/pair/redeem", {
          body: { code: "ABCDEF", redemptionNonce: newRedemptionNonce() },
        })
      ).status,
    ).toBe(404);
    const admin = await pairAdmin();
    await call("POST", "/kleio/pair/offer", { headers: { [DEVICE_TOKEN_HEADER]: admin.token } });
    const wrong = await call("POST", "/kleio/pair/redeem", {
      body: { code: "ZZZZZZ", redemptionNonce: newRedemptionNonce() },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ ok: false, error: "unauthorized" });
    expect((await call("POST", "/kleio/pair/redeem", { body: { code: 5 } })).status).toBe(400);
    expect(
      (await call("POST", "/kleio/pair/redeem", { body: { code: "x".repeat(5000) } })).status,
    ).toBe(413);
  });
});

describe("host: SSE replay", () => {
  it("numbers frames, fans out to two clients, and replays after Last-Event-ID", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const a: [number, any][] = [];
    const b: [number, any][] = [];
    const pa = sse("/events?session=s1", H, (id, d) => {
      a.push([id, d]);
    });
    const pb = sse("/events?session=s1", H, (id, d) => {
      b.push([id, d]);
    });
    await new Promise((r) => setTimeout(r, 150));
    for (let i = 1; i <= 5; i += 1)
      sidecar.emit("s1", `data: ${JSON.stringify({ type: "text_delta", n: i })}`);
    await new Promise((r) => setTimeout(r, 150));
    pa.close();
    pb.close();
    await pa;
    await pb;
    const firstSix = a.slice(0, 6);
    expect(firstSix.map(([id]) => id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(firstSix[0]![1]).toMatchObject({ type: "ready" });
    expect(b.slice(0, 6)).toEqual(firstSix);

    // Client A lost the connection after id 3; more frames flow meanwhile.
    // Wait for the host to notice both closes so nothing else lands in a/b.
    await new Promise((r) => setTimeout(r, 100));
    for (let i = 6; i <= 8; i += 1)
      sidecar.emit("s1", `data: ${JSON.stringify({ type: "text_delta", n: i })}`);
    await new Promise((r) => setTimeout(r, 100));
    const resumed: number[] = [];
    const pr = sse("/events?session=s1", { ...H, "last-event-id": "3" }, (id) => {
      resumed.push(id);
      return id === 9;
    });
    await pr;
    expect(resumed).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("replays across a host restart from the persisted ring", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const got: number[] = [];
    const p = sse("/events?session=s2", H, (id) => {
      got.push(id);
    });
    await new Promise((r) => setTimeout(r, 150));
    for (let i = 1; i <= 4; i += 1) sidecar.emit("s2", `data: {"type":"text_delta","n":${i}}`);
    await new Promise((r) => setTimeout(r, 150));
    p.close();
    await p;
    expect(got).toEqual([1, 2, 3, 4, 5]);

    await host.stop();
    host = await startHost();
    const resumed: [number, any][] = [];
    const pr = sse("/events?session=s2", { ...H, "last-event-id": "2" }, (id, d) => {
      resumed.push([id, d]);
      return id === 5;
    });
    await pr;
    expect(resumed.map(([id]) => id)).toEqual([3, 4, 5]);
    expect(resumed.map(([, d]) => d.n)).toEqual([2, 3, 4]);
  });

  it("signals a replay gap when Last-Event-ID predates the ring", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const p = sse("/events?session=s3", H, () => {});
    await new Promise((r) => setTimeout(r, 150));
    for (let i = 1; i <= 60; i += 1) sidecar.emit("s3", `data: {"type":"text_delta","n":${i}}`);
    await new Promise((r) => setTimeout(r, 200));
    p.close();
    await p;
    const seen: any[] = [];
    const pr = sse("/events?session=s3", { ...H, "last-event-id": "1" }, (_id, d) => {
      seen.push(d);
      return seen.length >= 2;
    });
    await pr;
    expect(seen[0]).toMatchObject({ type: "kleio_replay_gap", data: { from: 1 } });
  });
});

describe("host: session tracking (frames captured with no client attached)", () => {
  it("records frames for a proxy-created session while nobody is listening, across a host restart", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const created = await call("POST", "/session", {
      headers: H,
      body: { mode: "chat", cwd: "/tmp" },
    });
    expect(created.status).toBe(200);
    const sid = created.body.sessionId as string;
    expect(sid).toMatch(/^created-/);

    // No client ever attached. The sidecar streams; the proxy must be listening.
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 1; i <= 3; i += 1)
      sidecar.emit(sid, `data: ${JSON.stringify({ type: "text_delta", n: i })}`);
    await new Promise((r) => setTimeout(r, 50));

    // Proxy redeploy mid-run: the sidecar keeps streaming meanwhile. stop() must
    // not wait for keep-alive sockets to drain; that is what made this time out
    // on Windows CI.
    const t0 = Date.now();
    await host.stop();
    // Bounded: stop() flushes queued ring writes, but never past its 2 s budget.
    expect(Date.now() - t0).toBeLessThan(2000);
    for (let i = 4; i <= 6; i += 1)
      sidecar.emit(sid, `data: ${JSON.stringify({ type: "text_delta", n: i })}`);
    host = await startHost();
    await new Promise((r) => setTimeout(r, 100));
    for (let i = 7; i <= 9; i += 1)
      sidecar.emit(sid, `data: ${JSON.stringify({ type: "text_delta", n: i })}`);
    await new Promise((r) => setTimeout(r, 50));

    // First-ever client attach, resuming from the beginning.
    const got: any[] = [];
    const p = sse(`/events?session=${sid}`, { ...H, "last-event-id": "0" }, (_id, d) => {
      got.push(d);
      return got.filter((x) => x.type === "text_delta").length >= 6;
    });
    await p;
    const ns = got.filter((x) => x.type === "text_delta").map((x) => x.n);
    // Frames 4–6 were emitted while the proxy was down. The fake sidecar does
    // not buffer (neither does the real one), so those are the ones a proxy
    // restart can never recover; everything else must be there, in order.
    expect(ns).toEqual([1, 2, 3, 7, 8, 9]);
    expect(got.filter((x) => x.type === "ready").length).toBeGreaterThanOrEqual(2);
    // A full host stop + start plus four fixed sleeps: ~300 ms here, but a
    // loaded Windows CI runner has crossed vitest's default 5 s once. The
    // stop() latency assertion above is the real guard; this is headroom.
  }, 15_000);

  it("stop() waits for queued ring writes, so a slow disk cannot leave a frame in flight", async () => {
    // Windows CI: appendFile still held the ring file when the next host's
    // load() read it, and that read never returned (15 s timeout). Give this
    // host a ring store whose writes take 300 ms and pin that stop() does not
    // resolve ahead of them.
    await host.stop();
    let landed = 0;
    const slowRings = createRingStore({ directory: join(home, "rings"), maxFrames: 50 });
    const slowWrites: Promise<void>[] = [];
    const wrappedRings = new Map<string, SessionRing>();
    const wrapped: RingStore = {
      loaded: () => [...wrappedRings.values()],
      async session(id) {
        const have = wrappedRings.get(id);
        if (have) return have;
        const ring = await slowRings.session(id);
        const w: SessionRing = {
          ...ring,
          push: (raw) => {
            const f = ring.push(raw);
            // The real store queues the append; model a disk that takes 300 ms.
            slowWrites.push(new Promise((r) => setTimeout(() => ((landed += 1), r()), 300)));
            return f;
          },
          flush: async () => {
            await ring.flush();
            await Promise.all(slowWrites);
          },
        };
        wrappedRings.set(id, w);
        return w;
      },
    };
    host = await startHost({ rings: wrapped });
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const created = await call("POST", "/session", { headers: H, body: { mode: "chat" } });
    const sid = created.body.sessionId as string;
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 1; i <= 3; i += 1)
      sidecar.emit(sid, `data: ${JSON.stringify({ type: "text_delta", n: i })}`);
    await new Promise((r) => setTimeout(r, 30));
    expect(landed).toBe(0);
    expect(slowWrites.length).toBeGreaterThanOrEqual(3); // ready + 3 deltas
    await host.stop();
    expect(landed).toBe(slowWrites.length);
    host = await startHost();
  });
});

describe("host: routine sessions (created by the sidecar, never through the proxy)", () => {
  it("learns of a routine's session from GET /routines and records its frames for replay", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    // The sidecar fired a routine into a session of its own making.
    sidecar.routineSessions["rtn-1"] = "routine-session-A";
    // Nobody is attached. Wait for the poll, then emit while still unattached.
    await new Promise((r) => setTimeout(r, 500));
    for (const n of [1, 2, 3])
      sidecar.emit("routine-session-A", `data: ${JSON.stringify({ type: "text_delta", n })}`);
    await new Promise((r) => setTimeout(r, 100));
    // A device that attaches later, from the beginning, gets the whole thing.
    const got: any[] = [];
    await sse(`/events?session=routine-session-A`, { ...H, "last-event-id": "0" }, (_id, d) => {
      got.push(d);
      return got.filter((x) => x.type === "text_delta").length >= 3;
    });
    expect(got.filter((x) => x.type === "text_delta").map((x) => x.n)).toEqual([1, 2, 3]);
    // Persisted: a restarted host re-subscribes without asking the sidecar again.
    expect(JSON.parse(readFileSync(join(home, "sessions.json"), "utf8"))).toContain(
      "routine-session-A",
    );
  });

  it("a poll still in flight when the host stops does nothing once it lands — the next host owns the sessions", async () => {
    // Windows CI: the poll start() kicks off answered AFTER stop(); the dead
    // host then tracked the routine session and opened an upstream into its
    // closed server, racing the live host for the same session.
    sidecar.routinesDelayMs = 300;
    sidecar.routineSessions["rtn-late"] = "routine-session-C";
    const dead = host;
    await host.stop(); // its start-time poll is still waiting on the sidecar
    host = await startHost(); // new host: its own poll also sees rtn-late
    await new Promise((r) => setTimeout(r, 600)); // both polls have landed
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    sidecar.emit("routine-session-C", `data: ${JSON.stringify({ type: "text_delta", n: 1 })}`);
    await new Promise((r) => setTimeout(r, 100));
    // Exactly one upstream tap on the session: the live host's.
    const taps = sidecar.seen.filter((r) => r.url.includes("routine-session-C"));
    expect(taps).toHaveLength(1);
    const got: any[] = [];
    await sse(`/events?session=routine-session-C`, { ...H, "last-event-id": "0" }, (_id, d) => {
      got.push(d);
      return d.type === "text_delta";
    });
    expect(got.filter((x) => x.type === "text_delta").map((x) => x.n)).toEqual([1]);
    void dead;
  });

  it("wakes right after a routine that is due before the next poll, so the first frames are not missed", async () => {
    // Poll is 200 ms in tests; the routine is due in 60 ms. Its session must be
    // tracked well before the next scheduled poll.
    sidecar.routines.push({ id: "rtn-soon", nextRunAt: Date.now() + 60 });
    await new Promise((r) => setTimeout(r, 250)); // one poll: sees "due soon", arms the wake
    sidecar.routineSessions["rtn-soon"] = "routine-session-B";
    // Wake fires at ~due+250ms from the poll that saw it; the next regular poll
    // is at +200ms anyway. Either way, well under a second.
    const trackedNow = (): string[] => {
      try {
        return JSON.parse(readFileSync(join(home, "sessions.json"), "utf8")) as string[];
      } catch {
        return [];
      }
    };
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && !trackedNow().includes("routine-session-B"))
      await new Promise((r) => setTimeout(r, 20));
    expect(trackedNow()).toContain("routine-session-B");
  });
});

describe("host: APNs nudge", () => {
  it("a device registers its own push token; the nudge fires on run_end only when nobody is attached", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };

    // Registration is self-service and validated.
    expect(
      (await call("POST", "/kleio/push", { headers: P, body: { token: "not hex" } })).status,
    ).toBe(400);
    const r = await call("POST", "/kleio/push", {
      headers: P,
      body: { token: "AB".repeat(16), env: "sandbox" },
    });
    expect(r.status).toBe(200);
    expect((r.body.device as { push: { token: string; env: string } }).push).toMatchObject({
      token: "ab".repeat(16),
      env: "sandbox",
    });
    // Only the phone's own record changed; the token is on the encrypted store, not exposed to admins' device list beyond the shape.
    expect(registry.get(phone.value.device.deviceId)?.push?.token).toBe("ab".repeat(16));
    expect(registry.get(admin.deviceId)?.push).toBeNull();

    // A session the sidecar streams into with nobody attached.
    const created = await call("POST", "/session", { headers: A, body: { mode: "code" } });
    const sid = created.body.sessionId as string;
    await new Promise((r) => setTimeout(r, 50));
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "text_delta", n: 1 })}`);
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "run_end", runState: "idle" })}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(nudges).toEqual([{ sessionId: sid, devices: ["Phone"] }]);

    // Someone watching: no nudge.
    const got: any[] = [];
    const stream = sse(`/events?session=${sid}`, A, (_id, d) => {
      got.push(d);
    });
    await new Promise((r) => setTimeout(r, 50));
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "run_end", runState: "idle" })}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(nudges).toHaveLength(1);
    stream.close();

    // Clearing the registration stops nudges to that phone.
    expect((await call("POST", "/kleio/push", { headers: P, body: { token: null } })).status).toBe(
      200,
    );
    expect(registry.get(phone.value.device.deviceId)?.push).toBeNull();
  });
});

describe("host: device diagnostics", () => {
  it("appends a device's crash report as one stamped line; rejects non-objects and oversize", async () => {
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    expect(
      (
        await call("POST", "/kleio/diagnostics", {
          headers: P,
          body: { kind: "crash", stack: "0x1" },
        })
      ).status,
    ).toBe(200);
    expect((await call("POST", "/kleio/diagnostics", { headers: P, body: [1, 2] })).status).toBe(
      400,
    );
    expect(
      (await call("POST", "/kleio/diagnostics", { headers: P, body: { pad: "x".repeat(70_000) } }))
        .status,
    ).toBe(413);
    // Unauthenticated: never written.
    expect((await call("POST", "/kleio/diagnostics", { body: { kind: "crash" } })).status).toBe(
      401,
    );
    const lines = readFileSync(join(home, "logs", "diagnostics.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      label: "Phone",
      report: { kind: "crash", stack: "0x1" },
    });
  });
});

describe("host: sidecar lifecycle", () => {
  it("follows the sidecar to a new port after a respawn without a host restart", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    expect((await call("GET", "/state", { headers: H })).status).toBe(200);
    const old = sidecar;
    await old.close();
    sidecar = await fakeSidecar();
    publishEndpoint(sidecar);
    const r = await call("GET", "/state", { headers: H });
    expect(r.status).toBe(200);
    expect(sidecar.seen.some((s) => s.url === "/state")).toBe(true);
  });

  it("health probes the sidecar: a stale endpoint file reports 'stale', not 'up'", async () => {
    expect((await call("GET", "/kleio/health")).body.sidecar).toBe("up");
    await sidecar.close();
    expect((await call("GET", "/kleio/health")).body.sidecar).toBe("stale");
    sidecar = await fakeSidecar(); // afterEach closes it
  });

  it("reports 503 when no sidecar endpoint is published", async () => {
    const admin = await pairAdmin();
    rmSync(join(home, "sidecar.json"));
    await host.stop();
    host = await startHost();
    expect(
      (await call("GET", "/state", { headers: { [DEVICE_TOKEN_HEADER]: admin.token } })).status,
    ).toBe(503);
  });
});
