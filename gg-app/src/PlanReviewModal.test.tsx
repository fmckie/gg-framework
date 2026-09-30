// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanReviewModal } from "./PlanReviewModal";

vi.mock("./Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

afterEach(cleanup);

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
    const reject = screen.getByRole("button", { name: "Reject" });
    reject.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Plan" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("returns focus to the Feedback button when feedback is cancelled", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    const input = screen.getByPlaceholderText("What should change about this plan?");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Feedback" }));
  });
});
