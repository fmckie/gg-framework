// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContextButton, contextFill } from "./ContextButton";

afterEach(cleanup);

const trigger = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".ctx-button")!;
const popover = () => document.body.querySelector<HTMLElement>(".usage-popover");

describe("ContextButton", () => {
  it("is a button that reads Context and the percentage", () => {
    const { container } = render(<ContextButton pct={19} />);
    const button = trigger(container);
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("Context19%");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("shows Context 0% with an empty track", () => {
    const { container } = render(<ContextButton pct={0} />);
    expect(trigger(container).textContent).toBe("Context0%");
    expect(container.querySelector<HTMLElement>(".ctx-track i")?.style.width).toBe("0%");
  });

  it("ramps the fill from green to red with no steps", () => {
    expect(contextFill(0)).toBe("hsl(120 70% 65%)");
    expect(contextFill(19)).toBe("hsl(97.2 70% 65%)");
    expect(contextFill(50)).toBe("hsl(60 70% 65%)");
    expect(contextFill(100)).toBe("hsl(0 70% 65%)");
  });

  it("opens Usage with the same reading, and focuses its close button", () => {
    const { container } = render(<ContextButton pct={19} />);
    expect(popover()).toBeNull();
    fireEvent.click(trigger(container));
    const dialog = popover()!;
    expect(trigger(container).getAttribute("aria-expanded")).toBe("true");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.querySelector("h3")?.textContent).toBe("Usage");
    expect(dialog.querySelector("strong")?.textContent).toBe("19%");
    const meter = dialog.querySelector<HTMLElement>("[role=meter]")!;
    expect(meter.getAttribute("aria-valuenow")).toBe("19");
    expect(meter.querySelector<HTMLElement>("i")?.style.width).toBe("19%");
    expect(dialog.querySelector("small")?.textContent).toBe("Measured when the last turn ended.");
    expect(document.activeElement).toBe(dialog.querySelector(".usage-close"));
    expect(dialog.textContent).not.toMatch(/\$|cost|bill|illustrative/i);
  });

  it("opens Usage on an empty chat at 0% and says there is no reading", () => {
    const { container } = render(<ContextButton pct={0} />);
    fireEvent.click(trigger(container));
    expect(popover()?.querySelector("strong")?.textContent).toBe("0%");
    expect(popover()?.querySelector("small")?.textContent).toBe(
      "No reading yet. It is measured when a turn ends.",
    );
  });

  it("closes with Escape, the close button or Context again, and focus returns", () => {
    const { container } = render(<ContextButton pct={19} />);
    const button = trigger(container);
    const closers = [
      () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }),
      () => fireEvent.click(popover()!.querySelector(".usage-close")!),
      () => fireEvent.click(button),
    ];
    for (const closeIt of closers) {
      fireEvent.click(button);
      expect(popover()).not.toBeNull();
      closeIt();
      expect(popover()).toBeNull();
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(button);
    }
  });

  it("closes on a click outside, and not on a click inside", () => {
    const { container } = render(<ContextButton pct={19} />);
    fireEvent.click(trigger(container));
    fireEvent.pointerDown(popover()!.querySelector("p")!);
    expect(popover()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(popover()).toBeNull();
  });
});
