import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isOnboarded, onboardedMarkerPath, runDoctor } from "./doctor.js";

/**
 * The doctor module is mostly env probes; we don't try to mock spawn.
 * What we DO test is:
 *   - Every check is present and well-formed.
 *   - severity / status semantics are consistent.
 *   - The marker file plumbing works against a synthetic home dir.
 *   - `ready` reflects required-check status correctly.
 */

describe("runDoctor", () => {
  it("returns a check for every documented id", () => {
    const r = runDoctor();
    const ids = r.checks.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        "anthropic-key",
        "auth",
        "ffmpeg",
        "ffprobe",
        "openai-key",
        "python",
        "whisper-cpp",
        "whisperx",
      ].sort(),
    );
  });

  it("every check has label / detail / unlocks populated", () => {
    const r = runDoctor();
    for (const c of r.checks) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.label.length).toBeLessThanOrEqual(40);
      expect(c.detail.length).toBeGreaterThan(0);
      expect(c.unlocks.length).toBeGreaterThan(0);
    }
  });

  it("only checks with status='missing' or 'warn' carry a fix message", () => {
    const r = runDoctor();
    for (const c of r.checks) {
      if (c.status === "ok") {
        expect(c.fix).toBeUndefined();
      }
    }
  });

  it("ready === true only when every required check is ok", () => {
    const r = runDoctor();
    const requiredOk = r.checks
      .filter((c) => c.severity === "required")
      .every((c) => c.status === "ok");
    expect(r.ready).toBe(requiredOk);
  });

  it("returns a markerPath inside the user's home", () => {
    const r = runDoctor();
    expect(r.markerPath).toContain(".gg");
    expect(r.markerPath).toContain("onboarded-ggeditor");
  });
});

describe("isOnboarded / onboardedMarkerPath", () => {
  it("returns false when the marker is absent", () => {
    const home = mkdtempSync(join(tmpdir(), "gg-doctor-"));
    expect(isOnboarded(home)).toBe(false);
  });

  it("returns true once the marker file exists", () => {
    const home = mkdtempSync(join(tmpdir(), "gg-doctor-"));
    const path = onboardedMarkerPath(home);
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(path, "2026-04-30T00:00:00.000Z\n", "utf8");
    expect(isOnboarded(home)).toBe(true);
  });

  it("returns false when the marker path exists but isn't a regular file", () => {
    const home = mkdtempSync(join(tmpdir(), "gg-doctor-"));
    // Create a directory at the marker path instead of a file.
    mkdirSync(onboardedMarkerPath(home), { recursive: true });
    expect(isOnboarded(home)).toBe(false);
  });

  it("auth check sees a present auth.json under the synthetic home", () => {
    const home = mkdtempSync(join(tmpdir(), "gg-doctor-"));
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(join(home, ".gg", "auth.json"), "{}", "utf8");
    const r = runDoctor(home);
    const auth = r.checks.find((c) => c.id === "auth")!;
    expect(auth.status).toBe("ok");
    expect(auth.detail).toBe("signed in");
  });

  it("auth check reports missing on a fresh home", () => {
    const home = mkdtempSync(join(tmpdir(), "gg-doctor-"));
    const r = runDoctor(home);
    const auth = r.checks.find((c) => c.id === "auth")!;
    expect(auth.status).toBe("missing");
    expect(auth.fix).toContain("ggeditor login");
    expect(auth.fix).toContain("Kleio Coder");
    expect(auth.fix).toContain("~/.gg/auth.json");
  });
});

describe("doctor severity / status invariants", () => {
  it("OPENAI_API_KEY check returns ok when the env var is set", () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-fake-key";
    try {
      const r = runDoctor();
      const k = r.checks.find((c) => c.id === "openai-key")!;
      expect(k.status).toBe("ok");
      expect(k.severity).toBe("optional");
      expect(k.fix).toBeUndefined();
      expect(k.prompt).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it("ANTHROPIC_API_KEY check is informational (never blocks)", () => {
    const r = runDoctor();
    const k = r.checks.find((c) => c.id === "anthropic-key")!;
    expect(k.severity).toBe("info");
  });

  it("ffmpeg / ffprobe checks are required", () => {
    const r = runDoctor();
    const ff = r.checks.find((c) => c.id === "ffmpeg")!;
    const fp = r.checks.find((c) => c.id === "ffprobe")!;
    expect(ff.severity).toBe("required");
    expect(fp.severity).toBe("required");
  });

  it("does not include host (resolve/premiere) checks — those live in the runtime UI", () => {
    const r = runDoctor();
    expect(r.checks.find((c) => c.id === "resolve")).toBeUndefined();
    expect(r.checks.find((c) => c.id === "premiere")).toBeUndefined();
  });
});
