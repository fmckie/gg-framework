// The fake gg-app sidecar the host tests talk to: loopback Host allowlist +
// token like the real one, POST /session, /state, /events, /prompt, /complete,
// /routines, DELETE /session/:id and GET /models.

import { createServer, type Server, type ServerResponse } from "node:http";

// ---------------------------------------------------------------- fake sidecar

export interface FakeSidecar {
  server: Server;
  port: number;
  token: string;
  seen: { method: string; url: string; host: string; token: string | undefined }[];
  emit(sessionId: string, frame: string): void;
  /** What GET /routines reports as routine → session (the daemon's own sessions). */
  routineSessions: Record<string, string>;
  routines: { id: string; nextRunAt: number }[];
  /** Hold GET /routines open this long before answering (0 = at once). */
  routinesDelayMs: number;
  /** Sessions this process created, id → the sessionPath its /state reports. */
  sessions: Map<string, string>;
  /** Bodies of every POST /session. */
  creates: any[];
  /** POST /session answers 500 when it carries a sessionPath / always. */
  failResume: boolean;
  failCreate: boolean;
  /** POST /session with this `model` answers 409, like the engine's fail-closed pin. */
  unavailableModel: string | null;
  /** What /state reports as runState, by session (default "idle"). */
  runStates: Map<string, string>;
  /** Every POST /prompt: its x-gg-session and body. */
  prompts: { session: string | undefined; body: any }[];
  /** Ids of every DELETE /session/:id. */
  disposed: string[];
  /** What GET /models answers. */
  models: { id: string; name?: string; provider: string; local?: boolean }[];
  /** Bodies of every POST /complete. */
  completions: any[];
  /** POST /complete answers `{ text: completeText, model }` with 200, else `{ error }`. */
  completeStatus: number;
  completeText: string;
  close(): Promise<void>;
}

/** Unique across fake sidecars, so a "restarted" sidecar never reuses an id. */
let createdCount = 0;

export async function fakeSidecar(): Promise<FakeSidecar> {
  const token = "sidecar-" + Math.random().toString(36).slice(2);
  const streams = new Map<string, Set<ServerResponse>>();
  const seen: FakeSidecar["seen"] = [];
  const routineSessions: Record<string, string> = {};
  const routines: { id: string; nextRunAt: number }[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      host: req.headers.host ?? "",
      token: req.headers["x-gg-token"] as string | undefined,
    });
    // Mimic the real sidecar: loopback Host allowlist + token.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) {
      res.writeHead(403);
      return res.end("bad host");
    }
    if (req.headers["x-gg-token"] !== token) {
      res.writeHead(401);
      return res.end("bad token");
    }
    if (url.pathname === "/events") {
      const sid = url.searchParams.get("session") ?? "none";
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "ready", session: sid })}\n\n`);
      let set = streams.get(sid);
      if (!set) streams.set(sid, (set = new Set()));
      set.add(res);
      req.on("close", () => set!.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/session") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        api.creates.push(body);
        if (api.unavailableModel && body.model === api.unavailableModel) {
          res.writeHead(409, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: `model unavailable: ${body.model}` }));
        }
        if (api.failCreate || (api.failResume && body.sessionPath)) {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "cannot open transcript" }));
        }
        const id = `created-${(createdCount += 1)}`;
        api.sessions.set(id, typeof body.sessionPath === "string" ? body.sessionPath : "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: id }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/routines") {
      const answer = (): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ routines, sessions: routineSessions }));
      };
      if (api.routinesDelayMs > 0) setTimeout(answer, api.routinesDelayMs);
      else answer();
      return;
    }
    if (url.pathname === "/state") {
      // Like the real sidecar, a session this process does not know is a 404.
      // Created ones report their transcript path ("" until it exists).
      const sid = req.headers["x-gg-session"] as string | undefined;
      if (sid?.startsWith("created-") && !api.sessions.has(sid)) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "unknown session" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          runState: (sid && api.runStates.get(sid)) ?? "idle",
          session: sid ?? null,
          ...(sid && api.sessions.has(sid) ? { sessionPath: api.sessions.get(sid) } : {}),
        }),
      );
    }
    if (req.method === "POST" && url.pathname === "/prompt") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        api.prompts.push({
          session: req.headers["x-gg-session"] as string | undefined,
          body: JSON.parse(body),
        });
        // Like the real sidecar: 202 once the run is claimed.
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: true, echoed: JSON.parse(body) }));
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/complete") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        api.completions.push(body);
        res.writeHead(api.completeStatus, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            api.completeStatus === 200
              ? { text: api.completeText, model: body.model }
              : { error: "provider failed" },
          ),
        );
      });
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/session/")) {
      const id = decodeURIComponent(url.pathname.slice("/session/".length));
      api.disposed.push(id);
      api.sessions.delete(id);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === "GET" && url.pathname === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: api.models }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const api: FakeSidecar = {
    server,
    port,
    token,
    seen,
    emit(sid, frame) {
      for (const r of streams.get(sid) ?? []) r.write(frame + "\n\n");
    },
    routineSessions,
    routines,
    routinesDelayMs: 0,
    sessions: new Map(),
    creates: [],
    failResume: false,
    failCreate: false,
    unavailableModel: null,
    runStates: new Map(),
    prompts: [],
    disposed: [],
    models: [],
    completions: [],
    completeStatus: 200,
    completeText: '{"schedules":[]}',
    close: () =>
      new Promise((r) => {
        for (const set of streams.values()) for (const s of set) s.destroy();
        // Same as the real host's stop(): close() alone waits for idle
        // keep-alive sockets (a stopped host's poll connection, for one).
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
  return api;
}
