import { homedir, tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

import {
  USER_OUTPUT_DIR_NAME,
  safeOutputPath,
  safeResolveOutputPath,
  userOutputDir,
} from "./safe-paths.js";

const cwd = resolvePath(homedir(), "sample-project");

describe("safeOutputPath", () => {
  it("accepts a relative path under cwd", () => {
    const out = safeOutputPath(cwd, "out/clip.mp4");
    expect(out).toBe(resolvePath(cwd, "out/clip.mp4"));
  });

  it("rejects escape via parent-dir traversal", () => {
    expect(() => safeOutputPath("/Users/agent/proj", "../../etc/passwd")).toThrow(
      /outside allowed roots/,
    );
  });

  it("accepts absolute paths under the user output dir", () => {
    const target = resolvePath(userOutputDir(), "thumb.jpg");
    const out = safeOutputPath(cwd, target);
    expect(out).toBe(target);
  });

  it("accepts absolute paths under the system tempdir", () => {
    const target = resolvePath(tmpdir(), "scratch", "x.wav");
    const out = safeOutputPath(cwd, target);
    expect(out).toBe(target);
  });

  it("rejects an absolute path outside the allowlist", () => {
    expect(() => safeOutputPath(cwd, "/etc/hosts")).toThrow(/outside allowed roots/);
  });

  it("accepts paths under user-supplied allowRoots", () => {
    const root = resolvePath(homedir(), "Movies", "raw");
    const target = resolvePath(root, "a.mp4");
    const out = safeOutputPath(cwd, target, { allowRoots: [root] });
    expect(out).toBe(target);
  });

  it("rejects empty input", () => {
    expect(() => safeOutputPath(cwd, "")).toThrow(/empty/);
  });

  it("applies the allowlist to drive-letter paths using native path rules", () => {
    const target = "C:/Users/me/out.mp4";
    if (process.platform === "win32") {
      // A real drive-letter path outside the allowlist must remain denied.
      expect(() => safeOutputPath(cwd, target)).toThrow(/outside allowed roots/);
    } else {
      // POSIX treats the drive letter as a relative directory name under cwd.
      expect(safeOutputPath(cwd, target)).toBe(resolvePath(cwd, target));
    }
    expect(safeOutputPath(cwd, target, { allowRoots: ["C:/Users/me"] })).toBe(
      resolvePath(cwd, target),
    );
  });
});

describe("safeResolveOutputPath", () => {
  it("leaves a regular cwd-relative path unchanged", () => {
    const r = safeResolveOutputPath(cwd, "thumb.jpg");
    expect(r.redirected).toBe(false);
    expect(r.path.endsWith("thumb.jpg")).toBe(true);
  });

  it.each([
    "/tmp/grab.jpg",
    "/var/folders/zz/abc/T/grab.jpg",
    "/private/var/folders/zz/T/grab.jpg",
  ])("redirects the POSIX sandbox path %s only on POSIX", (target) => {
    if (process.platform === "win32") {
      // These become drive-rooted paths on Windows, not OS sandbox locations.
      expect(() => safeResolveOutputPath(cwd, target)).toThrow(/outside allowed roots/);
      return;
    }
    const r = safeResolveOutputPath(cwd, target);
    expect(r.redirected).toBe(true);
    expect(r.path).toBe(resolvePath(userOutputDir(), "grab.jpg"));
    expect(r.reason).toMatch(/sandbox/);
  });

  it("preserves an absolute path under the user output dir", () => {
    const target = resolvePath(userOutputDir(), "explicit.jpg");
    const r = safeResolveOutputPath(cwd, target);
    expect(r.redirected).toBe(false);
    expect(r.path).toBe(target);
  });

  it("exports a sensible USER_OUTPUT_DIR_NAME constant", () => {
    expect(USER_OUTPUT_DIR_NAME).toBe("gg-editor-out");
    expect(userOutputDir().endsWith(USER_OUTPUT_DIR_NAME)).toBe(true);
  });

  // Regression: absolute escape paths must be rejected even when given to
  // the redirect-aware variant. Earlier versions returned `{ path: requested,
  // redirected: false }` for any non-sandbox absolute path, bypassing the
  // cwd-confinement guard. The current implementation falls through to
  // safeOutputPath() for non-sandbox paths so escapes throw.
  it("rejects an absolute path outside the allowlist (e.g. /etc/passwd)", () => {
    expect(() => safeResolveOutputPath("/tmp/cwd", "/etc/passwd")).toThrow(/outside allowed roots/);
  });

  it("accepts an absolute path that resolves under cwd", () => {
    // Use a non-sandbox cwd so the result isn't redirected. ~/sample-project
    // is the suite-wide cwd; an absolute path inside it should round-trip.
    const target = resolvePath(cwd, "output.mp4");
    const r = safeResolveOutputPath(cwd, target);
    expect(r.redirected).toBe(false);
    expect(r.path).toBe(target);
  });
});
