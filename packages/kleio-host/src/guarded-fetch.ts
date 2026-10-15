// The host's one way to fetch a web address for a voice show (show.ts): the
// pre-flight that tells a PDF from a page, and a PDF's bytes.
//
// A GET with redirects followed by hand, at most MAX_HOPS of them, and every
// hop judged afresh by net-guard.ts: the URL (scheme, credentials, port,
// length), the name (never a local one), and every address it resolves to.
// The connection goes to the very address that was checked (no second
// lookup), with the name kept for TLS and the Host header. A redirect to a
// private address, a local name or another scheme stops the fetch before any
// connection is made to it.

import { request as httpRequest, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import {
  checkHostname,
  checkUrl,
  connectPinned,
  portOf,
  resolvePublic,
  systemLookup,
  type Connector,
  type GuardRefusal,
  type LookupAll,
  type PinnedAddress,
} from "./net-guard.js";
import { err, ok, type Result } from "./result.js";

/** Redirects followed before giving up. */
export const MAX_HOPS = 5;
/** How long a hop may take to send its headers, and a page its first bytes. */
export const HEADERS_TIMEOUT_MS = 8_000;
/** How long a PDF may take to arrive, all of it. */
export const BODY_TIMEOUT_MS = 30_000;
/** The largest PDF fetched (after decompression). */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Sent as Safari does, so sites answer as they would a visitor. */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const PDF_MAGIC = Buffer.from("%PDF-");

export type FetchFailure =
  /** A hop's URL or address was refused: nothing was sent to it. */
  | { readonly kind: "refused"; readonly refusal: GuardRefusal; readonly host: string }
  | { readonly kind: "too_many_redirects"; readonly host: string }
  | { readonly kind: "unreachable"; readonly host: string }
  | { readonly kind: "timeout"; readonly host: string }
  | { readonly kind: "too_large"; readonly host: string };

export interface Preflight {
  /** Where the last hop went. */
  readonly finalUrl: URL;
  readonly status: number;
  /** The Content-Type's essence, lowercase ("" when absent). */
  readonly contentType: string;
  /** Redirects followed. */
  readonly hops: number;
  /** Whether the answer is a PDF (pdfVerdict). Only a 2xx answer is. */
  readonly isPdf: boolean;
  /** A PDF's bytes, decompressed. */
  readonly pdf?: Buffer;
}

/** Who TLS talks to over a connection made to a checked address. */
export interface TlsPeer {
  /** What the certificate must match: the URL's name, or its address. */
  readonly host: string;
  /** Sent as SNI: names only, never an address. */
  readonly servername?: string;
}

export interface FetchOptions {
  readonly lookup?: LookupAll;
  readonly connect?: Connector;
  /** TLS over a connected socket (tests replace it). */
  readonly secure?: (socket: Socket, peer: TlsPeer) => Socket;
  readonly headersTimeoutMs?: number;
  readonly bodyTimeoutMs?: number;
  readonly maxPdfBytes?: number;
  readonly signal?: AbortSignal;
}

/** arXiv's PDF links have no extension: arxiv.org/pdf/2401.00001v2, /pdf/hep-th/9901001. */
export function isArxivPdf(url: URL): boolean {
  return (
    /^(?:www\.|export\.)?arxiv\.org$/.test(url.hostname) &&
    /^\/pdf\/(?:[\w.-]+\/)?[\w.-]+\/?$/.test(url.pathname)
  );
}

/**
 * Whether an answer is a PDF: its type says so, its body starts "%PDF-", or
 * the link names one (a path ending .pdf, arXiv's /pdf/<id>) and the answer
 * isn't a web page (a sign-in page at a .pdf address is shown as a page).
 */
export function pdfVerdict(url: URL, contentType: string, head: Buffer): boolean {
  if (contentType === "application/pdf" || contentType === "application/x-pdf") return true;
  if (head.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return true;
  if (/html|xml/.test(contentType)) return false;
  return /\.pdf$/i.test(url.pathname) || isArxivPdf(url);
}

function essence(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** TLS over a connection to a checked address, verified against the URL's name. */
const secureSocket = (socket: Socket, peer: TlsPeer): Socket =>
  tlsConnect({
    socket,
    host: peer.host,
    ...(peer.servername ? { servername: peer.servername } : {}),
    ALPNProtocols: ["http/1.1"],
  });

interface Io {
  readonly lookup: LookupAll;
  readonly connect: Connector;
  readonly secure: (socket: Socket, peer: TlsPeer) => Socket;
  readonly headersTimeoutMs: number;
  readonly signal: AbortSignal | undefined;
}

/** Sends the GET over `stream`; resolves with the answer's headers. */
function send(
  url: URL,
  stream: Socket,
  to: PinnedAddress & { readonly port: number },
  io: Io,
): Promise<Result<IncomingMessage, "unreachable" | "timeout">> {
  return new Promise((resolve) => {
    const req = httpRequest({
      method: "GET",
      // The checked address: only ever dialled if createConnection weren't used.
      host: to.address,
      port: to.port,
      family: to.family,
      path: `${url.pathname}${url.search}`,
      setHost: false,
      headers: {
        host: url.host,
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
      },
      // No `agent` (not even `agent: false`): with one, Node ignores
      // createConnection and dials `host` itself.
      createConnection: () => stream,
    });
    const settle = (r: Result<IncomingMessage, "unreachable" | "timeout">): void => {
      clearTimeout(timer);
      io.signal?.removeEventListener("abort", stop);
      resolve(r);
    };
    const stop = (): void => {
      req.destroy();
      stream.destroy();
      settle(err("timeout"));
    };
    const timer = setTimeout(stop, io.headersTimeoutMs);
    io.signal?.addEventListener("abort", stop, { once: true });
    req.once("response", (res) => settle(ok(res)));
    req.on("error", () => {
      stream.destroy();
      settle(err("unreachable"));
    });
    req.end();
  });
}

/**
 * One GET to `raw`, judged first: its URL, its name and every address the
 * name resolves to. The connection goes to the address that was checked.
 */
async function get(
  raw: string,
  io: Io,
  previousHost: string,
): Promise<Result<{ readonly url: URL; readonly res: IncomingMessage }, FetchFailure>> {
  const checked = checkUrl(raw);
  if (!checked.ok) return err({ kind: "refused", refusal: checked.error, host: previousHost });
  const url = checked.value;
  const host = url.hostname;
  const target = checkHostname(host);
  if (!target.ok) return err({ kind: "refused", refusal: target.error, host });
  const pinned = await resolvePublic(target.value, io.lookup);
  if (!pinned.ok) return err({ kind: "refused", refusal: pinned.error, host });
  if (io.signal?.aborted) return err({ kind: "timeout", host });
  const to = { ...pinned.value, port: portOf(url) };
  const tcp = io.connect(to);
  const peer: TlsPeer =
    target.value.kind === "name"
      ? { host: target.value.name, servername: target.value.name }
      : { host: target.value.address };
  const stream = url.protocol === "https:" ? io.secure(tcp, peer) : tcp;
  // However the answer ends, the connection under it closes too.
  if (stream !== tcp) stream.once("close", () => tcp.destroy());
  const sent = await send(url, stream, to, io);
  if (!sent.ok) {
    tcp.destroy();
    return err({ kind: sent.error, host });
  }
  return ok({ url, res: sent.value });
}

/** The answer's body, decompressed when the server compressed it. */
function decoded(res: IncomingMessage): Readable {
  const encoding = (res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? createGunzip()
      : encoding === "deflate"
        ? createInflate()
        : encoding === "br"
          ? createBrotliDecompress()
          : null;
  // pipeline, not pipe: the answer ending early or failing ends the decoder too.
  return decoder ? pipeline(res, decoder, () => undefined) : res;
}

interface BodyLimits {
  readonly maxBytes: number;
  /** For a page's first bytes. */
  readonly sniffMs: number;
  /** For the whole of a PDF. */
  readonly bodyMs: number;
  readonly signal: AbortSignal | undefined;
}

/**
 * Reads a 2xx answer: a PDF all of it (at most `maxBytes`, decompressed),
 * anything else only as far as its first bytes, which can still show it to
 * be a PDF. A page whose first bytes are slow is still a page; a PDF that is
 * slow or too big fails. Always leaves the answer destroyed.
 */
async function readAnswer(
  res: IncomingMessage,
  url: URL,
  contentType: string,
  limits: BodyLimits,
): Promise<
  Result<
    { readonly isPdf: boolean; readonly pdf?: Buffer },
    "too_large" | "timeout" | "unreachable"
  >
> {
  // Known from the headers (its type, or a link that names a PDF), or else
  // undecided until the first bytes are in.
  let isPdf: boolean | null = pdfVerdict(url, contentType, Buffer.alloc(0)) ? true : null;
  if (isPdf && Number(res.headers["content-length"]) > limits.maxBytes) {
    res.destroy();
    return err("too_large");
  }
  const body = decoded(res);
  const halt: { why: "timeout" | "aborted" | null } = { why: null };
  const stop = (why: "timeout" | "aborted"): void => {
    halt.why = why;
    body.destroy();
    res.destroy();
  };
  const onAbort = (): void => stop("aborted");
  let timer = setTimeout(() => stop("timeout"), isPdf ? limits.bodyMs : limits.sniffMs);
  limits.signal?.addEventListener("abort", onAbort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  let failed = false;
  const incoming: AsyncIterable<Buffer> = body;
  try {
    for await (const chunk of incoming) {
      chunks.push(chunk);
      size += chunk.length;
      if (size > limits.maxBytes) return err("too_large");
      if (isPdf === null && size >= PDF_MAGIC.length) {
        isPdf = pdfVerdict(url, contentType, Buffer.concat(chunks));
        if (!isPdf) break;
        // Its first bytes say PDF: the rest gets the PDF's time.
        clearTimeout(timer);
        timer = setTimeout(() => stop("timeout"), limits.bodyMs);
      }
    }
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
    limits.signal?.removeEventListener("abort", onAbort);
    body.destroy();
    res.destroy();
  }
  if (halt.why === "aborted") return err("timeout");
  if (halt.why === "timeout") return isPdf === true ? err("timeout") : ok({ isPdf: false });
  if (failed) return err("unreachable");
  return isPdf === true ? ok({ isPdf: true, pdf: Buffer.concat(chunks) }) : ok({ isPdf: false });
}

/**
 * Follows `raw` to its answer, judging every hop, and says whether it is a
 * PDF, with a PDF's bytes. A 4xx or 5xx answer is returned as it is (the
 * caller says what it means).
 */
export async function preflight(
  raw: string,
  options: FetchOptions = {},
): Promise<Result<Preflight, FetchFailure>> {
  const io: Io = {
    lookup: options.lookup ?? systemLookup,
    connect: options.connect ?? connectPinned,
    secure: options.secure ?? secureSocket,
    headersTimeoutMs: options.headersTimeoutMs ?? HEADERS_TIMEOUT_MS,
    signal: options.signal,
  };
  const limits: BodyLimits = {
    maxBytes: options.maxPdfBytes ?? MAX_PDF_BYTES,
    sniffMs: io.headersTimeoutMs,
    bodyMs: options.bodyTimeoutMs ?? BODY_TIMEOUT_MS,
    signal: options.signal,
  };
  let current = raw;
  let host = "";
  for (let hops = 0; ; hops++) {
    const hop = await get(current, io, host);
    if (!hop.ok) return hop;
    const { url, res } = hop.value;
    host = url.hostname;
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (REDIRECTS.has(status) && location !== undefined) {
      res.destroy();
      if (hops >= MAX_HOPS) return err({ kind: "too_many_redirects", host });
      try {
        current = new URL(location, url).href;
      } catch {
        return err({ kind: "refused", refusal: "bad_url", host });
      }
      continue;
    }
    const contentType = essence(res.headers["content-type"]);
    const answer = { finalUrl: url, status, contentType, hops };
    if (status < 200 || status > 299) {
      res.destroy();
      return ok({ ...answer, isPdf: false });
    }
    const body = await readAnswer(res, url, contentType, limits);
    return body.ok ? ok({ ...answer, ...body.value }) : err({ kind: body.error, host });
  }
}
