import fs, { mkdtempSync } from "node:fs";
import { mkdir, writeFile, readFile, rm, readdir, stat, symlink } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
import type * as ConfigModule from "../config.js";

// Hoisted-mock indirection (same pattern as project-discovery.test.ts):
// vi.mock is hoisted above imports, so the mock reads `state` at call time.
const state = { agentDir: "" };

vi.mock("../config.js", async (orig) => {
  const actual = await orig<typeof ConfigModule>();
  return {
    ...actual,
    getAppPaths: () => ({ ...actual.getAppPaths(), agentDir: state.agentDir }),
  };
});
import {
  SessionDiagnosticsRecorder,
  aggregateRecentDiagnostics,
  createDiagnoseCommand,
  diagnosticsSessionsDir,
  isInternalDiagnosticsEnabled,
  resetInternalDiagnosticsCacheForTests,
} from "./internal-diagnostics.js";

// The sessions dir is env-overridable precisely so tests never touch the
// real ~/.gg. The flag file lives under getAppPaths().agentDir (real home),
// so flag tests use the env switch only, plus a direct file test via
// process.env.HOME pointing at a temp dir.
let tmpHome: string;
let tmpDir: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "ggdiag-home-"));
  state.agentDir = path.join(tmpHome, ".gg");
  tmpDir = path.join(tmpHome, "diag-sessions");
  process.env.GG_DIAGNOSTICS_DIR = tmpDir;
  process.env.GG_INTERNAL = "";
  resetInternalDiagnosticsCacheForTests();
});

afterEach(async () => {
  delete process.env.GG_DIAGNOSTICS_DIR;
  delete process.env.GG_INTERNAL;
  await rm(tmpHome, { recursive: true, force: true });
});

describe("isInternalDiagnosticsEnabled", () => {
  it("is off by default", () => {
    resetInternalDiagnosticsCacheForTests();
    expect(isInternalDiagnosticsEnabled()).toBe(false);
  });

  it("an explicit off switch wins over the opt-in file", async () => {
    await mkdir(state.agentDir, { recursive: true });
    await writeFile(
      path.join(state.agentDir, "internal.json"),
      JSON.stringify({ diagnostics: true }),
    );
    process.env.GG_INTERNAL = "0";
    expect(isInternalDiagnosticsEnabled()).toBe(false);
  });

  it("turns on via GG_INTERNAL=1", () => {
    resetInternalDiagnosticsCacheForTests();
    process.env.GG_INTERNAL = "1";
    expect(isInternalDiagnosticsEnabled()).toBe(true);
  });

  it("turns on via ~/.gg/internal.json diagnostics:true, and nothing else", async () => {
    resetInternalDiagnosticsCacheForTests();
    await mkdir(path.join(tmpHome, ".gg"), { recursive: true });
    await writeFile(path.join(tmpHome, ".gg", "internal.json"), `{"diagnostics":true}`);
    expect(isInternalDiagnosticsEnabled()).toBe(true);

    resetInternalDiagnosticsCacheForTests();
    await writeFile(path.join(tmpHome, ".gg", "internal.json"), `{"diagnostics":false}`);
    expect(isInternalDiagnosticsEnabled()).toBe(false);
  });
});

describe("SessionDiagnosticsRecorder", () => {
  beforeEach(() => {
    process.env.GG_INTERNAL = "1";
  });
  function recorder(): SessionDiagnosticsRecorder {
    return new SessionDiagnosticsRecorder({
      sessionId: "s1",
      cwd: "/tmp/proj",
      provider: "glm",
      model: "glm-5.3",
      dir: tmpDir,
    });
  }

  it("counts tool calls, errors, durations, and writes the record per turn", async () => {
    const bus = new EventBus();
    const rec = recorder();
    rec.attach(bus);

    bus.emit("tool_call_start", { toolCallId: "t1", name: "grep", args: { pattern: "foo" } });
    bus.emit("tool_call_end", {
      toolCallId: "t1",
      result: "src/a.ts:1:foo",
      isError: false,
      durationMs: 40,
    });
    bus.emit("tool_call_start", { toolCallId: "t2", name: "bash", args: { command: "ls" } });
    bus.emit("tool_call_end", {
      toolCallId: "t2",
      result: "Error: command failed with code N",
      isError: true,
      durationMs: 100,
    });
    rec.recordTurnMetric({
      turn: 1,
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50, cacheRead: 800 },
      timing: { providerDurationMs: 900, ttftMs: 300 },
    });
    await vi.waitFor(async () => {
      const files = await readdir(tmpDir);
      expect(files).toHaveLength(1);
    });

    const raw = await readFile(path.join(tmpDir, "s1.json"), "utf8");
    const record = JSON.parse(raw);
    expect(record.toolStats.grep).toMatchObject({ calls: 1, errors: 0, totalMs: 40, maxMs: 40 });
    expect(record.toolStats.bash).toMatchObject({ calls: 1, errors: 1, maxMs: 100 });
    expect(record.totals).toMatchObject({
      toolCalls: 2,
      toolErrors: 1,
      inputTokens: 100,
      cacheRead: 800,
    });
    expect(record.errorClusters[0].count).toBe(1);
    expect(record.errorClusters[0].digest).toMatch(/^[a-f0-9]{64}$/);
    expect(raw).not.toContain("command failed");
    expect(record.errorClusters[0]).not.toHaveProperty("sample");
    expect(record.turns[0]).toMatchObject({ turn: 1, ttftMs: 300 });
  });

  it("clusters repeated identical errors and flags repeated identical calls", async () => {
    const bus = new EventBus();
    const rec = recorder();
    rec.attach(bus);

    for (let i = 0; i < 4; i++) {
      bus.emit("tool_call_start", { toolCallId: `r${i}`, name: "grep", args: { pattern: "same" } });
      bus.emit("tool_call_end", {
        toolCallId: `r${i}`,
        result: "Error: exit code 1",
        isError: true,
        durationMs: 10,
      });
    }
    await rec.finalize();

    expect(rec.repeatsForTests()).toEqual([
      { tool: "grep", argsDigest: expect.stringMatching(/^[a-f0-9]{64}$/), count: 4 },
    ]);
    // 4 identical failures → ONE cluster row with count 4, not four rows
    expect(rec.errorClustersForTests()).toHaveLength(1);
    expect(rec.errorClustersForTests()[0].count).toBe(4);
  });

  it("records model switches, compactions, and truncations", async () => {
    const bus = new EventBus();
    const rec = recorder();
    rec.attach(bus);

    bus.emit("model_change", { provider: "openai", model: "gpt-5.5" });
    bus.emit("compaction_end", { compacted: true, originalCount: 40, newCount: 8 });
    bus.emit("truncated", { reason: "max_tokens", continued: true });
    await rec.finalize();

    const snapshot = rec.snapshotForTests();
    expect(snapshot.modelSwitches).toHaveLength(1);
    expect(snapshot.compactions).toEqual([{ originalCount: 40, newCount: 8 }]);
    expect(snapshot.truncations).toEqual([{ reason: "max_tokens", continued: true }]);
  });

  it("summary() is agent-readable and includes cache reuse", () => {
    const bus = new EventBus();
    const rec = recorder();
    rec.attach(bus);
    rec.recordTurnMetric({
      turn: 1,
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 10, cacheRead: 900 },
      timing: { providerDurationMs: 500 },
    });
    const text = rec.summary();
    expect(text).toContain("reuse");
    expect(text).toContain("90%"); // 900 / (900 + 100)
  });
});

describe("aggregateRecentDiagnostics + /diagnose", () => {
  beforeEach(() => {
    process.env.GG_INTERNAL = "1";
  });
  it("ranks cross-session findings from persisted records", async () => {
    // Two sessions: one healthy, one leaky (repeats + errors + low cache).
    for (const [id, leaky] of [
      ["healthy", false],
      ["leaky", true],
    ] as const) {
      const bus = new EventBus();
      const rec = new SessionDiagnosticsRecorder({
        sessionId: id,
        cwd: "/tmp/proj",
        provider: "glm",
        model: "glm-5.3",
        dir: tmpDir,
      });
      rec.attach(bus);
      const errors = leaky ? 5 : 0;
      for (let i = 0; i < 6; i++) {
        bus.emit("tool_call_start", {
          toolCallId: `${id}-${i}`,
          name: "grep",
          args: { pattern: "x" },
        });
        bus.emit("tool_call_end", {
          toolCallId: `${id}-${i}`,
          result: i < errors ? "Error: exit code 1" : "ok",
          isError: i < errors,
          durationMs: leaky ? 900 : 50,
        });
      }
      rec.recordTurnMetric({
        turn: 1,
        stopReason: "end_turn",
        usage: leaky
          ? { inputTokens: 900, outputTokens: 50 }
          : { inputTokens: 100, outputTokens: 50, cacheRead: 900 },
        timing: { providerDurationMs: 500 },
      });
      await rec.finalize();
    }

    const { report, sessionCount } = aggregateRecentDiagnostics(10);
    expect(sessionCount).toBe(2);
    expect(report).toContain("grep");
    expect(report).toContain("5\u00d7"); // clustered error count surfaced
    expect(report.toLowerCase()).toContain("repeat");
  });

  it("/diagnose returns the aggregate report", async () => {
    const cmd = createDiagnoseCommand();
    expect(cmd.name).toBe("diagnose");
    const out = await cmd.execute("5", {} as never);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("handles an empty diagnostics dir without throwing", () => {
    const { report, sessionCount } = aggregateRecentDiagnostics(10);
    expect(sessionCount).toBe(0);
    expect(report.toLowerCase()).toContain("no session");
  });
});

describe("diagnostics privacy and persistence", () => {
  function recorder(id = "private") {
    return new SessionDiagnosticsRecorder({
      sessionId: id,
      cwd: "/tmp/project",
      provider: "openai",
      model: "test",
      dir: tmpDir,
    });
  }

  it("never retains short arguments or raw error text in records or summaries", async () => {
    process.env.GG_INTERNAL = "1";
    const rec = recorder();
    const bus = new EventBus();
    rec.attach(bus);
    for (let i = 0; i < 3; i++) {
      bus.emit("tool_call_start", {
        toolCallId: String(i),
        name: "bash",
        args: { command: "private-synthetic-argument" },
      });
      bus.emit("tool_call_end", {
        toolCallId: String(i),
        result: "Error: private-synthetic-error",
        isError: true,
        durationMs: 1,
      });
    }
    const live = JSON.stringify(rec.snapshotForTests()) + rec.summary();
    await rec.finalize();
    const persisted = await readFile(path.join(tmpDir, "private.json"), "utf8");
    const report = aggregateRecentDiagnostics(10).report;
    for (const output of [live, persisted, report]) {
      expect(output).not.toContain("private-synthetic-argument");
      expect(output).not.toContain("private-synthetic-error");
    }
    expect(rec.summary()).toContain("Repeated identical calls");
  });

  it("redacts environment secrets in metadata and rejects invalid counters", async () => {
    process.env.GG_INTERNAL = "1";
    vi.stubEnv("DIAGNOSTICS_TEST_API_KEY", "synthetic-metadata-secret");
    try {
      const rec = new SessionDiagnosticsRecorder({
        sessionId: "private",
        cwd: "/tmp/synthetic-metadata-secret",
        provider: "openai",
        model: "synthetic-metadata-secret",
        dir: tmpDir,
      });
      rec.recordTurnMetric({
        turn: 1,
        stopReason: "end_turn",
        usage: { inputTokens: -1, outputTokens: Number.NaN },
        timing: { providerDurationMs: 1 },
      });
      await rec.finalize();
      expect(rec.getRecord().totals.turns).toBe(0);
      const output = await readFile(path.join(tmpDir, "private.json"), "utf8");
      expect(output + rec.summary() + aggregateRecentDiagnostics().report).not.toContain(
        "synthetic-metadata-secret",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("bounds records and pending call identifiers under a long event stream", async () => {
    process.env.GG_INTERNAL = "1";
    const rec = recorder();
    const bus = new EventBus();
    rec.attach(bus);
    for (let i = 0; i < 1200; i++) {
      bus.emit("tool_call_start", {
        toolCallId: `pending-${i}`,
        name: `tool_${i}`,
        args: { value: i },
      });
      bus.emit("tool_call_start", {
        toolCallId: `done-${i}`,
        name: `tool_${i}`,
        args: { value: i },
      });
      bus.emit("tool_call_end", {
        toolCallId: `done-${i}`,
        result: `Error: unique ${String.fromCodePoint(0x1000 + i)}`,
        isError: true,
        durationMs: 1,
      });
      bus.emit("model_change", { provider: "openai", model: `model-${i}` });
      bus.emit("compaction_end", { compacted: true, originalCount: 2, newCount: 1 });
      bus.emit("truncated", { reason: "max_tokens", continued: false });
    }
    // Assert internal caps too: a small serialized top-N must not hide an unbounded map.
    for (const key of ["pendingCalls", "repeatCounts", "clusterCounts"]) {
      expect((Reflect.get(rec, key) as Map<unknown, unknown>).size).toBeLessThanOrEqual(1024);
    }
    await rec.finalize();
    const snapshot = rec.snapshotForTests();
    expect(Object.keys(snapshot.toolStats).length).toBeLessThanOrEqual(128);
    expect(snapshot.errorClusters.length).toBeLessThanOrEqual(8);
    expect(snapshot.modelSwitches).toHaveLength(500);
    expect(snapshot.compactions).toHaveLength(500);
    expect(snapshot.truncations).toHaveLength(500);
    expect(snapshot.totals.toolCalls).toBe(1200);
    expect((await stat(path.join(tmpDir, "private.json"))).size).toBeLessThan(1024 * 1024);
    expect(aggregateRecentDiagnostics().sessionCount).toBe(1);
  });

  it("preserves the previous complete file if rename fails and removes its temp file", async () => {
    process.env.GG_INTERNAL = "1";
    const rec = recorder();
    await rec.flush();
    const file = path.join(tmpDir, "private.json");
    const before = await readFile(file, "utf8");
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("synthetic disk failure");
    });
    try {
      await rec.finalize();
    } finally {
      rename.mockRestore();
    }
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readdir(tmpDir)).toEqual(["private.json"]);
  });

  it("refuses a symlinked diagnostics directory", async () => {
    process.env.GG_INTERNAL = "1";
    const outside = path.join(tmpHome, "outside");
    await mkdir(outside);
    await symlink(outside, tmpDir, process.platform === "win32" ? "junction" : "dir");
    await recorder().finalize();
    expect(await readdir(outside)).toEqual([]);
    expect(aggregateRecentDiagnostics().sessionCount).toBe(0);
  });

  it("does not write or subscribe when disabled, even if constructed directly", async () => {
    const rec = recorder();
    const bus = new EventBus();
    rec.attach(bus);
    bus.emit("tool_call_end", {
      toolCallId: "x",
      result: "Error: private",
      isError: true,
      durationMs: 1,
    });
    await rec.finalize();
    expect(rec.getRecord().totals.toolCalls).toBe(0);
    await expect(readdir(tmpDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("contains filenames and writes only private complete records", async () => {
    process.env.GG_INTERNAL = "1";
    const rec = recorder("../outside");
    await rec.flush();
    const files = await readdir(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-zA-Z0-9_-]+\.json$/);
    await expect(readFile(path.join(tmpHome, "outside.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const file = path.join(tmpDir, files[0]);
    expect(JSON.parse(await readFile(file, "utf8")).sessionId).not.toContain("..");
    if (process.platform !== "win32") {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await stat(tmpDir)).mode & 0o777).toBe(0o700);
    }
    await rec.finalize();
    expect(await readdir(tmpDir)).toEqual(files);
  });

  it("skips malformed, old raw, oversized and symlinked records", async () => {
    process.env.GG_INTERNAL = "1";
    const rec = recorder();
    await rec.finalize();
    const valid = JSON.parse(await readFile(path.join(tmpDir, "private.json"), "utf8"));
    await writeFile(path.join(tmpDir, "bad.json"), JSON.stringify({ version: valid.version }));
    await writeFile(
      path.join(tmpDir, "old.json"),
      JSON.stringify({
        ...valid,
        version: 1,
        errorClusters: [{ digest: "raw-private", sample: "raw-private", count: 2 }],
      }),
    );
    await writeFile(path.join(tmpDir, "corrupt.json"), "{broken");
    await writeFile(path.join(tmpDir, "oversized.json"), " ".repeat(1024 * 1024 + 1));
    await symlink(path.join(tmpDir, "private.json"), path.join(tmpDir, "link.json"));
    const result = aggregateRecentDiagnostics(100);
    expect(result.sessionCount).toBe(1);
    expect(result.report).not.toContain("raw-private");
  });

  it("detaches and freezes counters after finalization", async () => {
    process.env.GG_INTERNAL = "1";
    const rec = recorder();
    const bus = new EventBus();
    rec.attach(bus);
    rec.attach(bus);
    bus.emit("tool_call_end", { toolCallId: "x", result: "ok", isError: false, durationMs: 1 });
    expect(rec.getRecord().totals.toolCalls).toBe(1);
    await rec.finalize();
    bus.emit("tool_call_end", { toolCallId: "y", result: "ok", isError: false, durationMs: 1 });
    rec.recordTurnMetric({
      turn: 1,
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
      timing: { providerDurationMs: 1 },
    });
    expect(rec.getRecord().totals).toMatchObject({ toolCalls: 1, turns: 0 });
  });
});

describe("diagnosticsSessionsDir", () => {
  it("respects GG_DIAGNOSTICS_DIR", () => {
    expect(diagnosticsSessionsDir()).toBe(tmpDir);
  });
});
