import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoal, goalsRoot, readGoal } from "../core/goals-store.js";
import { RunClaim } from "../core/run-claim.js";
import { handleGoalRoutes } from "./goal-routes.js";
import type { SessionRouteContext } from "./route-context.js";

interface Reply {
  status: number;
  body: unknown;
}

function fakeResponse(): { res: http.ServerResponse; reply: Promise<Reply> } {
  let resolve: (reply: Reply) => void = () => {};
  const reply = new Promise<Reply>((r) => (resolve = r));
  let status = 0;
  const res = {
    headersSent: false,
    writeHead(code: number) {
      status = code;
      this.headersSent = true;
      return this;
    },
    end(payload: string) {
      resolve({ status, body: JSON.parse(payload) as unknown });
    },
  };
  return { res: res as unknown as http.ServerResponse, reply };
}

describe("goal kickoff route", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gg-goal-routes-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function goalContext(messages: unknown[] = []) {
    const created = await createGoal(
      goalsRoot(tmp),
      { name: "Perf", goal: "Make it fast" },
      new Date(),
    );
    if (!created.ok) throw new Error(created.error);
    const prompt = vi.fn(async () => {});
    const runAgent = vi.fn(async (_label: string, run: () => Promise<void>) => run());
    const ctx = {
      goal: created.value,
      session: { getMessages: () => messages, prompt },
      running: false,
      autopilotActive: false,
      runClaim: new RunClaim(),
      runAgent,
      paths: { agentDir: tmp, sessionsDir: path.join(tmp, "sessions") },
      sessionId: "me",
      sessionIdsAt: vi.fn((_cwd: string): string[] => []),
    };
    return { ctx, dir: created.value.dir, prompt, runAgent };
  }

  function remove(ctx: object, id: string): Promise<Reply> {
    const { res, reply } = fakeResponse();
    const req = Readable.from([Buffer.from(JSON.stringify({ id }))]);
    handleGoalRoutes(
      ctx as SessionRouteContext,
      req as unknown as http.IncomingMessage,
      res,
      "/goals/delete",
      "POST",
    );
    return reply;
  }

  function kickoff(ctx: object): Promise<Reply> {
    const { res, reply } = fakeResponse();
    const handled = handleGoalRoutes(
      ctx as SessionRouteContext,
      {} as http.IncomingMessage,
      res,
      "/goal/kickoff",
      "POST",
    );
    expect(handled).toBe(true);
    return reply;
  }

  it("starts the first reply once with a hidden runtime prompt, then never again", async () => {
    const { ctx, dir, prompt, runAgent } = await goalContext();

    expect(await kickoff(ctx)).toEqual({ status: 202, body: { started: true } });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(runAgent).toHaveBeenCalledWith("Perf", expect.any(Function));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('"Perf"'), {
      source: "runtime",
      kind: "automation",
      visibility: "hidden",
    });
    expect((await readGoal(dir))?.kickoffAt).toBeTypeOf("string");
    await vi.waitFor(() => expect(ctx.runClaim.active).toBe(false));

    expect(await kickoff(ctx)).toEqual({ status: 200, body: { started: false } });
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("does not kick off a goal whose conversation already has messages", async () => {
    const { ctx, prompt } = await goalContext([{ role: "user", content: "hi" }]);
    expect(await kickoff(ctx)).toEqual({ status: 200, body: { started: false } });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("refuses while another run holds the claim", async () => {
    const { ctx, prompt } = await goalContext();
    ctx.runClaim.claim();
    expect(await kickoff(ctx)).toEqual({ status: 409, body: { error: "The agent is busy" } });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("is a 404 outside a goal window", async () => {
    const { ctx } = await goalContext();
    expect(await kickoff({ ...ctx, goal: null })).toEqual({
      status: 404,
      body: { error: "This window is not a goal" },
    });
  });

  it("deletes a goal only when no other window has it open and it is not running", async () => {
    const { ctx, dir } = await goalContext();

    ctx.sessionIdsAt.mockReturnValue(["me", "other"]);
    expect(await remove(ctx, "perf")).toEqual({
      status: 409,
      body: { error: "This goal is open in another window. Close it there first." },
    });

    ctx.sessionIdsAt.mockReturnValue(["me"]);
    ctx.running = true;
    expect(await remove(ctx, "perf")).toEqual({
      status: 409,
      body: { error: "This goal is still working. Stop it first." },
    });
    expect((await fs.stat(dir)).isDirectory()).toBe(true);

    ctx.running = false;
    expect(await remove(ctx, "perf")).toEqual({ status: 200, body: { ok: true } });
    await expect(fs.stat(dir)).rejects.toThrow();
    expect(ctx.goal).toBeNull();
    expect(await remove(ctx, "perf")).toEqual({ status: 404, body: { error: "Unknown goal" } });
  });
});
