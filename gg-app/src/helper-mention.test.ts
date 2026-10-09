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
    ["@helper question", "question"],
    ["@Helper question", "question"],
    ["@helper: question", "question"],
    ["  @HELPER   what changed?  ", "what changed?"],
    ["@helper", ""],
    ["@helper   ", ""],
    // The old triggers keep working, unadvertised.
    ["@muse question", "question"],
    ["@Muse: what changed?", "what changed?"],
    ["@ken question", "question"],
    ["@muse", ""],
    // File mentions stay file mentions.
    ["@helper.ts", null],
    ["@helper-mention.ts is broken", null],
    ["@helpers", null],
    ["@museum.ts", null],
    ["@museum.ts is broken", null],
    ["@kennedy.ts is broken", null],
    ["ask @helper later", null],
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
    expect(helperTokenParts("@helper.ts")).toBeNull();
    expect(helperTokenParts("@helper-mention.ts")).toBeNull();
  });

  it("splits a leading @helper token", () => {
    expect(helperTokenParts("@Helper: why?")).toEqual({
      lead: "",
      token: "@Helper",
      rest: ": why?",
    });
  });
});

describe("withHelperMention", () => {
  const cases: [string, string][] = [
    ["", "@helper "],
    ["what happened?", "@helper what happened?"],
    ["  what happened?", "@helper what happened?"],
    ["@helper what happened?", "@helper what happened?"],
    ["@muse what happened?", "@muse what happened?"],
    ["@helper.ts is broken", "@helper @helper.ts is broken"],
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
