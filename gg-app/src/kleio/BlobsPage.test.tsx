// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { agentRowState } from "./AgentRow";
import { BlobsPage } from "./BlobsPage";
import { formatWhenShort, ranLate } from "./blobFormat";
import type * as BlobSchedulesModule from "./BlobSchedules";
import {
  CAST_MODELS,
  CAST_NOW,
  castActivity,
  castRoster,
  castRuns,
  type RosterSize,
} from "./castFixtures";
import { castLayout, castOf } from "./castLayout";
import castCss from "./kleio-cast.css?raw";
import {
  deleteBlob,
  getBlobActivity,
  listBlobs,
  listModels,
  listRuns,
  newBlobSession,
  runScheduleNow,
  updateSchedule,
  type Blob,
  type Schedule,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { useKleioRemote } from "./useKleioRemote";
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
// Both forms as one stand-in, marked with which it is: today's (the iPhone) or the Cast's.
const formStub = vi.hoisted(
  () =>
    (which: string) =>
    ({
      blob,
      onCancel,
      onChanged,
      startJob,
    }: {
      blob?: Blob;
      onCancel: () => void;
      onChanged?: () => Promise<void>;
      startJob?: string;
    }) => (
      <div data-form={which}>
        <p>{blob ? `editing ${blob.name}` : "new agent form"}</p>
        {startJob && <p>{`starting job: ${startJob}`}</p>}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {onChanged && (
          <button type="button" onClick={() => void onChanged()}>
            schedule changed
          </button>
        )}
      </div>
    ),
);
vi.mock("./CastForm", () => ({ CastForm: formStub("cast") }));
vi.mock("./kleioApi", async (importOriginal) => {
  const real = await importOriginal<typeof KleioApi>();
  return {
    ...real,
    listBlobs: vi.fn(),
    deleteBlob: vi.fn(),
    getBlobSession: vi.fn(),
    newBlobSession: vi.fn(),
    listRuns: vi.fn(),
    getBlobActivity: vi.fn(),
    listModels: vi.fn(),
    runScheduleNow: vi.fn(),
    updateSchedule: vi.fn(),
  };
});
vi.mock("./useKleioRemote", () => ({ useKleioRemote: vi.fn() }));

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
  // The shelf's own reads (the selected specialist's runs, the models) land.
  await act(async () => {});
}

/** A click selects; the profile's button opens the chat. */
function openChat(name: string): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}\\.`) }));
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
}

/** Let the shelf's reads for a new selection land. */
const settle = (): Promise<void> => act(async () => {});

async function asPhone(run: () => Promise<void>): Promise<void> {
  document.documentElement.classList.add("platform-ios");
  try {
    await run();
  } finally {
    document.documentElement.classList.remove("platform-ios");
  }
}

beforeEach(() => {
  // Back to answering at once: a test that holds a run open must not hold the next one's.
  vi.mocked(runScheduleNow).mockReset();
  vi.mocked(updateSchedule).mockReset();
  vi.mocked(listRuns).mockResolvedValue([]);
  vi.mocked(getBlobActivity).mockResolvedValue([]);
  vi.mocked(listModels).mockResolvedValue(CAST_MODELS);
  vi.mocked(useKleioRemote).mockReturnValue({
    status: {
      active: {
        base: "https://mac-mini-1.example.ts.net:8443",
        host: "mac-mini-1.example.ts.net",
        deviceId: "d1",
        label: "iPhone",
        admin: false,
      },
      paired: null,
    },
    refresh: vi.fn(async () => undefined),
  });
  vi.mocked(listBlobs).mockResolvedValue([
    blob({}),
    blob({ id: "b2", name: "Chef", color: "peach", schedules: [], running: true }),
  ]);
});
afterEach(async () => {
  // Let a read that is still out land before the page goes.
  await act(async () => {});
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  chatHistory.entries = [];
});

describe("BlobsPage", () => {
  it("on the iPhone, stands every specialist on the Cast's shelf, with search behind its button", async () => {
    await asPhone(async () => {
      await renderPage();
      expect(screen.getByRole("heading", { name: "Specialists" })).toBeTruthy();
      for (const name of ["Research", "Chef"])
        expect(actor(name).matches(".cast-page .cast-actor")).toBe(true);
      expect(document.querySelector(".picker-item.kleio-row")).toBeNull();
      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(screen.getByRole("button", { name: "Search specialists" })).toBeTruthy();
    });
  });

  it("filters the shelf by name or job, from the search button", async () => {
    await renderPage();
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search specialists" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search specialists" }), {
      target: { value: "chef" },
    });
    await settle();
    expect(screen.queryByRole("button", { name: /^Research\./ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Chef\./ })).toBeTruthy();
    // One match stands alone; the place for a new specialist is for a cast of one.
    expect(screen.queryByRole("button", { name: /Give it a job/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search specialists" }), {
      target: { value: "nothing like this" },
    });
    expect(screen.getByText(/No specialists match/)).toBeTruthy();
    expect(document.querySelector(".cast-profile")).toBeNull();
    // Closing the search brings everyone back.
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    await settle();
    expect(screen.getByRole("button", { name: /^Research\./ })).toBeTruthy();
  });

  it("opens a specialist into its chat, with its job and schedules alongside", async () => {
    await renderPage();
    openChat("Research");
    expect(screen.getByRole("heading", { name: "Research", level: 1 })).toBeTruthy();
    expect(screen.getByText("chat with Research")).toBeTruthy();
    const side = screen.getByRole("complementary", { name: "Research details" });
    expect(within(side).getByText("Latest AI news every day")).toBeTruthy();
    expect(within(side).getByText("schedules for Research")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await settle();
    expect(screen.getByRole("button", { name: /^Research\./ })).toBeTruthy();
  });

  it("on the iPhone, sets the specialist's state beside its name in the bar, as the desktop does", async () => {
    await asPhone(async () => {
      await renderPage();
      openChat("Research");

      const heading = screen.getByRole("heading", { name: "Research", level: 1 });
      const head = heading.parentElement as HTMLElement;
      expect(head.classList.contains("kleio-head")).toBe(true);
      expect(within(head).getByText(agentRowState(blob({})).text)).toBeTruthy();
      expect(within(head).getByRole("button", { name: "Edit" })).toBeTruthy();
      expect(document.querySelector(".kleio-head-titles, .kleio-head-sub")).toBeNull();
    });
  });

  it("shows an empty Assets panel until the specialist shares a file", async () => {
    await renderPage();
    openChat("Research");
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
    openChat("Research");
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
    openChat("Research");
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
    openChat("Research");
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(
      screen.getByRole("complementary", { name: "Research details" }).parentElement?.className,
    ).not.toContain("is-side-collapsed");
  });

  it("starts a new conversation from the pen button, after asking", async () => {
    vi.mocked(newBlobSession).mockResolvedValue({ sessionId: "s_new" } as never);
    await renderPage();
    openChat("Research");
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
    openChat("Research");
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
    await settle();
    expect(screen.getByRole("button", { name: /^Research\./ })).toBeTruthy();
  });

  it("tells the screen when it leaves the list, so the switcher hides", async () => {
    const onListChange = vi.fn();
    await act(async () => {
      render(<BlobsPage onClose={() => undefined} onListChange={onListChange} />);
    });
    expect(onListChange).toHaveBeenLastCalledWith(true);
    openChat("Research");
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
    vi.mocked(listBlobs).mockRejectedValue(new Error("Can't reach your host."));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toBe("Can't reach your host.");
  });
});

// ─── the Cast shelf ───────────────────────────────────────────────────────────

/** The page with the mockup's roster, on its Monday at 14:10. */
async function renderCast(size: RosterSize | 0, extra: Blob[] = []): Promise<void> {
  vi.useFakeTimers({ now: CAST_NOW, toFake: ["Date"] });
  vi.mocked(listBlobs).mockResolvedValue([...(size === 0 ? [] : castRoster(size)), ...extra]);
  vi.mocked(listRuns).mockImplementation(async (id) => castRuns(id));
  vi.mocked(getBlobActivity).mockImplementation(async (id) => castActivity(id));
  await renderPage();
}

/** Put a character in the spotlight and let its profile's reads land. */
async function pick(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(actor(name));
  });
}

const actor = (name: string): HTMLElement =>
  screen.getByRole("button", { name: new RegExp(`^${name}\\.`) });
const shelves = (): number[] =>
  [...document.querySelectorAll(".cast-row")].map((r) => r.querySelectorAll(".cast-actor").length);
const profile = (name: string): HTMLElement => screen.getByRole("region", { name });
/** The profile's buttons, in the order they stand. */
const offered = (name: string): (string | null)[] =>
  within(profile(name))
    .getAllByRole("button")
    .map((b) => b.textContent);
const press = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
  });
};
/** One whose chat failed: its last run belonged to no schedule. */
const stuck = (error = "Couldn't open Gmail."): Blob =>
  blob({
    id: "stuck",
    name: "Stuck",
    schedules: [],
    lastRun: {
      id: "r",
      blobId: "stuck",
      scheduleId: null,
      label: "Receipts",
      startedAt: "2026-11-06T16:00:00.000Z",
      endedAt: "2026-11-06T16:00:40.000Z",
      outcome: "error",
      error,
    },
  });

describe("the Cast shelf", () => {
  it("shows a working specialist bouncing, in the spotlight, saying what it's doing", async () => {
    await renderCast(7);
    const courier = actor("Courier");
    expect(courier.className).toContain("is-working");
    expect(within(courier).getByText("Working now")).toBeTruthy();
    expect(courier.querySelector(".blob-av.is-live")).toBeTruthy();
    // The spotlight starts on whoever is working, with its live tool call.
    expect(courier.getAttribute("aria-pressed")).toBe("true");
    expect(within(courier).getByText("Searching web…")).toBeTruthy();
    expect(screen.getByText("1 working")).toBeTruthy();
  });

  it("shows an idle specialist with its next run or On call, blinking on its own clock", async () => {
    await renderCast(7);
    const herald = actor("Herald");
    expect(herald.className).toContain("is-scheduled");
    expect(within(herald).getByText("Next tomorrow 07:30")).toBeTruthy();
    const scout = actor("Scout");
    expect(scout.className).toContain("is-oncall");
    expect(within(scout).getByText("On call")).toBeTruthy();
    // Open-eyed faces blink, each on a different clock; a smiling face has no eyes to shut.
    expect(herald.dataset.clock).toBe("b1");
    expect(scout.dataset.clock).toBe("b2");
    expect(scout.querySelector(".blob-av.is-animated")).toBeTruthy();
    expect(actor("Chef").dataset.clock).toBeUndefined();
    for (const idle of [herald, scout]) {
      expect(idle.getAttribute("aria-pressed")).toBe("false");
      expect(idle.querySelector(".cast-bubble, .cast-zz, .is-live")).toBeNull();
    }
  });

  it("shows a paused specialist asleep", async () => {
    await renderCast(7);
    const gardener = actor("Gardener");
    expect(gardener.className).toContain("is-paused");
    expect(within(gardener).getByText("Paused")).toBeTruthy();
    expect(gardener.querySelector(".cast-zz")?.textContent).toBe("zz");
    expect(gardener.dataset.clock).toBeUndefined();
    expect(gardener.querySelector(".is-live, .is-animated, .cast-bubble")).toBeNull();
  });

  it("shows a specialist that needs you saying why, in a bubble and in the header", async () => {
    const long = "Couldn't open Gmail: the sign-in expired on Friday and needs doing again.";
    await renderCast(7, [stuck(long)]);
    const ledger = actor("Ledger");
    expect(ledger.className).toContain("is-failed");
    expect(within(ledger).getByText("Last run failed")).toBeTruthy();
    expect(within(ledger).getByText("Gmail needs signing in")).toBeTruthy();
    expect(screen.getByText("2 need you")).toBeTruthy();
    // A long reason stays on one line (the CSS clips it); the whole of it is the bubble's title.
    const bubble = actor("Stuck").querySelector(".cast-bubble");
    expect(bubble?.getAttribute("title")).toBe(long);
    expect(bubble?.querySelector(".cast-btxt")?.textContent).toBe(long);
  });

  it("stands one specialist alone, large, beside a place for the next", async () => {
    await renderCast(1);
    expect(screen.getByRole("group", { name: "Your 1 specialist" })).toBeTruthy();
    expect(document.querySelector(".cast-page")?.getAttribute("data-tier")).toBe("solo");
    expect(shelves()).toEqual([2]);
    expect(actor("Herald").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.queryByText(/working$/)).toBeNull();
    const place = screen.getByRole("button", { name: /New specialist.*Give it a job/ });
    expect(place.querySelector(".blob-av-outline")).toBeTruthy();
    fireEvent.click(place);
    expect(screen.getByText("new agent form")).toBeTruthy();
  });

  it("stands seven on one shelf, with next runs in full", async () => {
    await renderCast(7);
    expect(screen.getByRole("group", { name: "Your 7 specialists" })).toBeTruthy();
    expect(document.querySelector(".cast-page")?.getAttribute("data-tier")).toBe("one");
    expect(shelves()).toEqual([7]);
    expect(within(actor("Chef")).getByText(/^Next Thu,? 12 Nov 18:30$/)).toBeTruthy();
    // One shelf: the profile needs no picture, and its pointer finds the place.
    const courier = profile("Courier");
    expect(courier.querySelector(".blob-av")).toBeNull();
    expect(courier.style.getPropertyValue("--col")).toBe("3");
    expect(courier.style.getPropertyValue("--notch")).toBe("1");
  });

  it("stands twenty on two shelves of ten, with short labels and no working bubbles", async () => {
    await renderCast(20);
    expect(screen.getByRole("group", { name: "Your 20 specialists" })).toBeTruthy();
    expect(document.querySelector(".cast-page")?.getAttribute("data-tier")).toBe("two");
    expect(shelves()).toEqual([10, 10]);
    expect(within(actor("Herald")).getByText("Tue 07:30")).toBeTruthy();
    expect(within(actor("Postie")).getByText("Today 15:00")).toBeTruthy();
    expect(screen.getByText("3 working")).toBeTruthy();
    expect(screen.getByText("3 need you")).toBeTruthy();
    // A crowd stays calm: working shows by bouncing, each on its own beat, and
    // idle eyes blink on the slow clocks.
    expect(actor("Courier").querySelector(".cast-bubble")).toBeNull();
    expect(
      ["Courier", "Atlas", "Scribe"].map((n) => actor(n).style.getPropertyValue("--bd")),
    ).toEqual(["0.00s", "-0.38s", "-0.76s"]);
    expect(actor("Herald").dataset.clock).toBe("c1");
    expect(within(actor("Librarian")).getByText("Notion sign-in expired")).toBeTruthy();
    // More than one shelf: the profile shows whose it is, and points only at the front shelf.
    expect(profile("Courier").querySelector(".blob-av")).toBeTruthy();
    expect(profile("Courier").style.getPropertyValue("--notch")).toBe("0");
    await pick("Tutor");
    expect(profile("Tutor").style.getPropertyValue("--notch")).toBe("1");
    expect(profile("Tutor").style.getPropertyValue("--col")).toBe("9");
  });

  it("stands twenty-six on three shelves, the short one centred", async () => {
    await renderCast(26);
    expect(screen.getByRole("group", { name: "Your 26 specialists" })).toBeTruthy();
    expect(document.querySelector(".cast-page")?.getAttribute("data-tier")).toBe("crowd");
    expect(shelves()).toEqual([9, 9, 8]);
    const rows = [...document.querySelectorAll<HTMLElement>(".cast-row")];
    expect(rows.map((r) => r.style.getPropertyValue("--n"))).toEqual(["", "", "8"]);
    expect(screen.getByText("4 need you")).toBeTruthy();
    expect(document.querySelector(".cast-more")).toBeNull();
    await pick("Critic");
    expect(actor("Critic").getAttribute("aria-pressed")).toBe("true");
    expect(actor("Courier").getAttribute("aria-pressed")).toBe("false");
    // The eighth of eight on a shelf of nine places: half a place in.
    expect(profile("Critic").style.getPropertyValue("--col")).toBe("7.5");
  });

  it("follows the shelf rule at every size: one to 9, two to 24, three from 25, scrolling past 36", () => {
    expect(castLayout(9)).toMatchObject({ tier: "one", rows: [9], hidden: 0 });
    expect(castLayout(10)).toMatchObject({ tier: "two", rows: [5, 5] });
    expect(castLayout(21)).toMatchObject({ tier: "two", rows: [11, 10], cols: 11 });
    expect(castLayout(24)).toMatchObject({ tier: "two", rows: [12, 12] });
    expect(castLayout(25)).toMatchObject({ tier: "crowd", rows: [9, 9, 7] });
    expect(castLayout(36)).toMatchObject({ tier: "crowd", rows: [12, 12, 12], hidden: 0 });
    expect(castLayout(37)).toMatchObject({ tier: "crowd", rows: [10, 10, 10, 7], hidden: 7 });
    // Everyone gets a place, and no two neighbours blink on the same clock.
    const { actors } = castOf(castRoster(26), CAST_NOW);
    expect(actors).toHaveLength(26);
    const clocks = actors.flatMap((a) => (a.clock ? [a.clock] : []));
    clocks.slice(1).forEach((c, i) => expect(c).not.toBe(clocks[i]));
    expect(formatWhenShort("not a date")).toBe("");
  });

  it("says how many are below once the shelves scroll", async () => {
    const more = Array.from({ length: 11 }, (_, i) =>
      blob({ id: `x${i}`, name: `Extra ${i}`, schedules: [] }),
    );
    await renderCast(26, more);
    expect(shelves()).toEqual([10, 10, 10, 7]);
    expect(document.querySelector(".cast")?.hasAttribute("data-scroll")).toBe(true);
    expect(screen.getByText("7 more below · scroll")).toBeTruthy();
  });

  it("shows the selected specialist's profile, which opens its chat or its form", async () => {
    await renderCast(7);
    const courier = profile("Courier");
    expect(within(courier).getByText("since 14:08")).toBeTruthy();
    expect(within(courier).getByText("Claude Haiku 4.5 · cloud")).toBeTruthy();
    const calls = within(courier).getByRole("list", { name: "Courier’s tool calls, oldest first" });
    expect(within(calls).getAllByRole("listitem")).toHaveLength(3);
    expect(within(calls).getByText(/^live · /)).toBeTruthy();
    expect(within(courier).getByText("Flight watch")).toBeTruthy();
    expect(within(courier).getByText("Auto")).toBeTruthy();
    expect(within(courier).getByText("Every 2 hours · next today 16:08")).toBeTruthy();
    expect(within(courier).getByText("No changes. All 12 flights on time.")).toBeTruthy();

    // Someone who needs you: the failed run leads its recent runs.
    await pick("Ledger");
    const ledger = profile("Ledger");
    expect(screen.queryByRole("region", { name: "Courier" })).toBeNull();
    const runs = within(ledger).getAllByRole("listitem");
    expect(runs[0]?.className).toBe("is-failed");
    expect(runs[0]?.textContent).toContain("Gmail needs signing in");
    expect(within(ledger).getByText("Qwen3 14B · private, runs on your host")).toBeTruthy();
    expect(within(ledger).queryByText(/^since /)).toBeNull();
    // What failed can run again, before the chat and the form.
    expect(offered("Ledger")).toEqual(["Run now", "Open chat", "Edit"]);

    // On call: how to use it, and no runs asked for.
    vi.mocked(listRuns).mockClear();
    await pick("Scout");
    expect(within(profile("Scout")).getByText("How to use it")).toBeTruthy();
    expect(within(profile("Scout")).getByText(/^No schedules\./)).toBeTruthy();
    expect(within(profile("Scout")).getByText("Default · Claude Sonnet 4.5 · cloud")).toBeTruthy();
    expect(listRuns).not.toHaveBeenCalled();

    // Paused: its schedule reads off.
    await pick("Gardener");
    expect(within(profile("Gardener")).getByText("Mon at 08:00 · off")).toBeTruthy();
    expect(
      within(profile("Gardener")).getByText(
        "Llama 3.3 70B (Tinfoil) · private, in Tinfoil’s sealed cloud",
      ),
    ).toBeTruthy();

    fireEvent.click(within(profile("Gardener")).getByRole("button", { name: "Edit" }));
    expect(screen.getByText("editing Gardener")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("chat with Gardener")).toBeTruthy();
  });

  it("opens the chat from the profile", async () => {
    await renderCast(7);
    fireEvent.click(within(profile("Courier")).getByRole("button", { name: "Open chat" }));
    expect(screen.getByText("chat with Courier")).toBeTruthy();
  });

  it("welcomes you on the first run with one blob in the spotlight and places waiting", async () => {
    await renderCast(0);
    expect(screen.getByRole("heading", { name: "No specialists yet" })).toBeTruthy();
    expect(screen.getByText("Give me a job, and I’ll do it on mac-mini-1.")).toBeTruthy();
    expect(document.querySelectorAll(".cast-stage .blob-av-outline")).toHaveLength(4);
    expect(document.querySelector(".cast-stage .is-hero .blob-av.cast-bob")).toBeTruthy();
    expect(screen.getByText(/Open Specialists from anywhere with/).textContent).toContain("⌘⇧L");
    // Nothing to count, search or select yet; the one way in is the big button.
    expect(screen.queryByRole("button", { name: "+ New specialist" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Search specialists" })).toBeNull();
    expect(document.querySelector(".cast, .cast-profile, .cast-pills")).toBeNull();
    expect(listModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Create your first specialist/ }));
    expect(screen.getByText("new agent form")).toBeTruthy();
  });

  it("offers Run now after the chat and the form, for the schedule next due", async () => {
    await renderCast(7);
    await pick("Herald");
    expect(offered("Herald")).toEqual(["Open chat", "Edit", "Run now"]);
    const chat = within(profile("Herald")).getByRole("button", { name: "Open chat" });
    expect(chat.className).toContain("btn-primary");

    // The host runs a schedule, not a specialist: of Chef's two, Thursday's is next.
    await pick("Chef");
    const run = within(profile("Chef")).getByRole("button", { name: "Run now" });
    expect(run.title).toBe("Run “Thursday top-up” now");
    expect(run.className).not.toContain("btn-primary");
    let land: () => void = () => undefined;
    vi.mocked(runScheduleNow).mockImplementationOnce(
      () => new Promise((ok) => (land = () => ok(castRuns("chef")[0] as never))),
    );
    vi.mocked(listBlobs).mockClear();
    await press(run);
    expect(runScheduleNow).toHaveBeenCalledWith("chef", "chef-s2");
    const starting = within(profile("Chef")).getByRole("button", { name: "Starting…" });
    expect((starting as HTMLButtonElement).disabled).toBe(true);
    expect(listBlobs).not.toHaveBeenCalled();
    await act(async () => land());
    // The list is read again, and the profile says so in words.
    expect(listBlobs).toHaveBeenCalledTimes(1);
    expect(within(profile("Chef")).getByRole("status").textContent).toBe(
      "Started. The result will show in Recent runs.",
    );
    expect(offered("Chef")).toEqual(["Open chat", "Edit", "Run now"]);
    // That word is Chef's alone.
    await pick("Herald");
    expect(within(profile("Herald")).queryByRole("status")).toBeNull();

    // Nothing to run while one works, or for one with no schedule.
    for (const name of ["Courier", "Scout"]) {
      await pick(name);
      expect(offered(name)).toEqual(["Open chat", "Edit"]);
    }
    expect(runScheduleNow).toHaveBeenCalledTimes(1);
    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it("puts a failed schedule's Run now first, and offers a failed chat nothing to run", async () => {
    await renderCast(7, [stuck()]);
    await pick("Ledger");
    expect(offered("Ledger")).toEqual(["Run now", "Open chat", "Edit"]);
    const run = within(profile("Ledger")).getByRole("button", { name: "Run now" });
    expect(run.className).toContain("btn-primary");
    expect(run.title).toBe("Run “Friday receipts” now");
    expect(
      within(profile("Ledger")).getByRole("button", { name: "Open chat" }).className,
    ).not.toContain("btn-primary");
    await press(run);
    expect(runScheduleNow).toHaveBeenCalledWith("ledger", "ledger-s1");

    // The host says only that it failed, not which app: no sign-in button to draw.
    await pick("Stuck");
    expect(offered("Stuck")).toEqual(["Open chat", "Edit"]);
    expect(screen.queryByRole("button", { name: /^Sign in/ })).toBeNull();
  });

  it("turns a paused specialist's schedules back on, one or all of them", async () => {
    const off = { enabled: false, nextRunAt: null };
    const napper = blob({
      id: "napper",
      name: "Napper",
      schedules: [
        { ...DAILY, ...off, id: "n1" },
        { ...DAILY, ...off, id: "n2", label: "Evening news" },
      ],
    });
    await renderCast(7, [napper]);
    await pick("Gardener");
    expect(offered("Gardener")).toEqual(["Turn schedule on", "Open chat", "Edit"]);
    const on = within(profile("Gardener")).getByRole("button", { name: "Turn schedule on" });
    expect(on.className).toContain("btn-primary");
    vi.mocked(listBlobs).mockClear();
    await press(on);
    expect(updateSchedule).toHaveBeenCalledWith("gardener", "gardener-s1", { enabled: true });
    expect(listBlobs).toHaveBeenCalledTimes(1);
    // Nothing started: there is no word about a run.
    expect(within(profile("Gardener")).queryByRole("status")).toBeNull();

    await pick("Napper");
    expect(offered("Napper")).toEqual(["Turn schedules on", "Open chat", "Edit"]);
    vi.mocked(updateSchedule).mockClear();
    await press(within(profile("Napper")).getByRole("button", { name: "Turn schedules on" }));
    expect(vi.mocked(updateSchedule).mock.calls).toEqual([
      ["napper", "n1", { enabled: true }],
      ["napper", "n2", { enabled: true }],
    ]);
    expect(runScheduleNow).not.toHaveBeenCalled();
  });

  it("says why a run couldn't start, on that specialist's profile only, and lets you try again", async () => {
    await renderCast(7);
    await pick("Herald");
    vi.mocked(runScheduleNow).mockRejectedValueOnce(new Error("The host is asleep."));
    vi.mocked(listBlobs).mockClear();
    await press(within(profile("Herald")).getByRole("button", { name: "Run now" }));
    expect(within(profile("Herald")).getByRole("alert").textContent).toBe("The host is asleep.");
    expect(listBlobs).not.toHaveBeenCalled();
    expect(within(profile("Herald")).queryByRole("status")).toBeNull();
    const again = within(profile("Herald")).getByRole("button", { name: "Run now" });
    expect((again as HTMLButtonElement).disabled).toBe(false);

    await pick("Chef");
    expect(within(profile("Chef")).queryByRole("alert")).toBeNull();

    await pick("Herald");
    await press(within(profile("Herald")).getByRole("button", { name: "Run now" }));
    expect(within(profile("Herald")).queryByRole("alert")).toBeNull();
    expect(within(profile("Herald")).getByRole("status")).toBeTruthy();
  });

  it("starts the first specialist from an example job", async () => {
    await renderCast(0);
    const examples = screen.getByRole("group", { name: "Example jobs" });
    expect(within(examples).getByText("Or start from")).toBeTruthy();
    const jobs = within(examples).getAllByRole("button");
    expect(jobs.map((b) => b.textContent)).toEqual([
      "Morning news",
      "Weekly meal plan",
      "Research on request",
    ]);
    // Each wears a waiting place's outline, and says its job when pointed at.
    for (const b of jobs) expect(b.querySelectorAll(".blob-av-outline")).toHaveLength(1);
    const plan = jobs[1] as HTMLElement;
    expect(plan.title).toMatch(/^Every Sunday at 5pm, plan three dinners/);
    fireEvent.click(plan);
    const form = screen.getByText("new agent form").closest("[data-form]");
    expect(form?.getAttribute("data-form")).toBe("cast");
    expect(screen.getByText(`starting job: ${plan.title}`)).toBeTruthy();
    // The big button still starts from nothing.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Create your first specialist/ }));
    expect(screen.getByText("new agent form")).toBeTruthy();
    expect(screen.queryByText(/^starting job:/)).toBeNull();
  });

  it("gives the list's error line its padding back, which the page's reset would take", () => {
    const rules = castCss.replace(/\/\*[\s\S]*?\*\//g, "");
    // The reset reaches every <p> on the page, the error line among them.
    expect(rules).toMatch(/\.cast-page :where\([^)]*\bp\b[^)]*\) \{[^}]*padding: 0;/);
    const own = /(?:^|\n)\.cast-error \{([^}]*)\}/.exec(rules)?.[1] ?? "";
    expect(own).toMatch(/padding: 9px 12px;/);
    expect(rules.indexOf(".cast-error {")).toBeGreaterThan(rules.indexOf(".cast-page :where("));
  });

  it("in a wide window enlarges a specialist's own picture, never the three in a group's", () => {
    const rules = castCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const wide = [...rules.matchAll(/@media \(min-width: 1400px\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1] ?? "")
      .join("\n");
    expect(wide).toMatch(/\.cast-p-head > \.blob-av \{\s*width: 44px;\s*height: 44px;/);
    // A descendant selector would reach every member in the group's picture (.blob-cluster).
    expect(wide).not.toMatch(/\.cast-p-head \.blob-av/);
  });

  it("holds the profile's buttons and the example jobs still with reduced motion", async () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{\n([\s\S]*?)\n\}\n?$/.exec(castCss);
    const still = (/^\s*([^{]+)\{/.exec(block?.[1] ?? "")?.[1] ?? "")
      .split(",")
      .map((s) => s.trim());
    expect(still).toContain(".cast-page *");
    await renderCast(7);
    await pick("Herald");
    await press(within(profile("Herald")).getByRole("button", { name: "Run now" }));
    const parts = [...document.querySelectorAll(".cast-p-actions > *")];
    expect(parts.length).toBe(4);
    for (const el of parts) expect(el.matches(".cast-page *")).toBe(true);
    cleanup();
    await renderCast(0);
    const examples = [...document.querySelectorAll(".cast-example, .cast-ex-label")];
    expect(examples).toHaveLength(4);
    for (const el of examples) expect(el.matches(".cast-page *")).toBe(true);
    // They only change colour under the pointer, which the block switches off; nothing of theirs is animated.
    const rules = castCss.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of rules.matchAll(
      /([^{}]*\.cast-(?:example|ex-label|p-started|p-error)[^{}]*)\{([^{}]*)\}/g,
    ))
      expect(m[2]).not.toMatch(/\banimation/);
  });

  it("holds everything still with reduced motion", async () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{\n([\s\S]*?)\n\}\n?$/.exec(castCss);
    const rule = /^\s*([^{]+)\{([^}]*)\}/.exec(block?.[1] ?? "");
    expect(rule?.[2]).toContain("animation: none !important");
    expect(rule?.[2]).toContain("transition: none !important");
    const still = (rule?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.includes("::"));
    expect(still).toEqual([".cast-dot", ".cast-page *", ".cast-form *", ".cast-room *"]);
    // The hover lift is a plain transform, so it is switched off by name.
    expect(block?.[1]).toMatch(/\.cast-actor:hover \.cast-figure \{\s*transform: none;/);

    // Everything that moves on the shelf is one of those: the bounce, the
    // blinks, the z's, the live dots and the profile's running tool call.
    await renderCast(7);
    const moving = [
      ".blob-av.is-live .blob-av-body",
      ".blob-av.is-animated .blob-av-eyes",
      ".cast-zz i",
      ".cast-dot",
      ".tool-dot.blink",
      ".cast-figure",
      ".cast-profile",
    ].flatMap((sel) => {
      const found = [...document.querySelectorAll(sel)];
      expect(found.length, sel).toBeGreaterThan(0);
      return found;
    });
    for (const el of moving) expect(still.some((sel) => el.matches(sel))).toBe(true);
    cleanup();
    // And the first run's bob.
    await renderCast(0);
    const bob = document.querySelector(".cast-bob");
    expect(bob && still.some((sel) => bob.matches(sel))).toBe(true);
    // No animation in the stylesheet belongs to anything outside the shelf.
    const animated = [
      ...castCss
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([^{}]+)\{[^{}]*\banimation(?:-delay)?:/g),
    ].map((m) => (m[1] ?? "").trim());
    expect(animated.length).toBeGreaterThan(16);
    for (const sel of animated) expect(sel).toMatch(/^\.cast-/);
  });

  it("opens the Cast's form, and reads the specialists again when a schedule changes", async () => {
    await renderCast(7);
    await pick("Chef");
    fireEvent.click(within(profile("Chef")).getByRole("button", { name: "Edit" }));
    expect(screen.getByText("editing Chef").closest("[data-form]")?.getAttribute("data-form")).toBe(
      "cast",
    );
    vi.mocked(listBlobs).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "schedule changed" }));
    await settle();
    expect(listBlobs).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    cleanup();

    await renderCast(7);
    fireEvent.click(screen.getByRole("button", { name: "+ New specialist" }));
    expect(
      screen.getByText("new agent form").closest("[data-form]")?.getAttribute("data-form"),
    ).toBe("cast");
  });

  it("opens the Cast's form on the iPhone too, for a new specialist and for an edit", async () => {
    await asPhone(async () => {
      await renderCast(7);
      fireEvent.click(screen.getByRole("button", { name: "+ New specialist" }));
      const made = screen.getByText("new agent form").closest("[data-form]");
      expect(made?.getAttribute("data-form")).toBe("cast");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await settle();

      await pick("Chef");
      fireEvent.click(within(profile("Chef")).getByRole("button", { name: "Edit" }));
      const edit = screen.getByText("editing Chef").closest("[data-form]");
      expect(edit?.getAttribute("data-form")).toBe("cast");
      // Schedules are the form's, as on the desktop.
      expect(screen.getByRole("button", { name: "schedule changed" })).toBeTruthy();
    });
  });

  it("is drawn on the iPhone too: the shelf, a profile that opens the chat, and the first run's stage", async () => {
    await asPhone(async () => {
      await renderCast(7);
      expect(shelves()).toEqual([7]);
      expect(document.querySelector(".picker-item.kleio-row")).toBeNull();
      // A tap selects; the profile's button opens the chat.
      await pick("Courier");
      expect(screen.queryByText("chat with Courier")).toBeNull();
      fireEvent.click(within(profile("Courier")).getByRole("button", { name: "Open chat" }));
      expect(screen.getByText("chat with Courier")).toBeTruthy();
      cleanup();

      await renderCast(0);
      expect(document.querySelector(".cast-first .cast-stage")).toBeTruthy();
      expect(document.querySelector(".kleio-first")).toBeNull();
      expect(screen.getByRole("button", { name: /Create your first specialist/ })).toBeTruthy();
    });
  });

  it("offers the iPhone the example jobs to start the first specialist from", async () => {
    await asPhone(async () => {
      await renderCast(0);
      const examples = screen.getByRole("group", { name: "Example jobs" });
      const [first] = within(examples).getAllByRole("button");
      if (!first) throw new Error("no example job");
      fireEvent.click(first);
      expect(screen.getByText(`starting job: ${first.title}`)).toBeTruthy();
    });
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

describe("a schedule that ran late", () => {
  const late: Schedule = {
    ...DAILY,
    time: "09:00",
    lastRun: {
      at: "2026-10-26T09:30:00.000Z",
      outcome: "ran",
      late: { dueAt: "2026-10-24T08:00:00.000Z" },
    },
  };

  it("shows the line under the schedule, with the host and the time it was for", async () => {
    // The real card: the page's tests stand it in.
    const { Schedules } = await vi.importActual<typeof BlobSchedulesModule>("./BlobSchedules");
    await act(async () => {
      render(<Schedules blob={blob({ schedules: [late] })} onChanged={async () => {}} />);
    });
    expect(screen.getByText("Ran late: mac-mini-1 was asleep at 09:00.")).toBeTruthy();
    cleanup();

    // On time: no line.
    await act(async () => {
      render(<Schedules blob={blob({})} onChanged={async () => {}} />);
    });
    expect(screen.queryByText(/^Ran late/)).toBeNull();
  });

  it("says it only for a run that ran, in the schedule's own zone", () => {
    expect(ranLate(late.lastRun, "Europe/London", "mac-mini-1")).toBe(
      "Ran late: mac-mini-1 was asleep at 09:00.",
    );
    expect(ranLate(late.lastRun, "America/New_York", "mac-mini-1")).toBe(
      "Ran late: mac-mini-1 was asleep at 04:00.",
    );
    expect(ranLate({ at: late.lastRun!.at, outcome: "ran" }, "Europe/London", "x")).toBeNull();
    expect(
      ranLate({ ...late.lastRun!, outcome: "error", error: "failed" }, "Europe/London", "x"),
    ).toBeNull();
    expect(ranLate(undefined, "Europe/London", "x")).toBeNull();
  });
});
