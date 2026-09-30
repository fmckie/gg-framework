// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BlobsPage, blobStatus } from "./BlobsPage";
import { deleteBlob, listBlobs, type Blob, type Schedule } from "./kleioApi";
import type * as KleioApi from "./kleioApi";

vi.mock("./ThreadChat", () => ({
  ThreadChat: ({ label }: { label: string }) => <p>chat with {label}</p>,
}));
vi.mock("./BlobSchedules", () => ({
  Schedules: ({ blob }: { blob: Blob }) => <p>schedules for {blob.name}</p>,
}));
vi.mock("./BlobForm", () => ({
  BlobForm: ({ blob, onCancel }: { blob?: Blob; onCancel: () => void }) => (
    <div>
      <p>{blob ? `editing ${blob.name}` : "new blob form"}</p>
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

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<BlobsPage />);
  });
}

beforeEach(() => {
  vi.mocked(listBlobs).mockResolvedValue([
    blob({}),
    blob({ id: "b2", name: "Chef", emoji: "🍳", color: "peach", schedules: [], running: true }),
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BlobsPage", () => {
  it("shows every Blob as a card with what it's doing", async () => {
    await renderPage();
    const research = screen.getByRole("button", { name: /^Research\./ });
    expect(within(research).getByText("Latest AI news every day")).toBeTruthy();
    expect(within(research).getByText("1 schedule")).toBeTruthy();
    const chef = screen.getByRole("button", { name: /^Chef\./ });
    expect(within(chef).getByText("Working now")).toBeTruthy();
    expect(chef.className).toContain("is-running");
  });

  it("opens a Blob into its profile, with chat first and schedules a tab away", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    const head = screen.getByRole("region", { name: "Research" });
    expect(within(head).getByRole("heading", { name: "Research" })).toBeTruthy();
    expect(screen.getByText("chat with Research")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Schedules/ }));
    expect(screen.getByText("schedules for Research")).toBeTruthy();
  });

  it("asks before deleting a Blob", async () => {
    vi.mocked(deleteBlob).mockResolvedValue(undefined);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Research\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Research" }));
    expect(deleteBlob).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: "Delete Research?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteBlob).toHaveBeenCalledWith("b1"));
  });

  it("opens the new-agent form from the card at the end of the grid", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create an agent" }));
    expect(screen.getByText("new blob form")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /^Research\./ })).toBeTruthy();
  });

  it("welcomes you with a first-agent prompt when there are none", async () => {
    vi.mocked(listBlobs).mockResolvedValue([]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "No agents yet" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Create your first agent/ }));
    expect(screen.getByText("new blob form")).toBeTruthy();
  });

  it("says what's wrong when the Mac mini can't list them", async () => {
    vi.mocked(listBlobs).mockRejectedValue(new Error("Can't reach your Mac mini."));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toBe("Can't reach your Mac mini.");
  });
});

describe("blobStatus", () => {
  it("reads a Blob's state in plain words", () => {
    expect(blobStatus(blob({ running: true }))).toBe("Working now");
    expect(blobStatus(blob({ schedules: [] }))).toBe("On call — no schedule");
    expect(blobStatus(blob({ schedules: [{ ...DAILY, enabled: false }] }))).toBe(
      "Schedules paused",
    );
    expect(blobStatus(blob({}))).toMatch(/^Next /);
  });
});
