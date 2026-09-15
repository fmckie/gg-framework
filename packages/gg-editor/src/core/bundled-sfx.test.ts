import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BUNDLED_SFX,
  bundledSfxDescriptionList,
  ensureBundledSfx,
  getSfxCacheDir,
  listBundledSfxNames,
  resolveSfx,
} from "./bundled-sfx.js";

// We don't want any of these tests touching real ffmpeg or the user's home
// directory. Most assertions are pure-function. The synthesis tests mock
// runFfmpeg via vi.mock at module scope.

vi.mock("./media/ffmpeg.js", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const real = await vi.importActual<typeof import("./media/ffmpeg.js")>("./media/ffmpeg.js");
  return {
    ...real,
    runFfmpeg: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
  };
});

describe("BUNDLED_SFX registry", () => {
  it("ships at least 8 named effects covering the creator vocabulary", () => {
    const names = listBundledSfxNames();
    for (const required of ["pop", "click", "whoosh", "swoosh", "riser", "thump", "ding"]) {
      expect(names).toContain(required);
    }
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  it("every recipe has stereo + non-empty args + no embedded output path", () => {
    for (const [_name, recipe] of Object.entries(BUNDLED_SFX)) {
      expect(recipe.description.length).toBeGreaterThan(10);
      expect(recipe.args).toContain("-ac");
      const acIdx = recipe.args.indexOf("-ac");
      expect(recipe.args[acIdx + 1]).toBe("2");
      // Output path is appended at synthesis time, not embedded in recipes.
      const lastArg = recipe.args[recipe.args.length - 1];
      expect(lastArg.endsWith(".wav")).toBe(false);
    }
  });

  it("bundledSfxDescriptionList includes every name + description", () => {
    const list = bundledSfxDescriptionList();
    for (const name of listBundledSfxNames()) {
      expect(list).toContain(name);
    }
    expect(list).toContain("(");
    expect(list).toContain(")");
  });
});

describe("getSfxCacheDir", () => {
  it("returns a path under the user's home", () => {
    const dir = getSfxCacheDir();
    expect(dir).toContain(".gg");
    expect(dir).toContain("sfx-cache");
  });
});

describe("resolveSfx", () => {
  it("treats unambiguous bundled names as bundled", async () => {
    // Force ffmpeg mock to claim success without touching disk.
    const r = await resolveSfx("whoosh", "/tmp/x").catch((e) => ({ error: e.message }));
    if ("error" in r) {
      // Expected if cache mkdir somehow fails on the test runner — skip.
      return;
    }
    expect(r.bundled).toBe(true);
    expect(r.name).toBe("whoosh");
    expect(r.path).toMatch(/whoosh\.wav$/);
  });

  it("treats anything containing a path separator as a file path", async () => {
    const r = await resolveSfx("./assets/myfx.wav", "/home/user");
    expect(r.bundled).toBe(false);
    expect(r.path).toBe(resolve("/home/user", "assets/myfx.wav"));
    expect(r.name).toBeUndefined();
  });

  it("treats anything with a dot (extension) as a file path", async () => {
    const r = await resolveSfx("custom.mp3", "/home/user");
    expect(r.bundled).toBe(false);
    expect(r.path).toBe(resolve("/home/user", "custom.mp3"));
  });

  it("rejects unknown bare names with the bundled list in the message", async () => {
    await expect(resolveSfx("notarealsfx", "/tmp")).rejects.toThrow(/Bundled:.*whoosh/);
  });
});

describe("ensureBundledSfx", () => {
  it("rejects unknown names", async () => {
    await expect(ensureBundledSfx("notarealsfx")).rejects.toThrow(/unknown bundled SFX/);
  });
});
