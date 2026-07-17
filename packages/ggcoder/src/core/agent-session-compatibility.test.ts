import { describe, expect, it } from "vitest";
import { buildCoderPromptCacheKey, LEGACY_CODER_PROMPT_CACHE_PREFIX } from "./agent-session.js";

describe("Coder prompt-cache compatibility", () => {
  it("retains the legacy default prefix", () => {
    expect(LEGACY_CODER_PROMPT_CACHE_PREFIX).toBe("ggcoder");
    expect(buildCoderPromptCacheKey("session-123")).toBe("ggcoder:session-123");
  });

  it("continues to honor explicit worker prefixes", () => {
    expect(buildCoderPromptCacheKey("session-123", "worker-scope")).toBe(
      "worker-scope:session-123",
    );
  });
});
