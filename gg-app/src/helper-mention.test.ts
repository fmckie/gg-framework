import { describe, expect, it } from "vitest";
import {
  composerButtonAction,
  helperQuestion,
  helperTokenParts,
  type ComposerButtonAction,
} from "./helper-mention";

describe("helperQuestion", () => {
  const cases: [string, string | null][] = [
    ["@help question", "question"],
    ["@Help question", "question"],
    ["@help: question", "question"],
    ["  @HELP   what changed?  ", "what changed?"],
    ["@help", ""],
    ["@help   ", ""],
    // The old triggers keep working, unadvertised.
    ["@helper question", "question"],
    ["@Helper: what changed?", "what changed?"],
    ["@helper", ""],
    ["@muse question", "question"],
    ["@Muse: what changed?", "what changed?"],
    ["@ken question", "question"],
    ["@muse", ""],
    // File mentions stay file mentions.
    ["@help.md", null],
    ["@helpful.ts", null],
    ["@helper.ts", null],
    ["@helper-mention.ts is broken", null],
    ["@helpers", null],
    ["@museum.ts", null],
    ["@museum.ts is broken", null],
    ["@kennedy.ts is broken", null],
    ["ask @help later", null],
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
    expect(helperTokenParts("@help.md")).toBeNull();
    expect(helperTokenParts("@helper.ts")).toBeNull();
    expect(helperTokenParts("@helper-mention.ts")).toBeNull();
  });

  it("splits a leading @help token", () => {
    expect(helperTokenParts("@Help: why?")).toEqual({
      lead: "",
      token: "@Help",
      rest: ": why?",
    });
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

  // The iPhone had no way to queue mid-run: the button stopped the build and
  // Return added a line. A draft now queues; an empty box still stops.
  const phone: [boolean, boolean, ComposerButtonAction][] = [
    [true, true, "send"],
    [true, false, "stop"],
    [false, true, "send"],
    [false, false, "send"],
  ];
  it.each(phone)("on the iPhone, running=%s, draft=%s: %s", (running, draft, expected) => {
    expect(composerButtonAction(running, null, draft)).toBe(expected);
  });
});
