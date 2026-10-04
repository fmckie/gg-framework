// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

import { transcribeDictation } from "./agent";

describe("transcribeDictation bridge", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    // waitForReady's port lookup.
    vi.mocked(invoke).mockResolvedValueOnce(1234);
  });

  it("sends the clip and returns the transcript", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ text: "Fix the padding." });
    await expect(transcribeDictation("AAAA")).resolves.toBe("Fix the padding.");
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_transcribe", { audio: "AAAA" });
  });

  it("treats a non-string transcript as no speech", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ text: null });
    await expect(transcribeDictation("AAAA")).resolves.toBe("");
  });

  it.each([null, "text", {}])("rejects a malformed reply: %j", async (reply) => {
    vi.mocked(invoke).mockResolvedValueOnce(reply);
    await expect(transcribeDictation("AAAA")).rejects.toThrow("Couldn't transcribe");
  });

  it("passes the native error through for the toast", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Couldn't reach your Mac to transcribe.");
    await expect(transcribeDictation("AAAA")).rejects.toBe(
      "Couldn't reach your Mac to transcribe.",
    );
  });
});
