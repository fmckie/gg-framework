/**
 * App connections through Composio's Tool Router.
 *
 * One Composio user id per Kleio install (never derived from a name or email)
 * and one Tool Router session for it. The session's MCP URL is written into
 * this machine's global ~/.gg/mcp.json as `mcpServers.composio`, so every
 * sidecar session (Kleio, Blobs, group members) gets Composio's meta tools:
 * search tools, run them, and start a connection when an app isn't linked.
 * Idle pinned conversations are retired when that entry changes, so their
 * next turn loads the tools.
 *
 * The phone's Apps screen lists connections, searches the catalogue, starts
 * an OAuth link (opened in a web sheet; Composio redirects to the callback
 * page below, which bounces to kleio://connections) and disconnects.
 *
 * The API key comes from KLEIO_COMPOSIO_API_KEY or <state dir>/composio.key.
 * It never appears in a response body or a log line.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite } from "./device-registry.js";

export interface ConnectionsOptions {
  /** composio.json (user id, session). */
  readonly statePath: string;
  /** The key file, used when `apiKey` is unset. */
  readonly keyPath: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /** e.g. https://mini.tailnet.ts.net:8443, for the OAuth callback. */
  readonly publicBaseUrl: string;
  /** Where ~/.gg lives (tests use a temp dir). */
  readonly ggHome: string;
  /** Called when the mcp.json entry was added or changed. */
  readonly onToolsChanged?: () => Promise<void>;
  readonly fetch?: typeof fetch;
  readonly log?: (msg: string) => void;
  readonly now?: () => Date;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

export interface HtmlReply {
  readonly status: number;
  readonly html: string;
}

export interface Connections {
  /** Create the session and the mcp.json entry if a key is present. Never throws. */
  ensure(): Promise<void>;
  /** A device-authenticated /kleio/connections request, or null. */
  route(
    method: string,
    path: string,
    query: URLSearchParams,
    body: () => Promise<unknown>,
  ): Promise<Reply | null>;
  /** The unauthenticated OAuth landing page, or null when the path is not it. */
  callback(method: string, path: string, query: URLSearchParams): HtmlReply | null;
}

interface State {
  readonly userId: string;
  readonly sessionId?: string;
  readonly mcpUrl?: string;
}

const DEFAULT_BASE = "https://backend.composio.dev";
const MCP_NAME = "composio";
const TOOLKIT_CACHE_MS = 60 * 60 * 1000;
const DETAIL_CHARS = 300;
const SLUG = /^[a-z0-9_-]{1,64}$/;
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,80}$/;
const NOT_SET_UP = { status: 503, body: { error: "apps not set up" } } as const;

class ComposioError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`composio ${status}`);
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function toolkitView(t: unknown): {
  slug: string;
  name: string;
  logo: string | null;
  description: string;
  categories: string[];
} | null {
  const o = obj(t);
  const slug = str(o.slug);
  if (!slug) return null;
  const meta = obj(o.meta);
  const categories = Array.isArray(meta.categories)
    ? meta.categories
        .map((c) => (typeof c === "string" ? c : str(obj(c).name)))
        .filter((c): c is string => !!c)
    : [];
  return {
    slug,
    name: str(o.name) ?? slug,
    logo: str(meta.logo) ?? null,
    description: str(meta.description) ?? "",
    categories,
  };
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createConnections(options: ConnectionsOptions): Connections {
  const log = options.log ?? ((msg: string) => console.error(msg));
  const now = options.now ?? (() => new Date());
  const doFetch = options.fetch ?? fetch;
  const base = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const callbackUrl = `${options.publicBaseUrl.replace(/\/+$/, "")}/kleio/connections/callback`;
  const mcpPath = join(options.ggHome, "mcp.json");

  let state: State | null = null;
  let ensuring: Promise<State | null> | null = null;
  let toolkitCache: { at: number; items: ReturnType<typeof toolkitView>[] } | null = null;

  async function apiKey(): Promise<string | null> {
    if (options.apiKey?.trim()) return options.apiKey.trim();
    try {
      const k = (await readFile(options.keyPath, "utf8")).trim();
      return k || null;
    } catch {
      return null;
    }
  }

  /** A Composio call; a non-2xx is a ComposioError whose detail never holds the key. */
  async function api(key: string, method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          "x-api-key": key,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ComposioError(0, `unreachable: ${String((e as Error).message ?? e)}`);
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new ComposioError(
        res.status,
        [...text.split(key).join("[key]")].slice(0, DETAIL_CHARS).join(""),
      );
    }
    try {
      return text ? (JSON.parse(text) as unknown) : {};
    } catch {
      return {};
    }
  }

  function composioReply(e: unknown): Reply {
    if (e instanceof ComposioError)
      return { status: 502, body: { error: "composio", status: e.status, detail: e.detail } };
    return { status: 502, body: { error: "composio", status: 0, detail: "unexpected error" } };
  }

  // ---------------------------------------------------------------- state

  async function loadState(): Promise<State> {
    if (state) return state;
    try {
      const raw = obj(JSON.parse(await readFile(options.statePath, "utf8")));
      const userId = str(raw.userId);
      if (userId) {
        state = {
          userId,
          ...(str(raw.sessionId) ? { sessionId: str(raw.sessionId)! } : {}),
          ...(str(raw.mcpUrl) ? { mcpUrl: str(raw.mcpUrl)! } : {}),
        };
        return state;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        log(`[apps] reading composio.json failed: ${String(e)}`);
    }
    state = { userId: `kleio_${randomBytes(8).toString("hex")}` };
    await saveState(state);
    return state;
  }

  async function saveState(s: State): Promise<void> {
    state = s;
    await mkdir(dirname(options.statePath), { recursive: true });
    await atomicWrite(options.statePath, JSON.stringify(s, null, 2), 0o600);
  }

  /** Put the composio entry in ~/.gg/mcp.json; true when it was added or changed. */
  async function writeMcpEntry(url: string, key: string): Promise<boolean> {
    let file: Record<string, unknown> = {};
    try {
      file = obj(JSON.parse(await readFile(mcpPath, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        // Never overwrite a file we can't read: the user's other servers live there.
        log(`[apps] ~/.gg/mcp.json is unreadable; not adding Composio (${String(e)})`);
        return false;
      }
    }
    const servers = obj(file.mcpServers);
    const want = { type: "http", url, headers: { "x-api-key": key } };
    if (JSON.stringify(servers[MCP_NAME]) === JSON.stringify(want)) return false;
    const next = { ...file, mcpServers: { ...servers, [MCP_NAME]: want } };
    await mkdir(options.ggHome, { recursive: true });
    await atomicWrite(mcpPath, JSON.stringify(next, null, 2) + "\n", 0o600);
    return true;
  }

  async function ensureNow(): Promise<State | null> {
    const key = await apiKey();
    if (!key) return null;
    let s = await loadState();
    if (!s.sessionId || !s.mcpUrl) {
      const created = obj(
        await api(key, "POST", "/api/v3.1/tool_router/session", {
          user_id: s.userId,
          manage_connections: {
            enable: true,
            callback_url: callbackUrl,
            enable_connection_removal: false,
          },
        }),
      );
      const sessionId = str(created.session_id);
      const mcpUrl = str(obj(created.mcp).url);
      if (!sessionId || !mcpUrl) throw new ComposioError(502, "session response had no MCP URL");
      s = { ...s, sessionId, mcpUrl };
      await saveState(s);
      log(`[apps] Composio session ready`);
    }
    if (await writeMcpEntry(s.mcpUrl!, key)) {
      log(`[apps] added Composio to ~/.gg/mcp.json`);
      await options.onToolsChanged?.().catch((e) => log(`[apps] retiring idle: ${String(e)}`));
    }
    return s;
  }

  /** The ready state, or null when no key is configured. Shared by concurrent callers. */
  function ensured(): Promise<State | null> {
    ensuring ??= ensureNow().finally(() => {
      ensuring = null;
    });
    return ensuring;
  }

  // ---------------------------------------------------------------- routes

  async function toolkitsFor(key: string, slugs: string[]): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    if (!slugs.length) return out;
    try {
      const r = obj(await api(key, "POST", "/api/v3.1/toolkits/multi", { toolkits: slugs }));
      for (const t of Array.isArray(r.items) ? r.items : []) {
        const v = toolkitView(t);
        if (v) out.set(v.slug, v);
      }
    } catch (e) {
      // Names and logos are a nicety; the list still works without them.
      log(`[apps] toolkit details unavailable (${e instanceof ComposioError ? e.status : "?"})`);
    }
    return out;
  }

  async function list(key: string, s: State): Promise<Reply> {
    const items: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ user_ids: s.userId, limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const r = obj(await api(key, "GET", `/api/v3.1/connected_accounts?${q}`));
      if (Array.isArray(r.items)) items.push(...r.items);
      cursor = str(r.next_cursor);
      if (!cursor) break;
    }
    const rows = items
      .map(obj)
      .filter((o) => str(o.id) && str(obj(o.toolkit).slug))
      .map((o) => ({
        id: str(o.id)!,
        toolkit: str(obj(o.toolkit).slug)!,
        status: str(o.status) ?? "UNKNOWN",
        createdAt: str(o.created_at) ?? null,
      }));
    const details = await toolkitsFor(key, [...new Set(rows.map((r) => r.toolkit))]);
    return {
      status: 200,
      body: {
        configured: true,
        connections: rows.map((r) => {
          const t = details.get(r.toolkit) as { name?: string; logo?: string | null } | undefined;
          return {
            id: r.id,
            toolkit: r.toolkit,
            name: t?.name ?? r.toolkit,
            logo: t?.logo ?? null,
            status: r.status,
            createdAt: r.createdAt,
          };
        }),
      },
    };
  }

  async function toolkits(key: string, query: URLSearchParams): Promise<Reply> {
    const search = (query.get("search") ?? "").trim().slice(0, 100);
    const cursor = (query.get("cursor") ?? "").trim().slice(0, 200);
    const limit = Math.min(Math.max(Number(query.get("limit")) || 50, 1), 100);
    // The unfiltered first page is what the catalogue opens on; cache it.
    const cacheable = !search && !cursor && limit === 50;
    if (cacheable && toolkitCache && now().getTime() - toolkitCache.at < TOOLKIT_CACHE_MS)
      return {
        status: 200,
        body: { toolkits: toolkitCache.items, nextCursor: null, cached: true },
      };
    const q = new URLSearchParams({ limit: String(limit), sort_by: "usage" });
    if (search) q.set("search", search);
    if (cursor) q.set("cursor", cursor);
    const r = obj(await api(key, "GET", `/api/v3.1/toolkits?${q}`));
    const items = (Array.isArray(r.items) ? r.items : [])
      .map(toolkitView)
      .filter((t): t is NonNullable<typeof t> => t !== null);
    const nextCursor = str(r.next_cursor) ?? null;
    if (cacheable && !nextCursor) toolkitCache = { at: now().getTime(), items };
    return { status: 200, body: { toolkits: items, nextCursor } };
  }

  async function connect(key: string, s: State, body: unknown): Promise<Reply> {
    const toolkit = str(obj(body).toolkit)?.trim().toLowerCase();
    if (!toolkit || !SLUG.test(toolkit))
      return { status: 400, body: { error: "toolkit must be an app id, e.g. gmail" } };
    const r = obj(
      await api(
        key,
        "POST",
        `/api/v3.1/tool_router/session/${encodeURIComponent(s.sessionId!)}/link`,
        {
          toolkit,
          callback_url: callbackUrl,
        },
      ),
    );
    const redirectUrl = str(r.redirect_url);
    if (!redirectUrl || !/^https:\/\//i.test(redirectUrl))
      return { status: 502, body: { error: "composio", status: 502, detail: "no sign-in link" } };
    log(`[apps] connect started: ${toolkit}`);
    return {
      status: 200,
      body: { redirectUrl, connectionId: str(r.connected_account_id) ?? null },
    };
  }

  async function disconnect(key: string, id: string): Promise<Reply> {
    await api(key, "DELETE", `/api/v3.1/connected_accounts/${encodeURIComponent(id)}`);
    log(`[apps] disconnected ${id}`);
    return { status: 200, body: { ok: true } };
  }

  return {
    async ensure() {
      try {
        await ensured();
      } catch (e) {
        log(
          `[apps] Composio setup failed (${e instanceof ComposioError ? e.status : "error"}); ` +
            "will retry on the next request",
        );
      }
    },

    async route(method, path, query, body) {
      if (path !== "/kleio/connections" && !path.startsWith("/kleio/connections/")) return null;
      if (path === "/kleio/connections/callback") return null;
      const key = await apiKey();
      if (!key) {
        if (method === "GET" && path === "/kleio/connections")
          return { status: 200, body: { configured: false, connections: [] } };
        return NOT_SET_UP;
      }
      let s: State | null;
      try {
        s = await ensured();
      } catch (e) {
        return composioReply(e);
      }
      if (!s) return NOT_SET_UP;
      try {
        if (path === "/kleio/connections") {
          if (method === "GET") return await list(key, s);
          if (method === "POST") return await connect(key, s, await body());
          return { status: 405, body: { error: "method not allowed" } };
        }
        if (path === "/kleio/connections/toolkits" && method === "GET")
          return await toolkits(key, query);
        const one = path.match(/^\/kleio\/connections\/([^/]+)$/);
        if (one && method === "DELETE") {
          const id = decodeURIComponent(one[1]!);
          if (!CONNECTION_ID.test(id)) return { status: 400, body: { error: "bad connection id" } };
          return await disconnect(key, id);
        }
        return { status: 404, body: { error: "not found" } };
      } catch (e) {
        if (e instanceof ComposioError) log(`[apps] ${method} ${path} -> composio ${e.status}`);
        return composioReply(e);
      }
    },

    callback(method, path, query) {
      if (path !== "/kleio/connections/callback" || method !== "GET") return null;
      const raw = (query.get("status") ?? "").toLowerCase();
      const status = raw === "success" || raw === "failed" ? raw : "unknown";
      const ok = status === "success";
      const target = `kleio://connections?status=${status}`;
      const title = ok ? "Connected" : status === "failed" ? "Couldn't connect" : "Done";
      const line = ok
        ? "You can go back to Kleio."
        : "Go back to Kleio and try again if the app isn't listed.";
      const html =
        '<!doctype html><html><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        `<title>${escapeHtml(title)}</title>` +
        `<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">` +
        "<style>body{font:17px -apple-system,system-ui,sans-serif;text-align:center;" +
        "padding:18vh 24px;color:#1c1c1e}a{color:#0a84ff}</style></head><body>" +
        `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(line)}</p>` +
        `<p><a href="${escapeHtml(target)}">Open Kleio</a></p></body></html>`;
      return { status: 200, html };
    },
  };
}
