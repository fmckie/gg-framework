import { describe, expect, it } from "vitest";
import { runFile, runOptions } from "../src/run-file.js";

describe("runFile", () => {
  it("hands a program its stdin when given some", async () => {
    const r = await runFile(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      runOptions(10_000, 1024),
      "a ticket\n",
    );
    expect(r).toEqual({ ok: true, value: { exitCode: 0, stdout: "a ticket\n", stderr: "" } });
  });

  it("is fine when the program exits without reading it", async () => {
    const r = await runFile(
      process.execPath,
      ["-e", "process.exit(3)"],
      runOptions(10_000, 1024),
      "x".repeat(200_000),
    );
    expect(r).toMatchObject({ ok: true, value: { exitCode: 3 } });
  });
});
