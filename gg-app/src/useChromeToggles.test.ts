// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useChromeToggles } from "./useChromeToggles";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("platform-ios");
});

describe("useChromeToggles, the live tool panel", () => {
  it("starts open, on the desktop and on the phone", () => {
    expect(renderHook(() => useChromeToggles()).result.current.toolsHidden).toBe(false);
    document.documentElement.classList.add("platform-ios");
    expect(renderHook(() => useChromeToggles()).result.current.toolsHidden).toBe(false);
  });

  it("keeps a choice already saved, on either", () => {
    localStorage.setItem("gg-tools-hidden", "1");
    expect(renderHook(() => useChromeToggles()).result.current.toolsHidden).toBe(true);
    document.documentElement.classList.add("platform-ios");
    expect(renderHook(() => useChromeToggles()).result.current.toolsHidden).toBe(true);
  });

  it("saves the choice the toggle makes", () => {
    document.documentElement.classList.add("platform-ios");
    const { result } = renderHook(() => useChromeToggles());
    act(() => result.current.toggleTools());
    expect(result.current.toolsHidden).toBe(true);
    expect(localStorage.getItem("gg-tools-hidden")).toBe("1");
    expect(renderHook(() => useChromeToggles()).result.current.toolsHidden).toBe(true);
  });
});
