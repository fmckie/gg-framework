/**
 * Safety features across Kleio Coder's modes. Every mode shares the guarded
 * tools (bash/write/edit/web) and gets the chat row; only a real project
 * session (code mode, and workers inside it) records the "don't install" list,
 * and only the session that owns the project runs the background check.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFakeHome } from "../test-support/fake-home.js";
import type { AgentSessionOptions } from "./agent-session.js";

vi.mock("./logger.js", () => ({ log: vi.fn() }));

let dir: string;
let restoreHome: () => void;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "gg-safety-modes-"));
  restoreHome = useFakeHome(dir);
});
afterEach(async () => {
  restoreHome();
  await fs.rm(dir, { recursive: true, force: true });
});

const BLOCK = {
  result:
    "Error: Blocked install (malicious-package): chalk@5.6.1 is flagged as malware (MAL-2025-46969); use chalk@5.6.2.",
  details: {
    safetyBlock: {
      packages: [
        {
          ecosystem: "npm",
          name: "chalk",
          version: "5.6.1",
          reason: "known malware (MAL-2025-46969)",
        },
      ],
    },
  },
};

interface Outcome {
  chatRows: number;
  listWritten: boolean;
  watching: boolean;
}

/** Run one blocked install through a session configured like `mode`. */
async function blockIn(
  extra: Partial<AgentSessionOptions>,
  commands: string[] = ["npm install chalk@5.6.1"],
): Promise<Outcome> {
  const { AgentSession } = await import("./agent-session.js");
  const cwd = path.join(dir, "project");
  await fs.mkdir(path.join(cwd, ".git"), { recursive: true });
  const session = new AgentSession({
    provider: "anthropic",
    model: "claude-test",
    cwd,
    transient: true,
    loadExtensions: false,
    systemPrompt: "test",
    allowedTools: ["read", "bash"],
    blockedPackagesFile: true,
    // Prove which modes would start it, without timers or network.
    installedPackageWatch: true,
    installedPackageWatchDelayMs: 60_000,
    ...extra,
  });
  type Internals = {
    trackHookEvent(event: unknown): Promise<void>;
    installedWatchStop?: () => void;
  };
  const internal = session as unknown as Internals;
  try {
    await session.initialize();
    let chatRows = 0;
    session.eventBus.on("security_block", () => chatRows++);
    for (const [i, command] of commands.entries()) {
      await internal.trackHookEvent({
        type: "tool_call_start",
        toolCallId: `t${i}`,
        name: "bash",
        args: { command },
      });
      await internal.trackHookEvent({
        type: "tool_call_end",
        toolCallId: `t${i}`,
        isError: false,
        durationMs: 1,
        ...BLOCK,
      });
    }
    // The list write is fire-and-forget; give it a moment.
    await new Promise((r) => setTimeout(r, 150));
    const listWritten = await fs
      .readFile(path.join(cwd, "CLAUDE.md"), "utf8")
      .then((t) => t.includes("chalk@5.6.1"))
      .catch(() => false);
    return { chatRows, listWritten, watching: internal.installedWatchStop !== undefined };
  } finally {
    await session.dispose();
  }
}

describe("safety features per mode", () => {
  it("code mode: chat row, project list, background check", async () => {
    expect(await blockIn({})).toEqual({ chatRows: 1, listWritten: true, watching: true });
  });

  it("worker inside a project (GG Goals team, sub-agents): row + list, parent watches", async () => {
    expect(await blockIn({ subagentWorker: true })).toEqual({
      chatRows: 1,
      listWritten: true,
      watching: false,
    });
  });

  it("GG Goals coordinator (goal notes folder): row only, no list, no watch", async () => {
    expect(await blockIn({ agentContext: "none" })).toEqual({
      chatRows: 1,
      listWritten: false,
      watching: false,
    });
  });

  it("GG Motion (own skills, not a project): row only", async () => {
    expect(
      await blockIn({ skills: [], projectCustomization: false, agentContext: "none" }),
    ).toEqual({ chatRows: 1, listWritten: false, watching: false });
  });

  it("chat mode (no project customization): row only", async () => {
    expect(await blockIn({ projectCustomization: false })).toEqual({
      chatRows: 1,
      listWritten: false,
      watching: false,
    });
  });
});

describe("security rows under spam", () => {
  it("the same blocked install retried 30 times leaves one row", async () => {
    const same = Array.from({ length: 30 }, () => "npm install chalk@5.6.1");
    expect((await blockIn({}, same)).chatRows).toBe(1);
  }, 30_000);

  it("40 different blocks in one run leave at most 20 rows", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `npm install pkg-${i}`);
    expect((await blockIn({}, many)).chatRows).toBe(20);
  }, 30_000);
});

describe("security row target", () => {
  it("keeps the first line, strips control and bidi-override characters, caps length", async () => {
    const { securityRowTarget } = await import("./agent-session.js");
    expect(securityRowTarget("npm i a\nsecond")).toBe("npm i a");
    expect(securityRowTarget("ab\u202Edc\u0007")).toBe("abdc");
    expect(securityRowTarget("x".repeat(500))).toHaveLength(120);
    expect(securityRowTarget("")).toBe("");
    expect(securityRowTarget("npm i 🎉 שלום")).toBe("npm i 🎉 שלום");
  });

  it("home folder and filesystem roots are never scanned", async () => {
    const { isScannableProjectDir } = await import("./agent-session.js");
    expect(isScannableProjectDir(dir, dir)).toBe(false);
    expect(isScannableProjectDir(path.parse(dir).root, dir)).toBe(false);
    expect(isScannableProjectDir(path.join(dir, "project"), dir)).toBe(true);
  });
});
