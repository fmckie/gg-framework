import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("readWorkspaceRoots", () => {
  it("is the default projects folder when there is no settings file", async () => {
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
  });

  it("follows KLEIO_PROJECTS_DIR and KLEIO_SETTINGS_FILE", async () => {
    const custom = join(home, "custom.json");
    writeFileSync(custom, JSON.stringify({ projectRoots: ["/srv/extra"] }));
    expect(
      await readWorkspaceRoots(
        { KLEIO_PROJECTS_DIR: "/srv/kleio", KLEIO_SETTINGS_FILE: custom },
        home,
      ),
    ).toEqual(["/srv/kleio", "/srv/extra"]);
  });

  it("uses the settings' projectsRoot and adds projectRoots", async () => {
    writeSettings({ projectsRoot: "/data/projects/", projectRoots: ["/data/more", "/data/other"] });
    expect(await readWorkspaceRoots({}, home)).toEqual([
      "/data/projects/",
      "/data/more",
      "/data/other",
    ]);
  });

  it("drops relative, empty, non-string and duplicate entries", async () => {
    writeSettings({
      projectsRoot: "relative/projects",
      projectRoots: ["", "  ", 7, null, { p: "/x" }, "rel", "/data/more", "/data/more"],
    });
    expect(await readWorkspaceRoots({}, home)).toEqual([
      join(home, "kleio-projects"),
      "/data/more",
    ]);
    writeSettings({ projectsRoot: 42, projectRoots: "/not/an/array" });
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
  });

  it("trims roots and drops ones that are empty or relative once trimmed", async () => {
    writeSettings({
      projectsRoot: "   ",
      projectRoots: ["  /data/padded  ", "\t\n", "  rel/inside  ", " /data/padded"],
    });
    expect(await readWorkspaceRoots({}, home)).toEqual([
      join(home, "kleio-projects"),
      "/data/padded",
    ]);
    writeSettings({ projectsRoot: "  /data/root  " });
    expect(await readWorkspaceRoots({}, home)).toEqual(["/data/root"]);
  });

  it("falls back to the default for malformed JSON or a non-object", async () => {
    writeSettings("{ not json");
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
    writeSettings("[1,2]");
    expect(await readWorkspaceRoots({}, home)).toEqual([join(home, "kleio-projects")]);
  });
});
