// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PlanDecision } from "../transcript-item";
import { PlanDecisionNotice, describePlanDecision } from "./PlanDecisionNotice";

afterEach(cleanup);

describe("describePlanDecision", () => {
  it.each<[PlanDecision, RegExp]>([
    ["accepted", /accepted.*implementing/i],
    ["feedback", /feedback.*revising/i],
    ["rejected", /rejected/i],
  ])("gives %s its line", (decision, pattern) => {
    expect(describePlanDecision(decision)).toMatch(pattern);
  });
});

describe("PlanDecisionNotice", () => {
  it("marks an accepted plan as work in progress", () => {
    render(<PlanDecisionNotice decision="accepted" />);
    expect(screen.getByRole("status").textContent).toContain("Plan accepted");
    expect(screen.getByRole("img", { name: "Working" })).toBeTruthy();
  });

  it.each<PlanDecision>(["accepted", "feedback", "rejected"])(
    "carries the %s decision for styling",
    (decision) => {
      render(<PlanDecisionNotice decision={decision} />);
      expect(screen.getByRole("status").getAttribute("data-decision")).toBe(decision);
    },
  );

  it("marks a rejected plan as stopped", () => {
    render(<PlanDecisionNotice decision="rejected" />);
    expect(screen.getByRole("img", { name: "Stopped" })).toBeTruthy();
    expect(screen.getByText("Plan rejected. Nothing was built.").className).toBe(
      "placeholder-muted",
    );
  });
});

describe("the approved plan's row", () => {
  it("folds an accepted plan into its title and Approved, behind a hidden tick", () => {
    render(<PlanDecisionNotice decision="accepted" title="Rate-limit failed logins" />);
    const row = screen.getByRole("status");
    expect(row.className).toBe("plan-done");
    expect(row.textContent).toBe("✓Rate-limit failed logins · Approved");
    expect(row.querySelector(".plan-done-check")?.getAttribute("aria-hidden")).toBe("true");
    expect(row.querySelector(".plan-done-state")?.textContent).toBe(" · Approved");
    expect(screen.queryByText(/Plan accepted/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each<PlanDecision>(["rejected", "feedback"])(
    "never folds a %s plan, even when it is given a title",
    (decision) => {
      const { container } = render(<PlanDecisionNotice decision={decision} title="Some plan" />);
      expect(container.querySelector(".plan-done")).toBeNull();
      expect(container.textContent).not.toContain("Approved");
      expect(container.textContent).toContain(describePlanDecision(decision));
    },
  );
});
