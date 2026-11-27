// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  arrangeAllWindows,
  deleteChat,
  focusWindowByOffset,
  getSettings,
  listSessions,
  restoreTarget,
  selectWorkspace,
  waitForReady,
  type RecentSession,
} from "./agent";
import { ChatPicker } from "./ChatPicker";
import themeCss from "./kleio/kleio-theme.css?raw";
import chromeCss from "./kleio/kleio-chrome.css?raw";

vi.mock("./agent", () => ({
  arrangeAllWindows: vi.fn(),
  deleteChat: vi.fn(),
  focusWindowByOffset: vi.fn(),
  getSettings: vi.fn(),
  listSessions: vi.fn(),
  restoreTarget: vi.fn(),
  selectWorkspace: vi.fn(),
  waitForReady: vi.fn(),
}));
vi.mock("./RadioButton", () => ({ RadioButton: () => <button>Radio</button> }));
vi.mock("./WindowLayoutButton", () => ({
  WindowLayoutButton: () => <button>Windows</button>,
}));

const deleteChatMock = vi.mocked(deleteChat);
const getSettingsMock = vi.mocked(getSettings);
const listSessionsMock = vi.mocked(listSessions);
const restoreTargetMock = vi.mocked(restoreTarget);
const selectWorkspaceMock = vi.mocked(selectWorkspace);
const waitForReadyMock = vi.mocked(waitForReady);

const session: RecentSession = {
  id: "chat-1",
  path: "/sessions/chat-1.jsonl",
  preview: "Plan my week",
  lastActiveDisplay: "2m ago",
  messageCount: 4,
  chatAgent: "therapist",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatPicker", () => {
  it("loads sessions from projectsRoot and resumes them in chat mode", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([session]);
    selectWorkspaceMock.mockResolvedValue();
    const onChosen = vi.fn();

    render(<ChatPicker onChosen={onChosen} />);

    expect(await screen.findByText("Plan my week")).toBeDefined();
    expect(waitForReadyMock).toHaveBeenCalledOnce();
    expect(listSessionsMock).toHaveBeenCalledWith("/workspaces", "all");

    fireEvent.click(screen.getByText("Plan my week"));
    await waitFor(() => {
      expect(selectWorkspaceMock).toHaveBeenCalledWith(
        "chat",
        "/workspaces",
        "/sessions/chat-1.jsonl",
        "therapist",
      );
      expect(onChosen).toHaveBeenCalledWith("/workspaces");
    });
  });

  it("leaves window shortcuts to App's one listener, so a press acts once", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([session]);
    render(<ChatPicker onChosen={vi.fn()} />);
    await screen.findByText(session.preview);
    fireEvent.keyDown(window, { key: "`", code: "Backquote", metaKey: true });
    fireEvent.keyDown(window, { key: "A", code: "KeyA", metaKey: true, shiftKey: true });
    expect(focusWindowByOffset).not.toHaveBeenCalled();
    expect(arrangeAllWindows).not.toHaveBeenCalled();
  });

  it("starts a new chat without a resume path", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([]);
    selectWorkspaceMock.mockResolvedValue();

    render(<ChatPicker onChosen={vi.fn()} />);

    const newChatButtons = await screen.findAllByRole("button", { name: "+ New chat" });
    fireEvent.click(newChatButtons[0]);
    await waitFor(() => {
      expect(selectWorkspaceMock).toHaveBeenCalledWith("chat", "/workspaces", undefined, "general");
    });
  });

  it("starts a new chat with the initially active agent", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([]);
    selectWorkspaceMock.mockResolvedValue();

    render(<ChatPicker onChosen={vi.fn()} initialAgent="research" />);
    const newChatButtons = await screen.findAllByRole("button", { name: "+ New chat" });
    fireEvent.click(newChatButtons[0]);

    await waitFor(() => {
      expect(listSessionsMock).toHaveBeenCalledWith("/workspaces", "all");
      expect(selectWorkspaceMock).toHaveBeenCalledWith(
        "chat",
        "/workspaces",
        undefined,
        "research",
      );
    });
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("opens Motion in its own folder and lists only Motion sessions", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces/", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([]);
    selectWorkspaceMock.mockResolvedValue();
    const onChosen = vi.fn();

    render(<ChatPicker mode="motion" onChosen={onChosen} />);

    expect(await screen.findByText("No motion sessions yet.")).toBeDefined();
    expect(listSessionsMock).toHaveBeenCalledWith("/workspaces/GG Motion", "motion");
    fireEvent.click(screen.getAllByRole("button", { name: "+ New video" })[0]);
    await waitFor(() => {
      expect(selectWorkspaceMock).toHaveBeenCalledWith(
        "motion",
        "/workspaces/GG Motion",
        undefined,
        "general",
      );
      expect(onChosen).toHaveBeenCalledWith("/workspaces/GG Motion");
    });
  });

  it("shows a clear prerequisite error when projectsRoot is unavailable", async () => {
    getSettingsMock.mockResolvedValue(null);

    render(<ChatPicker onChosen={vi.fn()} />);

    expect(
      await screen.findByText("Choose a projects folder in Settings before starting a chat."),
    ).toBeDefined();
    expect(waitForReadyMock).not.toHaveBeenCalled();
    expect(selectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("deletes a chat after X then Delete, without opening it", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([session]);
    deleteChatMock.mockResolvedValue({ ok: true });

    render(<ChatPicker onChosen={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove chat: Plan my week" }));
    expect(deleteChatMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete chat permanently: Plan my week" }));

    await waitFor(() => expect(screen.queryByText("Plan my week")).toBeNull());
    expect(deleteChatMock).toHaveBeenCalledWith("/sessions/chat-1.jsonl");
    expect(selectWorkspaceMock).not.toHaveBeenCalled();
    expect(screen.getByText("0")).toBeDefined();
  });

  it("deletes when Delete is pressed in WebKit, which blurs a pressed button", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([session]);
    deleteChatMock.mockResolvedValue({ ok: true });

    render(<ChatPicker onChosen={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove chat: Plan my week" }));
    const confirm = screen.getByRole("button", { name: "Delete chat permanently: Plan my week" });
    // As WebKit does: mousedown clears focus, blurring the button, unless prevented.
    if (fireEvent.mouseDown(confirm)) fireEvent.blur(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteChatMock).toHaveBeenCalledWith("/sessions/chat-1.jsonl"));
  });

  it("keeps the row and shows the error when deleting fails", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([session]);
    deleteChatMock.mockResolvedValue({
      ok: false,
      error: "This chat is open in a window. Close it there first.",
    });

    render(<ChatPicker onChosen={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove chat: Plan my week" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete chat permanently: Plan my week" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This chat is open in a window. Close it there first.",
    );
    expect(screen.getByText("Plan my week")).toBeDefined();
  });

  it("cancels the confirm with Escape", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([session]);

    render(<ChatPicker onChosen={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove chat: Plan my week" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Delete chat permanently: Plan my week" }),
      {
        key: "Escape",
      },
    );
    expect(screen.getByRole("button", { name: "Remove chat: Plan my week" })).toBeDefined();
    expect(deleteChatMock).not.toHaveBeenCalled();
  });

  it("shows no delete control in Motion mode", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([session]);

    render(<ChatPicker mode="motion" onChosen={vi.fn()} />);

    expect(await screen.findByText("Plan my week")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Remove chat/ })).toBeNull();
  });

  it("titles an image-only chat Image, not the saved file's path", async () => {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue([
      {
        ...session,
        preview: "[Image saved at /workspaces/.gg/uploads/mhj2k3l0-Screenshot_2026-11-03_at_10.15",
      },
    ]);

    render(<ChatPicker onChosen={vi.fn()} />);

    expect(await screen.findByText("Image")).toBeDefined();
    expect(screen.queryByText(/Image saved at/)).toBeNull();
  });
});

describe("the Chats browser", () => {
  const other: RecentSession = {
    id: "chat-2",
    path: "/sessions/chat-2.jsonl",
    preview: "Prepare for lunch at Lord's",
    lastActiveDisplay: "3d ago",
    messageCount: 16,
  };

  function ready(sessions: RecentSession[]): void {
    getSettingsMock.mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    waitForReadyMock.mockResolvedValue();
    listSessionsMock.mockResolvedValue(sessions);
  }

  it("draws a row's delete, its confirm and the empty list's button flat", async () => {
    const browser = "html:not(.platform-ios) .chat-browser";
    ready([other]);
    const view = render(<ChatPicker onChosen={vi.fn()} />);
    const remove = await screen.findByRole("button", { name: /^Remove chat: / });
    expect(remove.matches(`${browser} .picker-hide`)).toBe(true);
    fireEvent.click(remove);
    const confirm = screen.getByRole("button", { name: /^Delete chat permanently: / });
    expect(confirm.matches(`${browser} .picker-hide.picker-delete-confirm`)).toBe(true);
    expect(chromeCss).toContain(
      `${browser} .picker-hide {\n  border-radius: 3px;\n  background: none;\n  box-shadow: none;`,
    );
    view.unmount();

    ready([]);
    render(<ChatPicker onChosen={vi.fn()} />);
    await screen.findByText("No previous chats yet.");
    const empty = document.querySelector(".picker-empty .btn");
    expect(
      empty?.matches(
        "html:not(.platform-ios) :is(.chat-browser, .project-picker) .picker-empty .btn",
      ),
    ).toBe(true);
  });

  it("heads the list with the count, and a row with its title, age and message count", async () => {
    ready([session, other]);
    render(<ChatPicker onChosen={vi.fn()} />);

    const row = (await screen.findByText("Plan my week")).closest("button");
    expect(screen.getByRole("heading", { name: "Chats 2" }).textContent).toBe("Chats 2");
    expect(screen.getByRole("button", { name: "+ New chat" })).toBeDefined();
    expect(Array.from(row?.children ?? [], (cell) => cell.textContent)).toEqual([
      "Plan my week",
      "2m ago",
      "4 msgs",
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("filters the list by title as you type, and says so when nothing matches", async () => {
    ready([session, other]);
    render(<ChatPicker onChosen={vi.fn()} />);
    await screen.findByText("Plan my week");
    const search = screen.getByRole("searchbox", { name: "Search chats" });

    fireEvent.change(search, { target: { value: "  LUNCH " } });
    expect(screen.queryByText("Plan my week")).toBeNull();
    expect(screen.getByText("Prepare for lunch at Lord's")).toBeDefined();
    // The count is the list's, not the search's.
    expect(screen.getByRole("heading").textContent).toBe("Chats 2");

    fireEvent.change(search, { target: { value: "taxes" } });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("No chats match that search.");

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("marks the open session Current session and no other, and never Draft", async () => {
    ready([session, other]);
    restoreTargetMock.mockResolvedValue({
      mode: "chat",
      cwd: "/workspaces",
      sessionPath: "/sessions/chat-2.jsonl",
    });
    render(<ChatPicker onChosen={vi.fn()} markCurrent />);

    const flag = await screen.findByText("Current session");
    const row = flag.closest("button");
    expect(row?.getAttribute("aria-current")).toBe("true");
    expect(row?.textContent).toContain("Prepare for lunch at Lord's");
    expect(screen.getAllByText("Current session")).toHaveLength(1);
    expect(screen.getByText("Plan my week").closest("button")?.hasAttribute("aria-current")).toBe(
      false,
    );
    // The app keeps no unsent draft per session, so nothing can be marked.
    expect(screen.queryByText(/Draft/)).toBeNull();
  });

  it("marks nothing when no session is open behind it", async () => {
    ready([session]);
    render(<ChatPicker onChosen={vi.fn()} />);
    await screen.findByText("Plan my week");
    expect(restoreTargetMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Current session")).toBeNull();
  });

  describe("its gutter, with the real theme loaded", () => {
    const gutter = (element: Element | null): string =>
      element ? getComputedStyle(element).getPropertyValue("--kleio-gutter").trim() : "missing";

    // As App.tsx mounts it: in a plain `.app`, beside a session and another picker.
    function mount(): HTMLElement {
      const style = document.createElement("style");
      style.textContent = themeCss;
      document.head.append(style);
      const { container } = render(
        <>
          <div className="app">
            <ChatPicker onChosen={vi.fn()} />
          </div>
          <div className="app app-session">
            <div className="inputwrap" />
          </div>
          <div className="app">
            <div className="picker project-picker">
              <div className="picker-list" />
            </div>
          </div>
        </>,
      );
      return container;
    }

    afterEach(() => {
      for (const style of document.head.querySelectorAll("style")) style.remove();
    });

    it("gives the heading and the list the session's own gutter", async () => {
      ready([session, other]);
      const container = mount();
      await screen.findByText("Plan my week");

      const sessionGutter = gutter(container.querySelector(".app-session > .inputwrap"));
      expect(sessionGutter).toMatch(/^max\(28px,/);
      expect(container.querySelector(".chat-browser")?.parentElement?.className).toBe("app");
      expect(gutter(container.querySelector(".chat-browser-heading"))).toBe(sessionGutter);
      expect(gutter(container.querySelector(".chat-browser > .picker-list"))).toBe(sessionGutter);
    });

    it("gives it to no other screen in a plain .app", async () => {
      ready([session]);
      const container = mount();
      await screen.findByText("Plan my week");

      expect(gutter(container.querySelector(".project-picker > .picker-list"))).toBe("");
      expect(gutter(container.querySelector(".chat-browser")?.parentElement ?? null)).toBe("");
    });

    it("gives the iPhone's picker none", async () => {
      document.documentElement.classList.add("platform-ios");
      try {
        ready([session]);
        const container = mount();
        await screen.findByText("Plan my week");
        expect(container.querySelector(".chat-browser")).toBeNull();
        expect(gutter(container.querySelector(".chat-picker > .picker-list"))).toBe("");
        expect(gutter(container.querySelector(".app-session > .inputwrap"))).toBe("");
      } finally {
        document.documentElement.classList.remove("platform-ios");
      }
    });
  });

  it("keeps today's picker on the iPhone: no search, no marker, the old row", async () => {
    document.documentElement.classList.add("platform-ios");
    try {
      ready([session]);
      render(<ChatPicker onChosen={vi.fn()} markCurrent />);
      const title = await screen.findByText("Plan my week");
      expect(title.className).toBe("picker-name picker-preview");
      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(screen.queryByRole("heading")).toBeNull();
      expect(restoreTargetMock).not.toHaveBeenCalled();
      expect(screen.getByText("Chats").className).toBe("picker-title");
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });
});
