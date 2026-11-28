// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Item } from "../transcript-item";
import { agentsAt, MOCK_CROWD, MOCK_RUN, RESUMED_AGENTS } from "./fixtures";

// Counts each time the lane's chunk is asked for.
const laneChunk = vi.hoisted(() => ({ loads: 0 }));
vi.mock("./OlympusLane", async (original) => {
  laneChunk.loads += 1;
  return original();
});

const { LaneMount, liveGroups } = await import("./LaneMount");

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
});

const live: Item = { kind: "subagent_group", id: 40, agents: agentsAt(MOCK_RUN, 12_000) };
const resumed: Item = { kind: "subagent_group", id: 41, agents: [...RESUMED_AGENTS] };
const text: Item = { kind: "info", id: 42, text: "Out of plan mode." };
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe("the groups the lane is mounted for", () => {
  it("are those with an agent this window saw at work", () => {
    expect(liveGroups([text, resumed, live, text])).toEqual([live]);
    expect(liveGroups([text, resumed])).toEqual([]);
    expect(liveGroups([])).toEqual([]);
  });
});

// In this order: the first show the lane's chunk was never asked for, which
// only holds until the desktop's lane asks for it.
describe("where the lane goes in a session", () => {
  const platforms = [
    ["the desktop", "platform-macos"],
    ["the iPhone", "platform-ios"],
  ] as const;

  it.each(platforms)("on %s, a chat with no subagents: no lane, no chunk", async (_, platform) => {
    document.documentElement.classList.add(platform);
    const { container } = render(<LaneMount items={[text]} />);
    await settle();
    expect(container.innerHTML).toBe("");
    expect(laneChunk.loads).toBe(0);
  });

  it.each(platforms)("on %s, a resumed chat's rows: no lane, no chunk", async (_, platform) => {
    document.documentElement.classList.add(platform);
    const { container } = render(<LaneMount items={[text, resumed]} />);
    await settle();
    expect(container.innerHTML).toBe("");
    expect(laneChunk.loads).toBe(0);
  });

  it("on the desktop, once an agent is at work: the card's frame, hidden, and then the lane", async () => {
    document.documentElement.classList.add("platform-macos");
    const { container, rerender } = render(<LaneMount items={[text, resumed]} />);
    rerender(<LaneMount items={[text, resumed, live]} />);
    expect(container.querySelector(".oly-lane")).toBeNull(); // nothing stands in while it loads
    await waitFor(() => expect(container.querySelector(".oly-lane")).not.toBeNull());
    expect(laneChunk.loads).toBe(1);
    // Two children of the session's live region, the lane last: it still meets what comes after it.
    expect([...container.children].map((el) => el.classList[0])).toEqual([
      "oly-card-anchor",
      "oly-lane",
    ]);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".oly-card")?.childElementCount).toBe(0);
    // The lane is no longer hidden whole: its gods are a toolbar.
    const lane = container.lastElementChild!;
    expect(lane.hasAttribute("aria-hidden")).toBe(false);
    expect(lane.querySelector("[role='toolbar']")?.getAttribute("aria-label")).toBe(
      "Subagents on the lane",
    );
  });

  it("on the iPhone, once an agent is at work: the same lane, from the same chunk", async () => {
    document.documentElement.classList.add("platform-ios");
    const { container } = render(<LaneMount items={[text, live]} />);
    await waitFor(() => expect(container.querySelector(".oly-lane")).not.toBeNull());
    expect(laneChunk.loads).toBe(1);
    expect([...container.children].map((el) => el.classList[0])).toEqual([
      "oly-card-anchor",
      "oly-lane",
    ]);
    expect(container.querySelector(".oly-lane [role='toolbar']")?.getAttribute("aria-label")).toBe(
      "Subagents on the lane",
    );
  });

  it("on the iPhone, more agents than a lane holds: the lane mounts all the same", async () => {
    document.documentElement.classList.add("platform-ios");
    const crowd: Item = { kind: "subagent_group", id: 43, agents: agentsAt(MOCK_CROWD, 12_000) };
    expect(crowd.kind === "subagent_group" && crowd.agents.length).toBeGreaterThan(5);
    const { container } = render(<LaneMount items={[text, crowd]} />);
    await waitFor(() => expect(container.querySelector(".oly-lane")).not.toBeNull());
  });
});
