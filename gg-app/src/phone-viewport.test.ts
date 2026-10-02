// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  bottomCovered,
  keyboardOpen,
  onScreenKeyboardUp,
  trackVisualViewport,
} from "./phone-viewport";

/** A window with the iPhone's two viewports: the page's and the visible part. */
function phoneWindow(screen: number): {
  win: Window;
  root: HTMLElement;
  /** The keyboard (or nothing) covers the bottom; iOS 26 shrinks innerHeight too. */
  cover: (px: number, innerShrinks: boolean) => void;
} {
  const doc = document.implementation.createHTMLDocument();
  const root = doc.documentElement;
  Object.defineProperty(root, "clientHeight", { get: () => screen });
  const vv = Object.assign(new EventTarget(), { height: screen });
  const win = Object.assign(new EventTarget(), {
    document: doc,
    visualViewport: vv,
    innerHeight: screen,
    scrollX: 0,
    scrollY: 0,
    scrollTo: () => {},
  }) as unknown as Window;
  return {
    win,
    root,
    cover: (px, innerShrinks) => {
      vv.height = screen - px;
      (win as { innerHeight: number }).innerHeight = innerShrinks ? screen - px : screen;
      vv.dispatchEvent(new Event("resize"));
    },
  };
}

describe("trackVisualViewport", () => {
  it.each([
    ["innerHeight stays put", false],
    ["innerHeight shrinks with it (iOS 26)", true],
  ])("sees the on-screen keyboard when %s", (_, innerShrinks) => {
    const { win, root, cover } = phoneWindow(874);
    const stop = trackVisualViewport(win);

    cover(345, innerShrinks);

    expect(root.style.getPropertyValue("--app-height")).toBe("529px");
    expect(root.classList.contains("keyboard-open")).toBe(true);
    expect(root.classList.contains("bottom-covered")).toBe(true);
    stop();
  });

  it("clears both once the keyboard goes", () => {
    const { win, root, cover } = phoneWindow(874);
    const stop = trackVisualViewport(win);
    cover(345, true);

    cover(0, true);

    expect(root.classList.contains("keyboard-open")).toBe(false);
    expect(root.classList.contains("bottom-covered")).toBe(false);
    stop();
  });
});

describe("keyboardOpen", () => {
  it("is true when the on-screen keyboard covers the bottom of the screen", () => {
    expect(keyboardOpen(874, 874 - 336)).toBe(true);
  });

  it("ignores the slim bar shown above a hardware keyboard", () => {
    expect(keyboardOpen(874, 874 - 68)).toBe(false);
  });

  it("is false with nothing covering the screen", () => {
    expect(keyboardOpen(874, 874)).toBe(false);
  });
});

describe("bottomCovered", () => {
  it("counts the slim bar above a hardware keyboard", () => {
    expect(bottomCovered(874, 874 - 68)).toBe(true);
  });

  it("ignores rounding noise", () => {
    expect(bottomCovered(874, 873)).toBe(false);
  });
});

describe("onScreenKeyboardUp", () => {
  it("reads the class the viewport tracker sets", () => {
    const doc = document.implementation.createHTMLDocument();
    expect(onScreenKeyboardUp(doc)).toBe(false);

    doc.documentElement.classList.add("keyboard-open");

    expect(onScreenKeyboardUp(doc)).toBe(true);
  });
});
