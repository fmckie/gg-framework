import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { sidecarAppEnv } from "../src/sidecar-env.js";

const HOME = join(sep, "home", "demo");

describe("sidecarAppEnv", () => {
  it("gives Kleio its own settings file and projects folder, apart from the upstream app's", () => {
    expect(sidecarAppEnv({}, HOME)).toEqual({
      GG_APP_HEADLESS: "1",
      GG_APP_SETTINGS_FILE: join(HOME, ".gg", "kleio-app.json"),
      GG_APP_PROJECTS_DIR: join(HOME, "kleio-projects"),
      GG_APP_PROJECTS_ONLY: "1",
    });
  });

  it("honours absolute overrides", () => {
    const settings = join(sep, "srv", "kleio", "settings.json");
    const projects = join(sep, "srv", "kleio", "projects");
    const env = sidecarAppEnv(
      { KLEIO_SETTINGS_FILE: settings, KLEIO_PROJECTS_DIR: ` ${projects} ` },
      HOME,
    );
    expect(env.GG_APP_SETTINGS_FILE).toBe(settings);
    expect(env.GG_APP_PROJECTS_DIR).toBe(projects);
  });

  it.each(["", "  ", "projects", "./projects"])("ignores the override %j", (value) => {
    const env = sidecarAppEnv({ KLEIO_SETTINGS_FILE: value, KLEIO_PROJECTS_DIR: value }, HOME);
    expect(env.GG_APP_SETTINGS_FILE).toBe(join(HOME, ".gg", "kleio-app.json"));
    expect(env.GG_APP_PROJECTS_DIR).toBe(join(HOME, "kleio-projects"));
  });
});
