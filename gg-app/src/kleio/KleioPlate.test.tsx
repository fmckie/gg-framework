// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KleioPlate, PLATE_H, PLATE_W } from "./KleioPlate";

/** What one canvas was asked to draw. */
interface Drawn {
  fills: number;
  copies: number;
}
const drawn = new Map<HTMLCanvasElement, Drawn>();

beforeEach(() => {
  // jsdom draws nothing: count the calls each canvas gets instead.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const record = drawn.get(this) ?? { fills: 0, copies: 0 };
    drawn.set(this, record);
    return {
      fillStyle: "",
      imageSmoothingEnabled: true,
      clearRect: () => {},
      fillRect: () => void record.fills++,
      drawImage: () => void record.copies++,
    } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement["getContext"]);
  // Reduced motion: the plate jumps to where the spring would settle.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
});
afterEach(() => {
  cleanup();
  drawn.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** How far the plate sits from rest, in art pixels (down is positive). */
function sunk(button: HTMLElement): string {
  return button
    .querySelector<HTMLElement>(".kleio-plate-face")!
    .style.getPropertyValue("--plate-y");
}

describe("KleioPlate", () => {
  it("is a button named by its word, drawn on three canvases of 124×46 art pixels", () => {
    render(<KleioPlate label="Talk to Kleio" />);
    const plate = screen.getByRole("button", { name: "Talk to Kleio" });
    expect(plate.getAttribute("type")).toBe("button");
    const layers = [...plate.querySelectorAll("canvas")];
    expect(layers).toHaveLength(3);
    for (const layer of layers) {
      expect([layer.width, layer.height]).toEqual([PLATE_W, PLATE_H]);
      expect(layer.getAttribute("aria-hidden")).toBe("true");
      expect(drawn.get(layer)!.fills).toBeGreaterThan(0);
    }
    // The front lip is the socket's own foot, copied over the plate.
    expect(layers.map((layer) => drawn.get(layer)!.copies)).toEqual([0, 0, 1]);
    expect([PLATE_W, PLATE_H]).toEqual([124, 46]);
  });

  it("lifts when pointed at, sinks when pressed and comes back to rest", () => {
    const onClick = vi.fn();
    render(<KleioPlate label="Code" onClick={onClick} />);
    const plate = screen.getByRole("button", { name: "Code" });
    expect(sunk(plate)).toBe("0");
    fireEvent.pointerEnter(plate);
    expect(sunk(plate)).toBe("-2");
    fireEvent.pointerDown(plate, { button: 0 });
    expect(sunk(plate)).toBe("7");
    fireEvent.pointerUp(plate);
    expect(sunk(plate)).toBe("-2");
    fireEvent.pointerLeave(plate);
    expect(sunk(plate)).toBe("0");
    fireEvent.click(plate);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("sinks for Enter and Space too, and ignores the other mouse buttons", () => {
    render(<KleioPlate label="Goals" />);
    const plate = screen.getByRole("button", { name: "Goals" });
    fireEvent.keyDown(plate, { key: "Enter" });
    expect(sunk(plate)).toBe("7");
    fireEvent.keyUp(plate, { key: "Enter" });
    expect(sunk(plate)).toBe("0");
    fireEvent.keyDown(plate, { key: " " });
    expect(sunk(plate)).toBe("7");
    fireEvent.keyUp(plate, { key: " " });
    fireEvent.pointerDown(plate, { button: 2 });
    expect(sunk(plate)).toBe("0");
  });

  it("sits sunk and marked off while dimmed, still clicks, and rises when ready", () => {
    const onClick = vi.fn();
    const { rerender } = render(<KleioPlate label="Motion" dimmed onClick={onClick} />);
    const plate = screen.getByRole("button", { name: "Motion" });
    expect(plate.className).toBe("kleio-plate is-dimmed");
    expect(plate.getAttribute("aria-disabled")).toBe("true");
    expect(sunk(plate)).toBe("7");
    fireEvent.pointerEnter(plate);
    expect(sunk(plate)).toBe("7");
    fireEvent.click(plate);
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<KleioPlate label="Motion" onClick={onClick} />);
    expect(plate.className).toBe("kleio-plate");
    expect(plate.getAttribute("aria-disabled")).toBeNull();
    expect(sunk(plate)).toBe("0");
  });

  it("keeps the class and the attributes it is given", () => {
    render(<KleioPlate className="home-brief" label="Brief me" title="Hear it" />);
    const plate = screen.getByRole("button", { name: "Brief me" });
    expect(plate.className).toBe("kleio-plate home-brief");
    expect(plate.getAttribute("title")).toBe("Hear it");
  });
});
