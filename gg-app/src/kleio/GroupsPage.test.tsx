// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FileViewerProvider } from "./FileViewerProvider";
import { GroupsPage } from "./GroupsPage";
import {
  createFileShow,
  createGroup,
  deleteGroup,
  listBlobs,
  listGroupMessages,
  listGroups,
  newGroupSession,
  answerGroupAsk,
  type Blob,
  type Group,
  stopGroup,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";

// Replies render through Markdown, which reaches the Tauri bridge on import.
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
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
    stopGroup: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    newGroupSession: vi.fn(),
    answerGroupAsk: vi.fn(),
    createFileShow: vi.fn(),
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.classList.remove("platform-ios");
});

/** The Cast is one for both: what it draws is checked on each. */
const DEVICES = [
  ["the desktop", null],
  ["the iPhone", "platform-ios"],
] as const;

/** The composer's beam reads matchMedia once a member is replying. */
function stubMatchMedia(): void {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

/** Open Morning Desk's room from the shelf: the click puts it in the spotlight,
 *  and its profile's button opens it. */
function openDesk(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Morning Desk\./ }));
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
}

describe("GroupsPage", () => {
  it.each(DEVICES)("stands the groups on the Cast's shelf, on %s", async (_device, platform) => {
    if (platform) document.documentElement.classList.add(platform);
    await renderPage();
    const desk = screen.getByRole("button", { name: /^Morning Desk\./ });
    expect(desk.matches(".cast-page .cast-actor.cast-troupe")).toBe(true);
    // A click selects; nothing opens until the profile's button is pressed.
    fireEvent.click(desk);
    expect(desk.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("log")).toBeNull();
    const profile = screen.getByRole("region", { name: "Morning Desk" });
    expect(within(profile).getByText("Two emails need replies.")).toBeTruthy();
    expect(document.querySelector(".picker-list, .picker-item, .kleio-row")).toBeNull();
    fireEvent.click(within(profile).getByRole("button", { name: "Open chat" }));
    await screen.findByRole("log", { name: "Morning Desk conversation" });
  });

  it.each(DEVICES)("draws the Cast's form, on %s", async (_device, platform) => {
    if (platform) document.documentElement.classList.add(platform);
    await renderPage();
    if (platform) {
      // The phone's header is one row: New group is in its "⋯".
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "New group" }));
    } else fireEvent.click(screen.getByRole("button", { name: "+ New group" }));
    expect(document.querySelector(".cast-form.cast-gform .cast-mini")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How it works" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Colour" })).toBeNull();
    expect(document.querySelector(".kleio-form-page, .kleio-panel, .kleio-preview")).toBeNull();
  });

  it("from the shelf, Edit opens the form and Cancel comes back to the shelf", async () => {
    await renderPage();
    const profile = screen.getByRole("region", { name: "Morning Desk" });
    fireEvent.click(within(profile).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit Morning Desk", level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Groups", level: 1 })).toBeTruthy();
    // From the room, Cancel still goes back to the room.
    openDesk();
    await screen.findByRole("log", { name: "Morning Desk conversation" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("log", { name: "Morning Desk conversation" });
  });

  it("opens a group into its room, with replies formatted and the members on its stage", async () => {
    await renderPage();
    openDesk();
    const log = await screen.findByRole("log", { name: "Morning Desk conversation" });
    await waitFor(() => expect(within(log).getByText("€40M").tagName).toBe("STRONG"));
    const members = screen.getByRole("group", { name: "Members" });
    expect(members.querySelectorAll(".cast-member")).toHaveLength(2);
  });

  it.each(DEVICES)("draws the Cast's room, on %s", async (_device, platform) => {
    if (platform) document.documentElement.classList.add(platform);
    await renderPage();
    openDesk();
    await screen.findByRole("log", { name: "Morning Desk conversation" });
    expect(document.querySelector(".cast-room .cast-room-stage")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Members" })).toBeTruthy();
    expect(document.querySelector(".kleio-split, .kleio-chat")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Morning Desk details" })).toBeNull();
    // The bar is the desktop's: the name beside Back, with no line stacked under it.
    const heading = screen.getByRole("heading", { name: "Morning Desk", level: 1 });
    expect(heading.parentElement?.classList.contains("kleio-head")).toBe(true);
    expect(document.querySelector(".kleio-head-titles, .kleio-head-sub")).toBeNull();
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
    openDesk();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Delete Morning Desk" }));
    expect(deleteGroup).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "Delete Morning Desk?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith("g1"));
  });

  it("starts a new conversation from the pen button, after asking, and clears the old one", async () => {
    vi.mocked(newGroupSession).mockResolvedValue({ ...DESK, clearedThrough: 1 });
    await renderPage();
    openDesk();
    const log = await screen.findByRole("log", { name: "Morning Desk conversation" });
    await waitFor(() => expect(within(log).getByText("€40M")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(newGroupSession).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "Start a new conversation?" });
    // A later poll still returns the old message: it stays cleared.
    vi.mocked(listGroupMessages).mockResolvedValue({
      messages: [],
      typing: [],
      lastSeq: 1,
      clearedThrough: 1,
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "New conversation" }));
    await waitFor(() => expect(newGroupSession).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(within(log).queryByText("€40M")).toBeNull());
    expect(screen.queryByRole("dialog", { name: "Start a new conversation?" })).toBeNull();
  });

  it("shows a member's question with its buttons, says who asks, and sends your pick", async () => {
    stubMatchMedia();
    vi.mocked(answerGroupAsk).mockResolvedValue(undefined);
    vi.mocked(listGroupMessages).mockResolvedValue({
      messages: [],
      typing: ["b2"],
      lastSeq: 0,
      asks: {
        b2: {
          id: "ask-7",
          questions: [
            {
              id: "q1",
              question: "Which market?",
              kind: "choice",
              options: [{ label: "Lagos" }, { label: "Nairobi" }],
            },
          ],
        },
      },
    });
    await renderPage();
    openDesk();
    const log = await screen.findByRole("log", { name: "Morning Desk conversation" });
    await within(log).findByText("Which market?");
    expect(within(log).getByText("Agent 2 asks")).toBeTruthy();
    // While it waits on you, the question replaces "is replying".
    expect(within(log).queryByText(/is replying/)).toBeNull();

    fireEvent.click(within(log).getByRole("button", { name: /Nairobi/ }));
    await waitFor(() =>
      expect(answerGroupAsk).toHaveBeenCalledWith("g1", "ask-7", "answer", { q1: "Nairobi" }),
    );
  });

  it("drops messages another device's new session cleared", async () => {
    await renderPage();
    openDesk();
    const log = await screen.findByRole("log", { name: "Morning Desk conversation" });
    await waitFor(() => expect(within(log).getByText("€40M")).toBeTruthy());

    vi.mocked(listGroupMessages).mockResolvedValue({
      messages: [
        {
          seq: 2,
          id: "m2",
          author: "you",
          authorName: "You",
          emoji: "🙂",
          text: "Fresh start",
          at: "",
        },
      ],
      typing: [],
      lastSeq: 2,
      clearedThrough: 1,
    });
    await waitFor(() => expect(within(log).getByText("Fresh start")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(within(log).queryByText("€40M")).toBeNull();
  });

  it("stops the group from the composer while a member is replying", async () => {
    stubMatchMedia();
    vi.mocked(stopGroup).mockResolvedValue(undefined);
    vi.mocked(listGroupMessages).mockResolvedValue({ messages: [], typing: ["b1"], lastSeq: 0 });
    await renderPage();
    openDesk();
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await act(async () => {
      fireEvent.click(stop);
    });
    expect(stopGroup).toHaveBeenCalledWith("g1");
  });

  it("shows Send, not Stop, when nobody is replying", async () => {
    await renderPage();
    openDesk();
    await screen.findByRole("button", { name: "Send" });
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("points you to specialists first when there are none", async () => {
    vi.mocked(listBlobs).mockResolvedValue([]);
    vi.mocked(listGroups).mockResolvedValue([]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "No groups yet" })).toBeTruthy();
    expect(screen.getByText(/Create a specialist first/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "+ New group" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("a member's file link in a group", () => {
  it("opens the file in the viewer, asked of the host as that member's in the group", async () => {
    vi.mocked(listGroupMessages).mockResolvedValue({
      messages: [
        {
          seq: 1,
          id: "m1",
          author: "b1",
          authorName: "Agent 1",
          emoji: "🫧",
          text: "Drafted [the plan](out/plan.md).",
          at: "2026-09-01T08:00:00Z",
        },
      ],
      typing: [],
      lastSeq: 1,
    });
    vi.mocked(createFileShow).mockReturnValue(new Promise(() => {}));
    await act(async () => {
      render(
        <FileViewerProvider>
          <GroupsPage onClose={() => undefined} />
        </FileViewerProvider>,
      );
    });
    openDesk();
    fireEvent.click(await screen.findByRole("link", { name: "the plan" }));
    expect(await screen.findByRole("dialog", { name: "plan.md" })).toBeTruthy();
    expect(createFileShow).toHaveBeenCalledWith({
      source: "group",
      id: "g1",
      member: "b1",
      path: "out/plan.md",
    });
  });
});
