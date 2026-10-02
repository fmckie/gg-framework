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
import { keepAliveWhileOwnerLives } from "../test-support/keep-alive.js";
import type { ProcessManager } from "./process-manager.js";

interface DisposeInternals {
  processManager?: ProcessManager;
  postTurnCompaction?: Promise<void>;
}

let restoreHome: (() => void) | undefined;
let tmpHome: string;
let tmpProject: string;
let manager: ProcessManager | undefined;
/** Settles the wedged compaction so the pending dispose() can finish. */
let releaseCompaction: (() => void) | undefined;
let pendingDispose: Promise<void> | undefined;

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
  // Let the wedged dispose() run to completion so the session releases every
  // handle it holds in the project dir; otherwise Windows fails the rm (EBUSY).
  releaseCompaction?.();
  await pendingDispose;
  releaseCompaction = undefined;
  pendingDispose = undefined;
  manager?.shutdownAll();
  manager = undefined;
  restoreHome?.();
  await fs.rm(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await fs.rm(tmpProject, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the OS to actually reap `pid`. The manager marks a process exited the
 * moment it signals it, but on Windows the dying tree still holds handles in its
 * cwd for a while — so the real process table is the only honest signal.
 */
async function waitForProcessGone(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

it("stops background commands before awaiting a slow teardown step", async () => {
  // Arrange: a live session with a long-running background command and a
  // post-turn compaction that does not settle until the test releases it.
  const { AgentSession: Session } = await import("./agent-session.js");
  const session = new Session({
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
    `${JSON.stringify(process.execPath)} -e "${keepAliveWhileOwnerLives()}"`,
    tmpProject,
  );
  expect(started).toBeDefined();
  internal.postTurnCompaction = new Promise<void>((resolve) => {
    releaseCompaction = resolve;
  });

  // Act: dispose without awaiting — it is wedged on the compaction.
  pendingDispose = session.dispose();

  // Assert: the background command dies while dispose() is still wedged.
  expect(await waitForProcessGone(started?.pid ?? -1)).toBe(true);
});
