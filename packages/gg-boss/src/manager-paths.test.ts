import path from "node:path";
import { getAppPaths } from "@kleio/core";
import { describe, expect, it } from "vitest";
import { getManagerPaths, LEGACY_MANAGER_STATE_DIRECTORY } from "./manager-paths.js";

describe("Kleio Manager state path compatibility", () => {
  it("keeps every persisted file under the existing .gg/boss root", () => {
    const appPaths = getAppPaths();
    const managerPaths = getManagerPaths();
    const expectedRoot = path.join(appPaths.agentDir, "boss");

    expect(LEGACY_MANAGER_STATE_DIRECTORY).toBe("boss");
    expect(managerPaths).toEqual({
      rootDir: expectedRoot,
      linksFile: path.join(expectedRoot, "links.json"),
      settingsFile: path.join(expectedRoot, "settings.json"),
      sessionsDir: path.join(expectedRoot, "sessions"),
      planFile: path.join(expectedRoot, "plan.json"),
      telegramFile: path.join(expectedRoot, "telegram.json"),
      updateStateFile: path.join(expectedRoot, "update-state.json"),
      debugLogFile: path.join(expectedRoot, "debug.log"),
    });
    expect(path.relative(appPaths.agentDir, managerPaths.rootDir)).toBe("boss");
    expect(JSON.stringify(managerPaths)).not.toContain(".kleio");
  });
});
