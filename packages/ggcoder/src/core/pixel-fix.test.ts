import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
  buildAgentPrompt,
  fixError,
  type ErrorRow,
  type SpawnFn,
  type FixOptions,
} from "./pixel-fix.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ggcoder-fix-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function setupProjectMapping(
  projectId: string,
  name: string,
  path: string,
  secret = `sk_live_${projectId}_test`,
): void {
  mkdirSync(join(home, ".gg"), { recursive: true });
  writeFileSync(
    join(home, ".gg", "projects.json"),
    JSON.stringify({ [projectId]: { name, path, secret } }),
  );
}

const baseError: ErrorRow = {
  id: "err_abc123",
  project_id: "proj_p1",
  fingerprint: "fp",
  status: "open",
  type: "TypeError",
  message: "Cannot read properties of undefined (reading 'name')",
  stack: JSON.stringify([
    { fn: "UserCard", file: "/repo/src/UserCard.tsx", line: 42, col: 23, in_app: true },
    { fn: "lib", file: "/repo/node_modules/react/index.js", line: 1, col: 1, in_app: false },
  ]),
  code_context: JSON.stringify({
    file: "/repo/src/UserCard.tsx",
    error_line: 42,
    lines: [
      "function UserCard({ user }: Props) {",
      "  return (",
      "    <div>{user.name}</div>",
      "  );",
      "}",
    ],
  }),
  runtime: "node-22",
  occurrences: 47,
  recurrence_count: 0,
  branch: null,
};

describe("buildAgentPrompt", () => {
  it("includes the error type, message, and in-app location", () => {
    const prompt = buildAgentPrompt(baseError, "fix/pixel-err_abc123");
    expect(prompt).toContain("TypeError");
    expect(prompt).toContain("Cannot read properties of undefined");
    expect(prompt).toContain("Location: /repo/src/UserCard.tsx:42");
  });

  it("renders the code window with a marker on the error line", () => {
    const prompt = buildAgentPrompt(baseError, "fix/pixel-err_abc123");
    expect(prompt).toContain("> ");
    expect(prompt).toContain("<div>{user.name}</div>");
  });

  it("renders the stack with (lib) for non-in-app frames", () => {
    const prompt = buildAgentPrompt(baseError, "fix/pixel-err_abc123");
    expect(prompt).toMatch(/UserCard\s+\/repo\/src\/UserCard\.tsx:42(?!\s*\(lib\))/);
    expect(prompt).toMatch(/\/repo\/node_modules\/react\/index\.js:1\s+\(lib\)/);
  });

  it("includes the branch instruction", () => {
    const prompt = buildAgentPrompt(baseError, "fix/pixel-err_abc123");
    expect(prompt).toContain("Create branch: fix/pixel-err_abc123");
    expect(prompt).toContain("Do not merge");
  });

  it("flags recurrence when recurrence_count > 0", () => {
    const prompt = buildAgentPrompt({ ...baseError, recurrence_count: 2 }, "fix/pixel-x");
    expect(prompt).toContain("2nd time");
    expect(prompt).toContain("earlier fix did not hold");
  });
});

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function makeFakeChild(exitCode: number, stdout = "", stderr = ""): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("exit", exitCode);
  });
  return child;
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

function buildSpawnFn(handlers: Array<(call: SpawnCall) => FakeChild>): {
  fn: SpawnFn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  let i = 0;
  const fn: SpawnFn = (command, args, options) => {
    const call = { command, args, options };
    calls.push(call);
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i++;
    if (!handler) throw new Error(`unexpected spawn call: ${command} ${args.join(" ")}`);
    return handler(call) as unknown as ChildProcess;
  };
  return { fn, calls };
}

function fakeFetchScript(handlers: Array<(req: { method: string; url: string }) => Response>): {
  fn: typeof fetch;
  calls: Array<{ method: string; url: string }>;
} {
  const calls: Array<{ method: string; url: string }> = [];
  let i = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i++;
    if (!handler) throw new Error(`unexpected fetch: ${method} ${url}`);
    return handler({ method, url });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("fixError — orchestration", () => {
  it("marks awaiting_review when the agent succeeds, branch exists, and has commits", async () => {
    setupProjectMapping("proj_p1", "demo-app", "/tmp/demo-app");

    const { fn: fetchFn, calls: fetchCalls } = fakeFetchScript([
      // GET /api/errors/err_abc123
      () => new Response(JSON.stringify(baseError), { status: 200 }),
      // PATCH in_progress
      () => new Response(JSON.stringify({ ...baseError, status: "in_progress" }), { status: 200 }),
      // PATCH awaiting_review
      () =>
        new Response(JSON.stringify({ ...baseError, status: "awaiting_review" }), { status: 200 }),
    ]);

    const { fn: spawnFn, calls: spawnCalls } = buildSpawnFn([
      // Coder agent run
      () => makeFakeChild(0),
      // git show-ref --verify refs/heads/fix/pixel-err_abc123
      () => makeFakeChild(0),
      // git show-ref --verify refs/heads/main
      () => makeFakeChild(0),
      // git rev-list --count main..fix/pixel-err_abc123
      () => makeFakeChild(0, "3\n"),
    ]);

    const result = await fixError("err_abc123", {
      homeDir: home,
      fetchFn,
      spawnFn,
      kleioCoderBin: "kleio-coder-test",
      ggcoderBin: "ggcoder-legacy-ignored",
      inheritStdio: false,
    } satisfies FixOptions);

    expect(result.outcome).toBe("awaiting_review");
    expect(result.branch).toBe("fix/pixel-err_abc123");
    expect(result.reason).toContain("3 commit");

    // The branded override wins while the deprecated option remains accepted.
    const ggCall = spawnCalls[0];
    expect(ggCall?.command).toBe("kleio-coder-test");
    expect(ggCall?.args).toContain("--json");
    expect(ggCall?.args).toContain("--system-prompt");
    expect(ggCall?.options.cwd).toBe("/tmp/demo-app");

    // Status PATCH sequence: in_progress, then awaiting_review
    const patchBodies = fetchCalls.filter((c) => c.method === "PATCH").map((c) => c.url);
    expect(patchBodies).toEqual([
      "https://gg-pixel-server.buzzbeamaustralia.workers.dev/api/errors/err_abc123",
      "https://gg-pixel-server.buzzbeamaustralia.workers.dev/api/errors/err_abc123",
    ]);
  });

  it("marks failed when the agent exits non-zero", async () => {
    setupProjectMapping("proj_p1", "demo-app", "/tmp/demo-app");

    const { fn: fetchFn } = fakeFetchScript([
      () => new Response(JSON.stringify(baseError), { status: 200 }),
      () => new Response("{}", { status: 200 }), // PATCH in_progress
      () => new Response("{}", { status: 200 }), // PATCH failed
    ]);

    const { fn: spawnFn, calls: spawnCalls } = buildSpawnFn([() => makeFakeChild(1)]);

    const result = await fixError("err_abc123", {
      homeDir: home,
      fetchFn,
      spawnFn,
      ggcoderBin: "legacy-automation-bin",
      inheritStdio: false,
    });

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("exited with code 1");
    expect(spawnCalls[0]?.command).toBe("legacy-automation-bin");
  });

  it("marks failed when the branch was not created", async () => {
    setupProjectMapping("proj_p1", "demo-app", "/tmp/demo-app");

    const { fn: fetchFn } = fakeFetchScript([
      () => new Response(JSON.stringify(baseError), { status: 200 }),
      () => new Response("{}", { status: 200 }),
      () => new Response("{}", { status: 200 }),
    ]);

    const { fn: spawnFn } = buildSpawnFn([
      () => makeFakeChild(0), // Coder ok
      () => makeFakeChild(1), // git show-ref FAIL
    ]);

    const result = await fixError("err_abc123", {
      homeDir: home,
      fetchFn,
      spawnFn,
      inheritStdio: false,
    });

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("not created");
  });

  it("marks failed when the branch exists but has no commits ahead of main", async () => {
    setupProjectMapping("proj_p1", "demo-app", "/tmp/demo-app");

    const { fn: fetchFn } = fakeFetchScript([
      () => new Response(JSON.stringify(baseError), { status: 200 }),
      () => new Response("{}", { status: 200 }),
      () => new Response("{}", { status: 200 }),
    ]);

    const { fn: spawnFn } = buildSpawnFn([
      () => makeFakeChild(0), // Coder
      () => makeFakeChild(0), // branch exists
      () => makeFakeChild(0), // main exists
      () => makeFakeChild(0, "0\n"), // 0 commits ahead
    ]);

    const result = await fixError("err_abc123", {
      homeDir: home,
      fetchFn,
      spawnFn,
      inheritStdio: false,
    });

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("no new commits");
  });

  it("falls back to master when main does not exist", async () => {
    setupProjectMapping("proj_p1", "demo-app", "/tmp/demo-app");

    const { fn: fetchFn } = fakeFetchScript([
      () => new Response(JSON.stringify(baseError), { status: 200 }),
      () => new Response("{}", { status: 200 }),
      () => new Response("{}", { status: 200 }),
    ]);

    const { fn: spawnFn, calls: spawnCalls } = buildSpawnFn([
      () => makeFakeChild(0), // Coder
      () => makeFakeChild(0), // branch exists
      () => makeFakeChild(1), // main missing
      () => makeFakeChild(0), // master exists
      () => makeFakeChild(0, "2\n"), // 2 commits ahead of master
    ]);

    const result = await fixError("err_abc123", {
      homeDir: home,
      fetchFn,
      spawnFn,
      inheritStdio: false,
    });

    expect(result.outcome).toBe("awaiting_review");
    const masterCall = spawnCalls.find((c) => c.args.includes("master..fix/pixel-err_abc123"));
    expect(masterCall).toBeTruthy();
  });

  it("throws when no projects.json mapping exists for the project_id", async () => {
    // No setupProjectMapping call — projects.json doesn't exist
    const { fn: fetchFn } = fakeFetchScript([
      () => new Response(JSON.stringify(baseError), { status: 200 }),
    ]);
    const { fn: spawnFn } = buildSpawnFn([]);

    await expect(
      fixError("err_abc123", {
        homeDir: home,
        fetchFn,
        spawnFn,
        inheritStdio: false,
      }),
    ).rejects.toThrow(/No projects mapping/);
  });

  it("throws when no project on this machine owns the error (all secrets reject)", async () => {
    // proj_OTHER is registered but its secret returns 403/404 against err_abc123.
    setupProjectMapping("proj_OTHER", "x", "/x");
    const { fn: fetchFn } = fakeFetchScript([
      () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    ]);
    const { fn: spawnFn } = buildSpawnFn([]);

    await expect(
      fixError("err_abc123", {
        homeDir: home,
        fetchFn,
        spawnFn,
        inheritStdio: false,
      }),
    ).rejects.toThrow(/not found in any registered project/);
  });

  it("throws when projects.json has no entries with a stored secret", async () => {
    // Legacy entries (no secret) — must re-install before management works.
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({ proj_legacy: { name: "x", path: "/x" } }),
    );
    const { fn: fetchFn } = fakeFetchScript([]);
    const { fn: spawnFn } = buildSpawnFn([]);

    await expect(
      fixError("err_abc123", {
        homeDir: home,
        fetchFn,
        spawnFn,
        inheritStdio: false,
      }),
    ).rejects.toThrow(/No managed projects/);
  });
});

describe("fixError — wiring", () => {
  it("marks the error in_progress before spawning the agent", async () => {
    setupProjectMapping("proj_p1", "demo-app", "/tmp/demo-app");

    const observed: string[] = [];
    const { fn: fetchFn } = fakeFetchScript([
      () => new Response(JSON.stringify(baseError), { status: 200 }),
      () => {
        observed.push("PATCH-1");
        return new Response("{}", { status: 200 });
      },
      () => {
        observed.push("PATCH-2");
        return new Response("{}", { status: 200 });
      },
    ]);

    const { fn: spawnFn } = buildSpawnFn([
      () => {
        observed.push("SPAWN");
        return makeFakeChild(0);
      },
      () => makeFakeChild(0),
      () => makeFakeChild(0),
      () => makeFakeChild(0, "1\n"),
    ]);

    await fixError("err_abc123", { homeDir: home, fetchFn, spawnFn, inheritStdio: false });

    expect(observed).toEqual(["PATCH-1", "SPAWN", "PATCH-2"]);
  });
});

// Silence vitest unused import warning
void vi;
