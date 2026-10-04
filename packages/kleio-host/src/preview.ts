// The static-site preview origin.
//
// An HTML page an agent wrote can't be shown on the API origin: it could
// script against the API. So the host runs a second loopback listener (its
// own port, so its own browser origin; `tailscale serve` fronts it like the
// API) that knows one route, `GET|HEAD /p/<token>/<path>`, and nothing else:
// no device header, no proxy, no API routes.
//
// A token is a capability minted by `POST /kleio/previews` on the API for an
// authenticated device. It names a site folder (`siteRoot`) or, when the page
// sits directly in a projects folder, only that one file (`onlyFile`), so a
// Chat report never exposes every project beside it. Tokens live in memory
// for an hour, at most 50 per device; a host restart drops them all, and a
// revoked device's tokens stop working at once.
//
// Every answer is sandboxed (opaque origin: no cookies, no storage, no
// same-origin reach), never sniffed, never cached and sends no referrer, so
// the token in the path does not leak to the links a page holds.

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { resolveAgentFile } from "./files.js";
import { sendFile } from "./send-file.js";

export const PREVIEW_TTL_MS = 60 * 60 * 1000;
export const PREVIEW_TOKENS_PER_DEVICE = 50;

/** Opaque origin, scripts and forms allowed; may not be framed. */
export const PREVIEW_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors 'none'";

/** What a token may read. Both paths are realpaths. */
export interface PreviewGrant {
  readonly siteRoot: string;
  /** Set: the token serves this one file and nothing else under siteRoot. */
  readonly onlyFile?: string;
  readonly deviceId: string;
  readonly expiresAt: number;
}

export interface PreviewStore {
  mint(grant: {
    readonly deviceId: string;
    readonly siteRoot: string;
    readonly onlyFile?: string;
  }): { readonly token: string; readonly expiresAt: Date };
  /** The live grant for `token`, or null: unknown, expired and revoked look alike. */
  lookup(token: string): PreviewGrant | null;
}

export interface PreviewStoreOptions {
  /** Whether the device is still paired and not revoked; asked on every lookup. */
  readonly deviceActive: (deviceId: string) => boolean;
  readonly now?: () => Date;
  readonly ttlMs?: number;
  readonly perDevice?: number;
}

export function createPreviewStore(options: PreviewStoreOptions): PreviewStore {
  const now = (): number => (options.now ?? ((): Date => new Date()))().getTime();
  const ttl = options.ttlMs ?? PREVIEW_TTL_MS;
  const cap = options.perDevice ?? PREVIEW_TOKENS_PER_DEVICE;
  // Insertion order is mint order, so the first of a device's entries is its oldest.
  const grants = new Map<string, PreviewGrant>();

  function prune(at: number): void {
    for (const [token, g] of grants) if (g.expiresAt <= at) grants.delete(token);
  }

  return {
    mint(grant) {
      const at = now();
      prune(at);
      const mine = [...grants].filter(([, g]) => g.deviceId === grant.deviceId);
      for (const [token] of mine.slice(0, Math.max(0, mine.length - cap + 1))) grants.delete(token);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = at + ttl;
      grants.set(token, {
        siteRoot: grant.siteRoot,
        ...(grant.onlyFile !== undefined ? { onlyFile: grant.onlyFile } : {}),
        deviceId: grant.deviceId,
        expiresAt,
      });
      return { token, expiresAt: new Date(expiresAt) };
    },
    lookup(token) {
      const g = grants.get(token);
      if (!g) return null;
      if (g.expiresAt <= now() || !options.deviceActive(g.deviceId)) {
        grants.delete(token);
        return null;
      }
      return g;
    },
  };
}

const PREVIEW_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".pdf", "application/pdf"],
]);

/** Content type on the preview origin only; the API's map stays download-only. */
export function previewContentType(name: string): string {
  return PREVIEW_TYPES.get(extname(name).toLowerCase()) ?? "application/octet-stream";
}

/** On every preview answer, including errors. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": PREVIEW_CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  // A sandboxed page has an opaque origin, so fetching its own data.json is
  // cross-origin. No credentials ride along; the path token is the capability.
  "access-control-allow-origin": "*",
};

/** `/p/<43-char base64url token>/<still-encoded path>`. */
const PREVIEW_PATH_RE = /^\/p\/([A-Za-z0-9_-]{43})\/(.*)$/;

function text(res: ServerResponse, status: number, body: string, extra = {}): void {
  const data = Buffer.from(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(data.length),
    ...extra,
  });
  res.end(data);
}

export interface PreviewServerOptions {
  readonly store: PreviewStore;
  readonly log?: (msg: string) => void;
}

/** The preview request handler; createPreviewServer wraps it in its own server. */
export function createPreviewHandler(
  options: PreviewServerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const log = options.log ?? ((): void => {});

  async function serve(
    req: IncomingMessage,
    res: ServerResponse,
    match: RegExpExecArray | null,
  ): Promise<[number, number]> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      text(res, 405, "Method not allowed\n", { allow: "GET, HEAD" });
      return [405, 0];
    }
    const grant = match ? options.store.lookup(match[1] ?? "") : null;
    if (!match || !grant) {
      text(res, 404, "Not found\n");
      return [404, 0];
    }
    let rest = match[2] ?? "";
    if (rest === "" || rest.endsWith("/")) {
      // A one-file token has no folder to list or index.
      if (grant.onlyFile !== undefined) {
        text(res, 404, "Not found\n");
        return [404, 0];
      }
      rest += "index.html";
    }
    const r = await resolveAgentFile(grant.siteRoot, rest);
    if (!r.ok || (grant.onlyFile !== undefined && r.value.path !== grant.onlyFile)) {
      const [status, body] =
        !r.ok && r.error.kind === "too_large" ? [413, "File too large\n"] : [404, "Not found\n"];
      text(res, status, body);
      return [status, 0];
    }
    return sendFile(res, r.value, {
      headers: { ...BASE_HEADERS, "content-type": previewContentType(r.value.name) },
      missing: (out) => text(out, 404, "Not found\n"),
      head: req.method === "HEAD",
    });
  }

  return async (req, res) => {
    const started = Date.now();
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      // keep "/": a 404
    }
    const match = PREVIEW_PATH_RE.exec(pathname);
    let outcome: [number, number] = [500, 0];
    try {
      outcome = await serve(req, res, match);
    } catch {
      if (!res.headersSent) text(res, 500, "Error\n");
      else res.destroy();
    } finally {
      // Never the token: whoever reads the log could open the site with it.
      const shown = pathname.replace(/^\/p\/[^/]*/, "/p/…").slice(0, 200);
      log(
        `[preview] ${req.method ?? "?"} ${shown} → ${outcome[0]} ${outcome[1]}B ${Date.now() - started}ms`,
      );
    }
  };
}

/** A server that answers only preview requests. Listen on loopback. */
export function createPreviewServer(options: PreviewServerOptions): Server {
  const handle = createPreviewHandler(options);
  return createServer((req, res) => void handle(req, res));
}
