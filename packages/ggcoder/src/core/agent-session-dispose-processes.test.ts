/**
 * Background commands run in their own process group, so nothing but the
 * session's ProcessManager can stop them. Quitting the app gives the daemon a
 * few seconds before it is force-killed; if dispose() awaits anything slow
 * (a post-turn compaction, an MCP server) before stopping them, they outlive
 * the app as orphans. Stopping them must be the first, synchronous step.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { useFakeHome } from "../test-support/fake-home.js";
import type { AgentSession } from "./agent-session.js";
import type { ProcessManager } from "./process-manager.js";

interface DisposeInternals {
  processManager?: ProcessManager;
  postTurnCompaction?: Promise<void>;
}

let restoreHome: (() => void) | undefined;
let tmpHome: string;
let tmpProject: string;
let session: AgentSession | undefined;
let manager: ProcessManager | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "gg-dispose-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "gg-dispose-"));
  restoreHome = useFakeHome(tmpHome);
  await fs.mkdir(path.join(tmpHome, ".gg"), { recursive: true });
  await fs.writeFile(
    path.join(tmpHome, ".gg", "auth.json"),
    JSON.stringify({
      anthropic: {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3_600_000,
      },
    }),
    "utf-8",
  );
});

afterEach(async () => {
  manager?.shutdownAll();
  manager = undefined;
  session = undefined;
  restoreHome?.();
  await fs.rm(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await fs.rm(tmpProject, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function waitForExit(id: string, timeoutMs = 10_000): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const proc = manager?.list().find((entry) => entry.id === id);
    if (proc?.exitCode !== null && proc?.exitCode !== undefined) return proc.exitCode;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

it("stops background commands before awaiting a slow teardown step", async () => {
  // Arrange: a live session with a long-running background command and a
  // post-turn compaction that never settles.
  const { AgentSession: Session } = await import("./agent-session.js");
  session = new Session({
    provider: "anthropic",
    model: "claude-test",
    cwd: tmpProject,
    transient: true,
    systemPrompt: "test",
  });
  await session.initialize();
  const internal = session as unknown as DisposeInternals;
  manager = internal.processManager;
  expect(manager).toBeDefined();
  const started = await manager?.start(
    `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 60000)"`,
    tmpProject,
  );
  internal.postTurnCompaction = new Promise<void>(() => {});

  // Act: dispose without awaiting — it is wedged on the compaction.
  void session.dispose();

  // Assert: the background command is already being stopped.
  expect(await waitForExit(started?.id ?? "")).not.toBeNull();
});
