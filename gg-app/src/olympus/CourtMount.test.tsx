// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtAgent } from "./courtyard";

// Counts each time the courtyard's chunk is asked for.
const courtChunk = vi.hoisted(() => ({ loads: 0 }));
vi.mock("./OlympusCourt", async (original) => {
  courtChunk.loads += 1;
  return original();
});

const { CourtMount } = await import("./CourtMount");

let canvas: { mockRestore(): void };
beforeEach(() => {
  canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((() => null) as unknown as HTMLCanvasElement["getContext"]);
});
afterEach(() => {
  cleanup();
  canvas.mockRestore();
  document.documentElement.className = "";
});

const agents: CourtAgent[] = [
  { key: "1:a", god: "athena", label: "owl", status: "working", family: "look" },
];
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

// In this order: the first shows the chunk was never asked for, which only
// holds until the second asks for it.
describe("where the courtyard goes in a goal's Workers view", () => {
  it("on the iPhone: no stage, and its chunk is never loaded", async () => {
    document.documentElement.classList.add("platform-ios");
    const { container } = render(<CourtMount agents={agents} hearth="working" />);
    await settle();
    expect(container.innerHTML).toBe("");
    expect(document.querySelector(".oly-court, .oly-cell")).toBeNull();
    expect(courtChunk.loads).toBe(0);
  });

  it("on the desktop: nothing while its chunk loads, then the stage, hidden from assistive technology", async () => {
    document.documentElement.classList.add("platform-macos");
    const { container } = render(<CourtMount agents={agents} hearth="working" />);
    expect(container.innerHTML).toBe("");
    await waitFor(() => expect(container.querySelector(".oly-court")).not.toBeNull());
    expect(courtChunk.loads).toBe(1);
    expect(container.childElementCount).toBe(1);
    const court = container.firstElementChild!;
    expect(court.getAttribute("aria-hidden")).toBe("true");
    expect(court.querySelectorAll(".oly-terrace")).toHaveLength(3);
    // The coordinator's hearth is there before any worker is.
    expect(court.querySelector(".oly-hearth")).not.toBeNull();
  });
});
