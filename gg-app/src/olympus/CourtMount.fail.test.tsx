// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// The courtyard's chunk won't load.
const courtChunk = vi.hoisted(() => ({ asked: 0 }));
vi.mock("./OlympusCourt", () => {
  courtChunk.asked += 1;
  throw new Error("Failed to fetch dynamically imported module");
});

const { CourtMount } = await import("./CourtMount");

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
});

it("a courtyard whose chunk won't load is no courtyard, and nothing is thrown", async () => {
  document.documentElement.classList.add("platform-macos");
  const { container } = render(
    <CourtMount
      agents={[{ key: "1:a", god: "athena", label: "owl", status: "working", family: "look" }]}
      hearth="working"
    />,
  );
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  expect(courtChunk.asked).toBe(1);
  expect(container.innerHTML).toBe("");
});
