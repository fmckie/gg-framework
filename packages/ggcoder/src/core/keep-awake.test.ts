import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KEEP_AWAKE_MAX_HOLD_MS,
  KeepAwake,
  WindowAwake,
  keepAwakeCommand,
  keepAwakeMaxHoldMs,
  type KeepAwakeCommand,
  type KeepAwakeProcess,
} from "./keep-awake.js";
import { RunLifecycle } from "./run-lifecycle.js";

interface FakeProcess extends KeepAwakeProcess {
  command: KeepAwakeCommand;
  stopped: number;
  exit(): void;
  fail(code: string): void;
}

function harness(
  options: {
    platform?: NodeJS.Platform;
    enabled?: boolean;
    pid?: number;
    maxHoldMs?: number;
  } = {},
) {
  const spawned: FakeProcess[] = [];
  const exitHooks: Array<() => void> = [];
  const logs: string[] = [];
  const keepAwake = new KeepAwake({
    platform: options.platform ?? "darwin",
    pid: options.pid ?? 4242,
    enabled: options.enabled,
    maxHoldMs: options.maxHoldMs,
    log: (_level, message) => logs.push(message),
    onProcessExit: (cleanup) => exitHooks.push(cleanup),
    spawner: (command) => {
      let exitListener: (() => void) | undefined;
      let errorListener: ((error: NodeJS.ErrnoException) => void) | undefined;
      const fake: FakeProcess = {
        command,
        stopped: 0,
        stop() {
          fake.stopped++;
        },
        onExit(listener) {
          exitListener = listener;
        },
        onError(listener) {
          errorListener = listener;
        },
        exit() {
          exitListener?.();
        },
        fail(code) {
          const error: NodeJS.ErrnoException = new Error(`spawn ${command.command} ${code}`);
          error.code = code;
          errorListener?.(error);
        },
      };
      spawned.push(fake);
      return fake;
    },
  });
  return { keepAwake, spawned, exitHooks, logs };
}

describe("keepAwakeCommand", () => {
  it("uses caffeinate -i tied to our pid on macOS", () => {
    expect(keepAwakeCommand("darwin", 123)).toEqual({
      command: "caffeinate",
      args: ["-i", "-w", "123"],
    });
  });

  it("uses systemd-inhibit for idle+sleep on Linux, tied to our pid", () => {
    const cmd = keepAwakeCommand("linux", 123);
    expect(cmd?.command).toBe("systemd-inhibit");
    expect(cmd?.args).toEqual([
      "--what=idle:sleep",
      "--who=Kleio",
      "--why=Agent is working",
      "--mode=block",
      "tail",
      "--pid=123",
      "-f",
      "/dev/null",
    ]);
  });

  it("uses a hidden PowerShell SetThreadExecutionState holder on Windows", () => {
    const cmd = keepAwakeCommand("win32", 123);
    expect(cmd?.command).toBe("powershell.exe");
    expect(cmd?.args).toContain("-NonInteractive");
    expect(cmd?.args).toContain("Hidden");
    const encoded = cmd?.args[cmd.args.indexOf("-EncodedCommand") + 1] ?? "";
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    expect(script).toContain("SetThreadExecutionState([uint32]2147483649)");
    expect(script).toContain("Wait-Process -Id 123");
  });

  it("has no command on other platforms", () => {
    expect(keepAwakeCommand("freebsd", 123)).toBeNull();
  });
});

describe("KeepAwake", () => {
  it("shares one OS holder across overlapping holds and kills it on the last release", () => {
    const { keepAwake, spawned } = harness();
    const releaseRun = keepAwake.acquire("run");
    const releaseKen = keepAwake.acquire("ken");
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.command).toEqual({ command: "caffeinate", args: ["-i", "-w", "4242"] });
    expect(keepAwake.holderCount).toBe(2);

    releaseRun();
    expect(spawned[0]?.stopped).toBe(0);
    expect(keepAwake.asserting).toBe(true);

    releaseKen();
    expect(spawned[0]?.stopped).toBe(1);
    expect(keepAwake.asserting).toBe(false);
  });

  it("treats a second release of the same hold as a no-op", () => {
    const { keepAwake, spawned } = harness();
    const releaseA = keepAwake.acquire("a");
    keepAwake.acquire("b");
    releaseA();
    releaseA();
    expect(keepAwake.holderCount).toBe(1);
    expect(spawned[0]?.stopped).toBe(0);
  });

  it("respawns for a fresh hold after the previous one was released", () => {
    const { keepAwake, spawned } = harness();
    keepAwake.acquire("first")();
    keepAwake.acquire("second");
    expect(spawned).toHaveLength(2);
    expect(spawned[0]?.stopped).toBe(1);
    expect(spawned[1]?.stopped).toBe(0);
  });

  it("does nothing while disabled and follows the setting live", () => {
    const { keepAwake, spawned } = harness({ enabled: false });
    const release = keepAwake.acquire("run");
    expect(spawned).toHaveLength(0);

    keepAwake.setEnabled(true);
    expect(spawned).toHaveLength(1);

    keepAwake.setEnabled(false);
    expect(spawned[0]?.stopped).toBe(1);
    expect(keepAwake.holderCount).toBe(1);

    release();
    keepAwake.setEnabled(true);
    expect(spawned).toHaveLength(1);
  });

  it("becomes a permanent no-op when the tool is missing", () => {
    const { keepAwake, spawned, logs } = harness({ platform: "linux" });
    keepAwake.acquire("run");
    spawned[0]?.fail("ENOENT");
    expect(keepAwake.asserting).toBe(false);
    expect(logs).toContain("keep-awake tool not found; skipping");

    keepAwake.acquire("another");
    expect(spawned).toHaveLength(1);
  });

  it("no-ops on platforms without a tool", () => {
    const { keepAwake, spawned } = harness({ platform: "aix" });
    const release = keepAwake.acquire("run");
    expect(spawned).toHaveLength(0);
    release();
  });

  it("survives a spawner that throws", () => {
    const keepAwake = new KeepAwake({
      platform: "darwin",
      log: () => {},
      onProcessExit: () => {},
      spawner: () => {
        throw new Error("EAGAIN");
      },
    });
    const release = keepAwake.acquire("run");
    expect(keepAwake.asserting).toBe(false);
    release();
  });

  it("does not respawn in a loop when the holder dies on its own", () => {
    const { keepAwake, spawned } = harness();
    const release = keepAwake.acquire("run");
    spawned[0]?.exit();
    expect(keepAwake.asserting).toBe(false);

    const releaseOverlap = keepAwake.acquire("overlap");
    expect(spawned).toHaveLength(1);

    // Once every hold is gone, the next run tries again.
    release();
    releaseOverlap();
    keepAwake.acquire("next");
    expect(spawned).toHaveLength(2);
  });

  it("ignores the exit of a holder it already stopped", () => {
    const { keepAwake, spawned } = harness();
    keepAwake.acquire("first")();
    keepAwake.acquire("second");
    spawned[0]?.exit();
    expect(keepAwake.asserting).toBe(true);
  });

  it("kills the holder on dispose and on process exit", () => {
    const { keepAwake, spawned, exitHooks } = harness();
    keepAwake.acquire("run");
    expect(exitHooks).toHaveLength(1);
    exitHooks[0]?.();
    expect(spawned[0]?.stopped).toBe(1);
    expect(keepAwake.holderCount).toBe(0);
    keepAwake.dispose();
    expect(spawned[0]?.stopped).toBe(1);
  });
});

/** OS holders that are running: spawned and not yet stopped. */
function live(spawned: FakeProcess[]): FakeProcess[] {
  return spawned.filter((p) => p.stopped === 0);
}

describe("KeepAwake ceiling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a hold go at the ceiling and logs it", () => {
    vi.useFakeTimers();
    const { keepAwake, spawned, logs } = harness({ maxHoldMs: 1_000 });
    const release = keepAwake.acquire("run");
    vi.advanceTimersByTime(999);
    expect(keepAwake.asserting).toBe(true);
    expect(spawned[0]?.stopped).toBe(0);

    vi.advanceTimersByTime(1);
    expect(keepAwake.asserting).toBe(false);
    expect(keepAwake.holderCount).toBe(0);
    expect(spawned[0]?.stopped).toBe(1);
    expect(logs).toContain("keep-awake hold reached its limit; letting go");

    // The run ending later changes nothing.
    release();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.stopped).toBe(1);
  });

  it("defaults to 6 hours", () => {
    vi.useFakeTimers();
    expect(KEEP_AWAKE_MAX_HOLD_MS).toBe(6 * 60 * 60 * 1000);
    const { keepAwake } = harness();
    keepAwake.acquire("run");
    vi.advanceTimersByTime(KEEP_AWAKE_MAX_HOLD_MS - 1);
    expect(keepAwake.asserting).toBe(true);
    vi.advanceTimersByTime(1);
    expect(keepAwake.asserting).toBe(false);
  });

  it("gives overlapping holds their own ceilings and holds until the last one", () => {
    vi.useFakeTimers();
    const { keepAwake, spawned } = harness({ maxHoldMs: 1_000 });
    keepAwake.acquire("run");
    vi.advanceTimersByTime(600);
    keepAwake.acquire("ken");
    vi.advanceTimersByTime(400);
    // The first hold is over; the second still holds the same OS holder.
    expect(keepAwake.holderCount).toBe(1);
    expect(keepAwake.asserting).toBe(true);
    expect(spawned).toHaveLength(1);

    vi.advanceTimersByTime(599);
    expect(keepAwake.asserting).toBe(true);
    vi.advanceTimersByTime(1);
    expect(keepAwake.asserting).toBe(false);
    expect(spawned[0]?.stopped).toBe(1);
  });

  it("cancels a hold's ceiling when it's released first", () => {
    vi.useFakeTimers();
    const { keepAwake, logs } = harness({ maxHoldMs: 1_000 });
    keepAwake.acquire("first")();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    keepAwake.acquire("second");
    // The first hold's ceiling would have been at 1000.
    vi.advanceTimersByTime(900);
    expect(keepAwake.asserting).toBe(true);
    expect(logs).not.toContain("keep-awake hold reached its limit; letting go");
  });

  it("holds again for a re-acquire after the ceiling, with a fresh ceiling", () => {
    vi.useFakeTimers();
    const { keepAwake, spawned } = harness({ maxHoldMs: 1_000 });
    const releaseStuck = keepAwake.acquire("run");
    vi.advanceTimersByTime(1_000);
    expect(keepAwake.asserting).toBe(false);

    keepAwake.acquire("next run");
    expect(spawned).toHaveLength(2);
    expect(keepAwake.asserting).toBe(true);

    // The stuck run finally ending doesn't drop the new hold.
    releaseStuck();
    expect(keepAwake.asserting).toBe(true);
    vi.advanceTimersByTime(999);
    expect(keepAwake.asserting).toBe(true);
    vi.advanceTimersByTime(1);
    expect(keepAwake.asserting).toBe(false);
    expect(spawned[1]?.stopped).toBe(1);
  });

  it("never runs more than one OS holder at a time", () => {
    vi.useFakeTimers();
    const { keepAwake, spawned } = harness({ maxHoldMs: 1_000 });
    const check = () => {
      expect(live(spawned).length).toBe(keepAwake.asserting ? 1 : 0);
      for (const p of spawned) expect(p.stopped).toBeLessThanOrEqual(1);
    };
    const releaseA = keepAwake.acquire("a");
    check();
    const releaseB = keepAwake.acquire("b");
    check();
    vi.advanceTimersByTime(400);
    const releaseC = keepAwake.acquire("c");
    check();
    releaseA();
    check();
    vi.advanceTimersByTime(600); // b's ceiling
    check();
    keepAwake.setEnabled(false);
    check();
    keepAwake.setEnabled(true);
    check();
    vi.advanceTimersByTime(400); // c's ceiling
    check();
    releaseB();
    releaseC();
    const releaseD = keepAwake.acquire("d");
    check();
    releaseD();
    check();
    expect(keepAwake.asserting).toBe(false);
  });

  it("has no ceiling with Infinity", () => {
    vi.useFakeTimers();
    const { keepAwake } = harness({ maxHoldMs: Infinity });
    keepAwake.acquire("run");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(KEEP_AWAKE_MAX_HOLD_MS * 4);
    expect(keepAwake.asserting).toBe(true);
  });

  it("clears every ceiling on dispose", () => {
    vi.useFakeTimers();
    const { keepAwake } = harness({ maxHoldMs: 1_000 });
    keepAwake.acquire("a");
    keepAwake.acquire("b");
    expect(vi.getTimerCount()).toBe(2);
    keepAwake.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("keepAwakeMaxHoldMs", () => {
  it("is 6 hours unless GG_APP_KEEP_AWAKE_MAX_MS is a positive whole number of ms", () => {
    expect(keepAwakeMaxHoldMs({})).toBe(KEEP_AWAKE_MAX_HOLD_MS);
    expect(keepAwakeMaxHoldMs({ GG_APP_KEEP_AWAKE_MAX_MS: "30000" })).toBe(30_000);
    expect(keepAwakeMaxHoldMs({ GG_APP_KEEP_AWAKE_MAX_MS: " 30000 " })).toBe(30_000);
    for (const bad of ["", "0", "-5", "abc", "1e3", "30s", "1.5", "99999999999"]) {
      expect(keepAwakeMaxHoldMs({ GG_APP_KEEP_AWAKE_MAX_MS: bad })).toBe(KEEP_AWAKE_MAX_HOLD_MS);
    }
  });
});

describe("WindowAwake (run tracking)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One window: its run lifecycle drives its share of the hold, as in app-sidecar.ts. */
  function window(keepAwake: KeepAwake) {
    const awake = new WindowAwake(keepAwake);
    const lifecycle = new RunLifecycle((state) => awake.runState(state));
    return { awake, lifecycle };
  }

  it("holds from run start to run end", () => {
    const { keepAwake, spawned } = harness();
    const { lifecycle } = window(keepAwake);
    expect(keepAwake.asserting).toBe(false);

    const lease = lifecycle.begin(() => {});
    expect(keepAwake.asserting).toBe(true);
    expect(spawned[0]?.command).toEqual({ command: "caffeinate", args: ["-i", "-w", "4242"] });

    lifecycle.settle(lease.generation, "failed");
    expect(keepAwake.asserting).toBe(false);
    expect(spawned[0]?.stopped).toBe(1);
  });

  it("keeps holding while a run is cancelling, until it settles", async () => {
    const { keepAwake, spawned } = harness();
    const { lifecycle } = window(keepAwake);
    const lease = lifecycle.begin(() => {});
    const cancelled = lifecycle.cancel(1_000);
    expect(lifecycle.state).toBe("cancelling");
    expect(keepAwake.asserting).toBe(true);
    expect(keepAwake.holderCount).toBe(1);

    lifecycle.settle(lease.generation);
    await cancelled;
    expect(keepAwake.asserting).toBe(false);
    expect(spawned).toHaveLength(1);
  });

  it("shares one OS holder across overlapping runs and lets go at the last end", () => {
    const { keepAwake, spawned } = harness();
    const a = window(keepAwake);
    const b = window(keepAwake);
    const leaseA = a.lifecycle.begin(() => {});
    const leaseB = b.lifecycle.begin(() => {});
    expect(spawned).toHaveLength(1);
    expect(keepAwake.holderCount).toBe(2);

    a.lifecycle.settle(leaseA.generation);
    expect(keepAwake.asserting).toBe(true);
    b.lifecycle.settle(leaseB.generation);
    expect(keepAwake.asserting).toBe(false);
    expect(spawned).toHaveLength(1);
  });

  it("holds for sub-agents that outlive their run, with one hold for all of them", () => {
    const { keepAwake, spawned } = harness();
    const { awake, lifecycle } = window(keepAwake);
    const lease = lifecycle.begin(() => {});
    awake.subagentState("a1", "starting");
    awake.subagentState("a2", "running");
    awake.subagentState("a1", "running");
    expect(keepAwake.holderCount).toBe(2);

    lifecycle.settle(lease.generation);
    expect(keepAwake.asserting).toBe(true);
    awake.subagentState("a1", "completed");
    expect(keepAwake.asserting).toBe(true);
    awake.subagentState("a2", "failed");
    expect(keepAwake.asserting).toBe(false);
    expect(spawned).toHaveLength(1);
  });

  it("lets go of the run and its sub-agents when the window closes", () => {
    const { keepAwake, spawned } = harness();
    const { awake, lifecycle } = window(keepAwake);
    const lease = lifecycle.begin(() => {});
    awake.subagentState("a1", "running");
    awake.release();
    expect(keepAwake.holderCount).toBe(0);
    expect(keepAwake.asserting).toBe(false);

    // The aborted run settling afterwards doesn't hold again.
    lifecycle.settle(lease.generation);
    expect(spawned).toHaveLength(1);
  });

  it("lets go at the ceiling while the run goes on, and holds for the next run", () => {
    vi.useFakeTimers();
    const { keepAwake, spawned } = harness({ maxHoldMs: 30_000 });
    const { lifecycle } = window(keepAwake);
    const first = lifecycle.begin(() => {});
    vi.advanceTimersByTime(30_000);
    expect(lifecycle.state).toBe("running");
    expect(keepAwake.asserting).toBe(false);

    lifecycle.settle(first.generation);
    expect(spawned).toHaveLength(1);
    lifecycle.begin(() => {});
    expect(spawned).toHaveLength(2);
    expect(keepAwake.asserting).toBe(true);
  });

  it("starts clean after an engine restart: the old holder goes with the old engine", () => {
    const before = harness({ pid: 4242 });
    window(before.keepAwake).lifecycle.begin(() => {});
    expect(before.keepAwake.asserting).toBe(true);
    // The engine exits mid-run: its last-chance cleanup stops the holder
    // (and caffeinate's -w ends it even if that never runs).
    before.exitHooks[0]?.();
    expect(live(before.spawned)).toHaveLength(0);

    const after = harness({ pid: 5151 });
    expect(after.keepAwake.asserting).toBe(false);
    expect(after.keepAwake.holderCount).toBe(0);
    window(after.keepAwake).lifecycle.begin(() => {});
    expect(after.spawned).toHaveLength(1);
    expect(after.spawned[0]?.command).toEqual({
      command: "caffeinate",
      args: ["-i", "-w", "5151"],
    });
  });
});
