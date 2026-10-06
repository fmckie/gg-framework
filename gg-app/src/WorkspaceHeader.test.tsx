// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// WorkspaceHeader imports agent.ts (openUrl), which reads the current webview
// window at module load — stub it for jsdom.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    setTitle: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { WorkspaceHeader } from "./WorkspaceHeader";
import { formatWorkspaceTitle } from "./workspace-title";

afterEach(cleanup);

function ChatHeaderHarness(): React.ReactElement {
  const [navHidden, setNavHidden] = useState(false);

  return (
    <WorkspaceHeader
      workspaceMode="chat"
      navHidden={navHidden}
      onToggleNav={() => setNavHidden((hidden) => !hidden)}
    >
      <button>New chat</button>
    </WorkspaceHeader>
  );
}

describe("WorkspaceHeader", () => {
  it("renders the chevron in chat mode and toggles the navbar", () => {
    render(<ChatHeaderHarness />);

    expect(screen.getByText("Kleio Chat")).toBeDefined();
    expect(screen.getByRole("button", { name: "New chat" })).toBeDefined();

    const hideToggle = screen.getByRole("button", { name: "Hide nav buttons" });
    expect(hideToggle.getAttribute("aria-expanded")).toBe("true");
    expect(hideToggle.querySelector("polyline")?.getAttribute("points")).toBe("6 15 12 9 18 15");
    fireEvent.click(hideToggle);

    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    const showToggle = screen.getByRole("button", { name: "Show nav buttons" });
    expect(showToggle.getAttribute("aria-expanded")).toBe("false");
    expect(showToggle.querySelector("polyline")?.getAttribute("points")).toBe("6 9 12 15 18 9");
    fireEvent.click(showToggle);

    expect(screen.getByRole("button", { name: "New chat" })).toBeDefined();
  });

  it("formats clean, dirty, and pre-commit project context", () => {
    expect(formatWorkspaceTitle("/work/app", "main", "GG Coder")).toBe("app │ ⎇ main");
    expect(formatWorkspaceTitle("/work/app", "main", "GG Coder", 3)).toBe(
      "app │ ⎇ main │ 3 uncommitted",
    );
    expect(formatWorkspaceTitle("/work/app", null, "GG Coder", 1)).toBe("app │ 1 uncommitted");
  });

  it("shows GitHub issue/PR counts and appends them to the window title", () => {
    expect(formatWorkspaceTitle("/work/app", "main", "GG Coder", 0, 4, 1)).toBe(
      "app │ ⎇ main │ 4 issues │ 1 PR",
    );

    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/gg-coder"
        gitBranch="main"
        gitHubIssues={4}
        gitHubPRs={1}
        gitHubRepoUrl="https://github.com/kenkaiiii/gg-coder"
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    expect(screen.getByRole("button", { name: "4 issues" })).toBeDefined();
    expect(screen.getByRole("button", { name: "1 PR" })).toBeDefined();
  });

  it("shows an added-roots badge and appends it to the window title", () => {
    expect(
      formatWorkspaceTitle("/work/app", "main", "GG Coder", 0, null, null, ["/work/sdk"]),
    ).toBe("app │ +1 root │ ⎇ main");

    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/gg-coder"
        gitBranch="main"
        additionalRoots={["/work/sdk", "/work/docs"]}
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    expect(screen.getByText("+2 roots")).toBeDefined();
  });

  it("hides the GitHub chips when the counts are unknown", () => {
    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/gg-coder"
        gitBranch="main"
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    expect(screen.queryByText(/issues?$/)).toBeNull();
    expect(screen.queryByText(/PRs?$/)).toBeNull();
  });

  it("hides a zero-count chip but keeps a non-zero one", () => {
    // 3 open issues, 0 open PRs → issues chip shows, PR chip is hidden.
    expect(formatWorkspaceTitle("/work/app", "main", "GG Coder", 0, 3, 0)).toBe(
      "app │ ⎇ main │ 3 issues",
    );

    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/gg-coder"
        gitBranch="main"
        gitHubIssues={3}
        gitHubPRs={0}
        gitHubRepoUrl="https://github.com/kenkaiiii/gg-coder"
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    expect(screen.getByRole("button", { name: "3 issues" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /PRs?$/ })).toBeNull();
  });

  it("makes the folder a click-to-open-location button and the branch a repo link", () => {
    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/gg-coder"
        gitBranch="main"
        gitHubRepoUrl="https://github.com/kenkaiiii/gg-coder"
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    const folder = screen.getByRole("button", { name: "gg-coder" });
    expect(folder.getAttribute("title")).toBe("/work/gg-coder — open folder");

    const branch = screen.getByRole("button", { name: "⎇ main" });
    expect(branch.getAttribute("title")).toContain("github.com/kenkaiiii/gg-coder");
  });

  it("leaves the branch as static text when there is no GitHub repo URL", () => {
    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/gg-coder"
        gitBranch="main"
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    expect(screen.queryByRole("button", { name: "⎇ main" })).toBeNull();
    expect(screen.getByText("⎇ main")).toBeDefined();
  });

  it("shows the current directory, branch, and dirty count instead of a session title", () => {
    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="C:\\work\\gg-coder"
        gitBranch="feature/titlebar"
        gitDirtyFileCount={3}
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    expect(screen.getByText("gg-coder")).toBeDefined();
    expect(screen.getByText("⎇ feature/titlebar")).toBeDefined();
    expect(screen.getByTitle("3 files not committed").textContent).toBe("3 uncommitted");
    expect(screen.getByTitle("gg-coder │ ⎇ feature/titlebar │ 3 uncommitted")).toBeDefined();
    expect(screen.queryByText("GG Coder")).toBeNull();
  });

  it("keeps the uncommitted count apart from its word so narrow windows can drop just the word", () => {
    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/app"
        gitDirtyFileCount={12}
        navHidden
        onToggleNav={() => {}}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    const chip = screen.getByTitle("12 files not committed");
    const word = screen.getByText("uncommitted");

    expect(chip.contains(word)).toBe(true);
    expect(chip.textContent).toBe("12 uncommitted");
    // Tauri starts a window drag only from the element carrying the attribute,
    // so without its own the word would stop working as a drag handle.
    expect(word.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("keeps the connection pill beside the title on the desktop", () => {
    render(
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/app"
        navHidden
        onToggleNav={() => {}}
        connection={<button>on mac-mini-1</button>}
      >
        <button>New session</button>
      </WorkspaceHeader>,
    );

    const connection = screen.getByRole("button", { name: "on mac-mini-1" });
    expect(connection.previousElementSibling?.className).toBe("chat-head-title");
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("WorkspaceHeader on the iPhone", () => {
  beforeEach(() => document.documentElement.classList.add("platform-ios"));
  afterEach(() => document.documentElement.classList.remove("platform-ios"));

  function PhoneHeaderHarness(): React.ReactElement {
    const [navHidden, setNavHidden] = useState(false);

    return (
      <WorkspaceHeader
        workspaceMode="code"
        cwd="/work/kleio-website"
        gitBranch="main"
        gitDirtyFileCount={3}
        gitHubIssues={4}
        gitHubPRs={1}
        gitHubRepoUrl="https://github.com/demo/kleio-website"
        navHidden={navHidden}
        onToggleNav={() => setNavHidden((hidden) => !hidden)}
        connection={<button>on mac-mini-1</button>}
        leading={<button>Back</button>}
        trailing={<button>New</button>}
      >
        <button>Notes</button>
      </WorkspaceHeader>
    );
  }

  it("puts back, the name and New on the top row, with the status under the name", () => {
    const { container } = render(<PhoneHeaderHarness />);

    const topRow = Array.from(container.querySelector(".chat-head-strip")?.children ?? []);
    expect(topRow.map((el) => el.textContent || el.getAttribute("aria-label"))).toEqual([
      "Back",
      "kleio-websiteon mac-mini-1│4 issues│1 PR",
      "New",
      "Hide nav buttons",
    ]);
    expect(screen.getByRole("heading", { level: 1, name: "kleio-website" })).toBeDefined();
    expect(container.querySelector(".chat-head-sub")?.textContent).toBe(
      "on mac-mini-1│4 issues│1 PR",
    );
    // The branch and the uncommitted count stay off, as in a narrow window.
    expect(screen.queryByText("⎇ main")).toBeNull();
    expect(screen.queryByText("uncommitted")).toBeNull();
  });

  it("keeps back and New when the tools row is hidden", () => {
    render(<PhoneHeaderHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Hide nav buttons" }));

    expect(screen.queryByRole("button", { name: "Notes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeDefined();
    expect(screen.getByRole("button", { name: "New" })).toBeDefined();
  });

  it("drops the tools row and its toggle when the top row holds every control", () => {
    render(
      <WorkspaceHeader
        workspaceMode="chat"
        cwd="/work/kleio-projects"
        navHidden={false}
        onToggleNav={() => {}}
        trailing={<button>Brain</button>}
        tools={false}
      >
        <button>Window layout</button>
      </WorkspaceHeader>,
    );

    expect(screen.getByRole("button", { name: "Brain" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Hide nav buttons" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Window layout" })).toBeNull();
  });

  it("titles a session without a folder with the product's name", () => {
    render(
      <WorkspaceHeader workspaceMode="chat" navHidden onToggleNav={() => {}}>
        <button>Brain</button>
      </WorkspaceHeader>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Kleio Chat" })).toBeDefined();
  });
});
