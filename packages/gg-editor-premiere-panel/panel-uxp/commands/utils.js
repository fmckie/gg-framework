/* eslint-disable */
/**
 * Utility helpers shared across the Premiere UXP command handlers.
 *
 * Verified against:
 *   - mikechambers/adb-mcp (uxp/pr/commands/utils.js)
 *   - AdobeDocs/uxp-premiere-pro-samples
 *
 * Async-everywhere: pretty much every getter on the Premiere DOM is async.
 */

const ppro = require("premierepro");
const { TICKS_PER_SECOND } = require("./consts.js");

/** Active project, throwing a clear message if Premiere has nothing open. */
async function getActiveProject() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No project open in Premiere.");
  return project;
}

/** Active sequence, throwing a clear message if there is none. */
async function getActiveSequence() {
  const project = await getActiveProject();
  const seq = await project.getActiveSequence();
  if (!seq) throw new Error("No active sequence in Premiere.");
  return { project, sequence: seq };
}

/**
 * Recursively walk the project bins looking for a project item by name.
 * Returns null when not found (caller can decide whether to throw).
 */
async function findProjectItem(parent, name) {
  const items = await parent.getItems();
  for (const item of items) {
    if (item.name === name) return item;
  }
  for (const item of items) {
    const folder = ppro.FolderItem.cast(item);
    if (folder) {
      const found = await findProjectItem(folder, name);
      if (found) return found;
    }
  }
  return null;
}

/** Search the entire project tree from root for an item by name. */
async function findProjectItemByName(project, name) {
  const root = await project.getRootItem();
  return findProjectItem(root, name);
}

/**
 * Compute frames-per-second for a sequence. Premiere stores `timebase` as
 * ticks per frame; fps = TICKS_PER_SECOND / timebase.
 */
async function fpsOf(sequence) {
  const tb = await sequence.getTimebase();
  if (!tb) return 30;
  return TICKS_PER_SECOND / tb;
}

/** Convert a frame count + sequence into a tick count. */
async function framesToTicks(frames, sequence) {
  const tb = await sequence.getTimebase();
  return Math.round(frames * tb);
}

/** Convert a tick count + sequence into a (rounded) frame number. */
async function ticksToFrames(ticks, sequence) {
  const tb = await sequence.getTimebase();
  if (!tb) return 0;
  return Math.round(ticks / tb);
}

/** Convert seconds to ticks (used when adding markers etc). */
function secondsToTicks(seconds) {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/**
 * Wrap a synchronous "build action list" callback in Premiere's required
 * lockedAccess + executeTransaction envelope. The callback receives no
 * arguments and must return an array of action objects to add to the
 * compound transaction.
 *
 * Errors inside the transaction are re-thrown with context so the caller's
 * try/catch sees a readable message.
 */
function withTransaction(project, getActions) {
  try {
    project.lockedAccess(() => {
      project.executeTransaction((compoundAction) => {
        const actions = getActions();
        for (const a of actions) compoundAction.addAction(a);
      });
    });
  } catch (e) {
    throw new Error("Premiere transaction failed: " + (e && e.message ? e.message : e));
  }
}

module.exports = {
  getActiveProject,
  getActiveSequence,
  findProjectItem,
  findProjectItemByName,
  fpsOf,
  framesToTicks,
  ticksToFrames,
  secondsToTicks,
  withTransaction,
};
