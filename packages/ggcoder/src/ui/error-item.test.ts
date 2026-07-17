import { describe, expect, it } from "vitest";
import { GGAIError } from "@kleio/ai";
import { toErrorItem } from "./error-item.js";

describe("toErrorItem", () => {
  it("uses Kleio Coder display copy while preserving classified messages", () => {
    expect(toErrorItem(new Error("boom"), "error-1")).toMatchObject({
      id: "error-1",
      headline: "Kleio Coder hit an unexpected error.",
      message: "boom",
      guidance:
        "This looks like a Kleio Coder bug — please report it at https://github.com/fmckie/gg-framework/issues.",
    });
  });

  it("keeps non-application error guidance and a supplied context prefix", () => {
    expect(
      toErrorItem(new GGAIError("fetch failed", { source: "network" }), "error-2", "Worker"),
    ).toMatchObject({
      headline: "Worker — Network error — couldn't reach the provider.",
      guidance: "Check your internet connection. This is not a Kleio Coder issue — retry shortly.",
    });
  });
});
