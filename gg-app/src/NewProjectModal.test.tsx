// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    setTitle: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("./agent", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentModule>();
  return {
    ProjectExistsError: actual.ProjectExistsError,
    createProject: vi.fn(),
    selectProject: vi.fn(),
    setProjectHidden: vi.fn(),
  };
});

import type * as AgentModule from "./agent";
import { createProject, ProjectExistsError, selectProject, setProjectHidden } from "./agent";
import { NewProjectModal } from "./NewProjectModal";

const createProjectMock = vi.mocked(createProject);
const selectProjectMock = vi.mocked(selectProject);
const setProjectHiddenMock = vi.mocked(setProjectHidden);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(projectsRoot = "/root"): { onCreated: ReturnType<typeof vi.fn> } {
  const onCreated = vi.fn();
  selectProjectMock.mockResolvedValue(undefined);
  setProjectHiddenMock.mockResolvedValue(undefined);
  render(<NewProjectModal projectsRoot={projectsRoot} onClose={() => {}} onCreated={onCreated} />);
  return { onCreated };
}

function typeName(value: string): void {
  fireEvent.change(screen.getByPlaceholderText("my-project"), { target: { value } });
}

describe("NewProjectModal", () => {
  it("creates the folder and opens it", async () => {
    createProjectMock.mockResolvedValue("/root/my-app");
    const { onCreated } = renderModal();
    typeName("My App");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("/root/my-app"));
    expect(createProjectMock).toHaveBeenCalledWith("my-app");
    expect(selectProjectMock).toHaveBeenCalledWith("/root/my-app");
  });

  it("offers to open a folder that is already there, and un-hides it first", async () => {
    createProjectMock.mockRejectedValue(
      new ProjectExistsError('A folder named "test" already exists.'),
    );
    const { onCreated } = renderModal();
    typeName("Test");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      'A folder named "test" already exists.',
    );
    expect(screen.getByText("Opens", { exact: false })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open test" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("/root/test"));
    expect(createProjectMock).toHaveBeenCalledTimes(1);
    expect(setProjectHiddenMock).toHaveBeenCalledWith("/root/test", false);
    expect(selectProjectMock).toHaveBeenCalledWith("/root/test");
    // Shown in the list again before the window moves into the project.
    expect(setProjectHiddenMock.mock.invocationCallOrder[0]).toBeLessThan(
      selectProjectMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("still opens the folder when un-hiding fails", async () => {
    createProjectMock.mockRejectedValue(new ProjectExistsError("exists"));
    const { onCreated } = renderModal();
    setProjectHiddenMock.mockRejectedValue(new Error("offline"));
    typeName("test");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open test" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("/root/test"));
  });

  it("goes back to creating when the name changes", async () => {
    createProjectMock.mockRejectedValue(new ProjectExistsError("exists"));
    renderModal();
    typeName("test");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("button", { name: "Open test" });
    typeName("other");
    expect(screen.getByRole("button", { name: "Create" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not offer to open before the projects folder is known", async () => {
    createProjectMock.mockRejectedValue(new ProjectExistsError("exists"));
    renderModal("");
    typeName("test");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toBe("exists");
    expect(screen.queryByRole("button", { name: "Open test" })).toBeNull();
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("keeps other failures as errors, with no open offer", async () => {
    createProjectMock.mockRejectedValue("Project name must be lowercase letters.");
    const { onCreated } = renderModal();
    typeName("ok");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Project name must be lowercase letters.",
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeDefined();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
