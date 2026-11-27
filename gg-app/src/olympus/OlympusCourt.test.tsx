// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtAgent, Courtyard } from "./courtyard";
import { framedHost, type ManualHost } from "./fixtures";
import { OlympusCourt, type CourtStage } from "./OlympusCourt";

// jsdom draws nothing: the floors go undrawn.
let canvas: { mockRestore(): void };
beforeEach(() => {
  canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((() => null) as unknown as HTMLCanvasElement["getContext"]);
});
afterEach(() => {
  cleanup();
  canvas.mockRestore();
  vi.unstubAllGlobals();
});

// A courtyard on a clock that moves only when told to.
function staged(): CourtStage & { host: ManualHost; courts: (Courtyard | null)[]; at: number } {
  const host = framedHost();
  const courts: (Courtyard | null)[] = [];
  const stage = {
    host,
    courts,
    at: 698,
    width: (): number => stage.at,
    reduced: (): boolean => false,
    fidget: false,
    onCourt: (court: Courtyard | null): void => void courts.push(court),
  };
  return stage;
}

const OWL: CourtAgent = {
  key: "1:a",
  god: "athena",
  label: "owl",
  status: "working",
  family: "look",
};
const BEE: CourtAgent = {
  key: "1:b",
  god: "hephaestus",
  label: "bee",
  status: "working",
  family: "make",
};
const cells = (container: HTMLElement): (string | undefined)[] =>
  [...container.querySelectorAll<HTMLElement>(".oly-cell")].map((cell) => cell.dataset.key);

describe("the courtyard in a goal's Workers view", () => {
  it("is a frame hidden from assistive technology, with the stage built in it", () => {
    const stage = staged();
    const { container } = render(<OlympusCourt agents={[]} hearth="idle" stage={stage} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("oly-court");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(container.childElementCount).toBe(1);
    expect(root.querySelectorAll(".oly-terrace")).toHaveLength(3);
    expect(root.querySelector(".oly-hearth")).not.toBeNull();
    expect(stage.courts).toHaveLength(1);
  });

  it("gives the engine its workers and the coordinator's state, each time they change", () => {
    const stage = staged();
    const { container, rerender } = render(
      <OlympusCourt agents={[OWL]} hearth="working" stage={stage} />,
    );
    act(() => stage.host.advance(0));
    expect(cells(container)).toEqual(["1:a"]);
    expect(container.querySelector<HTMLElement>(".oly-hearth")?.dataset.state).toBe("working");
    expect(container.querySelector(".oly-ins")?.textContent).toBe("owl");
    rerender(<OlympusCourt agents={[OWL, BEE]} hearth="waiting" stage={stage} />);
    act(() => stage.host.advance(0));
    expect(cells(container)).toEqual(["1:a", "1:b"]);
    expect(container.querySelector<HTMLElement>(".oly-hearth")?.dataset.state).toBe("waiting");
    expect(stage.courts[0]?.peek().gods.map((g) => [g.key, g.zone])).toEqual([
      ["1:a", "look"],
      ["1:b", "make"],
    ]);
  });

  it("marks the name of the god whose row is pointed at, and says whose god the pointer is on", () => {
    const stage = staged();
    const hovers: (string | null)[] = [];
    const draw = (marked: string | null): React.ReactElement => (
      <OlympusCourt
        agents={[OWL, BEE]}
        hearth="idle"
        marked={marked}
        onHover={(key) => hovers.push(key)}
        stage={stage}
      />
    );
    const { container, rerender } = render(draw(null));
    act(() => stage.host.advance(0));
    const marks = (): boolean[] =>
      [...container.querySelectorAll(".oly-ins")].map((el) => el.classList.contains("is-marked"));
    expect(marks()).toEqual([false, false]);
    rerender(draw("1:b"));
    expect(marks()).toEqual([false, true]);
    rerender(draw(null));
    expect(marks()).toEqual([false, false]);
    const cell = container.querySelector(".oly-cell")!;
    cell.dispatchEvent(new Event("pointerenter"));
    cell.dispatchEvent(new Event("pointerleave"));
    expect(hovers).toEqual(["1:a", null]);
  });

  it("tells the engine when its width is another, and only then", () => {
    let observed: ((entries: { contentRect: { width: number } }[]) => void) | null = null;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(fn: typeof observed) {
          observed = fn;
        }
        observe(): void {}
        disconnect = disconnect;
      },
    );
    const stage = staged();
    const { unmount } = render(<OlympusCourt agents={[OWL]} hearth="idle" stage={stage} />);
    act(() => stage.host.advance(0));
    const court = stage.courts[0]!;
    const resize = vi.spyOn(court, "resize");
    observed!([{ contentRect: { width: 698 } }]);
    observed!([{ contentRect: { width: 698.3 } }]);
    expect(resize).toHaveBeenCalledTimes(1);
    stage.at = 462;
    observed!([{ contentRect: { width: 462 } }]);
    act(() => stage.host.advance(0));
    expect(resize).toHaveBeenCalledTimes(2);
    expect(court.peek().width).toBe(462);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("is taken down with its view: the stage emptied, and its clock stopped", () => {
    const stage = staged();
    const { container, unmount } = render(
      <OlympusCourt agents={[OWL]} hearth="working" stage={stage} />,
    );
    act(() => stage.host.advance(2000));
    const root = container.firstElementChild!;
    unmount();
    expect(root.childElementCount).toBe(0);
    expect(stage.courts).toEqual([expect.anything(), null]);
    expect(stage.host.pending()).toBe(0);
  });
});
