import { describe, expect, it } from "vitest";
import { buildTelegramHelpText } from "./serve-mode.js";

const LEGACY_MANAGER_DISPLAY_NAME = ["GG", "Boss"].join(" ");

describe("Kleio Manager Telegram copy", () => {
  it("uses preferred Manager and Coder wording while documenting the command alias", () => {
    const help = buildTelegramHelpText();
    expect(help).toContain("*Kleio Manager*");
    expect(help).toContain("/model-manager");
    expect(help).toContain("Coder worker");
    expect(help).toContain("/model-boss remains supported");
    expect(help).not.toContain(`*${LEGACY_MANAGER_DISPLAY_NAME}*`);
  });
});
