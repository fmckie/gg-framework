import path from "node:path";
import { getAppPaths } from "@kleio/core";

export const LEGACY_MANAGER_STATE_DIRECTORY = "boss";

export interface ManagerPaths {
  rootDir: string;
  linksFile: string;
  settingsFile: string;
  sessionsDir: string;
  planFile: string;
  telegramFile: string;
  updateStateFile: string;
  debugLogFile: string;
}

export function getManagerPaths(): ManagerPaths {
  const rootDir = path.join(getAppPaths().agentDir, LEGACY_MANAGER_STATE_DIRECTORY);
  return {
    rootDir,
    linksFile: path.join(rootDir, "links.json"),
    settingsFile: path.join(rootDir, "settings.json"),
    sessionsDir: path.join(rootDir, "sessions"),
    planFile: path.join(rootDir, "plan.json"),
    telegramFile: path.join(rootDir, "telegram.json"),
    updateStateFile: path.join(rootDir, "update-state.json"),
    debugLogFile: path.join(rootDir, "debug.log"),
  };
}
