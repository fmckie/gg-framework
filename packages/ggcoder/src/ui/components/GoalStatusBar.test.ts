import { describe, expect, it } from "vitest";
import { formatGoalStatusActiveText } from "./GoalStatusBar.js";

const startedAt = 1_700_000_000_000;

describe("GoalStatusBar formatting", () => {
  it("keeps active Goal status text compact and single-line", () => {
    const text = formatGoalStatusActiveText({
      runId: "goal-1",
      label: "A very long Goal title that previously wrapped across small terminals",
      phase: "worker",
      startedAt,
    });

    expect(text).toBe("Goal in progress: A very long Goal title …");
    expect(text).not.toContain("\n");
    expect(text.length).toBeLessThanOrEqual(44);
  });
});
