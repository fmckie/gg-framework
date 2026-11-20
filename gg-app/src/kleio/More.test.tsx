// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { More } from "./More";

afterEach(cleanup);

describe("More", () => {
  it("is closed at first, and named for its section", () => {
    render(
      <More about="Relays">
        <p>A relay of your own is faster.</p>
      </More>,
    );
    const summary = screen.getByText("More", { selector: "summary" });
    expect(summary.getAttribute("aria-label")).toBe("More about Relays");
    const fold = summary.closest("details");
    expect(fold?.open).toBe(false);
    // The words are on the page, folded, and open on request.
    expect(fold?.textContent).toContain("A relay of your own is faster.");
    fireEvent.click(summary);
    expect(fold?.open).toBe(true);
  });
});
