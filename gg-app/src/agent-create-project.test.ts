// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    setTitle: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { createProject, ProjectExistsError } from "./agent";

afterEach(() => invokeMock.mockReset());

describe("createProject", () => {
  it("returns the new folder's path", async () => {
    invokeMock.mockResolvedValue({ path: "/root/app" });
    await expect(createProject("app")).resolves.toBe("/root/app");
    expect(invokeMock).toHaveBeenCalledWith("app_create_project", { name: "app" });
  });

  it("turns the native 'exists:' error into ProjectExistsError with the message", async () => {
    invokeMock.mockRejectedValue('exists:A folder named "test" already exists.');
    const error = await createProject("test").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectExistsError);
    expect((error as Error).message).toBe('A folder named "test" already exists.');
  });

  it("passes any other failure through unchanged", async () => {
    invokeMock.mockRejectedValue("Still connecting to your Mac mini — try again in a moment.");
    await expect(createProject("test")).rejects.toBe(
      "Still connecting to your Mac mini — try again in a moment.",
    );
  });
});
