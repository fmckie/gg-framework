// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GroupsPage } from "./GroupsPage";
import {
  createGroup,
  deleteGroup,
  listBlobs,
  listGroupMessages,
  listGroups,
  type Blob,
  type Group,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";

// Replies render through Markdown, which reaches the Tauri bridge on import.
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../RadioButton", () => ({ RadioButton: () => <button type="button">Radio</button> }));
vi.mock("../WindowLayoutButton", () => ({
  WindowLayoutButton: () => <button type="button">Windows</button>,
}));
vi.mock("./kleioApi", async (importOriginal) => {
  const real = await importOriginal<typeof KleioApi>();
  return {
    ...real,
    listBlobs: vi.fn(),
    listGroups: vi.fn(),
    listGroupMessages: vi.fn(),
    sendGroupMessage: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
  };
});

function agent(id: string, name: string): Blob {
  return {
    id,
    name,
    emoji: "🫧",
    color: "sky",
    job: `${name}'s job`,
    model: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    schedules: [],
    running: false,
  };
}

const AGENTS = Array.from({ length: 9 }, (_, i) => agent(`b${i + 1}`, `Agent ${i + 1}`));

const DESK: Group = {
  id: "g1",
  name: "Morning Desk",
  emoji: "☕️",
  color: "lemon",
  members: ["b1", "b2"],
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  typing: [],
  lastMessage: {
    seq: 2,
    id: "m2",
    author: "b2",
    authorName: "Agent 2",
    emoji: "🫧",
    text: "Two emails need replies.",
    at: "2026-09-01T09:00:00Z",
  },
};

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<GroupsPage onClose={() => undefined} />);
  });
}

beforeEach(() => {
  vi.mocked(listBlobs).mockResolvedValue(AGENTS);
  vi.mocked(listGroups).mockResolvedValue([DESK]);
  vi.mocked(listGroupMessages).mockResolvedValue({
    messages: [
      {
        seq: 1,
        id: "m1",
        author: "b1",
        authorName: "Agent 1",
        emoji: "🫧",
        text: "VanMoof closed a **€40M** round.",
        at: "2026-09-01T08:00:00Z",
      },
    ],
    typing: [],
    lastSeq: 1,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GroupsPage", () => {
  it("lists each group with its latest message", async () => {
    await renderPage();
    const desk = screen.getByRole("button", { name: /^Morning Desk\./ });
    expect(within(desk).getByText("Agent 2: Two emails need replies.")).toBeTruthy();
  });

  it("opens a group into its chat, with replies formatted and members alongside", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Morning Desk\./ }));
    const log = await screen.findByRole("log", { name: "Morning Desk conversation" });
    await waitFor(() => expect(within(log).getByText("€40M").tagName).toBe("STRONG"));
    const side = screen.getByRole("complementary", { name: "Morning Desk details" });
    expect(within(side).getByText("Agent 1")).toBeTruthy();
    expect(within(side).getByText("Agent 2")).toBeTruthy();
  });

  it("builds a new group from ticked agents, up to eight", async () => {
    vi.mocked(createGroup).mockResolvedValue({ ...DESK, id: "g2", name: "Crew", members: [] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "+ New group" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Crew" } });
    const picks = screen.getByRole("list", { name: "Members" });
    const rows = within(picks).getAllByRole("button");
    for (const row of rows.slice(0, 8)) fireEvent.click(row);
    expect(screen.getByText("8 of 8 — the group is full")).toBeTruthy();
    expect((rows[8] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Crew", members: AGENTS.slice(0, 8).map((a) => a.id) }),
      ),
    );
  });

  it("asks before deleting a group", async () => {
    vi.mocked(deleteGroup).mockResolvedValue(undefined);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Morning Desk\./ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Delete Morning Desk" }));
    expect(deleteGroup).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "Delete Morning Desk?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith("g1"));
  });

  it("points you to agents first when there are none", async () => {
    vi.mocked(listBlobs).mockResolvedValue([]);
    vi.mocked(listGroups).mockResolvedValue([]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "No groups yet" })).toBeTruthy();
    expect(screen.getByText(/Create an agent first/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "+ New group" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
