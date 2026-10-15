// Running the capture helper for a voice show (capture.ts), with a fake
// helper: a Node script that acts out each case from the URL's path, logs
// every run, and for /via-proxy goes through the real capture proxy with the
// credentials it was given. A local server answers the pre-flight for made-up
// public names; nothing here reaches the network or the real cache. The
// capturer is told which host it is on, so these run alike on every OS, and
// hosts that can't draw (not a Mac, an old macOS, no helper) are checked to
// say so without fetching or running anything.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { connect as netConnect, isIPv4, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  CAPTURE_LIMITS,
  createCapturer,
  failureText,
  macHelperBackend,
  macHelperSupport,
  type CaptureBackend,
  type CaptureFailure,
  type CaptureLimits,
  type CaptureSupport,
  type Capturer,
  type PdfDoc,
  type UrlShot,
} from "../src/capture.js";
import type { LookupAll } from "../src/net-guard.js";
import { err, type Result } from "../src/result.js";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The fake kleio-capture. Its log sits next to it: "<mode> <start> <end> <what>". */
const FAKE_HELPER = String.raw`
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const log = path.join(path.dirname(process.argv[1]), "calls.log");
const mode = process.argv[2];
const job = JSON.parse(fs.readFileSync(0, "utf8"));
const start = Date.now();
const png = Buffer.from("${PNG_1PX.toString("base64")}", "base64");
const answer = (o) => {
  const what = job.url ? new URL(job.url).pathname : path.basename(job.file || "");
  fs.appendFileSync(log, mode + " " + start + " " + Date.now() + " " + what + "\n");
  process.stdout.write(JSON.stringify(o) + "\n");
  process.exit(0);
};
const page = (extra) => {
  fs.writeFileSync(job.out, png);
  answer({ ok: true, status: 200, width: 2048, height: 1600, cut: false, signIn: false, webrtc: "off", ...extra });
};
const later = (ms, f) => setTimeout(f, ms);

if (mode === "pdf-info") {
  const body = fs.readFileSync(job.file, "utf8");
  const m = /^%PDF-fake pages=(\d+)/.exec(body);
  if (m) answer({ ok: true, pages: Number(m[1]), title: "Fake PDF" });
  answer({ ok: false, error: body.startsWith("locked") ? "locked" : "unreadable" });
}
if (mode === "pdf-page") {
  fs.writeFileSync(job.out, png);
  answer({ ok: true, width: job.width, height: 2000 });
}
const url = new URL(job.url);
switch (url.pathname) {
  case "/ok": page({ title: "Fake page" }); break;
  case "/signin": page({ signIn: true }); break;
  case "/forbidden": page({ status: 403, signIn: true }); break;
  case "/cut": page({ cut: true }); break;
  case "/status404": page({ status: 404 }); break;
  case "/slow": later(Number(url.searchParams.get("ms")), () => page({})); break;
  case "/hang": later(60000, () => page({})); break;
  case "/garbage": fs.appendFileSync(log, "web garbage\n"); process.stdout.write("not json\n"); break;
  case "/crash": process.exit(3); break;
  case "/nopng": answer({ ok: true, status: 200, width: 10, height: 10, cut: false, signIn: false }); break;
  case "/badpng": fs.writeFileSync(job.out, "not a png"); answer({ ok: true, status: 200, width: 10, height: 10, cut: false, signIn: false }); break;
  case "/blank": answer({ ok: false, error: "blank" }); break;
  case "/unreachable": answer({ ok: false, error: "unreachable" }); break;
  case "/refused": answer({ ok: false, error: "refused" }); break;
  case "/env": fs.writeFileSync(path.join(path.dirname(process.argv[1]), "env.json"), JSON.stringify(Object.keys(process.env).sort())); page({}); break;
  case "/via-proxy": {
    // SOCKS5 with the job's credentials to the page's own host, then GET /proxied.
    const s = net.connect(job.proxy.port, "127.0.0.1");
    let got = Buffer.alloc(0);
    let stage = 0;
    s.on("data", (d) => {
      got = Buffer.concat([got, d]);
      if (stage === 0 && got.length >= 2) {
        got = got.subarray(2); stage = 1;
        const u = Buffer.from(job.proxy.username), p = Buffer.from(job.proxy.password);
        s.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
      }
      if (stage === 1 && got.length >= 2) {
        const okAuth = got[1] === 0; got = got.subarray(2); stage = 2;
        if (!okAuth) answer({ ok: false, error: "unreachable" });
        const h = Buffer.from(url.hostname);
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([0, 80])]));
      }
      if (stage === 2 && got.length >= 10) {
        const code = got[1]; got = got.subarray(10); stage = 3;
        if (code !== 0) answer({ ok: false, error: "unreachable" });
        s.write("GET /proxied HTTP/1.0\r\nHost: " + url.hostname + "\r\n\r\n");
      }
      if (stage === 3 && got.toString().includes("proxied ok")) page({ title: "via proxy" });
    });
    s.on("error", () => answer({ ok: false, error: "unreachable" }));
    s.write(Buffer.from([5, 1, 2]));
    break;
  }
  default: answer({ ok: false, error: "unreachable" });
}
`;

interface Rig {
  readonly capturer: Capturer;
  readonly dir: string;
  readonly cacheDir: string;
  /** The fake helper's runs: [mode, start, end, what]. */
  runs(): [string, number, number, string][];
  /** Paths the site was asked for (the pre-flight, and the page through the proxy). */
  fetched(): string[];
}

interface RigOptions {
  readonly limits?: Partial<CaptureLimits>;
  readonly now?: () => number;
  /** What the page's proxy resolves names to, if not what the pre-flight did. */
  readonly proxyDns?: Readonly<Record<string, string>>;
  /** Where the capturer looks for its helper: the fake one by default. */
  readonly helperPath?: string;
  /** The host the capturer is on: a Mac on macOS 26 by default. */
  readonly platform?: NodeJS.Platform;
  readonly release?: string;
}

const PUBLIC: Readonly<Record<string, string>> = { "site.test": "93.184.215.14" };

function lookupFrom(table: Readonly<Record<string, string>>): LookupAll {
  return async (name) => {
    const address = table[name];
    if (!address) throw new Error(`ENOTFOUND ${name}`);
    return [{ address, family: isIPv4(address) ? 4 : 6 }];
  };
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

/** A fake helper, a site for the pre-flight and the proxy, and a capturer, all per test. */
async function rig(options: RigOptions = {}): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "kleio-capture-"));
  const helper = join(dir, "kleio-capture");
  writeFileSync(helper, `#!${process.execPath}\n${FAKE_HELPER}`);
  chmodSync(helper, 0o755);
  const fetched: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://site.test").pathname;
    fetched.push(path);
    if (path === "/doc.pdf") return send(res, 200, "application/pdf", "%PDF-fake pages=3");
    if (path === "/big.pdf") return send(res, 200, "application/pdf", "%PDF-fake pages=250");
    if (path === "/locked.pdf") return send(res, 200, "application/pdf", "locked");
    if (path === "/gone") return send(res, 404, "text/html", "<p>Not here</p>");
    if (path === "/proxied") return send(res, 200, "text/plain", "proxied ok");
    send(res, 200, "text/html", "<!doctype html><p>A page</p>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const toServer = () => netConnect({ host: "127.0.0.1", port });
  const cacheDir = join(dir, "cache");
  const capturer = createCapturer({
    backend: macHelperBackend({
      path: options.helperPath ?? helper,
      platform: options.platform ?? "darwin",
      release: options.release ?? "25.0.0",
    }),
    cacheDir,
    fetch: { lookup: lookupFrom(PUBLIC), connect: toServer },
    proxy: { lookup: lookupFrom(options.proxyDns ?? PUBLIC), connect: toServer },
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  const log = join(dir, "calls.log");
  return {
    capturer,
    dir,
    cacheDir,
    runs: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [mode = "", start = "0", end = "0", what = ""] = line.split(" ");
              return [mode, Number(start), Number(end), what];
            })
        : [],
    fetched: () => [...fetched],
  };
}

/** A backend that is never asked to draw here: only its support matters. */
function idle(support: CaptureSupport): CaptureBackend {
  return { support, run: () => Promise.resolve(err("broken")) };
}

const unavailable = (host: string) => ({ ok: false, error: { kind: "unavailable", host } });

function shot(r: Result<UrlShot, CaptureFailure>): UrlShot {
  if (!r.ok) throw new Error(`expected a capture, got ${JSON.stringify(r.error)}`);
  return r.value;
}

const captureFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith("c_")) : [];

/** The fake helper is a #! script, which Windows can't run. */
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("capture: pages", () => {
  it("draws a page through the helper, which gets working proxy credentials", async () => {
    const r = await rig();
    const got = shot(await r.capturer.url("http://site.test/via-proxy", "desktop"));
    expect(got).toMatchObject({ kind: "web", host: "site.test", status: 200, title: "via proxy" });
    if (got.kind !== "web") throw new Error("not a page");
    expect(got.png.file.startsWith(join(r.cacheDir, "c_"))).toBe(true);
    expect(readFileSync(got.png.file).equals(PNG_1PX)).toBe(true);
    expect(got.png).toMatchObject({ width: 2048, height: 1600, bytes: PNG_1PX.length });
    expect(r.runs().map(([mode, , , what]) => `${mode} ${what}`)).toEqual(["web /via-proxy"]);
  });

  it("flags sign-in walls, and draws a 403 as one rather than failing", async () => {
    const r = await rig();
    expect(shot(await r.capturer.url("http://site.test/signin", "phone"))).toMatchObject({
      signIn: true,
      status: 200,
    });
    expect(shot(await r.capturer.url("http://site.test/forbidden", "desktop"))).toMatchObject({
      signIn: true,
      status: 403,
    });
  });

  it("says when the page goes on past the picture", async () => {
    const r = await rig();
    expect(shot(await r.capturer.url("http://site.test/cut", "desktop"))).toMatchObject({
      cut: true,
    });
  });

  it("refuses a private or odd address before anything runs", async () => {
    const r = await rig();
    expect(await r.capturer.url("http://127.0.0.1/ok", "desktop")).toEqual({
      ok: false,
      error: { kind: "refused", refusal: "private_address", host: "127.0.0.1" },
    });
    expect(await r.capturer.url("file:///etc/passwd", "desktop")).toEqual({
      ok: false,
      error: { kind: "refused", refusal: "scheme", host: "" },
    });
    expect(r.runs()).toEqual([]);
  });

  it("ends the show on a site's 404, before drawing or after", async () => {
    const r = await rig();
    expect(await r.capturer.url("http://site.test/gone", "desktop")).toEqual({
      ok: false,
      error: { kind: "http_status", status: 404, host: "site.test" },
    });
    expect(r.runs()).toEqual([]);
    expect(await r.capturer.url("http://site.test/status404", "desktop")).toEqual({
      ok: false,
      error: { kind: "http_status", status: 404, host: "site.test" },
    });
    expect(captureFiles(r.cacheDir)).toEqual([]);
  });

  it("turns the helper's failures into plain kinds", async () => {
    const r = await rig();
    const kind = async (path: string) => {
      const got = await r.capturer.url(`http://site.test${path}`, "desktop");
      return got.ok ? "ok" : got.error;
    };
    expect(await kind("/blank")).toEqual({ kind: "blank", host: "site.test" });
    expect(await kind("/unreachable")).toEqual({ kind: "unreachable", host: "site.test" });
    expect(await kind("/refused")).toEqual({
      kind: "refused",
      refusal: "private_address",
      host: "site.test",
    });
  });

  it("calls it a private address when the page's own name turns private for the browser", async () => {
    // The pre-flight saw a public address; by the time the page loads, the name points home.
    const r = await rig({ proxyDns: { "site.test": "192.168.1.10" } });
    expect(await r.capturer.url("http://site.test/via-proxy", "desktop")).toEqual({
      ok: false,
      error: { kind: "refused", refusal: "private_address", host: "site.test" },
    });
  });

  it("calls bad helper output broken, and leaves nothing in the cache", async () => {
    const r = await rig();
    for (const path of ["/garbage", "/crash", "/nopng", "/badpng"]) {
      expect(await r.capturer.url(`http://site.test${path}`, "desktop"), path).toEqual({
        ok: false,
        error: { kind: "broken", host: "site.test" },
      });
    }
    expect(captureFiles(r.cacheDir)).toEqual([]);
  });

  it("kills a helper that takes too long", async () => {
    const r = await rig({ limits: { killAfterMs: 300 } });
    const started = Date.now();
    expect(await r.capturer.url("http://site.test/hang", "desktop")).toEqual({
      ok: false,
      error: { kind: "timeout", host: "site.test" },
    });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("stops the helper when the show is cancelled", async () => {
    const r = await rig();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    expect(await r.capturer.url("http://site.test/hang", "desktop", controller.signal)).toEqual({
      ok: false,
      error: { kind: "cancelled", host: "site.test" },
    });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("says unavailable when the helper goes missing after startup", async () => {
    const r = await rig();
    expect(r.capturer.support).toEqual({ available: true });
    rmSync(join(r.dir, "kleio-capture"));
    expect(await r.capturer.url("http://site.test/ok", "desktop")).toEqual(
      unavailable("site.test"),
    );
  });

  it("gives the helper none of the host's environment", async () => {
    const before = process.env.KLEIO_OPENAI_API_KEY;
    process.env.KLEIO_OPENAI_API_KEY = "sk-test-not-for-the-helper";
    onTestFinished(() => {
      if (before === undefined) delete process.env.KLEIO_OPENAI_API_KEY;
      else process.env.KLEIO_OPENAI_API_KEY = before;
    });
    const r = await rig();
    shot(await r.capturer.url("http://site.test/env", "desktop"));
    const keys: string[] = JSON.parse(readFileSync(join(r.dir, "env.json"), "utf8"));
    const allowed = ["HOME", "LANG", "LOGNAME", "PATH", "TMPDIR", "USER"];
    expect(keys.filter((k) => !allowed.includes(k) && !k.startsWith("__CF"))).toEqual([]);
  });
});

posixOnly("capture: one at a time, a few a minute, kept a while", () => {
  it("runs one page capture at a time", async () => {
    const r = await rig();
    await Promise.all(
      [1, 2, 3].map((n) => r.capturer.url(`http://site.test/slow?ms=150&n=${n}`, "desktop")),
    );
    const runs = r.runs().sort((a, b) => a[1] - b[1]);
    expect(runs).toHaveLength(3);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]?.[1], "each run starts after the one before ends").toBeGreaterThanOrEqual(
        runs[i - 1]?.[2] ?? Infinity,
      );
    }
  });

  it(`starts at most ${CAPTURE_LIMITS.perMinute} (here 2) page captures a minute`, async () => {
    let clock = 1_000_000;
    const r = await rig({ limits: { perMinute: 2 }, now: () => clock });
    shot(await r.capturer.url("http://site.test/ok?a", "desktop"));
    shot(await r.capturer.url("http://site.test/ok?b", "desktop"));
    expect(await r.capturer.url("http://site.test/ok?c", "desktop")).toEqual({
      ok: false,
      error: { kind: "busy", host: "site.test" },
    });
    clock += 61_000;
    shot(await r.capturer.url("http://site.test/ok?c", "desktop"));
  });

  it("keeps a page for the cache time, then draws it again", async () => {
    let clock = 1_000_000;
    const r = await rig({ now: () => clock });
    const first = shot(await r.capturer.url("http://site.test/ok", "desktop"));
    expect(shot(await r.capturer.url("http://site.test/ok", "desktop"))).toEqual(first);
    expect(r.runs()).toHaveLength(1);
    // A phone view is a different picture.
    shot(await r.capturer.url("http://site.test/ok", "phone"));
    expect(r.runs()).toHaveLength(2);
    clock += CAPTURE_LIMITS.cacheMs + 1;
    const again = shot(await r.capturer.url("http://site.test/ok", "desktop"));
    expect(r.runs()).toHaveLength(3);
    if (first.kind !== "web" || again.kind !== "web") throw new Error("not pages");
    expect(existsSync(first.png.file)).toBe(false);
    expect(existsSync(again.png.file)).toBe(true);
  });

  it("keeps the cache under its size, dropping the oldest first", async () => {
    const r = await rig({ limits: { cacheBytes: PNG_1PX.length + 10 } });
    const first = shot(await r.capturer.url("http://site.test/ok?1", "desktop"));
    const second = shot(await r.capturer.url("http://site.test/ok?2", "desktop"));
    if (first.kind !== "web" || second.kind !== "web") throw new Error("not pages");
    expect(existsSync(first.png.file)).toBe(false);
    expect(existsSync(second.png.file)).toBe(true);
    // The dropped page is drawn again when asked for.
    shot(await r.capturer.url("http://site.test/ok?1", "desktop"));
    expect(r.runs()).toHaveLength(3);
  });

  it("clears its own files at startup, leaves anything else, and keeps the folder 0700", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kleio-capture-start-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const old = join(dir, `c_${"a".repeat(32)}.png`);
    const other = join(dir, "notes.txt");
    writeFileSync(old, "old");
    writeFileSync(other, "keep me");
    chmodSync(dir, 0o755);
    createCapturer({ backend: idle({ available: true }), cacheDir: dir });
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(other, "utf8")).toBe("keep me");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe("capture: hosts that can't draw pages or PDFs", () => {
  const someDoc = (dir: string): PdfDoc => ({
    id: `d_${"0".repeat(32)}`,
    file: join(dir, "doc.pdf"),
    pages: 3,
    totalPages: 3,
  });

  it.each(["linux", "win32"] as const)(
    "says so on %s, without throwing, fetching or running anything",
    async (platform) => {
      const r = await rig({ platform });
      expect(r.capturer.support).toEqual({ available: false, reason: "not_macos" });
      expect(await r.capturer.url("http://site.test/ok", "desktop")).toEqual(
        unavailable("site.test"),
      );
      expect(await r.capturer.url("https://site.test/doc.pdf", "phone")).toEqual(
        unavailable("site.test"),
      );
      expect(await r.capturer.pdf(Buffer.from("%PDF-fake pages=3"))).toEqual(unavailable(""));
      expect(await r.capturer.pdfPage(someDoc(r.dir), 1)).toEqual(unavailable(""));
      expect(r.fetched()).toEqual([]);
      expect(r.runs()).toEqual([]);
      expect(existsSync(r.cacheDir)).toBe(false);
    },
  );

  it("still calls a private address refused, so its link is never offered instead", async () => {
    const r = await rig({ platform: "linux" });
    expect(await r.capturer.url("http://169.254.169.254/latest/meta-data/", "desktop")).toEqual({
      ok: false,
      error: { kind: "refused", refusal: "private_address", host: "169.254.169.254" },
    });
    expect(r.fetched()).toEqual([]);
  });

  it("says so on a Mac older than macOS 14", async () => {
    const r = await rig({ platform: "darwin", release: "22.6.0" });
    expect(r.capturer.support).toEqual({ available: false, reason: "old_macos" });
    expect(await r.capturer.url("http://site.test/ok", "desktop")).toEqual(
      unavailable("site.test"),
    );
    expect(r.fetched()).toEqual([]);
    expect(r.runs()).toEqual([]);
  });

  it("says so when the helper binary is missing, before fetching anything", async () => {
    const empty = mkdtempSync(join(tmpdir(), "kleio-capture-missing-"));
    onTestFinished(() => rmSync(empty, { recursive: true, force: true }));
    const r = await rig({ helperPath: join(empty, "kleio-capture") });
    expect(r.capturer.support).toEqual({ available: false, reason: "no_helper" });
    expect(await r.capturer.url("http://site.test/ok", "desktop")).toEqual(
      unavailable("site.test"),
    );
    expect(await r.capturer.pdf(Buffer.from("%PDF-fake pages=3"))).toEqual(unavailable(""));
    expect(r.fetched()).toEqual([]);
    expect(r.runs()).toEqual([]);
  });

  it("makes no cache folder, but still clears what an earlier run left", () => {
    const dir = mkdtempSync(join(tmpdir(), "kleio-capture-start-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const fresh = join(dir, "never-made");
    createCapturer({ backend: idle({ available: false, reason: "not_macos" }), cacheDir: fresh });
    expect(existsSync(fresh)).toBe(false);
    const old = join(dir, `c_${"b".repeat(32)}.png`);
    writeFileSync(old, "a page seen before the helper went");
    createCapturer({ backend: idle({ available: false, reason: "no_helper" }), cacheDir: dir });
    expect(existsSync(old)).toBe(false);
  });
});

describe("macHelperSupport", () => {
  const helperIn = (dir: string): string => {
    const helper = join(dir, "kleio-capture");
    writeFileSync(helper, "");
    chmodSync(helper, 0o755);
    return helper;
  };

  it("needs a Mac on macOS 14 or later, with the helper built", () => {
    const dir = mkdtempSync(join(tmpdir(), "kleio-capture-support-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const path = helperIn(dir);
    const on = (platform: NodeJS.Platform, release: string) =>
      macHelperSupport({ path, platform, release });
    expect(on("darwin", "25.1.0")).toEqual({ available: true });
    expect(on("darwin", "23.0.0")).toEqual({ available: true }); // macOS 14
    expect(on("darwin", "22.6.0")).toEqual({ available: false, reason: "old_macos" }); // macOS 13
    expect(on("darwin", "")).toEqual({ available: false, reason: "old_macos" });
    expect(on("linux", "6.8.0-45-generic")).toEqual({ available: false, reason: "not_macos" });
    expect(on("win32", "10.0.22631")).toEqual({ available: false, reason: "not_macos" });
    const missing = { platform: "darwin", release: "25.1.0" } as const;
    expect(macHelperSupport({ ...missing, path: join(dir, "nope") })).toEqual({
      available: false,
      reason: "no_helper",
    });
    expect(macHelperSupport({ ...missing, path: dir })).toEqual({
      available: false,
      reason: "no_helper",
    });
  });

  it.skipIf(process.platform === "win32")("needs the helper to be executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "kleio-capture-support-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const path = helperIn(dir);
    chmodSync(path, 0o644);
    expect(macHelperSupport({ path, platform: "darwin", release: "25.1.0" })).toEqual({
      available: false,
      reason: "no_helper",
    });
  });
});

posixOnly("capture: PDFs", () => {
  it("sends a PDF link down the PDF path, never the page path", async () => {
    const r = await rig();
    const got = shot(await r.capturer.url("http://site.test/doc.pdf", "desktop"));
    expect(got).toMatchObject({ kind: "pdf", host: "site.test" });
    if (got.kind !== "pdf") throw new Error("not a PDF");
    expect(got.doc).toMatchObject({ pages: 3, totalPages: 3, title: "Fake PDF" });
    expect(readFileSync(got.doc.file, "utf8")).toBe("%PDF-fake pages=3");
    expect(r.runs().map(([mode]) => mode)).toEqual(["pdf-info"]);

    const page = await r.capturer.pdfPage(got.doc, 2);
    expect(page).toMatchObject({
      ok: true,
      value: { width: CAPTURE_LIMITS.pdfPageWidthPx, height: 2000 },
    });
    expect(await r.capturer.pdfPage(got.doc, 4)).toEqual({
      ok: false,
      error: { kind: "no_page", host: "" },
    });
    expect(await r.capturer.pdfPage(got.doc, 0)).toEqual({
      ok: false,
      error: { kind: "no_page", host: "" },
    });
    // A page drawn once is kept.
    await r.capturer.pdfPage(got.doc, 2);
    expect(r.runs().map(([mode]) => mode)).toEqual(["pdf-info", "pdf-page"]);
  });

  it("shows at most 100 pages of a long PDF", async () => {
    const r = await rig();
    const got = shot(await r.capturer.url("http://site.test/big.pdf", "desktop"));
    if (got.kind !== "pdf") throw new Error("not a PDF");
    expect(got.doc).toMatchObject({ pages: 100, totalPages: 250 });
    expect(await r.capturer.pdfPage(got.doc, 101)).toEqual({
      ok: false,
      error: { kind: "no_page", host: "" },
    });
  });

  it("says when a PDF is locked or unreadable, and keeps neither", async () => {
    const r = await rig();
    expect(await r.capturer.url("http://site.test/locked.pdf", "desktop")).toEqual({
      ok: false,
      error: { kind: "locked", host: "site.test" },
    });
    expect(await r.capturer.pdf(Buffer.from("not a pdf"))).toEqual({
      ok: false,
      error: { kind: "unreadable", host: "" },
    });
    expect(captureFiles(r.cacheDir)).toEqual([]);
  });

  it("counts a file's PDF once, however often it is shown", async () => {
    const r = await rig();
    const a = await r.capturer.pdf(Buffer.from("%PDF-fake pages=7"));
    const b = await r.capturer.pdf(Buffer.from("%PDF-fake pages=7"));
    expect(a).toEqual(b);
    expect(r.runs().map(([mode]) => mode)).toEqual(["pdf-info"]);
  });

  it("says expired when the PDF has left the cache", async () => {
    const r = await rig();
    const doc = await r.capturer.pdf(Buffer.from("%PDF-fake pages=2"));
    if (!doc.ok) throw new Error("no PDF");
    rmSync(doc.value.file);
    expect(await r.capturer.pdfPage(doc.value, 1)).toEqual({
      ok: false,
      error: { kind: "expired", host: "" },
    });
  });
});

describe("failureText", () => {
  it("has plain words for every failure", () => {
    const failures: CaptureFailure[] = [
      { kind: "refused", refusal: "private_address", host: "10.0.0.1" },
      { kind: "refused", refusal: "unresolved", host: "nowhere.test" },
      { kind: "refused", refusal: "scheme", host: "" },
      { kind: "http_status", status: 404, host: "site.test" },
      { kind: "http_status", status: 503, host: "site.test" },
      { kind: "http_status", status: 429, host: "site.test" },
      ...(
        [
          "unreachable",
          "timeout",
          "too_large",
          "busy",
          "blank",
          "not_a_page",
          "unavailable",
          "broken",
          "unreadable",
          "locked",
          "no_page",
          "expired",
          "cancelled",
        ] as const
      ).map((kind) => ({ kind, host: "site.test" })),
    ];
    for (const f of failures) {
      const words = failureText(f);
      expect(words.length, f.kind).toBeGreaterThan(5);
      expect(words).not.toMatch(/undefined|null|\[object/);
    }
    expect(failureText({ kind: "http_status", status: 404, host: "site.test" })).toBe(
      "There's no page at that address (site.test answered 404).",
    );
    expect(failureText({ kind: "refused", refusal: "private_address", host: "10.0.0.1" })).toBe(
      "That page is on a private network, so it can't be shown.",
    );
    expect(failureText({ kind: "unavailable", host: "site.test" })).toBe(
      "Kleio can't show web pages or PDFs on this host.",
    );
  });
});

// Keeps the fake helper honest: it must run as a script on this machine.
posixOnly("the fake helper", () => {
  it("runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "kleio-capture-fake-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const helper = join(dir, "kleio-capture");
    writeFileSync(helper, `#!${process.execPath}\n${FAKE_HELPER}`);
    chmodSync(helper, 0o755);
    const r = spawnSync(helper, ["pdf-info"], {
      input: JSON.stringify({ file: helper }),
      encoding: "utf8",
    });
    expect(r.stdout.trim()).toBe('{"ok":false,"error":"unreadable"}');
  });
});
