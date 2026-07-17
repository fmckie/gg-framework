import { describe, expect, it } from "vitest";
import { buildTelegramHelpText } from "./serve-mode.js";

describe("Kleio Manager Telegram copy", () => {
  it("uses preferred Manager and Coder wording while documenting the command alias", () => {
    const help = buildTelegramHelpText();
    expect(help).toContain("*Kleio Manager*");
    expect(help).toContain("/model-manager");
    expect(help).toContain("Coder worker");
    expect(help).toContain("/model-boss remains supported");
    expect(help).not.toContain("*GG Boss*");
  });
});
