// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  arrangeAllWindows,
  deleteChat,
  focusWindowByOffset,
  getSettings,
  listSessions,
  selectWorkspace,
  waitForReady,
  type RecentSession,
} from "./agent";
import { ChatPicker } from "./ChatPicker";

vi.mock("./agent", () => ({
  arrangeAllWindows: vi.fn(),
  deleteChat: vi.fn(),
  focusWindowByOffset: vi.fn(),
  getSettings: vi.fn(),
  listSessions: vi.fn(),
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
});
