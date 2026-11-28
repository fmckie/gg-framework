// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentsAt, MOCK_RUN } from "./olympus/fixtures";

// Counts each time the rows are asked for.
const rowsChunk = vi.hoisted(() => ({ loads: 0 }));
vi.mock("./olympus/OlympusRows", async (original) => {
  rowsChunk.loads += 1;
  return original();
});

// The row's imports reach agent.ts, which reads the current window at load.
mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { TranscriptRow } = await import("./TranscriptRow");

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
});

// In this order: the feed only stands in the first time the rows are asked for.
describe("a turn's subagents", () => {
  const group = {
    kind: "subagent_group" as const,
    id: 40,
    agents: agentsAt(MOCK_RUN, 12_000),
  };

  it("on the desktop: today's feed while the rows load, then a row for each agent", async () => {
    document.documentElement.classList.add("platform-macos");
    const { container } = render(<TranscriptRow item={group} />);
    expect(container.querySelector(".subagents-head")?.textContent).toContain("4 agents running");
    expect(container.querySelectorAll(".subagent")).toHaveLength(4);
    expect(container.querySelector(".oly-rows")).toBeNull();
    await waitFor(() => expect(container.querySelector(".oly-rows")).not.toBeNull());
    expect(rowsChunk.loads).toBe(1);
    expect(container.querySelector(".subagents")).toBeNull();
    expect([...container.querySelectorAll(".oly-god")].map((god) => god.textContent)).toEqual([
      "Athena",
      "Hephaestus",
      "Argus",
      "Nike",
    ]);
  });

  it("on the iPhone: the same rows, from the same chunk", async () => {
    document.documentElement.classList.add("platform-ios");
    const { container } = render(<TranscriptRow item={group} />);
    await waitFor(() => expect(container.querySelectorAll(".oly-row")).toHaveLength(4));
    expect(rowsChunk.loads).toBe(1);
    expect(container.querySelector(".subagents")).toBeNull();
    expect([...container.querySelectorAll(".oly-god")].map((god) => god.textContent)).toEqual([
      "Athena",
      "Hephaestus",
      "Argus",
      "Nike",
    ]);
  });

  it("on the desktop: a stopped run reaches the rows as stopped", async () => {
    document.documentElement.classList.add("platform-macos");
    const { container } = render(<TranscriptRow item={{ ...group, aborted: true }} />);
    await waitFor(() => expect(container.querySelectorAll(".oly-row.is-stop")).toHaveLength(4));
  });
});

describe("a question to Helper", () => {
  it("wraps its leading mention in a span and keeps its full text", () => {
    const text = "@Help how do I copy a block?";
    const { container } = render(<TranscriptRow item={{ kind: "user", id: 1, text, ken: true }} />);
    const bubble = container.querySelector(".user-msg.user-ken");
    const mentions = container.querySelectorAll(".helper-mention");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.textContent).toBe("@Help");
    expect(bubble?.textContent).toBe(text);
  });

  it("has no span when the text does not start with a mention", () => {
    const text = "ask @helper about this, or see @helper.ts";
    const { container } = render(<TranscriptRow item={{ kind: "user", id: 2, text, ken: true }} />);
    expect(container.querySelector(".helper-mention")).toBeNull();
    expect(container.querySelector(".user-msg.user-ken")?.textContent).toBe(text);
  });

  it("leaves a message to Kleio alone, even one that opens with the mention", () => {
    const text = "@helper is the name of the trigger";
    const { container } = render(<TranscriptRow item={{ kind: "user", id: 3, text }} />);
    expect(container.querySelector(".helper-mention")).toBeNull();
    expect(container.querySelector(".user-msg")?.textContent).toBe(text);
  });
});
