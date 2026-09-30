import path from "node:path";

/**
 * Where the desktop sidecar keeps its app settings and new projects.
 *
 * By default (the upstream desktop app) that is `~/.gg/gg-app.json` and
 * `~/gg-projects`. An embedder running this same sidecar for another app (the
 * Kleio host, on a Mac mini that may also run the upstream app) sets its own,
 * so the two apps never share a projects folder or each other's picker state:
 *   - `GG_APP_SETTINGS_FILE` — absolute path of the settings JSON;
 *   - `GG_APP_PROJECTS_DIR` — absolute path of the default projects folder;
 *   - `GG_APP_PROJECTS_ONLY=1` — the project list shows only projects inside
 *     the app's own folders, not every project other tools have opened.
 * Empty or relative paths are ignored (the defaults apply).
 */
export interface AppSettingsPaths {
  settingsFile: string;
  defaultProjectsRoot: string;
  /** The embedder chose the projects folder, so it counts as configured. */
  projectsRootFromEnv: boolean;
  /** List only projects inside the app's own project folders. */
  ownProjectsOnly: boolean;
}

function absolute(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && path.isAbsolute(trimmed) ? path.normalize(trimmed) : null;
}

export function resolveAppSettingsPaths(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): AppSettingsPaths {
  const settingsFile = absolute(env.GG_APP_SETTINGS_FILE);
  const projectsDir = absolute(env.GG_APP_PROJECTS_DIR);
  return {
    settingsFile: settingsFile ?? path.join(home, ".gg", "gg-app.json"),
    defaultProjectsRoot: projectsDir ?? path.join(home, "gg-projects"),
    projectsRootFromEnv: projectsDir !== null,
    ownProjectsOnly: env.GG_APP_PROJECTS_ONLY?.trim() === "1",
  };
}

/** `target` is `root` itself or somewhere inside it. */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Only the projects inside one of `roots` (the app's projects folder and any
 * extra folders it was given). Paths are compared resolved, so a trailing
 * slash or `..` segment can't slip a project in or out.
 */
export function projectsWithin<T extends { path: string }>(
  projects: readonly T[],
  roots: readonly string[],
): T[] {
  const resolved = roots
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => path.resolve(r));
  return projects.filter((p) => resolved.some((root) => isWithin(root, path.resolve(p.path))));
}
