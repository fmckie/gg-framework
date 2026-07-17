// Scope the shared update engine to the Kleio Manager package, release channel,
// and existing ~/.gg/boss state path so it never consumes Coder or upstream
// update state.
import { createAutoUpdater, KLEIO_PRODUCT_PROFILE } from "@kleio/core";
import { getManagerPaths } from "./manager-paths.js";

const updater = createAutoUpdater({
  packageName: "@kleio/manager",
  distTag: "kleio",
  stateFilePath: () => getManagerPaths().updateStateFile,
  periodicMessage: ({ currentVersion, latestVersion, updateCommand }) =>
    `Kleio Manager update ${currentVersion} → ${latestVersion} is ready. Restart ${KLEIO_PRODUCT_PROFILE.manager.preferredCommand} to apply it (or run ${updateCommand}).`,
});

export const checkAndAutoUpdate = updater.checkAndAutoUpdate;
export const getPendingUpdate = updater.getPendingUpdate;
export const startPeriodicUpdateCheck = updater.startPeriodicUpdateCheck;
export const stopPeriodicUpdateCheck = updater.stopPeriodicUpdateCheck;
