// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanReviewModal } from "./PlanReviewModal";

vi.mock("./Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("platform-ios");
});

function renderPlan(): { onAccept: ReturnType<typeof vi.fn>; onReject: ReturnType<typeof vi.fn> } {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  render(
    <PlanReviewModal
      content="1. Do the thing"
      onAccept={onAccept}
      onFeedback={vi.fn()}
      onReject={onReject}
    />,
  );
  return { onAccept, onReject };
}

describe("PlanReviewModal", () => {
  it("is a named modal dialog that starts focus on the plan, not on Accept", () => {
    renderPlan();
    const dialog = screen.getByRole("dialog", { name: "Review plan" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Plan" }));
  });

  it("keeps Tab inside and never resolves the plan on Escape", () => {
    const { onAccept, onReject } = renderPlan();
    const accept = screen.getByRole("button", { name: "Accept" });
    accept.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Plan" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("orders the controls plan, Feedback, Reject, then Accept last", () => {
    renderPlan();
    const dialog = screen.getByRole("dialog", { name: "Review plan" });
    const stops = Array.from(dialog.querySelectorAll("button, [tabindex='0']")).map(
      (element) => element.getAttribute("aria-label") ?? element.textContent,
    );
    expect(stops).toEqual(["Plan", "Feedback", "Reject", "Accept"]);
  });

  it("returns focus to the Feedback button when feedback is cancelled", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    const input = screen.getByPlaceholderText("What should change about this plan?");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Feedback" }));
  });
});

describe("the waiting line", () => {
  it("says it is waiting for your review, as a status under the actions", () => {
    renderPlan();
    const line = screen.getByRole("status");
    expect(line.textContent).toBe("Waiting for your review");
    expect(line.previousElementSibling?.className).toBe("plan-review-actions");
    expect(line.parentElement).toBe(screen.getByRole("dialog", { name: "Review plan" }));
  });

  it("leaves the word to Helper's line while Helper reviews the plan", () => {
    render(
      <PlanReviewModal
        content="1. Do the thing"
        kenReviewing
        onAccept={vi.fn()}
        onFeedback={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Waiting for your review")).toBeNull();
  });

  it("is not on the iPhone", () => {
    document.documentElement.classList.add("platform-ios");
    renderPlan();
    expect(screen.queryByText("Waiting for your review")).toBeNull();
  });
});
