#!/usr/bin/env node
// Kleio host — SPIKE. Throwaway quality; proves the architecture in PLAN.md §5.
//
// One process that:
//   1. spawns the unmodified gg-app sidecar exactly as gg-app/src-tauri/src/lib.rs does
//      (node app-sidecar.mjs, GG_APP_PORT=0, GG_APP_TOKEN=<uuid>, stdout handshake
//      "GG_APP_LISTENING <port> <token>"), respawning with bounded backoff;
//   2. listens on 127.0.0.1:8443 as a reverse proxy: checks a static device token,
//      rewrites Host to loopback (the sidecar's Host allowlist is untouched), forwards
//      with x-gg-token;
//   3. intercepts GET /events: one upstream stream per session, assigns `id: <seq>`
//      to every frame, keeps the last RING frames, honours Last-Event-ID so a
//      reconnecting client gets exactly the frames it missed.
//
// No engine files are modified. Tailscale Serve (host.mjs is loopback-only) provides
// TLS + tailnet ACL in front: `tailscale serve --bg --https=8443 http://127.0.0.1:8443`.

import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { createInterface } from "node:readline";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = Number(process.env.KLEIO_HOST_PORT ?? 8443);
const DEVICE_TOKEN = process.env.KLEIO_DEVICE_TOKEN;
const SIDECAR = process.env.KLEIO_SIDECAR_PATH;
const NODE_BIN = process.env.KLEIO_NODE_BIN ?? process.execPath;
const RING = Number(process.env.KLEIO_RING ?? 500);
const HEADLESS_CWD = process.env.KLEIO_SIDECAR_CWD ?? process.cwd();

if (!DEVICE_TOKEN || DEVICE_TOKEN.length < 32) {
  console.error("KLEIO_DEVICE_TOKEN must be set (>= 32 chars)");
  process.exit(2);
}
if (!SIDECAR) {
  console.error("KLEIO_SIDECAR_PATH must point at app-sidecar.mjs");
  process.exit(2);
}

const log = (...a) => console.log(new Date().toISOString(), "[kleio-host]", ...a);

// ---------------------------------------------------------------- sidecar supervisor

const sidecarToken = randomUUID();
let sidecarPort = null;
let child = null;
let attempts = 0;
let startedAt = 0;
let shuttingDown = false;

function spawnSidecar() {
  child = spawn(NODE_BIN, [SIDECAR], {
    cwd: HEADLESS_CWD,
    env: { ...process.env, GG_APP_PORT: "0", GG_APP_TOKEN: sidecarToken },
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedAt = Date.now();
  log(`sidecar spawned pid=${child.pid}`);
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.startsWith("GG_APP_LISTENING ")) {
      const port = Number(line.split(/\s+/)[1]);
      if (Number.isInteger(port) && port > 0) {
        sidecarPort = port;
        log(`sidecar listening on 127.0.0.1:${port}`);
      }
      return;
    }
    process.stdout.write(`[sidecar] ${line}\n`);
  });
  createInterface({ input: child.stderr }).on("line", (line) =>
    process.stderr.write(`[sidecar!] ${line}\n`),
  );
  child.on("exit", (code, signal) => {
    log(`sidecar exited code=${code} signal=${signal}`);
    sidecarPort = null;
    child = null;
    if (shuttingDown) return;
    if (Date.now() - startedAt > 60_000) attempts = 0;
    if (attempts >= 5) {
      log("sidecar crashed 5x; giving up (launchd KeepAlive restarts the host)");
      process.exit(1);
    }
    const delay = 1000 * 2 ** attempts++;
    log(`respawning sidecar in ${delay}ms`);
    setTimeout(spawnSidecar, delay);
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    shuttingDown = true;
    log(`received ${sig}; stopping`);
    child?.kill("SIGTERM");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

// ---------------------------------------------------------------- SSE ring per session

/** @type {Map<string, {seq:number, ring:{id:number, frame:string}[], subs:Set<http.ServerResponse>, upstream:http.ClientRequest|null}>} */
const sessions = new Map();

function sessionOf(sessionId) {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { seq: 0, ring: [], subs: new Set(), upstream: null };
    sessions.set(sessionId, s);
  }
  return s;
}

// One upstream /events connection per session, fanned out to every attached client.
// It stays open for a grace period after the last client detaches, so a laptop
// that drops Wi-Fi for 30 s keeps accumulating frames in the ring.
function ensureUpstream(sessionId) {
  const s = sessionOf(sessionId);
  if (s.upstream || !sidecarPort) return;
  const req = http.request(
    {
      host: "127.0.0.1",
      port: sidecarPort,
      path: `/events?session=${encodeURIComponent(sessionId)}`,
      method: "GET",
      headers: {
        host: `127.0.0.1:${sidecarPort}`,
        "x-gg-token": sidecarToken,
        accept: "text/event-stream",
      },
    },
    (res) => {
      if (res.statusCode !== 200) {
        log(`upstream /events ${sessionId} -> ${res.statusCode}`);
        res.resume();
        s.upstream = null;
        return;
      }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!raw.trim() || raw.startsWith(":") || raw.startsWith("retry:")) continue;
          const id = ++s.seq;
          const frame = `id: ${id}\n${raw}\n\n`;
          s.ring.push({ id, frame });
          if (s.ring.length > RING) s.ring.shift();
          for (const sub of s.subs) sub.write(frame);
        }
      });
      res.on("end", () => {
        s.upstream = null;
        if (s.subs.size) setTimeout(() => ensureUpstream(sessionId), 1000);
      });
      res.on("error", () => {
        s.upstream = null;
      });
    },
  );
  req.on("error", (e) => {
    log(`upstream /events ${sessionId} error ${e.message}`);
    s.upstream = null;
    if (s.subs.size) setTimeout(() => ensureUpstream(sessionId), 1000);
  });
  req.end();
  s.upstream = req;
}

function handleEvents(req, res, url) {
  const sessionId = url.searchParams.get("session") ?? req.headers["x-gg-session"];
  if (!sessionId) return json(res, 400, { error: "session required" });
  const s = sessionOf(sessionId);
  ensureUpstream(sessionId);
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("retry: 1000\n\n");
  const last = Number(req.headers["last-event-id"] ?? url.searchParams.get("lastEventId") ?? NaN);
  if (Number.isInteger(last) && last >= 0) {
    // Resume: replay everything after `last`. If `last` fell out of the ring we
    // cannot guarantee continuity; say so rather than silently gapping.
    const oldest = s.ring[0]?.id ?? s.seq + 1;
    if (last + 1 < oldest && s.ring.length) {
      res.write(
        `id: ${s.seq}\ndata: ${JSON.stringify({ type: "kleio_replay_gap", data: { from: last, oldest } })}\n\n`,
      );
    }
    let n = 0;
    for (const { id, frame } of s.ring) if (id > last) (res.write(frame), n++);
    log(`resume ${sessionId} from ${last}: replayed ${n} (seq=${s.seq})`);
  } else {
    // Fresh attach: hand over the latest `ready` snapshot we hold. The sidecar
    // only emits `ready` when the proxy's upstream connects, which happens once.
    const ready = [...s.ring].reverse().find((f) => f.frame.includes('"type":"ready"'));
    if (ready) res.write(ready.frame);
  }
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  s.subs.add(res);
  req.on("close", () => {
    clearInterval(ping);
    s.subs.delete(res);
    if (!s.subs.size)
      setTimeout(() => {
        if (!s.subs.size && s.upstream) {
          s.upstream.destroy();
          s.upstream = null;
        }
      }, 60_000).unref();
  });
}

// ---------------------------------------------------------------- proxy

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function tokenOk(header) {
  if (typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(DEVICE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://kleio");
  if (url.pathname === "/kleio/health") {
    return json(res, 200, {
      ok: true,
      sidecar: sidecarPort ? "up" : "down",
      sessions: [...sessions].map(([id, s]) => ({ id, seq: s.seq, subscribers: s.subs.size })),
    });
  }
  const presented = req.headers["x-kleio-device-token"] ?? url.searchParams.get("device_token");
  if (!tokenOk(presented)) return json(res, 401, { error: "unauthorized" });
  if (!sidecarPort) return json(res, 503, { error: "sidecar starting" });

  if (req.method === "GET" && url.pathname === "/events") return handleEvents(req, res, url);

  url.searchParams.delete("device_token");
  const headers = { ...req.headers };
  delete headers["x-kleio-device-token"];
  headers.host = `127.0.0.1:${sidecarPort}`;
  headers["x-gg-token"] = sidecarToken;
  const up = http.request(
    { host: "127.0.0.1", port: sidecarPort, method: req.method, path: url.pathname + url.search, headers },
    (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.pipe(res);
    },
  );
  up.on("error", (e) => {
    if (!res.headersSent) json(res, 502, { error: "sidecar unreachable", detail: e.message });
    else res.destroy();
  });
  req.pipe(up);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  spawnSidecar();
});
