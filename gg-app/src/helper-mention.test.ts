import { describe, expect, it } from "vitest";
import {
  addressesHelper,
  composerButtonAction,
  helperQuestion,
  helperTokenParts,
  withHelperMention,
  type ComposerButtonAction,
} from "./helper-mention";

describe("helperQuestion", () => {
  const cases: [string, string | null][] = [
    ["@muse what changed?", "what changed?"],
    ["@Muse: what changed?", "what changed?"],
    ["  @MUSE   what changed?  ", "what changed?"],
    // The old trigger keeps working, unadvertised.
    ["@ken what changed?", "what changed?"],
    ["@muse", ""],
    ["@muse   ", ""],
    ["@museum.ts is broken", null],
    ["@kennedy.ts is broken", null],
    ["ask @muse later", null],
    ["", null],
  ];
  it.each(cases)("%j asks %j", (draft, expected) => {
    expect(helperQuestion(draft)).toBe(expected);
  });
});

describe("helperTokenParts", () => {
  it("keeps the typed casing and the text around the token", () => {
    expect(helperTokenParts("  @Ken why?")).toEqual({ lead: "  ", token: "@Ken", rest: " why?" });
  });

  it("is null when the draft is not addressed to the helper", () => {
    expect(helperTokenParts("@museum.ts")).toBeNull();
  });
});

describe("withHelperMention", () => {
  const cases: [string, string][] = [
    ["", "@muse "],
    ["what happened?", "@muse what happened?"],
    ["  what happened?", "@muse what happened?"],
    ["@muse what happened?", "@muse what happened?"],
    ["@ken what happened?", "@ken what happened?"],
  ];
  it.each(cases)("%j becomes %j", (draft, expected) => {
    expect(withHelperMention(draft)).toBe(expected);
  });

  it("produces a draft the composer routes to the helper", () => {
    expect(addressesHelper(withHelperMention(""))).toBe(true);
  });
});

describe("composerButtonAction", () => {
  const cases: [boolean, string | null, ComposerButtonAction][] = [
    [false, null, "send"],
    [false, "what happened?", "send"],
    // Mid-run, an empty draft or one for the coder keeps the button on Stop...
    [true, null, "stop"],
    [true, "", "stop"],
    // ...and a question for the helper sends.
    [true, "what happened?", "send"],
  ];
  it.each(cases)("running=%s, question=%j: %s", (running, question, expected) => {
    expect(composerButtonAction(running, question)).toBe(expected);
  });
});
