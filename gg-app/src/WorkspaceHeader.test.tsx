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

// The iPhone draws the desktop's header; kleio-phone.css wraps its two rows.
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
      >
        <button>Back</button>
        <button>Notes</button>
      </WorkspaceHeader>
    );
  }

  it("draws the desktop's title strip: the title with its branch and counts, the host, the toggle", () => {
    const { container } = render(<PhoneHeaderHarness />);

    const strip = Array.from(container.querySelector(".chat-head-strip")?.children ?? []);
    expect(strip.map((el) => el.className || el.textContent)).toEqual([
      "chat-head-title",
      "on mac-mini-1",
      "nav-toggle",
    ]);
    expect(container.querySelector(".chat-head-title")?.textContent).toBe(
      "kleio-website│⎇ main│3 uncommitted│4 issues│1 PR",
    );
    // No title of its own: the name over a line of status is gone.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector(".chat-head-titles, .chat-head-sub")).toBeNull();
  });

  it("keeps Back with the tools, in the row the toggle hides", () => {
    const { container } = render(<PhoneHeaderHarness />);
    const tools = container.querySelector(".chat-head-nav");
    expect(Array.from(tools?.children ?? []).map((el) => el.textContent)).toEqual([
      "Back",
      "Notes",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Hide nav buttons" }));

    expect(container.querySelector(".chat-head-nav")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show nav buttons" })).toBeDefined();
  });

  it("titles a session without a folder with the product's name", () => {
    const { container } = render(
      <WorkspaceHeader workspaceMode="chat" navHidden onToggleNav={() => {}}>
        <button>Brain</button>
      </WorkspaceHeader>,
    );

    expect(container.querySelector(".chat-head-title")?.textContent).toBe("Kleio Chat");
  });
});

describe("a Chat's title", () => {
  function renderChat(sessionTitle?: string, onOpenChats = vi.fn()): ReturnType<typeof vi.fn> {
    render(
      <WorkspaceHeader
        workspaceMode="chat"
        cwd="/work/kleio-projects"
        gitBranch="main"
        navHidden
        onToggleNav={() => {}}
        onOpenChats={onOpenChats}
        sessionTitle={sessionTitle}
      >
        <button>New chat</button>
      </WorkspaceHeader>,
    );
    return onOpenChats;
  }

  it("reads Chats / session title, and Chats opens the browser", () => {
    const onOpenChats = renderChat("Plan my week");

    const identity = screen.getByRole("navigation", { name: "Chat identity" });
    expect(identity.textContent).toBe("Chats/Plan my week");
    expect(screen.getByRole("heading", { name: "Plan my week" })).toBeDefined();
    // In place of the folder and branch, as the mockup draws it.
    expect(screen.queryByText("kleio-projects")).toBeNull();
    expect(screen.queryByText("⎇ main")).toBeNull();

    expect(onOpenChats).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Chats" }));
    expect(onOpenChats).toHaveBeenCalledOnce();
  });

  it("reads Untitled chat for a chat with no title", () => {
    renderChat(undefined);
    expect(screen.getByRole("heading", { name: "Untitled chat" })).toBeDefined();
  });

  it("stays a window drag handle outside the Chats button", () => {
    renderChat("Plan my week");
    expect(screen.getByRole("heading").hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Chats" }).hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
  });

  it("keeps the folder title where no browser is given: Code and Motion", () => {
    render(
      <WorkspaceHeader workspaceMode="code" cwd="/work/app" navHidden onToggleNav={() => {}}>
        <button>New session</button>
      </WorkspaceHeader>,
    );
    expect(screen.getByText("app")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Chats" })).toBeNull();
  });

  it("reads the same on the iPhone", () => {
    document.documentElement.classList.add("platform-ios");
    try {
      const onOpenChats = renderChat("Plan my week");
      expect(screen.getByRole("navigation", { name: "Chat identity" }).textContent).toBe(
        "Chats/Plan my week",
      );
      expect(screen.queryByText("kleio-projects")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Chats" }));
      expect(onOpenChats).toHaveBeenCalledOnce();
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });
});
