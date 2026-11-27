// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Item } from "../transcript-item";
import { agentsAt, MOCK_RUN } from "./fixtures";

// The lane's chunk won't load.
const laneChunk = vi.hoisted(() => ({ asked: 0 }));
vi.mock("./OlympusLane", () => {
  laneChunk.asked += 1;
  throw new Error("Failed to fetch dynamically imported module");
});

const { LaneMount } = await import("./LaneMount");

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
});

it("a lane whose chunk won't load is no lane, and nothing is thrown", async () => {
  document.documentElement.classList.add("platform-macos");
  const live: Item = { kind: "subagent_group", id: 40, agents: agentsAt(MOCK_RUN, 12_000) };
  const { container } = render(<LaneMount items={[live]} />);
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  expect(laneChunk.asked).toBe(1);
  expect(container.innerHTML).toBe("");
});
