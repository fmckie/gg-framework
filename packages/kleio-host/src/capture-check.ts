// `kleio-host capture-check`: shows, on this Mac, that a page Kleio captures
// can't reach the Mac's own network, and that real sites capture as they
// should. Run it after building or deploying the capture helper.
//
//   1. A canary listens on 127.0.0.1 and ::1, TCP and UDP, and counts every
//      connection and packet.
//   2. An attack page, served here but reached by a made-up public name (the
//      check's own resolver), tries every way it can to reach the canary:
//      images, fetch, XHR, beacons, EventSource, WebSockets, iframes, a form,
//      CSS, redirects, a popup, WebRTC (STUN and TURN, from the page and from
//      a fresh frame), names that resolve to 127.0.0.1, and other spellings
//      of it. It reports back to its own server, which proves it ran.
//   3. The page is captured exactly as a voice show captures one. The canary
//      must count 0.
//   4. Unless --no-sites: real pages, a phone view, a sign-in wall, an arXiv
//      PDF and a 404, each checked against what it should be.
//
// The pictures are kept in a temporary folder, printed at the end.

import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { mkdtempSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect as netConnect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCapturer,
  defaultHelperPath,
  failureText,
  macHelperBackend,
  supportText,
  type View,
} from "./capture.js";
import { connectPinned, systemLookup, type Connector, type LookupAll } from "./net-guard.js";

/** The attack page's made-up name, and the public-looking address the check gives it. */
const ATTACK_HOST = "capture-check.kleio.example";
const ATTACK_ADDRESS = "198.51.99.7";

interface Canary {
  readonly port: number;
  /** What reached it: "tcp 127.0.0.1 GET /img", "udp ::1 48 bytes", ... */
  readonly hits: string[];
  close(): Promise<void>;
}

async function listenTcp(host: string, port: number, hits: string[]): Promise<Server | null> {
  const server = createServer((socket: Socket) => {
    const seen = `tcp ${host}`;
    let first = "";
    socket.on("error", () => socket.destroy());
    socket.setTimeout(1_000, () => socket.destroy());
    socket.on("data", (d: Buffer) => {
      if (!first) first = d.toString("latin1").split("\r\n")[0]?.slice(0, 80) ?? "";
    });
    socket.on("close", () => hits.push(first ? `${seen} ${first}` : `${seen} (connection)`));
  });
  return new Promise((resolve) => {
    server.once("error", () => resolve(null));
    server.listen(port, host, () => resolve(server));
  });
}

async function listenUdp(host: string, port: number, hits: string[]): Promise<UdpSocket | null> {
  const socket = createSocket(host.includes(":") ? "udp6" : "udp4");
  socket.on("message", (m) => hits.push(`udp ${host} ${m.length} bytes`));
  return new Promise((resolve) => {
    socket.once("error", () => resolve(null));
    socket.bind(port, host, () => resolve(socket));
  });
}

async function startCanary(): Promise<Canary> {
  const hits: string[] = [];
  const v4 = await listenTcp("127.0.0.1", 0, hits);
  const address = v4?.address();
  if (!v4 || !address || typeof address === "string") throw new Error("no canary port");
  const port = address.port;
  // The same port on IPv6 loopback and for UDP, where this Mac allows it.
  const v6 = await listenTcp("::1", port, hits);
  const udp4 = await listenUdp("127.0.0.1", port, hits);
  const udp6 = await listenUdp("::1", port, hits);
  return {
    port,
    hits,
    close: async () => {
      for (const s of [v4, v6]) if (s) await new Promise<void>((r) => s.close(() => r()));
      for (const u of [udp4, udp6]) if (u) u.close();
    },
  };
}

function attackPage(port: number): string {
  const p = String(port);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kleio capture check</title>
<link rel="preconnect" href="http://127.0.0.1:${p}">
<link rel="prefetch" href="http://127.0.0.1:${p}/prefetch">
<link rel="stylesheet" href="http://127.0.0.1:${p}/style.css">
<style>
@import url(http://127.0.0.1:${p}/import.css);
body { font: 20px -apple-system, sans-serif; margin: 40px; }
.bg { background: url(http://localhost:${p}/css-bg); }
.overflow { width: 1300px; height: 2000px; }
</style></head><body>
<h1>Kleio capture check</h1>
<p>This page tries to reach a canary on this Mac's loopback, port ${p}. Every attempt must fail.</p>
<p class="bg">If you can read this, the page drew.</p>
<img src="/pixel" alt="">
<img src="http://127.0.0.1:${p}/img" alt="">
<img src="http://localhost:${p}/img-localhost" alt="">
<img src="http://[::1]:${p}/img-v6" alt="">
<img src="http://127.0.0.1.nip.io:${p}/img-nip" alt="">
<img src="http://localtest.me:${p}/img-localtest" alt="">
<img src="http://2130706433:${p}/img-decimal" alt="">
<img src="http://0x7f.1:${p}/img-hex" alt="">
<img src="http://127.1:${p}/img-short" alt="">
<img src="/redirect" alt="">
<img src="/redirect-name" alt="">
<iframe src="http://127.0.0.1:${p}/iframe" width="50" height="50"></iframe>
<iframe src="http://localtest.me:${p}/iframe-name" width="50" height="50"></iframe>
<iframe name="sink" width="10" height="10"></iframe>
<form id="f" action="http://127.0.0.1:${p}/form" method="post" target="sink"><input name="a" value="b"></form>
<div class="overflow"></div>
<script>document.documentElement.offsetHeight; // laid out mid-load, as a long page is</script>
<script>
const P = ${p};
const targets = ["http://127.0.0.1:" + P, "http://localhost:" + P, "http://[::1]:" + P,
  "http://127.0.0.1.nip.io:" + P, "http://localtest.me:" + P];
const report = (what) => fetch("/report?" + new URLSearchParams(what)).catch(() => {});
report({ rtc: typeof window.RTCPeerConnection, media: typeof navigator.mediaDevices });
for (const t of targets) {
  fetch(t + "/fetch").catch(() => {});
  fetch(t + "/fetch-no-cors", { mode: "no-cors" }).catch(() => {});
  try { const x = new XMLHttpRequest(); x.open("GET", t + "/xhr"); x.send(); } catch (e) {}
  try { navigator.sendBeacon(t + "/beacon", "x"); } catch (e) {}
  try { new EventSource(t + "/sse"); } catch (e) {}
  try { new WebSocket(t.replace("http", "ws") + "/ws"); } catch (e) {}
}
try { document.getElementById("f").submit(); } catch (e) {}
try { window.open("http://127.0.0.1:" + P + "/popup"); } catch (e) {}
const rtcTry = (RTC, label) => {
  if (typeof RTC !== "function") { report({ [label]: "absent" }); return; }
  try {
    const pc = new RTC({ iceServers: [
      { urls: "stun:127.0.0.1:" + P },
      { urls: "turn:127.0.0.1:" + P + "?transport=tcp", username: "u", credential: "c" },
      { urls: "turn:127.0.0.1:" + P + "?transport=udp", username: "u", credential: "c" },
    ] });
    pc.createDataChannel("x");
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
    report({ [label]: "created" });
  } catch (e) { report({ [label]: "threw" }); }
};
rtcTry(window.RTCPeerConnection, "rtcPage");
const blank = document.createElement("iframe");
document.body.appendChild(blank);
try { rtcTry(blank.contentWindow.RTCPeerConnection, "rtcBlankFrame"); } catch (e) { report({ rtcBlankFrame: "blocked" }); }
let n = 0;
const again = setInterval(() => {
  for (const t of targets) fetch(t + "/late").catch(() => {});
  if (++n >= 6) clearInterval(again);
}, 500);
report({ control: "ran" });
// The page is wider and taller than a screen and laid out before it finished
// loading, so the window has both scrollbars before any style could hide
// them: overlay ones leave the page all of the window.
addEventListener("load", () => {
  const d = document.documentElement;
  report({ room: d.clientWidth + "x" + d.clientHeight + " of " + innerWidth + "x" + innerHeight });
});
</script></body></html>`;
}

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface AttackSite {
  readonly port: number;
  /** The page's reports back: "control=ran", "rtc=undefined", ... */
  readonly reports: string[];
  close(): Promise<void>;
}

async function startAttackSite(canaryPort: number): Promise<AttackSite> {
  const reports: string[] = [];
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${ATTACK_HOST}`);
    switch (url.pathname) {
      case "/":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(attackPage(canaryPort));
        return;
      case "/pixel":
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PIXEL);
        return;
      case "/report":
        for (const [k, v] of url.searchParams) reports.push(`${k}=${v}`);
        res.writeHead(204);
        res.end();
        return;
      case "/redirect":
        res.writeHead(302, { location: `http://127.0.0.1:${canaryPort}/redirected` });
        res.end();
        return;
      case "/redirect-name":
        res.writeHead(302, { location: `http://localtest.me:${canaryPort}/redirected-name` });
        res.end();
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no attack site port");
  return {
    port: address.port,
    reports,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

interface SiteCase {
  readonly url: string;
  readonly view: View;
  readonly expect: "page" | "sign-in" | "pdf" | "404";
}

const SITES: readonly SiteCase[] = [
  { url: "https://en.wikipedia.org/wiki/Mars", view: "desktop", expect: "page" },
  { url: "https://www.bbc.co.uk/news", view: "phone", expect: "page" },
  { url: "https://github.com/nodejs/node", view: "desktop", expect: "page" },
  { url: "https://arxiv.org/pdf/1706.03762", view: "desktop", expect: "pdf" },
  { url: "https://github.com/settings/profile", view: "desktop", expect: "sign-in" },
  { url: "https://github.com/kleio-capture-check-missing/nope", view: "desktop", expect: "404" },
];

export interface CaptureCheckOptions {
  readonly sites: boolean;
  readonly out: (line: string) => void;
}

/** Runs the check; true when everything held. */
export async function runCaptureCheck(options: CaptureCheckOptions): Promise<boolean> {
  const { out } = options;
  const helperPath = defaultHelperPath();
  out(`helper: ${helperPath}`);
  const backend = macHelperBackend({ path: helperPath });
  if (!backend.support.available) {
    out(`capture is unavailable here: ${supportText(backend.support.reason)}`);
    out("capture-check: FAILED");
    return false;
  }
  const folder = mkdtempSync(join(tmpdir(), "kleio-capture-check-"));
  let passed = true;

  // 1-3. The attack page against the canary.
  const canary = await startCanary();
  const site = await startAttackSite(canary.port);
  const lookup: LookupAll = (name) =>
    name === ATTACK_HOST
      ? Promise.resolve([{ address: ATTACK_ADDRESS, family: 4 }])
      : systemLookup(name);
  const connect: Connector = (to) =>
    to.address === ATTACK_ADDRESS
      ? netConnect({ host: "127.0.0.1", port: site.port })
      : connectPinned(to);
  const attack = createCapturer({
    backend,
    cacheDir: join(folder, "attack"),
    fetch: { lookup, connect },
    proxy: { lookup, connect },
    log: (line) => out(`  ${line}`),
  });
  out(`\nattack page against a canary on loopback port ${canary.port}:`);
  const shot = await attack.url(`http://${ATTACK_HOST}/`, "desktop");
  await new Promise((r) => setTimeout(r, 2_000)); // late probes
  await canary.close();
  await site.close();
  if (!shot.ok) {
    passed = false;
    out(`  FAIL: the attack page didn't capture: ${failureText(shot.error)} (${shot.error.kind})`);
  } else if (shot.value.kind === "web") {
    out(`  captured: ${shot.value.png.file}`);
  }
  out(`  the page reported: ${site.reports.join(", ") || "nothing"}`);
  if (!site.reports.includes("control=ran")) {
    passed = false;
    out("  FAIL: the page's script never reported back, so the probes may not have run");
  }
  // Scrollbars that take room leave a band over the page every screen down.
  const room = site.reports.find((r) => r.startsWith("room="))?.slice("room=".length);
  const [usable, whole] = room?.split(" of ") ?? [];
  if (!room) {
    passed = false;
    out("  FAIL: the page never said how much of the window it had");
  } else if (usable !== whole) {
    passed = false;
    out(`  FAIL: scrollbars took room from the page (${room}): its picture would show them`);
  } else {
    out(`  page room: ${room}, no scrollbars in the way`);
  }
  if (canary.hits.length === 0) {
    out("  canary: 0 hits");
  } else {
    passed = false;
    out(`  FAIL: canary hit ${canary.hits.length} times:`);
    for (const hit of canary.hits) out(`    ${hit}`);
  }

  // 4. Real sites.
  if (options.sites) {
    out("\nreal sites:");
    const real = createCapturer({ backend, cacheDir: join(folder, "sites") });
    for (const c of SITES) {
      const started = Date.now();
      const r = await real.url(c.url, c.view);
      const ms = Date.now() - started;
      const host = new URL(c.url).hostname;
      let got: string;
      let picture = "";
      if (!r.ok) {
        got = r.error.kind === "http_status" ? String(r.error.status) : r.error.kind;
      } else if (r.value.kind === "pdf") {
        got = "pdf";
        picture = `${r.value.doc.pages} pages`;
      } else {
        got = r.value.signIn ? "sign-in" : "page";
        picture = `${r.value.png.width}x${r.value.png.height}${r.value.cut ? " cut" : ""} ${r.value.png.file}`;
      }
      const ok = got === c.expect;
      if (!ok) passed = false;
      out(
        `  ${ok ? "ok  " : "FAIL"} ${host}${new URL(c.url).pathname} (${c.view}): ${got}, expected ${c.expect}, ${ms} ms ${picture}`,
      );
      if (!r.ok && !ok) out(`       ${failureText(r.error)}`);
    }
  }

  out(`\npictures: ${folder}`);
  out(passed ? "capture-check: passed" : "capture-check: FAILED");
  return passed;
}
