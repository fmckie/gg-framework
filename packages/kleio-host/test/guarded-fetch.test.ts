// The fetch behind a voice show's web pages and PDFs (guarded-fetch.ts): every
// hop judged and pinned to the address that was checked, redirects to private
// or local targets refused before any connection is made, PDF detection, and
// the size caps and clocks. A local server answers for made-up public names;
// the fake connector records where each connection was asked to go and only
// ever reaches that server.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, isIPv4, type AddressInfo } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isArxivPdf,
  MAX_HOPS,
  pdfVerdict,
  preflight,
  type FetchOptions,
  type Preflight,
  type TlsPeer,
} from "../src/guarded-fetch.js";
import type { LookupAll } from "../src/net-guard.js";
import type { Result } from "../src/result.js";

/** Made-up names and the addresses the fake resolver gives them. */
const DNS: Readonly<Record<string, readonly string[]>> = {
  "site.test": ["93.184.215.14"],
  "other.test": ["151.101.0.81"],
  "v6.test": ["2606:4700:4700::1111"],
  "arxiv.org": ["151.101.3.42"],
  "private.test": ["192.168.1.10"],
  "mixed.test": ["93.184.215.14", "10.0.0.5"],
  "tailnet.test": ["100.101.102.103"],
};

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200_000, 0x61)]);
const PAGE = "<!doctype html><title>Hello</title><p>A page.</p>";
/** 10 MB of PDF once decompressed, a few KB on the wire. */
const BOMB = gzipSync(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024)]));

function page(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
}

function body(res: ServerResponse, type: string, bytes: Buffer, extra = {}): void {
  res.writeHead(200, { "content-type": type, "content-length": bytes.length, ...extra });
  res.end(bytes);
}

/** The test server's answers, by path: the host name only matters to /echo-host. */
function route(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://server.test");
  const chain = /^\/redirect\/(\d+)$/.exec(url.pathname);
  if (chain) {
    const left = Number(chain[1]);
    if (left === 0) return page(res);
    res.writeHead(302, { location: `/redirect/${left - 1}` });
    res.end();
    return;
  }
  switch (url.pathname) {
    case "/page":
    case "/abs/2401.00001":
      return page(res);
    case "/to":
      res.writeHead(302, { location: url.searchParams.get("u") ?? "/" });
      res.end();
      return;
    case "/relative":
      res.writeHead(301, { location: "page" });
      res.end();
      return;
    case "/echo-host":
      return body(res, "application/pdf", Buffer.from(`%PDF-${req.headers.host ?? ""}`));
    case "/typed":
      return body(res, "application/pdf; charset=binary", PDF);
    case "/magic":
      // Untyped, and its magic split across two writes.
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(PDF.subarray(0, 3));
      setTimeout(() => res.end(PDF.subarray(3)), 20);
      return;
    case "/paper.pdf":
    case "/pdf/2401.00001v2":
      return body(res, "application/octet-stream", Buffer.from("bytes from a link"));
    case "/signin.pdf":
      return body(res, "text/html", Buffer.from("<html><form>Sign in</form></html>"));
    case "/gzip":
      return body(res, "application/octet-stream", gzipSync(PDF), { "content-encoding": "gzip" });
    case "/deflate":
      return body(res, "application/octet-stream", deflateSync(PDF), {
        "content-encoding": "deflate",
      });
    case "/br":
      return body(res, "application/octet-stream", brotliCompressSync(PDF), {
        "content-encoding": "br",
      });
    case "/gzip-page":
      return body(res, "text/html", gzipSync(Buffer.from(PAGE)), { "content-encoding": "gzip" });
    case "/declared-big":
      return body(res, "application/pdf", Buffer.alloc(5_000, 0x25));
    case "/streamed-big":
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write("%PDF-1.4\n");
      res.end(Buffer.alloc(5_000));
      return;
    case "/bomb":
      return body(res, "application/octet-stream", BOMB, { "content-encoding": "gzip" });
    case "/stall-headers":
      return; // never answers
    case "/stall-pdf":
      res.writeHead(200, { "content-type": "application/pdf" });
      res.write("%PDF-1.4\n");
      return; // never finishes
    case "/stall-page":
      res.writeHead(200, { "content-type": "text/html" });
      res.flushHeaders();
      return; // never sends a byte of the page
    default:
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<p>Not found</p>");
  }
}

let server: Server;
let serverPort: number;

beforeAll(async () => {
  server = createServer(route);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  serverPort = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

interface Harness {
  readonly options: FetchOptions;
  /** Names looked up, in order. */
  readonly lookups: string[];
  /** "address port" each connection was asked to go to, in order. */
  readonly connects: string[];
  /** Who TLS was asked to verify, in order. */
  readonly peers: TlsPeer[];
}

/** Fresh recorders per test; every connection actually lands on the test server. */
function harness(extra: Partial<FetchOptions> = {}, port = (): number => serverPort): Harness {
  const lookups: string[] = [];
  const connects: string[] = [];
  const peers: TlsPeer[] = [];
  const lookup: LookupAll = async (name) => {
    lookups.push(name);
    const found = DNS[name];
    if (!found) throw new Error(`ENOTFOUND ${name}`);
    return found.map((address) => ({ address, family: isIPv4(address) ? 4 : 6 }));
  };
  return {
    lookups,
    connects,
    peers,
    options: {
      lookup,
      connect: (to) => {
        connects.push(`${to.address} ${to.port}`);
        return netConnect({ host: "127.0.0.1", port: port() });
      },
      // Plain HTTP stands in for TLS: what matters is who TLS was asked to verify.
      secure: (socket, peer) => {
        peers.push(peer);
        return socket;
      },
      headersTimeoutMs: 2_000,
      bodyTimeoutMs: 2_000,
      ...extra,
    },
  };
}

function value(r: Result<Preflight, unknown>): Preflight {
  if (!r.ok) throw new Error(`expected an answer, got ${JSON.stringify(r.error)}`);
  return r.value;
}

const to = (target: string): string => `http://site.test/to?u=${encodeURIComponent(target)}`;

describe("preflight: every hop judged and pinned", () => {
  it("fetches a public page: one lookup, one connection to the address it checked", async () => {
    const h = harness();
    const got = value(await preflight("http://site.test/page", h.options));
    expect(got).toMatchObject({ status: 200, contentType: "text/html", hops: 0, isPdf: false });
    expect(got.finalUrl.href).toBe("http://site.test/page");
    expect(got.pdf).toBeUndefined();
    expect(h.lookups).toEqual(["site.test"]);
    expect(h.connects).toEqual(["93.184.215.14 80"]);
    expect(h.peers).toEqual([]);
  });

  it("judges each hop of a redirect chain afresh, with one lookup per hop", async () => {
    const h = harness();
    const chain = to(`https://other.test/to?u=${encodeURIComponent("http://v6.test/page")}`);
    const got = value(await preflight(chain, h.options));
    expect(got).toMatchObject({ status: 200, hops: 2 });
    expect(got.finalUrl.href).toBe("http://v6.test/page");
    expect(h.lookups).toEqual(["site.test", "other.test", "v6.test"]);
    expect(h.connects).toEqual(["93.184.215.14 80", "151.101.0.81 443", "2606:4700:4700::1111 80"]);
    expect(h.peers).toEqual([{ host: "other.test", servername: "other.test" }]);
  });

  it("connects to the address it checked, not a second answer for the name", async () => {
    let calls = 0;
    const rebinding: LookupAll = async () => {
      calls++;
      return [{ address: calls === 1 ? "93.184.215.14" : "127.0.0.1", family: 4 }];
    };
    const h = harness();
    value(await preflight("http://site.test/page", { ...h.options, lookup: rebinding }));
    expect(calls).toBe(1);
    expect(h.connects).toEqual(["93.184.215.14 80"]);

    // A redirect back to the same name is looked up again, and refused once it rebinds.
    calls = 0;
    const h2 = harness();
    const r = await preflight(to("/page"), { ...h2.options, lookup: rebinding });
    expect(r).toEqual({
      ok: false,
      error: { kind: "refused", refusal: "private_address", host: "site.test" },
    });
    expect(calls).toBe(2);
    expect(h2.connects).toEqual(["93.184.215.14 80"]);
  });

  it("follows a relative redirect", async () => {
    const h = harness();
    const got = value(await preflight("http://site.test/relative", h.options));
    expect(got.finalUrl.href).toBe("http://site.test/page");
    expect(got.hops).toBe(1);
  });

  it("sends the URL's name as the Host and to TLS, and an address only as the address", async () => {
    const h = harness();
    const named = value(await preflight("https://site.test/echo-host", h.options));
    expect(named.pdf?.toString()).toBe("%PDF-site.test");
    expect(h.peers).toEqual([{ host: "site.test", servername: "site.test" }]);
    expect(h.connects).toEqual(["93.184.215.14 443"]);

    const h2 = harness();
    const literal = value(await preflight("https://93.184.215.14/echo-host", h2.options));
    expect(literal.pdf?.toString()).toBe("%PDF-93.184.215.14");
    expect(h2.lookups).toEqual([]);
    expect(h2.peers).toEqual([{ host: "93.184.215.14" }]);
    expect(h2.connects).toEqual(["93.184.215.14 443"]);
  });

  it(`follows ${MAX_HOPS} redirects and refuses one more`, async () => {
    const h = harness();
    const got = value(await preflight(`http://site.test/redirect/${MAX_HOPS}`, h.options));
    expect(got).toMatchObject({ status: 200, hops: MAX_HOPS });

    const h2 = harness();
    const r = await preflight(`http://site.test/redirect/${MAX_HOPS + 1}`, h2.options);
    expect(r).toEqual({ ok: false, error: { kind: "too_many_redirects", host: "site.test" } });
    expect(h2.connects).toHaveLength(MAX_HOPS + 1);
  });

  it.each([
    ["http://localhost/", "local_name"],
    ["http://127.0.0.1/", "private_address"],
    ["http://[::1]/", "private_address"],
    ["http://169.254.169.254/latest/meta-data/", "private_address"],
    ["http://100.100.100.100/", "private_address"],
    ["http://10.0.0.1/", "private_address"],
    ["http://2130706433/", "private_address"],
    ["http://[::ffff:7f00:1]/", "private_address"],
    ["http://private.test/", "private_address"],
    ["http://mixed.test/", "private_address"],
    ["http://tailnet.test/", "private_address"],
    ["http://metadata.google.internal/", "local_name"],
    ["https://mac-mini-1.taila6c237.ts.net/", "local_name"],
    ["http://unknown.test/", "unresolved"],
    ["file:///etc/passwd", "scheme"],
    ["ftp://site.test/", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["http://site.test:22/", "port"],
    ["http://user:pass@site.test/", "credentials"],
    ["http://[::1", "bad_url"],
  ])("refuses a redirect to %s without connecting to it", async (target, refusal) => {
    const h = harness();
    const r = await preflight(to(target), h.options);
    expect(r).toEqual({ ok: false, error: { kind: "refused", refusal, host: expect.any(String) } });
    expect(h.connects).toEqual(["93.184.215.14 80"]);
  });

  it("refuses a first address that isn't allowed without connecting", async () => {
    const literal = harness();
    expect(await preflight("http://10.0.0.1/", literal.options)).toEqual({
      ok: false,
      error: { kind: "refused", refusal: "private_address", host: "" },
    });
    expect(literal.lookups).toEqual([]);
    expect(literal.connects).toEqual([]);

    const named = harness();
    expect(await preflight("http://private.test/", named.options)).toEqual({
      ok: false,
      error: { kind: "refused", refusal: "private_address", host: "private.test" },
    });
    expect(named.lookups).toEqual(["private.test"]);
    expect(named.connects).toEqual([]);
  });
});

describe("preflight: PDFs and pages", () => {
  it("knows a PDF by its type and brings all of it", async () => {
    const got = value(await preflight("http://site.test/typed", harness().options));
    expect(got).toMatchObject({ isPdf: true, contentType: "application/pdf" });
    expect(got.pdf?.equals(PDF)).toBe(true);
  });

  it("knows an untyped PDF by its first bytes and brings all of it", async () => {
    const got = value(await preflight("http://site.test/magic", harness().options));
    expect(got.isPdf).toBe(true);
    expect(got.pdf?.equals(PDF)).toBe(true);
  });

  it("knows a PDF by a link ending .pdf, and arXiv's /pdf/<id>", async () => {
    const link = value(await preflight("http://site.test/paper.pdf", harness().options));
    expect(link.isPdf).toBe(true);
    expect(link.pdf?.toString()).toBe("bytes from a link");
    const arxiv = value(await preflight("https://arxiv.org/pdf/2401.00001v2", harness().options));
    expect(arxiv.isPdf).toBe(true);
    const abstract = value(await preflight("https://arxiv.org/abs/2401.00001", harness().options));
    expect(abstract.isPdf).toBe(false);
  });

  it("treats a web page at a .pdf address as a page", async () => {
    const got = value(await preflight("http://site.test/signin.pdf", harness().options));
    expect(got).toMatchObject({ isPdf: false, contentType: "text/html" });
    expect(got.pdf).toBeUndefined();
  });

  it.each(["gzip", "deflate", "br"])("decompresses a %s body", async (encoding) => {
    const got = value(await preflight(`http://site.test/${encoding}`, harness().options));
    expect(got.isPdf).toBe(true);
    expect(got.pdf?.equals(PDF)).toBe(true);
  });

  it("reads a compressed page as a page", async () => {
    const got = value(await preflight("http://site.test/gzip-page", harness().options));
    expect(got.isPdf).toBe(false);
  });

  it("returns a 4xx answer as it is, for the caller to explain", async () => {
    const got = value(await preflight("http://site.test/missing", harness().options));
    expect(got).toMatchObject({ status: 404, isPdf: false });
  });
});

describe("preflight: caps and clocks", () => {
  it("refuses a PDF whose declared size is over the cap", async () => {
    const r = await preflight(
      "http://site.test/declared-big",
      harness({ maxPdfBytes: 1_000 }).options,
    );
    expect(r).toEqual({ ok: false, error: { kind: "too_large", host: "site.test" } });
  });

  it("stops reading a PDF once it passes the cap", async () => {
    const r = await preflight(
      "http://site.test/streamed-big",
      harness({ maxPdfBytes: 1_000 }).options,
    );
    expect(r).toEqual({ ok: false, error: { kind: "too_large", host: "site.test" } });
  });

  it("counts decompressed bytes, so a small bomb is still too big", async () => {
    const r = await preflight(
      "http://site.test/bomb",
      harness({ maxPdfBytes: 1024 * 1024 }).options,
    );
    expect(r).toEqual({ ok: false, error: { kind: "too_large", host: "site.test" } });
  });

  it("gives up on a site that never answers", async () => {
    const started = Date.now();
    const r = await preflight(
      "http://site.test/stall-headers",
      harness({ headersTimeoutMs: 150 }).options,
    );
    expect(r).toEqual({ ok: false, error: { kind: "timeout", host: "site.test" } });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("gives up on a PDF that stops arriving", async () => {
    const r = await preflight(
      "http://site.test/stall-pdf",
      harness({ bodyTimeoutMs: 150 }).options,
    );
    expect(r).toEqual({ ok: false, error: { kind: "timeout", host: "site.test" } });
  });

  it("calls a page with a slow start a page", async () => {
    const got = value(
      await preflight("http://site.test/stall-page", harness({ headersTimeoutMs: 150 }).options),
    );
    expect(got).toMatchObject({ status: 200, isPdf: false });
  });

  it("says unreachable when nothing listens", async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const r = await preflight("http://site.test/page", harness({}, () => port).options);
    expect(r).toEqual({ ok: false, error: { kind: "unreachable", host: "site.test" } });
  });

  it("stops when the caller gives up, and connects to nothing once it has", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const r = await preflight(
      "http://site.test/stall-headers",
      harness({ signal: controller.signal }).options,
    );
    expect(r).toEqual({ ok: false, error: { kind: "timeout", host: "site.test" } });

    const h = harness({ signal: AbortSignal.abort() });
    expect(await preflight("http://site.test/page", h.options)).toEqual({
      ok: false,
      error: { kind: "timeout", host: "site.test" },
    });
    expect(h.connects).toEqual([]);
  });
});

describe("pdfVerdict and isArxivPdf", () => {
  const none = Buffer.alloc(0);
  const magic = Buffer.from("%PDF-1.7");

  it("trusts a PDF type, then the first bytes, then a link that isn't a web page", () => {
    const plain = new URL("https://site.test/download?id=3");
    const named = new URL("https://site.test/files/Report.PDF");
    expect(pdfVerdict(plain, "application/pdf", none)).toBe(true);
    expect(pdfVerdict(plain, "application/x-pdf", none)).toBe(true);
    expect(pdfVerdict(plain, "application/octet-stream", magic)).toBe(true);
    expect(pdfVerdict(plain, "text/html", magic)).toBe(true);
    expect(pdfVerdict(plain, "application/octet-stream", Buffer.from("PK\x03\x04"))).toBe(false);
    expect(pdfVerdict(named, "", none)).toBe(true);
    expect(pdfVerdict(named, "application/octet-stream", none)).toBe(true);
    expect(pdfVerdict(named, "text/html", none)).toBe(false);
    expect(pdfVerdict(named, "application/xhtml+xml", none)).toBe(false);
  });

  it("knows arXiv's PDF links, old and new, and nothing that only looks like them", () => {
    for (const u of [
      "https://arxiv.org/pdf/2401.00001",
      "https://arxiv.org/pdf/2401.00001v2",
      "https://www.arxiv.org/pdf/2401.00001/",
      "https://export.arxiv.org/pdf/hep-th/9901001v1",
      "https://arxiv.org/pdf/math.AG/0601001",
    ]) {
      expect(isArxivPdf(new URL(u)), u).toBe(true);
    }
    for (const u of [
      "https://arxiv.org/abs/2401.00001",
      "https://arxiv.org/pdf/",
      "https://evilarxiv.org/pdf/2401.00001",
      "https://arxiv.org.evil.test/pdf/2401.00001",
      "https://arxiv.org/pdf/a/b/c",
    ]) {
      expect(isArxivPdf(new URL(u)), u).toBe(false);
    }
  });
});
