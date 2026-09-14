import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckpointStore } from "../core/checkpoint-store.js";
import {
  disposeProjectRuntime,
  prepareProjectRuntime,
  type PreparedProjectRuntime,
  type ProjectRuntime,
  type ProjectRuntimePreparation,
} from "./project-runtime.js";

let root: string;
let oldRoot: string;
let newRoot: string;
let current: { current: ProjectRuntime };
let pending: { current: ProjectRuntime | undefined };
let prepared: PreparedProjectRuntime | undefined;

beforeEach(async () => {
  // The verification runner supplies a disposable HOME outside the OS temp
  // allowlist; the old project must genuinely be outside the new write boundary.
  root = await fs.mkdtemp(path.join(os.homedir(), "pixel-runtime-test-"));
  oldRoot = path.join(root, "old");
  newRoot = path.join(root, "new");
  await fs.mkdir(oldRoot);
  await fs.mkdir(newRoot);
  const checkpointStore = new CheckpointStore({
    sessionId: "old-session",
    cwd: oldRoot,
    baseDir: path.join(root, "checkpoints"),
  });
  current = { current: { cwd: oldRoot, tools: [], checkpointStore } };
  pending = { current: undefined };
  const initial = await prepareProjectRuntime({
    ...options(),
    cwd: oldRoot,
    sessionId: "old-session",
  });
  await initial.commit();
});

afterEach(async () => {
  await prepared?.dispose();
  await disposeProjectRuntime(current.current);
  if (pending.current) await disposeProjectRuntime(pending.current);
  prepared = undefined;
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function options(): ProjectRuntimePreparation {
  return {
    current,
    pending,
    cwd: newRoot,
    sessionId: "new-session",
    globalAgentsDir: path.join(root, "agents"),
    globalSkillsDir: path.join(root, "skills"),
    checkpointBaseDir: path.join(root, "checkpoints"),
    toolOptions: { provider: "anthropic", model: "test-model", lspDiagnostics: false },
    getMcpServers: async () => [],
  };
}

describe("retained Pixel project runtime", () => {
  it("binds real writes and rewind snapshots to the new session without touching old checkpoints", async () => {
    const oldFile = path.join(oldRoot, "old.txt");
    const newFile = path.join(newRoot, "new.txt");
    await fs.writeFile(oldFile, "old project");
    await fs.writeFile(newFile, "new project before fix");
    const oldStore = current.current.checkpointStore!;
    const oldCheckpoint = await oldStore.openCheckpoint({ turnIndex: 1, messageIndex: 0 });
    await oldStore.recordPreMutation(oldFile);
    const oldManifestPath = path.join(
      root,
      "checkpoints",
      "old-session",
      "checkpoints",
      `${oldCheckpoint}.json`,
    );
    const oldManifest = await fs.readFile(oldManifestPath, "utf8");
    const originalRuntime = current.current;

    prepared = await prepareProjectRuntime(options());
    expect(current.current).toBe(originalRuntime);
    expect(pending.current).toBe(prepared.runtime);
    expect(prepared.runtime.checkpointStore).not.toBe(oldStore);
    await prepared.commit();
    expect(current.current).toBe(prepared.runtime);
    expect(pending.current).toBeUndefined();

    const nextStore = current.current.checkpointStore!;
    await nextStore.openCheckpoint({ turnIndex: 1, messageIndex: 0 });
    const read = current.current.tools.find((tool) => tool.name === "read")!;
    const write = current.current.tools.find((tool) => tool.name === "write")!;
    const context = { signal: new AbortController().signal, toolCallId: "project-switch-write" };
    await read.execute({ file_path: newFile }, context);
    expect(
      await write.execute({ file_path: newFile, content: "fixed in the new project" }, context),
    ).not.toContain("Error:");
    expect(await fs.readFile(newFile, "utf8")).toBe("fixed in the new project");
    expect((await nextStore.listCheckpoints())[0]?.changedFileCount).toBe(1);
    expect(await fs.readFile(oldManifestPath, "utf8")).toBe(oldManifest);
    // Satisfy read-before-write so this proves the workspace boundary itself.
    expect(await read.execute({ file_path: oldFile }, context)).not.toContain("Error:");
    expect(
      await write.execute({ file_path: oldFile, content: "must not overwrite" }, context),
    ).toContain("is outside the workspace");
    expect(await fs.readFile(oldFile, "utf8")).toBe("old project");
  });

  it("keeps the old runtime usable when candidate preparation fails and releases ownership for retry", async () => {
    const originalRuntime = current.current;
    const stopOldProcesses = vi.spyOn(originalRuntime.processManager!, "shutdownAll");
    const disposeOldMcp = vi.spyOn(originalRuntime.mcpManager!, "dispose");
    await expect(
      prepareProjectRuntime({
        ...options(),
        getMcpServers: async () => {
          throw new Error("configuration failed");
        },
      }),
    ).rejects.toThrow("configuration failed");
    expect(current.current).toBe(originalRuntime);
    expect(pending.current).toBeUndefined();
    expect(stopOldProcesses).not.toHaveBeenCalled();
    expect(disposeOldMcp).not.toHaveBeenCalled();
    const oldFile = path.join(oldRoot, "still-usable.txt");
    await fs.writeFile(oldFile, "before failed switch");
    const context = { signal: new AbortController().signal, toolCallId: "after-failed-switch" };
    await originalRuntime.checkpointStore!.openCheckpoint({ turnIndex: 1, messageIndex: 0 });
    const read = originalRuntime.tools.find((tool) => tool.name === "read")!;
    const write = originalRuntime.tools.find((tool) => tool.name === "write")!;
    await read.execute({ file_path: oldFile }, context);
    await write.execute({ file_path: oldFile, content: "old runtime still works" }, context);
    expect(await fs.readFile(oldFile, "utf8")).toBe("old runtime still works");
    prepared = await prepareProjectRuntime(options());
    await prepared.dispose();
    expect(current.current).toBe(originalRuntime);
    expect(pending.current).toBeUndefined();
  });

  it("rejects overlapping preparation and waits for deferred startup before committing", async () => {
    let finish!: () => void;
    const startup = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = prepareProjectRuntime({ ...options(), waitForStartup: () => startup });
    await expect(prepareProjectRuntime(options())).rejects.toThrow("already being prepared");
    prepared = await first;
    // A different holder bypasses the WeakSet key, but shares the pending owner.
    await expect(
      prepareProjectRuntime({
        ...options(),
        current: { current: current.current },
      }),
    ).rejects.toThrow("already being prepared");
    const originalRuntime = current.current;
    const committing = prepared.commit();
    await Promise.resolve();
    expect(current.current).toBe(originalRuntime);
    finish();
    await committing;
    expect(current.current).toBe(prepared.runtime);
  });
});
