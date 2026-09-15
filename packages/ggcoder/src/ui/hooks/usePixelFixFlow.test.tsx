import React, { useEffect } from "react";
import { render, type Instance } from "ink";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../core/session-manager.js";
import {
  disposeProjectRuntime,
  prepareProjectRuntime,
  type ProjectRuntime,
} from "../project-runtime.js";
import { createSessionStats } from "../session-summary.js";
import type { CompletedItem } from "../app-items.js";
import { RunCompletion } from "../run-completion.js";
import { useSessionPersistence, type SessionPersistence } from "./useSessionPersistence.js";
import { usePixelFixFlow, type PixelFixFlow } from "./usePixelFixFlow.js";

const preparePixelFix = vi.hoisted(() => vi.fn());
vi.mock("../../core/pixel-fix.js", () => ({ preparePixelFix }));
type Options = Parameters<typeof usePixelFixFlow>[0];

function Harness({
  options,
  ready,
}: {
  options: Options;
  ready: (flow: PixelFixFlow, persistence: SessionPersistence) => void;
}) {
  const persistence = useSessionPersistence({
    sessionManagerRef: options.sessionManagerRef,
    sessionPathRef: options.sessionPathRef,
    sessionStatsRef: options.sessionStatsRef!,
    persistedIndexRef: options.persistedIndexRef,
    messagesRef: options.messagesRef,
    turnMetricsRef: options.turnMetricsRef!,
    cwdRef: options.cwdRef,
    currentProvider: options.currentProvider,
    currentModel: options.currentModel,
  });
  const flow = usePixelFixFlow({ ...options, flushPendingWrites: persistence.flushPendingWrites });
  useEffect(() => {
    ready(flow, persistence);
  }, [flow, persistence, ready]);
  return null;
}

let root: string;
let originalCwd: string;
let oldSessionPath: string;
let runtime: { current: ProjectRuntime };
let options: Options;
let instance: Instance | undefined;
let flow: PixelFixFlow;
let persistence: SessionPersistence;
const reset = vi.fn();
const run = vi.fn(async () => {});
const liveItems: CompletedItem[][] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  preparePixelFix.mockReset();
  liveItems.length = 0;
  originalCwd = process.cwd();
  root = await fs.mkdtemp(path.join(os.homedir(), "pixel-flow-test-"));
  const oldRoot = path.join(root, "old");
  const newRoot = path.join(root, "new");
  await fs.mkdir(oldRoot);
  await fs.mkdir(newRoot);
  process.chdir(oldRoot);
  const manager = new SessionManager(path.join(root, "sessions"));
  const session = await manager.create(oldRoot, "anthropic", "test-model");
  oldSessionPath = session.path;
  runtime = { current: { cwd: oldRoot, tools: [] } };
  const completion = new RunCompletion();
  options = {
    agentLoop: {
      run,
      reset,
      isRunning: false,
      suspendForProjectSwitch: () => completion.suspend(() => {}),
    },
    cwd: oldRoot,
    currentProvider: "anthropic",
    currentModel: "test-model",
    prepareProjectRuntime: (cwd, sessionId) =>
      prepareProjectRuntime({
        current: runtime,
        cwd,
        sessionId,
        checkpointBaseDir: path.join(root, "checkpoints"),
        globalSkillsDir: path.join(root, "skills"),
        globalAgentsDir: path.join(root, "agents"),
        toolOptions: { provider: "anthropic", model: "test-model", lspDiagnostics: false },
        getMcpServers: async () => [],
      }),
    sessionStatsRef: { current: createSessionStats({ sessionId: session.id }) },
    turnMetricsRef: { current: [] },
    currentPixelFixRef: { current: null },
    runAllPixelRef: { current: false },
    startPixelFixRef: { current: () => {} },
    cwdRef: { current: oldRoot },
    currentToolsRef: { current: [] },
    injectedLanguagesRef: { current: new Set() },
    approvedPlanPathRef: { current: "old-plan.md" },
    rewindTurnRef: { current: 0 },
    messagesRef: {
      current: [
        { role: "system", content: "old system" },
        { role: "user", content: "unsaved old message" },
      ],
    },
    persistedIndexRef: { current: 1 },
    sessionManagerRef: { current: manager },
    sessionPathRef: { current: session.path },
    setDisplayedCwd: vi.fn(),
    setCurrentTools: vi.fn(),
    setHistory: vi.fn(),
    setLiveItems: (value) => {
      liveItems.push(typeof value === "function" ? value(liveItems.at(-1) ?? []) : value);
    },
    setLastUserMessage: vi.fn(),
    setDoneStatus: vi.fn(),
    rebuildSystemPrompt: async () => "new project system",
    clearPendingHistory: vi.fn(),
    getId: () => "pixel-item",
    initialRunAllPixel: false,
  };
  preparePixelFix.mockResolvedValue({
    errorId: "error-1",
    projectId: "project-2",
    projectName: "new",
    projectPath: newRoot,
    branch: "fix/error-1",
    prompt: "fix new project",
  });
});

afterEach(async () => {
  instance?.unmount();
  instance = undefined;
  process.chdir(originalCwd);
  await disposeProjectRuntime(runtime.current);
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function mount() {
  await new Promise<void>((resolve) => {
    instance = render(
      <Harness
        options={options}
        ready={(nextFlow, nextPersistence) => {
          flow = nextFlow;
          persistence = nextPersistence;
          resolve();
        }}
      />,
      { exitOnCtrlC: false, patchConsole: false },
    );
  });
}

describe("Pixel project switch integration", () => {
  it("flushes the previous conversation and opens the new rewind checkpoint before running", async () => {
    await mount();
    flow.startPixelFix("error-1");
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith("fix new project"));
    expect(await fs.readFile(oldSessionPath, "utf8")).toContain("unsaved old message");
    expect(options.sessionPathRef.current).not.toBe(oldSessionPath);
    expect(options.cwdRef.current).toBe(runtime.current.cwd);
    expect(process.cwd()).toBe(runtime.current.cwd);
    expect(options.approvedPlanPathRef?.current).toBeUndefined();
    expect(await runtime.current.checkpointStore?.listCheckpoints()).toHaveLength(1);
    expect(options.rewindTurnRef?.current).toBe(1);
  });

  it("waits for an in-flight save before branch preparation or the next run", async () => {
    const manager = options.sessionManagerRef.current!;
    const appendEntry = manager.appendEntry.bind(manager);
    let finishSave!: () => void;
    const saving = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const events: string[] = [];
    const append = vi.spyOn(manager, "appendEntry").mockImplementationOnce(async (...args) => {
      await saving;
      await appendEntry(...args);
      events.push("saved");
    });
    const prepareRuntime = options.prepareProjectRuntime!;
    vi.spyOn(options, "prepareProjectRuntime").mockImplementation(async (...args) => {
      events.push("prepare runtime");
      return prepareRuntime(...args);
    });
    run.mockImplementationOnce(async () => {
      events.push("run");
    });
    await mount();
    const pendingSave = persistence.persistNewMessages();
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
    flow.startPixelFix("error-1");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const preparationsWhileSaving = preparePixelFix.mock.calls.length;
    const runsWhileSaving = run.mock.calls.length;
    finishSave();
    await pendingSave;
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(preparationsWhileSaving).toBe(0);
    expect(runsWhileSaving).toBe(0);
    expect(events).toEqual(["saved", "prepare runtime", "run"]);
    expect(await fs.readFile(oldSessionPath, "utf8")).toContain("unsaved old message");
  });

  it("does not prepare or replace resources until active run finalizers finish", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const completion = new RunCompletion();
    const active = completion.track(async () => {
      await gate;
    });
    const abort = vi.fn();
    options.agentLoop.suspendForProjectSwitch = () => completion.suspend(abort);
    const prepare = vi.spyOn(options, "prepareProjectRuntime");
    await mount();
    flow.startPixelFix("error-1");
    flow.startPixelFix("duplicate");
    await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce());
    const branchPreparationsBeforeIdle = preparePixelFix.mock.calls.length;
    expect(prepare).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    finish();
    await active;
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(preparePixelFix).toHaveBeenCalledOnce();
    expect(branchPreparationsBeforeIdle).toBe(0);
  });

  it("ignores a second fix while the first agent run is still pending", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    run.mockImplementationOnce(() => gate);
    await mount();
    flow.startPixelFix("error-1");
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    preparePixelFix.mockRejectedValueOnce(new Error("second preparation must not run"));
    flow.startPixelFix("duplicate");
    await new Promise<void>((resolve) => setImmediate(resolve));
    finish();
    await gate;
    expect(preparePixelFix).toHaveBeenCalledOnce();
  });

  it("keeps old messages and resources when writing the old conversation fails", async () => {
    const originalRuntime = runtime.current;
    await mount();
    vi.spyOn(options.sessionManagerRef.current!, "appendEntry").mockRejectedValue(
      new Error("disk full"),
    );
    await expect(persistence.persistNewMessages()).rejects.toThrow("disk full");
    flow.startPixelFix("error-1");
    await vi.waitFor(() => expect(liveItems.length).toBeGreaterThan(0));
    expect(preparePixelFix).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(runtime.current).toBe(originalRuntime);
    expect(options.messagesRef.current[1]).toEqual({
      role: "user",
      content: "unsaved old message",
    });
  });

  it("discards a candidate on prompt failure without replacing the live runtime or cwd", async () => {
    const originalRuntime = runtime.current;
    const buildPrompt = vi.fn(async () => {
      throw new Error("prompt failed");
    });
    options.rebuildSystemPrompt = buildPrompt;
    const prepare = vi.spyOn(options, "prepareProjectRuntime");
    const oldCwd = process.cwd();
    await mount();
    flow.startPixelFix("error-1");
    await vi.waitFor(() => expect(liveItems.length).toBeGreaterThan(0));
    expect(run).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(runtime.current).toBe(originalRuntime);
    expect(process.cwd()).toBe(oldCwd);
    expect(preparePixelFix).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    const candidate = await prepare.mock.results[0]!.value;
    expect(buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: path.join(root, "new"),
        tools: candidate.runtime.tools,
        skills: candidate.runtime.skills,
        clearApprovedPlan: true,
      }),
    );
    expect(liveItems.at(-1)).toEqual([
      expect.objectContaining({ kind: "error", message: "prompt failed", id: "pixel-item" }),
    ]);
  });
});
