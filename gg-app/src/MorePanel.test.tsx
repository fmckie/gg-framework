// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MorePanel, PanelEntryBar } from "./MorePanel";

afterEach(() => {
  cleanup();
});

describe("MorePanel", () => {
  it("holds Checklist alone: no Project Health, which the app has no source for", () => {
    render(<MorePanel id="more-panel" onChecklist={vi.fn()} onClose={vi.fn()} />);
    const panel = screen.getByRole("region", { name: "More" });
    expect(panel.id).toBe("more-panel");
    expect(screen.getByRole("heading", { name: "More" })).toBeDefined();
    const actions = panel.querySelectorAll(".priority-actions button");
    expect([...actions].map((action) => action.textContent)).toEqual(["Checklist"]);
    expect(screen.queryByText("Project Health")).toBeNull();
  });

  it("opens on Checklist, and calls for it when pressed", () => {
    const onChecklist = vi.fn();
    const onClose = vi.fn();
    render(<MorePanel id="more-panel" onChecklist={onChecklist} onClose={onClose} />);
    const checklist = screen.getByRole("button", { name: "Checklist" });
    expect(document.activeElement).toBe(checklist);
    fireEvent.click(checklist);
    expect(onChecklist).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and on its close button, and on no other key", () => {
    const onClose = vi.fn();
    render(<MorePanel id="more-panel" onChecklist={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close More panel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("PanelEntryBar", () => {
  it("is one trigger, More, with no Branch until Branch has a panel", () => {
    const onToggleMore = vi.fn();
    render(<PanelEntryBar moreOpen={false} morePanelId="more-panel" onToggleMore={onToggleMore} />);
    const row = screen.getByRole("navigation", { name: "Composer panel entries" });
    const more = screen.getByRole("button", { name: "More" });
    expect([...row.querySelectorAll("button")]).toEqual([more]);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(more);
    expect(onToggleMore).toHaveBeenCalledTimes(1);
  });

  it("points at the panel while it is open", () => {
    render(<PanelEntryBar moreOpen morePanelId="more-panel" onToggleMore={vi.fn()} />);
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.getAttribute("aria-controls")).toBe("more-panel");
  });
});

describe("PanelEntryBar with a branch", () => {
  it("adds Branch after More, named for the branch", () => {
    const onToggleBranch = vi.fn();
    render(
      <PanelEntryBar
        moreOpen={false}
        morePanelId="more-panel"
        onToggleMore={vi.fn()}
        branchName="phase3/generate-recipe"
        branchPanelId="branch-panel"
        onToggleBranch={onToggleBranch}
      />,
    );
    const row = screen.getByRole("navigation", { name: "Composer panel entries" });
    const trigger = screen.getByRole("button", { name: "Branch phase3/generate-recipe" });
    expect([...row.querySelectorAll("button")]).toEqual([
      screen.getByRole("button", { name: "More" }),
      trigger,
    ]);
    expect(trigger.textContent).toBe("⑂ phase3/generate-recipe");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(trigger);
    expect(onToggleBranch).toHaveBeenCalledTimes(1);
  });

  it("points at Branch's panel while it is open, and More's stays shut", () => {
    render(
      <PanelEntryBar
        moreOpen={false}
        morePanelId="more-panel"
        onToggleMore={vi.fn()}
        branchName="phase3/generate-recipe"
        branchOpen
        branchPanelId="branch-panel"
        onToggleBranch={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Branch phase3/generate-recipe" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe("branch-panel");
    expect(screen.getByRole("button", { name: "More" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});
