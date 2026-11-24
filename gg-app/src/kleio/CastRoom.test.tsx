// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CAST_NOW, castGroup, type RoomSize } from "./castFixtures";
import { ROOM_CROWD_FROM, roomOf } from "./castLayout";
import { CastRoom } from "./CastRoom";
import { FileViewerProvider } from "./FileViewerProvider";
import castCss from "./kleio-cast.css?raw";
import {
  answerGroupAsk,
  createFileShow,
  listGroupMessages,
  sendGroupMessage,
  stopGroup,
  type Blob,
  type GroupMessage,
  type GroupMessagesPage,
  type GroupTurnOutcome,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";

// Replies render through Markdown, which reaches the Tauri bridge on import.
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
vi.mock("../RadioButton", () => ({ RadioButton: () => null }));
vi.mock("../WindowLayoutButton", () => ({ WindowLayoutButton: () => null }));
vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  listGroupMessages: vi.fn(),
  sendGroupMessage: vi.fn(),
  stopGroup: vi.fn(),
  newGroupSession: vi.fn(),
  answerGroupAsk: vi.fn(),
  createFileShow: vi.fn(),
}));

const onBack = vi.fn();
const onEdit = vi.fn();

/** The mockup's room of `size`, with the host's page changed by `over`. */
async function draw(
  size: RoomSize = 4,
  over: Partial<GroupMessagesPage> = {},
  change: (room: ReturnType<typeof castGroup>) => void = () => undefined,
): Promise<void> {
  const room = castGroup(size);
  change(room);
  vi.mocked(listGroupMessages).mockResolvedValue({ ...room.page, ...over });
  await act(async () => {
    render(
      <FileViewerProvider>
        <CastRoom group={room.group} blobs={room.blobs} onBack={onBack} onEdit={onEdit} />
      </FileViewerProvider>,
    );
  });
}

/** A quiet room: the conversation so far, nobody replying. */
const QUIET: Partial<GroupMessagesPage> = { typing: [], activity: {} };

const stage = (): HTMLElement => screen.getByRole("group", { name: "Members" });
const member = (name: string): HTMLElement =>
  within(stage()).getByRole("button", { name: new RegExp(`^Mention ${name}\\b`) });
const labels = (): (string | null)[] =>
  within(stage())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));
const log = (): HTMLElement => screen.getByRole("log", { name: "Lisbon offsite conversation" });
const draft = (): HTMLTextAreaElement => screen.getByLabelText("Message Lisbon offsite");
const panel = (): HTMLElement | null =>
  screen.queryByRole("complementary", { name: "Lisbon offsite assets" });
const assetsButton = (): HTMLElement => screen.getByRole("button", { name: "Assets" });
const baton = (): HTMLElement | null => document.querySelector(".cast-baton");

/** Windows narrower than 900px, where the panel lies over the room. */
function narrowWindow(): void {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(max-width: 900px)",
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now: CAST_NOW, toFake: ["Date"] });
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the room, mid-turn", () => {
  it("stands the four members on the shelf, each saying what it is doing", async () => {
    await draw();
    expect(labels()).toEqual([
      "Mention Scout. Replied",
      "Mention Ledger. Replied · handed over",
      "Mention Quill. Replying…",
      `Mention Courier. ${castGroup(4).blobs[3]?.job}`,
    ]);
    expect(stage().className).toBe("cast-room-stage");
    expect(stage().style.getPropertyValue("--n")).toBe("4");
    expect(stage().querySelector(".cast-shelf")).toBeTruthy();

    // Quill, replying: in the spotlight, bouncing, with the typing dots overhead.
    const quill = member("Quill");
    expect(quill.className).toBe("cast-actor cast-member is-live");
    expect(quill.querySelectorAll(".cast-bubble.is-typing i")).toHaveLength(3);
    expect(quill.querySelector(".cast-figure .blob-av.is-live")).toBeTruthy();
    expect(quill.style.getPropertyValue("--foot")).toBe("8%");
    // Nobody else bounces; the two who replied blink; Courier sat it out.
    expect(stage().querySelectorAll(".blob-av.is-live")).toHaveLength(1);
    expect(member("Scout").className).toBe("cast-actor cast-member is-plain");
    expect(member("Scout").dataset.clock).toBe("b1");
    expect(member("Ledger").className).toBe("cast-actor cast-member is-plain is-from");
    expect(member("Ledger").dataset.clock).toBe("b2");
    expect(member("Courier").className).toBe("cast-actor cast-member is-idle");
    expect(member("Courier").dataset.clock).toBeUndefined();
    expect(within(member("Courier")).getByText(/^Watch the flights/)).toBeTruthy();
  });

  it("arcs the baton from Ledger, whose @mention handed over, to Quill", async () => {
    await draw();
    const arc = baton() as HTMLElement;
    expect(arc.getAttribute("class")).toBe("cast-baton");
    expect(arc.getAttribute("aria-hidden")).toBe("true");
    // From the second place, one place along, left to right.
    expect(arc.style.getPropertyValue("--b-lo")).toBe("1");
    expect(arc.style.getPropertyValue("--b-span")).toBe("1");
    expect(arc.hasAttribute("data-back")).toBe(false);
    expect(arc.querySelector(".cast-baton-arc")).toBeTruthy();
    expect(arc.querySelector(".cast-baton-spark")).toBeTruthy();
  });

  it("says in the header that the group is replying, and goes back or to its form", async () => {
    await draw();
    expect(screen.getByRole("heading", { name: "Lisbon offsite", level: 1 })).toBeTruthy();
    const pill = screen.getByText("Replying…", { selector: ".cast-pill" });
    expect(pill.className).toBe("cast-pill is-live");
    expect(pill.querySelector(".cast-dot")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows the conversation with who spoke and when, and Quill's steps as it replies", async () => {
    await draw();
    const mine = within(log()).getByText(/^Dinner for 12 on Saturday/);
    expect(mine.className).toBe("cast-bub");
    expect(mine.parentElement?.className).toBe("cast-msg is-you");
    expect(mine.parentElement?.querySelector("time")?.textContent).toBe("14:05");

    const places = within(log()).getByText("Taberna do Largo");
    expect(places.tagName).toBe("STRONG");
    const scout = places.closest(".cast-msg") as HTMLElement;
    expect(scout.querySelector(".cast-msg-who")?.textContent).toBe("Scout14:07");
    expect(scout.querySelector(".cast-bub.assistant-text")).toBeTruthy();
    expect(scout.querySelector(":scope > .blob-av")).toBeTruthy();

    const replying = within(log()).getByRole("status");
    expect(replying.className).toBe("cast-msg is-replying");
    expect(replying.querySelector(".cast-msg-who")?.textContent).toBe("Quill is replying");
    expect(replying.querySelector(":scope > .blob-av.is-live")).toBeTruthy();
    const steps = within(replying).getByRole("list", { name: "What Quill is doing" });
    const rows = within(steps).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toMatch(/dinner-options\.md.*1s$/);
    expect(rows[2]?.textContent).toMatch(/invite-draft\.md.*live · 4s$/);
  });

  it("mentions a member from its place on the shelf or from its chip", async () => {
    await draw();
    fireEvent.click(member("Scout"));
    expect(draft().value).toBe("@Scout ");
    const chips = within(screen.getByRole("group", { name: "Mention a member" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "@Scout",
      "@Ledger",
      "@Quill",
      "@Courier",
    ]);
    fireEvent.click(chips.getByRole("button", { name: "@Quill" }));
    expect(draft().value).toBe("@Scout @Quill ");
  });

  it("offers Stop while anyone replies, and stops the group", async () => {
    vi.mocked(stopGroup).mockResolvedValue(undefined);
    await draw();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(stopGroup).toHaveBeenCalledWith("lisbon"));
  });
});

describe("the room at rest", () => {
  it("has no baton, no dots and no steps, and counts its members in the header", async () => {
    await draw(4, QUIET);
    expect(baton()).toBeNull();
    expect(stage().querySelector(".cast-bubble")).toBeNull();
    expect(stage().querySelector(".blob-av.is-live")).toBeNull();
    expect(within(log()).queryByRole("status")).toBeNull();
    expect(screen.getByText("4 members", { selector: ".cast-pill" }).className).toBe("cast-pill");
    expect(labels().slice(0, 2)).toEqual(["Mention Scout. Replied", "Mention Ledger. Replied"]);
  });

  it("sends what you type, and only then", async () => {
    vi.mocked(sendGroupMessage).mockResolvedValue({} as GroupMessage);
    await draw(4, QUIET);
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.change(draft(), { target: { value: "  Book Taberna do Largo.  " } });
    expect(send.disabled).toBe(false);
    await act(async () => {
      fireEvent.keyDown(draft(), { key: "Enter" });
    });
    expect(sendGroupMessage).toHaveBeenCalledWith("lisbon", "Book Taberna do Largo.");
    expect(draft().value).toBe("");
  });

  it("says it is opening, then greets an empty conversation with nobody greyed out", async () => {
    let land: (page: GroupMessagesPage) => void = () => undefined;
    const room = castGroup(4);
    vi.mocked(listGroupMessages).mockReturnValue(new Promise((resolve) => (land = resolve)));
    render(<CastRoom group={room.group} blobs={room.blobs} onBack={onBack} onEdit={onEdit} />);
    expect(within(log()).getByText("Opening…")).toBeTruthy();
    await act(async () => land({ messages: [], typing: [], lastSeq: 0 }));
    expect(within(log()).getByText(/^Say hello\. The best-placed specialist starts/)).toBeTruthy();
    expect(log().querySelector(".kleio-chat-intro .blob-cluster")).toBeTruthy();
    // Nobody has had a turn, so nobody sat one out: each shows its job, in colour.
    expect(stage().querySelector(".is-idle")).toBeNull();
    expect(labels()).toEqual(room.blobs.map((b) => `Mention ${b.name}. ${b.job}`));
  });

  it("says why when the host can't be reached", async () => {
    const room = castGroup(4);
    vi.mocked(listGroupMessages).mockRejectedValue(new Error("Your host is asleep."));
    await act(async () => {
      render(<CastRoom group={room.group} blobs={room.blobs} onBack={onBack} onEdit={onEdit} />);
    });
    expect(screen.getByRole("alert").textContent).toBe("Your host is asleep.");
    expect(within(log()).queryByText("Opening…")).toBeNull();
  });
});

describe("how a turn ended", () => {
  const ended = (outcomes: Record<string, GroupTurnOutcome>): Partial<GroupMessagesPage> => ({
    ...QUIET,
    outcomes,
  });

  it("puts each ending under its member, and a stop's reason in a bubble above it", async () => {
    await draw(
      4,
      ended({
        scout: { kind: "passed", reason: "" },
        ledger: { kind: "timed_out", reason: "took over 2 min" },
        quill: { kind: "budget_exhausted", reason: "the group's turns ran out" },
        courier: { kind: "unavailable", reason: "" },
      }),
    );
    expect(labels()).toEqual([
      "Mention Scout. Passed",
      "Mention Ledger. Stopped: took over 2 min",
      "Mention Quill. Not reached: the group's turns ran out",
      "Mention Courier. Couldn't start",
    ]);
    expect(member("Scout").className).toBe("cast-actor cast-member is-plain");
    expect(member("Ledger").className).toBe("cast-actor cast-member is-failed");
    expect(member("Quill").className).toBe("cast-actor cast-member is-warn");
    expect(member("Courier").className).toBe("cast-actor cast-member is-failed");

    // Only a stop with a reason speaks: Ledger says why, in the shelf's bubble.
    const bubbles = stage().querySelectorAll(".cast-bubble");
    expect(bubbles).toHaveLength(1);
    expect(member("Ledger").contains(bubbles[0] ?? null)).toBe(true);
    expect(bubbles[0]?.getAttribute("title")).toBe("took over 2 min");
    expect(bubbles[0]?.querySelector(".cast-btxt")?.textContent).toBe("took over 2 min");
    // The conversation stays clean.
    expect(log().textContent).not.toMatch(/took over 2 min|Stopped/);
  });

  it("words a failed turn and an ending this build doesn't know", async () => {
    await draw(
      4,
      ended({
        scout: { kind: "failed", reason: "Gmail needs signing in" },
        ledger: { kind: "left_early", reason: "" } as unknown as GroupTurnOutcome,
      }),
    );
    expect(labels().slice(0, 2)).toEqual([
      "Mention Scout. Failed: Gmail needs signing in",
      "Mention Ledger. Ended",
    ]);
  });
});

describe("several at once", () => {
  it("gives each one replying its own spotlight and steps, and no baton without a handoff", async () => {
    const quill = castGroup(4).page.activity?.quill ?? [];
    await draw(4, {
      typing: ["scout", "quill"],
      outcomes: {},
      activity: { quill },
      // The newest message is yours: you chose who replies, nobody handed over.
      messages: castGroup(4).page.messages.slice(0, 5),
    });
    expect(stage().querySelectorAll(".cast-member.is-live")).toHaveLength(2);
    expect(stage().querySelectorAll(".cast-bubble.is-typing")).toHaveLength(2);
    expect(baton()).toBeNull();
    const replying = within(log()).getAllByRole("status");
    expect(replying.map((r) => r.querySelector(".cast-msg-who")?.textContent)).toEqual([
      "Scout is replying",
      "Quill is replying",
    ]);
    // Scout has made no tool call yet, so it has no steps to show.
    expect(within(replying[0] as HTMLElement).queryByRole("list")).toBeNull();
    expect(within(replying[1] as HTMLElement).getByRole("list")).toBeTruthy();
  });

  it("shows a member's question in place of its steps, and sends your pick", async () => {
    vi.mocked(answerGroupAsk).mockResolvedValue(undefined);
    await draw(4, {
      typing: ["scout", "quill"],
      asks: {
        quill: {
          id: "ask-7",
          questions: [
            {
              id: "q1",
              question: "Which evening?",
              kind: "choice",
              options: [{ label: "Friday" }, { label: "Saturday" }],
            },
          ],
        },
      },
    });
    expect(within(log()).getByText("Quill asks")).toBeTruthy();
    expect(
      within(log())
        .getAllByRole("status")
        .map((r) => r.querySelector(".cast-msg-who")?.textContent),
    ).toEqual(["Scout is replying"]);
    // On the shelf it is still its turn.
    expect(member("Quill").className).toContain("is-live");
    fireEvent.click(within(log()).getByRole("button", { name: /Saturday/ }));
    await waitFor(() =>
      expect(answerGroupAsk).toHaveBeenCalledWith("lisbon", "ask-7", "answer", { q1: "Saturday" }),
    );
  });
});

describe("a full room", () => {
  it("stands eight closer together, with only those in the turn saying anything", async () => {
    await draw(8);
    expect(stage().className).toBe("cast-room-stage is-crowd");
    expect(stage().style.getPropertyValue("--n")).toBe("8");
    expect(labels()).toEqual([
      "Mention Scout. Replied",
      "Mention Ledger. Handed over",
      "Mention Courier",
      "Mention Atlas",
      "Mention Tempo",
      "Mention Chef",
      "Mention Quill. Replying…",
      "Mention Concierge",
    ]);
    // Nobody is greyed out, only Quill bounces, and the idle blink on the calm clocks.
    expect(stage().querySelector(".is-idle")).toBeNull();
    expect(stage().querySelectorAll(".blob-av.is-live")).toHaveLength(1);
    expect(member("Scout").dataset.clock).toBe("c1");
    expect(member("Courier").querySelector(".cast-state")?.textContent).toBe("");
  });

  it("draws the long arc from Ledger across four places to Quill", async () => {
    await draw(8);
    const arc = baton() as HTMLElement;
    expect(arc.className).toBe("cast-baton is-long");
    expect(arc.style.getPropertyValue("--b-lo")).toBe("1");
    expect(arc.style.getPropertyValue("--b-span")).toBe("5");
    // The track is painted with its own gradient, brighter toward Quill.
    const track = arc.querySelector(".cast-baton-track");
    const gradient = arc.querySelector("linearGradient");
    expect(track?.getAttribute("stroke")).toBe(`url(#${gradient?.id})`);
    expect(arc.querySelector(".cast-baton-sweep .cast-baton-glow")).toBeTruthy();
  });

  it("fits eight mention chips with the compact look", async () => {
    await draw(8);
    const chips = screen.getByRole("group", { name: "Mention a member" });
    expect(chips.className).toBe("cast-mentions is-crowd");
    expect(within(chips).getAllByRole("button")).toHaveLength(8);
  });
});

describe("the room's rules", () => {
  const blobs = (size: RoomSize): Blob[] => castGroup(size).blobs;
  const says = (author: string, text: string): GroupMessage => ({
    seq: 1,
    id: "m1",
    author,
    authorName: author,
    emoji: "",
    text,
    at: CAST_NOW.toISOString(),
  });
  const room = (
    members: Blob[],
    typing: string[],
    messages: GroupMessage[] = [],
  ): ReturnType<typeof roomOf> => roomOf(members, { typing, outcomes: {}, messages });

  it("is a full room from six members", () => {
    expect(ROOM_CROWD_FROM).toBe(6);
    const eight = blobs(8);
    expect(room(eight.slice(0, 5), []).crowd).toBe(false);
    expect(room(eight.slice(0, 6), []).crowd).toBe(true);
    expect(room([], []).members).toEqual([]);
  });

  it("reads a handoff only from a member's newest message to one now replying", () => {
    const four = blobs(4);
    expect(room(four, ["quill"], [says("ledger", "@Quill over to you.")]).handoff).toEqual({
      from: 1,
      to: 2,
    });
    // Back along the shelf.
    expect(room(four, ["scout"], [says("courier", "@scout, one more check?")]).handoff).toEqual({
      from: 3,
      to: 0,
    });
    // Yours hands over to nobody; nor does a mention of someone who isn't replying,
    // of itself, or of a longer name that only starts the same.
    expect(room(four, ["quill"], [says("you", "@Quill please")]).handoff).toBeNull();
    expect(room(four, ["scout"], [says("ledger", "@Quill over to you.")]).handoff).toBeNull();
    expect(room(four, ["ledger"], [says("ledger", "@Ledger again")]).handoff).toBeNull();
    expect(room(four, ["quill"], [says("ledger", "@Quillon is not here")]).handoff).toBeNull();
    expect(room(four, ["quill"]).handoff).toBeNull();
  });

  it("marks who handed over even before the host reports how its turn ended", () => {
    const state = (size: RoomSize): string | undefined =>
      room(blobs(size), ["quill"], [says("ledger", "@Quill over to you.")]).members[1]?.state;
    expect(state(4)).toBe("Handed over");
    expect(state(8)).toBe("Handed over");
  });
});

describe("the side panel", () => {
  it("lists what was shared as tiles, newest first, each with who shared it", async () => {
    await draw();
    const side = panel() as HTMLElement;
    expect(within(side).getByRole("heading", { name: /^Assets/ }).textContent).toBe("Assets5");
    expect(within(side).getByText("Newest first")).toBeTruthy();
    const tiles = within(
      within(side).getByRole("list", { name: "Files shared in this conversation, newest first" }),
    ).getAllByRole("button");
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Open Offsite budget, shared by Ledger",
      "Open Dinner options, shared by Scout",
      "Open Late arrivals, shared by Courier",
      "Open Lisbon agenda (draft), shared by Quill",
      "Open Chiado walking map, shared by Scout",
    ]);
    expect(tiles.map((t) => t.querySelector(".cast-t-kind em")?.textContent)).toEqual([
      "XLSX",
      "MD",
      "CSV",
      "DOCX",
      "Site",
    ]);
    // Spreadsheets are marked, so the newest can be drawn as a sheet of cells.
    expect(tiles.map((t) => t.querySelector(".cast-t-kind")?.className)).toEqual([
      "cast-t-kind is-sheet",
      "cast-t-kind",
      "cast-t-kind is-sheet",
      "cast-t-kind",
      "cast-t-kind",
    ]);
    for (const t of tiles) expect(t.querySelector(".cast-t-by .blob-av")).toBeTruthy();
    expect(tiles[0]?.querySelector(".cast-t-by")?.textContent).toBe("Ledger");
    expect(tiles[0]?.getAttribute("title")).toBe("out/offsite-budget.xlsx");
  });

  it("opens a tile's file in the viewer, asked of the host as that member's in the group", async () => {
    vi.mocked(createFileShow).mockReturnValue(new Promise(() => {}));
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Open Dinner options, shared by Scout" }));
    expect(await screen.findByRole("dialog", { name: "Dinner options" })).toBeTruthy();
    expect(createFileShow).toHaveBeenCalledWith({
      source: "group",
      id: "lisbon",
      member: "scout",
      path: "out/dinner-options.md",
    });
  });

  it("switches off and on from the header, and remembers", async () => {
    await draw();
    const body = document.querySelector(".cast-room-body") as HTMLElement;
    expect(assetsButton().getAttribute("aria-pressed")).toBe("true");
    expect(assetsButton().getAttribute("aria-controls")).toBe(panel()?.id);
    expect(body.className).toBe("cast-room-body has-side");

    fireEvent.click(assetsButton());
    expect(assetsButton().getAttribute("aria-pressed")).toBe("false");
    expect(panel()).toBeNull();
    expect(document.querySelector<HTMLElement>(".cast-room-side")?.hidden).toBe(true);
    expect(body.className).toBe("cast-room-body");
    expect(localStorage.getItem("kleio-sidebar-hidden")).toBe("1");
    // The room is all still there.
    expect(labels()).toHaveLength(4);

    fireEvent.click(assetsButton());
    expect(panel()).toBeTruthy();
    expect(localStorage.getItem("kleio-sidebar-hidden")).toBe("0");
  });

  it("stays off when it was left off", async () => {
    localStorage.setItem("kleio-sidebar-hidden", "1");
    await draw();
    expect(panel()).toBeNull();
    expect(assetsButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("says what it is for before anything is shared", async () => {
    await draw(4, { messages: castGroup(4).page.messages.slice(0, 1) });
    const side = panel() as HTMLElement;
    expect(within(side).getByText("Files your specialists share will appear here.")).toBeTruthy();
    expect(within(side).getByRole("heading").textContent).toBe("Assets");
    expect(within(side).queryByText("Newest first")).toBeNull();
    expect(within(side).queryByRole("list")).toBeNull();
  });

  it("lies over the room in a narrow window, closed until asked for, and Escape puts it away", async () => {
    narrowWindow();
    await draw();
    const body = document.querySelector(".cast-room-body") as HTMLElement;
    expect(panel()).toBeNull();
    expect(body.className).toBe("cast-room-body is-narrow");
    fireEvent.click(assetsButton());
    expect(panel()).toBeTruthy();
    expect(body.className).toBe("cast-room-body has-side is-narrow");
    expect(screen.getByRole("button", { name: "Hide assets" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide assets" })).toBeNull();
    // A narrow window's choice is for now only.
    expect(localStorage.getItem("kleio-sidebar-hidden")).toBeNull();
  });
});

describe("a member who has gone", () => {
  it("says a specialist was deleted, and keeps its old messages readable", async () => {
    await draw(4, QUIET, (room) => {
      room.group.members.push("retired");
      room.blobs.splice(0, 1);
    });
    expect(screen.getByText("2 deleted specialists — edit the group to remove.")).toBeTruthy();
    expect(labels()).toHaveLength(3);
    expect(screen.getByText("5 members", { selector: ".cast-pill" })).toBeTruthy();
    // Scout is gone, its messages stay, with an empty place for its face.
    const scout = within(log()).getByText("Taberna do Largo").closest(".cast-msg") as HTMLElement;
    expect(scout.querySelector(":scope > .kleio-member-gone")).toBeTruthy();
    expect(scout.querySelector(".cast-msg-who")?.textContent).toBe("Scout14:07");
  });

  it("has no mention chips for a group of one", async () => {
    await draw(4, QUIET, (room) => {
      room.group.members.splice(1);
      room.blobs.splice(1);
    });
    expect(labels()).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Mention a member" })).toBeNull();
  });
});

describe("the room with reduced motion", () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{\n([\s\S]*?)\n\}\n?$/.exec(castCss);
  const rule = /^\s*([^{]+)\{([^}]*)\}/.exec(block?.[1] ?? "");

  it("holds everyone, the dots and the baton still, and leaves the arc to say who handed over", async () => {
    expect(rule?.[2]).toContain("animation: none !important");
    expect(rule?.[2]).toContain("transition: none !important");
    const still = (rule?.[1] ?? "").split(",").map((s) => s.trim());
    expect(still).toEqual(
      expect.arrayContaining([".cast-room *", ".cast-room *::before", ".cast-room *::after"]),
    );
    // The long arc's sweep is put away; its track, brighter toward the turn, stays.
    expect(block?.[1]).toMatch(/\.cast-baton-sweep \{\s*display: none;/);
    expect(block?.[1]).not.toMatch(/\.cast-baton(-track|-arc)? \{/);

    // Everything that moves is inside the room, so that rule reaches it: the
    // bounce, the blinks, the typing dots, the spark, the live dot, the running step.
    for (const size of [4, 8] as const) {
      await draw(size);
      const root = document.querySelector(".cast-room") as HTMLElement;
      for (const sel of [
        ".blob-av.is-live .blob-av-body",
        ".blob-av.is-animated .blob-av-eyes",
        ".cast-bubble.is-typing i",
        size === 4 ? ".cast-baton-spark" : ".cast-baton-sweep",
        ".cast-dot",
        ".tool-dot.blink",
        ".cast-member.is-live",
        ".cast-mentions button",
        ".cast-input",
        ".cast-tiles button",
      ]) {
        const found = [...document.querySelectorAll(sel)];
        expect(found.length, sel).toBeGreaterThan(0);
        for (const el of found) expect(root.contains(el) && el !== root, sel).toBe(true);
      }
      cleanup();
    }
  });

  it("declares no animation or easing in the room's styles on anything outside it", () => {
    const styles = castCss
      .slice(castCss.indexOf("/* ── the group's room"), block?.index)
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const moving = (property: string): string[] =>
      [...styles.matchAll(new RegExp(`([^{}]+)\\{[^{}]*\\b${property}:`, "g"))].map((m) =>
        (m[1] ?? "").trim(),
      );
    expect(moving("animation")).toEqual([
      ".cast-bubble.is-typing i",
      ".cast-baton-spark",
      ".cast-baton-sweep",
    ]);
    expect(moving("transition")).toEqual([
      ".cast-mentions button",
      ".cast-input",
      ".cast-tiles button",
    ]);
  });
});
