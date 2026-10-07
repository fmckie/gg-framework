import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, CONTROL_HEADER, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import type { ApnsPusher } from "../src/apns.js";
import { newRedemptionNonce, type PairingPayload } from "../src/pair-code.js";
import { createPairOfferStore, type PairOfferStore } from "../src/pair-offer.js";
import { createRingStore, type RingStore, type SessionRing } from "../src/sse-ring.js";
import * as macaroon from "../src/macaroon.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

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
/** Each nudge's title and body, by session. */
const nudgeText = new Map<string, { title?: string; body?: string }>();
const livePushes: {
  token: string;
  event: string;
  line: unknown;
  priority: number;
  alert?: unknown;
  attributes?: unknown;
  /** What the phone gets, e.g. a question's one-off key. */
  state: Record<string, unknown>;
}[] = [];
const fakeApns: ApnsPusher = {
  configured: true,
  async notify(nudge, devices) {
    const targets = devices.filter((d) => d.push && !d.revoked).map((d) => d.label);
    nudges.push({ sessionId: nudge.sessionId, devices: targets });
    if (nudge.sessionId) nudgeText.set(nudge.sessionId, { title: nudge.title, body: nudge.body });
    return targets.length;
  },
  async liveActivity(target, push) {
    livePushes.push({
      token: target.token,
      event: push.event,
      line: push.contentState.line,
      priority: push.priority,
      ...(push.alert ? { alert: push.alert } : {}),
      ...(push.attributes ? { attributes: push.attributes } : {}),
      state: { ...push.contentState },
    });
    return "ok";
  },
};

async function startHost(
  overrides: {
    rings?: RingStore;
    create?: typeof createHost;
    workspaceRoots?: () => Promise<string[]>;
  } = {},
): Promise<Host> {
  const h = (overrides.create ?? createHost)({
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
    homeCwd: join(home, "Kleio"),
    ...(overrides.workspaceRoots ? { workspaceRoots: overrides.workspaceRoots } : {}),
  });
  await h.start();
  hostPort = (h.server.address() as { port: number }).port;
  return h;
}

beforeEach(async () => {
  nudges.length = 0;
  nudgeText.clear();
  livePushes.length = 0;
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
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ accepted: true, echoed: { text: "hi" } });
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

describe("host: slow disk (Windows runners)", () => {
  /**
   * A copy of the host (and its device-registry/atomicWrite) whose every disk
   * write takes `ms` — a Windows runner scanning each new file. Rings are the
   * harness's own and stay fast.
   */
  async function slowModules(ms: number) {
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const real = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...real,
        writeFile: async (...args: Parameters<typeof real.writeFile>) => {
          await new Promise((r) => setTimeout(r, ms));
          return real.writeFile(...args);
        },
      };
    });
    const hostMod = await import("../src/host.js");
    const regMod = await import("../src/device-registry.js");
    vi.doUnmock("node:fs/promises");
    return { createHost: hostMod.createHost, createDeviceRegistry: regMod.createDeviceRegistry };
  }

  it("records a new session's first frames even when saving it to disk is slow, and keeps it across a restart", async () => {
    // Seen three times on windows-latest as a 15 s hang: the host waited for
    // the sessions.json write before tapping the session's stream, so frames
    // sent in the meantime were lost; and a restart before that write landed
    // forgot the session.
    const slow = await slowModules(300);
    await host.stop();
    host = await startHost({ create: slow.createHost });
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };

    const created = await call("POST", "/session", { headers: H, body: { mode: "chat" } });
    const sid = created.body.sessionId as string;
    // The reply waits for the save, so the session survives this restart.
    expect(JSON.parse(readFileSync(join(home, "sessions.json"), "utf8"))).toContain(sid);
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "text_delta", n: 1 })}`);
    await new Promise((r) => setTimeout(r, 50));
    await host.stop();
    host = await startHost({ create: slow.createHost });
    await new Promise((r) => setTimeout(r, 100));
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "text_delta", n: 2 })}`);
    await new Promise((r) => setTimeout(r, 50));

    const got: any[] = [];
    await sse(`/events?session=${sid}`, { ...H, "last-event-id": "0" }, (_id, d) => {
      got.push(d);
      return got.filter((x) => x.type === "text_delta").length >= 2;
    });
    expect(got.filter((x) => x.type === "text_delta").map((x) => x.n)).toEqual([1, 2]);
  }, 15_000);

  it("stop() waits for a lastSeen write it started, so nothing is still writing after it returns", async () => {
    // Seen on ubuntu-latest: ENOTEMPTY removing secure/ after stop(), because
    // a request's fire-and-forget lastSeen write was still creating its temp
    // file.
    const slow = await slowModules(300);
    await host.stop();
    registry = slow.createDeviceRegistry({
      keychain: createFileKeychain({ keyPath: join(home, "secure", "headless-master.key") }),
      storePath: join(home, "secure", "device-registry.json"),
    });
    await registry.init();
    host = await startHost({ create: slow.createHost });
    const admin = await pairAdmin();
    // An authenticated request triggers the (slow) lastSeen write…
    expect(
      (await call("GET", "/kleio/devices", { headers: { [DEVICE_TOKEN_HEADER]: admin.token } }))
        .status,
    ).toBe(200);
    // …and stop() does not return until it has landed.
    await host.stop();
    expect(readdirSync(join(home, "secure")).filter((f) => f.includes(".tmp"))).toEqual([]);
    const saved = JSON.parse(readFileSync(join(home, "secure", "device-registry.json"), "utf8"));
    expect(
      saved.devices.find((d: { deviceId: string }) => d.deviceId === admin.deviceId).lastSeen,
    ).toBeTruthy();
    host = await startHost();
  }, 15_000);
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

describe("host: Live Activity", () => {
  const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it("a device registers its activity token per session or group; bad input is refused; unauthenticated never", async () => {
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    const ok = { sessionId: "sess-1", token: "EF".repeat(32), env: "sandbox" };
    const post = async (body: unknown, headers: Record<string, string> = P): Promise<number> =>
      (await call("POST", "/kleio/live-activity", { headers, body })).status;
    expect(await post(ok, {})).toBe(401);
    expect(await post({ ...ok, sessionId: "solver:1" })).toBe(400);
    expect(await post({ ...ok, token: "not-hex" })).toBe(400);
    expect(await post({ token: ok.token })).toBe(400); // no target
    expect(await post({ ...ok, groupId: "g_0123abcd" })).toBe(400); // both
    expect(await post({ groupId: "g_XYZ", token: ok.token })).toBe(400);
    expect(await post(ok)).toBe(200);
    expect(await post({ groupId: "g_0123abcd", token: ok.token, env: "sandbox" })).toBe(200);
    expect(await post({ sessionId: "sess-1", token: null })).toBe(200);
    expect(await post({ groupId: "g_0123abcd", token: null })).toBe(200);
  });

  it("a session's run drives the activity: catch-up on register, paced steps, an immediate end", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    const created = await call("POST", "/session", { headers: A, body: { mode: "code" } });
    const sid = created.body.sessionId as string;
    await tick(50);
    const emit = (type: string, data: Record<string, unknown> = {}): void =>
      sidecar.emit(sid, `data: ${JSON.stringify({ type, data })}`);
    emit("run_start", { text: "go" });
    await tick();
    expect(livePushes).toHaveLength(0); // nothing registered yet
    const token = "ef".repeat(32);
    await call("POST", "/kleio/live-activity", {
      headers: P,
      body: { sessionId: sid, token, env: "sandbox" },
    });
    await tick(20);
    expect(livePushes.map((p) => `${p.event}:${String(p.line)}:${p.priority}`)).toEqual([
      "update:Thinking…:10",
    ]);
    // An attached app changes nothing: the host is the single source of truth.
    const stream = sse(`/events?session=${sid}`, A, () => false);
    await tick(50);
    emit("text_delta", { text: "streaming…" });
    emit("tool_call_start", { toolCallId: "c1", name: "bash" }); // inside the 5 s window
    emit("ask_user", { id: "q1", questions: [{ question: "Ship it?" }] });
    emit("ask_user_done", { id: "q1" });
    emit("agent_done", { totalTurns: 1 }); // the run goes on: not the end
    emit("run_end", { failed: false });
    await tick(100);
    stream.close();
    expect(livePushes.map((p) => `${p.event}:${String(p.line)}:${p.priority}`)).toEqual([
      "update:Thinking…:10",
      "update:Needs your help:10",
      "update:Back to work:10",
      "end:Done:10",
    ]);
    expect(livePushes.every((p) => p.token === token)).toBe(true);
    // The token is spent.
    emit("run_start");
    await tick(50);
    expect(livePushes).toHaveLength(4);
  });

  it("a lock-screen button answers the question with the key it was given, once", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    const created = await call("POST", "/session", { headers: A, body: { mode: "code" } });
    const sid = created.body.sessionId as string;
    await tick(50);
    await call("POST", "/kleio/live-activity", {
      headers: P,
      body: { sessionId: sid, token: "cd".repeat(32), env: "sandbox" },
    });
    const emit = (type: string, data: Record<string, unknown> = {}): void =>
      sidecar.emit(sid, `data: ${JSON.stringify({ type, data })}`);
    emit("run_start");
    emit("ask_user", {
      id: "ask-3",
      questions: [
        { id: "f", question: "Which?", kind: "choice", options: [{ label: "a" }, { label: "b" }] },
      ],
    });
    await tick(50);
    const asked = livePushes.find((p) => p.state.phase === "needsYou");
    const key = String(asked?.state.askKey);
    expect(asked?.state.options).toEqual(["a", "b"]);

    const answer = (body: Record<string, unknown>, headers = P): Promise<{ status: number }> =>
      call("POST", "/kleio/live-activity/answer", { headers, body });
    const right = { sessionId: sid, askId: "ask-3", key, choice: 1 };
    expect((await answer(right, {})).status).toBe(401);
    expect((await answer({ ...right, key: "0".repeat(32) })).status).toBe(409);
    expect((await answer({ ...right, key: "not-hex" })).status).toBe(400);
    expect(sidecar.asks).toHaveLength(0);
    expect((await answer(right)).status).toBe(200);
    expect(sidecar.asks).toEqual([
      { id: "ask-3", session: sid, body: { action: "answer", answers: { f: "b" } } },
    ]);
    // The key is spent.
    expect((await answer(right)).status).toBe(409);
    expect(sidecar.asks).toHaveLength(1);
  });

  it("persists a device's push-to-start token; revoking the device drops it", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    const id = phone.value.device.deviceId;
    const post = async (body: unknown, headers: Record<string, string> = P): Promise<number> =>
      (await call("POST", "/kleio/live-activity/start-token", { headers, body })).status;
    expect(await post({ token: "ab".repeat(32) }, {})).toBe(401);
    expect(await post({ token: "zz" })).toBe(400);
    expect(await post({ token: "AB".repeat(32), env: "production" })).toBe(200);
    expect(registry.get(id)?.liveStart).toMatchObject({
      token: "ab".repeat(32),
      env: "production",
    });
    expect(await post({ token: null })).toBe(200);
    expect(registry.get(id)?.liveStart).toBeNull();
    expect(await post({ token: "ab".repeat(32), env: "sandbox" })).toBe(200);
    const rev = await call("POST", `/kleio/devices/${id}/revoke`, {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token },
    });
    expect(rev.status).toBe(200);
    expect(registry.get(id)?.liveStart).toBeNull();
  });

  it("an ask with no activity and no start token falls back to the plain notification", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    await call("POST", "/kleio/push", {
      headers: P,
      body: { token: "ab".repeat(16), env: "sandbox" },
    });
    const created = await call("POST", "/session", {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token },
      body: { mode: "code" },
    });
    const sid = created.body.sessionId as string;
    await tick(50);
    sidecar.emit(
      sid,
      `data: ${JSON.stringify({ type: "ask_user", data: { id: "q1", questions: [{ question: "Ship it?" }] } })}`,
    );
    await tick(80);
    expect(livePushes).toHaveLength(0);
    expect(nudges).toEqual([{ sessionId: sid, devices: ["Phone"] }]);
  });

  it("an ask uses the live alert (push-to-start) when it can, and then sends no plain notification", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    await call("POST", "/kleio/push", {
      headers: P,
      body: { token: "ab".repeat(16), env: "sandbox" },
    });
    await call("POST", "/kleio/live-activity/start-token", {
      headers: P,
      body: { token: "cd".repeat(32), env: "sandbox" },
    });
    const created = await call("POST", "/session", {
      headers: { [DEVICE_TOKEN_HEADER]: admin.token },
      body: { mode: "code", cwd: "/Users/x/projects/my-app" },
    });
    const sid = created.body.sessionId as string;
    await tick(50);
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "run_start", data: {} })}`);
    sidecar.emit(
      sid,
      `data: ${JSON.stringify({ type: "ask_user", data: { id: "q1", questions: [{ question: "Ship it?" }] } })}`,
    );
    await tick(80);
    expect(nudges).toHaveLength(0);
    expect(livePushes).toHaveLength(1);
    expect(livePushes[0]).toMatchObject({
      token: "cd".repeat(32),
      event: "start",
      line: "Needs your help",
      priority: 10,
      alert: { title: "Needs your help", body: "Ship it?", sound: "default" },
      attributes: { kind: "code", title: "my-app", sessionId: sid },
    });
  });
});

describe("host: Brief me (POST /kleio/brief)", () => {
  const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it("says what's working and what failed, once; any paired device; never unauthenticated", async () => {
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    expect((await call("POST", "/kleio/brief", { body: {} })).status).toBe(401);
    expect((await call("POST", "/kleio/brief", { headers: P, body: [] })).status).toBe(200);

    const created = await call("POST", "/session", {
      headers: A,
      body: { mode: "code", cwd: "/Users/me/projects/gg-framework" },
    });
    const sid = created.body.sessionId as string;
    await tick(50);
    const emit = (type: string, data: Record<string, unknown> = {}): void =>
      sidecar.emit(sid, `data: ${JSON.stringify({ type, data })}`);
    emit("run_start", { text: "go" });
    emit("tool_call_start", { toolCallId: "c1", name: "bash" });
    await tick();
    let b = await call("POST", "/kleio/brief", { headers: P, body: {} });
    expect(b.status).toBe(200);
    expect(b.body.spoken).toBe(
      "Nothing needs you right now. Code in gg-framework is working. Running a command.",
    );

    emit("error", { message: "429", headline: "Claude usage limit reached." });
    emit("run_end", { failed: true });
    await tick();
    // Asked again straight after: the same news, plus the failure.
    b = await call("POST", "/kleio/brief", { headers: A, body: {} });
    expect(b.body.spoken).toBe(
      "Nothing needs you right now. Code in gg-framework failed. Claude usage limit reached.",
    );
    expect(b.body.items).toMatchObject([
      { kind: "code", name: "Code in gg-framework", phase: "failed" },
    ]);
  });
});

describe("host: Talk to Kleio (/kleio/voice)", () => {
  const KEY = "sk-test-voice-key";
  const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
  const ANSWER = "v=0\r\no=openai 3 4 IN IP4 10.0.0.1\r\n";

  /** The host again, talking to a fake OpenAI instead of the real one. */
  async function hostWithFakeOpenAI(): Promise<{ sessions: unknown[] }> {
    const sessions: unknown[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/live/sessions")) {
        sessions.push((JSON.parse(String(init?.body)) as { session: unknown }).session);
        const answer = { session: { id: "sess_1" }, transport: { type: "webrtc", sdp: ANSWER } };
        return new Response(JSON.stringify(answer), { status: 200 });
      }
      return new Response("{}", { status: 200 }); // the key check
    }) as typeof fetch;
    await host.stop();
    host = await startHost({
      create: (o) => createHost({ ...o, voice: { fetch: fakeFetch } }),
    });
    return { sessions };
  }

  /** A raw SDP body (call() sends JSON). */
  function postSdp(path: string, sdp: string, headers: Record<string, string>): Promise<Res> {
    return new Promise((resolve, reject) => {
      const data = Buffer.from(sdp);
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: hostPort,
          method: "POST",
          path,
          headers: { "content-type": "application/sdp", "content-length": data.length, ...headers },
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
      req.write(data);
      req.end();
    });
  }

  it("only an admin sets the key; any paired device then talks; the key never leaves", async () => {
    const { sessions } = await hostWithFakeOpenAI();
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };

    expect((await call("GET", "/kleio/voice")).status).toBe(401);
    expect((await call("GET", "/kleio/voice", { headers: P })).body).toMatchObject({
      ready: false,
      voice: "marin",
    });
    expect((await postSdp("/kleio/voice/call", OFFER, P)).body).toEqual({ error: "no_key" });

    const denied = await call("POST", "/kleio/voice/key", { headers: P, body: { key: KEY } });
    expect(denied.status).toBe(403);
    const saved = await call("POST", "/kleio/voice/key", { headers: A, body: { key: KEY } });
    expect(saved.status).toBe(200);
    expect(saved.body.ready).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain(KEY);

    const voiced = await call("POST", "/kleio/voice/settings", {
      headers: A,
      body: { voice: "cedar" },
    });
    expect(voiced.body.voice).toBe("cedar");
    expect(
      (await call("POST", "/kleio/voice/settings", { headers: A, body: { voice: "nope" } })).status,
    ).toBe(400);

    expect((await postSdp("/kleio/voice/call", "not sdp", P)).status).toBe(400);
    const answered = await postSdp("/kleio/voice/call", OFFER, P);
    expect(answered.status).toBe(201);
    expect(answered.headers["content-type"]).toBe("application/sdp");
    expect(answered.body).toBe(ANSWER);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      audio: { output: { voice: "cedar" } },
      instructions: expect.stringContaining("All quiet."),
    });
    // An app that still says which microphone it has is fine: GPT-Live handles the room itself.
    expect((await postSdp("/kleio/voice/call?mic=far", OFFER, P)).status).toBe(201);
    expect(sessions).toHaveLength(2);
  });

  it("brings the Brain into her call, and runs only its tools, for any paired device", async () => {
    const { sessions } = await hostWithFakeOpenAI();
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    await call("POST", "/kleio/voice/key", { headers: A, body: { key: KEY } });

    // The sidecar is down: she still talks, and doesn't claim to remember.
    expect((await postSdp("/kleio/voice/call", OFFER, P)).status).toBe(201);
    expect(sessions[0]).toMatchObject({
      instructions: expect.stringMatching(/memory isn't available/),
    });

    sidecar.brain = {
      prompt: "# Durable memory\n- [m1] (importance 4) Has a dog called Biscuit.",
      tools: [
        { name: "remember", description: "Save a fact.", parameters: { type: "object" } },
        { name: "bash", description: "Run a command.", parameters: { type: "object" } },
      ],
    };
    expect((await postSdp("/kleio/voice/call", OFFER, P)).status).toBe(201);
    const session = sessions[1] as {
      instructions: string;
      delegation: { responses: { tools: { name: string }[] } };
    };
    expect(session.instructions).toContain("Has a dog called Biscuit.");
    const tools = session.delegation.responses.tools.map((t) => t.name);
    expect(tools).toContain("remember");
    expect(tools).not.toContain("bash");

    const saved = await call("POST", "/kleio/voice/brain", {
      headers: P,
      body: { name: "remember", args: { content: "Prefers tea.", category: "preference" } },
    });
    expect(saved.body).toEqual({ result: "Remembered as m2. 2 memories stored." });
    expect(sidecar.brainCalls).toEqual([
      { name: "remember", args: { content: "Prefers tea.", category: "preference" } },
    ]);
    // The Brain's own refusal reaches her as words, not a failure.
    const refused = await call("POST", "/kleio/voice/brain", {
      headers: P,
      body: { name: "forget", args: { id: "m9" } },
    });
    expect(refused).toMatchObject({ status: 200, body: { error: "Memory not found: m9" } });
    // Nothing but the Brain's tools, and never without a paired device.
    const bash = await call("POST", "/kleio/voice/brain", {
      headers: P,
      body: { name: "bash", args: { command: "ls" } },
    });
    expect(bash.status).toBe(400);
    expect(
      (await call("POST", "/kleio/voice/brain", { body: { name: "remember", args: {} } })).status,
    ).toBe(401);
    expect(sidecar.brainCalls).toHaveLength(2);
  });

  it("only an admin changes her pace, within OpenAI's range", async () => {
    await hostWithFakeOpenAI();
    const admin = await pairAdmin();
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token };
    expect((await call("GET", "/kleio/voice", { headers: P })).body.speed).toBe(1.15);
    const faster = await call("POST", "/kleio/voice/settings", {
      headers: A,
      body: { speed: 1.3 },
    });
    expect(faster.body).toMatchObject({ speed: 1.3, voice: "marin" });
    expect(
      (await call("POST", "/kleio/voice/settings", { headers: P, body: { speed: 1.5 } })).status,
    ).toBe(403);
    expect(
      (await call("POST", "/kleio/voice/settings", { headers: A, body: { speed: 2 } })).status,
    ).toBe(400);
    expect((await call("POST", "/kleio/voice/settings", { headers: A, body: {} })).status).toBe(
      400,
    );
  });

  it("her opening summary doesn't use up the user's next briefing", async () => {
    await hostWithFakeOpenAI();
    const admin = await pairAdmin();
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    await call("POST", "/kleio/voice/key", { headers: A, body: { key: KEY } });
    const created = await call("POST", "/session", {
      headers: A,
      body: { mode: "code", cwd: "/Users/me/projects/api" },
    });
    const sid = created.body.sessionId as string;
    await new Promise((r) => setTimeout(r, 50));
    const emit = (type: string, data: Record<string, unknown> = {}): void =>
      sidecar.emit(sid, `data: ${JSON.stringify({ type, data })}`);
    emit("run_start", { text: "go" });
    emit("error", { message: "x", headline: "Claude usage limit reached." });
    emit("run_end", { failed: true });
    await new Promise((r) => setTimeout(r, 60));

    expect((await postSdp("/kleio/voice/call", OFFER, A)).status).toBe(201);
    const b = await call("POST", "/kleio/brief", { headers: A, body: {} });
    expect(b.body.spoken).toContain("Code in api failed.");
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

describe("host: home thread (GET /kleio/home)", () => {
  const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const homeJson = (): any => JSON.parse(readFileSync(join(home, "home.json"), "utf8"));
  /** Poll for work the host does in the background (slow CI runners outlast a fixed pause). */
  const until = async (check: () => boolean, ms = 5000): Promise<void> => {
    const t = Date.now();
    while (!check()) {
      if (Date.now() - t > ms) throw new Error("timed out waiting");
      await settle(20);
    }
  };
  /** Wait until home.json records `path`; the host writes it at run end. */
  const recorded = async (path: string): Promise<void> => {
    await until(() => {
      try {
        return homeJson().sessionPath === path;
      } catch {
        return false;
      }
    });
    expect(homeJson().sessionPath).toBe(path);
  };
  const posts = (sc: FakeSidecar): number =>
    sc.seen.filter((s) => s.method === "POST" && s.url === "/session").length;
  const runEnd = (sid: string): void =>
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "run_end", runState: "idle" })}`);

  /** A transcript file on disk, so a resume is attempted rather than skipped. */
  function transcript(name: string): string {
    mkdirSync(join(home, "transcripts"), { recursive: true });
    const p = join(home, "transcripts", name);
    writeFileSync(p, "{}\n");
    return p;
  }

  async function restartSidecarAndHost(): Promise<void> {
    await host.stop();
    await sidecar.close();
    // home.json alone must be enough to tap the stored id again.
    rmSync(join(home, "sessions.json"), { force: true });
    sidecar = await fakeSidecar();
    publishEndpoint(sidecar);
    host = await startHost();
  }

  it("the first call creates a general chat session in homeCwd; the next returns it", async () => {
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token }; // not admin

    const first = await call("GET", "/kleio/home", { headers: P });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      sessionId: expect.stringMatching(/^created-/),
      sessionPath: null,
      created: true,
      agent: "general",
    });
    expect(sidecar.creates).toEqual([
      { mode: "chat", chatAgent: "general", cwd: join(home, "Kleio") },
    ]);
    expect(readdirSync(home)).toContain("Kleio");
    expect(homeJson()).toMatchObject({ sessionId: first.body.sessionId, sessionPath: null });

    const second = await call("GET", "/kleio/home", { headers: P });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ...first.body, created: false });
    expect(posts(sidecar)).toBe(1);
  });

  it("two devices opening at once share one session", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const [a, b] = await Promise.all([
      call("GET", "/kleio/home", { headers: H }),
      call("GET", "/kleio/home", { headers: H }),
    ]);
    expect(a.status).toBe(200);
    expect(b.body.sessionId).toBe(a.body.sessionId);
    expect(posts(sidecar)).toBe(1);
  });

  it("needs a device token; health never shows the home id", async () => {
    expect((await call("GET", "/kleio/home")).status).toBe(401);
    expect(
      (await call("GET", "/kleio/home", { headers: { [DEVICE_TOKEN_HEADER]: "nope" } })).status,
    ).toBe(401);
    expect(posts(sidecar)).toBe(0);

    const admin = await pairAdmin();
    const sid = (
      await call("GET", "/kleio/home", { headers: { [DEVICE_TOKEN_HEADER]: admin.token } })
    ).body.sessionId as string;
    await settle(); // the home session's upstream is live, so it is in `live`
    const health = await call("GET", "/kleio/health");
    expect(health.status).toBe(200);
    expect(JSON.stringify(health.body)).not.toContain(sid);
  });

  it("learns the transcript path at run end, follows compaction, never forgets it", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const sid = (await call("GET", "/kleio/home", { headers: H })).body.sessionId as string;
    await settle();

    // First message written: the path exists now; learnt with nobody attached.
    sidecar.sessions.set(sid, "/t/first.jsonl");
    runEnd(sid);
    await recorded("/t/first.jsonl");
    expect((await call("GET", "/kleio/home", { headers: H })).body.sessionPath).toBe(
      "/t/first.jsonl",
    );

    // Compaction moved it, while a device is watching (the APNs nudge is
    // gated on nobody watching; this must not be).
    const stream = sse(`/events?session=${sid}`, H, () => {});
    await settle();
    sidecar.sessions.set(sid, "/t/compacted.jsonl");
    runEnd(sid);
    await recorded("/t/compacted.jsonl");
    stream.close();

    // An empty answer never replaces a known path.
    sidecar.sessions.set(sid, "");
    runEnd(sid);
    await settle();
    expect(homeJson().sessionPath).toBe("/t/compacted.jsonl");
  });

  it("after a sidecar and host restart, resumes the stored transcript under a new id", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const path = transcript("home.jsonl");
    const old = (await call("GET", "/kleio/home", { headers: H })).body.sessionId as string;
    await settle();
    sidecar.sessions.set(old, path);
    runEnd(old);
    await recorded(path);

    await restartSidecarAndHost();
    // On start the stored id is tapped at once, with no device attached.
    await until(() => sidecar.seen.some((s) => s.url === `/events?session=${old}`));

    const r = await call("GET", "/kleio/home", { headers: H });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sessionPath: path, created: true, agent: "general" });
    expect(r.body.sessionId).not.toBe(old);
    expect(sidecar.creates).toEqual([
      { mode: "chat", chatAgent: "general", cwd: join(home, "Kleio"), sessionPath: path },
    ]);
    expect(homeJson()).toMatchObject({ sessionId: r.body.sessionId, sessionPath: path });
  });

  it("a transcript the sidecar refuses costs one fresh session, not a loop", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    const path = transcript("broken.jsonl");
    const old = (await call("GET", "/kleio/home", { headers: H })).body.sessionId as string;
    await settle();
    sidecar.sessions.set(old, path);
    runEnd(old);
    await recorded(path);

    await restartSidecarAndHost();
    sidecar.failResume = true;
    const r = await call("GET", "/kleio/home", { headers: H });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sessionPath: null, created: true });
    expect(sidecar.creates.map((b) => b.sessionPath)).toEqual([path, undefined]);
    expect(homeJson()).toMatchObject({ sessionId: r.body.sessionId, sessionPath: null });
    // Settled: the next call finds the new session alive.
    expect((await call("GET", "/kleio/home", { headers: H })).body.created).toBe(false);
    expect(posts(sidecar)).toBe(2);
  });

  it("POST /kleio/home/new starts a fresh conversation every device then opens", async () => {
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    const P = { [DEVICE_TOKEN_HEADER]: phone.value.token }; // not admin
    const path = transcript("old.jsonl");
    const old = (await call("GET", "/kleio/home", { headers: P })).body.sessionId as string;
    await settle();
    sidecar.sessions.set(old, path);
    runEnd(old);
    // Recorded first, so "not resumed" below is about /kleio/home/new.
    await recorded(path);

    const fresh = await call("POST", "/kleio/home/new", { headers: P });
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({
      sessionId: expect.stringMatching(/^created-/),
      sessionPath: null,
      created: true,
      agent: "general",
    });
    expect(fresh.body.sessionId).not.toBe(old);
    // Brand new: the old transcript is NOT resumed.
    expect(sidecar.creates.at(-1)).toEqual({
      mode: "chat",
      chatAgent: "general",
      cwd: join(home, "Kleio"),
    });
    expect(homeJson()).toMatchObject({ sessionId: fresh.body.sessionId, sessionPath: null });
    const tracked = JSON.parse(readFileSync(join(home, "sessions.json"), "utf8")) as string[];
    expect(tracked).toContain(fresh.body.sessionId);
    expect(tracked).not.toContain(old);

    // Every device now gets the new one.
    const next = await call("GET", "/kleio/home", { headers: P });
    expect(next.body).toMatchObject({ sessionId: fresh.body.sessionId, created: false });
    expect(posts(sidecar)).toBe(2);
  });

  it("two taps at once make one new conversation; needs a token", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    await call("GET", "/kleio/home", { headers: H });
    const [a, b, c] = await Promise.all([
      call("POST", "/kleio/home/new", { headers: H }),
      call("POST", "/kleio/home/new", { headers: H }),
      call("GET", "/kleio/home", { headers: H }),
    ]);
    expect(a.status).toBe(200);
    expect(b.body.sessionId).toBe(a.body.sessionId);
    expect(c.body.sessionId).toBe(a.body.sessionId);
    expect(posts(sidecar)).toBe(2);
    expect((await call("POST", "/kleio/home/new")).status).toBe(401);
  });

  it("an unreachable or failing sidecar is a 502", async () => {
    const admin = await pairAdmin();
    const H = { [DEVICE_TOKEN_HEADER]: admin.token };
    sidecar.failCreate = true;
    const failed = await call("GET", "/kleio/home", { headers: H });
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ error: "sidecar error", detail: "POST /session -> 500" });

    await sidecar.close();
    const down = await call("GET", "/kleio/home", { headers: H });
    expect(down.status).toBe(502);
    expect(down.body).toEqual({ error: "sidecar unavailable" });
    sidecar = await fakeSidecar(); // afterEach closes it
  });
});

describe("host: chats started by voice (POST /kleio/chats)", () => {
  const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const until = async (check: () => boolean, ms = 5000): Promise<void> => {
    const t = Date.now();
    while (!check()) {
      if (Date.now() - t > ms) throw new Error("timed out waiting");
      await settle(20);
    }
  };
  const projects = (): string => join(home, "projects");
  const posts = (): number =>
    sidecar.seen.filter((s) => s.method === "POST" && s.url === "/session").length;
  const runEnd = (sid: string): void =>
    sidecar.emit(sid, `data: ${JSON.stringify({ type: "run_end", runState: "idle" })}`);

  async function withRoots(): Promise<Record<string, string>> {
    await host.stop();
    host = await startHost({ workspaceRoots: () => Promise.resolve([projects(), "/elsewhere"]) });
    const phone = await registry.mint("Phone");
    if (!phone.ok) throw new Error("mint");
    return { [DEVICE_TOKEN_HEADER]: phone.value.token };
  }

  /** Start a chat and give it a transcript on disk. */
  async function startOne(H: Record<string, string>, path: string): Promise<string> {
    const r = await call("POST", "/kleio/chats", {
      headers: H,
      body: { prompt: "Research heat pumps", agent: "research" },
    });
    expect(r.status).toBe(200);
    const id = r.body.sessionId as string;
    sidecar.sessions.set(id, path);
    return id;
  }

  it("creates a chat session in the first projects folder and prompts it", async () => {
    const H = await withRoots();
    const r = await call("POST", "/kleio/chats", {
      headers: H,
      body: { prompt: "  Research heat pumps for a small flat  ", agent: "research" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sessionId: expect.stringMatching(/^created-/) });
    expect(sidecar.creates.at(-1)).toEqual({
      mode: "chat",
      chatAgent: "research",
      cwd: projects(),
    });
    expect(readdirSync(home)).toContain("projects");
    expect(sidecar.prompts.at(-1)).toEqual({
      session: r.body.sessionId,
      body: { text: "Research heat pumps for a small flat\n\n(Started by voice from Kleio.)" },
    });
    const tracked = JSON.parse(readFileSync(join(home, "sessions.json"), "utf8")) as string[];
    expect(tracked).toContain(r.body.sessionId);

    await call("POST", "/kleio/chats", { headers: H, body: { prompt: "Hi" } });
    expect(sidecar.creates.at(-1)).toMatchObject({ chatAgent: "general" });
  });

  it("refuses bad bodies, other methods and no token; 404 without projects folders", async () => {
    const admin = await pairAdmin();
    const A = { [DEVICE_TOKEN_HEADER]: admin.token };
    expect(
      (await call("POST", "/kleio/chats", { headers: A, body: { prompt: "x" } })).body,
    ).toEqual({ error: "not_found" });
    const H = await withRoots();
    for (const body of [
      {},
      { prompt: "   " },
      { prompt: 3 },
      { prompt: "x".repeat(4001) },
      { prompt: "x", agent: "code" },
      [],
    ]) {
      const r = await call("POST", "/kleio/chats", { headers: H, body });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ error: "bad_request", detail: expect.any(String) });
    }
    const get = await call("GET", "/kleio/chats", { headers: H });
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
    expect((await call("POST", "/kleio/chats", { body: { prompt: "x" } })).status).toBe(401);
    expect(posts()).toBe(0);
  });

  it("a failed prompt is a 502 and the session is disposed", async () => {
    const H = await withRoots();
    sidecar.failPrompt = true;
    const r = await call("POST", "/kleio/chats", { headers: H, body: { prompt: "x" } });
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: "sidecar error", detail: "POST /prompt -> 500" });
    const id = [...sidecar.createdBodies.keys()].at(-1);
    expect(sidecar.disposed).toEqual([id]);
    const tracked = JSON.parse(readFileSync(join(home, "sessions.json"), "utf8")) as string[];
    expect(tracked).not.toContain(id);
  });

  it("caps running started chats at 5", async () => {
    const H = await withRoots();
    for (let i = 0; i < 5; i += 1)
      expect(
        (await call("POST", "/kleio/chats", { headers: H, body: { prompt: `p${i}` } })).status,
      ).toBe(200);
    const r = await call("POST", "/kleio/chats", { headers: H, body: { prompt: "one more" } });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "too_many" });
  });

  it("a run end with nobody watching sends a named nudge", async () => {
    const H = await withRoots();
    const id = await startOne(H, "/t/r.jsonl");
    await settle();
    runEnd(id);
    await until(() => nudges.some((n) => n.sessionId === id));
    expect(nudgeText.get(id)).toEqual({
      title: "Research ready",
      body: "Research heat pumps",
    });
  });

  it("a device opening the started chat's transcript gets the same session", async () => {
    const H = await withRoots();
    const id = await startOne(H, join(home, "t", "r.jsonl"));
    const before = posts();
    const r = await call("POST", "/session", {
      headers: H,
      body: {
        mode: "chat",
        chatAgent: "research",
        cwd: projects(),
        sessionPath: join(home, "t", "x", "..", "r.jsonl.gz"),
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sessionId: id });
    expect(posts()).toBe(before);
    // Claimed: the next open of that transcript is an ordinary new session.
    const again = await call("POST", "/session", {
      headers: H,
      body: { mode: "chat", sessionPath: join(home, "t", "r.jsonl") },
    });
    expect(again.body.sessionId).not.toBe(id);
    expect(posts()).toBe(before + 1);
  });

  it("another transcript is forwarded unchanged", async () => {
    const H = await withRoots();
    await startOne(H, "/t/r.jsonl");
    const body = {
      mode: "chat",
      chatAgent: "general",
      cwd: projects(),
      sessionPath: "/t/other.jsonl",
    };
    const r = await call("POST", "/session", { headers: H, body });
    expect(r.status).toBe(200);
    expect(sidecar.creates.at(-1)).toEqual(body);
  });

  it("removing an idle started chat releases it, then forwards", async () => {
    const H = await withRoots();
    const id = await startOne(H, "/t/r.jsonl");
    await settle();
    runEnd(id);
    await until(() => nudges.some((n) => n.sessionId === id));
    const r = await call("POST", "/sessions/delete", { headers: H, body: { path: "/t/r.jsonl" } });
    expect(r.status).toBe(200);
    expect(sidecar.disposed).toEqual([id]);
    expect(sidecar.deletes).toEqual([{ path: "/t/r.jsonl" }]);
    const tracked = JSON.parse(readFileSync(join(home, "sessions.json"), "utf8")) as string[];
    expect(tracked).not.toContain(id);
  });

  it("removing a running started chat is a 409, not forwarded", async () => {
    const H = await withRoots();
    await startOne(H, "/t/r.jsonl");
    const r = await call("POST", "/sessions/delete", { headers: H, body: { path: "/t/r.jsonl" } });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      error: "This chat is still working. Try again when it has finished.",
    });
    expect(sidecar.deletes).toEqual([]);
    expect(sidecar.disposed).toEqual([]);
  });

  it("removing another transcript is forwarded unchanged", async () => {
    const H = await withRoots();
    await startOne(H, "/t/r.jsonl");
    const r = await call("POST", "/sessions/delete", {
      headers: H,
      body: { path: "/t/other.jsonl" },
    });
    expect(r.status).toBe(200);
    expect(sidecar.deletes).toEqual([{ path: "/t/other.jsonl" }]);
    expect(sidecar.disposed).toEqual([]);
  });
});
