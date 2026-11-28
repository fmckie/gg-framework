// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  createGoal,
  deleteGoal,
  listGoals,
  selectProject,
  waitForReady,
  type GoalSummary,
} from "../agent";
import { GoalList, contextSummary } from "./GoalList";
import themeCss from "../kleio/kleio-theme.css?raw";

vi.mock("../agent", () => ({
  createGoal: vi.fn(),
  deleteGoal: vi.fn(),
  listGoals: vi.fn(),
  selectProject: vi.fn(),
  waitForReady: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../RadioButton", () => ({ RadioButton: () => <button>Radio</button> }));
vi.mock("../WindowLayoutButton", () => ({
  WindowLayoutButton: () => <button>Windows</button>,
}));

const listGoalsMock = vi.mocked(listGoals);
const createGoalMock = vi.mocked(createGoal);
const selectProjectMock = vi.mocked(selectProject);
const openDialogMock = vi.mocked(openDialog);

const GOAL: GoalSummary = {
  id: "api-latency",
  name: "API latency",
  goal: "Bring p95 latency under 200 ms across the whole API",
  context: [
    { path: "/repos/api", kind: "folder" },
    { path: "/repos/web", kind: "folder" },
    { path: "/docs/spec.md", kind: "file" },
  ],
  path: "/Users/dev/agent/goals/api-latency",
  createdAt: "2026-10-10T12:00:00.000Z",
  lastActiveMs: 1,
  lastActiveDisplay: "2m ago",
  latestSessionPath: "/sessions/goal-1.jsonl",
};

function renderList(goals: GoalSummary[]): { onChosen: ReturnType<typeof vi.fn> } {
  vi.mocked(waitForReady).mockResolvedValue();
  listGoalsMock.mockResolvedValue(goals);
  selectProjectMock.mockResolvedValue();
  const onChosen = vi.fn();
  render(<GoalList onChosen={onChosen} onClose={vi.fn()} />);
  return { onChosen };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GoalList", () => {
  it("lists goals with their total, objective and context, and resumes the latest session", async () => {
    const { onChosen } = renderList([GOAL]);

    const row = (await screen.findByText("API latency")).closest("button");
    expect(screen.getByRole("heading", { name: "Goals 1" }).textContent).toBe("Goals 1");
    // A row: the name and its age, the objective, then what is attached.
    expect(Array.from(row?.children ?? [], (cell) => cell.textContent)).toEqual([
      "API latency",
      "2m ago",
      GOAL.goal,
      "2 folders · 1 file",
    ]);
    expect(screen.getByRole("searchbox", { name: "Search goals" })).toBeDefined();
    expect(screen.getByRole("button", { name: "+ New goal" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Back" })).toBeDefined();

    fireEvent.click(row as HTMLElement);

    await waitFor(() => expect(onChosen).toHaveBeenCalledWith(GOAL.path));
    expect(selectProjectMock).toHaveBeenCalledWith(GOAL.path, GOAL.latestSessionPath);
  });

  it("deletes a goal after confirming, and keeps it when deleting fails", async () => {
    renderList([GOAL]);
    await screen.findByText("API latency");
    vi.mocked(deleteGoal).mockRejectedValueOnce(new Error("This goal is open in another window."));

    fireEvent.click(screen.getByRole("button", { name: "Delete API latency" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete goal" }));

    expect(await screen.findByText("This goal is open in another window.")).toBeDefined();
    expect(screen.getByText("API latency")).toBeDefined();

    vi.mocked(deleteGoal).mockResolvedValueOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete API latency" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete goal" });
    expect(confirm.textContent).toContain("attached folders and files are not touched");
    // On the row it is about, in place of the row's delete control.
    expect(confirm.closest("li")?.textContent).toContain("API latency");
    expect(screen.queryByRole("button", { name: "Delete API latency" })).toBeNull();
    // Cancel takes focus: the safe answer is the default.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete goal" }));

    await waitFor(() => expect(screen.queryByText("API latency")).toBeNull());
    expect(deleteGoal).toHaveBeenLastCalledWith("api-latency");
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("shows which goals are running now or paused, and keeps that current", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderList([
        { ...GOAL, id: "a", name: "Working", path: "/g/a", status: "running" },
        { ...GOAL, id: "b", name: "Held", path: "/g/b", status: "paused" },
        { ...GOAL, id: "c", name: "Fresh", path: "/g/c", status: "briefing" },
        { ...GOAL, id: "d", name: "Cut off", path: "/g/d", status: "interrupted" },
      ]);
      expect(await screen.findByText("Running now")).toBeDefined();
      expect(screen.getByText("Paused")).toBeDefined();
      // Cut off mid-work (the app closed, or it was stopped): marked as such.
      expect(screen.getByText("Interrupted")).toBeDefined();
      // A goal not yet started, or finished, carries no label.
      expect(screen.getAllByText(/Running now|Paused|Interrupted/)).toHaveLength(3);

      // It finishes while the list is open: the label goes on the next refresh.
      listGoalsMock.mockResolvedValue([
        { ...GOAL, id: "a", name: "Working", path: "/g/a", status: "idle" },
      ]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100);
      });
      await waitFor(() => expect(screen.queryByText("Running now")).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters goals by name or objective", async () => {
    renderList([GOAL, { ...GOAL, id: "b", path: "/g/b", name: "Docs", goal: "Rewrite docs" }]);
    await screen.findByText("Docs");

    const search = screen.getByRole("searchbox", { name: "Search goals" });
    fireEvent.change(search, { target: { value: "p95" } });

    expect(screen.queryByText("Docs")).toBeNull();
    expect(screen.getByText("API latency")).toBeDefined();
    // The count is the list's, not the search's.
    expect(screen.getByRole("heading").textContent).toBe("Goals 2");

    fireEvent.change(search, { target: { value: "taxes" } });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("No goals match “taxes”");
  });

  it("drops an open delete confirm when the search changes", async () => {
    renderList([GOAL]);
    await screen.findByText("API latency");
    fireEvent.click(screen.getByRole("button", { name: "Delete API latency" }));
    expect(screen.getByRole("alertdialog")).toBeDefined();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "API" } });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete API latency" })).toBeDefined();
  });

  it("offers a new goal when there are none, and shows a retry when listing fails", async () => {
    renderList([]);
    expect(await screen.findByText(/No goals yet/)).toBeDefined();
    // In the heading and under the empty list's line.
    expect(screen.getAllByRole("button", { name: "+ New goal" })).toHaveLength(2);
    expect(screen.queryByRole("searchbox")).toBeNull();
    cleanup();

    vi.mocked(waitForReady).mockResolvedValue();
    listGoalsMock.mockRejectedValueOnce(new Error("down"));
    render(<GoalList onChosen={vi.fn()} />);
    expect(await screen.findByText("Couldn't load your goals.")).toBeDefined();
    listGoalsMock.mockResolvedValueOnce([GOAL]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("API latency")).toBeDefined();
  });

  it("creates a goal with its context and opens it", async () => {
    const { onChosen } = renderList([]);
    await screen.findByText(/No goals yet/);
    const created: GoalSummary = { ...GOAL, latestSessionPath: null };
    createGoalMock.mockResolvedValue(created);
    openDialogMock.mockResolvedValue(["/repos/api"]);

    fireEvent.click(screen.getAllByRole("button", { name: "+ New goal" })[0] as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: "New goal" });
    const create = screen.getByRole("button", { name: "Create goal" });
    expect(dialog.contains(create)).toBe(true);
    expect((create as HTMLButtonElement).disabled).toBe(true);
    // Typing starts in the name, not on the dialog's close button.
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    expect(
      screen.getByPlaceholderText("Get checkout loading under one second on mobile"),
    ).toBeDefined();

    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.maxLength).toBe(15);
    fireEvent.change(name, { target: { value: "API latency" } });
    expect(screen.getByText("11/15")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: GOAL.goal } });
    fireEvent.click(screen.getByRole("button", { name: "Add folders" }));
    expect(await screen.findByText("api")).toBeDefined();
    expect(openDialogMock).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    // Every attached item can be removed, and the count shows against the limit.
    openDialogMock.mockResolvedValue(["/specs/a.pdf", "/specs/b.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Add files" }));
    expect(await screen.findByText("b.pdf")).toBeDefined();
    expect(screen.getByText("(3 of 20)")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove a.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove b.pdf" }));
    expect(screen.queryByText("a.pdf")).toBeNull();
    expect(screen.getByText("(1 of 20)")).toBeDefined();
    // Standing instructions, optional: rules for the whole goal.
    fireEvent.change(screen.getByLabelText(/Instructions/), {
      target: { value: "  Don't touch CI.  " },
    });

    fireEvent.click(create);

    await waitFor(() => expect(onChosen).toHaveBeenCalledWith(created.path));
    expect(createGoalMock).toHaveBeenCalledWith({
      name: "API latency",
      goal: GOAL.goal,
      context: ["/repos/api"],
      instructions: "Don't touch CI.",
    });
    expect(selectProjectMock).toHaveBeenCalledWith(created.path);
  });

  it("keeps the form open with the sidecar's reason when creating fails", async () => {
    renderList([]);
    await screen.findByText(/No goals yet/);
    createGoalMock.mockRejectedValue(new Error("Not found: /gone"));

    fireEvent.click(screen.getAllByRole("button", { name: "+ New goal" })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Not found: /gone")).toBeDefined();
    expect(selectProjectMock).not.toHaveBeenCalled();
  });
});

describe("the New goal dialog", () => {
  async function open(): Promise<HTMLElement> {
    renderList([GOAL]);
    await screen.findByText("API latency");
    fireEvent.click(screen.getByRole("button", { name: "+ New goal" }));
    return screen.getByRole("dialog", { name: "New goal" });
  }

  it("closes on Escape, Cancel and its close button, and creates nothing", async () => {
    await open();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ New goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ New goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createGoalMock).not.toHaveBeenCalled();
    // The list is still there behind it.
    expect(screen.getByText("API latency")).toBeDefined();
  });

  it("marks the label rows and their asides for the form's grid", async () => {
    const dialog = await open();
    const form = dialog.querySelector("form");

    expect(form?.className).toBe("goal-form");
    expect(
      Array.from(form?.querySelectorAll(":scope > .goal-form-split") ?? [], (el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(["Name", "Context (optional)"]);
    expect(
      Array.from(form?.querySelectorAll(":scope > .goal-form-aside") ?? [], (el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(["0/15", "Add folders Add files"]);
  });
});

describe("the Goals browser, with the real theme loaded", () => {
  const gutter = (element: Element | null): string =>
    element ? getComputedStyle(element).getPropertyValue("--kleio-gutter").trim() : "missing";

  afterEach(() => {
    for (const style of document.head.querySelectorAll("style")) style.remove();
  });

  it("takes the Chats browser's column for its heading and its list", async () => {
    const style = document.createElement("style");
    style.textContent = themeCss;
    document.head.append(style);
    vi.mocked(waitForReady).mockResolvedValue();
    listGoalsMock.mockResolvedValue([GOAL]);
    const { container } = render(
      <>
        <div className="app">
          <GoalList onChosen={vi.fn()} />
        </div>
        <div className="app app-session">
          <div className="inputwrap" />
        </div>
      </>,
    );
    await screen.findByText("API latency");

    const sessionGutter = gutter(container.querySelector(".app-session > .inputwrap"));
    expect(sessionGutter).toMatch(/^max\(28px,/);
    expect(gutter(container.querySelector(".goal-browser > .chat-browser-heading"))).toBe(
      sessionGutter,
    );
    expect(gutter(container.querySelector(".goal-browser > .picker-list"))).toBe(sessionGutter);
  });
});

describe("GoalList on the iPhone", () => {
  it("is the desktop's browser, and New goal is its dialog", async () => {
    document.documentElement.classList.add("platform-ios");
    try {
      renderList([GOAL]);

      expect((await screen.findByRole("heading", { name: /Goals/ })).textContent).toBe("Goals 1");
      expect(document.querySelector(".goal-browser")).not.toBeNull();
      expect(document.querySelector(".placeholder-goals, .placeholder-list")).toBeNull();
      expect(screen.getByRole("searchbox", { name: "Search goals" })).toBeDefined();
      expect(screen.getByText(/2 folders · 1 file/)).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: "+ New goal" }));
      const dialog = screen.getByRole("dialog", { name: "New goal" });
      expect(dialog.classList.contains("goal-form-modal")).toBe(true);
      expect(screen.getByRole("form", { name: "New goal" }).className).toBe("goal-form");
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });
});

describe("contextSummary", () => {
  it("is null with no context and pluralises counts", () => {
    expect(contextSummary({ ...GOAL, context: [] })).toBeNull();
    expect(contextSummary({ ...GOAL, context: [{ path: "/a", kind: "file" }] })).toBe("1 file");
  });
});
