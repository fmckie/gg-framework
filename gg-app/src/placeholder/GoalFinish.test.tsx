// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GoalFinish } from "./GoalFinish";

afterEach(cleanup);

describe("GoalFinish", () => {
  it("shows the stretch's score and leads to the summary in the chat", () => {
    const onShowChat = vi.fn();
    const onClose = vi.fn();
    render(
      <GoalFinish
        finish={{
          id: 8000,
          goalId: "g",
          outcome: "done",
          elapsedMs: 7000,
          turns: 5,
          workers: 2,
          failedWorkers: 1,
          outputTokens: 1500,
          line: "All finished. The full write-up is in the chat.",
        }}
        onShowChat={onShowChat}
        onClose={onClose}
      />,
    );
    const card = screen.getByRole("status", { name: "Job done" });
    // The desktop reads the outcome for the card's leading rule.
    expect(card.getAttribute("data-outcome")).toBe("done");
    expect(card.classList.contains("goal-finish")).toBe(true);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.parentElement?.className).toBe("goal-finish-actions");
    expect(screen.getByRole("button", { name: "Read summary in Chat" }).parentElement).toBe(
      close.parentElement,
    );
    expect(screen.getByText("2 (1 failed)")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read summary in Chat" }));
    expect(onShowChat).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
