// What the host tells the gg-app sidecar it runs. The Mac mini may also run
// the upstream desktop app, which keeps `~/gg-projects` and `~/.gg/gg-app.json`;
// Kleio gets its own projects folder and settings file so the two never share
// one (the sidecar side is core/app-settings-paths.ts in @kleio/coder).

import { isAbsolute, join, normalize } from "node:path";

export type SidecarAppEnv = Record<
  "GG_APP_HEADLESS" | "GG_APP_SETTINGS_FILE" | "GG_APP_PROJECTS_DIR" | "GG_APP_PROJECTS_ONLY",
  string
>;

function absolute(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && isAbsolute(trimmed) ? normalize(trimmed) : null;
}

/**
 * `KLEIO_SETTINGS_FILE` / `KLEIO_PROJECTS_DIR` override the defaults
 * (`~/.gg/kleio-app.json`, `~/kleio-projects`); empty or relative values are
 * ignored.
 */
export function sidecarAppEnv(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): SidecarAppEnv {
  return {
    // Nobody is at this machine's screen: the sidecar must never touch a
    // folder macOS would gate behind a privacy dialog (it hangs, not errors).
    GG_APP_HEADLESS: "1",
    GG_APP_SETTINGS_FILE: absolute(env.KLEIO_SETTINGS_FILE) ?? join(home, ".gg", "kleio-app.json"),
    GG_APP_PROJECTS_DIR: absolute(env.KLEIO_PROJECTS_DIR) ?? join(home, "kleio-projects"),
    // Kleio's project list is only Kleio's projects, never every folder other
    // coding tools on the Mac mini have opened.
    GG_APP_PROJECTS_ONLY: "1",
  };
}
