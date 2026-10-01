// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { bottomCovered, keyboardOpen, onScreenKeyboardUp } from "./phone-viewport";

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
