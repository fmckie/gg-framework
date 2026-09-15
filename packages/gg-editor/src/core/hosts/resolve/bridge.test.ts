import type * as NodeOs from "node:os";
import { EventEmitter } from "node:events";
import { delimiter, join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { findPython, resolveEnv } from "./bridge.js";

describe("findPython", () => {
  it("returns a python3 candidate or undefined cleanly", () => {
    const py = findPython();
    if (py) {
      expect(typeof py.cmd).toBe("string");
      expect(Array.isArray(py.args)).toBe(true);
      expect(["python3", "python", "py"]).toContain(py.cmd);
    }
    // If undefined, that's also a valid environment (CI without Python 3).
  });
});

describe("resolveEnv", () => {
  it("sets PYTHONIOENCODING and PYTHONDONTWRITEBYTECODE", () => {
    const env = resolveEnv();
    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONDONTWRITEBYTECODE).toBe("1");
  });

  it("preserves a pre-set RESOLVE_SCRIPT_API", () => {
    const before = process.env.RESOLVE_SCRIPT_API;
    process.env.RESOLVE_SCRIPT_API = "/custom/path";
    try {
      const env = resolveEnv();
      expect(env.RESOLVE_SCRIPT_API).toBe("/custom/path");
    } finally {
      if (before === undefined) delete process.env.RESOLVE_SCRIPT_API;
      else process.env.RESOLVE_SCRIPT_API = before;
    }
  });

  it("prepends Modules dir to PYTHONPATH when API path is set", () => {
    const before = process.env.RESOLVE_SCRIPT_API;
    process.env.RESOLVE_SCRIPT_API = "/x/y/Scripting";
    try {
      const env = resolveEnv();
      expect(env.PYTHONPATH?.split(delimiter)[0]).toBe(join("/x/y/Scripting", "Modules"));
    } finally {
      if (before === undefined) delete process.env.RESOLVE_SCRIPT_API;
      else process.env.RESOLVE_SCRIPT_API = before;
    }
  });

  it("sets PYTHONHOME to the python prefix on Windows when not preset", async () => {
    // Mock node:os.platform() to report Windows. resolveEnv() reads platform()
    // lazily so we re-import after mocking.
    vi.resetModules();
    vi.doMock("node:os", async () => {
      const real = await vi.importActual<typeof NodeOs>("node:os");
      return { ...real, platform: () => "win32" };
    });
    const before = process.env.PYTHONHOME;
    delete process.env.PYTHONHOME;
    try {
      const mod = await import("./bridge.js");
      const env = mod.resolveEnv({ cmd: "python", args: [], prefix: "C:/Python311" });
      expect(env.PYTHONHOME).toBe("C:/Python311");
    } finally {
      if (before === undefined) delete process.env.PYTHONHOME;
      else process.env.PYTHONHOME = before;
      vi.doUnmock("node:os");
      vi.resetModules();
    }
  });

  it.each(["darwin", "linux"])("does not set PYTHONHOME on %s", async (platform) => {
    vi.resetModules();
    vi.doMock("node:os", async () => {
      const real = await vi.importActual<typeof NodeOs>("node:os");
      return { ...real, platform: () => platform };
    });
    const beforeHome = process.env.PYTHONHOME;
    delete process.env.PYTHONHOME;
    try {
      const mod = await import("./bridge.js");
      const env = mod.resolveEnv({ cmd: "python3", args: [], prefix: "/usr/local" });
      expect(env.PYTHONHOME).toBeUndefined();
    } finally {
      if (beforeHome !== undefined) process.env.PYTHONHOME = beforeHome;
      vi.doUnmock("node:os");
      vi.resetModules();
    }
  });

  it("preserves a pre-set PYTHONHOME on Windows", async () => {
    vi.resetModules();
    vi.doMock("node:os", async () => {
      const real = await vi.importActual<typeof NodeOs>("node:os");
      return { ...real, platform: () => "win32" };
    });
    const before = process.env.PYTHONHOME;
    process.env.PYTHONHOME = "C:/User/CustomHome";
    try {
      const mod = await import("./bridge.js");
      const env = mod.resolveEnv({ cmd: "python", args: [], prefix: "C:/Python311" });
      expect(env.PYTHONHOME).toBe("C:/User/CustomHome");
    } finally {
      if (before === undefined) delete process.env.PYTHONHOME;
      else process.env.PYTHONHOME = before;
      vi.doUnmock("node:os");
      vi.resetModules();
    }
  });
});

// ── ResolveBridge.call() resilience ──────────────────────────────────────────
//
// These tests mock node:child_process.spawn to produce a fake child that
// completes the handshake (emits {id:"_ready",ok:true} on stdout) and then
// behaves pathologically for the subsequent call().

describe("ResolveBridge.call resilience", () => {
  /**
   * Build a minimal fake ChildProcess whose stdout emits the _ready handshake
   * on the next tick so ensureStarted() resolves.  The returned object exposes
   * `triggerExit()` and allows callers to override `stdin.write`.
   */
  function makeReadyChild() {
    const stdout = new EventEmitter() as NodeJS.EventEmitter & { setEncoding: () => void };
    stdout.setEncoding = () => {};

    const stderr = new EventEmitter() as NodeJS.EventEmitter & { setEncoding: () => void };
    stderr.setEncoding = () => {};

    const stdin = {
      write: (_data: string, cb?: (err?: Error | null) => void) => {
        // Default: succeed silently.
        if (cb) cb(null);
        return true;
      },
      end: () => {},
    };

    const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as any).stdout = stdout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as any).stderr = stderr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as any).stdin = stdin;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as any).exitCode = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as any).signalCode = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as any).killed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as any).kill = () => {};

    function triggerExit(code: number | null = 1, signal: string | null = null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).exitCode = code;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).signalCode = signal;
      child.emit("exit", code, signal);
    }

    // Emit the handshake _ready on the next tick.
    setImmediate(() => {
      stdout.emit("data", JSON.stringify({ id: "_ready", ok: true }) + "\n");
    });

    return { child, stdin, triggerExit };
  }

  it("rejects within 1 s when child dies between ensureStarted and stdin.write", async () => {
    vi.resetModules();

    const { child, stdin, triggerExit } = makeReadyChild();

    // Override stdin.write: fire the exit event synchronously then call back
    // with an error, simulating a write to a dead process.
    stdin.write = (_data: string, cb?: (err?: Error | null) => void) => {
      triggerExit(1, null);
      if (cb) cb(new Error("write EPIPE"));
      return true;
    };

    vi.doMock("node:child_process", () => ({
      spawn: () => child,
    }));
    vi.doMock("node:fs", () => ({
      mkdtempSync: () => "/tmp/fake",
      writeFileSync: () => {},
    }));
    vi.doMock("../../python.js", () => ({
      findPython: () => ({ cmd: "python3", args: [] }),
    }));

    try {
      const mod = await import("./bridge.js");
      const bridge = new mod.ResolveBridge();

      await expect(
        Promise.race([
          bridge.call("timeline.getTimelines"),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timed out waiting for rejection")), 1_000),
          ),
        ]),
      ).rejects.toThrow();
    } finally {
      vi.doUnmock("node:child_process");
      vi.doUnmock("node:fs");
      vi.doUnmock("../../python.js");
      vi.resetModules();
    }
  });

  it("rejects after the 30 s safety timeout when child never responds", async () => {
    vi.useFakeTimers();
    vi.resetModules();

    const { child, stdin } = makeReadyChild();

    // stdin.write succeeds but never triggers a stdout response.
    stdin.write = (_data: string, cb?: (err?: Error | null) => void) => {
      if (cb) cb(null);
      return true;
    };

    vi.doMock("node:child_process", () => ({
      spawn: () => child,
    }));
    vi.doMock("node:fs", () => ({
      mkdtempSync: () => "/tmp/fake",
      writeFileSync: () => {},
    }));
    vi.doMock("../../python.js", () => ({
      findPython: () => ({ cmd: "python3", args: [] }),
    }));

    try {
      const mod = await import("./bridge.js");
      const bridge = new mod.ResolveBridge();

      // Wrap the assertion before advancing timers so the rejection is always
      // handled, avoiding an "unhandled rejection" warning from Node.
      const assertion = expect(bridge.call("timeline.getTimelines")).rejects.toThrow(
        /timed out after 30 s/,
      );

      // Advance all timers (fires the 30 s safety timeout, plus the setImmediate
      // that emits _ready so ensureStarted resolves first).
      await vi.runAllTimersAsync();

      await assertion;
    } finally {
      vi.useRealTimers();
      vi.doUnmock("node:child_process");
      vi.doUnmock("node:fs");
      vi.doUnmock("../../python.js");
      vi.resetModules();
    }
  });
});
