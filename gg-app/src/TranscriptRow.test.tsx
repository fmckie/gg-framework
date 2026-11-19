// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

// The row's imports reach agent.ts, which reads the current window at load.
mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { TranscriptRow } = await import("./TranscriptRow");

afterEach(cleanup);

describe("a question to Helper", () => {
  it("wraps its leading mention in a span and keeps its full text", () => {
    const text = "@Help how do I copy a block?";
    const { container } = render(<TranscriptRow item={{ kind: "user", id: 1, text, ken: true }} />);
    const bubble = container.querySelector(".user-msg.user-ken");
    const mentions = container.querySelectorAll(".helper-mention");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.textContent).toBe("@Help");
    expect(bubble?.textContent).toBe(text);
  });

  it("has no span when the text does not start with a mention", () => {
    const text = "ask @helper about this, or see @helper.ts";
    const { container } = render(<TranscriptRow item={{ kind: "user", id: 2, text, ken: true }} />);
    expect(container.querySelector(".helper-mention")).toBeNull();
    expect(container.querySelector(".user-msg.user-ken")?.textContent).toBe(text);
  });

  it("leaves a message to Kleio alone, even one that opens with the mention", () => {
    const text = "@helper is the name of the trigger";
    const { container } = render(<TranscriptRow item={{ kind: "user", id: 3, text }} />);
    expect(container.querySelector(".helper-mention")).toBeNull();
    expect(container.querySelector(".user-msg")?.textContent).toBe(text);
  });
});
