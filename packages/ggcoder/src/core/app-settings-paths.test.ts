import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectsWithin, resolveAppSettingsPaths } from "./app-settings-paths.js";

const HOME = path.join(path.sep, "home", "demo");

describe("resolveAppSettingsPaths", () => {
  it("keeps the default paths when nothing is set", () => {
    expect(resolveAppSettingsPaths({}, HOME)).toEqual({
      settingsFile: path.join(HOME, ".gg", "gg-app.json"),
      defaultProjectsRoot: path.join(HOME, "gg-projects"),
      projectsRootFromEnv: false,
      ownProjectsOnly: false,
    });
  });

  it("uses an embedder's own settings file and projects folder", () => {
    const settingsFile = path.join(HOME, ".gg", "kleio-app.json");
    const projectsDir = path.join(HOME, "kleio-projects");
    expect(
      resolveAppSettingsPaths(
        {
          GG_APP_SETTINGS_FILE: settingsFile,
          GG_APP_PROJECTS_DIR: ` ${projectsDir} `,
          GG_APP_PROJECTS_ONLY: "1",
        },
        HOME,
      ),
    ).toEqual({
      settingsFile,
      defaultProjectsRoot: projectsDir,
      projectsRootFromEnv: true,
      ownProjectsOnly: true,
    });
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["relative", "kleio-projects"],
    ["dot-relative", "./kleio-projects"],
  ])("ignores a %s value", (_label, value) => {
    const paths = resolveAppSettingsPaths(
      { GG_APP_SETTINGS_FILE: value, GG_APP_PROJECTS_DIR: value, GG_APP_PROJECTS_ONLY: value },
      HOME,
    );
    expect(paths.settingsFile).toBe(path.join(HOME, ".gg", "gg-app.json"));
    expect(paths.defaultProjectsRoot).toBe(path.join(HOME, "gg-projects"));
    expect(paths.projectsRootFromEnv).toBe(false);
    expect(paths.ownProjectsOnly).toBe(false);
  });

  it.each(["0", "true", "yes"])("only turns the project filter on for exactly 1, not %j", (v) => {
    expect(resolveAppSettingsPaths({ GG_APP_PROJECTS_ONLY: v }, HOME).ownProjectsOnly).toBe(false);
  });
});

describe("projectsWithin", () => {
  const kleio = path.join(HOME, "kleio-projects");
  const at = (...parts: string[]): { path: string } => ({ path: path.join(...parts) });

  it("keeps projects inside the app's folders and drops the rest", () => {
    const projects = [
      at(kleio, "site"),
      at(kleio, "apps", "phone"),
      at(HOME, "gg-projects", "tool"),
      at(HOME, "code", "other"),
      at(HOME, "work", "client"),
    ];
    expect(projectsWithin(projects, [kleio, path.join(HOME, "work")])).toEqual([
      at(kleio, "site"),
      at(kleio, "apps", "phone"),
      at(HOME, "work", "client"),
    ]);
  });

  it("is not fooled by a folder whose name only starts the same", () => {
    expect(projectsWithin([at(`${kleio}-old`, "site")], [kleio])).toEqual([]);
  });

  it("resolves paths before comparing", () => {
    const sneaky = { path: path.join(kleio, "..", "gg-projects", "tool") };
    const tidy = { path: `${path.join(kleio, "site")}${path.sep}` };
    expect(projectsWithin([sneaky, tidy], [`${kleio}${path.sep}`])).toEqual([tidy]);
  });

  it("keeps nothing when there are no folders", () => {
    expect(projectsWithin([at(kleio, "site")], [])).toEqual([]);
    expect(projectsWithin([at(kleio, "site")], ["  "])).toEqual([]);
  });
});
