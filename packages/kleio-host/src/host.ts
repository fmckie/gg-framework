// The Kleio host HTTP server.
//
// Listens on loopback only; Tailscale Serve terminates TLS and applies tailnet
// ACLs in front. Every request is one of:
//   - unauthenticated: GET /kleio/health, POST /kleio/pair/redeem
//   - device-authenticated (x-kleio-device-token): everything under the
//     sidecar's API, proxied with Host rewritten to loopback and x-gg-token
//     added; plus GET /events, which is intercepted for id/replay.
//   - admin (device is admin OR a valid control macaroon): /kleio/devices,
//     /kleio/devices/:id/revoke, /kleio/pair/offer, /kleio/pair/revoke.
//
// The sidecar itself is untouched. Its Host allowlist is satisfied because we
// always send `127.0.0.1:<port>`.

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite } from "./device-registry.js";
import { formatPairCode, PAIR_REDEEM_MAX_BODY_BYTES, type PairingPayload } from "./pair-code.js";
import type { PairOfferStore } from "./pair-offer.js";
import type { DeviceRegistry, PairedDevice } from "./device-registry.js";
import type { RingStore, SessionRing } from "./sse-ring.js";
import { readSidecarEndpoint, type SidecarEndpoint } from "./sidecar.js";
import * as macaroon from "./macaroon.js";

export const DEVICE_TOKEN_HEADER = "x-kleio-device-token";
export const CONTROL_HEADER = "x-kleio-control";

export interface HostOptions {
  readonly listenHost?: string;
  readonly listenPort: number;
  /** Public base the host tells devices to use, e.g. https://mini.tailnet.ts.net:8443 */
  readonly publicBaseUrl: string;
  /** Tailnet host name, used as the macaroon node caveat. */
  readonly nodeId: string;
  readonly registry: DeviceRegistry;
  readonly offers: PairOfferStore;
  readonly rings: RingStore;
  /** Endpoint file published by the sidecar supervisor. */
  readonly sidecarEndpointPath: string;
  /** Root key for control macaroons (admin pairing). */
  readonly controlRootKey: string;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
}

export interface Host {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly server: Server;
}

type Auth = { readonly device: PairedDevice; readonly admin: boolean };

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": data.length,
    "cache-control": "no-store",
  });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

export function createHost(options: HostOptions): Host {
  const log = options.log ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  const { registry, offers, rings } = options;
  let sidecar: SidecarEndpoint | null = null;
  const touched = new Map<string, number>();

  async function endpoint(refresh = false): Promise<SidecarEndpoint | null> {
    if (!sidecar || refresh) sidecar = await readSidecarEndpoint(options.sidecarEndpointPath);
    return sidecar;
  }

  function probeSidecar(ep: SidecarEndpoint): Promise<boolean> {
    return new Promise((resolve) => {
      const r = httpRequest(
        {
          host: "127.0.0.1",
          port: ep.port,
          path: "/state",
          method: "GET",
          headers: { host: `127.0.0.1:${ep.port}`, "x-gg-token": ep.token },
          timeout: 1500,
        },
        (res) => {
          res.resume();
          // Any HTTP answer at all means the process behind the port is ours
          // (it accepted the token); the sidecar answers 400 without a session.
          resolve(res.statusCode !== 401 && res.statusCode !== 403);
        },
      );
      r.on("timeout", () => {
        r.destroy();
        resolve(false);
      });
      r.on("error", () => resolve(false));
      r.end();
    });
  }

  function authenticate(req: IncomingMessage): Auth | null {
    const header = req.headers[DEVICE_TOKEN_HEADER];
    const token =
      typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
    if (!token) return null;
    const device = registry.authenticate(token);
    if (!device) return null;
    let admin = device.admin;
    if (!admin) {
      const control = req.headers[CONTROL_HEADER];
      const cred = typeof control === "string" ? control : undefined;
      if (cred && macaroon.isMacaroon(cred)) {
        const verdict = macaroon.verify(options.controlRootKey, cred, {
          now: now(),
          nodeId: options.nodeId,
        });
        admin = verdict.ok;
      }
    }
    // lastSeen at most once a minute per device; never on the request path.
    const last = touched.get(device.deviceId) ?? 0;
    if (Date.now() - last > 60_000) {
      touched.set(device.deviceId, Date.now());
      void registry.touch(device.deviceId);
    }
    return { device, admin };
  }

  function mintPayloadFor(admin: boolean): (label: string | undefined) => Promise<PairingPayload> {
    return async (label) => {
      const minted = await registry.mint(label ?? (admin ? "Admin device" : "Device"), { admin });
      if (!minted.ok) throw new Error(minted.error.message);
      const payload: PairingPayload = {
        baseUrl: options.publicBaseUrl,
        host: options.nodeId,
        token: minted.value.token,
        label: minted.value.device.label,
        deviceId: minted.value.device.deviceId,
      };
      if (!admin) return payload;
      const expires = new Date(now().getTime() + 365 * 24 * 3600_000);
      const cred = macaroon.mint(options.controlRootKey, minted.value.device.deviceId, [
        macaroon.expCaveat(expires),
        macaroon.nodeCaveat(options.nodeId),
      ]);
      return { ...payload, controlCredential: cred };
    };
  }

  // ------------------------------------------------------------------ SSE

  interface LiveSession {
    ring: SessionRing;
    subs: Set<ServerResponse>;
    upstream: ReturnType<typeof httpRequest> | null;
  }
  const live = new Map<string, LiveSession>();
  const liveLoading = new Map<string, Promise<LiveSession>>();

  // Two clients attaching to the same session at once must share one
  // LiveSession, or the upstream fan-out reaches only one of them.
  function liveSession(sessionId: string): Promise<LiveSession> {
    const ready = live.get(sessionId);
    if (ready) return Promise.resolve(ready);
    let p = liveLoading.get(sessionId);
    if (!p) {
      p = rings.session(sessionId).then((ring) => {
        const s: LiveSession = { ring, subs: new Set(), upstream: null };
        live.set(sessionId, s);
        liveLoading.delete(sessionId);
        return s;
      });
      p.catch(() => liveLoading.delete(sessionId));
      liveLoading.set(sessionId, p);
    }
    return p;
  }

  async function ensureUpstream(sessionId: string): Promise<void> {
    const s = await liveSession(sessionId);
    if (s.upstream) return;
    const ep = await endpoint();
    if (!ep) return;
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: ep.port,
        path: `/events?session=${encodeURIComponent(sessionId)}`,
        method: "GET",
        headers: {
          host: `127.0.0.1:${ep.port}`,
          "x-gg-token": ep.token,
          accept: "text/event-stream",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          log(`[sse] upstream ${sessionId} -> ${res.statusCode}`);
          res.resume();
          s.upstream = null;
          if (res.statusCode === 404) void untrack(sessionId);
          return;
        }
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (!raw.trim() || raw.startsWith(":") || raw.startsWith("retry:")) continue;
            const frame = s.ring.push(raw);
            for (const sub of s.subs) sub.write(frame.frame);
          }
        });
        const gone = (): void => {
          s.upstream = null;
          if (s.subs.size) setTimeout(() => void ensureUpstream(sessionId), 1000).unref();
        };
        res.on("end", gone);
        res.on("error", gone);
      },
    );
    req.on("error", (e) => {
      log(`[sse] upstream ${sessionId} error ${e.message}`);
      s.upstream = null;
      void endpoint(true);
      if (s.subs.size) setTimeout(() => void ensureUpstream(sessionId), 1000).unref();
    });
    req.end();
    s.upstream = req;
  }

  /** Open SSE responses by device, so a revoke can cut them at once. */
  const streamsByDevice = new Map<string, Set<ServerResponse>>();

  function dropStreams(deviceId: string): number {
    const set = streamsByDevice.get(deviceId);
    if (!set) return 0;
    let n = 0;
    for (const res of set) {
      res.end();
      res.destroy();
      n += 1;
    }
    streamsByDevice.delete(deviceId);
    return n;
  }

  async function handleEvents(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    deviceId: string,
  ): Promise<void> {
    const sessionId =
      url.searchParams.get("session") ?? (req.headers["x-gg-session"] as string | undefined);
    if (!sessionId) return json(res, 400, { error: "session required" });
    let s: LiveSession;
    try {
      s = await liveSession(sessionId);
    } catch {
      return json(res, 400, { error: "bad session id" });
    }
    void ensureUpstream(sessionId);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 1000\n\n");
    const lastHeader = req.headers["last-event-id"];
    const last = Number(
      typeof lastHeader === "string" ? lastHeader : (url.searchParams.get("lastEventId") ?? NaN),
    );
    if (Number.isInteger(last) && last >= 0) {
      const oldest = s.ring.oldest();
      if (oldest !== null && last + 1 < oldest) {
        res.write(
          `id: ${s.ring.seq()}\ndata: ${JSON.stringify({ type: "kleio_replay_gap", data: { from: last, oldest } })}\n\n`,
        );
      }
      const missed = s.ring.since(last);
      for (const f of missed) res.write(f.frame);
      log(
        `[sse] resume ${sessionId} from ${last}: replayed ${missed.length} (seq=${s.ring.seq()})`,
      );
    } else {
      const ready = s.ring.findLast((f) => f.includes('"type":"ready"'));
      if (ready) res.write(ready.frame);
    }
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    s.subs.add(res);
    let mine = streamsByDevice.get(deviceId);
    if (!mine) streamsByDevice.set(deviceId, (mine = new Set()));
    mine.add(res);
    req.on("close", () => {
      clearInterval(ping);
      s.subs.delete(res);
      mine.delete(res);
      // The upstream stays attached: the ring must keep filling while no client
      // is connected, or a restart/outage loses exactly the frames that matter.
    });
  }

  /**
   * The proxy owns the set of live sessions: the sidecar has no "list live
   * sessions in this process" route (its /sessions is on-disk history by cwd).
   * Every session created through the proxy is recorded, subscribed upstream
   * at once, and re-subscribed after a proxy restart, so the ring keeps filling
   * whether or not any client is attached.
   */
  const trackedPath = join(dirname(options.sidecarEndpointPath), "sessions.json");
  const tracked = new Set<string>();

  async function persistTracked(): Promise<void> {
    await atomicWrite(trackedPath, `${JSON.stringify([...tracked])}\n`, 0o600);
  }

  async function track(sessionId: string): Promise<void> {
    if (tracked.has(sessionId)) return;
    tracked.add(sessionId);
    await persistTracked().catch((e) => log(`[sse] persist tracked failed: ${String(e)}`));
    void ensureUpstream(sessionId).catch(() => {});
  }

  async function untrack(sessionId: string): Promise<void> {
    if (!tracked.delete(sessionId)) return;
    const s = live.get(sessionId);
    s?.upstream?.destroy();
    live.delete(sessionId);
    await persistTracked().catch(() => {});
  }

  async function resumeTracked(): Promise<void> {
    try {
      const ids = JSON.parse(await readFile(trackedPath, "utf8")) as unknown;
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") tracked.add(id);
    } catch {
      /* first start */
    }
    for (const id of tracked) void ensureUpstream(id).catch(() => {});
    if (tracked.size) log(`[sse] resubscribed ${tracked.size} tracked session(s)`);
  }

  // ------------------------------------------------------------------ proxy

  /**
   * Forward to the sidecar. A stale endpoint (sidecar respawned on a new port)
   * surfaces as a connect-phase error before any response bytes exist; in that
   * case re-read the endpoint file once and retry. The request body is buffered
   * up front so a retry can resend it; the sidecar API is JSON, bounded here at
   * 8 MiB to stay well above any real prompt/attachment while still bounded.
   */
  async function proxy(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? Buffer.alloc(0)
        : await readBody(req, 8 * 1024 * 1024);
    if (body === null) return json(res, 413, { error: "body too large" });
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (
        v === undefined ||
        HOP_BY_HOP.has(k) ||
        k === DEVICE_TOKEN_HEADER ||
        k === CONTROL_HEADER ||
        k === "content-length"
      )
        continue;
      headers[k] = v;
    }
    headers["x-gg-token"] = "";
    headers["content-length"] = String(body.length);

    const attemptOnce = (ep: SidecarEndpoint): Promise<"ok" | "stale" | "failed"> =>
      new Promise((resolve) => {
        const up = httpRequest(
          {
            host: "127.0.0.1",
            port: ep.port,
            path: url.pathname + url.search,
            method: req.method,
            headers: { ...headers, host: `127.0.0.1:${ep.port}`, "x-gg-token": ep.token },
          },
          (ures) => {
            const out: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(ures.headers))
              if (v !== undefined && !HOP_BY_HOP.has(k)) out[k] = v;
            if (req.method === "POST" && url.pathname === "/session" && ures.statusCode === 200) {
              // Learn the new session before the client can attach to it.
              let body = "";
              ures.setEncoding("utf8");
              ures.on("data", (c: string) => (body += c));
              ures.on("end", () => {
                try {
                  const id = (JSON.parse(body) as { sessionId?: unknown }).sessionId;
                  if (typeof id === "string") void track(id);
                } catch {
                  /* not ours to validate */
                }
                delete out["content-length"];
                res.writeHead(200, { ...out, "content-length": Buffer.byteLength(body) });
                res.end(body);
                resolve("ok");
              });
              ures.on("error", () => {
                res.destroy();
                resolve("failed");
              });
              return;
            }
            res.writeHead(ures.statusCode ?? 502, out);
            ures.pipe(res);
            ures.on("end", () => resolve("ok"));
            ures.on("error", () => {
              res.destroy();
              resolve("failed");
            });
          },
        );
        up.on("error", (e) => {
          const code = (e as NodeJS.ErrnoException).code;
          // Nothing reached the client yet and the socket never delivered a
          // response: the endpoint is stale (or the sidecar is mid-restart).
          if (
            !res.headersSent &&
            (code === "ECONNREFUSED" ||
              code === "ECONNRESET" ||
              code === "EPIPE" ||
              code === "ETIMEDOUT")
          ) {
            resolve("stale");
            return;
          }
          if (!res.headersSent) json(res, 502, { error: "sidecar error", detail: e.message });
          else res.destroy();
          resolve("failed");
        });
        up.end(body);
      });

    const first = await endpoint();
    if (!first) return json(res, 503, { error: "sidecar unavailable" });
    const outcome = await attemptOnce(first);
    if (outcome !== "stale") return;
    const fresh = await endpoint(true);
    if (!fresh) return json(res, 503, { error: "sidecar unavailable" });
    if (fresh.port === first.port && fresh.token === first.token) {
      // Same endpoint, still refusing: give it one short beat (respawn in progress).
      await new Promise((r) => setTimeout(r, 300));
    }
    const second = await attemptOnce(fresh);
    if (second === "stale") json(res, 503, { error: "sidecar unavailable" });
  }

  // ------------------------------------------------------------------ routes

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/kleio/health") {
      // Probe, don't trust the endpoint file: a supervisor that died leaves a
      // stale file behind, and "up" would then be a lie until the next request.
      const ep = await endpoint(true);
      const alive = ep ? await probeSidecar(ep) : false;
      return json(res, 200, {
        ok: true,
        sidecar: alive ? "up" : ep ? "stale" : "down",
        devices: registry.list().filter((d) => !d.revoked).length,
        offer: offers.peek().active,
        sessions: [...live.entries()].map(([id, s]) => ({
          id,
          seq: s.ring.seq(),
          subscribers: s.subs.size,
        })),
      });
    }

    if (req.method === "POST" && path === "/kleio/pair/redeem") {
      const body = await readBody(req, PAIR_REDEEM_MAX_BODY_BYTES);
      if (body === null) return json(res, 413, { ok: false, error: "bad_request" });
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      } catch {
        return json(res, 400, { ok: false, error: "bad_request" });
      }
      const outcome = await offers.redeem(parsed.code, parsed.redemptionNonce, parsed.label);
      if (outcome.ok) return json(res, 200, { ok: true, payload: outcome.payload });
      const status =
        outcome.reason === "bad_request" ? 400 : outcome.reason === "not_found" ? 404 : 401;
      return json(res, status, { ok: false, error: outcome.reason });
    }

    const auth = authenticate(req);
    if (!auth) return json(res, 401, { error: "unauthorized" });

    if (path.startsWith("/kleio/")) {
      if (!auth.admin) return json(res, 403, { error: "forbidden" });
      if (req.method === "GET" && path === "/kleio/devices")
        return json(res, 200, { devices: registry.list() });
      const revoke = path.match(/^\/kleio\/devices\/([A-Za-z0-9-]+)\/revoke$/);
      if (req.method === "POST" && revoke) {
        const r = await registry.revoke(revoke[1]!);
        if (!r.ok)
          return json(res, r.error.kind === "not_found" ? 404 : 500, { error: r.error.message });
        const cut = dropStreams(revoke[1]!);
        log(`[admin] ${auth.device.label} revoked ${revoke[1]} (${cut} open stream(s) closed)`);
        return json(res, 200, { devices: r.value });
      }
      if (req.method === "POST" && path === "/kleio/pair/offer") {
        const body = await readBody(req, 1024);
        let admin = false;
        if (body && body.length) {
          try {
            admin = (JSON.parse(body.toString("utf8")) as { admin?: unknown }).admin === true;
          } catch {
            return json(res, 400, { error: "bad_request" });
          }
        }
        const offer = offers.offer(mintPayloadFor(admin), { admin });
        log(`[admin] ${auth.device.label} minted a pair offer (admin=${admin})`);
        return json(res, 200, {
          code: offer.code,
          display: formatPairCode(offer.code),
          expiresAt: offer.expiresAt,
          admin,
        });
      }
      if (req.method === "POST" && path === "/kleio/pair/revoke") {
        offers.revoke();
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && path === "/kleio/pair") return json(res, 200, offers.peek());
      return json(res, 404, { error: "not found" });
    }

    if (req.method === "GET" && path === "/events")
      return handleEvents(req, res, url, auth.device.deviceId);
    return proxy(req, res, url);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log(`[host] ${req.method} ${req.url} failed: ${String(e)}`);
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else res.destroy();
    });
  });
  server.keepAliveTimeout = 65_000;

  return {
    server,
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.listenPort, options.listenHost ?? "127.0.0.1", () => {
          server.off("error", reject);
          log(
            `[host] listening on http://${options.listenHost ?? "127.0.0.1"}:${options.listenPort}`,
          );
          void resumeTracked().then(resolve, resolve);
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        for (const s of live.values()) {
          s.upstream?.destroy();
          for (const sub of s.subs) sub.destroy();
        }
        // close() alone waits for idle keep-alive sockets to time out (65 s here,
        // and slow to notice on Windows). Drop them: a stopping host has nothing
        // more to say, and clients reconnect with Last-Event-ID anyway.
        server.close(() => resolve());
        server.closeAllConnections();
        setTimeout(resolve, 2000).unref();
      }),
  };
}
