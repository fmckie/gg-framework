import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventQueue } from "./event-queue.js";
import { WORKER_PROMPT_BRIEF } from "./tools.js";
import { Worker } from "./worker.js";

const agentSessionMock = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
}));

vi.mock("@kleio/coder", () => ({
  AgentSession: class {
    constructor(options: Record<string, unknown>) {
      agentSessionMock.options.push(options);
    }
  },
}));

beforeEach(() => {
  agentSessionMock.options.length = 0;
});

describe("worker prompt compatibility", () => {
  it("briefs Kleio Coder workers to report to Kleio Manager", () => {
    expect(WORKER_PROMPT_BRIEF).toContain("You are a Kleio Coder worker driven by Kleio Manager");
    expect(WORKER_PROMPT_BRIEF).toContain(
      "Status: <one of: DONE | UNVERIFIED | PARTIAL | BLOCKED | INFO>",
    );
    expect(WORKER_PROMPT_BRIEF).toMatch(/\nTask:\n$/);
  });

  it("retains the legacy ggboss-worker prompt-cache prefix", () => {
    new Worker({
      name: "atlas",
      cwd: "/work/atlas",
      provider: "anthropic",
      model: "claude-test",
      signal: new AbortController().signal,
      queue: new EventQueue(),
    });

    expect(agentSessionMock.options).toHaveLength(1);
    expect(agentSessionMock.options[0]).toMatchObject({
      promptCacheKeyPrefix: "ggboss-worker:atlas",
    });
  });
});
