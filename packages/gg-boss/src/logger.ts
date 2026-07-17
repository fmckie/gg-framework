import { openLog, log, closeLogger as coreCloseLogger } from "@kleio/core";
import { getManagerPaths } from "./manager-paths.js";

/**
 * Kleio Manager debug log — uses the shared file-writer core in @kleio/core so
 * the format stays grep-compatible. It remains at ~/.gg/boss/debug.log;
 * the core rotates at 10 MB and keeps one generation (`debug.log.1`) so a
 * session that's just been rotated still has its trailing context recoverable.
 *
 * Each line format:
 *   [<iso-ts>] [sid=<8 hex>] [<LEVEL>] [<category>] <message> [k=v k=v …]
 *
 * Tail it live during a session:
 *   tail -f ~/.gg/boss/debug.log
 *
 * Filter to the current session:
 *   grep "sid=$(grep -oE 'sid=[a-f0-9]+' ~/.gg/boss/debug.log | tail -1 | cut -d= -f2)" ~/.gg/boss/debug.log
 */

export { log, getSessionId } from "@kleio/core";

export const LEGACY_MANAGER_LOG_COMPONENT = "gg-boss";

export function getLogPath(): string {
  return getManagerPaths().debugLogFile;
}

/**
 * Open the Manager log and retain its legacy component/startup values for
 * log-filter compatibility. Idempotent once open.
 */
export function initLogger(meta?: {
  version?: string;
  bossProvider?: string;
  bossModel?: string;
  bossThinking?: string;
  workerProvider?: string;
  workerModel?: string;
  projectCount?: number;
}): void {
  if (!openLog(getLogPath(), LEGACY_MANAGER_LOG_COMPONENT)) return;
  const parts = [LEGACY_MANAGER_LOG_COMPONENT];
  if (meta?.version) parts[0] += ` v${meta.version}`;
  parts.push("started");
  if (meta?.bossProvider) parts.push(`boss=${meta.bossProvider}/${meta.bossModel ?? "?"}`);
  if (meta?.bossThinking) parts.push(`bossThinking=${meta.bossThinking}`);
  if (meta?.workerProvider) parts.push(`workers=${meta.workerProvider}/${meta.workerModel ?? "?"}`);
  if (meta?.projectCount !== undefined) parts.push(`projects=${meta.projectCount}`);
  parts.push(`pid=${process.pid}`);
  log("INFO", "startup", parts.join(" "));
}

/**
 * Best-effort flush + close. Called from the CLI's exit handler so the final
 * writes hit disk before the process tears down. Suppresses the shared
 * shutdown line to preserve the boss log's historical behavior.
 */
export function closeLogger(): void {
  coreCloseLogger({ shutdownLine: false });
}
