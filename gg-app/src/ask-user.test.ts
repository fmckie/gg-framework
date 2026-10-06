import { describe, expect, it } from "vitest";
import {
  appendPendingAsks,
  askNotificationText,
  closeSettledAsk,
  isAskUserPrompt,
  type AskUserPrompt,
} from "./ask-user";

describe("isAskUserPrompt", () => {
  it("accepts questions with and without options", () => {
    const prompt = {
      id: "ask-1",
      questions: [
        { id: "a", kind: "confirm", question: "Go?", options: [{ label: "Yes" }] },
        { id: "b", kind: "text", question: "Why?" },
      ],
    };
    expect(isAskUserPrompt(prompt)).toBe(true);
  });

  it("rejects a question whose options are not a list", () => {
    const prompt = {
      id: "ask-1",
      questions: [{ id: "a", kind: "confirm", question: "Go?", options: "[CIRCULAR]" }],
    };
    expect(isAskUserPrompt(prompt)).toBe(false);
  });
});

describe("pending/settled asks", () => {
  type It = {
    kind: string;
    id: number;
    prompt?: AskUserPrompt;
    sent?: boolean;
    cancelled?: boolean;
  };
  const p = (id: string): AskUserPrompt => ({
    id,
    questions: [{ id: "a", kind: "confirm", question: "Go?" }],
  });
  const make = (prompt: AskUserPrompt): It => ({ kind: "ask", id: 9, prompt });

  it("appends only valid asks the transcript does not already show", () => {
    const items: It[] = [{ kind: "ask", id: 1, prompt: p("ask-1") }];
    const out = appendPendingAsks(items, [p("ask-1"), p("ask-2"), { id: "bad" }], make);
    expect(out.map((i) => i.prompt?.id)).toEqual(["ask-1", "ask-2"]);
    expect(appendPendingAsks(items, undefined, make)).toEqual(items);
  });

  it("closes the open band for a settled ask, leaving sent bands alone", () => {
    const items: It[] = [
      { kind: "ask", id: 1, prompt: p("ask-1") },
      { kind: "ask", id: 2, prompt: p("ask-2"), sent: true },
    ];
    expect(closeSettledAsk(items, "ask-1")[0]?.cancelled).toBe(true);
    expect(closeSettledAsk(items, "ask-2")[1]).toEqual(items[1]);
  });
});

describe("askNotificationText", () => {
  it("titles the first question and lists its options", () => {
    expect(
      askNotificationText({
        id: "ask-1",
        questions: [
          {
            id: "s",
            kind: "choice",
            question: "Where should login sessions be stored?",
            options: [{ label: "Keep it simple (one file)" }, { label: "Use a real database" }],
          },
          { id: "t", kind: "confirm", question: "Ship?" },
        ],
      }),
    ).toEqual({
      title: "Where should login sessions be stored? (+1 more)",
      body: "Keep it simple (one file) · Use a real database",
    });
    expect(
      askNotificationText({ id: "a", questions: [{ id: "x", kind: "confirm", question: "Go?" }] })
        .body,
    ).toBe("Yes · No");
  });
});
