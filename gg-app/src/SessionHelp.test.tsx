// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionHelp } from "./SessionHelp";

vi.mock("./platform", () => ({ isPhone: vi.fn(() => false) }));

afterEach(() => {
  cleanup();
});

describe("SessionHelp", () => {
  it("shows the Muse and Autopilot topics in a code session", () => {
    render(<SessionHelp mode="code" phone={false} onClose={() => {}} />);
    expect(screen.getByText("Ask Muse")).toBeTruthy();
    expect(screen.getByText("Autopilot")).toBeTruthy();
    expect(screen.getByText("Plans")).toBeTruthy();
  });

  it("leaves the code-only topics out of a chat", () => {
    render(<SessionHelp mode="chat" phone={false} onClose={() => {}} />);
    expect(screen.queryByText("Ask Muse")).toBeNull();
    expect(screen.queryByText("Autopilot")).toBeNull();
    expect(screen.queryByText("Commit")).toBeNull();
    expect(screen.getByText("Brain")).toBeTruthy();
  });

  it("names the dialog", () => {
    render(<SessionHelp mode="motion" phone={false} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "How this screen works" })).toBeTruthy();
  });

  it("collapses each topic into <details> on the iPhone", () => {
    render(<SessionHelp mode="code" phone onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const topics = dialog.querySelectorAll("details");
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) expect(topic.open).toBe(false);
    expect(dialog.querySelector("details summary")?.textContent).toContain("Message Kleio");
  });
});
