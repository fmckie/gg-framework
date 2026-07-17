import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAndAutoUpdate,
  startPeriodicUpdateCheck,
  stopPeriodicUpdateCheck,
} from "./auto-update.js";

const tmpHome = path.join(os.tmpdir(), `kleio-manager-update-test-${process.pid}`);
const stateFile = path.join(tmpHome, ".gg", "boss", "update-state.json");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof os>("node:os");
  return {
    ...actual,
    homedir: () => tmpHome,
    default: { ...actual, homedir: () => tmpHome },
  };
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

function writeState(state: Record<string, unknown>, branded = true): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify(branded ? { ...state, packageName: "@kleio/manager", distTag: "kleio" } : state),
  );
}

function readState(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

afterEach(() => {
  stopPeriodicUpdateCheck();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("Kleio Manager auto-update compatibility", () => {
  it("installs pending Kleio prereleases from the manager channel", () => {
    writeState({
      lastCheckedAt: Date.now(),
      latestVersion: "4.10.1-kleio.1",
      updatePending: true,
    });

    expect(checkAndAutoUpdate("4.10.1-kleio.0")).toContain("4.10.1-kleio.1");
    const [command, args] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect([command, ...(args ?? [])].join(" ")).toContain("@kleio/manager@kleio");
    expect(readState()).toMatchObject({
      packageName: "@kleio/manager",
      distTag: "kleio",
      updatePending: false,
    });
  });

  it("ignores upstream legacy state and rewrites it with manager identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ version: "4.10.1-kleio.0" }),
      }),
    );
    writeState({ lastCheckedAt: Date.now(), latestVersion: "99.0.0", updatePending: true }, false);

    expect(checkAndAutoUpdate("4.10.1-kleio.0")).toBeNull();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(readState()).toMatchObject({
        packageName: "@kleio/manager",
        distTag: "kleio",
      });
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/%40kleio%2Fmanager/kleio",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses Kleio Manager restart wording without changing the channel command", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ version: "4.10.1-kleio.1" }),
      }),
    );
    const onUpdate = vi.fn();

    startPeriodicUpdateCheck("4.10.1-kleio.0", onUpdate);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);

    expect(onUpdate).toHaveBeenCalledWith(expect.stringContaining("Restart kleio-manager"));
    expect(onUpdate).toHaveBeenCalledWith(expect.stringContaining("@kleio/manager@kleio"));
  });
});
