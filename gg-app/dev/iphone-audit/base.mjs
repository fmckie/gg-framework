// Made-up data only. Nothing here is read from ~/.gg, ~/.kleio or a real host.
import * as cast from "../../src/kleio/castFixtures.ts";
import { readFileSync } from "node:fs";

/** The source id the app badges "Kleio" (its own sessions), read from the app. */
export const KLEIO_SOURCE = readFileSync(new URL("../../src/source-style.ts", import.meta.url), "utf8").match(
  /^\s*"?([\w-]+)"?: \{ label: "Kleio"/m,
)[1];

export { cast };
export const CWD = "/Users/demo/projects/aurora-store";

export const state = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  cwd: CWD,
  mode: "code",
  running: false,
  runState: "idle",
  thinkingLevel: "medium",
  supportedThinkingLevels: ["low", "medium", "high"],
  planMode: false,
  contextWindow: 200000,
  gitBranch: "main",
  isGitRepo: true,
  gitDirtyFileCount: 3,
  gitHubIssues: 4,
  gitHubPRs: 1,
  gitHubRepoUrl: "https://github.com/demo/aurora-store",
  supportsVideo: false,
  autopilot: false,
  kenProvider: "anthropic",
  kenModel: "claude-sonnet-4-6",
  kenModelOverride: false,
  tasks: [],
};

const authProviders = [
  ["anthropic", "Anthropic", "Claude models", true],
  ["openai", "OpenAI", "Codex + GPT models", true],
  ["gemini", "Google Gemini", "Gemini models", false],
  ["moonshot", "Moonshot", "Kimi models", false],
  ["glm", "Z.ai", "GLM models", false],
  ["minimax", "MiniMax", "MiniMax models", false],
  ["deepseek", "DeepSeek", "DeepSeek models", false],
  ["xai", "xAI", "Grok models", false],
].map(([value, label, description, connected]) => ({
  value,
  label,
  description,
  methods: ["oauth", "apikey"],
  connected,
}));

const models = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-opus-4-1", name: "Claude Opus 4.1", provider: "anthropic" },
  { id: "gpt-5-codex", name: "GPT-5 Codex", provider: "openai" },
  { id: "gemini-3-pro", name: "Gemini 3 Pro", provider: "gemini" },
].map((m) => ({ supportsThinking: true, contextWindow: 200000, ...m }));

const commands = [
  ["init", "Analyze the project and write a CLAUDE.md"],
  ["plan", "Enter read-only plan mode"],
  ["commit", "Stage, write a message, and commit"],
  ["review", "Review the working tree for bugs"],
  ["compact", "Compact the conversation to free context"],
  ["model", "Switch the active model"],
].map(([name, description]) => ({ name, aliases: [], description, source: "built-in" }));

const localModels = {
  endpoints: [
    {
      id: "ollama",
      label: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      kind: "ollama",
      custom: false,
      reachable: true,
      models: [
        {
          id: "local/ollama/qwen3-coder:30b",
          rawId: "qwen3-coder:30b",
          contextWindow: 262144,
          contextWindowKnown: true,
          supportsTools: true,
          supportsImages: false,
          supportsThinking: true,
        },
      ],
    },
  ],
};

const projects = [
  ["aurora-store", "2m ago", [KLEIO_SOURCE]],
  ["pixel-pipeline", "1h ago", [KLEIO_SOURCE, "claude-code"]],
  ["rusty-parser", "yesterday", ["codex"]],
  ["landing-page", "3d ago", [KLEIO_SOURCE]],
].map(([name, lastActiveDisplay, sources]) => ({
  name,
  path: `/Users/demo/projects/${name}`,
  lastActiveDisplay,
  sources,
}));

const sessions = [
  ["Add checkout retry with idempotency keys", "12m ago", 24],
  ["Port the image resizer to sharp", "2h ago", 61],
  ["Fix flaky cart integration test", "yesterday", 8],
].map(([preview, lastActiveDisplay, messageCount], i) => ({
  id: `demo-session-${i + 1}`,
  path: CWD,
  preview,
  lastActiveDisplay,
  messageCount,
}));

/** Tauri command → canned reply. A command not listed resolves to null and is
 *  logged in the record's `unknownCommands`. */
export const responses = {
  sidecar_port: 45678,
  agent_state: state,
  agent_progress: null,
  agent_usage: {
    provider: "anthropic",
    displayName: "Anthropic",
    connected: true,
    windows: [{ kind: "current", label: "5-hour", usedPercent: 34, resetsAt: Date.now() + 96 * 60_000 }],
    fetchedAt: Date.now(),
  },
  app_auth_status: { providers: authProviders },
  app_settings_get: { projectsRoot: "/Users/demo/projects", configured: true },
  agent_serve_status: { running: false, configured: false },
  agent_models: { models },
  agent_commands: { commands },
  agent_tasks: { tasks: [] },
  agent_memories: { memories: [] },
  agent_jiwa: { jiwa: [] },
  agent_local: localModels,
  agent_local_scan: localModels,
  agent_radio_state: { playing: false, station: null },
  permissions_status: { screenRecording: true, accessibility: true, microphone: true },
  agent_projects: { projects },
  agent_sessions: { sessions },
  agent_goals: { goals: [] },
  agent_history: { history: [] },
  routines_list: { routines: [] },
  kleio_recent_pairings: [],
  // Answered with nothing, as an idle shell does.
  select_project: null,
  window_tray_intent: null,
  window_restore_target: null,
  set_update_available: null,
  set_remote_active: null,
  kleio_take_notification_tap: null,
  kleio_link_status: null,
  kleio_remote_status: {
    active: {
      base: "http://100.64.0.1:8787",
      host: "mac-mini-1",
      deviceId: "harness-device",
      label: "Harness",
      admin: true,
    },
    paired: {
      baseUrl: "http://100.64.0.1:8787",
      host: "mac-mini-1",
      deviceId: "harness-device",
      label: "Harness",
      admin: true,
      pairedAt: "2026-10-01T09:00:00.000Z",
    },
  },
};

/** What the made-up host holds. A scene replaces any of it with `data`. */
export const hostData = () => ({
  blobs: cast.castRoster(7),
  groups: cast.castGroups(3).groups,
  models: cast.CAST_MODELS,
  connections: { configured: true, connections: [] },
  voice: { ready: true, voice: "marin", model: "gpt-realtime", voices: ["marin", "cedar", "alloy"], speed: 1 },
  setup: { admin: true, keys: { openai: "saved", composio: "saved", typesafe: "missing" } },
  host: { os: "darwin", alwaysOn: { state: "yes" }, keepAwake: "idle" },
  notifications: { quoteText: false },
});

const ok = (body) => ({ status: 200, body });

/** The made-up host's routes. `undefined` = not answered here (a 404, logged). */
export function defaultApi({ method, path }, data) {
  const p = path.split("?")[0];
  const get = method === "GET";
  if (p === "/kleio/health") return ok({ ok: true });
  if (get && p === "/kleio/blobs") return ok({ blobs: data.blobs });
  if (get && p === "/kleio/groups") return ok({ groups: data.groups });
  if (get && p === "/kleio/models") return ok(data.models);
  if (get && p === "/kleio/connections") return ok(data.connections);
  if (get && p === "/kleio/voice") return ok(data.voice);
  if (get && p === "/kleio/setup") return ok(data.setup);
  if (get && p === "/kleio/host") return ok(data.host);
  if (get && p === "/kleio/notifications") return ok(data.notifications);
  const blob = /^\/kleio\/blobs\/([^/]+)(\/.*)?$/.exec(p);
  if (blob) {
    const id = decodeURIComponent(blob[1]);
    const found = data.blobs.find((b) => b.id === id);
    const rest = blob[2] ?? "";
    if (get && rest === "" && found) return ok({ blob: found });
    if (get && rest === "/runs") return ok({ runs: cast.castRuns(id) });
    if (get && rest === "/activity") return ok({ activity: cast.castActivity(id) });
    if (get && rest === "/session") return ok({ sessionId: `blob-${id}`, sessionPath: null, created: false });
  }
  if (get && p === "/state") return ok(state);
  if (get && p === "/history") return ok({ history: [] });
  return undefined;
}
