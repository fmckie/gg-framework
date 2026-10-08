// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import {
  getSettings,
  importTranscript,
  listHostProjectFolders,
  listProjects,
  listSessions,
  selectProject,
  setProjectHidden,
  waitForReady,
  type DiscoveredProject,
  type RecentSession,
} from "./agent";
import { folderPlace } from "./HostFoldersModal";
import { useKleioRemote } from "./kleio/useKleioRemote";
import { ProjectPicker } from "./ProjectPicker";

vi.mock("./agent", () => ({
  arrangeAllWindows: vi.fn(),
  focusWindowByOffset: vi.fn(),
  getSettings: vi.fn(),
  importTranscript: vi.fn(),
  listHostProjectFolders: vi.fn(),
  listProjects: vi.fn(),
  listSessions: vi.fn(),
  selectProject: vi.fn(),
  setProjectHidden: vi.fn(),
  waitForReady: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./kleio/useKleioRemote", () => ({ useKleioRemote: vi.fn() }));
vi.mock("./RadioButton", () => ({ RadioButton: () => <button>Radio</button> }));
vi.mock("./WindowLayoutButton", () => ({ WindowLayoutButton: () => <button>Windows</button> }));
vi.mock("./NewProjectModal", () => ({ NewProjectModal: () => null }));

const getSettingsMock = vi.mocked(getSettings);
const importTranscriptMock = vi.mocked(importTranscript);
const listHostProjectFoldersMock = vi.mocked(listHostProjectFolders);
const openFolderDialogMock = vi.mocked(openFolderDialog);
const useKleioRemoteMock = vi.mocked(useKleioRemote);

/** Not paired, unless a test says otherwise. */
function setPaired(host: string | null): void {
  useKleioRemoteMock.mockReturnValue({
    status: {
      active: host
        ? { base: `https://${host}:8443`, host, deviceId: "d1", label: "Laptop", admin: false }
        : null,
      paired: null,
    },
    refresh: vi.fn(),
  });
}
const listProjectsMock = vi.mocked(listProjects);
const listSessionsMock = vi.mocked(listSessions);
const selectProjectMock = vi.mocked(selectProject);
const setProjectHiddenMock = vi.mocked(setProjectHidden);
const waitForReadyMock = vi.mocked(waitForReady);

const PROJECT: DiscoveredProject = {
  name: "ui-test",
  path: "/Users/dev/ui-test",
  lastActiveDisplay: "1w ago",
  sources: ["claude-code"],
};

const NATIVE_SESSION: RecentSession = {
  id: "gg-1",
  path: "/sessions/gg-1.jsonl",
  preview: "Native GG Coder session",
  lastActiveDisplay: "2m ago",
  messageCount: 4,
};

const FOREIGN_SESSION: RecentSession = {
  id: "cc-1",
  path: "/Users/dev/.claude/projects/-Users-dev-ui-test/cc-1.jsonl",
  preview: "Build a UI dashboard in HTML",
  lastActiveDisplay: "1w ago",
  messageCount: 44,
  source: "claude-code",
};

/** Render the picker already opened on the project's session list. */
async function renderSessionList(sessions: RecentSession[]): Promise<void> {
  getSettingsMock.mockResolvedValue({ projectsRoot: "/Users/dev", configured: true });
  waitForReadyMock.mockResolvedValue();
  listProjectsMock.mockResolvedValue([PROJECT]);
  listSessionsMock.mockResolvedValue(sessions);
  selectProjectMock.mockResolvedValue();

  render(<ProjectPicker onChosen={vi.fn()} initialProjectPath={PROJECT.path} />);
  await screen.findByText(sessions[0]!.preview);
}

beforeEach(() => setPaired(null));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OTHER_PROJECT: DiscoveredProject = {
  name: "scratch",
  path: "/private/tmp",
  lastActiveDisplay: "1d ago",
  sources: ["ggcoder"],
};

/** Render the picker on the project list (no deep link). */
async function renderProjectList(projects: DiscoveredProject[]): Promise<void> {
  getSettingsMock.mockResolvedValue({ projectsRoot: "/Users/dev", configured: true });
  waitForReadyMock.mockResolvedValue();
  listProjectsMock.mockResolvedValue(projects);

  render(<ProjectPicker onChosen={vi.fn()} />);
  await screen.findByText(projects[0]!.name);
}

describe("ProjectPicker hide", () => {
  it("removes the row and persists the decision", async () => {
    setProjectHiddenMock.mockResolvedValue();
    await renderProjectList([PROJECT, OTHER_PROJECT]);

    fireEvent.click(screen.getByLabelText("Hide scratch"));

    await waitFor(() => expect(screen.queryByText("scratch")).toBeNull());
    expect(setProjectHiddenMock).toHaveBeenCalledWith("/private/tmp", true);
    // The untouched project stays put.
    expect(screen.getByText("ui-test")).toBeTruthy();
  });

  it("restores the row in place when persisting fails", async () => {
    setProjectHiddenMock.mockRejectedValue(new Error("disk full"));
    await renderProjectList([PROJECT, OTHER_PROJECT]);

    fireEvent.click(screen.getByLabelText("Hide ui-test"));

    // Comes back rather than lying about what the next launch will show, and
    // returns to its original position rather than the end of the list.
    await waitFor(() => expect(screen.getByText("ui-test")).toBeTruthy());
    const names = screen.getAllByText(/^(ui-test|scratch)$/).map((n) => n.textContent);
    expect(names).toEqual(["ui-test", "scratch"]);
  });
});

describe("ProjectPicker session list", () => {
  it("badges a Claude Code session with its source", async () => {
    await renderSessionList([NATIVE_SESSION, FOREIGN_SESSION]);

    // The foreign row is labelled; the native one carries no source tag.
    const badge = screen.getByText("Claude Code");
    expect(badge.className).toContain("picker-source-tag");

    const foreignRow = screen.getByText(FOREIGN_SESSION.preview).closest("button");
    expect(foreignRow?.textContent).toContain("Claude Code");
    expect(foreignRow?.getAttribute("title")).toContain("opens as a Kleio session");

    const nativeRow = screen.getByText(NATIVE_SESSION.preview).closest("button");
    expect(nativeRow?.textContent).not.toContain("Claude Code");
    expect(nativeRow?.getAttribute("title")).toBeNull();
  });

  it("imports then opens when a foreign session is clicked", async () => {
    importTranscriptMock.mockResolvedValue({
      ok: true,
      sessionId: "imported-1",
      sessionPath: "/sessions/imported-1.jsonl",
      cwd: PROJECT.path,
      format: "claude",
      messageCount: 44,
      dropped: "nothing",
    });
    await renderSessionList([FOREIGN_SESSION]);

    fireEvent.click(screen.getByText(FOREIGN_SESSION.preview));

    await waitFor(() => {
      // Imported from the foreign transcript...
      expect(importTranscriptMock).toHaveBeenCalledWith(FOREIGN_SESSION.path, PROJECT.path);
      // ...then opened by the NEW session path, not the transcript path.
      expect(selectProjectMock).toHaveBeenCalledWith(PROJECT.path, "/sessions/imported-1.jsonl");
    });
  });

  it("opens a native session directly, with no import", async () => {
    await renderSessionList([NATIVE_SESSION]);

    fireEvent.click(screen.getByText(NATIVE_SESSION.preview));

    await waitFor(() => {
      expect(selectProjectMock).toHaveBeenCalledWith(PROJECT.path, NATIVE_SESSION.path);
    });
    expect(importTranscriptMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed import instead of opening a broken session", async () => {
    importTranscriptMock.mockResolvedValue({ ok: false, error: "Could not read transcript" });
    await renderSessionList([FOREIGN_SESSION]);

    fireEvent.click(screen.getByText(FOREIGN_SESSION.preview));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("Could not read transcript");
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("stays usable after a failed import", async () => {
    importTranscriptMock.mockRejectedValue(new Error("daemon not ready"));
    await renderSessionList([FOREIGN_SESSION]);

    fireEvent.click(screen.getByText(FOREIGN_SESSION.preview));
    await screen.findByRole("alert");

    // `busy` must be released, or every later click is silently ignored.
    const row = screen.getByText(FOREIGN_SESSION.preview).closest("button");
    expect(row?.hasAttribute("disabled")).toBe(false);
  });
});

describe("ProjectPicker open existing", () => {
  it("uses this Mac's folder picker when not paired", async () => {
    openFolderDialogMock.mockResolvedValue("/Users/dev/picked");
    selectProjectMock.mockResolvedValue();
    await renderProjectList([PROJECT]);

    fireEvent.click(screen.getByRole("button", { name: "Open existing" }));

    await waitFor(() =>
      expect(selectProjectMock).toHaveBeenCalledWith("/Users/dev/picked", undefined),
    );
    expect(listHostProjectFoldersMock).not.toHaveBeenCalled();
  });

  it("lists the Mac mini's folders when paired, and opens a hidden one after un-hiding it", async () => {
    setPaired("mac-mini-1.taila6c237.ts.net");
    listHostProjectFoldersMock.mockResolvedValue([
      { name: "test", path: "/Users/willmckie/kleio-projects/test", hidden: true },
      { name: "site", path: "/Users/willmckie/kleio-projects/site", hidden: false },
    ]);
    setProjectHiddenMock.mockResolvedValue();
    selectProjectMock.mockResolvedValue();
    await renderProjectList([PROJECT]);

    fireEvent.click(screen.getByRole("button", { name: "Open existing" }));

    expect(await screen.findByText("Open from mac-mini-1")).toBeDefined();
    expect(openFolderDialogMock).not.toHaveBeenCalled();
    const hiddenGroup = await screen.findByRole("list", { name: "Hidden" });
    const testRow = within(hiddenGroup).getByText("test").closest("button");
    expect(within(screen.getByRole("list", { name: "Projects" })).getByText("site")).toBeDefined();
    expect(within(hiddenGroup).queryByText("site")).toBeNull();

    fireEvent.click(testRow!);

    await waitFor(() =>
      expect(selectProjectMock).toHaveBeenCalledWith(
        "/Users/willmckie/kleio-projects/test",
        undefined,
      ),
    );
    expect(setProjectHiddenMock).toHaveBeenCalledWith(
      "/Users/willmckie/kleio-projects/test",
      false,
    );
    expect(setProjectHiddenMock.mock.invocationCallOrder[0]).toBeLessThan(
      selectProjectMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("opens a visible host folder straight away", async () => {
    setPaired("mac-mini-1.taila6c237.ts.net");
    listHostProjectFoldersMock.mockResolvedValue([
      { name: "site", path: "/Users/willmckie/kleio-projects/site", hidden: false },
    ]);
    selectProjectMock.mockResolvedValue();
    await renderProjectList([PROJECT]);

    fireEvent.click(screen.getByRole("button", { name: "Open existing" }));
    fireEvent.click(await screen.findByText("site"));

    await waitFor(() =>
      expect(selectProjectMock).toHaveBeenCalledWith(
        "/Users/willmckie/kleio-projects/site",
        undefined,
      ),
    );
    expect(setProjectHiddenMock).not.toHaveBeenCalled();
  });

  it("shows why the Mac mini's folders couldn't be listed", async () => {
    setPaired("mac-mini-1.taila6c237.ts.net");
    listHostProjectFoldersMock.mockRejectedValue(
      "Your Mac mini needs a Kleio update before it can list its folders here.",
    );
    await renderProjectList([PROJECT]);

    fireEvent.click(screen.getByRole("button", { name: "Open existing" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Your Mac mini needs a Kleio update before it can list its folders here.",
    );
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("lists the host's folders again after Try again", async () => {
    setPaired("mac-mini-1.taila6c237.ts.net");
    listHostProjectFoldersMock
      .mockRejectedValueOnce("Couldn't reach your Mac mini.")
      .mockResolvedValueOnce([
        { name: "site", path: "/Users/willmckie/kleio-projects/site", hidden: false },
      ]);
    await renderProjectList([PROJECT]);

    fireEvent.click(screen.getByRole("button", { name: "Open existing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("site")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(listHostProjectFoldersMock).toHaveBeenCalledTimes(2);
  });

  it("searches a long folder list, and shows where same-named folders live", async () => {
    setPaired("mac-mini-1.taila6c237.ts.net");
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `app-${i}`,
      path: `/Users/willmckie/kleio-projects/app-${i}`,
      hidden: false,
    }));
    listHostProjectFoldersMock.mockResolvedValue([
      ...many,
      { name: "site", path: "/Users/willmckie/kleio-projects/site", hidden: false },
      { name: "site", path: "/Volumes/Work/site", hidden: false },
    ]);
    await renderProjectList([PROJECT]);

    fireEvent.click(screen.getByRole("button", { name: "Open existing" }));
    // Only a name two folders share needs to say where it lives.
    expect((await screen.findByText("app-0")).closest("button")?.textContent).toBe("app-0");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search folders" }), {
      target: { value: "SITE" },
    });

    const rows = screen.getAllByText("site").map((name) => name.closest("button")?.textContent);
    expect(rows).toEqual(["site~/kleio-projects", "site/Volumes/Work"]);
    expect(screen.queryByText("app-0")).toBeNull();
  });
});

describe("folderPlace", () => {
  it("names a folder's parent, with the home folder as ~", () => {
    expect(folderPlace("/Users/will/kleio-projects/site")).toBe("~/kleio-projects");
    expect(folderPlace("/home/will/code/site/")).toBe("~/code");
    expect(folderPlace("/Users/will/site")).toBe("~");
    expect(folderPlace("/Volumes/Work/site")).toBe("/Volumes/Work");
    expect(folderPlace("/site")).toBe("/");
  });
});
