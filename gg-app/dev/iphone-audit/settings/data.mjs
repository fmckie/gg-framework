// Made-up data for the settings scenes. Nothing is read from a real host.
import { base } from "../lib.mjs";

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ── Steroids ────────────────────────────────────────────────────────────
export const steroids = {
  none: { installed: false, connected: false },
  ok: { installed: true, connected: true, version: "0.4.2", repos: 12, documents: 48213, diskSize: "2.0GB", path: "/Users/demo/.steroids/bin/steroids" },
  empty: { installed: true, connected: false, version: "0.4.2", repos: 0, documents: 0, path: "/Users/demo/.steroids/bin/steroids" },
  failing: {
    installed: true,
    connected: false,
    version: "0.4.2",
    path: "/Users/demo/.steroids/bin/steroids",
    error:
      "steroids status exited 1: could not open corpus at /Users/demo/Library/Application Support/steroids/corpus.sqlite3 (database disk image is malformed)",
  },
};

// ── Tools (MCP) ─────────────────────────────────────────────────────────
export const mcpServers = [
  { name: "notion", scope: "global", ok: true, toolCount: 14, kind: "http", summary: "https://mcp.notion.com/mcp" },
  { name: "linear", scope: "global", ok: false, toolCount: 0, kind: "http", summary: "https://mcp.linear.app/sse", requiresAuth: true, error: "401 Unauthorized" },
  {
    name: "internal-observability-and-incident-response-toolkit-production",
    scope: "global",
    ok: true,
    toolCount: 37,
    kind: "stdio",
    summary:
      "npx -y @acme-corp/internal-observability-mcp-server@latest --region eu-central-1 --config /Users/demo/.config/acme/observability/production.settings.json --verbose",
    warning: "delete_dashboard hidden: destructive without confirmation",
  },
  {
    name: "postgres",
    scope: "global",
    ok: false,
    toolCount: 0,
    kind: "stdio",
    summary: "uvx mcp-server-postgres --dsn postgresql://demo:demo@127.0.0.1:5432/aurora_store_development",
    error: "spawn uvx ENOENT: the command was not found on the host's PATH",
  },
  { name: "filesystem", scope: "global", ok: true, toolCount: 6, kind: "stdio", summary: "npx -y @modelcontextprotocol/server-filesystem /Users/demo/projects" },
  { name: "aurora-docs", scope: "project", ok: true, toolCount: 3, kind: "http", summary: "https://docs.aurora.example/mcp" },
];

// ── Brain ───────────────────────────────────────────────────────────────
const mem = (id, text, category, importance, age) => ({ id, text, category, importance, createdAt: ago(age + DAY), updatedAt: ago(age) });
export const memories = {
  softLimit: 60,
  hardLimit: 90,
  memories: [
    mem("m1", "Prefers short replies, with the answer first and the reasoning after, and never more than three bullet points unless a longer list was asked for by name.", "preference", 5, 2 * HOUR),
    mem("m2", "Works on aurora-store, a storefront in TypeScript with a Rust image pipeline; deploys on Fridays are frozen after 3pm Berlin time because the on-call rota changes over then.", "project", 4, 3 * DAY),
    mem("m3", "Is called Sam and lives in Berlin.", "identity", 5, 9 * DAY),
    mem("m4", "Sister Mira's birthday is the fourteenth of March; she likes hand-written cards more than presents and should be reminded a week ahead.", "relationship", 3, 20 * DAY),
    mem("m5", "Runs before breakfast on weekdays.", "health", 2, 30 * DAY),
    mem("m6", "A_very_long_unbroken_token_like_a_path_/Users/demo/projects/aurora-store/packages/image-pipeline/src/resizers/lanczos3_simd_fallback.rs_that_cannot_wrap_on_spaces", "other", 1, 40 * DAY),
  ],
};
export const noMemories = { softLimit: 60, hardLimit: 90, memories: [] };
export const jiwa = {
  softLimit: 40,
  hardLimit: 60,
  jiwa: [
    { id: "j1", text: "Speak plainly; no exclamation marks.", category: "voice", importance: 4, createdAt: ago(5 * DAY), updatedAt: ago(5 * DAY) },
    { id: "j2", text: "Ask before running anything that deletes files.", category: "boundaries", importance: 5, createdAt: ago(8 * DAY), updatedAt: ago(8 * DAY) },
  ],
};
export const noJiwa = { softLimit: 40, hardLimit: 60, jiwa: [] };

// ── Connection ──────────────────────────────────────────────────────────
export const LONG_DEVICE = "Samantha's 16-inch MacBook Pro (Work, Berlin office, docking station 3)";
export const devices = [
  { deviceId: "harness-device", label: "Harness", created: ago(57 * DAY), lastSeen: ago(1 * MIN), revoked: false, admin: true },
  { deviceId: "d-long", label: LONG_DEVICE, created: ago(2 * DAY), lastSeen: ago(3 * HOUR), revoked: false, admin: false },
  { deviceId: "d-phone", label: "Sam's iPhone 17 Pro Max", created: ago(30 * DAY), lastSeen: ago(20 * MIN), revoked: false, admin: true },
  { deviceId: "d-ipad", label: "iPad", created: ago(90 * DAY), lastSeen: null, revoked: false, admin: false },
  { deviceId: "d-old", label: "Old laptop", created: ago(200 * DAY), lastSeen: ago(120 * DAY), revoked: true, admin: false },
];

export const linkUp = {
  paired: true,
  active: true,
  running: true,
  error: null,
  host: "mac-mini-1",
  hostKey: "7f3a9c2e41b8d6055e1f",
  relay: "https://euc1-1.relay.n0.iroh.link./",
  relayN0: true,
  refused: null,
  refusal: null,
  connected: true,
  dialling: false,
  unreached: null,
  lastReachedMs: Date.now() - 4000,
  path: "direct",
  pathAddr: "192.168.1.24:51820",
  pathN0: false,
  rateLimited: false,
  rttMs: 38,
  connectedSinceMs: Date.now() - 3 * HOUR,
  redials: 2,
  lastResumeMs: Date.now() - 40 * MIN,
  events: [
    { atMs: Date.now() - 3 * HOUR, text: "Connected through the relay euc1-1.relay.n0.iroh.link" },
    { atMs: Date.now() - 3 * HOUR + 4000, text: "Direct path found: 192.168.1.24:51820" },
    { atMs: Date.now() - 40 * MIN, text: "Resumed after sleep; redialled in 420 ms" },
  ],
  debugBuild: false,
};
export const linkDown = {
  ...linkUp,
  connected: false,
  dialling: true,
  path: null,
  pathAddr: null,
  rttMs: null,
  connectedSinceMs: null,
  lastReachedMs: Date.now() - 26 * MIN,
  unreached: { kind: "host-silent", relays: [{ host: "euc1-1.relay.n0.iroh.link", n0: true }] },
  events: [{ atMs: Date.now() - 26 * MIN, text: "Lost the host; dialling again" }],
};
/** The link is in this build, but this device is paired by address (Tailscale). */
export const linkUnpaired = {
  ...linkUp,
  paired: false,
  active: false,
  running: false,
  host: null,
  hostKey: null,
  relay: null,
  relayN0: false,
  connected: false,
  path: null,
  pathAddr: null,
  rttMs: null,
  connectedSinceMs: null,
  lastReachedMs: null,
  events: [],
};

export const relays = {
  listVersion: 3,
  relays: [
    { entry: "n0", state: "home", new: false },
    { entry: "https://relay-frankfurt-1.kleio-relays.internal.example.com/", state: "standby", new: false },
    { entry: "https://relay.sam.example/", state: "unreachable", new: true },
  ],
  inUse: true,
  hostRelay: "https://euc1-1.relay.n0.iroh.link./",
  waiting: 0,
};

const node = { name: "mac-mini-1", dnsName: "mac-mini-1.tail0000.ts.net", ip: "100.64.0.1", os: "macOS", online: true, lastSeen: null, direct: true, relay: "fra" };
export const tailscale = {
  installed: true,
  running: true,
  backendState: "Running",
  tailnet: "sam@example.com",
  magicDnsSuffix: "tail0000.ts.net",
  version: "1.90.1-t1",
  health: [],
  self: { ...node, name: "laptop", dnsName: "laptop.tail0000.ts.net", ip: "100.64.0.7" },
  host: node,
  error: null,
};

// A v-something ticket is opaque to the page: it draws it as a QR code and as text.
export const TICKET =
  '{"v":5,"type":"kleio-pair","name":"mac-mini-1","key":"7f3a9c2e41b8d6055e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d","relay":"https://euc1-1.relay.n0.iroh.link./","code":"ABC-DEF"}';
export const offer = (ticket = TICKET) => ({ display: "ABC-DEF", expiresAt: Date.now() + 5 * MIN, admin: false, ticket, ticketError: ticket ? null : "no_link" });

// ── Apps (Composio) ─────────────────────────────────────────────────────
const conn = (name, status, age, toolkit = name.toLowerCase().replace(/\s+/g, "")) => ({ id: `c-${toolkit}`, toolkit, name, logo: null, status, createdAt: ago(age) });
export const connections = [
  conn("Gmail", "ACTIVE", 30 * DAY),
  conn("Google Calendar", "ACTIVE", 30 * DAY, "googlecalendar"),
  conn("Notion", "EXPIRED", 12 * DAY),
  conn("Slack", "ACTIVE", 9 * DAY),
  conn("Linear", "INITIATED", 2 * MIN),
  conn("Microsoft Dynamics 365 Business Central", "ACTIVE", 4 * DAY, "dynamics365"),
  conn("GitHub", "FAILED", 1 * DAY),
];
const tk = (slug, name, description, categories, auth = "signin") => ({ slug, name, logo: null, description, categories, auth });
export const toolkits = [
  tk("gmail", "Gmail", "Read, search and send mail.", ["communication"]),
  tk("googledrive", "Google Drive", "Find, read and upload files in Drive.", ["document & file management"]),
  tk("notion", "Notion", "Pages and databases.", ["productivity"]),
  tk("hackernews", "Hacker News", "Stories, comments and users, read-only.", ["news"], "none"),
  tk("salesforce_marketing_cloud_account_engagement", "Salesforce Marketing Cloud Account Engagement (Pardot)", "Prospects, lists and campaigns in Account Engagement.", ["marketing automation", "crm"], "setup"),
  tk("stripe", "Stripe", "Payments, customers and invoices.", ["payments"]),
  tk("figma", "Figma", "Files, comments and components.", ["design"]),
  tk("jira", "Jira", "Issues, boards and sprints.", ["project management"]),
  tk("airtable", "Airtable", "Bases, tables and records.", ["productivity"]),
  tk("zoom", "Zoom", "Meetings and recordings.", ["communication"]),
];

// ── AI providers ────────────────────────────────────────────────────────
const prov = (value, label, description, connected, methods = ["oauth", "apikey"], connectedMethods = []) => ({ value, label, description, methods, connected, connectedMethods });
export const providersMixed = [
  prov("anthropic", "Anthropic", "Claude models", true, ["oauth", "apikey"], ["oauth", "apikey"]),
  prov("openai", "OpenAI", "Codex + GPT models", true, ["oauth", "apikey"], ["oauth"]),
  prov("gemini", "Google Gemini", "Gemini models", false, ["apikey"]),
  prov("moonshot", "Moonshot", "Kimi models", false, ["apikey"]),
  prov("glm", "Z.ai", "GLM models", false, ["apikey"]),
  prov("minimax", "MiniMax", "MiniMax models", false, ["apikey"]),
  prov("deepseek", "DeepSeek", "DeepSeek models", true, ["apikey"], ["apikey"]),
  prov("xai", "xAI", "Grok models", false, ["oauth", "apikey"]),
];
export const providersNone = providersMixed.map((p) => ({ ...p, connected: false, connectedMethods: [] }));

export const localNone = { endpoints: [{ id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", kind: "ollama", custom: false, reachable: false, reason: "Not running at http://127.0.0.1:11434/v1", models: [] }] };
const lm = (endpoint, rawId, ctx, tools = true) => ({ id: `local/${endpoint}/${rawId}`, rawId, contextWindow: ctx, contextWindowKnown: true, supportsTools: tools, supportsImages: false, supportsThinking: true });
export const localMany = {
  endpoints: [
    { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", kind: "ollama", custom: false, reachable: true, models: [lm("ollama", "qwen3-coder:30b", 262144), lm("ollama", "hf.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M", 32768), lm("ollama", "llama3.2:3b", 8192, false)] },
    { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", kind: "lmstudio", custom: false, reachable: false, reason: "Not running at http://127.0.0.1:1234/v1", models: [] },
    { id: "custom-1", label: "office-gpu-box.tail0000.ts.net", baseUrl: "http://office-gpu-box.tail0000.ts.net:8000/v1", kind: "vllm", custom: true, reachable: true, models: [lm("custom-1", "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", 131072)] },
  ],
};

// ── The scene's common parts ────────────────────────────────────────────
/** Everything set up and working, as a real iPhone sees it: over the link. */
export function healthy(over = {}) {
  return {
    area: "settings",
    responses: {
      agent_steroids_status: steroids.ok,
      agent_mcp_list: { servers: mcpServers.filter((s) => s.ok) },
      agent_memories: memories,
      agent_jiwa: jiwa,
      agent_plugins: { plugins: [] },
      kleio_link_status: linkUp,
      kleio_switch_status: { state: "none", reason: null },
      kleio_tailscale_status: tailscale,
      kleio_devices: devices,
      kleio_admin_state: { unlocked: true, expiresAt: Date.now() + 15 * MIN, available: true },
      kleio_pair_state: { active: false, expiresAt: null, redeemed: false, admin: false, claim: null },
      open_url: null,
      ...over.responses,
    },
    invoke: (cmd, args, ctx) => {
      const own = over.invoke?.(cmd, args, ctx);
      if (own !== undefined) return own;
      // Full Disk Access exists on the Mac only (src-tauri/src/paths.rs:204).
      if (cmd === "permissions_status") return { applicable: ctx.device === "desktop", granted: false };
      return undefined;
    },
    api: (req, ctx) => {
      const own = over.api?.(req, ctx);
      if (own !== undefined) return own;
      const p = req.path.split("?")[0];
      const get = req.method === "GET";
      if (get && p === "/kleio/health") return { status: 200, body: { ok: true, sidecar: "up", devices: 4 } };
      if (get && p === "/kleio/setup/dictation") return { status: 200, body: { dictation: { state: "ready", bytes: 138_853_314 } } };
      if (get && p === "/kleio/link/relays") return { status: 200, body: relays };
      if (get && p === "/kleio/connections/toolkits") {
        const q = new URLSearchParams(req.path.split("?")[1] ?? "").get("search")?.toLowerCase() ?? "";
        const found = toolkits.filter((t) => !q || t.name.toLowerCase().includes(q));
        return { status: 200, body: { toolkits: found, nextCursor: q ? null : "page-2" } };
      }
      return undefined;
    },
    data: { host: { os: "darwin", alwaysOn: { state: "yes", reasons: [] }, keepAwake: "idle" }, ...over.data },
    storage: { "kleio.overview.welcomed": "1", "kleio.about.signed": "1", ...over.storage },
    ...(over.now ? { now: over.now } : {}),
  };
}
export { base };
