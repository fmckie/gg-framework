import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { KLEIO_PRODUCT_PROFILE } from "@kleio/core";

export interface ResolvedCoderCommand {
  command: string;
  argsPrefix: string[];
  source: "current" | "preferred" | "legacy" | "default";
}

export interface ResolveCoderCommandOptions {
  /** Null disables current-script detection (useful to model library consumers). */
  currentScript?: string | null;
  nodeExecutable?: string;
  /** Runtime flags to preserve when re-launching the current Node script. */
  nodeArgs?: readonly string[];
  pathEnv?: string;
  platform?: NodeJS.Platform;
  isExecutable?: (filePath: string) => boolean;
}

function defaultIsExecutable(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    const mode = platform === "win32" ? constants.F_OK : constants.X_OK;
    accessSync(filePath, mode);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function executableCandidates(command: string, platform: NodeJS.Platform): string[] {
  return platform === "win32" ? [`${command}.cmd`, `${command}.exe`, command] : [command];
}

function findOnPath(
  command: string,
  pathEnv: string,
  platform: NodeJS.Platform,
  isExecutable: (filePath: string) => boolean,
): string | null {
  for (const directory of pathEnv.split(path.delimiter)) {
    if (!directory) continue;
    for (const candidate of executableCandidates(command, platform)) {
      const filePath = path.join(directory, candidate);
      if (isExecutable(filePath)) return filePath;
    }
  }
  return null;
}

function isCurrentCoderScript(scriptPath: string): boolean {
  const normalized = scriptPath.replace(/\\/g, "/");
  const basename = path.basename(normalized).replace(/\.(?:cmd|exe)$/i, "");
  const { preferredCommand, legacyCommand } = KLEIO_PRODUCT_PROFILE.coder;
  if (basename === preferredCommand || basename === legacyCommand) return true;
  return /\/(?:packages\/ggcoder|@kleio\/coder)\/dist\/cli\.js$/i.test(normalized);
}

/**
 * Resolve the same running Coder first, then the preferred Kleio bin, with the
 * legacy bin retained as the final installed-command fallback.
 */
export function resolveCoderCommand(
  options: ResolveCoderCommandOptions = {},
): ResolvedCoderCommand {
  const platform = options.platform ?? process.platform;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const nodeArgs = options.nodeArgs ?? process.execArgv;
  const currentScript =
    options.currentScript === undefined ? (process.argv[1] ?? null) : options.currentScript;
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const isExecutable =
    options.isExecutable ?? ((filePath: string) => defaultIsExecutable(filePath, platform));

  if (currentScript && isCurrentCoderScript(currentScript)) {
    if (/\.m?js$/i.test(currentScript)) {
      return {
        command: nodeExecutable,
        argsPrefix: [...nodeArgs, currentScript],
        source: "current",
      };
    }
    if (isExecutable(currentScript)) {
      return { command: currentScript, argsPrefix: [], source: "current" };
    }
  }

  const preferred = findOnPath(
    KLEIO_PRODUCT_PROFILE.coder.preferredCommand,
    pathEnv,
    platform,
    isExecutable,
  );
  if (preferred) return { command: preferred, argsPrefix: [], source: "preferred" };

  const legacy = findOnPath(
    KLEIO_PRODUCT_PROFILE.coder.legacyCommand,
    pathEnv,
    platform,
    isExecutable,
  );
  if (legacy) return { command: legacy, argsPrefix: [], source: "legacy" };

  return {
    command: KLEIO_PRODUCT_PROFILE.coder.preferredCommand,
    argsPrefix: [],
    source: "default",
  };
}
