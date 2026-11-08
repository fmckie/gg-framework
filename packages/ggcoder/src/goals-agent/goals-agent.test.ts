import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSessionOptions } from "../core/agent-session.js";
import {
  GOAL_START_OPTION,
  createGoal,
  goalKickoffPrompt,
  goalNeedsKickoff,
} from "../core/goals-store.js";
import { createAskUserTool } from "../tools/ask-user.js";
import {
  BRIEFING_ERROR,
  buildGoalsAgentPrompt,
  createGoalsAgentSession,
  DELEGATE_ERROR,
  goalCritterPick,
  GOALS_DELEGATED_TOOLS,
  GOALS_SYSTEM_PROMPT,
  GREET_FIRST_ERROR,
} from "./goals-agent.js";

function optionsOf(agent: unknown): AgentSessionOptions {
  return (agent as { opts: AgentSessionOptions }).opts;
}

describe("Kleio Goals agent", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gg-goals-agent-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function goal() {
    const created = await createGoal(
      path.join(tmp, "goals"),
      { name: "Jobs", goal: "Find remote roles in Malaysia" },
      new Date("2026-10-10T00:00:00.000Z"),
    );
    if (!created.ok) throw new Error(created.error);
    return created.value;
  }

  it("is its own primary agent, not the coding agent, with the goal brief in its prompt", async () => {
    const g = await goal();
    const session = createGoalsAgentSession({
      provider: "anthropic",
      model: "claude-opus-5-5",
      cwd: g.dir,
      goal: g,
      transient: true,
    });
    const opts = optionsOf(session);

    expect(opts.agentPrompt).toBe(buildGoalsAgentPrompt(g));
    expect(opts.agentPrompt?.startsWith("You are Kleio Goals")).toBe(true);
    expect(opts.agentPrompt).toContain("Find remote roles in Malaysia");
    expect(opts.agentPrompt).toContain(GOAL_START_OPTION);
    expect(opts.agentRole).toBe("primary");
    expect(opts.agentContext).toBe("none");
    expect(opts.promptCacheKeyPrefix).toBe("gggoals");
    // Plans in the conversation, not through the coding agent's plan mode.
    expect(opts.onEnterPlan).toBeUndefined();
    expect(opts.onExitPlan).toBeUndefined();
    expect(opts.systemPrompt).toBeUndefined();
    expect(GOALS_SYSTEM_PROMPT).not.toContain("Kleio Coder agent");
  });

  it("runs with Ideal self-review suppressed, even after an autopilot toggle", async () => {
    const g = await goal();
    const session = createGoalsAgentSession({
      provider: "anthropic",
      model: "claude-opus-5-5",
      cwd: g.dir,
      goal: g,
      transient: true,
    });
    const suppressed = () =>
      (session as unknown as { idealReviewSuppressed: boolean }).idealReviewSuppressed;
    expect(suppressed()).toBe(true);
    // The sidecar resets this when autopilot is off; a goal session keeps it.
    session.setIdealReviewSuppressed(false);
    expect(suppressed()).toBe(true);
  });

  it("still needs its first reply when the conversation holds only the system prompt", async () => {
    const g = await goal();
    // Regression: a session carries its system message before anyone speaks,
    // which used to count as conversation and skip the automatic reply.
    expect(goalNeedsKickoff(g.record, [{ role: "system" }])).toBe(true);
    expect(goalNeedsKickoff(g.record, [{ role: "system" }, { role: "user" }])).toBe(false);
    expect(goalNeedsKickoff({ ...g.record, kickoffAt: "2026-10-10T00:00:00.000Z" }, [])).toBe(
      false,
    );
  });

  it("holds the question card until Kleio Goals has greeted the user", async () => {
    const g = await goal();
    const asked: unknown[] = [];
    const session = createGoalsAgentSession({
      provider: "anthropic",
      model: "claude-opus-5-5",
      cwd: g.dir,
      goal: g,
      transient: true,
      additionalTools: [
        createAskUserTool(async (request) => {
          asked.push(request);
          return { action: "answer", answers: { q: "Yes" } };
        }),
      ],
    });
    const askUser = optionsOf(session).additionalTools?.find((t) => t.name === "ask_user");
    if (!askUser) throw new Error("ask_user missing");
    const args = {
      questions: [
        {
          id: "q",
          question: "Remote only?",
          kind: "choice",
          options: [{ label: "Yes", recommended: true }, { label: "No" }],
        },
      ],
    };
    const ctx = { signal: new AbortController().signal, toolCallId: "t1" } as Parameters<
      typeof askUser.execute
    >[1];

    await expect(askUser.execute(args, ctx)).rejects.toThrow(GREET_FIRST_ERROR);
    expect(asked).toHaveLength(0);

    // Whitespace is not a greeting.
    session.eventBus.emit("text_delta", { text: "  \n" });
    await expect(askUser.execute(args, ctx)).rejects.toThrow(GREET_FIRST_ERROR);

    session.eventBus.emit("text_delta", { text: "Hi! You want remote roles in Malaysia." });
    expect(String(await askUser.execute(args, ctx))).not.toMatch(/^Error/);
    expect(asked).toHaveLength(1);
  });

  it("asks for the greeting and the goal before any question in the first reply", async () => {
    const g = await goal();
    const kickoff = goalKickoffPrompt(g.record);
    expect(kickoff.indexOf("greet the user")).toBeGreaterThan(-1);
    expect(kickoff.indexOf("greet the user")).toBeLessThan(kickoff.indexOf("Ask about"));
  });

  it("never edits or runs itself, and starts workers only once the goal has started", async () => {
    const g = await goal();
    let active = false;
    const session = createGoalsAgentSession({
      provider: "anthropic",
      model: "claude-opus-5-5",
      cwd: g.dir,
      goal: g,
      transient: true,
      isActive: () => active,
    });
    const wrap = optionsOf(session).wrapTool;
    if (!wrap) throw new Error("wrapTool missing");
    const ran: string[] = [];
    const tool = (name: string) =>
      wrap({
        name,
        description: `${name} tool`,
        parameters: {} as never,
        execute: async () => {
          ran.push(name);
          return "ok";
        },
      });
    const ctx = { signal: new AbortController().signal, toolCallId: "t" } as never;

    // Briefing: read and ask only. No edits, no commands, no workers yet.
    for (const name of ["edit", "bash", "spawn_agent", "followup_task"]) {
      await expect(tool(name).execute({}, ctx)).rejects.toThrow(BRIEFING_ERROR);
    }
    await tool("read").execute({}, ctx);
    expect(ran).toEqual(["read"]);

    // Started: the team does the work; Kleio Goals brings it in and checks it.
    active = true;
    for (const name of GOALS_DELEGATED_TOOLS) {
      await expect(tool(name).execute({}, ctx)).rejects.toThrow(DELEGATE_ERROR);
    }
    for (const name of ["spawn_agent", "wait_agent", "grep", "web_fetch"]) {
      await tool(name).execute({}, ctx);
    }
    expect(ran).toEqual(["read", "spawn_agent", "wait_agent", "grep", "web_fetch"]);
    // Schemas never change, so the cached tool block stays stable.
    const wrapped = tool("bash");
    expect([wrapped.name, wrapped.description]).toEqual(["bash", "bash tool"]);
  });

  it("tells Kleio Goals to orchestrate: spawn workers in parallel, in the right folder", () => {
    expect(GOALS_SYSTEM_PROMPT).toContain("spawn_agent");
    expect(GOALS_SYSTEM_PROMPT).toContain("cwd");
    expect(GOALS_SYSTEM_PROMPT).toMatch(/never edit files, write files or run commands yourself/);
  });

  it("uses the goal's critter model only while it still names a real model", async () => {
    const g = await goal();
    expect(goalCritterPick(g.record)).toBeUndefined();
    const real = goalCritterPick({
      ...g.record,
      critterModel: { provider: "anthropic", model: "claude-opus-5-5" },
    });
    expect(real).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    // Gone from the registry, or now another provider's: fall back to Kleio Goals'.
    expect(
      goalCritterPick({ ...g.record, critterModel: { provider: "anthropic", model: "nope-1" } }),
    ).toBeUndefined();
    expect(
      goalCritterPick({
        ...g.record,
        critterModel: { provider: "openai", model: "claude-opus-5-5" },
      }),
    ).toBeUndefined();
  });
});
