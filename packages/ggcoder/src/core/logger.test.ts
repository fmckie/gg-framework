import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeLogger, initLogger, LEGACY_CODER_LOG_COMPONENT } from "./logger.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  closeLogger({ shutdownLine: false });
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Coder logger compatibility contract", () => {
  it("retains the ggcoder startup and shutdown identifiers", () => {
    expect(LEGACY_CODER_LOG_COMPONENT).toBe("ggcoder");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kleio-coder-log-"));
    temporaryDirectories.push(directory);
    const logFile = path.join(directory, "debug.log");

    initLogger(logFile, { version: "4.10.1-kleio.0" });
    closeLogger();

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("ggcoder v4.10.1-kleio.0 started");
    expect(content).toContain("ggcoder shutting down");
  });
});
