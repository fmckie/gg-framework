// Overview: healthy, with problems (Fix buttons), and the first-run hero (its CTA).
import { both, closeBrowser } from "../lib.mjs";
import { healthy, connections, mcpServers, noMemories, noJiwa, providersNone, localNone } from "./data.mjs";
import { openSettings, goTab, header, fields } from "./_common.mjs";

const page = async (app, name) => {
  await openSettings(app);
  await goTab(app, "Overview", 2200);
  await header(app, name);
  await fields(app, name);
  await app.capture(name);
};

// 1. Healthy: every area fine, a few apps connected, memories kept.
await both(
  healthy({ data: { connections: { configured: true, connections: connections.filter((c) => c.status === "ACTIVE") } } }),
  (app) => page(app, "overview-healthy"),
);

// 2. Problems: a tool server failing and one needing sign-in, an app expired,
//    no OpenAI key, no provider signed in. Rows show Fix / Set up.
await both(
  healthy({
    responses: {
      agent_mcp_list: { servers: mcpServers },
      app_auth_status: { providers: providersNone },
      agent_local: localNone,
      agent_local_scan: localNone,
      agent_memories: noMemories,
      agent_jiwa: noJiwa,
    },
    data: {
      connections: { configured: true, connections },
      voice: { ready: false, voice: "marin", model: "gpt-realtime", voices: ["marin", "cedar", "alloy"], speed: 1 },
      setup: { admin: true, keys: { openai: "missing", composio: "saved", typesafe: "missing" } },
    },
    api: (req) =>
      req.method === "GET" && req.path === "/kleio/setup/dictation"
        ? { status: 200, body: { dictation: { state: "failed", reason: "offline", bytes: 138_853_314 } } }
        : undefined,
  }),
  (app) => page(app, "overview-problems"),
);

// 3. First run: nothing broken, nothing set up. The hero and its one filled button.
await both(
  healthy({
    responses: {
      agent_mcp_list: { servers: [] },
      app_auth_status: { providers: providersNone },
      agent_local: localNone,
      agent_local_scan: localNone,
      agent_memories: noMemories,
      agent_jiwa: noJiwa,
    },
    data: {
      connections: { configured: false, connections: [] },
      voice: { ready: false, voice: "marin", model: "gpt-realtime", voices: ["marin", "cedar", "alloy"], speed: 1 },
      setup: { admin: true, keys: { openai: "missing", composio: "missing", typesafe: "missing" } },
    },
    api: (req) =>
      req.method === "GET" && req.path === "/kleio/setup/dictation"
        ? { status: 200, body: { dictation: { state: "absent", bytes: 138_853_314 } } }
        : undefined,
  }),
  (app) => page(app, "overview-first-run"),
);

// 4. A device that is not the admin: keys it cannot add.
await both(
  healthy({
    responses: { agent_mcp_list: { servers: [] }, agent_memories: noMemories, agent_jiwa: noJiwa },
    data: {
      connections: { configured: false, connections: [] },
      voice: { ready: false, voice: "marin", model: "gpt-realtime", voices: ["marin", "cedar", "alloy"], speed: 1 },
      setup: { admin: false, keys: { openai: "missing", composio: "missing", typesafe: "missing" } },
    },
  }),
  (app) => page(app, "overview-not-admin"),
);
await closeBrowser();
