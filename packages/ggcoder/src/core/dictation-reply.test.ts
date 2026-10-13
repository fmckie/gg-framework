import { describe, expect, it } from "vitest";
import { dictationUnavailableReply, hostMachine } from "./dictation-reply.js";

const APPLE_SILICON = { platform: "darwin", arch: "arm64" };

describe("dictationUnavailableReply", () => {
  it.each([
    ["offline", 503, "Check its internet connection"],
    ["server", 502, "Try again in a few minutes"],
    ["missing", 503, "Update Kleio on your host"],
    ["storage", 503, "It needs 139 MB free"],
    ["integrity", 503, "so it was thrown away"],
    ["load", 503, "Its log says why"],
    ["unsupported", 503, "doesn't work on this Mac"],
  ] as const)("answers %s with %i and plain words", (reason, status, words) => {
    const reply = dictationUnavailableReply(reason, APPLE_SILICON);

    expect(reply.status).toBe(status);
    expect(reply.error).toContain(words);
    // Never the code itself, a path or a raw error.
    expect(reply.error).not.toMatch(/\/|\\|ENO|EACCES|onnx|undefined/);
  });

  it.each([
    ["darwin", "x64", "a Mac with an Intel chip"],
    ["darwin", "arm64", "this Mac"],
    ["linux", "arm64", "this Linux computer"],
    ["win32", "x64", "this Windows PC"],
    ["freebsd", "x64", "this computer"],
  ])("names a %s %s host as %j", (platform, arch, words) => {
    expect(hostMachine(platform, arch)).toBe(words);
    expect(dictationUnavailableReply("unsupported", { platform, arch }).error).toBe(
      `Your host can't run dictation: the speech engine doesn't work on ${words}.`,
    );
  });
});
