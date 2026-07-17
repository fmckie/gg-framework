import { describe, expect, it } from "vitest";
import { buildAgentHomeRegistration } from "./agent-home-mode.js";

describe("Agent Home registration compatibility contract", () => {
  it("keeps the paired agent ID while displaying the Kleio Coder name", () => {
    expect(buildAgentHomeRegistration("claude-test")).toEqual({
      id: "ggcoder",
      name: "Kleio Coder",
      description: "AI coding agent — claude-test",
    });
  });
});
