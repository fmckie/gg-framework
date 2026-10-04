// Kleio's projects folders on this Mac: where Chat and Code sessions run, so
// where the files they write live. The sidecar decides them from its settings
// file (`projectsRoot`, `projectRoots`) with `GG_APP_PROJECTS_DIR` as the
// default (see sidecar-env.ts and the sidecar's loadAppSettings). They are
// read again on each call, so a moved projects folder is followed without a
// restart.

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { sidecarAppEnv } from "./sidecar-env.js";

function absolute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && isAbsolute(trimmed) ? normalize(trimmed) : null;
}

/** The settings file's object, or null when it is missing, unreadable or not an object. */
async function readSettings(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The workspace roots: the settings' `projectsRoot` (else the env default),
 * then each `projectRoots` entry. Only absolute paths; duplicates dropped.
 */
export async function readWorkspaceRoots(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Promise<string[]> {
  const appEnv = sidecarAppEnv(env, home);
  const settings = await readSettings(appEnv.GG_APP_SETTINGS_FILE);
  const roots = [absolute(settings?.projectsRoot) ?? appEnv.GG_APP_PROJECTS_DIR];
  const extra = settings?.projectRoots;
  if (Array.isArray(extra)) {
    for (const entry of extra) {
      const root = absolute(entry);
      if (root !== null && !roots.includes(root)) roots.push(root);
    }
  }
  return roots;
}
