import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// ESM imports require file URLs on Windows, not drive-letter paths.
const distUrl = new URL("../../dist/index.js", import.meta.url);

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runChild(script: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

interface EventRow {
  event_id: string;
  type: string;
  message: string;
  level: string;
  manual_report: number;
  fingerprint: string;
  stack: string;
}

function readEvents(dbPath: string): EventRow[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT * FROM events ORDER BY id").all() as EventRow[];
  db.close();
  return rows;
}

const distMissing = !existsSync(distUrl);

describe.skipIf(distMissing)("Node adapter — real child processes", () => {
  it("captures a real uncaughtException synchronously before the process dies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-int-"));
    const dbPath = join(dir, "errors.db");
    try {
      const result = await runChild(`
        import { initPixel } from ${JSON.stringify(distUrl.href)};
        initPixel({
          projectKey: "pk_test",
          sink: { kind: "local", path: ${JSON.stringify(dbPath)} },
        });
        throw new TypeError("real-uncaught-crash");
      `);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("real-uncaught-crash");

      const rows = readEvents(dbPath);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("TypeError");
      expect(rows[0].message).toBe("real-uncaught-crash");
      expect(rows[0].level).toBe("fatal");
      expect(rows[0].manual_report).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("captures a real unhandled promise rejection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-int-"));
    const dbPath = join(dir, "errors.db");
    try {
      const result = await runChild(`
        import { initPixel } from ${JSON.stringify(distUrl.href)};
        initPixel({
          projectKey: "pk_test",
          sink: { kind: "local", path: ${JSON.stringify(dbPath)} },
        });
        Promise.reject(new RangeError("real-rejection"));
        // Pixel's handler suppresses Node's auto-crash on unhandled rejection,
        // so we exit explicitly after the microtask queue drains.
        setTimeout(() => process.exit(0), 50);
      `);
      expect(result.code).toBe(0);

      const rows = readEvents(dbPath);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("RangeError");
      expect(rows[0].message).toBe("real-rejection");
      expect(rows[0].level).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("flushes async queued events on graceful exit (beforeExit hook)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-int-"));
    const dbPath = join(dir, "errors.db");
    try {
      // No try/catch around the throw — but it's caught manually before
      // emitting, so this exercises the async (console.error) path that
      // depends on beforeExit drain to land on disk.
      const result = await runChild(`
        import { initPixel } from ${JSON.stringify(distUrl.href)};
        initPixel({
          projectKey: "pk_test",
          sink: { kind: "local", path: ${JSON.stringify(dbPath)} },
        });
        console.error("graceful-async-error", new Error("inside-console-error"));
        // No explicit flush, no exit — the process should drain via beforeExit.
      `);
      expect(result.code).toBe(0);

      const rows = readEvents(dbPath);
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe("inside-console-error");
      expect(rows[0].level).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("reportPixel preserves the caller's stack when error is provided", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-int-"));
    const dbPath = join(dir, "errors.db");
    try {
      const result = await runChild(`
        import { initPixel, reportPixel, flushPixel, closePixel } from ${JSON.stringify(distUrl.href)};
        initPixel({
          projectKey: "pk_test",
          sink: { kind: "local", path: ${JSON.stringify(dbPath)} },
        });
        try {
          throw new RangeError("original-cause");
        } catch (e) {
          reportPixel({ message: "fetch failed in checkout flow", error: e });
        }
        await flushPixel();
        await closePixel();
      `);
      expect(result.code).toBe(0);

      const rows = readEvents(dbPath);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("RangeError");
      expect(rows[0].message).toBe("fetch failed in checkout flow");
      expect(rows[0].manual_report).toBe(1);
      const stack = JSON.parse(rows[0].stack) as Array<{ fn: string; in_app: boolean }>;
      expect(stack.length).toBeGreaterThan(0);
      expect(stack.some((f) => f.in_app)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("captured events have a unique event_id (uuid)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-int-"));
    const dbPath = join(dir, "errors.db");
    try {
      const result = await runChild(`
        import { initPixel, reportPixel, flushPixel, closePixel } from ${JSON.stringify(distUrl.href)};
        initPixel({
          projectKey: "pk_test",
          sink: { kind: "local", path: ${JSON.stringify(dbPath)} },
        });
        reportPixel({ message: "first" });
        reportPixel({ message: "second" });
        await flushPixel();
        await closePixel();
      `);
      expect(result.code).toBe(0);

      const rows = readEvents(dbPath);
      expect(rows).toHaveLength(2);
      expect(rows[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(rows[1].event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(rows[0].event_id).not.toBe(rows[1].event_id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not suppress Node's default crash on uncaughtException", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-int-"));
    const dbPath = join(dir, "errors.db");
    try {
      const result = await runChild(`
        import { initPixel } from ${JSON.stringify(distUrl.href)};
        initPixel({
          projectKey: "pk_test",
          sink: { kind: "local", path: ${JSON.stringify(dbPath)} },
        });
        throw new Error("verify-crash-still-happens");
      `);
      // If we used uncaughtException instead of uncaughtExceptionMonitor,
      // the process would NOT exit with non-zero and stderr would be empty.
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("verify-crash-still-happens");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
