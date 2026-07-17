import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppPaths } from "./paths.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAppPaths compatibility contract", () => {
  it("keeps every app path under ~/.gg without migration or filesystem writes", () => {
    const home = path.join(path.sep, "contract-home");
    vi.spyOn(os, "homedir").mockReturnValue(home);

    const existsSpy = vi.spyOn(fs, "existsSync");
    const readdirSpy = vi.spyOn(fs, "readdirSync");
    const copySpy = vi.spyOn(fs, "copyFileSync");
    const mkdirSpy = vi.spyOn(fs, "mkdirSync");
    const renameSpy = vi.spyOn(fs, "renameSync");
    const rmSpy = vi.spyOn(fs, "rmSync");
    const unlinkSpy = vi.spyOn(fs, "unlinkSync");
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    const agentDir = path.join(home, ".gg");
    expect(getAppPaths()).toEqual({
      agentDir,
      sessionsDir: path.join(agentDir, "sessions"),
      settingsFile: path.join(agentDir, "settings.json"),
      authFile: path.join(agentDir, "auth.json"),
      telegramFile: path.join(agentDir, "telegram.json"),
      agentHomeFile: path.join(agentDir, "agent-home.json"),
      mcpFile: path.join(agentDir, "mcp.json"),
      logFile: path.join(agentDir, "debug.log"),
      skillsDir: path.join(agentDir, "skills"),
      extensionsDir: path.join(agentDir, "extensions"),
      agentsDir: path.join(agentDir, "agents"),
    });

    for (const spy of [
      existsSpy,
      readdirSpy,
      copySpy,
      mkdirSpy,
      renameSpy,
      rmSpy,
      unlinkSpy,
      writeSpy,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
