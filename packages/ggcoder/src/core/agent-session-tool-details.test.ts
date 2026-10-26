import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as GgAgentModule from "@kleio/agent";
import type * as McpModule from "./mcp/index.js";
import { useFakeHome } from "../test-support/fake-home.js";

const agentLoopMock = vi.hoisted(() => vi.fn());

vi.mock("@kleio/agent", async () => {
  const actual = await vi.importActual<typeof GgAgentModule>("@kleio/agent");
  return { ...actual, agentLoop: agentLoopMock };
});

vi.mock("./mcp/index.js", async () => {
  const actual = await vi.importActual<typeof McpModule>("./mcp/index.js");
  return {
    ...actual,
    MCPClientManager: vi.fn(function MCPClientManagerMock() {
      return { connectAll: vi.fn(async () => []), dispose: vi.fn(async () => {}) };
    }),
  };
});

let restoreHome: (() => void) | undefined;
let tmpHome: string;
let tmpProject: string;

const usage = { inputTokens: 10, outputTokens: 5 };

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-tool-details-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-tool-details-project-"));
  restoreHome = useFakeHome(tmpHome);
  agentLoopMock.mockReset();
  agentLoopMock.mockImplementation(async function* () {
    yield { type: "agent_done", totalTurns: 1, totalUsage: usage };
  });
  await writeJson(path.join(tmpHome, ".gg", "auth.json"), {
    anthropic: {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3_600_000,
    },
  });
  await writeJson(path.join(tmpHome, ".gg", "settings.json"), { autoCompact: false });
});

afterEach(async () => {
  restoreHome?.();
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(tmpProject, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** The options a session's run gave the agent loop. */
async function loopOptions(
  toolDetails?: (details: unknown) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const { AgentSession } = await import("./agent-session.js");
  const session = new AgentSession({
    provider: "anthropic",
    model: "claude-test",
    cwd: tmpProject,
    systemPrompt: "test system prompt",
    ...(toolDetails ? { toolDetails } : {}),
  });
  await session.initialize();
  await session.prompt("hi");
  await session.dispose();
  return agentLoopMock.mock.calls[0]?.[1] as Record<string, unknown>;
}

describe("toolDetails", () => {
  it("is the loop's transformToolDetails, for the app's sidecar", async () => {
    const toolDetails = async (details: unknown): Promise<unknown> => details;
    expect((await loopOptions(toolDetails)).transformToolDetails).toBe(toolDetails);
  }, 15_000);

  it("is unset without it, as in the terminal", async () => {
    expect((await loopOptions()).transformToolDetails).toBeUndefined();
  }, 15_000);
});
