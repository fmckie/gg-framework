import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end smoke test for the published CLI binary. Invokes the built bin
 * the same way npm/pnpm would after a global install, asserts it prints help
 * and exits 0. Catches:
 *  - missing or broken shebang on dist/cli.js
 *  - unresolved imports after build (e.g. forgot to bundle an asset)
 *  - assets/* files not copied into dist (the build:copy step regressing)
 *  - a CLI flag-parsing crash
 *
 * Runs on Linux/macOS/Windows when invoked from the repo (CI matrix).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, "..", "dist", "cli.js");

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI smoke test timed out"));
    }, 10_000);
  });
}

describe("Kleio Manager CLI smoke", () => {
  it("--help exits 0 and prints the preferred brand and command", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Kleio Manager v4.10.1-kleio.0");
    expect(output).toContain("kleio-manager");
    expect(output.toLowerCase()).toContain("usage");
  });

  it("-h is the same as --help", async () => {
    const result = await runCli(["-h"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Kleio Manager");
  });

  it("reports the package version", async () => {
    const result = await runCli(["--version"]);
    expect(result).toMatchObject({
      code: 0,
      stdout: "Kleio Manager v4.10.1-kleio.0\n",
      stderr: "",
    });
  });
});
