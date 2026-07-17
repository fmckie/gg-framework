import { describe, expect, it } from "vitest";
import { buildHelpText, canonicalName } from "./slash-commands.js";

describe("Kleio Manager slash commands", () => {
  it("prefers /model-manager while retaining /model-boss as an alias", () => {
    expect(canonicalName("model-manager")).toBe("model-manager");
    expect(canonicalName("model-boss")).toBe("model-manager");
    expect(canonicalName("model")).toBe("model-manager");
  });

  it("renders branded help with explicit compatibility", () => {
    const help = buildHelpText();
    expect(help).toContain("**Kleio Manager commands**");
    expect(help).toContain("`/model-manager`");
    expect(help).toContain("/model-boss");
    expect(help).toContain("Switch the Manager model");
  });
});
