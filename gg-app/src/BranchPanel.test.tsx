// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BranchPanel } from "./BranchPanel";

afterEach(() => {
  cleanup();
});

const REPO = "https://github.com/acme/cookbook";

type Props = React.ComponentProps<typeof BranchPanel>;

function show(over: Partial<Omit<Props, "onOpen" | "onClose">> = {}) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const { container } = render(
    <BranchPanel
      id="branch-panel"
      branch="phase3/generate-recipe"
      uncommitted={3}
      pullRequests={7}
      issues={1}
      repoUrl={REPO}
      {...over}
      onOpen={onOpen}
      onClose={onClose}
    />,
  );
  return { onOpen, onClose, container };
}

const entries = (): (string | null)[] =>
  [...screen.getByRole("navigation", { name: "Branch views" }).querySelectorAll("button")].map(
    (entry) => entry.textContent,
  );

describe("BranchPanel", () => {
  it("is headed by the branch and holds Pull requests, Issues and Open on GitHub: no Changes, which the app has no list for", () => {
    const { container } = show();
    const panel = screen.getByRole("region", { name: "Branch" });
    expect(panel.id).toBe("branch-panel");
    expect(screen.getByRole("heading", { name: "phase3/generate-recipe" })).toBeDefined();
    expect(entries()).toEqual(["Pull requests 7", "Issues 1", "Open on GitHub"]);
    expect(screen.queryByText(/Changes/)).toBeNull();
    expect(container.querySelector("li, .change-scroll, .change-list")).toBeNull();
  });

  it("counts the uncommitted files beside the branch, and says nothing at none", () => {
    show({ uncommitted: 1 });
    expect(screen.getByText("1 uncommitted file")).toBeDefined();
    cleanup();
    show({ uncommitted: 18 });
    expect(screen.getByText("18 uncommitted files")).toBeDefined();
    cleanup();
    show({ uncommitted: 0 });
    expect(screen.queryByText(/uncommitted/)).toBeNull();
  });

  it("leaves out an entry the app has no count for, and keeps a count of none", () => {
    show({ pullRequests: null, issues: 0 });
    expect(entries()).toEqual(["Issues 0", "Open on GitHub"]);
    cleanup();
    show({ pullRequests: null, issues: null });
    expect(entries()).toEqual(["Open on GitHub"]);
  });

  it("opens the repository, its pull requests and its issues on GitHub, and stays open", () => {
    const { onOpen, onClose } = show();
    fireEvent.click(screen.getByRole("button", { name: "Pull requests 7" }));
    fireEvent.click(screen.getByRole("button", { name: "Issues 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Open on GitHub" }));
    expect(onOpen.mock.calls).toEqual([[`${REPO}/pulls`], [`${REPO}/issues`], [REPO]]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens on its first entry, and closes on Escape and on its close button, and on no other key", () => {
    const { onClose } = show();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pull requests 7" }));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close Branch panel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
