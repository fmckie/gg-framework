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

// In this order: the first asks for the chunk, the second finds it loaded.
describe("where the courtyard goes in a goal's Workers view", () => {
  it("on the iPhone: nothing while its chunk loads, then the stage, hidden from assistive technology", async () => {
    document.documentElement.classList.add("platform-ios");
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

  it("on the desktop: the same stage, from the same chunk", async () => {
    document.documentElement.classList.add("platform-macos");
    const { container } = render(<CourtMount agents={agents} hearth="working" />);
    await waitFor(() => expect(container.querySelector(".oly-court")).not.toBeNull());
    await settle();
    expect(courtChunk.loads).toBe(1);
    const court = container.firstElementChild!;
    expect(court.getAttribute("aria-hidden")).toBe("true");
    expect(court.querySelectorAll(".oly-terrace")).toHaveLength(3);
    expect(court.querySelector(".oly-hearth")).not.toBeNull();
  });

  it("hands the stage a finished stretch's laurel: the one who gives it comes for its god", async () => {
    document.documentElement.classList.add("platform-macos");
    const done: CourtAgent[] = [{ ...agents[0]!, status: "done" }];
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 698 });
    try {
      const { container } = render(<CourtMount agents={done} hearth="finished" laurel="1:a" />);
      await waitFor(() => expect(container.querySelector(".oly-herald")).not.toBeNull());
      expect(container.querySelector<HTMLElement>(".oly-hearth")?.dataset.state).toBe("finished");
      expect(container.querySelectorAll(".oly-cell")).toHaveLength(2);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    }
  });
});
