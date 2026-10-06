// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { agentRowState } from "./AgentRow";
import { BlobsPage } from "./BlobsPage";
import { deleteBlob, listBlobs, newBlobSession, type Blob, type Schedule } from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import type { HistoryEntry } from "../agent";

vi.mock("../RadioButton", () => ({ RadioButton: () => <button type="button">Radio</button> }));
vi.mock("../WindowLayoutButton", () => ({
  WindowLayoutButton: () => <button type="button">Windows</button>,
}));
const chatHistory = vi.hoisted(() => ({ entries: [] as HistoryEntry[] }));
vi.mock("./ThreadChat", async () => {
  const { useEffect } = await import("react");
  return {
    ThreadChat: ({
      label,
      onHistory,
    }: {
      label: string;
      onHistory?: (h: readonly HistoryEntry[]) => void;
    }) => {
      useEffect(() => onHistory?.(chatHistory.entries), [onHistory]);
      return <p>chat with {label}</p>;
    },
  };
});
vi.mock("./BlobSchedules", () => ({
  Schedules: ({ blob }: { blob: Blob }) => <p>schedules for {blob.name}</p>,
}));
vi.mock("./BlobForm", () => ({
  BlobForm: ({ blob, onCancel }: { blob?: Blob; onCancel: () => void }) => (
    <div>
      <p>{blob ? `editing ${blob.name}` : "new agent form"}</p>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));
vi.mock("./kleioApi", async (importOriginal) => {
  const real = await importOriginal<typeof KleioApi>();
  return {
    ...real,
    listBlobs: vi.fn(),
    deleteBlob: vi.fn(),
    getBlobSession: vi.fn(),
    newBlobSession: vi.fn(),
  };
});

const DAILY: Schedule = {
  id: "s1",
  label: "Morning news",
  prompt: "Latest AI news",
  kind: "daily",
  time: "08:00",
  timezone: "Europe/London",
  enabled: true,
  notify: true,
  source: "auto",
  nextRunAt: "2099-01-01T08:00:00.000Z",
};

function blob(over: Partial<Blob>): Blob {
  return {
    id: "b1",
    name: "Research",
    emoji: "🔎",
    color: "sky",
    job: "Latest AI news every day",
    model: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    schedules: [DAILY],
    running: false,
    ...over,
  };
}

async function renderPage(onClose: () => void = () => undefined): Promise<void> {
  await act(async () => {
    render(<BlobsPage onClose={onClose} />);
  });
}

beforeEach(() => {
  vi.mocked(listBlobs).mockResolvedValue([
    blob({}),
    blob({ id: "b2", name: "Chef", color: "peach", schedules: [], running: true }),
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  chatHistory.entries = [];
});

describe("BlobsPage", () => {
  it("lists every specialist as a row with its job and what it's doing", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Specialists" })).toBeTruthy();
    const research = screen.getByRole("button", { name: /^Research\./ });
    expect(within(research).getByText("Latest AI news every day")).toBeTruthy();
    expect(within(research).getByText(/^Next /)).toBeTruthy();
    const chef = screen.getByRole("button", { name: /^Chef\./ });
    expect(within(chef).getByText("Working now")).toBeTruthy();
    expect(chef.className).toContain("is-running");
    expect(screen.getByText("1 working")).toBeTruthy();
  });

  it("filters the list by name or job", async () => {
    await renderPage();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search specialists" }), {
      target: { value: "chef" },
    });
    expect(screen.queryByRole("button", { name: /^Research\./ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Chef\./ })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search specialists" }), {
      target: { value: "nothing like this" },
    });
    expect(screen.getByText(/No specialists match/)).toBeTruthy();
  });

  it("opens a specialist into its chat, with its job and schedules alongside", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    expect(screen.getByRole("heading", { name: "Research", level: 1 })).toBeTruthy();
    expect(screen.getByText("chat with Research")).toBeTruthy();
    const side = screen.getByRole("complementary", { name: "Research details" });
    expect(within(side).getByText("Latest AI news every day")).toBeTruthy();
    expect(within(side).getByText("schedules for Research")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /^Research\./ })).toBeTruthy();
  });

  it("shows an empty Assets panel until the specialist shares a file", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    const side = screen.getByRole("complementary", { name: "Research details" });
    expect(within(side).getByText("Files your specialists share will appear here.")).toBeTruthy();
  });

  it("lists files the specialist linked by absolute path in its own folder", async () => {
    chatHistory.entries = [
      {
        role: "assistant",
        text: "[Plan](/Users/w/Kleio/blobs/b1/plan.pdf), [other](/Users/w/Kleio/blobs/b2/x.pdf), [etc](/etc/passwd.txt), [group](/Users/w/Kleio/groups/g1/b1/y.md)",
      },
    ];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    const side = screen.getByRole("complementary", { name: "Research details" });
    const list = await within(side).findByRole("list", {
      name: "Files shared in this conversation, newest first",
    });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Open Plan, shared by Research"]);
  });

  it("keeps the sidebar on the left, and remembers when you hide it", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    const side = screen.getByRole("complementary", { name: "Research details" });
    const split = side.parentElement;
    expect(split?.firstElementChild).toBe(side);
    expect(split?.className).not.toContain("is-side-collapsed");

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(split?.className).toContain("is-side-collapsed");
    expect(side.hasAttribute("inert")).toBe(true);
    expect(localStorage.getItem("kleio-sidebar-hidden")).toBe("1");

    // Leaving and coming back keeps it hidden.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(
      screen.getByRole("complementary", { name: "Research details" }).parentElement?.className,
    ).not.toContain("is-side-collapsed");
  });

  it("starts a new conversation from the pen button, after asking", async () => {
    vi.mocked(newBlobSession).mockResolvedValue({ sessionId: "s_new" } as never);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(newBlobSession).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "Start a new conversation?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "New conversation" }));
    await waitFor(() => expect(newBlobSession).toHaveBeenCalledWith("b1"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Start a new conversation?" })).toBeNull(),
    );
  });

  it("asks before deleting a specialist", async () => {
    vi.mocked(deleteBlob).mockResolvedValue(undefined);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Research" }));
    expect(deleteBlob).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "Delete Research?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteBlob).toHaveBeenCalledWith("b1"));
  });

  it("opens the new-specialist form from the header and returns to the list", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "+ New specialist" }));
    expect(screen.getByText("new agent form")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /^Research\./ })).toBeTruthy();
  });

  it("tells the screen when it leaves the list, so the switcher hides", async () => {
    const onListChange = vi.fn();
    await act(async () => {
      render(<BlobsPage onClose={() => undefined} onListChange={onListChange} />);
    });
    expect(onListChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    expect(onListChange).toHaveBeenLastCalledWith(false);
  });

  it("goes back out of Specialists from the list", async () => {
    const onClose = vi.fn();
    await renderPage(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("welcomes you with a first-specialist prompt when there are none", async () => {
    vi.mocked(listBlobs).mockResolvedValue([]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "No specialists yet" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Create your first specialist/ }));
    expect(screen.getByText("new agent form")).toBeTruthy();
  });

  it("says what's wrong when the Mac mini can't list them", async () => {
    vi.mocked(listBlobs).mockRejectedValue(new Error("Can't reach your Mac mini."));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toBe("Can't reach your Mac mini.");
  });
});

describe("agentRowState", () => {
  it("reads an agent's state in plain words", () => {
    expect(agentRowState(blob({ running: true }))).toEqual({ text: "Working now", tone: "live" });
    expect(agentRowState(blob({ schedules: [] })).text).toBe("On call");
    expect(agentRowState(blob({ schedules: [{ ...DAILY, enabled: false }] })).text).toBe("Paused");
    expect(agentRowState(blob({})).text).toMatch(/^Next /);
    expect(
      agentRowState(
        blob({
          lastRun: {
            id: "r1",
            blobId: "b1",
            scheduleId: "s1",
            label: "Morning news",
            startedAt: "2026-09-01T08:00:00Z",
            endedAt: "2026-09-01T08:01:00Z",
            outcome: "error",
          },
        }),
      ),
    ).toEqual({ text: "Last run failed", tone: "failed" });
  });
});
