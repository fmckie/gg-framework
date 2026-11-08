import type http from "node:http";
import path from "node:path";
import type { MessageProvenance } from "@kleio/ai";
import {
  createGoal,
  deleteGoal,
  goalKickoffPrompt,
  goalNeedsKickoff,
  goalPhase,
  setGoalCritterModel,
  goalsRoot,
  listGoals,
  markGoalKickoff,
  type GoalRecord,
} from "../core/goals-store.js";
import { formatRelativeTime } from "../core/project-discovery.js";
import { getModel } from "../core/model-registry.js";
import { goalCritterPick } from "../goals-agent/goals-agent.js";
import { SessionManager } from "../core/session-manager.js";
import { log } from "../core/logger.js";
import { readBody, json } from "./http.js";
import type { SessionRouteContext } from "./route-context.js";

/** The kickoff instruction is runtime-authored and never shown as a user bubble. */
const KICKOFF_PROVENANCE: MessageProvenance = {
  source: "runtime",
  kind: "automation",
  visibility: "hidden",
};

/** One row of the app's goal list. */
export interface GoalSummary {
  id: string;
  name: string;
  goal: string;
  context: GoalRecord["context"];
  path: string;
  createdAt: string;
  lastActiveMs: number;
  lastActiveDisplay: string;
  /** Newest non-empty session to resume; null opens a fresh coordinator session. */
  latestSessionPath: string | null;
}

async function summarize(
  sessions: SessionManager,
  dir: string,
  record: GoalRecord,
): Promise<GoalSummary> {
  const list = await sessions.list(dir).catch(() => []);
  const withMessages = list.filter((s) => s.messageCount > 0);
  let lastActiveMs = Date.parse(record.createdAt) || 0;
  let latestSessionPath: string | null = null;
  let latestMs = -1;
  for (const s of withMessages) {
    const ms = Date.parse(s.lastActivity) || 0;
    if (ms > latestMs) {
      latestMs = ms;
      latestSessionPath = s.path;
    }
    if (ms > lastActiveMs) lastActiveMs = ms;
  }
  return {
    id: record.id,
    name: record.name,
    goal: record.goal,
    context: record.context,
    path: dir,
    createdAt: record.createdAt,
    lastActiveMs,
    lastActiveDisplay: formatRelativeTime(lastActiveMs),
    latestSessionPath,
  };
}

/** Goal list, create, and the coordinator's automatic first reply. */
export function handleGoalRoutes(
  ctx: SessionRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
): boolean {
  if (method === "GET" && url === "/goals") {
    const sessions = new SessionManager(ctx.paths.sessionsDir);
    void listGoals(goalsRoot(ctx.paths.agentDir))
      .then((goals) => Promise.all(goals.map((g) => summarize(sessions, g.dir, g.record))))
      .then((goals) => {
        goals.sort((a, b) => b.lastActiveMs - a.lastActiveMs || a.id.localeCompare(b.id));
        json(res, 200, { goals });
      })
      .catch((err) => {
        log("ERROR", "app-sidecar", "listGoals failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        json(res, 500, { error: "Couldn't read your goals" });
      });
    return true;
  }

  if (method === "POST" && url === "/goals") {
    void readBody(req, res).then(async (raw) => {
      if (raw === null) return;
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
      const input =
        body && typeof body === "object"
          ? (body as { name?: unknown; goal?: unknown; context?: unknown })
          : {};
      try {
        const created = await createGoal(
          goalsRoot(ctx.paths.agentDir),
          {
            name: typeof input.name === "string" ? input.name : "",
            goal: typeof input.goal === "string" ? input.goal : "",
            context: Array.isArray(input.context)
              ? input.context.filter((p): p is string => typeof p === "string")
              : [],
          },
          new Date(),
        );
        if (!created.ok) {
          json(res, 400, { error: created.error });
          return;
        }
        const sessions = new SessionManager(ctx.paths.sessionsDir);
        json(res, 200, {
          goal: await summarize(sessions, created.value.dir, created.value.record),
        });
      } catch (err) {
        log("ERROR", "app-sidecar", "createGoal failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        json(res, 500, { error: "Couldn't create the goal" });
      }
    });
    return true;
  }

  // Deleting removes the goal folder and its coordinator sessions. Refused
  // while another window has the goal open, or while this window is running in
  // it, so no live session is left working in a folder that no longer exists.
  if (method === "POST" && url === "/goals/delete") {
    void readBody(req, res).then(async (raw) => {
      if (raw === null) return;
      let id: unknown;
      try {
        id = (JSON.parse(raw) as { id?: unknown } | null)?.id;
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
      if (typeof id !== "string" || !id) {
        json(res, 400, { error: "Missing goal id" });
        return;
      }
      const root = goalsRoot(ctx.paths.agentDir);
      const dir = path.join(root, id);
      const holders = ctx.sessionIdsAt(dir);
      if (holders.some((holder) => holder !== ctx.sessionId)) {
        json(res, 409, { error: "This goal is open in another window. Close it there first." });
        return;
      }
      const ownsIt = holders.includes(ctx.sessionId);
      if (ownsIt && (ctx.running || ctx.runClaim.active || ctx.autopilotActive)) {
        json(res, 409, { error: "This goal is still working. Stop it first." });
        return;
      }
      try {
        const deleted = await deleteGoal(root, ctx.paths.sessionsDir, id);
        if (!deleted.ok) {
          json(res, 404, { error: deleted.error });
          return;
        }
        if (ownsIt) ctx.goal = null;
        json(res, 200, { ok: true });
      } catch (err) {
        log("ERROR", "app-sidecar", "deleteGoal failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        json(res, 500, { error: "Couldn't delete the goal" });
      }
    });
    return true;
  }

  // Pin the model Kleio Goals' workers run on, or clear it (null) so they follow
  // Kleio Goals. Applies to the next worker started; running ones keep theirs,
  // so this needs no run lock.
  if (method === "POST" && url === "/goal/critter-model") {
    const goal = ctx.goal;
    if (!goal) {
      json(res, 404, { error: "This window is not a goal" });
      return true;
    }
    void readBody(req, res).then(async (raw) => {
      if (raw === null) return;
      let requested: string | null;
      try {
        const parsed = (JSON.parse(raw) as { model?: unknown } | null)?.model;
        requested = typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
      try {
        let pick: { provider: string; model: string } | null = null;
        if (requested !== null) {
          const target = getModel(requested);
          if (!target) {
            json(res, 404, { error: `unknown model: ${requested}` });
            return;
          }
          if (!(await ctx.auth.hasProviderAuth(target.provider))) {
            json(res, 400, { error: `Connect ${target.provider} first to use ${target.name}.` });
            return;
          }
          pick = { provider: target.provider, model: target.id };
        }
        const updated = await setGoalCritterModel(goal.dir, pick);
        if (!updated) {
          json(res, 404, { error: "Unknown goal" });
          return;
        }
        ctx.goal = { dir: goal.dir, record: updated };
        const payload = {
          id: updated.id,
          phase: goalPhase(updated),
          critterModel: goalCritterPick(updated)?.model ?? null,
        };
        ctx.broadcast("goal_state", payload);
        json(res, 200, payload);
      } catch (err) {
        log("ERROR", "app-sidecar", "set critter model failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        json(res, 500, { error: "Couldn't change the workers' model" });
      }
    });
    return true;
  }

  // Idempotent: the app calls this whenever it opens a goal that still needs
  // its first reply. Only the first call on a fresh goal starts a run.
  if (method === "POST" && url === "/goal/kickoff") {
    const goal = ctx.goal;
    if (!goal) {
      json(res, 404, { error: "This window is not a goal" });
      return true;
    }
    if (!goalNeedsKickoff(goal.record, ctx.session.getMessages())) {
      json(res, 200, { started: false });
      return true;
    }
    if (ctx.running || ctx.runClaim.active || ctx.autopilotActive) {
      json(res, 409, { error: "The agent is busy" });
      return true;
    }
    // Claim synchronously so a racing prompt queues instead of starting a
    // second run while the kickoff record is being written.
    if (!ctx.runClaim.claim()) {
      json(res, 409, { error: "The agent is busy" });
      return true;
    }
    void markGoalKickoff(goal.dir, new Date())
      .then(async (updated) => {
        if (!updated) {
          json(res, 200, { started: false });
          return;
        }
        ctx.goal = { dir: goal.dir, record: updated };
        json(res, 202, { started: true });
        await ctx.runAgent(updated.name, () =>
          ctx.session.prompt(goalKickoffPrompt(updated), KICKOFF_PROVENANCE),
        );
      })
      .catch((err) => {
        log("ERROR", "app-sidecar", "goal kickoff failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) json(res, 500, { error: "Couldn't start the goal" });
      })
      .finally(() => ctx.runClaim.release());
    return true;
  }

  return false;
}
