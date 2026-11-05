// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaidModelConfirm } from "./PaidModelConfirm";

const MODEL = {
  name: "Claude Opus 5.5 Fast",
  billing: {
    label: "bills usage credits",
    detail: "Fast mode bills your Claude usage credits from the first token.",
    paid: true,
  },
};

afterEach(cleanup);

describe("PaidModelConfirm", () => {
  it("names the cost and focuses Cancel", () => {
    render(<PaidModelConfirm model={MODEL} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(
      screen.getByRole("group", { name: "Claude Opus 5.5 Fast spends real money." }),
    ).toBeTruthy();
    expect(screen.getByText(/bills your Claude usage credits/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("confirms only on the explicit yes", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<PaidModelConfirm model={MODEL} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use it and pay from credits" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("backs out on Escape", () => {
    const onCancel = vi.fn();
    render(<PaidModelConfirm model={MODEL} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
