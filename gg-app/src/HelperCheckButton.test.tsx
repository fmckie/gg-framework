// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelperCheckButton } from "./HelperCheckButton";
import { HELPER_CHECK, helperQuestion } from "./helper-mention";

afterEach(cleanup);

describe("HelperCheckButton", () => {
  it("sends `@muse check` in one tap, the same question as typing it", () => {
    const onCheck = vi.fn();
    render(<HelperCheckButton busy={false} onCheck={onCheck} />);
    const button = screen.getByRole("button", { name: "Ask Muse to check the work" });
    expect(button.getAttribute("title")).toBe("Send “@muse check”");
    fireEvent.click(button);
    expect(onCheck).toHaveBeenCalledOnce();
    expect(HELPER_CHECK).toBe("@muse check");
    expect(helperQuestion(HELPER_CHECK)).toBe("check");
  });

  it("waits while Muse is still answering", () => {
    const onCheck = vi.fn();
    render(<HelperCheckButton busy onCheck={onCheck} />);
    const button = screen.getByRole("button", { name: "Ask Muse to check the work" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onCheck).not.toHaveBeenCalled();
  });

  it("keeps the keyboard up: a press doesn't take focus from the draft", () => {
    render(<HelperCheckButton busy={false} onCheck={vi.fn()} />);
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("button").dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });
});
