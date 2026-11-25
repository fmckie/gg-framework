// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import themeCss from "./kleio/kleio-theme.css?raw";
import { WakeScreen } from "./WakeScreen";

const SUBTITLE = "A new conversation in this project.";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("platform-ios");
});

// A canvas that records what the rain draws, in a 200 by 100 window in focus.
function rain(vars: Record<string, string>) {
  const ctx = {
    font: "",
    fillStyle: "",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name: string) => vars[name] ?? "",
  } as never);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  render(<WakeScreen chat />);
  frame(1000);
  return ctx;
}

describe("the empty chat", () => {
  it("adds the line under a Chat's invitation on the desktop", () => {
    const { container } = render(<WakeScreen chat />);
    expect(container.querySelector(".wake-sub")?.textContent).toBe(SUBTITLE);
    expect(container.querySelector(".wake-text + .wake-sub")).not.toBeNull();
  });

  it("keeps Code, Motion and the iPhone to the one line", () => {
    expect(render(<WakeScreen />).container.querySelector(".wake-sub")).toBeNull();
    expect(render(<WakeScreen motion />).container.querySelector(".wake-sub")).toBeNull();
    document.documentElement.classList.add("platform-ios");
    expect(render(<WakeScreen chat />).container.querySelector(".wake-sub")).toBeNull();
  });

  it("draws the rain in the theme's one colour, size and weight", () => {
    const ctx = rain({
      "--wake-rain-lead": "#ed7380",
      "--wake-rain": "#ed7380",
      "--wake-rain-size": "20",
      "--wake-rain-weight": "700",
    });
    expect(ctx.font).toBe("700 20px ui-monospace, SFMono-Regular, Menlo, monospace");
    // One glyph per 20px column, each in the crimson.
    expect(ctx.fillText).toHaveBeenCalledTimes(10);
    expect(ctx.fillStyle).toBe("#ed7380");
  });

  it("keeps the 14px regular rain where the theme sets no size or weight", () => {
    const ctx = rain({});
    expect(ctx.font).toBe("14px ui-monospace, SFMono-Regular, Menlo, monospace");
    expect(ctx.fillText).toHaveBeenCalledTimes(14);
  });

  it("gives the desktop the approved crimson rain and cursor, and leaves the iPhone's", () => {
    expect(themeCss).toMatch(
      /\nhtml:not\(\.platform-ios\) \{\n {2}--wake-rain-lead: #ed7380;\n {2}--wake-rain: #ed7380;\n {2}--wake-rain-size: 20;\n {2}--wake-rain-weight: 700;\n\}/,
    );
    expect(themeCss).toMatch(
      /html:not\(\.platform-ios\) \.app\.app-session \.wake-rain \{\n {2}opacity: 0\.85;/,
    );
    expect(themeCss).toMatch(
      /html:not\(\.platform-ios\) \.app\.app-session :is\(\.wake-cursor, \.wake-cursor-rest\) \{\n {2}color: #ed7380;\n\}/,
    );
    expect(themeCss).toContain("  --wake-rain: rgba(200, 40, 58, 0.55);\n");
  });
});
