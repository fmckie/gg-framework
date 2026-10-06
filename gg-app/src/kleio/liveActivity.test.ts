// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { startLiveActivity } from "./liveActivity";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ warn: vi.fn(async () => {}) }));

afterEach(() => {
  document.documentElement.classList.remove("platform-ios");
  vi.mocked(invoke).mockReset();
});

describe("startLiveActivity", () => {
  it("asks the iPhone app to show a Live Activity for the conversation", async () => {
    document.documentElement.classList.add("platform-ios");
    vi.mocked(invoke).mockResolvedValue(undefined);

    await startLiveActivity("group", "Launch Desk", { groupId: "g_0bc1704f" });

    expect(invoke).toHaveBeenCalledWith("kleio_live_start", {
      kind: "group",
      title: "Launch Desk",
      sessionId: null,
      groupId: "g_0bc1704f",
    });
  });

  it("does nothing off the iPhone, and never fails the send", async () => {
    await startLiveActivity("specialist", "Researcher", { sessionId: "s1" });
    expect(invoke).not.toHaveBeenCalled();

    document.documentElement.classList.add("platform-ios");
    vi.mocked(invoke).mockRejectedValue(new Error("Live Activities are off"));
    await expect(
      startLiveActivity("specialist", "Researcher", { sessionId: "s1" }),
    ).resolves.toBeUndefined();
  });
});
