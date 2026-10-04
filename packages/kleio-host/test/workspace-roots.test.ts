import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceRoots } from "../src/workspace-roots.js";

let home: string;
let settings: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kleio-roots-"));
  settings = join(home, ".gg", "kleio-app.json");
  mkdirSync(join(home, ".gg"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const writeSettings = (value: unknown): void =>
  writeFileSync(settings, typeof value === "string" ? value : JSON.stringify(value));

// Roots are normalized for the platform (Windows turns "/" into "\"), so each
// test uses real absolute paths under the temp home, built with node:path.
const under = (...parts: string[]): string => join(home, ...parts);

describe("readWorkspaceRoots", () => {
  it("is the default projects folder when there is no settings file", async () => {
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
  });

  it("follows KLEIO_PROJECTS_DIR and KLEIO_SETTINGS_FILE", async () => {
    const custom = join(home, "custom.json");
    writeFileSync(custom, JSON.stringify({ projectRoots: [under("srv", "extra")] }));
    expect(
      await readWorkspaceRoots(
        { KLEIO_PROJECTS_DIR: under("srv", "kleio"), KLEIO_SETTINGS_FILE: custom },
        home,
      ),
    ).toEqual([under("srv", "kleio"), under("srv", "extra")]);
  });

  it("uses the settings' projectsRoot and adds projectRoots", async () => {
    // A trailing separator is kept.
    const projects = under("data", "projects") + sep;
    writeSettings({
      projectsRoot: projects,
      projectRoots: [under("data", "more"), under("data", "other")],
    });
    expect(await readWorkspaceRoots({}, home)).toEqual([
      projects,
      under("data", "more"),
      under("data", "other"),
    ]);
  });

  it("drops relative, empty, non-string and duplicate entries", async () => {
    writeSettings({
      projectsRoot: "relative/projects",
      projectRoots: [
        "",
        "  ",
        7,
        null,
        { p: "/x" },
        "rel",
        under("data", "more"),
        under("data", "more"),
      ],
    });
    expect(await readWorkspaceRoots({}, home)).toEqual([
      join(home, "kleio-projects"),
      under("data", "more"),
    ]);
    writeSettings({ projectsRoot: 42, projectRoots: "/not/an/array" });
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
  });

  it("trims roots and drops ones that are empty or relative once trimmed", async () => {
    const padded = under("data", "padded");
    writeSettings({
      projectsRoot: "   ",
      projectRoots: [`  ${padded}  `, "\t\n", "  rel/inside  ", ` ${padded}`],
    });
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects"), padded]);
    writeSettings({ projectsRoot: `  ${under("data", "root")}  ` });
    expect(await readWorkspaceRoots({}, home)).toEqual([under("data", "root")]);
  });

  it("falls back to the default for malformed JSON or a non-object", async () => {
    writeSettings("{ not json");
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
    writeSettings("[1,2]");
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
  });
});
