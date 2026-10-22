// Pictures for a voice show (show.ts): a web page captured as a PNG, a PDF
// counted and drawn page by page. The drawing is done by the native helper
// (dist/bin/kleio-capture, native/capture/main.swift); this module runs it,
// checks everything it says, and keeps what it made in a cache.
//
//   - A web address is pre-flighted first (guarded-fetch.ts): a PDF goes to
//     the PDF path, never the page path; a 4xx or 5xx answer stops there.
//   - A page is captured through a SOCKS5 proxy made for that capture
//     (capture-proxy.ts), so every connection the page makes is judged by the
//     same address policy. One page capture at a time, at most PER_MINUTE a
//     minute; the helper is killed at KILL_AFTER_MS.
//   - Results live in a 0700 cache folder for CACHE_MS, at most CACHE_BYTES
//     in all, and the folder's capture files are cleared at startup.
//   - Logs name hosts, never URLs.
//   - Drawing needs macOS 14 or later (WebKit and PDFKit) and the helper. On
//     any other host the capturer says so in `support`, and every call answers
//     `unavailable` before anything is fetched or run. Text, markdown and
//     pictures don't come through here, so they show on any host. The helper
//     sits behind CaptureBackend, so another platform's backend can be added.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  closeSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, release as osRelease } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startCaptureProxy,
  type CaptureProxy,
  type ProxyOptions,
  type ProxyRefusal,
} from "./capture-proxy.js";
import { preflight, type FetchOptions } from "./guarded-fetch.js";
import { checkUrl, refusalText, type GuardRefusal } from "./net-guard.js";
import { err, ok, type Result } from "./result.js";

export type View = "desktop" | "phone";

/** The window a page is drawn in, in CSS pixels. */
export const VIEWS: Readonly<
  Record<
    View,
    { readonly width: number; readonly viewportHeight: number; readonly mobile: boolean }
  >
> = {
  desktop: { width: 1024, viewportHeight: 800, mobile: false },
  phone: { width: 390, viewportHeight: 844, mobile: true },
};

export interface CaptureLimits {
  /** How much of a page is drawn, in CSS pixels; the rest is "cut". */
  readonly maxHeightCss: number;
  /** Image pixels per CSS pixel. */
  readonly scale: number;
  readonly maxPngBytes: number;
  readonly loadTimeoutMs: number;
  readonly settleMs: number;
  /** The helper's own limit for a page... */
  readonly totalTimeoutMs: number;
  /** ...and when the host kills it regardless. */
  readonly killAfterMs: number;
  /** Kill time for a PDF count or page. */
  readonly pdfKillAfterMs: number;
  /** Page captures started in any minute. */
  readonly perMinute: number;
  readonly cacheMs: number;
  readonly cacheBytes: number;
  /** Pages of a PDF that can be shown. */
  readonly maxPdfPages: number;
  readonly pdfPageWidthPx: number;
  readonly pdfPageMaxHeightPx: number;
}

export const CAPTURE_LIMITS: CaptureLimits = {
  maxHeightCss: 4_000,
  scale: 2,
  maxPngBytes: 20 * 1024 * 1024,
  loadTimeoutMs: 15_000,
  settleMs: 1_500,
  totalTimeoutMs: 20_000,
  killAfterMs: 25_000,
  pdfKillAfterMs: 15_000,
  perMinute: 10,
  cacheMs: 15 * 60_000,
  cacheBytes: 200 * 1024 * 1024,
  maxPdfPages: 100,
  pdfPageWidthPx: 1_600,
  pdfPageMaxHeightPx: 8_000,
};

/** A picture in the cache. */
export interface Png {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/** A PDF in the cache, ready to be drawn page by page. */
export interface PdfDoc {
  readonly id: string;
  readonly file: string;
  /** Pages that can be shown (at most maxPdfPages). */
  readonly pages: number;
  readonly totalPages: number;
  readonly title?: string;
}

export type UrlShot =
  | {
      readonly kind: "web";
      readonly png: Png;
      readonly host: string;
      readonly status: number;
      /** The page goes on below the picture. */
      readonly cut: boolean;
      /** A sign-in, account or paywall page: what a visitor without your accounts sees. */
      readonly signIn: boolean;
      readonly title?: string;
    }
  | { readonly kind: "pdf"; readonly doc: PdfDoc; readonly host: string };

export type CaptureFailure =
  | { readonly kind: "refused"; readonly refusal: GuardRefusal; readonly host: string }
  | { readonly kind: "http_status"; readonly status: number; readonly host: string }
  | {
      readonly kind:
        | "unreachable"
        | "timeout"
        | "too_large"
        | "busy"
        | "blank"
        | "not_a_page"
        | "unavailable"
        | "broken"
        | "unreadable"
        | "locked"
        | "no_page"
        | "expired"
        | "cancelled";
      readonly host: string;
    };

/** Plain words for a failure, for the panel and the voice. */
export function failureText(f: CaptureFailure): string {
  const site = f.host || "the site";
  switch (f.kind) {
    case "refused":
      return f.refusal === "unresolved" ? `Couldn't find ${site}.` : refusalText(f.refusal);
    case "http_status":
      if (f.status === 404 || f.status === 410) {
        return `There's no page at that address (${site} answered ${f.status}).`;
      }
      return f.status >= 500
        ? `${site} had a problem (it answered ${f.status}).`
        : `${site} turned the request away (it answered ${f.status}).`;
    case "unreachable":
      return `Couldn't reach ${site}.`;
    case "timeout":
      return `${site} took too long.`;
    case "too_large":
      return "That's too big to show.";
    case "busy":
      return "Kleio has shown a lot of pages just now. Try again in a minute.";
    case "blank":
      return "The page came out blank.";
    case "not_a_page":
      return "That link isn't a page or PDF Kleio can show.";
    case "unavailable":
      return "Kleio can't show web pages or PDFs on this host.";
    case "broken":
      return "Something went wrong drawing that.";
    case "unreadable":
      return "Couldn't read that PDF.";
    case "locked":
      return "That PDF is locked with a password.";
    case "no_page":
      return "There's no such page.";
    case "expired":
      return "That has expired. Ask Kleio to show it again.";
    case "cancelled":
      return "Stopped.";
  }
}

export interface Capturer {
  /**
   * Whether this host can draw pages and PDFs. When it can't, every call
   * answers `unavailable` (a refused address still answers `refused`), and
   * nothing is fetched or run.
   */
  readonly support: CaptureSupport;
  /** A web address: a picture of the page, or the PDF it links to. */
  url(url: string, view: View, signal?: AbortSignal): Promise<Result<UrlShot, CaptureFailure>>;
  /** A PDF's bytes, kept in the cache and counted. */
  pdf(bytes: Buffer, signal?: AbortSignal): Promise<Result<PdfDoc, CaptureFailure>>;
  /** One page of a PDF (from 1), drawn. */
  pdfPage(doc: PdfDoc, page: number, signal?: AbortSignal): Promise<Result<Png, CaptureFailure>>;
}

export interface CapturerOptions {
  /** What draws: `macHelperBackend({ path: defaultHelperPath() })` on a Mac. */
  readonly backend: CaptureBackend;
  /** A folder of the capturer's own (created 0700 when the backend can draw). */
  readonly cacheDir: string;
  readonly limits?: Partial<CaptureLimits>;
  readonly now?: () => number;
  /** For tests: how the pre-flight and the page's proxy resolve and connect. */
  readonly fetch?: Omit<FetchOptions, "signal">;
  readonly proxy?: ProxyOptions;
  readonly log?: (message: string) => void;
}

/** Where the cache lives: outside the host's state folder, which deploys snapshot. */
export function defaultCacheDir(): string {
  return (
    process.env.KLEIO_CAPTURE_CACHE ?? join(homedir(), "Library", "Caches", "Kleio", "captures")
  );
}

/**
 * The helper next to the running code (dist/bin/kleio-capture), or the built
 * one when running from src/. KLEIO_CAPTURE_HELPER overrides both.
 */
export function defaultHelperPath(moduleUrl: string = import.meta.url): string {
  if (process.env.KLEIO_CAPTURE_HELPER) return process.env.KLEIO_CAPTURE_HELPER;
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    join(here, "bin", "kleio-capture"),
    join(here, "..", "dist", "bin", "kleio-capture"),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[0] ?? "kleio-capture";
}

const CACHE_FILE = /^c_[0-9a-f]{32}\.(?:png|pdf)$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_HELPER_OUTPUT = 64 * 1024;

/** Why this host can't draw web pages and PDFs. */
export type UnsupportedReason = "not_macos" | "old_macos" | "no_helper" | "no_cache";

/**
 * Whether this host can draw web pages and PDFs for a voice show. Text,
 * markdown and pictures don't need to: they show on any host.
 */
export type CaptureSupport =
  { readonly available: true } | { readonly available: false; readonly reason: UnsupportedReason };

/** Why this host can't draw pages and PDFs, for its log and capture-check. */
export function supportText(reason: UnsupportedReason): string {
  switch (reason) {
    case "not_macos":
      return "this host isn't a Mac, and drawing web pages and PDFs needs macOS (WebKit and PDFKit)";
    case "old_macos":
      return "this Mac runs a macOS older than 14, which the capture helper needs";
    case "no_helper":
      return "the capture helper (dist/bin/kleio-capture) isn't there; build it with scripts/build-capture.sh";
    case "no_cache":
      return "the folder captures are kept in (KLEIO_CAPTURE_CACHE) can't be made";
  }
}

/** The jobs a backend runs; native/capture/main.swift says what each takes and answers. */
export type BackendMode = "web" | "pdf-info" | "pdf-page";

/** Why a backend gave no answer. */
export type BackendFailure = "unavailable" | "timeout" | "broken" | "cancelled";

/**
 * What draws pages and PDF pages for the capturer. The macOS helper
 * (`macHelperBackend`) is the only one so far. Another platform's would take
 * the same jobs and give the same answers, and the capturer checks every
 * answer the same way, whichever backend gave it.
 */
export interface CaptureBackend {
  /** Whether it can run on this host. */
  readonly support: CaptureSupport;
  /** Runs one job, killed after `killAfterMs`: its one answer, or why there isn't one. */
  run(
    mode: BackendMode,
    job: Readonly<Record<string, unknown>>,
    killAfterMs: number,
    signal: AbortSignal | undefined,
  ): Promise<Result<Record<string, unknown>, BackendFailure>>;
}

export interface MacHelperOptions {
  /** The helper binary, usually `defaultHelperPath()`. */
  readonly path: string;
  /** For tests: the host's platform and Darwin release (`process.platform`, `os.release()`). */
  readonly platform?: NodeJS.Platform;
  readonly release?: string;
}

/** Darwin 23 is macOS 14, the first with the WebKit proxy settings the helper needs. */
const FIRST_DARWIN = 23;

/** Whether the macOS helper can run here: macOS 14 or later, and the helper built. */
export function macHelperSupport(options: MacHelperOptions): CaptureSupport {
  if ((options.platform ?? process.platform) !== "darwin") {
    return { available: false, reason: "not_macos" };
  }
  const darwin = Number.parseInt((options.release ?? osRelease()).split(".")[0] ?? "", 10);
  if (Number.isNaN(darwin) || darwin < FIRST_DARWIN) {
    return { available: false, reason: "old_macos" };
  }
  try {
    if (!statSync(options.path).isFile()) return { available: false, reason: "no_helper" };
    accessSync(options.path, fsConstants.X_OK);
  } catch {
    return { available: false, reason: "no_helper" };
  }
  return { available: true };
}

/** The macOS helper (dist/bin/kleio-capture): WebKit draws pages, PDFKit draws PDFs. */
export function macHelperBackend(options: MacHelperOptions): CaptureBackend {
  return {
    support: macHelperSupport(options),
    run: (mode, job, killAfterMs, signal) =>
      runHelper(options.path, mode, job, killAfterMs, signal),
  };
}

/** The environment the helper gets: nothing of the host's but what WebKit needs. */
function helperEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" };
  for (const key of ["HOME", "TMPDIR", "USER", "LOGNAME"] as const) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

/**
 * Runs the helper once; its one JSON answer, or why there isn't one. A helper
 * that has gone since startup answers `unavailable`.
 */
function runHelper(
  helperPath: string,
  mode: BackendMode,
  job: Readonly<Record<string, unknown>>,
  killAfterMs: number,
  signal: AbortSignal | undefined,
): Promise<Result<Record<string, unknown>, BackendFailure>> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(err("cancelled"));
      return;
    }
    const child = spawn(helperPath, [mode], {
      stdio: ["pipe", "pipe", "ignore"],
      env: helperEnv(),
    });
    let output = "";
    let stopped: "timeout" | "cancelled" | null = null;
    let missing = false;
    const stop = (why: "timeout" | "cancelled"): void => {
      stopped ??= why;
      child.kill("SIGKILL");
    };
    const onAbort = (): void => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), killAfterMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (output.length < MAX_HELPER_OUTPUT) output += chunk;
    });
    child.stdin.on("error", () => undefined); // a helper that exits early closes its stdin
    const done = (r: Result<Record<string, unknown>, BackendFailure>): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    child.on("error", (e: NodeJS.ErrnoException) => {
      missing = e.code === "ENOENT" || e.code === "EACCES";
      done(err(missing ? "unavailable" : "broken"));
    });
    child.on("close", (code) => {
      if (missing) return done(err("unavailable"));
      if (stopped) return done(err(stopped));
      if (code !== 0) return done(err("broken"));
      try {
        const parsed: unknown = JSON.parse(output.split("\n")[0] ?? "");
        done(isRecord(parsed) ? ok(parsed) : err("broken"));
      } catch {
        done(err("broken"));
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function text(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

/** A PNG the helper says it wrote: there, not too big, and a PNG. */
function checkPng(file: string, maxBytes: number): number | null {
  try {
    const size = statSync(file).size;
    if (size < PNG_SIGNATURE.length || size > maxBytes) return null;
    const head = Buffer.alloc(PNG_SIGNATURE.length);
    const fd = openSync(file, "r");
    try {
      readSync(fd, head, 0, head.length, 0);
    } finally {
      closeSync(fd);
    }
    return head.equals(PNG_SIGNATURE) ? size : null;
  } catch {
    return null;
  }
}

function remove(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Already gone.
  }
}

/** The helper's own failure words, as a capture failure. */
function webFailure(
  error: unknown,
  host: string,
  refusals: readonly ProxyRefusal[],
): CaptureFailure {
  // The page's own host refused by the proxy: say why, not just "couldn't reach".
  const refusedHere = refusals
    .filter((r) => r.host === host)
    .map((r) => r.why)
    .find(
      (why): why is "private_address" | "local_name" =>
        why === "private_address" || why === "local_name",
    );
  switch (error) {
    case "timeout":
      return { kind: "timeout", host };
    case "unreachable":
    case "tls":
      return refusedHere
        ? { kind: "refused", refusal: refusedHere, host }
        : { kind: "unreachable", host };
    case "refused":
      return { kind: "refused", refusal: "private_address", host };
    case "too_big":
      return { kind: "too_large", host };
    case "blank":
      return { kind: "blank", host };
    case "not_a_page":
      return { kind: "not_a_page", host };
    default:
      return { kind: "broken", host };
  }
}

/** A site's answer that ends a show, rather than one to draw (401, 403 and 407 are sign-in walls). */
function failingStatus(status: number): boolean {
  return status >= 400 && status <= 599 && status !== 401 && status !== 403 && status !== 407;
}

type Cached =
  | { readonly kind: "shot"; readonly shot: UrlShot }
  | { readonly kind: "doc"; readonly doc: PdfDoc }
  | { readonly kind: "png"; readonly png: Png };

interface Entry {
  /** Files this entry owns: deleted with it. */
  readonly owns: readonly string[];
  /** Files it needs (its own, or another entry's): it is stale without them. */
  readonly needs: readonly string[];
  readonly bytes: number;
  readonly expiresAt: number;
  readonly value: Cached;
}

/** A queue that runs one task at a time, in order. */
function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * The capturer. Clears the capture files an earlier run left in the cache
 * folder, and creates it (0700) when the backend can draw on this host. Never
 * throws: a cache folder it can't make leaves it unable to draw (`no_cache`),
 * so the host still starts, and shows everything else.
 */
export function createCapturer(options: CapturerOptions): Capturer {
  const limits: CaptureLimits = { ...CAPTURE_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const { cacheDir, backend } = options;
  let support: CaptureSupport = backend.support;
  if (support.available) {
    try {
      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      chmodSync(cacheDir, 0o700);
    } catch {
      support = { available: false, reason: "no_cache" };
    }
  }
  if (!support.available) {
    log(`[capture] web pages and PDFs can't be shown: ${supportText(support.reason)}`);
  }
  try {
    if (existsSync(cacheDir)) {
      for (const name of readdirSync(cacheDir)) {
        if (CACHE_FILE.test(name)) remove(join(cacheDir, name));
      }
    }
  } catch {
    // A cache folder that can't be read has nothing of ours to clear.
  }

  const cache = new Map<string, Entry>();
  const pages = serial();
  const pdfs = serial();
  const started: number[] = [];
  const newFile = (ext: "png" | "pdf"): string =>
    join(cacheDir, `c_${randomBytes(16).toString("hex")}.${ext}`);

  function drop(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    for (const file of entry.owns) remove(file);
  }

  /** Drops what has expired, then the oldest until the cache fits. */
  function sweep(): void {
    const t = now();
    for (const [key, entry] of [...cache]) if (entry.expiresAt <= t) drop(key);
    let total = [...cache.values()].reduce((sum, e) => sum + e.bytes, 0);
    for (const [key, entry] of [...cache]) {
      if (total <= limits.cacheBytes) break;
      total -= entry.bytes;
      drop(key);
    }
  }

  function fresh(key: string): Cached | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now() || entry.needs.some((f) => !existsSync(f))) {
      drop(key);
      return null;
    }
    return entry.value;
  }

  function keep(key: string, value: Cached, owns: readonly string[], bytes: number): void {
    const needs =
      value.kind === "shot"
        ? [value.shot.kind === "web" ? value.shot.png.file : value.shot.doc.file]
        : owns;
    cache.set(key, { owns, needs, bytes, expiresAt: now() + limits.cacheMs, value });
    sweep();
  }

  async function capturePage(
    url: URL,
    view: View,
    signal: AbortSignal | undefined,
  ): Promise<Result<UrlShot, CaptureFailure>> {
    const host = url.hostname;
    const out = newFile("png");
    let proxy: CaptureProxy;
    try {
      proxy = await startCaptureProxy(options.proxy);
    } catch {
      log(`[capture] ${host}: no proxy could start`);
      return err({ kind: "broken", host });
    }
    const viewport = VIEWS[view];
    const began = now();
    let answer: Result<Record<string, unknown>, BackendFailure>;
    try {
      answer = await backend.run(
        "web",
        {
          url: url.href,
          out,
          width: viewport.width,
          viewportHeight: viewport.viewportHeight,
          mobile: viewport.mobile,
          maxHeight: limits.maxHeightCss,
          scale: limits.scale,
          maxBytes: limits.maxPngBytes,
          loadTimeoutMs: limits.loadTimeoutMs,
          settleMs: limits.settleMs,
          totalTimeoutMs: limits.totalTimeoutMs,
          proxy: { port: proxy.port, username: proxy.username, password: proxy.password },
        },
        limits.killAfterMs,
        signal,
      );
    } finally {
      await proxy.close();
    }
    const refusals = proxy.refusals();
    if (refusals.length > 0) {
      const named = [...new Set(refusals.map((r) => `${r.host} (${r.why})`))].slice(0, 10);
      log(`[capture] ${host}: the proxy refused ${named.join(", ")}`);
    }
    if (!answer.ok) {
      remove(out);
      log(`[capture] ${host}: helper ${answer.error}`);
      return err({ kind: answer.error, host });
    }
    const a = answer.value;
    if (a.ok !== true) {
      remove(out);
      log(`[capture] ${host}: ${typeof a.error === "string" ? a.error.slice(0, 40) : "failed"}`);
      return err(webFailure(a.error, host, refusals));
    }
    const status = int(a.status, 0, 999);
    const width = int(a.width, 1, 4_000);
    const height = int(a.height, 1, 20_000);
    const bytes = checkPng(out, limits.maxPngBytes);
    if (
      status === null ||
      width === null ||
      height === null ||
      bytes === null ||
      typeof a.cut !== "boolean" ||
      typeof a.signIn !== "boolean"
    ) {
      remove(out);
      return err({ kind: "broken", host });
    }
    if (failingStatus(status)) {
      remove(out);
      return err({ kind: "http_status", status, host });
    }
    log(`[capture] ${host}: page ${width}x${height} in ${now() - began} ms`);
    const title = text(a.title, 200);
    return ok({
      kind: "web",
      png: { file: out, width, height, bytes },
      host,
      status,
      cut: a.cut,
      signIn: a.signIn,
      ...(title ? { title } : {}),
    });
  }

  async function countPdf(
    bytes: Buffer,
    host: string,
    signal: AbortSignal | undefined,
  ): Promise<Result<PdfDoc, CaptureFailure>> {
    const key = `pdf:${createHash("sha256").update(bytes).digest("hex")}`;
    const cached = fresh(key);
    if (cached?.kind === "doc") return ok(cached.doc);
    const file = newFile("pdf");
    writeFileSync(file, bytes, { mode: 0o600 });
    const answer = await pdfs(() =>
      backend.run("pdf-info", { file }, limits.pdfKillAfterMs, signal),
    );
    if (!answer.ok) {
      remove(file);
      return err({ kind: answer.error, host });
    }
    const a = answer.value;
    const total = a.ok === true ? int(a.pages, 0, 1_000_000) : null;
    if (total === null || total === 0) {
      remove(file);
      // A PDF with no pages, or the helper's own words: locked, unreadable, or something else.
      if (a.ok === true || a.error === "unreadable") return err({ kind: "unreadable", host });
      return err({ kind: a.error === "locked" ? "locked" : "broken", host });
    }
    const title = text(a.title, 200);
    const doc: PdfDoc = {
      id: `d_${randomBytes(16).toString("hex")}`,
      file,
      pages: Math.min(total, limits.maxPdfPages),
      totalPages: total,
      ...(title ? { title } : {}),
    };
    keep(key, { kind: "doc", doc }, [file], bytes.length);
    return ok(doc);
  }

  return {
    support,

    async url(raw, view, signal) {
      // A refused address says so even here, so its link is never offered instead.
      const checked = checkUrl(raw);
      if (!checked.ok) {
        let host = "";
        try {
          host = new URL(raw).hostname;
        } catch {
          // Not a URL at all.
        }
        return err({ kind: "refused", refusal: checked.error, host });
      }
      const url = checked.value;
      const host = url.hostname;
      // A host that can't draw doesn't contact the site at all.
      if (!support.available) return err({ kind: "unavailable", host });
      const key = `url:${view}:${url.href}`;
      return pages(async (): Promise<Result<UrlShot, CaptureFailure>> => {
        if (signal?.aborted) return err({ kind: "cancelled", host });
        const cached = fresh(key);
        if (cached?.kind === "shot") return ok(cached.shot);
        const t = now();
        while (started.length > 0 && (started[0] ?? t) <= t - 60_000) started.shift();
        if (started.length >= limits.perMinute) return err({ kind: "busy", host });
        started.push(t);

        const pre = await preflight(url.href, { ...options.fetch, ...(signal ? { signal } : {}) });
        if (!pre.ok) {
          const f = pre.error;
          log(`[capture] ${host}: pre-flight ${f.kind === "refused" ? f.refusal : f.kind}`);
          if (signal?.aborted) return err({ kind: "cancelled", host });
          return err(
            f.kind === "refused"
              ? { kind: "refused", refusal: f.refusal, host: f.host || host }
              : f.kind === "too_many_redirects"
                ? { kind: "unreachable", host }
                : { kind: f.kind, host },
          );
        }
        const { status, isPdf, pdf } = pre.value;
        if (failingStatus(status)) return err({ kind: "http_status", status, host });
        if (isPdf) {
          if (!pdf) return err({ kind: "unreadable", host });
          const doc = await countPdf(pdf, host, signal);
          if (!doc.ok) return doc;
          const shot: UrlShot = { kind: "pdf", doc: doc.value, host };
          // The PDF's file belongs to its own entry; this one only needs it.
          keep(key, { kind: "shot", shot }, [], 0);
          return ok(shot);
        }
        const shot = await capturePage(url, view, signal);
        if (shot.ok && shot.value.kind === "web") {
          keep(
            key,
            { kind: "shot", shot: shot.value },
            [shot.value.png.file],
            shot.value.png.bytes,
          );
        }
        return shot;
      });
    },

    async pdf(bytes, signal) {
      if (!support.available) return err({ kind: "unavailable", host: "" });
      return countPdf(bytes, "", signal);
    },

    async pdfPage(doc, page, signal) {
      if (!support.available) return err({ kind: "unavailable", host: "" });
      if (!Number.isInteger(page) || page < 1 || page > doc.pages) {
        return err({ kind: "no_page", host: "" });
      }
      if (!existsSync(doc.file)) return err({ kind: "expired", host: "" });
      const key = `page:${doc.id}:${page}`;
      const cached = fresh(key);
      if (cached?.kind === "png") return ok(cached.png);
      const out = newFile("png");
      const answer = await pdfs(() =>
        backend.run(
          "pdf-page",
          {
            file: doc.file,
            page,
            width: limits.pdfPageWidthPx,
            maxHeight: limits.pdfPageMaxHeightPx,
            maxBytes: limits.maxPngBytes,
            out,
          },
          limits.pdfKillAfterMs,
          signal,
        ),
      );
      if (!answer.ok) {
        remove(out);
        return err({ kind: answer.error, host: "" });
      }
      const a = answer.value;
      const width = int(a.width, 1, 4_000);
      const height = int(a.height, 1, 20_000);
      const bytes = checkPng(out, limits.maxPngBytes);
      if (a.ok !== true || width === null || height === null || bytes === null) {
        remove(out);
        if (a.ok === false && a.error === "too_big") return err({ kind: "too_large", host: "" });
        return err({
          kind: a.ok === false && a.error === "locked" ? "locked" : "broken",
          host: "",
        });
      }
      const png: Png = { file: out, width, height, bytes };
      keep(key, { kind: "png", png }, [out], bytes);
      return ok(png);
    },
  };
}
