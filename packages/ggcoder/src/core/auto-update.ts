// The update engine lives in @kleio/core. This module scopes it to the Kleio
// Coder package, release channel, and existing state path while preserving the
// exported function names consumed by callers and tests.
import path from "node:path";
import os from "node:os";
import { createAutoUpdater } from "@kleio/core";

const updater = createAutoUpdater({
  packageName: "@kleio/coder",
  distTag: "kleio",
  stateFilePath: () => path.join(os.homedir(), ".gg", "update-state.json"),
});

export const checkAndAutoUpdate = updater.checkAndAutoUpdate;
export const getPendingUpdate = updater.getPendingUpdate;
export const startPeriodicUpdateCheck = updater.startPeriodicUpdateCheck;
export const stopPeriodicUpdateCheck = updater.stopPeriodicUpdateCheck;
