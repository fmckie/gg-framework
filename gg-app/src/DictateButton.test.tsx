// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { appendDictation, DictateButton, DictationStatus } from "./DictateButton";
import type { DictationPhase, UseDictation } from "./useDictation";

function dictationIn(phase: DictationPhase, elapsedMs = 0): UseDictation {
  return { phase, elapsedMs, toggle: vi.fn() };
}

afterEach(cleanup);

describe("appendDictation", () => {
  it.each([
    ["", "Fix the header.", "Fix the header."],
    ["   ", "Fix the header.", "Fix the header."],
    ["Look at the build.", "Then ship it.", "Look at the build. Then ship it."],
    ["Look at the build.  \n", "Then ship it.", "Look at the build. Then ship it."],
  ])("%j + %j is %j", (draft, text, expected) => {
    expect(appendDictation(draft, text)).toBe(expected);
  });

  it("keeps the joined draft within a box's limit", () => {
    expect(appendDictation("abc", "defgh", 6)).toBe("abc de");
  });
});

describe("DictateButton", () => {
  it("offers to dictate while idle and starts on tap", () => {
    const d = dictationIn("idle");
    render(<DictateButton dictation={d} />);
    const button = screen.getByRole("button", { name: "Dictate" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(d.toggle).toHaveBeenCalledOnce();
  });

  it("becomes a pressed stop button while recording", () => {
    render(<DictateButton dictation={dictationIn("recording")} />);
    const button = screen.getByRole("button", { name: "Stop dictating" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("is-recording");
  });

  it("reports busy, not dimmed, while transcribing", () => {
    render(<DictateButton dictation={dictationIn("transcribing")} />);
    const button = screen.getByRole("button", { name: "Dictate" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("can be switched off by its chat box", () => {
    render(<DictateButton dictation={dictationIn("idle")} disabled />);
    expect(screen.getByRole("button", { name: "Dictate" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("DictationStatus", () => {
  it("is hidden and silent while idle", () => {
    render(<DictationStatus dictation={dictationIn("idle")} />);
    const status = screen.getByRole("status");
    expect(status.className).not.toContain("visible");
    expect(status.textContent).toBe("");
  });

  it("says Recording once, with the timer hidden from screen readers", () => {
    render(<DictationStatus dictation={dictationIn("recording", 7_400)} />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("visible");
    expect(screen.getByText("Recording")).toBeDefined();
    expect(screen.getByText("0:07").getAttribute("aria-hidden")).toBe("true");
  });

  it("shows when it is transcribing", () => {
    render(<DictationStatus dictation={dictationIn("transcribing")} />);
    expect(screen.getByRole("status").textContent).toBe("Transcribing…");
  });
});
