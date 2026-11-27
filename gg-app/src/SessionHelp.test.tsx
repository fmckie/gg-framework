// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionHelp } from "./SessionHelp";

vi.mock("./platform", () => ({ isPhone: vi.fn(() => false) }));

afterEach(() => {
  cleanup();
});

describe("SessionHelp", () => {
  it("shows the Helper and Autopilot topics in a code session", () => {
    render(<SessionHelp mode="code" phone={false} onClose={() => {}} />);
    expect(screen.getByText("Ask Helper")).toBeTruthy();
    expect(screen.getByText("Autopilot")).toBeTruthy();
    expect(screen.getByText("Plans")).toBeTruthy();
  });

  it("leaves the code-only topics out of a chat", () => {
    render(<SessionHelp mode="chat" phone={false} onClose={() => {}} />);
    expect(screen.queryByText("Ask Helper")).toBeNull();
    expect(screen.queryByText("Autopilot")).toBeNull();
    expect(screen.queryByText("Commit")).toBeNull();
    expect(screen.getByText("Brain")).toBeTruthy();
  });

  it("names the dialog", () => {
    render(<SessionHelp mode="motion" phone={false} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "How this screen works" })).toBeTruthy();
  });

  it("is the same dialog on the iPhone, every topic open, in a touch screen's words", () => {
    render(<SessionHelp mode="code" phone onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "How this screen works" });
    expect(dialog.classList.contains("session-help")).toBe(true);
    expect(dialog.classList.contains("session-help-sheet")).toBe(false);
    expect(dialog.querySelector("details")).toBeNull();
    expect(
      dialog.querySelectorAll(".session-help-grid > .session-help-row").length,
    ).toBeGreaterThan(4);
    expect(
      screen.getByText("Type in the box at the bottom and tap send. Return adds a new line."),
    ).toBeTruthy();
    expect(screen.queryByText(/press Return to send/)).toBeNull();
  });
});
